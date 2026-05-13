#![allow(
    unused_imports,
    unused_variables,
    dead_code,
    unused_mut,
    unreachable_code
)]
#![warn(unused_must_use)]
use bun_collections::VecExt;
use core::ptr::NonNull;
use std::io::Write as _;

use bstr::BStr;
use bun_core::strings;

use crate::lexer as js_lexer;
use crate::p::P;
use crate::parser::{
    ExprIn, FnOrArrowDataVisit, IdentifierOpts, PrependTempRefsOpts, ReactRefresh, Ref,
    StrictModeFeature, ThenCatchChain, TransposeState, VisitArgsOpts, float_to_int32, prefill,
};
use crate::scan::scan_side_effects::SideEffects;
use bun_alloc::ArenaVecExt as _;
use bun_alloc::ArenaVecExt as _;
use bun_alloc::ArenaVecExt as _;
use bun_alloc::ArenaVecExt as _;
use bun_alloc::ArenaVecExt as _;
use bun_ast as js_ast;
use bun_ast::G::Property;
use bun_ast::flags as Flags;
use bun_ast::{B, E, Expr, ExprNodeIndex, ExprNodeList, G, Scope, Stmt, Symbol};

// Local short-hands so the visitor bodies read close to the Zig
// (`expr.data.e_dot`, `Expr.Data.e_binary`, `Op.Code.un_typeof`) without a
// bulk find-replace at every call-site.
use js_ast::ExprData as Data;
use js_ast::ExprTag as Tag;
use js_ast::OpCode as Op;

// Zig: `pub fn VisitExpr(comptime ts, comptime jsx, comptime scan_only) type { return struct { ... } }`
// — file-split mixin pattern. Round-C lowered `const JSX: JSXTransformType` → `J: JsxT`, so this is
// a direct `impl P` block. The 25+ per-variant `e_*` helpers are private; only `visit_expr` /
// `visit_expr_in_out` are surfaced.

impl<'a, const TYPESCRIPT: bool, const SCAN_ONLY: bool> P<'a, TYPESCRIPT, SCAN_ONLY> {
    // PERF(port:noalias): `e: &mut Expr` is lowered to a `noalias` LLVM param, so reads
    // through `e` can be cached in registers across child recursion. The by-value
    // `Expr -> Expr` shape moved 24B in + 24B out per frame; the in-place form moves 8B
    // and only writes back when the visitor produces a *different* node.
    #[inline]
    pub fn visit_expr(&mut self, e: &mut Expr) {
        // Zig: `if (only_scan_imports_and_do_not_visit) @compileError(...)` — SCAN_ONLY
        // monomorphizations must never reach the visit pass.
        debug_assert!(
            !SCAN_ONLY,
            "only_scan_imports_and_do_not_visit must not run visit_expr",
        );
        self.visit_expr_in_out(e, ExprIn::default())
    }

    pub fn visit_expr_in_out(&mut self, e: &mut Expr, in_: ExprIn) {
        if in_.assign_target != js_ast::AssignTarget::None && !self.is_valid_assignment_target(e) {
            self.log()
                .add_error(Some(self.source), e.loc, b"Invalid assignment target");
        }

        // Zig dispatches via `inline else => |tag| if (comptime @hasDecl(visitors, @tagName(tag)))`.
        // Rust has no struct-decl reflection; expand to an explicit match over the tags that have
        // a visitor defined below. Any tag without a visitor leaves `*e` unchanged.
        use js_ast::ExprTag as Tag;
        match e.data.tag() {
            Tag::ENewTarget => Self::e_new_target(self, e, in_),
            Tag::EString => Self::e_string(self, e, in_),
            Tag::ENumber => Self::e_number(self, e, in_),
            Tag::EThis => Self::e_this(self, e, in_),
            Tag::EImportMeta => Self::e_import_meta(self, e, in_),
            Tag::ESpread => Self::e_spread(self, e, in_),
            Tag::EIdentifier => Self::e_identifier(self, e, in_),
            Tag::EJsxElement => Self::e_jsx_element(self, e, in_),
            Tag::ETemplate => Self::e_template(self, e, in_),
            Tag::EBinary => Self::e_binary(self, e, in_),
            Tag::EIndex => Self::e_index(self, e, in_),
            Tag::EUnary => Self::e_unary(self, e, in_),
            Tag::EDot => Self::e_dot(self, e, in_),
            Tag::EIf => Self::e_if(self, e, in_),
            Tag::EAwait => Self::e_await(self, e, in_),
            Tag::EYield => Self::e_yield(self, e, in_),
            Tag::EArray => Self::e_array(self, e, in_),
            Tag::EObject => Self::e_object(self, e, in_),
            Tag::EImport => Self::e_import(self, e, in_),
            Tag::ECall => Self::e_call(self, e, in_),
            Tag::ENew => Self::e_new(self, e, in_),
            Tag::EArrow => Self::e_arrow(self, e, in_),
            Tag::EFunction => Self::e_function(self, e, in_),
            Tag::EClass => Self::e_class(self, e, in_),
            _ => {}
        }
    }

    // ─── visitors ───────────────────────────────────────────────────────────
    // In Zig these live on a nested `const visitors = struct { ... }`; in Rust they are private
    // associated fns on this impl so they can see the const-generic feature params.

    fn e_new_target(_: &mut Self, _e: &mut Expr, _: ExprIn) {
        // this error is not necessary and it is causing breakages
        // if (!p.fn_only_data_visit.is_new_target_allowed) {
        //     p.log.addRangeError(p.source, target.range, "Cannot use \"new.target\" here") catch unreachable;
        // }
    }

    fn e_string(_: &mut Self, _e: &mut Expr, _: ExprIn) {
        // If you're using this, you're probably not using 0-prefixed legacy octal notation
        // if e.LegacyOctalLoc.Start > 0 {
    }

    fn e_number(_: &mut Self, _e: &mut Expr, _: ExprIn) {
        // idc about legacy octal loc
    }

    fn e_this(p: &mut Self, e: &mut Expr, _: ExprIn) {
        if let Some(exp) = p.value_for_this(e.loc) {
            *e = exp;
            return;
        }

        //                 // Capture "this" inside arrow functions that will be lowered into normal
        // // function expressions for older language environments
        // if p.fnOrArrowDataVisit.isArrow && p.options.unsupportedJSFeatures.Has(compat.Arrow) && p.fnOnlyDataVisit.isThisNested {
        //     return js_ast.Expr{Loc: expr.Loc, Data: &js_ast.EIdentifier{Ref: p.captureThis()}}, exprOut{}
        // }
    }

    fn e_spread(p: &mut Self, e: &mut Expr, _: ExprIn) {
        if let js_ast::ExprData::ESpread(mut exp) = e.data {
            p.visit_expr(&mut exp.value);
        }
    }

    fn e_await(p: &mut Self, e: &mut Expr, _: ExprIn) {
        if let js_ast::ExprData::EAwait(mut e_) = e.data {
            p.await_target = Some(e_.value.data);
            p.visit_expr(&mut e_.value);
        }
    }

    fn e_yield(p: &mut Self, e: &mut Expr, _: ExprIn) {
        if let js_ast::ExprData::EYield(mut e_) = e.data {
            if let Some(val) = e_.value.as_mut() {
                p.visit_expr(val);
            }
        }
    }

    // ─── heavy visitors ─────────────────────────────────────────────────────
    // e_* accessors on `expr::Data` return Option<StoreRef<T>> / Option<T>.

    fn e_import_meta(p: &mut Self, e: &mut Expr, in_: ExprIn) {
        let expr = *e;
        // TODO: delete import.meta might not work
        let is_delete_target = matches!(p.delete_target, Data::EImportMeta(..));

        // `p.define: &'a Define` is `Copy`; hoist the reference so the
        // `dots.get` borrow is tied to `'a`, not `&*p`, and `&mut self`
        // helpers below can be called while iterating without laundering.
        let defines = p.define;
        if let Some(meta) = defines.dots.get(b"meta".as_slice()) {
            for define in meta.as_slice() {
                if !p.is_dot_define_match(expr, &define.parts) {
                    continue;
                }
                // Substitute user-specified defines
                *e =
                    p.value_for_define(expr.loc, in_.assign_target, is_delete_target, &define.data);
                return;
            }
        }
    }

    fn e_identifier(p: &mut Self, e: &mut Expr, in_: ExprIn) {
        let expr = *e;
        let mut e_ = expr
            .data
            .e_identifier()
            .expect("infallible: variant checked");
        let is_delete_target = matches!(p.delete_target.tag(), Tag::EIdentifier)
            && e_.ref_.eql(
                p.delete_target
                    .e_identifier()
                    .expect("infallible: variant checked")
                    .ref_,
            );

        let name = p.load_name_from_ref(e_.ref_);
        if p.is_strict_mode() && js_lexer::is_strict_mode_reserved_word(name) {
            p.mark_strict_mode_feature(
                StrictModeFeature::ReservedWord,
                js_lexer::range_of_identifier(p.source, expr.loc),
                name,
            )
            .expect("unreachable");
        }

        let result = p.find_symbol(expr.loc, name).expect("unreachable");

        // Order matters: assigning a fresh `Ref` clears the packed user-bit
        // flags (intentional — the parse-time ref carries no flags), so set
        // `ref_` first, then derive the visit-time flags into the user bits.
        e_.ref_ = result.r#ref;
        e_.set_must_keep_due_to_with_stmt(result.is_inside_with_scope);

        // Handle assigning to a constant
        if in_.assign_target != js_ast::AssignTarget::None {
            if p.symbols[result.r#ref.inner_index() as usize].kind == js_ast::symbol::Kind::Constant
            {
                // TODO: silence this for runtime transpiler
                let r = js_lexer::range_of_identifier(p.source, expr.loc);
                let notes: Box<[bun_ast::Data]> = Box::new([bun_ast::Data {
                    text: {
                        let mut v = Vec::new();
                        write!(
                            &mut v,
                            "The symbol \"{}\" was declared a constant here:",
                            BStr::new(name)
                        )
                        .unwrap();
                        std::borrow::Cow::Owned(v)
                    },
                    location: bun_ast::Location::init_or_null(
                        Some(p.source),
                        js_lexer::range_of_identifier(p.source, result.declare_loc.unwrap()),
                    ),
                    ..Default::default()
                }]);

                let is_error = p.const_values.contains_key(&result.r#ref) || p.options.bundle;
                match is_error {
                    true => p.log().add_range_error_fmt_with_notes(
                        Some(p.source),
                        r,
                        notes,
                        format_args!(
                            "Cannot assign to \"{}\" because it is a constant",
                            BStr::new(name)
                        ),
                    ),

                    false => p.log().add_range_error_fmt_with_notes(
                        Some(p.source),
                        r,
                        notes,
                        format_args!(
                            "This assignment will throw because \"{}\" is a constant",
                            BStr::new(name)
                        ),
                    ),
                }
            } else if p.exports_ref.eql(e_.ref_) {
                // Assigning to `exports` in a CommonJS module must be tracked to undo the
                // `module.exports` -> `exports` optimization.
                p.commonjs_module_exports_assigned_deoptimized = true;
            }

            p.symbols[result.r#ref.inner_index() as usize].has_been_assigned_to = true;
        }

        let mut original_name: Option<&[u8]> = None;

        // Substitute user-specified defines for unbound symbols
        if p.symbols[e_.ref_.inner_index() as usize].kind == js_ast::symbol::Kind::Unbound
            && !result.is_inside_with_scope
            && !is_delete_target
        {
            // `p.define: &'a Define` is `Copy`; hoist so the returned
            // `&DefineData` is tied to `'a`, not `&*p`, and `&mut self`
            // helpers (`value_for_define`) below need no lifetime laundering.
            let defines = p.define;
            if let Some(def) = defines.for_identifier(name) {
                if !def.valueless() {
                    let newvalue: Expr =
                        p.value_for_define(expr.loc, in_.assign_target, is_delete_target, def);

                    // Don't substitute an identifier for a non-identifier if this is an
                    // assignment target, since it'll cause a syntax error
                    if matches!(newvalue.data.tag(), Tag::EIdentifier)
                        || in_.assign_target == js_ast::AssignTarget::None
                    {
                        p.ignore_usage(e_.ref_);
                        *e = newvalue;
                        return;
                    }

                    original_name = def.original_name();
                }

                // Copy the side effect flags over in case this expression is unused
                if def.can_be_removed_if_unused() {
                    e_.set_can_be_removed_if_unused(true);
                }
                if def.call_can_be_unwrapped_if_unused() == E::CallUnwrap::IfUnused
                    && !p.options.ignore_dce_annotations
                {
                    e_.set_call_can_be_unwrapped_if_unused(true);
                }

                // If the user passed --drop=console, drop all property accesses to console.
                if def.method_call_must_be_replaced_with_undefined()
                    && in_.property_access_for_method_call_maybe_should_replace_with_undefined
                    && in_.assign_target == js_ast::AssignTarget::None
                {
                    p.method_call_must_be_replaced_with_undefined = true;
                }
            }

            // Substitute uncalled "require" for the require target
            if p.require_ref.eql(e_.ref_) && !p.is_source_runtime() {
                // mark a reference to __require only if this is not about to be used for a call target
                if !(matches!(p.call_target.tag(), Tag::EIdentifier)
                    && expr.data.e_identifier().unwrap().ref_.eql(
                        p.call_target
                            .e_identifier()
                            .expect("infallible: variant checked")
                            .ref_,
                    ))
                    && p.options.features.allow_runtime
                {
                    p.record_usage_of_runtime_require();
                }

                *e = p.value_for_require(expr.loc);
                return;
            }
        }

        *e = p.handle_identifier(
            expr.loc,
            e_,
            original_name,
            IdentifierOpts::default()
                .with_assign_target(in_.assign_target)
                .with_is_delete_target(is_delete_target)
                .with_is_call_target(
                    matches!(p.call_target.tag(), Tag::EIdentifier)
                        && expr.data.e_identifier().unwrap().ref_.eql(
                            p.call_target
                                .e_identifier()
                                .expect("infallible: variant checked")
                                .ref_,
                        ),
                )
                .with_was_originally_identifier(true),
        );
    }
    // PERF(port:frame): keep these large, infrequently-taken arms out of the
    // `visit_expr_in_out` dispatcher frame. Without `inline(never)` LLVM folds the
    // big match arms into the recursive dispatcher, inflating its stack frame to
    // ~968B; deep ASTs then thrash L1d on the spill/reload (the spill into that
    // frame is the #2 hottest bun-native instruction under `bun --bun lint`).
    // Mirrors Zig's switch-with-helper-fns layout.
    #[inline(never)]
    fn e_jsx_element(p: &mut Self, e: &mut Expr, in_: ExprIn) {
        let expr = *e;
        use crate::parser::{JSXImport, JSXTransformType, options};
        let _ = in_;
        let mut e_ = expr
            .data
            .e_jsx_element()
            .expect("infallible: variant checked");
        // Zig: `switch (comptime jsx_transform_type)`; JSX is no longer a
        // type parameter — dispatch on the runtime `P::jsx_transform` field.
        match p.jsx_transform {
            JSXTransformType::React => {
                let tag: Expr = 'tagger: {
                    if let Some(mut _tag) = e_.tag {
                        p.visit_expr(&mut _tag);
                        break 'tagger _tag;
                    }
                    if p.options.jsx.runtime == options::JSX::Runtime::Classic {
                        // PORT NOTE: `jsx_strings_to_member_expression` wants `&[&'a [u8]]`.
                        // In Zig, `options.jsx.fragment: []const string` borrows from the
                        // long-lived `transpiler.options.jsx`, so the strings outlive the
                        // AST. Here, `options.jsx.fragment: Box<[Box<[u8]>]>` is OWNED by
                        // `P` and dropped when `Parser::parse` returns — but the parts are
                        // stored in symbols / `E::Dot.name` and read later by the printer.
                        // Dupe each part into the arena (which backs the AST) to restore
                        // the spec's lifetime invariant. Build the `&[&'a [u8]]` slice
                        // directly in the AST arena instead of a throwaway global-heap
                        // `Vec` — keeps the visitor off the `#[global_allocator]`.
                        let arena = p.arena;
                        let parts: &[&'a [u8]] = arena.alloc_slice_fill_iter(
                            p.options
                                .jsx
                                .fragment
                                .iter()
                                .map(|b| -> &'a [u8] { arena.alloc_slice_copy(b) }),
                        );
                        break 'tagger p
                            .jsx_strings_to_member_expression(expr.loc, parts)
                            .expect("unreachable");
                    }
                    break 'tagger p.jsx_import(JSXImport::Fragment, expr.loc);
                };

                for property in e_.properties.slice_mut() {
                    if property.kind != G::PropertyKind::Spread {
                        p.visit_expr(property.key.as_mut().expect("infallible: prop has key"));
                    }

                    if let Some(v) = property.value.as_mut() {
                        p.visit_expr(v);
                    }

                    if let Some(v) = property.initializer.as_mut() {
                        p.visit_expr(v);
                    }
                }

                let runtime = if p.options.jsx.runtime == options::JSX::Runtime::Automatic {
                    options::JSX::Runtime::Automatic
                } else {
                    options::JSX::Runtime::Classic
                };
                let is_key_after_spread = e_.flags.contains(Flags::JSXElement::IsKeyAfterSpread);
                let children_count = e_.children.len_u32();

                // TODO: maybe we should split these into two different AST Nodes
                // That would reduce the amount of allocations a little
                if runtime == options::JSX::Runtime::Classic || is_key_after_spread {
                    // Arguments to createElement()
                    let mut args = ExprNodeList::init_capacity(2 + children_count as usize);
                    // PERF(port): was assume_capacity
                    VecExt::append(&mut args, tag);

                    let num_props = e_.properties.len_u32();
                    if num_props > 0 {
                        // PORT NOTE: Zig duped the property slice into a fresh arena allocation
                        // before wrapping in E.Object. PropertyList = Vec<Property> here is
                        // already arena-backed and the JSX node is consumed; reuse in place.
                        // PERF(port): was arena alloc + bun.copy — profile in Phase B
                        VecExt::append(
                            &mut args,
                            p.new_expr(
                                E::Object {
                                    properties: bun_alloc::AstAlloc::take(&mut e_.properties),
                                    ..Default::default()
                                },
                                expr.loc,
                            ),
                        );
                    } else {
                        VecExt::append(&mut args, p.new_expr(E::Null {}, expr.loc));
                    }

                    let children_elements = &e_.children.slice()[0..children_count as usize];
                    for child in children_elements {
                        let mut arg = *child;
                        p.visit_expr(&mut arg);
                        if !matches!(arg.data, Data::EMissing(..)) {
                            // PERF(port): was assume_capacity
                            VecExt::append(&mut args, arg);
                        }
                    }

                    let target: Expr = if runtime == options::JSX::Runtime::Classic {
                        // PORT NOTE: see fragment note above — `options.jsx.factory` is
                        // owned by `P` and freed when the parser drops; dupe each part
                        // into the arena so the symbol/E::Dot names outlive the printer.
                        // Build the parts slice in the AST arena (no global-heap `Vec`).
                        let arena = p.arena;
                        let parts: &[&'a [u8]] = arena.alloc_slice_fill_iter(
                            p.options
                                .jsx
                                .factory
                                .iter()
                                .map(|b| -> &'a [u8] { arena.alloc_slice_copy(b) }),
                        );
                        p.jsx_strings_to_member_expression(expr.loc, parts)
                            .expect("unreachable")
                    } else {
                        // Spec (visitExpr.zig:257) calls jsxStringsToMemberExpression(factory)
                        // unconditionally before the runtime check; that has the side-effect of
                        // findSymbol(loc, factory[0]) which records usage of the factory ident.
                        // The full helper is Pragma-shape-blocked, so replicate the side-effect
                        // for the Automatic + key-after-spread path and discard the result.
                        if let Some(first) = p.options.jsx.factory.first() {
                            let name: &'a [u8] = p.arena.alloc_slice_copy(first);
                            let _ = p.find_symbol(expr.loc, name).expect("unreachable");
                        }
                        p.jsx_import(JSXImport::CreateElement, expr.loc)
                    };

                    // Call createElement()
                    *e = p.new_expr(
                        E::Call {
                            target,
                            args,
                            // Enable tree shaking
                            can_be_unwrapped_if_unused: if !p.options.ignore_dce_annotations
                                && !p.options.jsx.side_effects
                            {
                                E::CallUnwrap::IfUnused
                            } else {
                                E::CallUnwrap::Never
                            },
                            close_paren_loc: e_.close_tag_loc,
                            ..Default::default()
                        },
                        expr.loc,
                    );
                    return;
                }
                // function jsxDEV(type, config, maybeKey, source, self) {
                else if runtime == options::JSX::Runtime::Automatic {
                    // --- These must be done in all cases --
                    let maybe_key_value: Option<ExprNodeIndex> = if e_.key_prop_index > -1 {
                        let idx = e_.key_prop_index as u32 as usize;
                        e_.properties.ordered_remove(idx).value
                    } else {
                        None
                    };

                    // PORT NOTE: Zig reassigns `props` (a `*Vec(G.Property)`) to point inside
                    // a spread object's properties via raw arena pointer. Track as a
                    // `StoreRef` (safe `Deref`/`DerefMut`) so the spread-collapse walk
                    // and the `push`/`take` calls below stay in safe code.
                    let mut props_handle = js_ast::StoreRef::from_bump(&mut e_.properties);

                    // arguments needs to be like
                    // {
                    //    ...props,
                    //    children: [el1, el2]
                    // }

                    {
                        let mut last_child: u32 = 0;
                        // PORT NOTE: Zig wrote `e_.children.ptr[last_child] = p.visitExpr(child)`
                        // while iterating a slice over the same buffer. Iterate by index to avoid
                        // borrowck on `e_.children`.
                        for i in 0..children_count {
                            let mut visited = e_.children.slice()[i as usize];
                            p.visit_expr(&mut visited);
                            e_.children.slice_mut()[last_child as usize] = visited;
                            // if tree-shaking removes the element, we must also remove it here.
                            last_child += u32::from(!matches!(
                                e_.children.slice()[last_child as usize].data,
                                Data::EMissing(..)
                            ));
                        }
                        e_.children.truncate(last_child as usize);
                    }

                    // TODO(port): jsxChildrenKeyData in Zig is a mutable `var` of `Expr.Data`
                    // pointing at `Prefill.String.Children`. ExprData::EString wants a
                    // `StoreRef<EString>` (arena-backed) so a process-static won't compile (see
                    // P.rs `` ~7552). Allocate via `p.new_expr` from the const
                    // `prefill::string::CHILDREN` instead — small extra alloc.
                    // PERF(port): was process-static — profile in Phase B
                    let children_key = p.new_expr(prefill::string::CHILDREN, expr.loc);

                    // Optimization: if the only non-child prop is a spread object
                    // we can just pass the object as the first argument
                    // this goes as deep as there are spreads
                    // <div {{...{...{...{...foo}}}}} />
                    // ->
                    // <div {{...foo}} />
                    // jsx("div", {...foo})
                    loop {
                        // `StoreRef<PropertyList>: Deref` — safe arena-backed read.
                        if !(props_handle.len_u32() == 1
                            && props_handle.slice()[0].kind == G::PropertyKind::Spread
                            && matches!(
                                props_handle.slice()[0].value.unwrap().data,
                                Data::EObject(..)
                            ))
                        {
                            break;
                        }
                        // PORT NOTE: reshaped for borrowck — Zig reassigns `props` to point
                        // inside the spread object's properties. Compute the next handle in
                        // a block so the `DerefMut` borrow of `props_handle` ends before
                        // reassignment.
                        let next = {
                            let inner = props_handle.slice_mut()[0]
                                .value
                                .as_mut()
                                .unwrap()
                                .data
                                .e_object_mut()
                                .unwrap();
                            js_ast::StoreRef::from_bump(&mut inner.properties)
                        };
                        props_handle = next;
                    }
                    // `StoreRef: DerefMut` — safe arena-backed handle; no aliasing
                    // `&mut` outstanding for the remainder of this arm.
                    let props = &mut *props_handle;

                    // Typescript defines static jsx as children.len > 1 or single spread
                    // https://github.com/microsoft/TypeScript/blob/d4fbc9b57d9aa7d02faac9b1e9bb7b37c687f6e9/src/compiler/transformers/jsx.ts#L340
                    let is_static_jsx = e_.children.len_u32() > 1
                        || (e_.children.len_u32() == 1
                            && matches!(e_.children.slice()[0].data, Data::ESpread(..)));

                    if is_static_jsx {
                        // Capture before `mem::take` zeroes `e_.children.len` (struct-literal
                        // fields evaluate in written order; spec reads original len).
                        let children_single_line = e_.children.len_u32() < 2;
                        props.push(G::Property {
                            key: Some(children_key),
                            value: Some(p.new_expr(
                                E::Array {
                                    items: bun_alloc::AstAlloc::take(&mut e_.children),
                                    is_single_line: children_single_line,
                                    ..Default::default()
                                },
                                e_.close_tag_loc,
                            )),
                            ..Default::default()
                        });
                    } else if e_.children.len_u32() == 1 {
                        props.push(G::Property {
                            key: Some(children_key),
                            value: Some(e_.children.slice()[0]),
                            ..Default::default()
                        });
                    }

                    // Either:
                    // jsxDEV(type, arguments, key, isStaticChildren, source, self)
                    // jsx(type, arguments, key)
                    let args_len = if p.options.jsx.development {
                        6usize
                    } else {
                        2usize + usize::from(maybe_key_value.is_some())
                    };
                    let mut args = ExprNodeList::init_capacity(args_len);
                    VecExt::append(&mut args, tag);

                    VecExt::append(
                        &mut args,
                        p.new_expr(
                            E::Object {
                                properties: bun_alloc::AstAlloc::take(props),
                                ..Default::default()
                            },
                            expr.loc,
                        ),
                    );

                    if let Some(key) = maybe_key_value {
                        VecExt::append(&mut args, key);
                    } else if p.options.jsx.development {
                        // if (maybeKey !== undefined)
                        VecExt::append(
                            &mut args,
                            Expr {
                                loc: expr.loc,
                                data: Data::EUndefined(E::Undefined {}),
                            },
                        );
                    }

                    if p.options.jsx.development {
                        // is the return type of the first child an array?
                        // It's dynamic
                        // Else, it's static
                        VecExt::append(
                            &mut args,
                            Expr {
                                loc: expr.loc,
                                data: Data::EBoolean(E::Boolean {
                                    value: is_static_jsx,
                                }),
                            },
                        );

                        VecExt::append(&mut args, p.new_expr(E::Undefined {}, expr.loc));
                        VecExt::append(
                            &mut args,
                            Expr {
                                data: prefill::data::THIS,
                                loc: expr.loc,
                            },
                        );
                    }

                    let jsx_target = p.jsx_import_automatic(expr.loc, is_static_jsx);
                    *e = p.new_expr(
                        E::Call {
                            target: jsx_target,
                            args,
                            // Enable tree shaking
                            can_be_unwrapped_if_unused: if !p.options.ignore_dce_annotations
                                && !p.options.jsx.side_effects
                            {
                                E::CallUnwrap::IfUnused
                            } else {
                                E::CallUnwrap::Never
                            },
                            was_jsx_element: true,
                            close_paren_loc: e_.close_tag_loc,
                            ..Default::default()
                        },
                        expr.loc,
                    );
                    return;
                } else {
                    unreachable!();
                }
            }
            _ => unreachable!(),
        }
    }
    #[inline(never)] // PERF(port:frame): see e_jsx_element.
    fn e_template(p: &mut Self, e: &mut Expr, in_: ExprIn) {
        let expr = *e;
        let _ = in_;
        let mut e_ = expr.data.e_template().expect("infallible: variant checked");
        if let Some(tag) = e_.tag {
            p.visit_expr(e_.tag.as_mut().unwrap());

            if Self::ALLOW_MACROS {
                let ref_ = match &e_.tag.unwrap().data {
                    Data::EImportIdentifier(ident) => Some(ident.ref_),
                    Data::EDot(dot) => match &dot.target.data {
                        Data::EIdentifier(id) => Some(id.ref_),
                        _ => None,
                    },
                    _ => None,
                };

                if ref_.is_some() && !p.options.features.is_macro_runtime {
                    if let Some(macro_ref_data) = p.macro_.refs.get(&ref_.unwrap()).copied() {
                        p.ignore_usage(ref_.unwrap());
                        if p.is_control_flow_dead {
                            *e = p.new_expr(E::Undefined {}, e_.tag.unwrap().loc);
                            return;
                        }

                        // this ordering incase someone wants to use a macro in a node_module conditionally
                        if p.options.features.no_macros {
                            p.log()
                                .add_error(Some(p.source), tag.loc, b"Macros are disabled");
                            *e = p.new_expr(E::Undefined {}, e_.tag.unwrap().loc);
                            return;
                        }

                        if p.source.path.is_node_module() {
                            p.log().add_error(
                                Some(p.source),
                                expr.loc,
                                b"For security reasons, macros cannot be run from node_modules.",
                            );
                            *e = p.new_expr(E::Undefined {}, expr.loc);
                            return;
                        }

                        p.macro_call_count += 1;
                        let name: &[u8] = macro_ref_data.name.unwrap_or_else(|| {
                            e_.tag
                                .unwrap()
                                .data
                                .e_dot()
                                .expect("infallible: variant checked")
                                .name
                                .slice()
                        });
                        let (record_path_text, record_range) = {
                            let record =
                                &p.import_records.items()[macro_ref_data.import_record_id as usize];
                            (record.path.text, record.range)
                        };
                        // We must visit it to convert inline_identifiers and record usage
                        // Reborrow via the field-disjoint `Lexer::log()` accessor
                        // so `&p.lexer` and `&mut p.options` split cleanly under
                        // borrowck — Zig held two raw `*Log`.
                        let log = p.lexer.log();
                        let source = p.source;
                        let Ok(macro_result) = p
                            .options
                            .macro_context
                            .as_deref_mut()
                            .expect("macro_context")
                            .call(
                                record_path_text,
                                source.path.source_dir(),
                                log,
                                source,
                                record_range,
                                expr,
                                name,
                            )
                        else {
                            return;
                        };

                        if !matches!(macro_result.data, Data::ETemplate(..)) {
                            *e = macro_result;
                            p.visit_expr(e);
                            return;
                        }
                    }
                }
            }
        }

        // `Template.parts` is arena-owned (Zig: `[]E.TemplatePart`).
        for part in e_.parts_mut().iter_mut() {
            p.visit_expr(&mut part.value);
        }

        // When mangling, inline string values into the template literal. Note that
        // it may no longer be a template literal after this point (it may turn into
        // a plain string literal instead).
        if p.should_fold_typescript_constant_expressions || p.options.features.inlining {
            *e = e_.fold(p.arena, expr.loc);
            return;
        }
    }
    fn e_binary(p: &mut Self, e: &mut Expr, in_: ExprIn) {
        let expr = *e;
        use crate::visit::visit_binary::BinaryExpressionVisitor;
        let mut e_ = expr.data.e_binary().expect("infallible: variant checked");

        // The handling of binary expressions is convoluted because we're using
        // iteration on the heap instead of recursion on the call stack to avoid
        // stack overflow for deeply-nested ASTs.
        //
        // PORT NOTE: Zig stores `*E.Binary` (arena ptr). `BinaryExpressionVisitor.e`
        // is the `StoreRef<E::Binary>` arena handle directly — `Copy` + safe
        // `Deref`/`DerefMut`, so no raw-pointer detach is needed here.
        let mut v: BinaryExpressionVisitor = BinaryExpressionVisitor {
            e: e_,
            loc: expr.loc,
            in_,
            left_in: ExprIn::default(),
            is_stmt_expr: false,
        };

        // Everything uses a single stack to reduce allocation overhead. This stack
        // should almost always be very small, and almost all visits should reuse
        // existing memory without allocating anything.
        let stack_bottom = p.binary_expression_stack.len();

        // Assigned on every `break` arm of the loop below; the initial input
        // `expr` is never read directly (Zig's `var current = expr` was a
        // pre-init habit, not load-bearing).
        let mut current;

        // Iterate down into the AST along the left node of the binary operation.
        // Continue iterating until we encounter something that's not a binary node.
        loop {
            if let Some(out) = BinaryExpressionVisitor::check_and_prepare(&mut v, p) {
                current = out;
                break;
            }

            // Grab the arguments to our nested "visitExprInOut" call for the left
            // node. We only care about deeply-nested left nodes because most binary
            // operators in JavaScript are left-associative and the problematic edge
            // cases we're trying to avoid crashing on have lots of left-associative
            // binary operators chained together without parentheses (e.g. "1+2+...").
            let left = v.e.left;
            let left_in = v.left_in;

            let left_binary: Option<js_ast::StoreRef<E::Binary>> = left.data.e_binary();

            // Stop iterating if iteration doesn't apply to the left node. This checks
            // the assignment target because "visitExprInOut" has additional behavior
            // in that case that we don't want to miss (before the top-level "switch"
            // statement).
            if left_binary.is_none() || left_in.assign_target != js_ast::AssignTarget::None {
                p.visit_expr_in_out(&mut v.e.left, left_in);
                current = BinaryExpressionVisitor::visit_right_and_finish(&mut v, p);
                break;
            }

            // Note that we only append to the stack (and therefore allocate memory
            // on the heap) when there are nested binary expressions. A single binary
            // expression doesn't add anything to the stack.
            p.binary_expression_stack.push(v);
            v = BinaryExpressionVisitor {
                e: left_binary.unwrap(),
                loc: left.loc,
                in_: left_in,
                left_in: ExprIn::default(),
                is_stmt_expr: false,
            };
        }

        // Process all binary operations from the deepest-visited node back toward
        // our original top-level binary operation.
        while p.binary_expression_stack.len() > stack_bottom {
            v = p.binary_expression_stack.pop().unwrap();
            v.e.left = current;
            current = BinaryExpressionVisitor::visit_right_and_finish(&mut v, p);
        }

        *e = current;
    }

    fn e_index(p: &mut Self, e: &mut Expr, in_: ExprIn) {
        let expr = *e;
        let mut e_ = expr.data.e_index().expect("infallible: variant checked");
        let is_call_target = matches!(p.call_target, Data::EIndex(ct) if core::ptr::eq(&raw const *e_, &raw const *ct));
        let is_delete_target = matches!(p.delete_target, Data::EIndex(dt) if core::ptr::eq(&raw const *e_, &raw const *dt));

        // "a['b']" => "a.b"
        if p.options.features.minify_syntax {
            if let Some(mut s) = e_.index.data.e_string() {
                if !s.is_utf16 && s.is_identifier(p.arena) {
                    let dot = p.new_expr(
                        E::Dot {
                            name: s.data,
                            name_loc: e_.index.loc,
                            target: e_.target,
                            optional_chain: e_.optional_chain,
                            ..Default::default()
                        },
                        expr.loc,
                    );

                    if is_call_target {
                        p.call_target = dot.data;
                    }
                    if is_delete_target {
                        p.delete_target = dot.data;
                    }

                    *e = dot;
                    p.visit_expr_in_out(e, in_);
                    return;
                }
            }
        }

        let has_chain_parent = e_.optional_chain == Some(js_ast::OptionalChain::Continuation);
        p.visit_expr_in_out(
            &mut e_.target,
            ExprIn {
                has_chain_parent,
                ..Default::default()
            },
        );

        match e_.index.data {
            Data::EPrivateIdentifier(mut private) => {
                let name = p.load_name_from_ref(private.ref_);
                let result = p.find_symbol(e_.index.loc, name).expect("unreachable");
                private.ref_ = result.r#ref;

                // Unlike regular identifiers, there are no unbound private identifiers
                let kind: js_ast::symbol::Kind =
                    p.symbols[result.r#ref.inner_index() as usize].kind;
                if !Symbol::is_kind_private(kind) {
                    let r = bun_ast::Range {
                        loc: e_.index.loc,
                        len: i32::try_from(name.len()).expect("int cast"),
                    };
                    p.log().add_range_error_fmt(
                        Some(p.source),
                        r,
                        format_args!(
                            "Private name \"{}\" must be declared in an enclosing class",
                            BStr::new(name)
                        ),
                    );
                } else {
                    if in_.assign_target != js_ast::AssignTarget::None
                        && (kind == js_ast::symbol::Kind::PrivateMethod
                            || kind == js_ast::symbol::Kind::PrivateStaticMethod)
                    {
                        let r = bun_ast::Range {
                            loc: e_.index.loc,
                            len: i32::try_from(name.len()).expect("int cast"),
                        };
                        p.log().add_range_warning_fmt(
                            Some(p.source),
                            r,
                            format_args!(
                                "Writing to read-only method \"{}\" will throw",
                                BStr::new(name)
                            ),
                        );
                    } else if in_.assign_target != js_ast::AssignTarget::None
                        && (kind == js_ast::symbol::Kind::PrivateGet
                            || kind == js_ast::symbol::Kind::PrivateStaticGet)
                    {
                        let r = bun_ast::Range {
                            loc: e_.index.loc,
                            len: i32::try_from(name.len()).expect("int cast"),
                        };
                        p.log().add_range_warning_fmt(
                            Some(p.source),
                            r,
                            format_args!(
                                "Writing to getter-only property \"{}\" will throw",
                                BStr::new(name)
                            ),
                        );
                    } else if in_.assign_target != js_ast::AssignTarget::Replace
                        && (kind == js_ast::symbol::Kind::PrivateSet
                            || kind == js_ast::symbol::Kind::PrivateStaticSet)
                    {
                        let r = bun_ast::Range {
                            loc: e_.index.loc,
                            len: i32::try_from(name.len()).expect("int cast"),
                        };
                        p.log().add_range_warning_fmt(
                            Some(p.source),
                            r,
                            format_args!(
                                "Reading from setter-only property \"{}\" will throw",
                                BStr::new(name)
                            ),
                        );
                    }
                }

                e_.index = Expr {
                    data: Data::EPrivateIdentifier(private),
                    loc: e_.index.loc,
                };
            }
            _ => {
                p.visit_expr(&mut e_.index);

                let unwrapped = e_.index.unwrap_inlined();
                if let Some(mut s) = unwrapped.data.e_string() {
                    if !s.is_utf16 {
                        // "a['b' + '']" => "a.b"
                        // "enum A { B = 'b' }; a[A.B]" => "a.b"
                        if p.options.features.minify_syntax && s.is_identifier(p.arena) {
                            let dot = p.new_expr(
                                E::Dot {
                                    name: s.data,
                                    name_loc: unwrapped.loc,
                                    target: e_.target,
                                    optional_chain: e_.optional_chain,
                                    ..Default::default()
                                },
                                expr.loc,
                            );

                            if is_call_target {
                                p.call_target = dot.data;
                            }
                            if is_delete_target {
                                p.delete_target = dot.data;
                            }

                            // don't call visitExprInOut on `dot` because we've already visited `target` above!
                            *e = dot;
                            return;
                        }

                        // Handle property rewrites to ensure things
                        // like .e_import_identifier tracking works
                        // Reminder that this can only be done after
                        // `target` is visited.
                        if let Some(rewrite) = p.maybe_rewrite_property_access(
                            expr.loc,
                            e_.target,
                            s.data.slice(),
                            unwrapped.loc,
                            IdentifierOpts::default()
                                .with_is_call_target(is_call_target)
                                // .is_template_tag = is_template_tag,
                                .with_is_delete_target(is_delete_target)
                                .with_assign_target(in_.assign_target),
                        ) {
                            *e = rewrite;
                            return;
                        }
                    }
                }
            }
        }

        let target = e_.target.unwrap_inlined();
        let index = e_.index.unwrap_inlined();

        if p.options.features.minify_syntax {
            if let Some(number) = index.data.as_e_number() {
                if number.value >= 0.0
                    && number.value < (usize::MAX as f64)
                    && number.value % 1.0 == 0.0
                {
                    // "foo"[2] -> "o"
                    if let Some(mut str_) = target.data.as_e_string() {
                        if !str_.is_utf16 {
                            let literal = str_.data;
                            let num: usize = index
                                .data
                                .e_number()
                                .expect("infallible: variant checked")
                                .to_usize();
                            if cfg!(debug_assertions) {
                                debug_assert!(strings::is_all_ascii(&literal));
                            }
                            if num < literal.len() {
                                *e = p.new_expr(
                                    E::String {
                                        data: E::Str::new(&literal[num..num + 1]),
                                        ..Default::default()
                                    },
                                    expr.loc,
                                );
                                return;
                            }
                        }
                    } else if let Some(array) = target.data.as_e_array() {
                        // [x][0] -> x
                        if array.items.len_u32() == 1 && number.value == 0.0 {
                            let inlined = *array.items.at(0);
                            if inlined.can_be_inlined_from_property_access() {
                                *e = inlined;
                                return;
                            }
                        }

                        // ['a', 'b', 'c'][1] -> 'b'
                        let int: usize = number.value as usize;
                        if int < array.items.len_u32() as usize
                            && p.expr_can_be_removed_if_unused(&target)
                        {
                            let inlined = *array.items.at(int);
                            // ['a', , 'c'][1] -> undefined
                            if matches!(inlined.data, Data::EMissing(..)) {
                                *e = p.new_expr(E::Undefined {}, inlined.loc);
                                return;
                            }
                            if cfg!(debug_assertions) {
                                debug_assert!(inlined.can_be_inlined_from_property_access());
                            }
                            *e = inlined;
                            return;
                        }
                    }
                }
            }
        }

        // Create an error for assigning to an import namespace when bundling. Even
        // though this is a run-time error, we make it a compile-time error when
        // bundling because scope hoisting means these will no longer be run-time
        // errors.
        if (in_.assign_target != js_ast::AssignTarget::None || is_delete_target)
            && matches!(e_.target.data.tag(), Tag::EIdentifier)
            && p.symbols[e_
                .target
                .data
                .e_identifier()
                .expect("infallible: variant checked")
                .ref_
                .inner_index() as usize]
                .kind
                == js_ast::symbol::Kind::Import
        {
            let r = js_lexer::range_of_identifier(p.source, e_.target.loc);
            p.log().add_range_error_fmt(
                Some(p.source),
                r,
                format_args!(
                    "Cannot assign to property on import \"{}\"",
                    // `original_name: StoreStr` has a safe `Deref<Target=[u8]>`.
                    BStr::new(
                        &*p.symbols[e_
                            .target
                            .data
                            .e_identifier()
                            .expect("infallible: variant checked")
                            .ref_
                            .inner_index() as usize]
                            .original_name,
                    )
                ),
            );
        }

        // PORT NOTE: `e_` is `StoreRef<E::Index>` — mutations above wrote through
        // DerefMut into the same arena slot `expr.data` already points at. Zig's
        // `p.newExpr(e_, loc)` re-wraps the same pointer; here `*e` is already that.
    }

    fn e_unary(p: &mut Self, e: &mut Expr, _: ExprIn) {
        let expr = *e;
        let mut e_ = expr.data.e_unary().expect("infallible: variant checked");
        match e_.op {
            Op::UnTypeof => {
                let id_before = matches!(e_.value.data, Data::EIdentifier(..));
                let assign_target = Op::unary_assign_target(e_.op);
                p.visit_expr_in_out(
                    &mut e_.value,
                    ExprIn {
                        assign_target,
                        ..Default::default()
                    },
                );
                let id_after = matches!(e_.value.data, Data::EIdentifier(..));

                // The expression "typeof (0, x)" must not become "typeof x" if "x"
                // is unbound because that could suppress a ReferenceError from "x"
                if !id_before
                    && id_after
                    && p.symbols[e_
                        .value
                        .data
                        .e_identifier()
                        .expect("infallible: variant checked")
                        .ref_
                        .inner_index() as usize]
                        .kind
                        == js_ast::symbol::Kind::Unbound
                {
                    e_.value = Expr {
                        loc: e_.value.loc,
                        data: prefill::data::ZERO,
                    }
                    .join_with_comma(e_.value);
                }

                if matches!(e_.value.data, Data::ERequireCallTarget) {
                    p.ignore_usage_of_runtime_require();
                    *e = p.new_expr(
                        E::String {
                            data: b"function".into(),
                            ..Default::default()
                        },
                        expr.loc,
                    );
                    return;
                }

                if let Some(typeof_) = SideEffects::typeof_(&e_.value.data) {
                    *e = p.new_expr(
                        E::String {
                            data: typeof_.into(),
                            ..Default::default()
                        },
                        expr.loc,
                    );
                    return;
                }
            }
            Op::UnDelete => {
                p.visit_expr_in_out(
                    &mut e_.value,
                    ExprIn {
                        has_chain_parent: true,
                        ..Default::default()
                    },
                );
            }
            _ => {
                let assign_target = Op::unary_assign_target(e_.op);
                p.visit_expr_in_out(
                    &mut e_.value,
                    ExprIn {
                        assign_target,
                        ..Default::default()
                    },
                );

                // Post-process the unary expression
                match e_.op {
                    Op::UnNot => {
                        if p.options.features.minify_syntax {
                            e_.value = SideEffects::simplify_boolean(p, e_.value);
                        }

                        let side_effects = SideEffects::to_boolean(p, &e_.value.data);
                        if side_effects.ok {
                            *e = p.new_expr(
                                E::Boolean {
                                    value: !side_effects.value,
                                },
                                expr.loc,
                            );
                            return;
                        }

                        if p.options.features.minify_syntax {
                            if let Some(exp) = Expr::maybe_simplify_not(&e_.value, p.arena) {
                                *e = exp;
                                return;
                            }
                            if let Data::EImportMetaMain(m) = &mut e_.value.data {
                                m.inverted = !m.inverted;
                                *e = e_.value;
                                return;
                            }
                        }
                    }
                    Op::UnCpl => {
                        if p.should_fold_typescript_constant_expressions {
                            if let Some(value) = SideEffects::to_number(&e_.value.data) {
                                *e = p.new_expr(
                                    E::Number {
                                        value: f64::from(!float_to_int32(value)),
                                    },
                                    expr.loc,
                                );
                                return;
                            }
                        }
                    }
                    Op::UnVoid => {
                        if p.expr_can_be_removed_if_unused(&e_.value) {
                            *e = p.new_expr(E::Undefined {}, e_.value.loc);
                            return;
                        }
                    }
                    Op::UnPos => {
                        if let Some(num) = SideEffects::to_number(&e_.value.data) {
                            *e = p.new_expr(E::Number { value: num }, expr.loc);
                            return;
                        }
                    }
                    Op::UnNeg => {
                        if let Some(num) = SideEffects::to_number(&e_.value.data) {
                            *e = p.new_expr(E::Number { value: -num }, expr.loc);
                            return;
                        }
                    }

                    ////////////////////////////////////////////////////////////////////////////////
                    Op::UnPreDec => {
                        // TODO: private fields
                    }
                    Op::UnPreInc => {
                        // TODO: private fields
                    }
                    Op::UnPostDec => {
                        // TODO: private fields
                    }
                    Op::UnPostInc => {
                        // TODO: private fields
                    }
                    _ => {}
                }

                if p.options.features.minify_syntax {
                    // "-(a, b)" => "a, -b"
                    if !matches!(e_.op, Op::UnDelete | Op::UnTypeof) {
                        if let Data::EBinary(comma) = &e_.value.data {
                            if comma.op == Op::BinComma {
                                *e = comma.left.join_with_comma(p.new_expr(
                                    E::Unary {
                                        op: e_.op,
                                        value: comma.right,
                                        flags: e_.flags,
                                    },
                                    comma.right.loc,
                                ));
                                return;
                            }
                        }
                    }
                }
            }
        }
    }
    fn e_dot(p: &mut Self, e: &mut Expr, in_: ExprIn) {
        let expr = *e;
        let mut e_ = expr.data.e_dot().expect("infallible: variant checked");
        let is_delete_target = matches!(p.delete_target, Data::EDot(dt) if core::ptr::eq(&raw const *e_, &raw const *dt));
        let is_call_target = matches!(p.call_target, Data::EDot(ct) if core::ptr::eq(&raw const *e_, &raw const *ct));

        // `p.define: &'a Define` is `Copy`; hoist so the `dots.get` borrow is
        // tied to `'a`, not `&*p`, and `&mut self` helpers below can be called
        // while iterating without laundering.
        let defines = p.define;
        if let Some(parts) = defines.dots.get(e_.name.slice()) {
            for define in parts.as_slice() {
                if p.is_dot_define_match(expr, &define.parts) {
                    if in_.assign_target == js_ast::AssignTarget::None {
                        // Substitute user-specified defines
                        if !define.data.valueless() {
                            *e = p.value_for_define(
                                expr.loc,
                                in_.assign_target,
                                is_delete_target,
                                &define.data,
                            );
                            return;
                        }

                        if define.data.method_call_must_be_replaced_with_undefined()
                            && in_
                                .property_access_for_method_call_maybe_should_replace_with_undefined
                        {
                            p.method_call_must_be_replaced_with_undefined = true;
                        }
                    }

                    // Copy the side effect flags over in case this expression is unused
                    if define.data.can_be_removed_if_unused() {
                        e_.can_be_removed_if_unused = true;
                    }

                    if define.data.call_can_be_unwrapped_if_unused() != E::CallUnwrap::Never
                        && !p.options.ignore_dce_annotations
                    {
                        e_.call_can_be_unwrapped_if_unused =
                            define.data.call_can_be_unwrapped_if_unused();
                    }

                    break;
                }
            }
        }

        // Track ".then().catch()" chains
        if is_call_target
            && matches!(p.then_catch_chain.next_target, Data::EDot(nt) if core::ptr::eq(&raw const *e_, &raw const *nt))
        {
            if e_.name == b"catch" {
                p.then_catch_chain = ThenCatchChain {
                    next_target: e_.target.data,
                    has_catch: true,
                    has_multiple_args: false,
                };
            } else if e_.name == b"then" {
                p.then_catch_chain = ThenCatchChain {
                    next_target: e_.target.data,
                    has_catch: p.then_catch_chain.has_catch || p.then_catch_chain.has_multiple_args,
                    has_multiple_args: false,
                };
            }
        }

        p.visit_expr_in_out(
            &mut e_.target,
            ExprIn {
                property_access_for_method_call_maybe_should_replace_with_undefined: in_
                    .property_access_for_method_call_maybe_should_replace_with_undefined,
                ..Default::default()
            },
        );

        // 'require.resolve' -> .e_require_resolve_call_target
        if matches!(e_.target.data, Data::ERequireCallTarget) && e_.name == b"resolve" {
            // we do not need to call p.recordUsageOfRuntimeRequire(); because `require`
            // was not a call target. even if the call target is `require.resolve`, it should be set.
            *e = Expr {
                data: Data::ERequireResolveCallTarget,
                loc: expr.loc,
            };
            return;
        }

        if e_.optional_chain.is_none() {
            if let Some(_expr) = p.maybe_rewrite_property_access(
                expr.loc,
                e_.target,
                e_.name.slice(),
                e_.name_loc,
                IdentifierOpts::default()
                    .with_is_call_target(is_call_target)
                    .with_assign_target(in_.assign_target)
                    .with_is_delete_target(is_delete_target),
                // .is_template_tag = p.template_tag != null,
            ) {
                *e = _expr;
                return;
            }

            if Self::ALLOW_MACROS {
                if !p.options.features.is_macro_runtime {
                    if p.macro_call_count > 0
                        && matches!(e_.target.data, Data::EObject(..))
                        && e_
                            .target
                            .data
                            .e_object()
                            .expect("infallible: variant checked")
                            .was_originally_macro
                    {
                        if let Some(obj) = e_.target.get(&e_.name) {
                            *e = obj;
                            return;
                        }
                    }
                }
            }
        }
    }

    fn e_if(p: &mut Self, e: &mut Expr, _: ExprIn) {
        let mut e_ = e.data.e_if().expect("infallible: variant checked");
        let is_call_target =
            matches!(p.call_target, Data::EIf(ct) if core::ptr::eq(&raw const *e_, &raw const *ct));

        let prev_in_branch = p.in_branch_condition;
        p.in_branch_condition = true;
        p.visit_expr(&mut e_.test_);
        p.in_branch_condition = prev_in_branch;

        e_.test_ = SideEffects::simplify_boolean(p, e_.test_);

        let side_effects = SideEffects::to_boolean(p, &e_.test_.data);

        if !side_effects.ok {
            p.visit_expr(&mut e_.yes);
            p.visit_expr(&mut e_.no);
        } else {
            // Mark the control flow as dead if the branch is never taken
            if side_effects.value {
                // "true ? live : dead"
                p.visit_expr(&mut e_.yes);
                let old = p.is_control_flow_dead;
                p.is_control_flow_dead = true;
                p.visit_expr(&mut e_.no);
                p.is_control_flow_dead = old;

                if side_effects.side_effects == SideEffects::CouldHaveSideEffects {
                    *e = SideEffects::simplify_unused_expr(p, e_.test_)
                        .unwrap_or_else(|| p.new_expr(E::Missing {}, e_.test_.loc))
                        .join_with_comma(e_.yes);
                    return;
                }

                // "(1 ? fn : 2)()" => "fn()"
                // "(1 ? this.fn : 2)" => "this.fn"
                // "(1 ? this.fn : 2)()" => "(0, this.fn)()"
                if is_call_target && e_.yes.has_value_for_this_in_call() {
                    *e = p
                        .new_expr(E::Number { value: 0.0 }, e_.test_.loc)
                        .join_with_comma(e_.yes);
                    return;
                }

                *e = e_.yes;
                return;
            } else {
                // "false ? dead : live"
                let old = p.is_control_flow_dead;
                p.is_control_flow_dead = true;
                p.visit_expr(&mut e_.yes);
                p.is_control_flow_dead = old;
                p.visit_expr(&mut e_.no);

                // "(a, false) ? b : c" => "a, c"
                if side_effects.side_effects == SideEffects::CouldHaveSideEffects {
                    *e = SideEffects::simplify_unused_expr(p, e_.test_)
                        .unwrap_or_else(|| p.new_expr(E::Missing {}, e_.test_.loc))
                        .join_with_comma(e_.no);
                    return;
                }

                // "(1 ? fn : 2)()" => "fn()"
                // "(1 ? this.fn : 2)" => "this.fn"
                // "(1 ? this.fn : 2)()" => "(0, this.fn)()"
                if is_call_target && e_.no.has_value_for_this_in_call() {
                    *e = p
                        .new_expr(E::Number { value: 0.0 }, e_.test_.loc)
                        .join_with_comma(e_.no);
                    return;
                }
                *e = e_.no;
                return;
            }
        }
    }

    #[inline(never)] // PERF(port:frame): see e_jsx_element.
    fn e_array(p: &mut Self, e: &mut Expr, in_: ExprIn) {
        let mut e_ = e.data.e_array().expect("infallible: variant checked");
        if in_.assign_target != js_ast::AssignTarget::None {
            p.maybe_comma_spread_error(e_.comma_after_spread);
        }
        let items = e_.items.slice_mut();
        let mut spread_item_count: usize = 0;
        for item in items {
            match &mut item.data {
                Data::EMissing(..) => {}
                Data::ESpread(spread) => {
                    p.visit_expr_in_out(
                        &mut spread.value,
                        ExprIn {
                            assign_target: in_.assign_target,
                            ..Default::default()
                        },
                    );

                    spread_item_count += if let Data::EArray(arr) = &spread.value.data {
                        arr.items.len_u32() as usize
                    } else {
                        0
                    };
                }
                Data::EBinary(e2) => {
                    if in_.assign_target != js_ast::AssignTarget::None && e2.op == Op::BinAssign {
                        let was_anonymous_named_expr = e2.right.is_anonymous_named();
                        // Propagate name for anonymous decorated class expressions
                        if was_anonymous_named_expr
                            && matches!(e2.right.data, Data::EClass(..))
                            && e2
                                .right
                                .data
                                .e_class()
                                .expect("infallible: variant checked")
                                .should_lower_standard_decorators
                            && matches!(e2.left.data.tag(), Tag::EIdentifier)
                        {
                            p.decorator_class_name = Some(
                                p.load_name_from_ref(
                                    e2.left
                                        .data
                                        .e_identifier()
                                        .expect("infallible: variant checked")
                                        .ref_,
                                ),
                            );
                        }
                        p.visit_expr_in_out(
                            &mut e2.left,
                            ExprIn {
                                assign_target: js_ast::AssignTarget::Replace,
                                ..Default::default()
                            },
                        );
                        p.visit_expr(&mut e2.right);
                        p.decorator_class_name = None;

                        if matches!(e2.left.data.tag(), Tag::EIdentifier) {
                            let name = p.symbols[e2
                                .left
                                .data
                                .e_identifier()
                                .expect("infallible: variant checked")
                                .ref_
                                .inner_index()
                                as usize]
                                .original_name;
                            e2.right = p.maybe_keep_expr_symbol_name(
                                e2.right,
                                name.slice(),
                                was_anonymous_named_expr,
                            );
                        }
                    } else {
                        p.visit_expr_in_out(
                            item,
                            ExprIn {
                                assign_target: in_.assign_target,
                                ..Default::default()
                            },
                        );
                    }
                }
                _ => {
                    p.visit_expr_in_out(
                        item,
                        ExprIn {
                            assign_target: in_.assign_target,
                            ..Default::default()
                        },
                    );
                }
            }
        }

        // "[1, ...[2, 3], 4]" => "[1, 2, 3, 4]"
        if p.options.features.minify_syntax
            && spread_item_count > 0
            && in_.assign_target == js_ast::AssignTarget::None
        {
            if let Ok(items) = e_.inline_spread_of_array_literals(p.arena, spread_item_count) {
                e_.items = items;
            }
        }
    }

    #[inline(never)] // PERF(port:frame): see e_jsx_element.
    fn e_object(p: &mut Self, e: &mut Expr, in_: ExprIn) {
        let mut e_ = e.data.e_object().expect("infallible: variant checked");
        if in_.assign_target != js_ast::AssignTarget::None {
            p.maybe_comma_spread_error(e_.comma_after_spread);
        }

        let mut has_spread = false;
        let mut has_proto = false;
        for property in e_.properties.slice_mut() {
            if property.kind != G::PropertyKind::Spread {
                p.visit_expr(
                    property
                        .key
                        .as_mut()
                        .unwrap_or_else(|| panic!("Expected property key")),
                );
                let key = property.key.expect("infallible: prop has key");
                // Forbid duplicate "__proto__" properties according to the specification
                if !property.flags.contains(Flags::Property::IsComputed)
                    && !property.flags.contains(Flags::Property::WasShorthand)
                    && !property.flags.contains(Flags::Property::IsMethod)
                    && in_.assign_target == js_ast::AssignTarget::None
                    && key.data.is_string_value()
                    && key
                        .data
                        .e_string()
                        .expect("infallible: variant checked")
                        .data
                        == b"__proto__"
                // __proto__ is utf8, assume it lives in refs
                {
                    if has_proto {
                        let r = js_lexer::range_of_identifier(p.source, key.loc);
                        p.log().add_range_error(
                            Some(p.source),
                            r,
                            b"Cannot specify the \"__proto__\" property more than once per object",
                        );
                    }
                    has_proto = true;
                }
            } else {
                has_spread = true;
            }

            // Extract the initializer for expressions like "({ a: b = c } = d)"
            if in_.assign_target != js_ast::AssignTarget::None
                && property.initializer.is_none()
                && property.value.is_some()
            {
                if let Data::EBinary(bin) =
                    &property.value.expect("infallible: prop has value").data
                {
                    if bin.op == Op::BinAssign {
                        property.initializer = Some(bin.right);
                        property.value = Some(bin.left);
                    }
                }
            }

            if property.value.is_some() {
                // Propagate name from property key for decorated anonymous class expressions
                // e.g., { Foo: @dec class {} } should give the class .name = "Foo"
                if in_.assign_target == js_ast::AssignTarget::None
                    && matches!(
                        property.value.expect("infallible: prop has value").data,
                        Data::EClass(..)
                    )
                    && property
                        .value
                        .unwrap()
                        .data
                        .e_class()
                        .unwrap()
                        .should_lower_standard_decorators
                    && property
                        .value
                        .expect("infallible: prop has value")
                        .data
                        .e_class()
                        .expect("infallible: variant checked")
                        .class_name
                        .is_none()
                    && property.key.is_some()
                    && matches!(
                        property.key.expect("infallible: prop has key").data,
                        Data::EString(..)
                    )
                {
                    let key_str = property
                        .key
                        .expect("infallible: prop has key")
                        .data
                        .e_string()
                        .expect("infallible: variant checked");
                    // PORT NOTE: Zig `string(arena)` transcodes UTF-16; while
                    // E.rs has duplicate impls (E0034), reach the bytes directly
                    // — class-name keys are parser-produced (UTF-8, no rope).
                    p.decorator_class_name = if !key_str.is_utf16 {
                        Some(key_str.data.slice())
                    } else {
                        None
                    };
                }
                p.visit_expr_in_out(
                    property.value.as_mut().expect("infallible: prop has value"),
                    ExprIn {
                        assign_target: in_.assign_target,
                        ..Default::default()
                    },
                );
                p.decorator_class_name = None;
            }

            if property.initializer.is_some() {
                let was_anonymous_named_expr = property.initializer.unwrap().is_anonymous_named();
                if was_anonymous_named_expr
                    && matches!(property.initializer.unwrap().data, Data::EClass(..))
                    && property
                        .initializer
                        .unwrap()
                        .data
                        .e_class()
                        .unwrap()
                        .should_lower_standard_decorators
                {
                    if let Some(val) = property.value {
                        if matches!(val.data.tag(), Tag::EIdentifier) {
                            p.decorator_class_name = Some(
                                p.load_name_from_ref(
                                    val.data
                                        .e_identifier()
                                        .expect("infallible: variant checked")
                                        .ref_,
                                ),
                            );
                        }
                    }
                }
                p.visit_expr(property.initializer.as_mut().unwrap());
                p.decorator_class_name = None;

                if let Some(val) = property.value {
                    if matches!(val.data.tag(), Tag::EIdentifier) {
                        let name = p.symbols[val
                            .data
                            .e_identifier()
                            .expect("infallible: variant checked")
                            .ref_
                            .inner_index() as usize]
                            .original_name;
                        property.initializer = Some(p.maybe_keep_expr_symbol_name(
                            property.initializer.expect("unreachable"),
                            name.slice(),
                            was_anonymous_named_expr,
                        ));
                    }
                }
            }
        }
        let _ = has_spread;
    }
    #[inline(never)] // PERF(port:frame): see e_jsx_element.
    fn e_import(p: &mut Self, e: &mut Expr, in_: ExprIn) {
        let _ = in_;
        let mut e_ = e.data.e_import().expect("infallible: variant checked");
        // We want to forcefully fold constants inside of imports
        // even when minification is disabled, so that if we have an
        // import based on a string template, it does not cause a
        // bundle error. This is especially relevant for bundling NAPI
        // modules with 'bun build --compile':
        //
        // const binding = await import(`./${process.platform}-${process.arch}.node`);
        //
        // PORT NOTE: Zig `defer` restores at scope exit; restored manually before each return.
        let prev_should_fold_typescript_constant_expressions = true;
        p.should_fold_typescript_constant_expressions = true;

        p.visit_expr(&mut e_.expr);
        p.visit_expr(&mut e_.options);

        // Import transposition is able to duplicate the options structure, so
        // only perform it if the expression is side effect free.
        //
        // TODO: make this more like esbuild by emitting warnings that explain
        // why this import was not analyzed. (see esbuild 'unsupported-dynamic-import')
        if p.expr_can_be_removed_if_unused(&e_.options) {
            let state = TransposeState {
                is_await_target: matches!(
                    p.await_target,
                    Some(Data::EImport(at)) if core::ptr::eq(&raw const *e_, &raw const *at)
                ),
                is_then_catch_target: p.then_catch_chain.has_catch
                    && matches!(
                        p.then_catch_chain.next_target,
                        Data::EImport(nt) if core::ptr::eq(&raw const *e_, &raw const *nt)
                    ),
                import_options: e_.options,
                loc: e_.expr.loc,
                import_loader: e_.import_record_loader(),
                ..Default::default()
            };

            p.should_fold_typescript_constant_expressions =
                prev_should_fold_typescript_constant_expressions;
            *e = p.maybe_transpose_if_import(e_.expr, &state);
            return;
        }
        p.should_fold_typescript_constant_expressions =
            prev_should_fold_typescript_constant_expressions;
    }
    fn e_call(p: &mut Self, e: &mut Expr, in_: ExprIn) {
        let expr = *e;
        let mut e_ = expr.data.e_call().expect("infallible: variant checked");
        p.call_target = e_.target.data;

        p.then_catch_chain = ThenCatchChain {
            next_target: e_.target.data,
            has_multiple_args: e_.args.len_u32() >= 2,
            has_catch: matches!(
                p.then_catch_chain.next_target,
                Data::ECall(nt) if core::ptr::eq(&raw const *e_, &raw const *nt)
            ) && p.then_catch_chain.has_catch,
        };

        let target_was_identifier_before_visit = matches!(e_.target.data, Data::EIdentifier(..));
        let has_chain_parent = e_.optional_chain == Some(js_ast::OptionalChain::Continuation);
        p.visit_expr_in_out(
            &mut e_.target,
            ExprIn {
                has_chain_parent,
                property_access_for_method_call_maybe_should_replace_with_undefined: true,
                ..Default::default()
            },
        );

        // Copy the call side effect flag over if this is a known target
        // PORT NOTE: copy the small inline payloads out first so the `match &e_.target.data`
        // borrow doesn't overlap the `e_.can_be_unwrapped_if_unused = …` write below.
        match e_.target.data {
            Data::EIdentifier(ident) => {
                if ident.call_can_be_unwrapped_if_unused()
                    && e_.can_be_unwrapped_if_unused == E::CallUnwrap::Never
                {
                    e_.can_be_unwrapped_if_unused = E::CallUnwrap::IfUnused;
                }

                // Detect if this is a direct eval. Note that "(1 ? eval : 0)(x)" will
                // become "eval(x)" after we visit the target due to dead code elimination,
                // but that doesn't mean it should become a direct eval.
                //
                // Note that "eval?.(x)" is considered an indirect eval. There was debate
                // about this after everyone implemented it as a direct eval, but the
                // language committee said it was indirect and everyone had to change it:
                // https://github.com/tc39/ecma262/issues/2062.
                if e_.optional_chain.is_none()
                    && target_was_identifier_before_visit
                    && p.symbols[ident.ref_.inner_index() as usize]
                        .original_name
                        .slice()
                        == b"eval"
                {
                    e_.is_direct_eval = true;

                    // Pessimistically assume that if this looks like a CommonJS module
                    // (e.g. no "export" keywords), a direct call to "eval" means that
                    // code could potentially access "module" or "exports".
                    if p.options.bundle && !p.is_file_considered_to_have_esm_exports {
                        p.record_usage(p.module_ref);
                        p.record_usage(p.exports_ref);
                    }

                    // PORT NOTE: `Scope.parent: ?*Scope` in Zig is `Option<StoreRef<Scope>>` here;
                    // walk via the safe arena back-pointer.
                    let mut scope_iter: Option<js_ast::StoreRef<js_ast::Scope>> =
                        Some(p.current_scope);
                    while let Some(mut scope) = scope_iter {
                        scope.contains_direct_eval = true;
                        scope_iter = scope.parent;
                    }

                    // TODO: Log a build note for this like esbuild does
                }
            }
            Data::EDot(dot) => {
                if dot.call_can_be_unwrapped_if_unused != E::CallUnwrap::Never
                    && e_.can_be_unwrapped_if_unused == E::CallUnwrap::Never
                {
                    e_.can_be_unwrapped_if_unused = dot.call_can_be_unwrapped_if_unused;
                }
            }
            _ => {}
        }

        let is_macro_ref: bool = if Self::ALLOW_MACROS {
            let possible_macro_ref = match &e_.target.data {
                Data::EImportIdentifier(ident) => Some(ident.ref_),
                Data::EDot(dot) => {
                    if let Data::EIdentifier(id) = &dot.target.data {
                        Some(id.ref_)
                    } else {
                        None
                    }
                }
                _ => None,
            };

            possible_macro_ref.is_some() && p.macro_.refs.contains_key(&possible_macro_ref.unwrap())
        } else {
            false
        };

        {
            let old_ce = p.options.ignore_dce_annotations;
            // PORT NOTE: Zig `defer` restores at scope exit; do it manually below.
            let old_should_fold_typescript_constant_expressions =
                p.should_fold_typescript_constant_expressions;
            let old_is_control_flow_dead = p.is_control_flow_dead;

            // We want to forcefully fold constants inside of
            // certain calls even when minification is disabled, so
            // that if we have an import based on a string template,
            // it does not cause a bundle error. This is relevant for
            // macros, as they require constant known values, but also
            // for `require` and `require.resolve`, as they go through
            // the module resolver.
            if is_macro_ref
                || matches!(e_.target.data, Data::ERequireCallTarget)
                || matches!(e_.target.data, Data::ERequireResolveCallTarget)
            {
                p.options.ignore_dce_annotations = true;
                p.should_fold_typescript_constant_expressions = true;
            }

            // When a value is targeted by `--drop`, it will be removed.
            // The HMR APIs in `import.meta.hot` are implicitly dropped when HMR is disabled.
            let mut method_call_should_be_replaced_with_undefined =
                p.method_call_must_be_replaced_with_undefined;
            if method_call_should_be_replaced_with_undefined {
                p.method_call_must_be_replaced_with_undefined = false;
                match &e_.target.data {
                    // If we're removing this call, don't count any arguments as symbol uses
                    Data::EIndex(..) | Data::EDot(..) | Data::EIdentifier(..) => {
                        p.is_control_flow_dead = true;
                    }
                    // Special case from `import.meta.hot.*` functions.
                    Data::EUndefined(..) => {
                        p.is_control_flow_dead = true;
                    }
                    _ => {
                        method_call_should_be_replaced_with_undefined = false;
                    }
                }
            }

            for arg in e_.args.slice_mut() {
                p.visit_expr(arg);
            }

            // Restore deferred state (Zig `defer`).
            p.options.ignore_dce_annotations = old_ce;
            p.should_fold_typescript_constant_expressions =
                old_should_fold_typescript_constant_expressions;

            if method_call_should_be_replaced_with_undefined {
                p.is_control_flow_dead = old_is_control_flow_dead;
                *e = Expr {
                    data: Data::EUndefined(E::Undefined {}),
                    loc: expr.loc,
                };
                return;
            }
        }

        // Handle `feature("FLAG_NAME")` calls from `import { feature } from "bun:bundle"`
        // Check if the bundler_feature_flag_ref is set before calling the function
        // to avoid stack memory usage from copying values back and forth.
        if p.bundler_feature_flag_ref.is_valid() {
            if let Some(result) = Self::maybe_replace_bundler_feature_call(p, &mut *e_, expr.loc) {
                *e = result;
                return;
            }
        }

        if matches!(e_.target.data, Data::ERequireCallTarget) {
            e_.can_be_unwrapped_if_unused = E::CallUnwrap::Never;

            // Heuristic: omit warnings inside try/catch blocks because presumably
            // the try/catch statement is there to handle the potential run-time
            // error from the unbundled require() call failing.
            if e_.args.len_u32() == 1 {
                let first = e_.args.slice()[0];
                let state = TransposeState {
                    is_require_immediately_assigned_to_decl: in_.is_immediately_assigned_to_decl
                        && matches!(first.data, Data::EString(..)),
                    ..Default::default()
                };
                match &first.data {
                    Data::EString(..) => {
                        // require(FOO) => require(FOO)
                        *e = p.transpose_require(first, &state);
                        return;
                    }
                    Data::EIf(..) => {
                        // require(FOO  ? '123' : '456') => FOO ? require('123') : require('456')
                        // This makes static analysis later easier
                        *e = p.transpose_known_to_be_if_require(first, &state);
                        return;
                    }
                    _ => {}
                }
            }

            // Ignore calls to require() if the control flow is provably
            // dead here. We don't want to spend time scanning the required files
            // if they will never be used.
            if p.is_control_flow_dead {
                *e = p.new_expr(E::Null {}, expr.loc);
                return;
            }

            if p.options.warn_about_unbundled_modules {
                let r = js_lexer::range_of_identifier(p.source, e_.target.loc);
                p.log()
                    .add_range_debug(
                        Some(p.source),
                        r,
                        b"This call to \"require\" will not be bundled because it has multiple arguments",
                    );
            }

            if e_.args.len_u32() >= 1 {
                p.check_dynamic_specifier(e_.args.slice()[0], e_.target.loc, "require()")
                    .expect("unreachable");
            }

            if p.options.features.allow_runtime {
                p.record_usage_of_runtime_require();
            }

            return;
        } else if matches!(e_.target.data, Data::ERequireResolveCallTarget) {
            // Ignore calls to require.resolve() if the control flow is provably
            // dead here. We don't want to spend time scanning the required files
            // if they will never be used.
            if p.is_control_flow_dead {
                *e = p.new_expr(E::Null {}, expr.loc);
                return;
            }

            if e_.args.len_u32() == 1 {
                let first = e_.args.slice()[0];
                match &first.data {
                    Data::EString(..) => {
                        // require.resolve(FOO) => require.resolve(FOO)
                        // (this will register dependencies)
                        *e = p.transpose_require_resolve_known_string(first);
                        return;
                    }
                    Data::EIf(..) => {
                        // require.resolve(FOO  ? '123' : '456')
                        //  =>
                        // FOO ? require.resolve('123') : require.resolve('456')
                        // This makes static analysis later easier
                        *e = p.transpose_known_to_be_if_require_resolve(first, e_.target);
                        return;
                    }
                    _ => {}
                }
            }

            if e_.args.len_u32() >= 1 {
                p.check_dynamic_specifier(e_.args.slice()[0], e_.target.loc, "require.resolve()")
                    .expect("unreachable");
            }

            return;
        } else if let Some(special) = e_.target.data.e_special() {
            match special {
                E::Special::HotAccept => {
                    p.handle_import_meta_hot_accept_call(&mut *e_);
                    // After validating that the import.meta.hot
                    // code is correct, discard the entire
                    // expression in production.
                    if !p.options.features.hot_module_reloading {
                        *e = Expr {
                            data: Data::EUndefined(E::Undefined {}),
                            loc: expr.loc,
                        };
                        return;
                    }
                }
                _ => {}
            }
        }

        if Self::ALLOW_MACROS {
            if is_macro_ref && !p.options.features.is_macro_runtime {
                let ref_ = match &e_.target.data {
                    Data::EImportIdentifier(ident) => ident.ref_,
                    Data::EDot(dot) => {
                        dot.target
                            .data
                            .e_identifier()
                            .expect("infallible: variant checked")
                            .ref_
                    }
                    _ => unreachable!(),
                };

                let macro_ref_data = *p.macro_.refs.get(&ref_).unwrap();
                p.ignore_usage(ref_);
                if p.is_control_flow_dead {
                    *e = p.new_expr(E::Undefined {}, e_.target.loc);
                    return;
                }

                if p.options.features.no_macros {
                    p.log()
                        .add_error(Some(p.source), expr.loc, b"Macros are disabled");
                    *e = p.new_expr(E::Undefined {}, expr.loc);
                    return;
                }

                if p.source.path.is_node_module() {
                    p.log().add_error(
                        Some(p.source),
                        expr.loc,
                        b"For security reasons, macros cannot be run from node_modules.",
                    );
                    *e = p.new_expr(E::Undefined {}, expr.loc);
                    return;
                }

                let name: &[u8] = macro_ref_data.name.unwrap_or_else(|| {
                    e_.target
                        .data
                        .e_dot()
                        .expect("infallible: variant checked")
                        .name
                        .slice()
                });
                let (record_path_text, record_range) = {
                    let record =
                        &p.import_records.items()[macro_ref_data.import_record_id as usize];
                    (record.path.text, record.range)
                };
                let copied = Expr {
                    loc: expr.loc,
                    data: expr.data,
                };
                let start_error_count = p.log().msgs.len();
                p.macro_call_count += 1;
                // Reborrow via the field-disjoint `Lexer::log()` accessor
                // so `&p.lexer` and `&mut p.options` split cleanly under
                // borrowck — Zig held two raw `*Log`.
                let log = p.lexer.log();
                let source = p.source;
                let macro_result = match p
                    .options
                    .macro_context
                    .as_deref_mut()
                    .expect("macro_context")
                    .call(
                        record_path_text,
                        source.path.source_dir(),
                        log,
                        source,
                        record_range,
                        copied,
                        name,
                    ) {
                    Ok(r) => r,
                    Err(err) => {
                        if err == bun_core::err!("MacroFailed") {
                            if p.log().msgs.len() == start_error_count {
                                p.log().add_error(
                                    Some(p.source),
                                    expr.loc,
                                    b"macro threw exception",
                                );
                            }
                        } else {
                            p.log().add_error_fmt(
                                Some(p.source),
                                expr.loc,
                                format_args!("\"{}\" error in macro", err.name()),
                            );
                        }
                        return;
                    }
                };

                if !matches!(macro_result.data, Data::ECall(..)) {
                    *e = macro_result;
                    p.visit_expr(e);
                    return;
                }
            }
        }

        // In fast refresh, any function call that looks like a hook (/^use[A-Z]/) is a
        // hook, even if it is not the value of `SExpr` or `SLocal`. It can be anywhere
        // in the function call. This makes sense for some weird situations with `useCallback`,
        // where it is not assigned to a variable.
        //
        // When we see a hook call, we need to hash it, and then mark a flag so that if
        // it is assigned to a variable, that variable also get's hashed.
        //
        // PORT NOTE: round-C `Runtime::Features.server_components` is a `bool` stub; the
        // full Zig type is `enum { off, client, server }` with `.isServerSide()`. Treat
        // `true` as server-side until the enum lands.
        if p.options.features.react_fast_refresh
            || p.options.features.server_components.is_server_side()
        {
            'try_record_hook: {
                let original_name: &[u8] = match &e_.target.data {
                    Data::EIdentifier(id) => p.symbols[id.ref_.inner_index() as usize]
                        .original_name
                        .slice(),
                    Data::EImportIdentifier(id) => p.symbols[id.ref_.inner_index() as usize]
                        .original_name
                        .slice(),
                    Data::ECommonjsExportIdentifier(id) => p.symbols
                        [id.ref_.inner_index() as usize]
                        .original_name
                        .slice(),
                    Data::EDot(dot) => dot.name.slice(),
                    _ => break 'try_record_hook,
                };
                if !ReactRefresh::is_hook_name(original_name) {
                    break 'try_record_hook;
                }
                if p.options.features.react_fast_refresh {
                    p.handle_react_refresh_hook_call(&mut *e_, original_name);
                } else if
                // If we're here it means we're in server component.
                // Error if the user is using the `useState` hook as it
                // is disallowed in server components.
                //
                // We're also specifically checking that the target is
                // `.e_import_identifier`.
                //
                // Why? Because we *don't* want to check for uses of
                // `useState` _inside_ React, and we know React uses
                // commonjs so it will never be `.e_import_identifier`.
                'check_for_usestate: {
                    if matches!(e_.target.data, Data::EImportIdentifier(..)) {
                        break 'check_for_usestate true;
                    }
                    // Also check for `React.useState(...)`
                    if let Data::EDot(dot) = &e_.target.data {
                        if let Data::EImportIdentifier(id) = &dot.target.data {
                            let name = p.symbols[id.ref_.inner_index() as usize]
                                .original_name
                                .slice();
                            break 'check_for_usestate name == b"React";
                        }
                    }
                    break 'check_for_usestate false;
                } {
                    debug_assert!(p.options.features.server_components.is_server_side());
                    if !strings::starts_with(p.source.path.pretty, b"node_modules")
                        && original_name == b"useState"
                    {
                        p.log()
                            .add_error(
                                Some(p.source),
                                expr.loc,
                                b"\"useState\" is not available in a server component. If you need interactivity, consider converting part of this to a Client Component (by adding `\"use client\";` to the top of the file).",
                            );
                    }
                }
            }
        }

        // Implement constant folding for 'string'.charCodeAt(n)
        if e_.args.len_u32() == 1 {
            if let Some(dot) = e_.target.data.e_dot() {
                if let Some(target_str) = dot.target.data.e_string() {
                    if !target_str.is_utf16 && dot.name == b"charCodeAt" {
                        let str_ = target_str.data;
                        let arg1 = e_.args.at(0).unwrap_inlined();
                        if let Data::ENumber(n) = &arg1.data {
                            let float = n.value;
                            if float % 1.0 == 0.0 && float < (str_.len() as f64) && float >= 0.0 {
                                let char_ = str_[float as usize];
                                if char_ < 0x80 {
                                    *e = p.new_expr(
                                        E::Number {
                                            value: f64::from(char_),
                                        },
                                        expr.loc,
                                    );
                                    return;
                                }
                            }
                        }
                    }
                }
            }
        }
    }

    #[inline(never)] // PERF(port:frame): see e_jsx_element.
    fn e_new(p: &mut Self, e: &mut Expr, _: ExprIn) {
        let expr = *e;
        let mut e_ = expr.data.e_new().expect("infallible: variant checked");
        p.visit_expr(&mut e_.target);

        for arg in e_.args.slice_mut() {
            p.visit_expr(arg);
        }

        if p.options.features.minify_syntax {
            if let Some(minified) = js_ast::known_global::KnownGlobal::minify_global_constructor(
                p.arena,
                &mut *e_,
                &p.symbols,
                expr.loc,
                p.options.features.minify_whitespace,
            ) {
                *e = minified;
                return;
            }
        }
    }

    /// Note: Caller must check `p.bundler_feature_flag_ref.is_valid()` before calling.
    fn maybe_replace_bundler_feature_call(
        p: &mut Self,
        e_: &mut E::Call,
        loc: bun_ast::Loc,
    ) -> Option<Expr> {
        // Check if the target is the `feature` function from "bun:bundle"
        // It could be e_identifier (for unbound) or e_import_identifier (for imports)
        let target_ref: Option<Ref> = match &e_.target.data {
            Data::EIdentifier(ident) => Some(ident.ref_),
            Data::EImportIdentifier(ident) => Some(ident.ref_),
            _ => None,
        };

        if target_ref.is_none() || !target_ref.unwrap().eql(p.bundler_feature_flag_ref) {
            return None;
        }

        // If control flow is dead, just return false without validation errors
        if p.is_control_flow_dead {
            return Some(p.new_expr(E::Boolean { value: false }, loc));
        }

        // Validate: exactly one argument required
        if e_.args.len_u32() != 1 {
            p.log().add_error(
                Some(p.source),
                loc,
                b"feature() requires exactly one string argument",
            );
            return Some(p.new_expr(E::Boolean { value: false }, loc));
        }

        let arg = e_.args.slice()[0];

        // Validate: argument must be a string literal
        if !matches!(arg.data, Data::EString(..)) {
            p.log().add_error(
                Some(p.source),
                arg.loc,
                b"feature() argument must be a string literal",
            );
            return Some(p.new_expr(E::Boolean { value: false }, loc));
        }

        // Check if the feature flag is enabled
        // Use the underlying string data directly without allocation.
        // Feature flag names should be ASCII identifiers, so UTF-16 is unexpected.
        let flag_string = arg.data.e_string().expect("infallible: variant checked");
        if flag_string.is_utf16 {
            p.log().add_error(
                Some(p.source),
                arg.loc,
                b"feature() flag name must be an ASCII string",
            );
            return Some(p.new_expr(E::Boolean { value: false }, loc));
        }

        // feature() can only be used directly in an if statement or ternary condition
        if !p.in_branch_condition {
            p.log()
                .add_error(
                    Some(p.source),
                    loc,
                    b"feature() from \"bun:bundle\" can only be used directly in an if statement or ternary condition",
                );
            return Some(p.new_expr(E::Boolean { value: false }, loc));
        }

        let is_enabled: bool = p
            .options
            .features
            .bundler_feature_flags
            .as_ref()
            .is_some_and(|flags| flags.contains(&flag_string.data));
        Some(Expr {
            data: Data::EBranchBoolean(E::Boolean { value: is_enabled }),
            loc,
        })
    }
    #[inline(never)] // PERF(port:frame): see e_jsx_element.
    fn e_arrow(p: &mut Self, e: &mut Expr, in_: ExprIn) {
        let expr = *e;
        let _ = in_;
        let mut e_ = expr.data.e_arrow().expect("infallible: variant checked");
        if p.is_revisit_for_substitution {
            return;
        }

        // Zig: `std.mem.toBytes(...)` then `bytesToValue(...)` to save/restore. In Rust the struct
        // is `Copy`/`Clone`, so just copy it.
        // PORT NOTE: reshaped — toBytes/bytesToValue → plain copy.
        let old_fn_or_arrow_data = p.fn_or_arrow_data_visit;
        p.fn_or_arrow_data_visit = FnOrArrowDataVisit {
            is_arrow: true,
            is_async: e_.is_async,
            ..Default::default()
        };

        // Mark if we're inside an async arrow function. This value should be true
        // even if we're inside multiple arrow functions and the closest inclosing
        // arrow function isn't async, as long as at least one enclosing arrow
        // function within the current enclosing function is async.
        let old_inside_async_arrow_fn = p.fn_only_data_visit.is_inside_async_arrow_fn;
        p.fn_only_data_visit.is_inside_async_arrow_fn =
            e_.is_async || p.fn_only_data_visit.is_inside_async_arrow_fn;

        p.push_scope_for_visit_pass(js_ast::scope::Kind::FunctionArgs, expr.loc)
            .expect("unreachable");
        // PERF(port): was arena dupe — profile in Phase B
        let dupe: &'a mut [Stmt] = p.arena.alloc_slice_copy(e_.body.stmts.slice());

        let args_mut: &mut [G::Arg] = e_.args.slice_mut();
        p.visit_args(
            args_mut,
            VisitArgsOpts {
                has_rest_arg: e_.has_rest_arg,
                body: dupe,
                is_unique_formal_parameters: true,
            },
        );
        p.push_scope_for_visit_pass(js_ast::scope::Kind::FunctionBody, e_.body.loc)
            .expect("unreachable");

        // Zig: `const prev = p.react_refresh.hook_ctx_storage; defer ... = prev; ... = &react_hook_data;`
        // hook_ctx_storage is a raw NonNull so a stack local is fine; we manually restore `prev`
        // on every exit path below (Zig used `defer`).
        let mut react_hook_data: Option<crate::parser::HookContext> = None;
        let prev_hook_ctx = p.react_refresh.hook_ctx_storage;
        p.react_refresh.hook_ctx_storage = Some(core::ptr::NonNull::from(&mut react_hook_data));

        // TODO(port): Zig `ListManaged(Stmt).fromOwnedSlice(p.arena, dupe)` takes ownership of
        // the arena slice without copying. bumpalo Vec cannot adopt an existing slice; Phase B may
        // want a custom arena Vec that can. Left as a copy with PERF note.
        // PERF(port): was fromOwnedSlice (no copy) — profile in Phase B
        let mut stmts_list = bun_alloc::vec_from_iter_in(dupe.iter().copied(), p.arena);
        let mut temp_opts = PrependTempRefsOpts {
            kind: crate::parser::StmtsKind::FnBody,
            ..Default::default()
        };
        p.visit_stmts_and_prepend_temp_refs(&mut stmts_list, &mut temp_opts)
            .expect("unreachable");
        // Zig: `p.arena.free(e_.body.stmts)` — arena-backed, no individual free in Rust.
        p.pop_scope();
        p.pop_scope();

        p.fn_only_data_visit.is_inside_async_arrow_fn = old_inside_async_arrow_fn;
        p.fn_or_arrow_data_visit = old_fn_or_arrow_data;

        // Zig: defer p.react_refresh.hook_ctx_storage = prev — restore before any further `p.*`
        // call so the stack-local pointer never escapes this frame.
        p.react_refresh.hook_ctx_storage = prev_hook_ctx;

        if let Some(hook) = react_hook_data.as_mut() {
            'try_mark_hook: {
                if p.nearest_stmt_list.is_none() {
                    break 'try_mark_hook;
                }
                let decl = p.get_react_refresh_hook_signal_decl(hook.signature_cb);
                p.nearest_stmt_list_mut().unwrap().push(decl);

                p.handle_react_refresh_post_visit_function_body(&mut stmts_list, hook);
                e_.body.stmts = bun_ast::StoreSlice::new_mut(stmts_list.into_bump_slice_mut());

                *e = p.get_react_refresh_hook_signal_init(hook, expr);
                return;
            }
        }
        e_.body.stmts = bun_ast::StoreSlice::new_mut(stmts_list.into_bump_slice_mut());
    }
    #[inline(never)] // PERF(port:frame): see e_jsx_element.
    fn e_function(p: &mut Self, e: &mut Expr, in_: ExprIn) {
        let expr = *e;
        let _ = in_;
        let mut e_ = expr.data.e_function().expect("infallible: variant checked");
        if p.is_revisit_for_substitution {
            return;
        }

        // Zig: `const prev = p.react_refresh.hook_ctx_storage; defer ... = prev; ... = &react_hook_data;`
        let mut react_hook_data: Option<crate::parser::HookContext> = None;
        let prev_hook_ctx = p.react_refresh.hook_ctx_storage;
        p.react_refresh.hook_ctx_storage = Some(core::ptr::NonNull::from(&mut react_hook_data));

        // Spec (visitExpr.zig e_function): visitFunc(e_.func, expr.loc) — for function
        // *expressions* the .function_args scope is pushed at the `function` keyword loc
        // (parseFn.zig:364), not at open_parens_loc. (s_function correctly uses open_parens_loc.)
        e_.func = p.visit_func(core::mem::take(&mut e_.func), expr.loc);

        // Zig: defer p.react_refresh.hook_ctx_storage = prev — restore now so the stack-local
        // pointer never escapes this frame.
        p.react_refresh.hook_ctx_storage = prev_hook_ctx;

        // Remove unused function names when minifying (only when bundling is enabled)
        // unless --keep-names is specified
        if p.options.features.minify_syntax
            && p.options.bundle
            && !p.options.features.minify_keep_names
            // SAFETY: current_scope is a live arena ptr while the parser exists.
            && !p.current_scope().contains_direct_eval
            && e_.func.name.is_some()
            && e_.func.name.unwrap().ref_.is_some()
            && p.symbols[e_.func.name.unwrap().ref_.expect("infallible: ref bound").inner_index() as usize]
                .use_count_estimate
                == 0
        {
            e_.func.name = None;
        }

        let mut final_expr = expr;
        let mut replaced = false;

        if let Some(hook) = react_hook_data.as_mut() {
            'try_mark_hook: {
                if p.nearest_stmt_list.is_none() {
                    break 'try_mark_hook;
                }
                let decl = p.get_react_refresh_hook_signal_decl(hook.signature_cb);
                p.nearest_stmt_list_mut().unwrap().push(decl);
                final_expr = p.get_react_refresh_hook_signal_init(hook, expr);
                replaced = true;
            }
        }

        if let Some(name) = e_.func.name {
            final_expr = p.keep_expr_symbol_name(
                final_expr,
                // SAFETY: original_name is arena-owned, valid for 'a.
                p.symbols[name.ref_.expect("infallible: ref bound").inner_index() as usize]
                    .original_name
                    .slice(),
            );
            replaced = true;
        }

        // Only write back through &mut when one of the wrapping branches fired; on the
        // common fall-through `final_expr` is the entry snapshot and the 24B store is dead.
        if replaced {
            *e = final_expr;
        }
    }
    #[inline(never)] // PERF(port:frame): see e_jsx_element.
    fn e_class(p: &mut Self, e: &mut Expr, in_: ExprIn) {
        let expr = *e;
        let _ = in_;
        let mut e_ = expr.data.e_class().expect("infallible: variant checked");
        if p.is_revisit_for_substitution {
            return;
        }

        // Save name from assignment context before visiting (nested visits may overwrite it)
        let decorator_name_from_context = p.decorator_class_name;
        p.decorator_class_name = None;

        // Zig: `p.visitClass(expr.loc, e_, Ref.None)`
        let _ = p.visit_class(expr.loc, &mut e_, Ref::NONE);

        // Lower standard decorators for class expressions
        if e_.should_lower_standard_decorators {
            *e = p.lower_standard_decorators_expr(&mut e_, expr.loc, decorator_name_from_context);
            return;
        }

        // Remove unused class names when minifying (only when bundling is enabled)
        // unless --keep-names is specified
        if p.options.features.minify_syntax
            && p.options.bundle
            && !p.options.features.minify_keep_names
            // SAFETY: current_scope is a live arena ptr while the parser exists.
            && !p.current_scope().contains_direct_eval
            && e_.class_name.is_some()
            && e_.class_name.unwrap().ref_.is_some()
            && p.symbols[e_.class_name.unwrap().ref_.expect("infallible: ref bound").inner_index() as usize]
                .use_count_estimate
                == 0
        {
            e_.class_name = None;
        }
    }
}
