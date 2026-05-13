#![allow(
    unused_imports,
    unused_variables,
    dead_code,
    unused_mut,
    unreachable_code
)]
#![warn(unused_must_use)]
use bun_collections::VecExt;
use bun_core::feature_flags as FeatureFlags;
use bun_core::strings;

use crate::lexer as js_lexer;
use crate::p::P;
use crate::parser::{
    self as js_parser, IdentifierOpts, RelocateVars, RelocateVarsMode, SideEffects,
};
use bun_ast::G::{Decl, Property};
use bun_ast::ast_result::CommonJSNamedExport;
use bun_ast::{self as js_ast, B, Binding, E, Expr, Flags, G, LocRef, S, Stmt, Symbol};

// ── local EString shims ────────────────────────────────────────────────────
// E.rs currently carries two `impl EString` blocks (live + round-C draft) with
// overlapping inherent methods, so calls like `EString::init`/`javascript_length`
// /`eql_bytes` are E0034-ambiguous from here. These thin wrappers go through
// public fields directly and are removed once E.rs is deduped.
#[inline]
fn e_string_init(data: &[u8]) -> E::EString {
    E::EString {
        data: data.into(),
        ..Default::default()
    }
}

#[inline]
fn e_string_javascript_length(s: &E::EString) -> Option<u32> {
    if s.rope_len > 0 {
        // We only support ascii ropes for now
        return Some(s.rope_len);
    }
    if !s.is_utf16 {
        if !s.data.iter().all(|&b| b < 128) {
            return None;
        }
        return Some(s.data.len() as u32);
    }
    // UTF-16: `data.len()` stores the u16 element count (see EString::init_utf16).
    Some(s.data.len() as u32)
}

#[inline]
fn e_string_eql_bytes(s: &E::EString, other: &[u8]) -> bool {
    if !s.is_utf16 {
        s.data == other
    } else {
        let s16 = s.slice16();
        s16.len() == other.len() && s16.iter().zip(other).all(|(&c, &b)| c == b as u16)
    }
}

// Zig: `pub fn AstMaybe(comptime ts, comptime jsx, comptime scan_only) type { return struct { ... } }`
// — file-split mixin pattern. Round-C lowered `const JSX: JSXTransformType` → `J: JsxT`, so this is
// a direct `impl P` block.

impl<'a, const TYPESCRIPT: bool, const SCAN_ONLY: bool> P<'a, TYPESCRIPT, SCAN_ONLY> {
    pub fn maybe_relocate_vars_to_top_level(
        &mut self,
        decls: &[G::Decl],
        mode: RelocateVarsMode,
    ) -> RelocateVars {
        let p = self;
        // Only do this when the scope is not already top-level and when we're not inside a function.
        if p.current_scope == p.module_scope {
            return RelocateVars {
                ok: false,
                ..Default::default()
            };
        }

        // `StoreRef<Scope>` (Copy + safe `Deref`) lets the parent-chain walk
        // run without raw-pointer `unsafe` and without borrowing `p`.
        let mut scope = p.current_scope_ref();
        while !scope.kind_stops_hoisting() {
            let parent = scope.parent;
            debug_assert!(parent.is_some());
            scope = parent.unwrap();
        }

        if scope != p.module_scope {
            return RelocateVars {
                ok: false,
                ..Default::default()
            };
        }

        let mut value: Expr = Expr::EMPTY;
        for decl in decls {
            // Derive `*mut P` from the live `&mut Self` so the trampoline's
            // `&mut *ctx` reborrows under the active Unique tag (see Binding.rs).
            let wrapper = p.to_expr_wrapper_hoisted;
            let ctx = core::ptr::addr_of_mut!(*p).cast::<core::ffi::c_void>();
            let binding = Binding::to_expr(&decl.binding, ctx, wrapper);
            if let Some(decl_value) = decl.value {
                value = Expr::join_with_comma(value, Expr::assign(binding, decl_value));
            } else if mode == RelocateVarsMode::ForInOrForOf {
                value = Expr::join_with_comma(value, binding);
            }
        }

        if matches!(value.data, js_ast::ExprData::EMissing(_)) {
            return RelocateVars {
                ok: true,
                ..Default::default()
            };
        }

        RelocateVars {
            stmt: Some(p.s(
                S::SExpr {
                    value,
                    does_not_affect_tree_shaking: false,
                },
                value.loc,
            )),
            ok: true,
        }
    }

    // EDot nodes represent a property access. This function may return an
    // expression to replace the property access with. It assumes that the
    // target of the EDot expression has already been visited.
    pub fn maybe_rewrite_property_access(
        &mut self,
        loc: bun_ast::Loc,
        target: js_ast::Expr,
        name: &'a [u8],
        name_loc: bun_ast::Loc,
        identifier_opts: IdentifierOpts,
    ) -> Option<Expr> {
        let p = self;
        let name_static = E::Str::new(name);

        // Zig labeled switch with `continue :sw` → loop + match with mutable scrutinee.
        let mut sw_data = target.data;
        'sw: loop {
            match sw_data {
                js_ast::ExprData::EIdentifier(id) => {
                    // Rewrite property accesses on explicit namespace imports as an identifier.
                    // This lets us replace them easily in the printer to rebind them to
                    // something else without paying the cost of a whole-tree traversal during
                    // module linking just to rewrite these EDot expressions.
                    if p.options.bundle {
                        if p.import_items_for_namespace.contains_key(&id.ref_) {
                            // PORT NOTE: reshaped for borrowck — Zig held `*ImportItemForNamespaceMap`
                            // across `p.newSymbol`; split into lookup → (maybe new_symbol) → re-borrow.
                            let existing = p
                                .import_items_for_namespace
                                .get(&id.ref_)
                                .unwrap()
                                .get(name)
                                .copied();
                            let ref_ = match existing {
                                Some(loc_ref) => loc_ref.ref_.expect("infallible: ref bound"),
                                None => {
                                    // Generate a new import item symbol in the module scope
                                    let new_ref = p
                                        .new_symbol(js_ast::symbol::Kind::Import, name)
                                        .expect("unreachable");
                                    let new_item = LocRef {
                                        loc: name_loc,
                                        ref_: Some(new_ref),
                                    };
                                    // SAFETY: module_scope is arena-owned and valid for the parser lifetime.
                                    VecExt::append(&mut p.module_scope_mut().generated, new_ref);

                                    p.import_items_for_namespace
                                        .get_mut(&id.ref_)
                                        .unwrap()
                                        .put(name, new_item)
                                        .expect("unreachable");
                                    p.is_import_item.insert(new_ref, ());

                                    let symbol = &mut p.symbols[new_ref.inner_index() as usize];

                                    // Mark this as generated in case it's missing. We don't want to
                                    // generate errors for missing import items that are automatically
                                    // generated.
                                    symbol.import_item_status =
                                        bun_ast::ImportItemStatus::Generated;

                                    new_ref
                                }
                            };

                            // Undo the usage count for the namespace itself. This is used later
                            // to detect whether the namespace symbol has ever been "captured"
                            // or whether it has just been used to read properties off of.
                            //
                            // The benefit of doing this is that if both this module and the
                            // imported module end up in the same module group and the namespace
                            // symbol has never been captured, then we don't need to generate
                            // any code for the namespace at all.
                            p.ignore_usage(id.ref_);

                            // Track how many times we've referenced this symbol
                            p.record_usage(ref_);

                            return Some(
                                p.handle_identifier(
                                    name_loc,
                                    E::Identifier {
                                        ref_,
                                        ..Default::default()
                                    },
                                    Some(name),
                                    IdentifierOpts::new()
                                        .with_assign_target(identifier_opts.assign_target())
                                        .with_is_call_target(identifier_opts.is_call_target())
                                        .with_is_delete_target(identifier_opts.is_delete_target())
                                        // If this expression is used as the target of a call expression, make
                                        // sure the value of "this" is preserved.
                                        .with_was_originally_identifier(false),
                                ),
                            );
                        }
                    }

                    if !p.is_control_flow_dead && id.ref_.eql(p.module_ref) {
                        // Rewrite "module.require()" to "require()" for Webpack compatibility.
                        // See https://github.com/webpack/webpack/pull/7750 for more info.
                        // This also makes correctness a little easier.
                        if identifier_opts.is_call_target() && name == b"require" {
                            p.ignore_usage(p.module_ref);
                            return Some(p.value_for_require(name_loc));
                        } else if !p.commonjs_named_exports_deoptimized && name == b"exports" {
                            if identifier_opts.assign_target() != js_ast::AssignTarget::None {
                                p.commonjs_module_exports_assigned_deoptimized = true;
                            }

                            // Detect if we are doing
                            //
                            //  module.exports = {
                            //    foo: "bar"
                            //  }
                            //
                            //  Note that it cannot be any of these:
                            //
                            //  module.exports += { };
                            //  delete module.exports = {};
                            //  module.exports()
                            if !(identifier_opts.is_call_target()
                                || identifier_opts.is_delete_target())
                                && identifier_opts.assign_target() == js_ast::AssignTarget::Replace
                                && matches!(p.stmt_expr_value, js_ast::ExprData::EBinary(_))
                                && p.stmt_expr_value
                                    .e_binary()
                                    .expect("infallible: variant checked")
                                    .op
                                    == js_ast::OpCode::BinAssign
                            {
                                let stmt_bin = p
                                    .stmt_expr_value
                                    .e_binary()
                                    .expect("infallible: variant checked");
                                let deopt =
                                    // if it's not top-level, don't do this
                                    p.module_scope != p.current_scope
                                    // if you do
                                    //
                                    // exports.foo = 123;
                                    // module.exports = {};
                                    //
                                    // that's a de-opt.
                                    || p.commonjs_named_exports.count() > 0
                                    // anything which is not module.exports = {} is a de-opt.
                                    || !matches!(stmt_bin.right.data, js_ast::ExprData::EObject(_))
                                    || !matches!(stmt_bin.left.data, js_ast::ExprData::EDot(_))
                                    || stmt_bin.left.data.e_dot().expect("infallible: variant checked").name != b"exports"
                                    || !matches!(
                                        stmt_bin.left.data.e_dot().expect("infallible: variant checked").target.data,
                                        js_ast::ExprData::EIdentifier(_)
                                    )
                                    || !stmt_bin
                                        .left
                                        .data
                                        .e_dot()
                                        .unwrap()
                                        .target
                                        .data
                                        .e_identifier()
                                        .unwrap()
                                        .ref_
                                        .eql(p.module_ref);
                                if deopt {
                                    p.deoptimize_common_js_named_exports();
                                    return None;
                                }

                                let right_obj = stmt_bin
                                    .right
                                    .data
                                    .e_object()
                                    .expect("infallible: variant checked");
                                let props: &[G::Property] = right_obj.properties.slice();
                                for prop in props {
                                    // if it's not a trivial object literal, de-opt
                                    if prop.kind != G::PropertyKind::Normal
                                        || prop.key.is_none()
                                        || !matches!(prop.key.expect("infallible: prop has key").data, js_ast::ExprData::EString(_))
                                        || prop.flags.contains(Flags::Property::IsMethod)
                                        || prop.flags.contains(Flags::Property::IsComputed)
                                        || prop.flags.contains(Flags::Property::IsSpread)
                                        || prop.flags.contains(Flags::Property::IsStatic)
                                        // If it creates a new scope, we can't do this optimization right now
                                        // Our scope order verification stuff will get mad
                                        // But we should let you do module.exports = { bar: foo(), baz: 123 }
                                        // just not module.exports = { bar: function() {}  }
                                        // just not module.exports = { bar() {}  }
                                        || match prop.value.expect("infallible: prop has value").data {
                                            js_ast::ExprData::ECommonjsExportIdentifier(_)
                                            | js_ast::ExprData::EImportIdentifier(_)
                                            | js_ast::ExprData::EIdentifier(_) => false,
                                            js_ast::ExprData::ECall(call) => match call.target.data {
                                                js_ast::ExprData::ECommonjsExportIdentifier(_)
                                                | js_ast::ExprData::EImportIdentifier(_)
                                                | js_ast::ExprData::EIdentifier(_) => false,
                                                call_target => {
                                                    !js_ast::expr::Tag::is_primitive_literal(
                                                        call_target.tag(),
                                                    )
                                                }
                                            },
                                            _ => !Expr::is_primitive_literal(&prop.value.expect("infallible: prop has value")),
                                        }
                                    {
                                        p.deoptimize_common_js_named_exports();
                                        return None;
                                    }
                                }
                                // Zig: `for (props) |prop| { ... } else { deopt; return null }`
                                // — the loop body has no `break`, so the `else` arm runs on
                                // every normal completion (including empty `props`). The
                                // entire stmts/decls/clause_items rewriting block that follows
                                // in the Zig source is therefore unreachable there too and is
                                // dropped from the port.
                                {
                                    // empty object de-opts because otherwise the statement becomes
                                    // <empty space> = {};
                                    p.deoptimize_common_js_named_exports();
                                    return None;
                                }
                            }

                            // Deoptimizations:
                            //      delete module.exports
                            //      module.exports();
                            if identifier_opts.is_call_target()
                                || identifier_opts.is_delete_target()
                                || identifier_opts.assign_target() != js_ast::AssignTarget::None
                            {
                                p.deoptimize_common_js_named_exports();
                                return None;
                            }

                            // rewrite `module.exports` to `exports`
                            return Some(Expr {
                                data: js_ast::ExprData::ESpecial(E::Special::ModuleExports),
                                loc: name_loc,
                            });
                        } else if p.options.bundle
                            && name == b"id"
                            && identifier_opts.assign_target() == js_ast::AssignTarget::None
                        {
                            // inline module.id
                            p.ignore_usage(p.module_ref);
                            return Some(p.new_expr(e_string_init(p.source.path.pretty), name_loc));
                        } else if p.options.bundle
                            && name == b"filename"
                            && identifier_opts.assign_target() == js_ast::AssignTarget::None
                        {
                            // inline module.filename
                            p.ignore_usage(p.module_ref);
                            return Some(
                                p.new_expr(e_string_init(p.source.path.name.filename), name_loc),
                            );
                        } else if p.options.bundle
                            && name == b"path"
                            && identifier_opts.assign_target() == js_ast::AssignTarget::None
                        {
                            // inline module.path
                            p.ignore_usage(p.module_ref);
                            return Some(p.new_expr(e_string_init(p.source.path.pretty), name_loc));
                        }
                    }

                    if p.should_unwrap_common_js_to_esm() {
                        if !p.is_control_flow_dead && id.ref_.eql(p.exports_ref) {
                            if !p.commonjs_named_exports_deoptimized {
                                if identifier_opts.is_delete_target() {
                                    p.deoptimize_common_js_named_exports();
                                    return None;
                                }

                                // PORT NOTE: reshaped for borrowck — Zig held the
                                // `getOrPut` entry across `p.newSymbol`.
                                let ref_ = if let Some(existing) =
                                    p.commonjs_named_exports.get(name)
                                {
                                    existing.loc_ref.ref_.expect("infallible: ref bound")
                                } else {
                                    let sym_name: &'a [u8] = p.arena.alloc_slice_copy(
                                        format!("${}", bun_core::fmt::fmt_identifier(name))
                                            .as_bytes(),
                                    );
                                    let new_ref = p
                                        .new_symbol(js_ast::symbol::Kind::Other, sym_name)
                                        .expect("unreachable");
                                    // SAFETY: module_scope is arena-owned and valid for 'a.
                                    VecExt::append(&mut p.module_scope_mut().generated, new_ref);
                                    p.commonjs_named_exports
                                        .put(
                                            name,
                                            CommonJSNamedExport {
                                                loc_ref: LocRef {
                                                    loc: name_loc,
                                                    ref_: Some(new_ref),
                                                },
                                                needs_decl: true,
                                            },
                                        )
                                        .expect("unreachable");
                                    if p.commonjs_named_exports_needs_conversion == u32::MAX {
                                        p.commonjs_named_exports_needs_conversion =
                                            (p.commonjs_named_exports.count() - 1) as u32;
                                    }
                                    new_ref
                                };

                                p.ignore_usage(id.ref_);
                                p.record_usage(ref_);

                                return Some(p.new_expr(
                                    E::CommonJSExportIdentifier {
                                        ref_,
                                        ..Default::default()
                                    },
                                    name_loc,
                                ));
                            } else if p.options.features.commonjs_at_runtime
                                && identifier_opts.assign_target() != js_ast::AssignTarget::None
                            {
                                p.has_commonjs_export_names = true;
                            }
                        }
                    }

                    // Handle references to namespaces or namespace members
                    if matches!(p.ts_namespace.expr, js_ast::ExprData::EIdentifier(e) if id.ref_.eql(e.ref_))
                        && identifier_opts.assign_target() == js_ast::AssignTarget::None
                        && !identifier_opts.is_delete_target()
                    {
                        return Self::maybe_rewrite_property_access_for_namespace(
                            p, name, &target, loc, name_loc,
                        );
                    }
                }
                js_ast::ExprData::EString(str_) => {
                    if p.options.features.minify_syntax {
                        // minify "long-string".length to 11
                        if name == b"length" {
                            if let Some(len) = e_string_javascript_length(&str_) {
                                return Some(p.new_expr(E::Number { value: len as f64 }, loc));
                            }
                        }
                    }
                }
                js_ast::ExprData::EInlinedEnum(ie) => {
                    sw_data = ie.value.data;
                    continue 'sw;
                }
                js_ast::ExprData::EObject(obj) => {
                    if FeatureFlags::INLINE_PROPERTIES_IN_TRANSPILER {
                        if p.options.features.minify_syntax {
                            // Rewrite a property access like this:
                            //   { f: () => {} }.f
                            // To:
                            //   () => {}
                            //
                            // To avoid thinking too much about edgecases, only do this for:
                            //   1) Objects with a single property
                            //   2) Not a method, not a computed property
                            if obj.properties.len_u32() == 1
                                && !identifier_opts.is_delete_target()
                                && identifier_opts.assign_target() == js_ast::AssignTarget::None
                                && !identifier_opts.is_call_target()
                            {
                                let prop: &G::Property = &obj.properties.slice()[0];
                                if prop.value.is_some()
                                    && prop.flags.len() == 0
                                    && prop.key.is_some()
                                    && matches!(
                                        prop.key.expect("infallible: prop has key").data,
                                        js_ast::ExprData::EString(_)
                                    )
                                    && e_string_eql_bytes(
                                        &prop
                                            .key
                                            .expect("infallible: prop has key")
                                            .data
                                            .e_string()
                                            .expect("infallible: variant checked"),
                                        name,
                                    )
                                    && name != b"__proto__"
                                {
                                    return Some(prop.value.expect("infallible: prop has value"));
                                }
                            }
                        }
                    }
                }
                js_ast::ExprData::EImportMeta(_) => {
                    if name == b"main" {
                        return Some(p.value_for_import_meta_main(false, target.loc));
                    }

                    if name == b"hot" {
                        return Some(Expr {
                            data: js_ast::ExprData::ESpecial(
                                if p.options.features.hot_module_reloading {
                                    E::Special::HotEnabled
                                } else {
                                    E::Special::HotDisabled
                                },
                            ),
                            loc,
                        });
                    }

                    // Inline import.meta properties for Bake
                    if p.options.framework.is_some()
                        || (p.options.bundle
                            && p.options.output_format == js_parser::options::Format::Cjs)
                    {
                        if name == b"dir" || name == b"dirname" {
                            // Inline import.meta.dir
                            return Some(
                                p.new_expr(e_string_init(p.source.path.name.dir), name_loc),
                            );
                        } else if name == b"file" {
                            // Inline import.meta.file (filename only)
                            return Some(
                                p.new_expr(e_string_init(p.source.path.name.filename), name_loc),
                            );
                        } else if name == b"path" {
                            // Inline import.meta.path (full path)
                            return Some(p.new_expr(e_string_init(p.source.path.text), name_loc));
                        } else if name == b"url" {
                            // Inline import.meta.url as file:// URL
                            let bunstr = bun_core::String::from_bytes(p.source.path.text);
                            let url = p.arena.alloc_slice_copy(
                                format!("{}", bun_url::file_url_from_string(&bunstr)).as_bytes(),
                            );
                            bunstr.deref();
                            return Some(p.new_expr(e_string_init(url), name_loc));
                        }
                    }

                    // Make all property accesses on `import.meta.url` side effect free.
                    return Some(p.new_expr(
                        E::Dot {
                            target,
                            name: name_static.into(),
                            name_loc,
                            can_be_removed_if_unused: true,
                            ..Default::default()
                        },
                        target.loc,
                    ));
                }
                js_ast::ExprData::ERequireCallTarget => {
                    if name == b"main" {
                        return Some(Expr {
                            loc,
                            data: js_ast::ExprData::ERequireMain,
                        });
                    }
                }
                js_ast::ExprData::EImportIdentifier(id) => {
                    // Symbol uses due to a property access off of an imported symbol are tracked
                    // specially. This lets us do tree shaking for cross-file TypeScript enums.
                    if p.options.bundle && !p.is_control_flow_dead {
                        let use_ = p.symbol_uses.get_mut(&id.ref_).unwrap();
                        use_.count_estimate = use_.count_estimate.saturating_sub(1);
                        // note: this use is not removed as we assume it exists later

                        // Add a special symbol use instead
                        let gop = p
                            .import_symbol_property_uses
                            .get_or_put_value(id.ref_, Default::default())
                            .expect("unreachable");
                        let inner_use = gop
                            .value_ptr
                            .get_or_put_value(name, Default::default())
                            .expect("unreachable");
                        inner_use.count_estimate += 1;
                    }
                }
                // Zig: `inline .e_dot, .e_index => |data, tag|` — expanded per arm
                js_ast::ExprData::EDot(data) => {
                    if matches!(p.ts_namespace.expr, js_ast::ExprData::EDot(ns_data) if data.as_ptr() == ns_data.as_ptr())
                        && identifier_opts.assign_target() == js_ast::AssignTarget::None
                        && !identifier_opts.is_delete_target()
                    {
                        return Self::maybe_rewrite_property_access_for_namespace(
                            p, name, &target, loc, name_loc,
                        );
                    }
                }
                js_ast::ExprData::EIndex(data) => {
                    if matches!(p.ts_namespace.expr, js_ast::ExprData::EIndex(ns_data) if data.as_ptr() == ns_data.as_ptr())
                        && identifier_opts.assign_target() == js_ast::AssignTarget::None
                        && !identifier_opts.is_delete_target()
                    {
                        return Self::maybe_rewrite_property_access_for_namespace(
                            p, name, &target, loc, name_loc,
                        );
                    }
                }
                js_ast::ExprData::ESpecial(special) => match special {
                    E::Special::ModuleExports => {
                        if p.should_unwrap_common_js_to_esm() {
                            if !p.is_control_flow_dead {
                                if !p.commonjs_named_exports_deoptimized {
                                    if identifier_opts.is_delete_target() {
                                        p.deoptimize_common_js_named_exports();
                                        return None;
                                    }

                                    // PORT NOTE: reshaped for borrowck — see exports_ref arm above.
                                    let ref_ = if let Some(existing) =
                                        p.commonjs_named_exports.get(name)
                                    {
                                        existing.loc_ref.ref_.expect("infallible: ref bound")
                                    } else {
                                        let sym_name: &'a [u8] = p.arena.alloc_slice_copy(
                                            format!("${}", bun_core::fmt::fmt_identifier(name))
                                                .as_bytes(),
                                        );
                                        let new_ref = p
                                            .new_symbol(js_ast::symbol::Kind::Other, sym_name)
                                            .expect("unreachable");
                                        // SAFETY: module_scope is arena-owned and valid for 'a.
                                        VecExt::append(
                                            &mut p.module_scope_mut().generated,
                                            new_ref,
                                        );
                                        p.commonjs_named_exports
                                            .put(
                                                name,
                                                CommonJSNamedExport {
                                                    loc_ref: LocRef {
                                                        loc: name_loc,
                                                        ref_: Some(new_ref),
                                                    },
                                                    needs_decl: true,
                                                },
                                            )
                                            .expect("unreachable");
                                        if p.commonjs_named_exports_needs_conversion == u32::MAX {
                                            p.commonjs_named_exports_needs_conversion =
                                                (p.commonjs_named_exports.count() - 1) as u32;
                                        }
                                        new_ref
                                    };

                                    p.record_usage(ref_);

                                    return Some(p.new_expr(
                                        // Record this as from module.exports
                                        E::CommonJSExportIdentifier::new(
                                            ref_,
                                            E::CommonJSExportIdentifierBase::ModuleDotExports,
                                        ),
                                        name_loc,
                                    ));
                                } else if p.options.features.commonjs_at_runtime
                                    && identifier_opts.assign_target() != js_ast::AssignTarget::None
                                {
                                    p.has_commonjs_export_names = true;
                                }
                            }
                        }
                    }
                    E::Special::HotEnabled | E::Special::HotDisabled => {
                        let enabled = p.options.features.hot_module_reloading;
                        if name == b"data" {
                            return Some(if enabled {
                                Expr {
                                    data: js_ast::ExprData::ESpecial(E::Special::HotData),
                                    loc,
                                }
                            } else {
                                Expr::init(E::Object::default(), loc)
                            });
                        }
                        if name == b"accept" {
                            if !enabled {
                                p.method_call_must_be_replaced_with_undefined = true;
                                return Some(Expr {
                                    data: js_ast::ExprData::EUndefined(E::Undefined),
                                    loc,
                                });
                            }
                            return Some(Expr {
                                data: js_ast::ExprData::ESpecial(E::Special::HotAccept),
                                loc,
                            });
                        }
                        // Zig: `bun.ComptimeStringMap(void, ...)` over 7 fixed keys.
                        let in_lookup_table = matches!(
                            name,
                            b"decline"
                                | b"dispose"
                                | b"prune"
                                | b"invalidate"
                                | b"on"
                                | b"off"
                                | b"send"
                        );
                        if in_lookup_table {
                            if enabled {
                                return Some(Expr::init(
                                    E::Dot {
                                        target: Expr::init_identifier(p.hmr_api_ref, target.loc),
                                        name: name_static.into(),
                                        name_loc,
                                        ..Default::default()
                                    },
                                    loc,
                                ));
                            } else {
                                p.method_call_must_be_replaced_with_undefined = true;
                                return Some(Expr {
                                    data: js_ast::ExprData::EUndefined(E::Undefined),
                                    loc,
                                });
                            }
                        } else {
                            // This error is a bit out of place since the HMR
                            // API is validated in the parser instead of at
                            // runtime. When the API is not validated in this
                            // way, the developer may unintentionally read or
                            // write internal fields of HMRModule.
                            p.log().add_error_fmt(
                                Some(p.source),
                                loc,
                                format_args!(
                                    "import.meta.hot.{} does not exist",
                                    bstr::BStr::new(name)
                                ),
                            );
                            return Some(Expr {
                                data: js_ast::ExprData::EUndefined(E::Undefined),
                                loc,
                            });
                        }
                    }
                    _ => {}
                },
                _ => {}
            }
            break 'sw;
        }

        None
    }

    fn maybe_rewrite_property_access_for_namespace(
        &mut self,
        name: &'a [u8],
        target: &Expr,
        loc: bun_ast::Loc,
        name_loc: bun_ast::Loc,
    ) -> Option<Expr> {
        let p = self;
        let map: &js_ast::TSNamespaceMemberMap = &p.ts_namespace.map.unwrap();
        if let Some(value) = map.get(name) {
            match value.data {
                js_ast::ts::Data::EnumNumber(num) => {
                    p.ignore_usage_of_identifier_in_dot_chain(*target);
                    return Some(p.wrap_inlined_enum(
                        Expr {
                            loc,
                            data: js_ast::ExprData::ENumber(E::Number { value: num }),
                        },
                        name,
                    ));
                }

                js_ast::ts::Data::EnumString(str_ptr) => {
                    p.ignore_usage_of_identifier_in_dot_chain(*target);
                    let value = p.new_expr(&*str_ptr, loc);
                    return Some(p.wrap_inlined_enum(value, name));
                }

                js_ast::ts::Data::Namespace(namespace) => {
                    // If this isn't a constant, return a clone of this property access
                    // but with the namespace member data associated with it so that
                    // more property accesses off of this property access are recognized.
                    let name_static = E::Str::new(name);
                    let expr = if js_lexer::is_identifier(name) {
                        p.new_expr(
                            E::Dot {
                                target: *target,
                                name: name_static.into(),
                                name_loc,
                                ..Default::default()
                            },
                            loc,
                        )
                    } else {
                        p.new_expr(
                            E::Dot {
                                target: *target,
                                name: name_static.into(),
                                name_loc,
                                ..Default::default()
                            },
                            loc,
                        )
                    };

                    p.ts_namespace = crate::p::RecentlyVisitedTSNamespace {
                        expr: expr.data,
                        map: Some(namespace),
                    };

                    return Some(expr);
                }

                _ => {}
            }
        }

        None
    }

    pub fn check_if_defined_helper(&mut self, expr: Expr) -> Result<Expr, bun_core::Error> {
        let p = self;
        // TODO(port): narrow error set
        let flags = if matches!(expr.data, js_ast::ExprData::EIdentifier(_)) {
            E::UnaryFlags::WAS_ORIGINALLY_TYPEOF_IDENTIFIER
        } else {
            E::UnaryFlags::empty()
        };
        let left = p.new_expr(
            E::Unary {
                op: js_ast::OpCode::UnTypeof,
                value: expr,
                flags,
            },
            bun_ast::Loc::EMPTY,
        );
        let right = p.new_expr(E::EString::from_static(b"undefined"), bun_ast::Loc::EMPTY);
        Ok(p.new_expr(
            E::Binary {
                op: js_ast::OpCode::BinStrictEq,
                left,
                right,
            },
            bun_ast::Loc::EMPTY,
        ))
    }

    pub fn maybe_defined_helper(&mut self, identifier_expr: Expr) -> Result<Expr, bun_core::Error> {
        let p = self;
        // TODO(port): narrow error set
        let test_ = Self::check_if_defined_helper(p, identifier_expr)?;
        let object_ref = p
            .find_symbol(bun_ast::Loc::EMPTY, b"Object")
            .expect("unreachable")
            .r#ref;
        let yes = p.new_expr(E::Identifier::init(object_ref), bun_ast::Loc::EMPTY);
        Ok(p.new_expr(
            E::If {
                test_,
                yes,
                no: identifier_expr,
            },
            bun_ast::Loc::EMPTY,
        ))
    }

    pub fn maybe_comma_spread_error(&mut self, comma_after_spread: Option<bun_ast::Loc>) {
        let p = self;
        let Some(comma_after_spread) = comma_after_spread else {
            return;
        };
        if comma_after_spread.start == -1 {
            return;
        }

        p.log().add_range_error(
            Some(p.source),
            bun_ast::Range {
                loc: comma_after_spread,
                len: 1,
            },
            b"Unexpected \",\" after rest pattern",
        );
    }
}

// ported from: src/js_parser/ast/maybe.zig
