use core::marker::PhantomData;
use std::io::Write as _;

use bun_core::FeatureFlags;
use bun_core::fmt as bun_fmt;
use bun_logger as logger;
use bun_str::strings;

use bun_js_parser::ast::{self as js_ast, B, Binding, E, Expr, Flags, G, LocRef, S, Stmt};
use bun_js_parser::ast::G::{Decl, Property};
use bun_js_parser::lexer as js_lexer;
use bun_js_parser::{
    self as js_parser, IdentifierOpts, JSXTransformType, NewParser_, RelocateVars, SideEffects,
};

// MOVE_DOWN: was bun_jsc::URL → bun_url (T2)
use bun_url::URL as JscURL;

/// Type alias mirroring `const P = js_parser.NewParser_(ts, jsx, scan_only);`
type P<const TYPESCRIPT: bool, const JSX: JSXTransformType, const SCAN_ONLY: bool> =
    NewParser_<TYPESCRIPT, JSX, SCAN_ONLY>;

pub struct AstMaybe<
    const PARSER_FEATURE__TYPESCRIPT: bool,
    const PARSER_FEATURE__JSX: JSXTransformType,
    const PARSER_FEATURE__SCAN_ONLY: bool,
>(PhantomData<()>);

impl<
        const PARSER_FEATURE__TYPESCRIPT: bool,
        const PARSER_FEATURE__JSX: JSXTransformType,
        const PARSER_FEATURE__SCAN_ONLY: bool,
    > AstMaybe<PARSER_FEATURE__TYPESCRIPT, PARSER_FEATURE__JSX, PARSER_FEATURE__SCAN_ONLY>
{
    pub fn maybe_relocate_vars_to_top_level(
        p: &mut P<PARSER_FEATURE__TYPESCRIPT, PARSER_FEATURE__JSX, PARSER_FEATURE__SCAN_ONLY>,
        decls: &[G::Decl],
        mode: RelocateVars::Mode,
    ) -> RelocateVars {
        // Only do this when the scope is not already top-level and when we're not inside a function.
        if p.current_scope == p.module_scope {
            return RelocateVars { ok: false, ..Default::default() };
        }

        let mut scope = p.current_scope;
        while !scope.kind_stops_hoisting() {
            if cfg!(debug_assertions) {
                debug_assert!(scope.parent.is_some());
            }
            scope = scope.parent.unwrap();
        }

        if scope != p.module_scope {
            return RelocateVars { ok: false, ..Default::default() };
        }

        let mut value: Expr = Expr {
            loc: logger::Loc::EMPTY,
            data: Expr::Data::EMissing(E::Missing {}),
        };

        for decl in decls {
            let binding = Binding::to_expr(&decl.binding, p.to_expr_wrapper_hoisted);
            if let Some(decl_value) = decl.value {
                value = value.join_with_comma(Expr::assign(binding, decl_value), p.allocator);
            } else if mode == RelocateVars::Mode::ForInOrForOf {
                value = value.join_with_comma(binding, p.allocator);
            }
        }

        if matches!(value.data, Expr::Data::EMissing(_)) {
            return RelocateVars { ok: true, ..Default::default() };
        }

        RelocateVars {
            stmt: p.s(S::SExpr { value }, value.loc),
            ok: true,
        }
    }

    // EDot nodes represent a property access. This function may return an
    // expression to replace the property access with. It assumes that the
    // target of the EDot expression has already been visited.
    pub fn maybe_rewrite_property_access(
        p: &mut P<PARSER_FEATURE__TYPESCRIPT, PARSER_FEATURE__JSX, PARSER_FEATURE__SCAN_ONLY>,
        loc: logger::Loc,
        target: js_ast::Expr,
        name: &[u8],
        name_loc: logger::Loc,
        identifier_opts: IdentifierOpts,
    ) -> Option<Expr> {
        // Zig labeled switch with `continue :sw` → loop + match with mutable scrutinee.
        let mut sw_data = target.data;
        'sw: loop {
            match sw_data {
                Expr::Data::EIdentifier(id) => {
                    // Rewrite property accesses on explicit namespace imports as an identifier.
                    // This lets us replace them easily in the printer to rebind them to
                    // something else without paying the cost of a whole-tree traversal during
                    // module linking just to rewrite these EDot expressions.
                    if p.options.bundle {
                        if let Some(import_items) = p.import_items_for_namespace.get_mut(&id.ref_) {
                            let ref_ = 'brk: {
                                if let Some(existing) = import_items.get(name) {
                                    break 'brk existing;
                                }
                                // Generate a new import item symbol in the module scope
                                let new_item = LocRef {
                                    loc: name_loc,
                                    ref_: Some(p.new_symbol(Symbol::Kind::Import, name).expect("unreachable")),
                                };
                                p.module_scope.generated.push(new_item.ref_.unwrap());

                                import_items.put(name, new_item).expect("unreachable");
                                p.is_import_item.put(new_item.ref_.unwrap(), ()).expect("unreachable");

                                let symbol = &mut p.symbols.as_mut_slice()[new_item.ref_.unwrap().inner_index()];

                                // Mark this as generated in case it's missing. We don't want to
                                // generate errors for missing import items that are automatically
                                // generated.
                                symbol.import_item_status = Symbol::ImportItemStatus::Generated;

                                new_item
                            }
                            .ref_
                            .unwrap();

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

                            return Some(p.handle_identifier(
                                name_loc,
                                E::Identifier { ref_ },
                                name,
                                IdentifierOpts {
                                    assign_target: identifier_opts.assign_target,
                                    is_call_target: identifier_opts.is_call_target,
                                    is_delete_target: identifier_opts.is_delete_target,

                                    // If this expression is used as the target of a call expression, make
                                    // sure the value of "this" is preserved.
                                    was_originally_identifier: false,
                                    ..Default::default()
                                },
                            ));
                        }
                    }

                    if !p.is_control_flow_dead && id.ref_.eql(p.module_ref) {
                        // Rewrite "module.require()" to "require()" for Webpack compatibility.
                        // See https://github.com/webpack/webpack/pull/7750 for more info.
                        // This also makes correctness a little easier.
                        if identifier_opts.is_call_target && name == b"require" {
                            p.ignore_usage(p.module_ref);
                            return Some(p.value_for_require(name_loc));
                        } else if !p.commonjs_named_exports_deoptimized && name == b"exports" {
                            if identifier_opts.assign_target != js_ast::AssignTarget::None {
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
                            if !(identifier_opts.is_call_target || identifier_opts.is_delete_target)
                                && identifier_opts.assign_target == js_ast::AssignTarget::Replace
                                && matches!(p.stmt_expr_value, Expr::Data::EBinary(_))
                                && p.stmt_expr_value.e_binary().op == js_ast::Op::BinAssign
                            {
                                if
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
                                    || !matches!(p.stmt_expr_value.e_binary().right.data, Expr::Data::EObject(_))
                                    || !matches!(p.stmt_expr_value.e_binary().left.data, Expr::Data::EDot(_))
                                    || p.stmt_expr_value.e_binary().left.data.e_dot().name != b"exports"
                                    || !matches!(
                                        p.stmt_expr_value.e_binary().left.data.e_dot().target.data,
                                        Expr::Data::EIdentifier(_)
                                    )
                                    || !p
                                        .stmt_expr_value
                                        .e_binary()
                                        .left
                                        .data
                                        .e_dot()
                                        .target
                                        .data
                                        .e_identifier()
                                        .ref_
                                        .eql(p.module_ref)
                                {
                                    p.deoptimize_common_js_named_exports();
                                    return None;
                                }

                                let props: &[G::Property] =
                                    p.stmt_expr_value.e_binary().right.data.e_object().properties.slice();
                                for prop in props {
                                    // if it's not a trivial object literal, de-opt
                                    if prop.kind != Property::Kind::Normal
                                        || prop.key.is_none()
                                        || !matches!(prop.key.unwrap().data, Expr::Data::EString(_))
                                        || prop.flags.contains(Flags::Property::IsMethod)
                                        || prop.flags.contains(Flags::Property::IsComputed)
                                        || prop.flags.contains(Flags::Property::IsSpread)
                                        || prop.flags.contains(Flags::Property::IsStatic)
                                        // If it creates a new scope, we can't do this optimization right now
                                        // Our scope order verification stuff will get mad
                                        // But we should let you do module.exports = { bar: foo(), baz: 123 }
                                        // just not module.exports = { bar: function() {}  }
                                        // just not module.exports = { bar() {}  }
                                        || match prop.value.unwrap().data {
                                            Expr::Data::ECommonJSExportIdentifier(_)
                                            | Expr::Data::EImportIdentifier(_)
                                            | Expr::Data::EIdentifier(_) => false,
                                            Expr::Data::ECall(call) => match call.target.data {
                                                Expr::Data::ECommonJSExportIdentifier(_)
                                                | Expr::Data::EImportIdentifier(_)
                                                | Expr::Data::EIdentifier(_) => false,
                                                call_target => !Expr::Tag::from(call_target).is_primitive_literal(),
                                            },
                                            _ => !prop.value.unwrap().is_primitive_literal(),
                                        }
                                    {
                                        p.deoptimize_common_js_named_exports();
                                        return None;
                                    }
                                }
                                // TODO(port): Zig `for ... else` — else runs on normal loop completion
                                // (no break). Original has no break, so the else (deopt+return) would
                                // run unconditionally after the loop, making subsequent code dead.
                                // Comment says "empty object de-opts", so porting as empty-check per
                                // apparent intent. Verify against Zig semantics in Phase B.
                                if props.is_empty() {
                                    // empty object de-opts because otherwise the statement becomes
                                    // <empty space> = {};
                                    p.deoptimize_common_js_named_exports();
                                    return None;
                                }

                                let mut stmts = bumpalo::collections::Vec::with_capacity_in(
                                    props.len() * 2,
                                    p.allocator,
                                );
                                // PERF(port): arena bulk-alloc — profile in Phase B
                                let mut decls: &mut [Decl] =
                                    p.allocator.alloc_slice_fill_default(props.len());
                                let mut clause_items: &mut [js_ast::ClauseItem] =
                                    p.allocator.alloc_slice_fill_default(props.len());

                                for prop in props {
                                    let key = prop.key.unwrap().data.e_string().string(p.allocator).expect("unreachable");
                                    let visited_value = p.visit_expr(prop.value.unwrap());
                                    let value = SideEffects::simplify_unused_expr(p, visited_value)
                                        .unwrap_or(visited_value);

                                    // We are doing `module.exports = { ... }`
                                    // lets rewrite it to a series of what will become export assignments
                                    let named_export_entry =
                                        p.commonjs_named_exports.get_or_put(key).expect("unreachable");
                                    if !named_export_entry.found_existing {
                                        let new_ref = p
                                            .new_symbol(Symbol::Kind::Other, {
                                                let mut v = bumpalo::collections::Vec::new_in(p.allocator);
                                                write!(&mut v, "${}", bun_fmt::fmt_identifier(key)).expect("unreachable");
                                                v.into_bump_slice()
                                            })
                                            .expect("unreachable");
                                        p.module_scope.generated.push(new_ref);
                                        *named_export_entry.value_ptr = js_parser::CommonJSNamedExport {
                                            loc_ref: LocRef {
                                                loc: name_loc,
                                                ref_: Some(new_ref),
                                            },
                                            needs_decl: false,
                                        };
                                    }
                                    let ref_ = named_export_entry.value_ptr.loc_ref.ref_.unwrap();
                                    // module.exports = {
                                    //   foo: "bar",
                                    //   baz: "qux",
                                    // }
                                    // ->
                                    // exports.foo = "bar", exports.baz = "qux"
                                    // Which will become
                                    // $foo = "bar";
                                    // $baz = "qux";
                                    // export { $foo as foo, $baz as baz }

                                    decls[0] = Decl {
                                        binding: p.b(B::Identifier { ref_ }, prop.key.unwrap().loc),
                                        value: Some(value),
                                    };
                                    // we have to ensure these are known to be top-level
                                    p.declared_symbols
                                        .push(js_ast::DeclaredSymbol {
                                            ref_,
                                            is_top_level: true,
                                        });
                                    p.had_commonjs_named_exports_this_visit = true;
                                    clause_items[0] = js_ast::ClauseItem {
                                        // We want the generated name to not conflict
                                        alias: key,
                                        alias_loc: prop.key.unwrap().loc,
                                        name: named_export_entry.value_ptr.loc_ref,
                                        ..Default::default()
                                    };

                                    stmts.extend_from_slice(&[
                                        p.s(
                                            S::Local {
                                                kind: S::Local::Kind::KVar,
                                                is_export: false,
                                                was_commonjs_export: true,
                                                decls: G::Decl::List::init(&decls[0..1]),
                                                ..Default::default()
                                            },
                                            prop.key.unwrap().loc,
                                        ),
                                        p.s(
                                            S::ExportClause {
                                                items: &clause_items[0..1],
                                                is_single_line: true,
                                                ..Default::default()
                                            },
                                            prop.key.unwrap().loc,
                                        ),
                                    ]);
                                    // PORT NOTE: reshaped for borrowck — Zig reslices `decls = decls[1..]`
                                    decls = &mut decls[1..];
                                    clause_items = &mut clause_items[1..];
                                }

                                p.ignore_usage(p.module_ref);
                                p.commonjs_replacement_stmts = stmts.into_bump_slice();
                                return Some(p.new_expr(E::Missing {}, name_loc));
                            }

                            // Deoptimizations:
                            //      delete module.exports
                            //      module.exports();
                            if identifier_opts.is_call_target
                                || identifier_opts.is_delete_target
                                || identifier_opts.assign_target != js_ast::AssignTarget::None
                            {
                                p.deoptimize_common_js_named_exports();
                                return None;
                            }

                            // rewrite `module.exports` to `exports`
                            return Some(Expr {
                                data: Expr::Data::ESpecial(E::Special::ModuleExports),
                                loc: name_loc,
                            });
                        } else if p.options.bundle
                            && name == b"id"
                            && identifier_opts.assign_target == js_ast::AssignTarget::None
                        {
                            // inline module.id
                            p.ignore_usage(p.module_ref);
                            return Some(p.new_expr(E::String::init(p.source.path.pretty), name_loc));
                        } else if p.options.bundle
                            && name == b"filename"
                            && identifier_opts.assign_target == js_ast::AssignTarget::None
                        {
                            // inline module.filename
                            p.ignore_usage(p.module_ref);
                            return Some(p.new_expr(E::String::init(p.source.path.name.filename), name_loc));
                        } else if p.options.bundle
                            && name == b"path"
                            && identifier_opts.assign_target == js_ast::AssignTarget::None
                        {
                            // inline module.path
                            p.ignore_usage(p.module_ref);
                            return Some(p.new_expr(E::String::init(p.source.path.pretty), name_loc));
                        }
                    }

                    if p.should_unwrap_common_js_to_esm() {
                        if !p.is_control_flow_dead && id.ref_.eql(p.exports_ref) {
                            if !p.commonjs_named_exports_deoptimized {
                                if identifier_opts.is_delete_target {
                                    p.deoptimize_common_js_named_exports();
                                    return None;
                                }

                                let named_export_entry =
                                    p.commonjs_named_exports.get_or_put(name).expect("unreachable");
                                if !named_export_entry.found_existing {
                                    let new_ref = p
                                        .new_symbol(Symbol::Kind::Other, {
                                            let mut v = bumpalo::collections::Vec::new_in(p.allocator);
                                            write!(&mut v, "${}", bun_fmt::fmt_identifier(name)).expect("unreachable");
                                            v.into_bump_slice()
                                        })
                                        .expect("unreachable");
                                    p.module_scope.generated.push(new_ref);
                                    *named_export_entry.value_ptr = js_parser::CommonJSNamedExport {
                                        loc_ref: LocRef {
                                            loc: name_loc,
                                            ref_: Some(new_ref),
                                        },
                                        needs_decl: true,
                                    };
                                    if p.commonjs_named_exports_needs_conversion == u32::MAX {
                                        p.commonjs_named_exports_needs_conversion =
                                            (p.commonjs_named_exports.count() - 1) as u32;
                                    }
                                }

                                let ref_ = named_export_entry.value_ptr.loc_ref.ref_.unwrap();
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
                                && identifier_opts.assign_target != js_ast::AssignTarget::None
                            {
                                p.has_commonjs_export_names = true;
                            }
                        }
                    }

                    // Handle references to namespaces or namespace members
                    if matches!(p.ts_namespace.expr, Expr::Data::EIdentifier(_))
                        && id.ref_.eql(p.ts_namespace.expr.e_identifier().ref_)
                        && identifier_opts.assign_target == js_ast::AssignTarget::None
                        && !identifier_opts.is_delete_target
                    {
                        return Self::maybe_rewrite_property_access_for_namespace(
                            p, name, &target, loc, name_loc,
                        );
                    }
                }
                Expr::Data::EString(str_) => {
                    if p.options.features.minify_syntax {
                        // minify "long-string".length to 11
                        if name == b"length" {
                            if let Some(len) = str_.javascript_length() {
                                return Some(p.new_expr(E::Number { value: len as f64 }, loc));
                            }
                        }
                    }
                }
                Expr::Data::EInlinedEnum(ie) => {
                    sw_data = ie.value.data;
                    continue 'sw;
                }
                Expr::Data::EObject(obj) => {
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
                            if obj.properties.len == 1
                                && !identifier_opts.is_delete_target
                                && identifier_opts.assign_target == js_ast::AssignTarget::None
                                && !identifier_opts.is_call_target
                            {
                                let prop: G::Property = obj.properties.ptr[0];
                                if prop.value.is_some()
                                    && prop.flags.count() == 0
                                    && prop.key.is_some()
                                    && matches!(prop.key.unwrap().data, Expr::Data::EString(_))
                                    && prop.key.unwrap().data.e_string().eql_bytes(name)
                                    && name != b"__proto__"
                                {
                                    return Some(prop.value.unwrap());
                                }
                            }
                        }
                    }
                }
                Expr::Data::EImportMeta => {
                    if name == b"main" {
                        return Some(p.value_for_import_meta_main(false, target.loc));
                    }

                    if name == b"hot" {
                        return Some(Expr {
                            data: Expr::Data::ESpecial(if p.options.features.hot_module_reloading {
                                E::Special::HotEnabled
                            } else {
                                E::Special::HotDisabled
                            }),
                            loc,
                        });
                    }

                    // Inline import.meta properties for Bake
                    if p.options.framework.is_some()
                        || (p.options.bundle && p.options.output_format == js_parser::options::OutputFormat::Cjs)
                    {
                        if name == b"dir" || name == b"dirname" {
                            // Inline import.meta.dir
                            return Some(p.new_expr(E::String::init(p.source.path.name.dir), name_loc));
                        } else if name == b"file" {
                            // Inline import.meta.file (filename only)
                            return Some(p.new_expr(E::String::init(p.source.path.name.filename), name_loc));
                        } else if name == b"path" {
                            // Inline import.meta.path (full path)
                            return Some(p.new_expr(E::String::init(p.source.path.text), name_loc));
                        } else if name == b"url" {
                            // Inline import.meta.url as file:// URL
                            let bunstr = bun_str::String::from_bytes(p.source.path.text);
                            // `defer bunstr.deref()` — handled by Drop on bun_str::String
                            let url = {
                                let mut v = bumpalo::collections::Vec::new_in(p.allocator);
                                write!(&mut v, "{}", JscURL::file_url_from_string(&bunstr)).expect("unreachable");
                                v.into_bump_slice()
                            };
                            drop(bunstr);
                            return Some(p.new_expr(E::String::init(url), name_loc));
                        }
                    }

                    // Make all property accesses on `import.meta.url` side effect free.
                    return Some(p.new_expr(
                        E::Dot {
                            target,
                            name,
                            name_loc,
                            can_be_removed_if_unused: true,
                            ..Default::default()
                        },
                        target.loc,
                    ));
                }
                Expr::Data::ERequireCallTarget => {
                    if name == b"main" {
                        return Some(Expr { loc, data: Expr::Data::ERequireMain });
                    }
                }
                Expr::Data::EImportIdentifier(id) => {
                    // Symbol uses due to a property access off of an imported symbol are tracked
                    // specially. This lets us do tree shaking for cross-file TypeScript enums.
                    if p.options.bundle && !p.is_control_flow_dead {
                        let use_ = p.symbol_uses.get_mut(&id.ref_).unwrap();
                        use_.count_estimate = use_.count_estimate.saturating_sub(1);
                        // note: this use is not removed as we assume it exists later

                        // Add a special symbol use instead
                        let gop = p
                            .import_symbol_property_uses
                            .get_or_put_value(id.ref_, Default::default());
                        let inner_use = gop.value_ptr.get_or_put_value(name, Default::default());
                        inner_use.value_ptr.count_estimate += 1;
                    }
                }
                // Zig: `inline .e_dot, .e_index => |data, tag|` — expanded per arm
                Expr::Data::EDot(data) => {
                    if matches!(p.ts_namespace.expr, Expr::Data::EDot(ns_data) if core::ptr::eq(data, ns_data))
                        && identifier_opts.assign_target == js_ast::AssignTarget::None
                        && !identifier_opts.is_delete_target
                    {
                        return Self::maybe_rewrite_property_access_for_namespace(
                            p, name, &target, loc, name_loc,
                        );
                    }
                }
                Expr::Data::EIndex(data) => {
                    if matches!(p.ts_namespace.expr, Expr::Data::EIndex(ns_data) if core::ptr::eq(data, ns_data))
                        && identifier_opts.assign_target == js_ast::AssignTarget::None
                        && !identifier_opts.is_delete_target
                    {
                        return Self::maybe_rewrite_property_access_for_namespace(
                            p, name, &target, loc, name_loc,
                        );
                    }
                }
                Expr::Data::ESpecial(special) => match special {
                    E::Special::ModuleExports => {
                        if p.should_unwrap_common_js_to_esm() {
                            if !p.is_control_flow_dead {
                                if !p.commonjs_named_exports_deoptimized {
                                    if identifier_opts.is_delete_target {
                                        p.deoptimize_common_js_named_exports();
                                        return None;
                                    }

                                    let named_export_entry =
                                        p.commonjs_named_exports.get_or_put(name).expect("unreachable");
                                    if !named_export_entry.found_existing {
                                        let new_ref = p
                                            .new_symbol(Symbol::Kind::Other, {
                                                let mut v = bumpalo::collections::Vec::new_in(p.allocator);
                                                write!(&mut v, "${}", bun_fmt::fmt_identifier(name)).expect("unreachable");
                                                v.into_bump_slice()
                                            })
                                            .expect("unreachable");
                                        p.module_scope.generated.push(new_ref);
                                        *named_export_entry.value_ptr = js_parser::CommonJSNamedExport {
                                            loc_ref: LocRef {
                                                loc: name_loc,
                                                ref_: Some(new_ref),
                                            },
                                            needs_decl: true,
                                        };
                                        if p.commonjs_named_exports_needs_conversion == u32::MAX {
                                            p.commonjs_named_exports_needs_conversion =
                                                (p.commonjs_named_exports.count() - 1) as u32;
                                        }
                                    }

                                    let ref_ = named_export_entry.value_ptr.loc_ref.ref_.unwrap();
                                    p.record_usage(ref_);

                                    return Some(p.new_expr(
                                        E::CommonJSExportIdentifier {
                                            ref_,
                                            // Record this as from module.exports
                                            base: E::CommonJSExportIdentifier::Base::ModuleDotExports,
                                        },
                                        name_loc,
                                    ));
                                } else if p.options.features.commonjs_at_runtime
                                    && identifier_opts.assign_target != js_ast::AssignTarget::None
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
                                Expr { data: Expr::Data::ESpecial(E::Special::HotData), loc }
                            } else {
                                Expr::init(E::Object::default(), loc)
                            });
                        }
                        if name == b"accept" {
                            if !enabled {
                                p.method_call_must_be_replaced_with_undefined = true;
                                return Some(Expr { data: Expr::Data::EUndefined, loc });
                            }
                            return Some(Expr {
                                data: Expr::Data::ESpecial(E::Special::HotAccept),
                                loc,
                            });
                        }
                        static LOOKUP_TABLE: phf::Set<&'static [u8]> = phf::phf_set! {
                            b"decline",
                            b"dispose",
                            b"prune",
                            b"invalidate",
                            b"on",
                            b"off",
                            b"send",
                        };
                        if LOOKUP_TABLE.contains(name) {
                            if enabled {
                                return Some(Expr::init(
                                    E::Dot {
                                        target: Expr::init_identifier(p.hmr_api_ref, target.loc),
                                        name,
                                        name_loc,
                                        ..Default::default()
                                    },
                                    loc,
                                ));
                            } else {
                                p.method_call_must_be_replaced_with_undefined = true;
                                return Some(Expr { data: Expr::Data::EUndefined, loc });
                            }
                        } else {
                            // This error is a bit out of place since the HMR
                            // API is validated in the parser instead of at
                            // runtime. When the API is not validated in this
                            // way, the developer may unintentionally read or
                            // write internal fields of HMRModule.
                            let msg = {
                                let mut v = bumpalo::collections::Vec::new_in(p.allocator);
                                write!(&mut v, "import.meta.hot.{} does not exist", bstr::BStr::new(name))
                                    .expect("unreachable");
                                v.into_bump_slice()
                            };
                            p.log.add_error(p.source, loc, msg);
                            return Some(Expr { data: Expr::Data::EUndefined, loc });
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
        p: &mut P<PARSER_FEATURE__TYPESCRIPT, PARSER_FEATURE__JSX, PARSER_FEATURE__SCAN_ONLY>,
        name: &[u8],
        target: &Expr,
        loc: logger::Loc,
        name_loc: logger::Loc,
    ) -> Option<Expr> {
        if let Some(value) = p.ts_namespace.map.unwrap().get(name) {
            match value.data {
                js_ast::TSNamespaceMemberData::EnumNumber(num) => {
                    p.ignore_usage_of_identifier_in_dot_chain(*target);
                    return Some(p.wrap_inlined_enum(
                        Expr {
                            loc,
                            data: Expr::Data::ENumber(E::Number { value: num }),
                        },
                        name,
                    ));
                }

                js_ast::TSNamespaceMemberData::EnumString(str_) => {
                    p.ignore_usage_of_identifier_in_dot_chain(*target);
                    return Some(p.wrap_inlined_enum(
                        Expr {
                            loc,
                            data: Expr::Data::EString(str_),
                        },
                        name,
                    ));
                }

                js_ast::TSNamespaceMemberData::Namespace(namespace) => {
                    // If this isn't a constant, return a clone of this property access
                    // but with the namespace member data associated with it so that
                    // more property accesses off of this property access are recognized.
                    let expr = if js_lexer::is_identifier(name) {
                        p.new_expr(
                            E::Dot {
                                target: *target,
                                name,
                                name_loc,
                                ..Default::default()
                            },
                            loc,
                        )
                    } else {
                        p.new_expr(
                            E::Dot {
                                target: *target,
                                name,
                                name_loc,
                                ..Default::default()
                            },
                            loc,
                        )
                    };

                    p.ts_namespace = js_parser::TSNamespace {
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

    pub fn check_if_defined_helper(
        p: &mut P<PARSER_FEATURE__TYPESCRIPT, PARSER_FEATURE__JSX, PARSER_FEATURE__SCAN_ONLY>,
        expr: Expr,
    ) -> Result<Expr, bun_core::Error> {
        // TODO(port): narrow error set
        Ok(p.new_expr(
            E::Binary {
                op: js_ast::Op::BinStrictEq,
                left: p.new_expr(
                    E::Unary {
                        op: js_ast::Op::UnTypeof,
                        value: expr,
                        flags: E::Unary::Flags {
                            was_originally_typeof_identifier: matches!(expr.data, Expr::Data::EIdentifier(_)),
                            ..Default::default()
                        },
                    },
                    logger::Loc::EMPTY,
                ),
                right: p.new_expr(
                    E::String { data: b"undefined", ..Default::default() },
                    logger::Loc::EMPTY,
                ),
            },
            logger::Loc::EMPTY,
        ))
    }

    pub fn maybe_defined_helper(
        p: &mut P<PARSER_FEATURE__TYPESCRIPT, PARSER_FEATURE__JSX, PARSER_FEATURE__SCAN_ONLY>,
        identifier_expr: Expr,
    ) -> Result<Expr, bun_core::Error> {
        // TODO(port): narrow error set
        Ok(p.new_expr(
            E::If {
                test_: Self::check_if_defined_helper(p, identifier_expr)?,
                yes: p.new_expr(
                    E::Identifier {
                        ref_: p.find_symbol(logger::Loc::EMPTY, b"Object").expect("unreachable").ref_,
                    },
                    logger::Loc::EMPTY,
                ),
                no: identifier_expr,
            },
            logger::Loc::EMPTY,
        ))
    }

    pub fn maybe_comma_spread_error(
        p: &mut P<PARSER_FEATURE__TYPESCRIPT, PARSER_FEATURE__JSX, PARSER_FEATURE__SCAN_ONLY>,
        _comma_after_spread: Option<logger::Loc>,
    ) {
        let Some(comma_after_spread) = _comma_after_spread else { return };
        if comma_after_spread.start == -1 {
            return;
        }

        p.log
            .add_range_error(
                p.source,
                logger::Range { loc: comma_after_spread, len: 1 },
                b"Unexpected \",\" after rest pattern",
            )
            .expect("unreachable");
    }
}

use bun_js_parser::ast::Symbol;

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/js_parser/ast/maybe.zig (728 lines)
//   confidence: medium
//   todos:      4
//   notes:      for-else semantics ambiguous (line ~248); Expr::Data variant accessors (.e_binary()/.e_dot()) assumed; jsc::URL dep flagged for *_jsc split
// ──────────────────────────────────────────────────────────────────────────
