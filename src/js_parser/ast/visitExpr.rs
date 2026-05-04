use core::ffi::c_void;
use std::io::Write as _;

use bstr::BStr;

use bun_collections::BabyList;
use bun_core::Environment;
use bun_logger as logger;
use bun_str::strings;

use bun_js_parser::ast as js_ast;
use bun_js_parser::ast::{
    E, Expr, ExprNodeIndex, ExprNodeList, G, Scope, Stmt, Symbol, B,
};
use bun_js_parser::ast::G::Property;
use bun_js_parser::lexer as js_lexer;
use bun_js_parser::{
    self as js_parser, float_to_int32, options, ExprIn, FnOrArrowDataVisit, IdentifierOpts,
    JSXTransformType, KnownGlobal, Prefill, PrependTempRefsOpts, ReactRefresh, Ref, SideEffects,
    ThenCatchChain, TransposeState, VisitArgsOpts,
};

// TODO(port): `P` in Zig is `js_parser.NewParser_(typescript, jsx, scan_only)` — a comptime
// type-generator returning the parser struct specialized for the three feature flags. In Rust the
// natural shape is `NewParser<const TS: bool, const JSX: JSXTransformType, const SCAN: bool>` and
// these visitor fns become inherent methods on it. Phase B should decide whether to merge this
// impl directly into the parser type. For Phase A we keep the Zig structure: `VisitExpr` is a
// zero-sized marker carrying the const-generic features, and every fn takes `p: &mut P` first.
pub struct VisitExpr<
    const PARSER_FEATURE_TYPESCRIPT: bool,
    const PARSER_FEATURE_JSX: JSXTransformType,
    const PARSER_FEATURE_SCAN_ONLY: bool,
>;

// TODO(port): inherent associated type alias is unstable; Phase B may need a different spelling
// (e.g. make these fns inherent on `NewParser` itself).
type P<
    const PARSER_FEATURE_TYPESCRIPT: bool,
    const PARSER_FEATURE_JSX: JSXTransformType,
    const PARSER_FEATURE_SCAN_ONLY: bool,
> = js_parser::NewParser<PARSER_FEATURE_TYPESCRIPT, PARSER_FEATURE_JSX, PARSER_FEATURE_SCAN_ONLY>;

impl<
        const PARSER_FEATURE_TYPESCRIPT: bool,
        const PARSER_FEATURE_JSX: JSXTransformType,
        const PARSER_FEATURE_SCAN_ONLY: bool,
    > VisitExpr<PARSER_FEATURE_TYPESCRIPT, PARSER_FEATURE_JSX, PARSER_FEATURE_SCAN_ONLY>
{
    // Mirror Zig's associated consts pulled off `P`.
    // TODO(port): these should resolve to `NewParser::<..>::ALLOW_MACROS` etc. once that type is ported.
    const ALLOW_MACROS: bool = js_parser::NewParser::<
        PARSER_FEATURE_TYPESCRIPT,
        PARSER_FEATURE_JSX,
        PARSER_FEATURE_SCAN_ONLY,
    >::ALLOW_MACROS;
    const JSX_TRANSFORM_TYPE: JSXTransformType = PARSER_FEATURE_JSX;
    const ONLY_SCAN_IMPORTS_AND_DO_NOT_VISIT: bool = PARSER_FEATURE_SCAN_ONLY;

    // public for JSNode.JSXWriter usage
    #[inline]
    pub fn visit_expr(
        p: &mut P<PARSER_FEATURE_TYPESCRIPT, PARSER_FEATURE_JSX, PARSER_FEATURE_SCAN_ONLY>,
        expr: Expr,
    ) -> Expr {
        // Zig: `if (only_scan_imports_and_do_not_visit) @compileError(...)`
        const _: () = assert!(
            !PARSER_FEATURE_SCAN_ONLY,
            "only_scan_imports_and_do_not_visit must not run this."
        );

        // hopefully this gets tailed
        p.visit_expr_in_out(expr, ExprIn::default())
    }

    pub fn visit_expr_in_out(
        p: &mut P<PARSER_FEATURE_TYPESCRIPT, PARSER_FEATURE_JSX, PARSER_FEATURE_SCAN_ONLY>,
        expr: Expr,
        in_: ExprIn,
    ) -> Expr {
        if in_.assign_target != js_ast::AssignTarget::None && !p.is_valid_assignment_target(expr) {
            p.log
                .add_error(p.source, expr.loc, b"Invalid assignment target")
                .expect("unreachable");
        }

        // Zig dispatches via `inline else => |tag| if (comptime @hasDecl(visitors, @tagName(tag)))`.
        // Rust has no struct-decl reflection; expand to an explicit match over the tags that have
        // a visitor defined below. Any tag without a visitor returns `expr` unchanged.
        match Expr::Tag::from(&expr.data) {
            Expr::Tag::ENewTarget => Self::e_new_target(p, expr, in_),
            Expr::Tag::EString => Self::e_string(p, expr, in_),
            Expr::Tag::ENumber => Self::e_number(p, expr, in_),
            Expr::Tag::EThis => Self::e_this(p, expr, in_),
            Expr::Tag::EImportMeta => Self::e_import_meta(p, expr, in_),
            Expr::Tag::ESpread => Self::e_spread(p, expr, in_),
            Expr::Tag::EIdentifier => Self::e_identifier(p, expr, in_),
            Expr::Tag::EJsxElement => Self::e_jsx_element(p, expr, in_),
            Expr::Tag::ETemplate => Self::e_template(p, expr, in_),
            Expr::Tag::EBinary => Self::e_binary(p, expr, in_),
            Expr::Tag::EIndex => Self::e_index(p, expr, in_),
            Expr::Tag::EUnary => Self::e_unary(p, expr, in_),
            Expr::Tag::EDot => Self::e_dot(p, expr, in_),
            Expr::Tag::EIf => Self::e_if(p, expr, in_),
            Expr::Tag::EAwait => Self::e_await(p, expr, in_),
            Expr::Tag::EYield => Self::e_yield(p, expr, in_),
            Expr::Tag::EArray => Self::e_array(p, expr, in_),
            Expr::Tag::EObject => Self::e_object(p, expr, in_),
            Expr::Tag::EImport => Self::e_import(p, expr, in_),
            Expr::Tag::ECall => Self::e_call(p, expr, in_),
            Expr::Tag::ENew => Self::e_new(p, expr, in_),
            Expr::Tag::EArrow => Self::e_arrow(p, expr, in_),
            Expr::Tag::EFunction => Self::e_function(p, expr, in_),
            Expr::Tag::EClass => Self::e_class(p, expr, in_),
            _ => expr,
        }
    }

    // ─── visitors ───────────────────────────────────────────────────────────
    // In Zig these live on a nested `const visitors = struct { ... }`; in Rust they are private
    // associated fns on this impl so they can see the const-generic feature params.

    fn e_new_target(
        _: &mut P<PARSER_FEATURE_TYPESCRIPT, PARSER_FEATURE_JSX, PARSER_FEATURE_SCAN_ONLY>,
        expr: Expr,
        _: ExprIn,
    ) -> Expr {
        // this error is not necessary and it is causing breakages
        // if (!p.fn_only_data_visit.is_new_target_allowed) {
        //     p.log.addRangeError(p.source, target.range, "Cannot use \"new.target\" here") catch unreachable;
        // }
        expr
    }

    fn e_string(
        _: &mut P<PARSER_FEATURE_TYPESCRIPT, PARSER_FEATURE_JSX, PARSER_FEATURE_SCAN_ONLY>,
        expr: Expr,
        _: ExprIn,
    ) -> Expr {
        // If you're using this, you're probably not using 0-prefixed legacy octal notation
        // if e.LegacyOctalLoc.Start > 0 {
        expr
    }

    fn e_number(
        _: &mut P<PARSER_FEATURE_TYPESCRIPT, PARSER_FEATURE_JSX, PARSER_FEATURE_SCAN_ONLY>,
        expr: Expr,
        _: ExprIn,
    ) -> Expr {
        // idc about legacy octal loc
        expr
    }

    fn e_this(
        p: &mut P<PARSER_FEATURE_TYPESCRIPT, PARSER_FEATURE_JSX, PARSER_FEATURE_SCAN_ONLY>,
        expr: Expr,
        _: ExprIn,
    ) -> Expr {
        if let Some(exp) = p.value_for_this(expr.loc) {
            return exp;
        }

        //                 // Capture "this" inside arrow functions that will be lowered into normal
        // // function expressions for older language environments
        // if p.fnOrArrowDataVisit.isArrow && p.options.unsupportedJSFeatures.Has(compat.Arrow) && p.fnOnlyDataVisit.isThisNested {
        //     return js_ast.Expr{Loc: expr.Loc, Data: &js_ast.EIdentifier{Ref: p.captureThis()}}, exprOut{}
        // }
        expr
    }

    fn e_import_meta(
        p: &mut P<PARSER_FEATURE_TYPESCRIPT, PARSER_FEATURE_JSX, PARSER_FEATURE_SCAN_ONLY>,
        expr: Expr,
        in_: ExprIn,
    ) -> Expr {
        // TODO: delete import.meta might not work
        let is_delete_target = matches!(p.delete_target, Expr::Data::EImportMeta(..));

        if let Some(meta) = p.define.dots.get(b"meta".as_slice()) {
            for define in meta {
                // TODO: clean up how we do define matches
                if p.is_dot_define_match(expr, define.parts) {
                    // Substitute user-specified defines
                    return p.value_for_define(expr.loc, in_.assign_target, is_delete_target, &define.data);
                }
            }
        }

        expr
    }

    fn e_spread(
        p: &mut P<PARSER_FEATURE_TYPESCRIPT, PARSER_FEATURE_JSX, PARSER_FEATURE_SCAN_ONLY>,
        expr: Expr,
        _: ExprIn,
    ) -> Expr {
        let exp = expr.data.e_spread();
        exp.value = p.visit_expr(exp.value);
        expr
    }

    fn e_identifier(
        p: &mut P<PARSER_FEATURE_TYPESCRIPT, PARSER_FEATURE_JSX, PARSER_FEATURE_SCAN_ONLY>,
        expr: Expr,
        in_: ExprIn,
    ) -> Expr {
        let mut e_ = expr.data.e_identifier();
        let is_delete_target = matches!(Expr::Tag::from(&p.delete_target), Expr::Tag::EIdentifier)
            && e_.ref_.eql(p.delete_target.e_identifier().ref_);

        let name = p.load_name_from_ref(e_.ref_);
        if p.is_strict_mode() && js_lexer::StrictModeReservedWords::has(name) {
            p.mark_strict_mode_feature(
                js_parser::StrictModeFeature::ReservedWord,
                js_lexer::range_of_identifier(p.source, expr.loc),
                name,
            )
            .expect("unreachable");
        }

        let result = p.find_symbol(expr.loc, name).expect("unreachable");

        e_.must_keep_due_to_with_stmt = result.is_inside_with_scope;
        e_.ref_ = result.ref_;

        // Handle assigning to a constant
        if in_.assign_target != js_ast::AssignTarget::None {
            if p.symbols.as_slice()[result.ref_.inner_index()].kind == Symbol::Kind::Constant {
                // TODO: silence this for runtime transpiler
                let r = js_lexer::range_of_identifier(p.source, expr.loc);
                // PERF(port): was arena alloc — profile in Phase B
                let notes = p.allocator.alloc_slice_fill_with(1, |_| logger::Data {
                    text: {
                        let mut v = bumpalo::collections::Vec::new_in(p.allocator);
                        write!(
                            &mut v,
                            "The symbol \"{}\" was declared a constant here:",
                            BStr::new(name)
                        )
                        .unwrap();
                        v.into_bump_slice()
                    },
                    location: logger::Location::init_or_null(
                        p.source,
                        js_lexer::range_of_identifier(p.source, result.declare_loc.unwrap()),
                    ),
                });

                let is_error = p.const_values.contains(&result.ref_) || p.options.bundle;
                match is_error {
                    true => p
                        .log
                        .add_range_error_fmt_with_notes(
                            p.source,
                            r,
                            p.allocator,
                            notes,
                            format_args!(
                                "Cannot assign to \"{}\" because it is a constant",
                                BStr::new(name)
                            ),
                        )
                        .expect("unreachable"),

                    false => p
                        .log
                        .add_range_error_fmt_with_notes(
                            p.source,
                            r,
                            p.allocator,
                            notes,
                            format_args!(
                                "This assignment will throw because \"{}\" is a constant",
                                BStr::new(name)
                            ),
                        )
                        .expect("unreachable"),
                }
            } else if p.exports_ref.eql(e_.ref_) {
                // Assigning to `exports` in a CommonJS module must be tracked to undo the
                // `module.exports` -> `exports` optimization.
                p.commonjs_module_exports_assigned_deoptimized = true;
            }

            p.symbols.as_mut_slice()[result.ref_.inner_index()].has_been_assigned_to = true;
        }

        let mut original_name: Option<&[u8]> = None;

        // Substitute user-specified defines for unbound symbols
        if p.symbols.as_slice()[e_.ref_.inner_index()].kind == Symbol::Kind::Unbound
            && !result.is_inside_with_scope
            && !is_delete_target
        {
            if let Some(def) = p.define.for_identifier(name) {
                if !def.valueless() {
                    let newvalue =
                        p.value_for_define(expr.loc, in_.assign_target, is_delete_target, def);

                    // Don't substitute an identifier for a non-identifier if this is an
                    // assignment target, since it'll cause a syntax error
                    if matches!(Expr::Tag::from(&newvalue.data), Expr::Tag::EIdentifier)
                        || in_.assign_target == js_ast::AssignTarget::None
                    {
                        p.ignore_usage(e_.ref_);
                        return newvalue;
                    }

                    original_name = def.original_name();
                }

                // Copy the side effect flags over in case this expression is unused
                if def.can_be_removed_if_unused() {
                    e_.can_be_removed_if_unused = true;
                }
                if def.call_can_be_unwrapped_if_unused() == js_ast::CallUnwrap::IfUnused
                    && !p.options.ignore_dce_annotations
                {
                    e_.call_can_be_unwrapped_if_unused = true;
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
                if !(matches!(Expr::Tag::from(&p.call_target), Expr::Tag::EIdentifier)
                    && expr
                        .data
                        .e_identifier()
                        .ref_
                        .eql(p.call_target.e_identifier().ref_))
                    && p.options.features.allow_runtime
                {
                    p.record_usage_of_runtime_require();
                }

                return p.value_for_require(expr.loc);
            }
        }

        p.handle_identifier(
            expr.loc,
            e_,
            original_name,
            IdentifierOpts {
                assign_target: in_.assign_target,
                is_delete_target,
                is_call_target: matches!(Expr::Tag::from(&p.call_target), Expr::Tag::EIdentifier)
                    && expr
                        .data
                        .e_identifier()
                        .ref_
                        .eql(p.call_target.e_identifier().ref_),
                was_originally_identifier: true,
                ..Default::default()
            },
        )
    }

    fn e_jsx_element(
        p: &mut P<PARSER_FEATURE_TYPESCRIPT, PARSER_FEATURE_JSX, PARSER_FEATURE_SCAN_ONLY>,
        expr: Expr,
        _: ExprIn,
    ) -> Expr {
        let e_ = expr.data.e_jsx_element();
        // Zig: `switch (comptime jsx_transform_type)` — const-generic enum dispatch.
        match Self::JSX_TRANSFORM_TYPE {
            JSXTransformType::React => {
                let tag: Expr = 'tagger: {
                    if let Some(_tag) = e_.tag {
                        break 'tagger p.visit_expr(_tag);
                    } else {
                        if p.options.jsx.runtime == options::JSX::Runtime::Classic {
                            break 'tagger p
                                .jsx_strings_to_member_expression(expr.loc, p.options.jsx.fragment)
                                .expect("unreachable");
                        }

                        break 'tagger p.jsx_import(js_parser::JSXImport::Fragment, expr.loc);
                    }
                };

                let all_props: &mut [G::Property] = e_.properties.slice_mut();
                for property in all_props {
                    if property.kind != G::Property::Kind::Spread {
                        property.key = Some(p.visit_expr(property.key.unwrap()));
                    }

                    if property.value.is_some() {
                        property.value = Some(p.visit_expr(property.value.unwrap()));
                    }

                    if property.initializer.is_some() {
                        property.initializer = Some(p.visit_expr(property.initializer.unwrap()));
                    }
                }

                let runtime = if p.options.jsx.runtime == options::JSX::Runtime::Automatic {
                    options::JSX::Runtime::Automatic
                } else {
                    options::JSX::Runtime::Classic
                };
                let is_key_after_spread =
                    e_.flags.contains(js_ast::JSXElement::Flag::IsKeyAfterSpread);
                let children_count = e_.children.len;

                // TODO: maybe we should split these into two different AST Nodes
                // That would reduce the amount of allocations a little
                if runtime == options::JSX::Runtime::Classic || is_key_after_spread {
                    // Arguments to createElement()
                    let mut args =
                        BabyList::<Expr>::with_capacity_in(p.allocator, 2 + children_count as usize);
                    // PERF(port): was assume_capacity
                    args.push(tag);

                    let num_props = e_.properties.len;
                    if num_props > 0 {
                        // PERF(port): was arena alloc + bun.copy — profile in Phase B
                        let props = p.allocator.alloc_slice_copy(e_.properties.slice());
                        // PERF(port): was assume_capacity
                        args.push(p.new_expr(
                            E::Object {
                                properties: G::Property::List::from_owned_slice(props),
                                ..Default::default()
                            },
                            expr.loc,
                        ));
                    } else {
                        // PERF(port): was assume_capacity
                        args.push(p.new_expr(E::Null {}, expr.loc));
                    }

                    let children_elements = &e_.children.slice()[0..children_count as usize];
                    for child in children_elements {
                        let arg = p.visit_expr(*child);
                        if !matches!(arg.data, Expr::Data::EMissing(..)) {
                            // PERF(port): was assume_capacity
                            args.push(arg);
                        }
                    }

                    let target = p
                        .jsx_strings_to_member_expression(expr.loc, p.options.jsx.factory)
                        .expect("unreachable");

                    // Call createElement()
                    return p.new_expr(
                        E::Call {
                            target: if runtime == options::JSX::Runtime::Classic {
                                target
                            } else {
                                p.jsx_import(js_parser::JSXImport::CreateElement, expr.loc)
                            },
                            args,
                            // Enable tree shaking
                            can_be_unwrapped_if_unused: if !p.options.ignore_dce_annotations
                                && !p.options.jsx.side_effects
                            {
                                js_ast::CallUnwrap::IfUnused
                            } else {
                                js_ast::CallUnwrap::Never
                            },
                            close_paren_loc: e_.close_tag_loc,
                            ..Default::default()
                        },
                        expr.loc,
                    );
                }
                // function jsxDEV(type, config, maybeKey, source, self) {
                else if runtime == options::JSX::Runtime::Automatic {
                    // --- These must be done in all cases --
                    let allocator = p.allocator;
                    let mut props = &mut e_.properties;

                    let maybe_key_value: Option<ExprNodeIndex> = if e_.key_prop_index > -1 {
                        props
                            .ordered_remove(
                                u32::try_from(e_.key_prop_index).unwrap() as usize
                            )
                            .value
                    } else {
                        None
                    };

                    // arguments needs to be like
                    // {
                    //    ...props,
                    //    children: [el1, el2]
                    // }

                    {
                        let mut last_child: u32 = 0;
                        let children = &e_.children.slice()[0..children_count as usize];
                        for child in children {
                            // SAFETY: last_child < children_count <= e_.children.len; ptr is valid
                            unsafe {
                                *e_.children.ptr.add(last_child as usize) = p.visit_expr(*child);
                            }
                            // if tree-shaking removes the element, we must also remove it here.
                            last_child += u32::from(!matches!(
                                // SAFETY: same index just written above
                                unsafe { (*e_.children.ptr.add(last_child as usize)).data },
                                Expr::Data::EMissing(..)
                            ));
                        }
                        e_.children.len = last_child;
                    }

                    let children_key = Expr {
                        // SAFETY: JSX_CHILDREN_KEY_DATA is a process-static Expr::Data
                        data: unsafe { core::ptr::read(&JSX_CHILDREN_KEY_DATA) },
                        loc: expr.loc,
                    };
                    // TODO(port): jsxChildrenKeyData in Zig is a mutable `var` of `Expr.Data` that
                    // points at `Prefill.String.Children`. In Rust this is modeled as a static
                    // `Expr::Data`; verify cloning semantics in Phase B.

                    // Optimization: if the only non-child prop is a spread object
                    // we can just pass the object as the first argument
                    // this goes as deep as there are spreads
                    // <div {{...{...{...{...foo}}}}} />
                    // ->
                    // <div {{...foo}} />
                    // jsx("div", {...foo})
                    while props.len == 1
                        && props.at(0).kind == G::Property::Kind::Spread
                        && matches!(props.at(0).value.unwrap().data, Expr::Data::EObject(..))
                    {
                        // PORT NOTE: reshaped for borrowck — Zig reassigns `props` to point inside
                        // the spread object's properties; we do the same via raw access.
                        props = &mut props.at_mut(0).value.as_mut().unwrap().data.e_object_mut().properties;
                    }

                    // Typescript defines static jsx as children.len > 1 or single spread
                    // https://github.com/microsoft/TypeScript/blob/d4fbc9b57d9aa7d02faac9b1e9bb7b37c687f6e9/src/compiler/transformers/jsx.ts#L340
                    let is_static_jsx = e_.children.len > 1
                        || (e_.children.len == 1
                            && matches!(
                                // SAFETY: len == 1 ⇒ index 0 valid
                                unsafe { (*e_.children.ptr).data },
                                Expr::Data::ESpread(..)
                            ));

                    if is_static_jsx {
                        props.push_in(
                            allocator,
                            G::Property {
                                key: Some(children_key),
                                value: Some(p.new_expr(
                                    E::Array {
                                        items: e_.children,
                                        is_single_line: e_.children.len < 2,
                                        ..Default::default()
                                    },
                                    e_.close_tag_loc,
                                )),
                                ..Default::default()
                            },
                        );
                    } else if e_.children.len == 1 {
                        props.push_in(
                            allocator,
                            G::Property {
                                key: Some(children_key),
                                // SAFETY: len == 1 ⇒ index 0 valid
                                value: Some(unsafe { *e_.children.ptr }),
                                ..Default::default()
                            },
                        );
                    }

                    // Either:
                    // jsxDEV(type, arguments, key, isStaticChildren, source, self)
                    // jsx(type, arguments, key)
                    let args_len = if p.options.jsx.development {
                        6usize
                    } else {
                        2usize + usize::from(maybe_key_value.is_some())
                    };
                    // PERF(port): was arena alloc — profile in Phase B
                    let args = p
                        .allocator
                        .alloc_slice_fill_with(args_len, |_| Expr::default());
                    args[0] = tag;

                    args[1] = p.new_expr(
                        E::Object {
                            properties: *props,
                            ..Default::default()
                        },
                        expr.loc,
                    );

                    if let Some(key) = maybe_key_value {
                        args[2] = key;
                    } else if p.options.jsx.development {
                        // if (maybeKey !== undefined)
                        args[2] = Expr {
                            loc: expr.loc,
                            data: Expr::Data::EUndefined(E::Undefined {}),
                        };
                    }

                    if p.options.jsx.development {
                        // is the return type of the first child an array?
                        // It's dynamic
                        // Else, it's static
                        args[3] = Expr {
                            loc: expr.loc,
                            data: Expr::Data::EBoolean(E::Boolean {
                                value: is_static_jsx,
                            }),
                        };

                        args[4] = p.new_expr(E::Undefined {}, expr.loc);
                        args[5] = Expr {
                            data: Prefill::Data::THIS,
                            loc: expr.loc,
                        };
                    }

                    return p.new_expr(
                        E::Call {
                            target: p.jsx_import_automatic(expr.loc, is_static_jsx),
                            args: ExprNodeList::from_owned_slice(args),
                            // Enable tree shaking
                            can_be_unwrapped_if_unused: if !p.options.ignore_dce_annotations
                                && !p.options.jsx.side_effects
                            {
                                js_ast::CallUnwrap::IfUnused
                            } else {
                                js_ast::CallUnwrap::Never
                            },
                            was_jsx_element: true,
                            close_paren_loc: e_.close_tag_loc,
                            ..Default::default()
                        },
                        expr.loc,
                    );
                } else {
                    unreachable!();
                }
            }
            _ => unreachable!(),
        }
        #[allow(unreachable_code)]
        expr
    }

    fn e_template(
        p: &mut P<PARSER_FEATURE_TYPESCRIPT, PARSER_FEATURE_JSX, PARSER_FEATURE_SCAN_ONLY>,
        expr: Expr,
        _: ExprIn,
    ) -> Expr {
        let e_ = expr.data.e_template();
        if let Some(tag) = e_.tag {
            e_.tag = Some(p.visit_expr(tag));

            if Self::ALLOW_MACROS {
                let ref_ = match &e_.tag.unwrap().data {
                    Expr::Data::EImportIdentifier(ident) => Some(ident.ref_),
                    Expr::Data::EDot(dot) => {
                        if let Expr::Data::EIdentifier(id) = &dot.target.data {
                            Some(id.ref_)
                        } else {
                            None
                        }
                    }
                    _ => None,
                };

                if ref_.is_some() && !p.options.features.is_macro_runtime {
                    if let Some(macro_ref_data) = p.macro_.refs.get(&ref_.unwrap()) {
                        p.ignore_usage(ref_.unwrap());
                        if p.is_control_flow_dead {
                            return p.new_expr(E::Undefined {}, e_.tag.unwrap().loc);
                        }

                        // this ordering incase someone wants to use a macro in a node_module conditionally
                        if p.options.features.no_macros {
                            p.log
                                .add_error(p.source, tag.loc, b"Macros are disabled")
                                .expect("unreachable");
                            return p.new_expr(E::Undefined {}, e_.tag.unwrap().loc);
                        }

                        if p.source.path.is_node_module() {
                            p.log
                                .add_error(
                                    p.source,
                                    expr.loc,
                                    b"For security reasons, macros cannot be run from node_modules.",
                                )
                                .expect("unreachable");
                            return p.new_expr(E::Undefined {}, expr.loc);
                        }

                        p.macro_call_count += 1;
                        let name = macro_ref_data
                            .name
                            .unwrap_or_else(|| e_.tag.unwrap().data.e_dot().name);
                        let record = &p.import_records.as_slice()[macro_ref_data.import_record_id];
                        // We must visit it to convert inline_identifiers and record usage
                        let macro_result = match p.options.macro_context.call(
                            record.path.text,
                            p.source.path.source_dir(),
                            p.log,
                            p.source,
                            record.range,
                            expr,
                            name,
                        ) {
                            Ok(v) => v,
                            Err(_) => return expr,
                        };

                        if !matches!(macro_result.data, Expr::Data::ETemplate(..)) {
                            return p.visit_expr(macro_result);
                        }
                    }
                }
            }
        }

        for part in e_.parts.iter_mut() {
            part.value = p.visit_expr(part.value);
        }

        // When mangling, inline string values into the template literal. Note that
        // it may no longer be a template literal after this point (it may turn into
        // a plain string literal instead).
        if p.should_fold_typescript_constant_expressions || p.options.features.inlining {
            return e_.fold(p.allocator, expr.loc);
        }
        expr
    }

    fn e_binary(
        p: &mut P<PARSER_FEATURE_TYPESCRIPT, PARSER_FEATURE_JSX, PARSER_FEATURE_SCAN_ONLY>,
        expr: Expr,
        in_: ExprIn,
    ) -> Expr {
        let e_ = expr.data.e_binary();

        // The handling of binary expressions is convoluted because we're using
        // iteration on the heap instead of recursion on the call stack to avoid
        // stack overflow for deeply-nested ASTs.
        type BinaryExpressionVisitor<
            const TS: bool,
            const JSX: JSXTransformType,
            const SCAN: bool,
        > = <P<TS, JSX, SCAN> as js_parser::ParserType>::BinaryExpressionVisitor;
        // TODO(port): ^ Phase B should reference the actual BinaryExpressionVisitor type on P.
        let mut v = BinaryExpressionVisitor::<
            PARSER_FEATURE_TYPESCRIPT,
            PARSER_FEATURE_JSX,
            PARSER_FEATURE_SCAN_ONLY,
        > {
            e: e_,
            loc: expr.loc,
            in_: in_,
            left_in: ExprIn::default(),
        };

        // Everything uses a single stack to reduce allocation overhead. This stack
        // should almost always be very small, and almost all visits should reuse
        // existing memory without allocating anything.
        let stack_bottom = p.binary_expression_stack.len();

        let mut current = Expr {
            data: Expr::Data::EBinary(e_),
            loc: v.loc,
        };

        // Iterate down into the AST along the left node of the binary operation.
        // Continue iterating until we encounter something that's not a binary node.

        loop {
            if let Some(out) = v.check_and_prepare(p) {
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

            let left_binary: Option<&mut E::Binary> =
                if let Expr::Data::EBinary(b) = &mut left.data {
                    Some(b)
                } else {
                    None
                };
            // TODO(port): in Zig `left.data.e_binary` is `*E.Binary` (arena ptr); the Rust shape
            // of Expr::Data::EBinary may be `&'bump mut E::Binary`. Adjust deref in Phase B.

            // Stop iterating if iteration doesn't apply to the left node. This checks
            // the assignment target because "visitExprInOut" has additional behavior
            // in that case that we don't want to miss (before the top-level "switch"
            // statement).
            if left_binary.is_none() || left_in.assign_target != js_ast::AssignTarget::None {
                v.e.left = p.visit_expr_in_out(left, left_in);
                current = v.visit_right_and_finish(p);
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
            };
        }

        // Process all binary operations from the deepest-visited node back toward
        // our original top-level binary operation.
        while p.binary_expression_stack.len() > stack_bottom {
            v = p.binary_expression_stack.pop().unwrap();
            v.e.left = current;
            current = v.visit_right_and_finish(p);
        }

        current
    }

    fn e_index(
        p: &mut P<PARSER_FEATURE_TYPESCRIPT, PARSER_FEATURE_JSX, PARSER_FEATURE_SCAN_ONLY>,
        expr: Expr,
        in_: ExprIn,
    ) -> Expr {
        let e_ = expr.data.e_index();
        let is_call_target = matches!(p.call_target, Expr::Data::EIndex(ref ct) if core::ptr::eq(expr.data.e_index(), ct));
        let is_delete_target = matches!(p.delete_target, Expr::Data::EIndex(ref dt) if core::ptr::eq(expr.data.e_index(), dt));

        // "a['b']" => "a.b"
        if p.options.features.minify_syntax
            && matches!(e_.index.data, Expr::Data::EString(..))
            && e_.index.data.e_string().is_utf8()
            && e_.index.data.e_string().is_identifier(p.allocator)
        {
            let dot = p.new_expr(
                E::Dot {
                    name: e_.index.data.e_string().slice(p.allocator),
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

            return p.visit_expr_in_out(dot, in_);
        }

        let target_visited = p.visit_expr_in_out(
            e_.target,
            ExprIn {
                has_chain_parent: e_.optional_chain == Some(js_ast::OptionalChain::Continuation),
                ..Default::default()
            },
        );
        e_.target = target_visited;

        match e_.index.data {
            Expr::Data::EPrivateIdentifier(_private) => {
                let mut private = _private;
                let name = p.load_name_from_ref(private.ref_);
                let result = p.find_symbol(e_.index.loc, name).expect("unreachable");
                private.ref_ = result.ref_;

                // Unlike regular identifiers, there are no unbound private identifiers
                let kind: Symbol::Kind = p.symbols.as_slice()[result.ref_.inner_index()].kind;
                let mut r: logger::Range;
                if !Symbol::is_kind_private(kind) {
                    r = logger::Range {
                        loc: e_.index.loc,
                        len: i32::try_from(name.len()).unwrap(),
                    };
                    p.log
                        .add_range_error_fmt(
                            p.source,
                            r,
                            p.allocator,
                            format_args!(
                                "Private name \"{}\" must be declared in an enclosing class",
                                BStr::new(name)
                            ),
                        )
                        .expect("unreachable");
                } else {
                    if in_.assign_target != js_ast::AssignTarget::None
                        && (kind == Symbol::Kind::PrivateMethod
                            || kind == Symbol::Kind::PrivateStaticMethod)
                    {
                        r = logger::Range {
                            loc: e_.index.loc,
                            len: i32::try_from(name.len()).unwrap(),
                        };
                        p.log
                            .add_range_warning_fmt(
                                p.source,
                                r,
                                p.allocator,
                                format_args!(
                                    "Writing to read-only method \"{}\" will throw",
                                    BStr::new(name)
                                ),
                            )
                            .expect("unreachable");
                    } else if in_.assign_target != js_ast::AssignTarget::None
                        && (kind == Symbol::Kind::PrivateGet
                            || kind == Symbol::Kind::PrivateStaticGet)
                    {
                        r = logger::Range {
                            loc: e_.index.loc,
                            len: i32::try_from(name.len()).unwrap(),
                        };
                        p.log
                            .add_range_warning_fmt(
                                p.source,
                                r,
                                p.allocator,
                                format_args!(
                                    "Writing to getter-only property \"{}\" will throw",
                                    BStr::new(name)
                                ),
                            )
                            .expect("unreachable");
                    } else if in_.assign_target != js_ast::AssignTarget::Replace
                        && (kind == Symbol::Kind::PrivateSet
                            || kind == Symbol::Kind::PrivateStaticSet)
                    {
                        r = logger::Range {
                            loc: e_.index.loc,
                            len: i32::try_from(name.len()).unwrap(),
                        };
                        p.log
                            .add_range_warning_fmt(
                                p.source,
                                r,
                                p.allocator,
                                format_args!(
                                    "Reading from setter-only property \"{}\" will throw",
                                    BStr::new(name)
                                ),
                            )
                            .expect("unreachable");
                    }
                }

                e_.index = Expr {
                    data: Expr::Data::EPrivateIdentifier(private),
                    loc: e_.index.loc,
                };
            }
            _ => {
                let index = p.visit_expr(e_.index);
                e_.index = index;

                let unwrapped = e_.index.unwrap_inlined();
                if matches!(unwrapped.data, Expr::Data::EString(..))
                    && unwrapped.data.e_string().is_utf8()
                {
                    // "a['b' + '']" => "a.b"
                    // "enum A { B = 'b' }; a[A.B]" => "a.b"
                    if p.options.features.minify_syntax
                        && unwrapped.data.e_string().is_identifier(p.allocator)
                    {
                        let dot = p.new_expr(
                            E::Dot {
                                name: unwrapped.data.e_string().slice(p.allocator),
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
                        return dot;
                    }

                    // Handle property rewrites to ensure things
                    // like .e_import_identifier tracking works
                    // Reminder that this can only be done after
                    // `target` is visited.
                    if let Some(rewrite) = p.maybe_rewrite_property_access(
                        expr.loc,
                        e_.target,
                        unwrapped.data.e_string().data,
                        unwrapped.loc,
                        js_parser::RewritePropertyAccessOpts {
                            is_call_target,
                            // .is_template_tag = is_template_tag,
                            is_delete_target,
                            assign_target: in_.assign_target,
                            ..Default::default()
                        },
                    ) {
                        return rewrite;
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
                    if let Some(str_) = target.data.as_e_string() {
                        if str_.is_utf8() {
                            let literal = str_.slice(p.allocator);
                            let num: usize = index.data.e_number().to_usize();
                            if cfg!(debug_assertions) {
                                debug_assert!(strings::is_all_ascii(literal));
                            }
                            if num < literal.len() {
                                return p.new_expr(
                                    E::String {
                                        data: &literal[num..num + 1],
                                        ..Default::default()
                                    },
                                    expr.loc,
                                );
                            }
                        }
                    } else if let Some(array) = target.data.as_e_array() {
                        // [x][0] -> x
                        if array.items.len == 1 && number.value == 0.0 {
                            let inlined = *target.data.e_array().items.at(0);
                            if inlined.can_be_inlined_from_property_access() {
                                return inlined;
                            }
                        }

                        // ['a', 'b', 'c'][1] -> 'b'
                        let int: usize = number.value as usize;
                        if int < array.items.len as usize && p.expr_can_be_removed_if_unused(&target)
                        {
                            let inlined = *target.data.e_array().items.at(int);
                            // ['a', , 'c'][1] -> undefined
                            if matches!(inlined.data, Expr::Data::EMissing(..)) {
                                return p.new_expr(E::Undefined {}, inlined.loc);
                            }
                            if cfg!(debug_assertions) {
                                debug_assert!(inlined.can_be_inlined_from_property_access());
                            }
                            return inlined;
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
            && matches!(Expr::Tag::from(&e_.target.data), Expr::Tag::EIdentifier)
            && p.symbols.as_slice()[e_.target.data.e_identifier().ref_.inner_index()].kind
                == Symbol::Kind::Import
        {
            let r = js_lexer::range_of_identifier(p.source, e_.target.loc);
            p.log
                .add_range_error_fmt(
                    p.source,
                    r,
                    p.allocator,
                    format_args!(
                        "Cannot assign to property on import \"{}\"",
                        BStr::new(
                            &p.symbols.as_slice()
                                [e_.target.data.e_identifier().ref_.inner_index()]
                            .original_name
                        )
                    ),
                )
                .expect("unreachable");
        }

        p.new_expr(e_, expr.loc)
    }

    fn e_unary(
        p: &mut P<PARSER_FEATURE_TYPESCRIPT, PARSER_FEATURE_JSX, PARSER_FEATURE_SCAN_ONLY>,
        expr: Expr,
        _: ExprIn,
    ) -> Expr {
        let e_ = expr.data.e_unary();
        match e_.op {
            js_ast::Op::UnTypeof => {
                let id_before = matches!(e_.value.data, Expr::Data::EIdentifier(..));
                e_.value = p.visit_expr_in_out(
                    e_.value,
                    ExprIn {
                        assign_target: e_.op.unary_assign_target(),
                        ..Default::default()
                    },
                );
                let id_after = matches!(e_.value.data, Expr::Data::EIdentifier(..));

                // The expression "typeof (0, x)" must not become "typeof x" if "x"
                // is unbound because that could suppress a ReferenceError from "x"
                if !id_before
                    && id_after
                    && p.symbols.as_slice()[e_.value.data.e_identifier().ref_.inner_index()].kind
                        == Symbol::Kind::Unbound
                {
                    e_.value = Expr::join_with_comma(
                        Expr {
                            loc: e_.value.loc,
                            data: Prefill::Data::ZERO,
                        },
                        e_.value,
                        p.allocator,
                    );
                }

                if matches!(e_.value.data, Expr::Data::ERequireCallTarget(..)) {
                    p.ignore_usage_of_runtime_require();
                    return p.new_expr(
                        E::String {
                            data: b"function",
                            ..Default::default()
                        },
                        expr.loc,
                    );
                }

                if let Some(typeof_) = SideEffects::typeof_(&e_.value.data) {
                    return p.new_expr(
                        E::String {
                            data: typeof_,
                            ..Default::default()
                        },
                        expr.loc,
                    );
                }
            }
            js_ast::Op::UnDelete => {
                e_.value = p.visit_expr_in_out(
                    e_.value,
                    ExprIn {
                        has_chain_parent: true,
                        ..Default::default()
                    },
                );
            }
            _ => {
                e_.value = p.visit_expr_in_out(
                    e_.value,
                    ExprIn {
                        assign_target: e_.op.unary_assign_target(),
                        ..Default::default()
                    },
                );

                // Post-process the unary expression
                match e_.op {
                    js_ast::Op::UnNot => {
                        if p.options.features.minify_syntax {
                            e_.value = SideEffects::simplify_boolean(p, e_.value);
                        }

                        let side_effects = SideEffects::to_boolean(p, &e_.value.data);
                        if side_effects.ok {
                            return p.new_expr(
                                E::Boolean {
                                    value: !side_effects.value,
                                },
                                expr.loc,
                            );
                        }

                        if p.options.features.minify_syntax {
                            if let Some(exp) = e_.value.maybe_simplify_not(p.allocator) {
                                return exp;
                            }
                            if let Expr::Data::EImportMetaMain(m) = &mut e_.value.data {
                                m.inverted = !m.inverted;
                                return e_.value;
                            }
                        }
                    }
                    js_ast::Op::UnCpl => {
                        if p.should_fold_typescript_constant_expressions {
                            if let Some(value) = SideEffects::to_number(&e_.value.data) {
                                return p.new_expr(
                                    E::Number {
                                        value: f64::from(!float_to_int32(value)),
                                    },
                                    expr.loc,
                                );
                            }
                        }
                    }
                    js_ast::Op::UnVoid => {
                        if p.expr_can_be_removed_if_unused(&e_.value) {
                            return p.new_expr(E::Undefined {}, e_.value.loc);
                        }
                    }
                    js_ast::Op::UnPos => {
                        if let Some(num) = SideEffects::to_number(&e_.value.data) {
                            return p.new_expr(E::Number { value: num }, expr.loc);
                        }
                    }
                    js_ast::Op::UnNeg => {
                        if let Some(num) = SideEffects::to_number(&e_.value.data) {
                            return p.new_expr(E::Number { value: -num }, expr.loc);
                        }
                    }

                    ////////////////////////////////////////////////////////////////////////////////
                    js_ast::Op::UnPreDec => {
                        // TODO: private fields
                    }
                    js_ast::Op::UnPreInc => {
                        // TODO: private fields
                    }
                    js_ast::Op::UnPostDec => {
                        // TODO: private fields
                    }
                    js_ast::Op::UnPostInc => {
                        // TODO: private fields
                    }
                    _ => {}
                }

                if p.options.features.minify_syntax {
                    // "-(a, b)" => "a, -b"
                    if !matches!(e_.op, js_ast::Op::UnDelete | js_ast::Op::UnTypeof) {
                        if let Expr::Data::EBinary(comma) = &e_.value.data {
                            if comma.op == js_ast::Op::BinComma {
                                return Expr::join_with_comma(
                                    comma.left,
                                    p.new_expr(
                                        E::Unary {
                                            op: e_.op,
                                            value: comma.right,
                                            flags: e_.flags,
                                        },
                                        comma.right.loc,
                                    ),
                                    p.allocator,
                                );
                            }
                        }
                    }
                }
            }
        }
        expr
    }

    fn e_dot(
        p: &mut P<PARSER_FEATURE_TYPESCRIPT, PARSER_FEATURE_JSX, PARSER_FEATURE_SCAN_ONLY>,
        expr: Expr,
        in_: ExprIn,
    ) -> Expr {
        let e_ = expr.data.e_dot();
        let is_delete_target = matches!(Expr::Tag::from(&p.delete_target), Expr::Tag::EDot)
            && core::ptr::eq(expr.data.e_dot(), p.delete_target.e_dot());
        let is_call_target = matches!(Expr::Tag::from(&p.call_target), Expr::Tag::EDot)
            && core::ptr::eq(expr.data.e_dot(), p.call_target.e_dot());

        if let Some(parts) = p.define.dots.get(e_.name) {
            for define in parts {
                if p.is_dot_define_match(expr, define.parts) {
                    if in_.assign_target == js_ast::AssignTarget::None {
                        // Substitute user-specified defines
                        if !define.data.valueless() {
                            return p.value_for_define(
                                expr.loc,
                                in_.assign_target,
                                is_delete_target,
                                &define.data,
                            );
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

                    if define.data.call_can_be_unwrapped_if_unused() != js_ast::CallUnwrap::Never
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
            && matches!(
                Expr::Tag::from(&p.then_catch_chain.next_target),
                Expr::Tag::EDot
            )
            && core::ptr::eq(p.then_catch_chain.next_target.e_dot(), expr.data.e_dot())
        {
            if e_.name == b"catch" {
                p.then_catch_chain = ThenCatchChain {
                    next_target: e_.target.data,
                    has_catch: true,
                    ..Default::default()
                };
            } else if e_.name == b"then" {
                p.then_catch_chain = ThenCatchChain {
                    next_target: e_.target.data,
                    has_catch: p.then_catch_chain.has_catch
                        || p.then_catch_chain.has_multiple_args,
                    ..Default::default()
                };
            }
        }

        e_.target = p.visit_expr_in_out(
            e_.target,
            ExprIn {
                property_access_for_method_call_maybe_should_replace_with_undefined: in_
                    .property_access_for_method_call_maybe_should_replace_with_undefined,
                ..Default::default()
            },
        );

        // 'require.resolve' -> .e_require_resolve_call_target
        if matches!(e_.target.data, Expr::Data::ERequireCallTarget(..)) && e_.name == b"resolve" {
            // we do not need to call p.recordUsageOfRuntimeRequire(); because `require`
            // was not a call target. even if the call target is `require.resolve`, it should be set.
            return Expr {
                data: Expr::Data::ERequireResolveCallTarget(()),
                loc: expr.loc,
            };
        }

        if e_.optional_chain.is_none() {
            if let Some(_expr) = p.maybe_rewrite_property_access(
                expr.loc,
                e_.target,
                e_.name,
                e_.name_loc,
                js_parser::RewritePropertyAccessOpts {
                    is_call_target,
                    assign_target: in_.assign_target,
                    is_delete_target,
                    // .is_template_tag = p.template_tag != null,
                    ..Default::default()
                },
            ) {
                return _expr;
            }

            if Self::ALLOW_MACROS {
                if !p.options.features.is_macro_runtime {
                    if p.macro_call_count > 0
                        && matches!(e_.target.data, Expr::Data::EObject(..))
                        && e_.target.data.e_object().was_originally_macro
                    {
                        if let Some(obj) = e_.target.get(e_.name) {
                            return obj;
                        }
                    }
                }
            }
        }
        expr
    }

    fn e_if(
        p: &mut P<PARSER_FEATURE_TYPESCRIPT, PARSER_FEATURE_JSX, PARSER_FEATURE_SCAN_ONLY>,
        expr: Expr,
        _: ExprIn,
    ) -> Expr {
        let e_ = expr.data.e_if();
        let is_call_target = matches!(p.call_target, Expr::Data::EIf(ref ct) if core::ptr::eq(expr.data.e_if(), ct));

        let prev_in_branch = p.in_branch_condition;
        p.in_branch_condition = true;
        e_.test_ = p.visit_expr(e_.test_);
        p.in_branch_condition = prev_in_branch;

        e_.test_ = SideEffects::simplify_boolean(p, e_.test_);

        let side_effects = SideEffects::to_boolean(p, &e_.test_.data);

        if !side_effects.ok {
            e_.yes = p.visit_expr(e_.yes);
            e_.no = p.visit_expr(e_.no);
        } else {
            // Mark the control flow as dead if the branch is never taken
            if side_effects.value {
                // "true ? live : dead"
                e_.yes = p.visit_expr(e_.yes);
                let old = p.is_control_flow_dead;
                p.is_control_flow_dead = true;
                e_.no = p.visit_expr(e_.no);
                p.is_control_flow_dead = old;

                if side_effects.side_effects == SideEffects::Kind::CouldHaveSideEffects {
                    return Expr::join_with_comma(
                        SideEffects::simplify_unused_expr(p, e_.test_)
                            .unwrap_or_else(|| p.new_expr(E::Missing {}, e_.test_.loc)),
                        e_.yes,
                        p.allocator,
                    );
                }

                // "(1 ? fn : 2)()" => "fn()"
                // "(1 ? this.fn : 2)" => "this.fn"
                // "(1 ? this.fn : 2)()" => "(0, this.fn)()"
                if is_call_target && e_.yes.has_value_for_this_in_call() {
                    return p
                        .new_expr(E::Number { value: 0.0 }, e_.test_.loc)
                        .join_with_comma(e_.yes, p.allocator);
                }

                return e_.yes;
            } else {
                // "false ? dead : live"
                let old = p.is_control_flow_dead;
                p.is_control_flow_dead = true;
                e_.yes = p.visit_expr(e_.yes);
                p.is_control_flow_dead = old;
                e_.no = p.visit_expr(e_.no);

                // "(a, false) ? b : c" => "a, c"
                if side_effects.side_effects == SideEffects::Kind::CouldHaveSideEffects {
                    return Expr::join_with_comma(
                        SideEffects::simplify_unused_expr(p, e_.test_)
                            .unwrap_or_else(|| p.new_expr(E::Missing {}, e_.test_.loc)),
                        e_.no,
                        p.allocator,
                    );
                }

                // "(1 ? fn : 2)()" => "fn()"
                // "(1 ? this.fn : 2)" => "this.fn"
                // "(1 ? this.fn : 2)()" => "(0, this.fn)()"
                if is_call_target && e_.no.has_value_for_this_in_call() {
                    return p
                        .new_expr(E::Number { value: 0.0 }, e_.test_.loc)
                        .join_with_comma(e_.no, p.allocator);
                }
                return e_.no;
            }
        }
        expr
    }

    fn e_await(
        p: &mut P<PARSER_FEATURE_TYPESCRIPT, PARSER_FEATURE_JSX, PARSER_FEATURE_SCAN_ONLY>,
        expr: Expr,
        _: ExprIn,
    ) -> Expr {
        let e_ = expr.data.e_await();
        p.await_target = Some(e_.value.data);
        e_.value = p.visit_expr(e_.value);
        expr
    }

    fn e_yield(
        p: &mut P<PARSER_FEATURE_TYPESCRIPT, PARSER_FEATURE_JSX, PARSER_FEATURE_SCAN_ONLY>,
        expr: Expr,
        _: ExprIn,
    ) -> Expr {
        let e_ = expr.data.e_yield();
        if let Some(val) = e_.value {
            e_.value = Some(p.visit_expr(val));
        }
        expr
    }

    fn e_array(
        p: &mut P<PARSER_FEATURE_TYPESCRIPT, PARSER_FEATURE_JSX, PARSER_FEATURE_SCAN_ONLY>,
        expr: Expr,
        in_: ExprIn,
    ) -> Expr {
        let e_ = expr.data.e_array();
        if in_.assign_target != js_ast::AssignTarget::None {
            p.maybe_comma_spread_error(e_.comma_after_spread);
        }
        let items = e_.items.slice_mut();
        let mut spread_item_count: usize = 0;
        for item in items {
            match &mut item.data {
                Expr::Data::EMissing(..) => {}
                Expr::Data::ESpread(spread) => {
                    spread.value = p.visit_expr_in_out(
                        spread.value,
                        ExprIn {
                            assign_target: in_.assign_target,
                            ..Default::default()
                        },
                    );

                    spread_item_count += if let Expr::Data::EArray(arr) = &spread.value.data {
                        arr.items.len as usize
                    } else {
                        0
                    };
                }
                Expr::Data::EBinary(e2) => {
                    if in_.assign_target != js_ast::AssignTarget::None
                        && e2.op == js_ast::Op::BinAssign
                    {
                        let was_anonymous_named_expr = e2.right.is_anonymous_named();
                        // Propagate name for anonymous decorated class expressions
                        if was_anonymous_named_expr
                            && matches!(e2.right.data, Expr::Data::EClass(..))
                            && e2.right.data.e_class().should_lower_standard_decorators
                            && matches!(Expr::Tag::from(&e2.left.data), Expr::Tag::EIdentifier)
                        {
                            p.decorator_class_name =
                                Some(p.load_name_from_ref(e2.left.data.e_identifier().ref_));
                        }
                        e2.left = p.visit_expr_in_out(
                            e2.left,
                            ExprIn {
                                assign_target: js_ast::AssignTarget::Replace,
                                ..Default::default()
                            },
                        );
                        e2.right = p.visit_expr(e2.right);
                        p.decorator_class_name = None;

                        if matches!(Expr::Tag::from(&e2.left.data), Expr::Tag::EIdentifier) {
                            e2.right = p.maybe_keep_expr_symbol_name(
                                e2.right,
                                &p.symbols.as_slice()
                                    [e2.left.data.e_identifier().ref_.inner_index()]
                                .original_name,
                                was_anonymous_named_expr,
                            );
                        }
                    } else {
                        *item = p.visit_expr_in_out(
                            *item,
                            ExprIn {
                                assign_target: in_.assign_target,
                                ..Default::default()
                            },
                        );
                    }
                }
                _ => {
                    *item = p.visit_expr_in_out(
                        *item,
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
            e_.items = e_
                .inline_spread_of_array_literals(p.allocator, spread_item_count)
                .unwrap_or(e_.items);
        }
        expr
    }

    fn e_object(
        p: &mut P<PARSER_FEATURE_TYPESCRIPT, PARSER_FEATURE_JSX, PARSER_FEATURE_SCAN_ONLY>,
        expr: Expr,
        in_: ExprIn,
    ) -> Expr {
        let e_ = expr.data.e_object();
        if in_.assign_target != js_ast::AssignTarget::None {
            p.maybe_comma_spread_error(e_.comma_after_spread);
        }

        let mut has_spread = false;
        let mut has_proto = false;
        for property in e_.properties.slice_mut() {
            if property.kind != G::Property::Kind::Spread {
                property.key = Some(p.visit_expr(
                    property
                        .key
                        .unwrap_or_else(|| panic!("Expected property key")),
                ));
                let key = property.key.unwrap();
                // Forbid duplicate "__proto__" properties according to the specification
                if !property.flags.contains(G::Property::Flag::IsComputed)
                    && !property.flags.contains(G::Property::Flag::WasShorthand)
                    && !property.flags.contains(G::Property::Flag::IsMethod)
                    && in_.assign_target == js_ast::AssignTarget::None
                    && key.data.is_string_value()
                    && key.data.e_string().slice(p.allocator) == b"__proto__"
                // __proto__ is utf8, assume it lives in refs
                {
                    if has_proto {
                        let r = js_lexer::range_of_identifier(p.source, key.loc);
                        p.log
                            .add_range_error(
                                p.source,
                                r,
                                b"Cannot specify the \"__proto__\" property more than once per object",
                            )
                            .expect("unreachable");
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
                if let Expr::Data::EBinary(bin) = &property.value.unwrap().data {
                    if bin.op == js_ast::Op::BinAssign {
                        property.initializer = Some(bin.right);
                        property.value = Some(bin.left);
                    }
                }
            }

            if property.value.is_some() {
                // Propagate name from property key for decorated anonymous class expressions
                // e.g., { Foo: @dec class {} } should give the class .name = "Foo"
                if in_.assign_target == js_ast::AssignTarget::None
                    && matches!(property.value.unwrap().data, Expr::Data::EClass(..))
                    && property
                        .value
                        .unwrap()
                        .data
                        .e_class()
                        .should_lower_standard_decorators
                    && property.value.unwrap().data.e_class().class_name.is_none()
                    && property.key.is_some()
                    && matches!(property.key.unwrap().data, Expr::Data::EString(..))
                {
                    p.decorator_class_name =
                        property.key.unwrap().data.e_string().string(p.allocator).ok();
                }
                property.value = Some(p.visit_expr_in_out(
                    property.value.unwrap(),
                    ExprIn {
                        assign_target: in_.assign_target,
                        ..Default::default()
                    },
                ));
                p.decorator_class_name = None;
            }

            if property.initializer.is_some() {
                let was_anonymous_named_expr = property.initializer.unwrap().is_anonymous_named();
                if was_anonymous_named_expr
                    && matches!(property.initializer.unwrap().data, Expr::Data::EClass(..))
                    && property
                        .initializer
                        .unwrap()
                        .data
                        .e_class()
                        .should_lower_standard_decorators
                {
                    if let Some(val) = property.value {
                        if matches!(Expr::Tag::from(&val.data), Expr::Tag::EIdentifier) {
                            p.decorator_class_name =
                                Some(p.load_name_from_ref(val.data.e_identifier().ref_));
                        }
                    }
                }
                property.initializer = Some(p.visit_expr(property.initializer.unwrap()));
                p.decorator_class_name = None;

                if let Some(val) = property.value {
                    if matches!(Expr::Tag::from(&val.data), Expr::Tag::EIdentifier) {
                        property.initializer = Some(p.maybe_keep_expr_symbol_name(
                            property.initializer.expect("unreachable"),
                            &p.symbols.as_slice()[val.data.e_identifier().ref_.inner_index()]
                                .original_name,
                            was_anonymous_named_expr,
                        ));
                    }
                }
            }
        }
        let _ = has_spread;
        expr
    }

    fn e_import(
        p: &mut P<PARSER_FEATURE_TYPESCRIPT, PARSER_FEATURE_JSX, PARSER_FEATURE_SCAN_ONLY>,
        expr: Expr,
        _: ExprIn,
    ) -> Expr {
        let e_ = expr.data.e_import();
        // We want to forcefully fold constants inside of imports
        // even when minification is disabled, so that if we have an
        // import based on a string template, it does not cause a
        // bundle error. This is especially relevant for bundling NAPI
        // modules with 'bun build --compile':
        //
        // const binding = await import(`./${process.platform}-${process.arch}.node`);
        //
        let prev_should_fold_typescript_constant_expressions = true;
        let _guard = scopeguard::guard((), |_| {
            // TODO(port): errdefer/defer captures &mut p; reshape in Phase B if borrowck rejects.
            p.should_fold_typescript_constant_expressions =
                prev_should_fold_typescript_constant_expressions;
        });
        // PORT NOTE: Zig `defer` restores at scope exit; scopeguard mirrors that.
        p.should_fold_typescript_constant_expressions = true;

        e_.expr = p.visit_expr(e_.expr);
        e_.options = p.visit_expr(e_.options);

        // Import transposition is able to duplicate the options structure, so
        // only perform it if the expression is side effect free.
        //
        // TODO: make this more like esbuild by emitting warnings that explain
        // why this import was not analyzed. (see esbuild 'unsupported-dynamic-import')
        if p.expr_can_be_removed_if_unused(&e_.options) {
            let state = TransposeState {
                is_await_target: if let Some(await_target) = &p.await_target {
                    matches!(await_target, Expr::Data::EImport(at) if core::ptr::eq(*at, e_))
                } else {
                    false
                },

                is_then_catch_target: p.then_catch_chain.has_catch
                    && matches!(p.then_catch_chain.next_target, Expr::Data::EImport(..))
                    && core::ptr::eq(
                        expr.data.e_import(),
                        p.then_catch_chain.next_target.e_import(),
                    ),

                import_options: e_.options,

                loc: e_.expr.loc,
                import_loader: e_.import_record_loader(),
                ..Default::default()
            };

            return p.import_transposer.maybe_transpose_if(e_.expr, &state);
        }
        expr
    }

    fn e_call(
        p: &mut P<PARSER_FEATURE_TYPESCRIPT, PARSER_FEATURE_JSX, PARSER_FEATURE_SCAN_ONLY>,
        expr: Expr,
        in_: ExprIn,
    ) -> Expr {
        let e_ = expr.data.e_call();
        p.call_target = e_.target.data;

        p.then_catch_chain = ThenCatchChain {
            next_target: e_.target.data,
            has_multiple_args: e_.args.len >= 2,
            has_catch: matches!(
                Expr::Tag::from(&p.then_catch_chain.next_target),
                Expr::Tag::ECall
            ) && core::ptr::eq(
                p.then_catch_chain.next_target.e_call(),
                expr.data.e_call(),
            ) && p.then_catch_chain.has_catch,
        };

        let target_was_identifier_before_visit =
            matches!(e_.target.data, Expr::Data::EIdentifier(..));
        e_.target = p.visit_expr_in_out(
            e_.target,
            ExprIn {
                has_chain_parent: e_.optional_chain == Some(js_ast::OptionalChain::Continuation),
                property_access_for_method_call_maybe_should_replace_with_undefined: true,
                ..Default::default()
            },
        );

        // Copy the call side effect flag over if this is a known target
        match &e_.target.data {
            Expr::Data::EIdentifier(ident) => {
                if ident.call_can_be_unwrapped_if_unused
                    && e_.can_be_unwrapped_if_unused == js_ast::CallUnwrap::Never
                {
                    e_.can_be_unwrapped_if_unused = js_ast::CallUnwrap::IfUnused;
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
                    && p.symbols.as_slice()
                        [e_.target.data.e_identifier().ref_.inner_index as usize]
                        .original_name
                        .as_ref()
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

                    let mut scope_iter: Option<&mut js_ast::Scope> = Some(p.current_scope);
                    while let Some(scope) = scope_iter {
                        scope.contains_direct_eval = true;
                        scope_iter = scope.parent;
                    }
                    // TODO(port): lifetime — `scope.parent` is `?*js_ast.Scope` in Zig (raw arena
                    // ptr). Phase B should pick the right Rust type per LIFETIMES.tsv on Scope.

                    // TODO: Log a build note for this like esbuild does
                }
            }
            Expr::Data::EDot(dot) => {
                if dot.call_can_be_unwrapped_if_unused != js_ast::CallUnwrap::Never
                    && e_.can_be_unwrapped_if_unused == js_ast::CallUnwrap::Never
                {
                    e_.can_be_unwrapped_if_unused = dot.call_can_be_unwrapped_if_unused;
                }
            }
            _ => {}
        }

        let is_macro_ref: bool = if Self::ALLOW_MACROS {
            let possible_macro_ref = match &e_.target.data {
                Expr::Data::EImportIdentifier(ident) => Some(ident.ref_),
                Expr::Data::EDot(dot) => {
                    if let Expr::Data::EIdentifier(id) = &dot.target.data {
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
                || matches!(e_.target.data, Expr::Data::ERequireCallTarget(..))
                || matches!(e_.target.data, Expr::Data::ERequireResolveCallTarget(..))
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
                    Expr::Data::EIndex(..)
                    | Expr::Data::EDot(..)
                    | Expr::Data::EIdentifier(..) => {
                        p.is_control_flow_dead = true;
                    }
                    // Special case from `import.meta.hot.*` functions.
                    Expr::Data::EUndefined(..) => {
                        p.is_control_flow_dead = true;
                    }
                    _ => {
                        method_call_should_be_replaced_with_undefined = false;
                    }
                }
            }

            for arg in e_.args.slice_mut() {
                *arg = p.visit_expr(*arg);
            }

            // Restore deferred state (Zig `defer`).
            p.options.ignore_dce_annotations = old_ce;
            p.should_fold_typescript_constant_expressions =
                old_should_fold_typescript_constant_expressions;

            if method_call_should_be_replaced_with_undefined {
                p.is_control_flow_dead = old_is_control_flow_dead;
                return Expr {
                    data: Expr::Data::EUndefined(E::Undefined {}),
                    loc: expr.loc,
                };
            }
        }

        // Handle `feature("FLAG_NAME")` calls from `import { feature } from "bun:bundle"`
        // Check if the bundler_feature_flag_ref is set before calling the function
        // to avoid stack memory usage from copying values back and forth.
        if p.bundler_feature_flag_ref.is_valid() {
            if let Some(result) = Self::maybe_replace_bundler_feature_call(p, e_, expr.loc) {
                return result;
            }
        }

        if matches!(e_.target.data, Expr::Data::ERequireCallTarget(..)) {
            e_.can_be_unwrapped_if_unused = js_ast::CallUnwrap::Never;

            // Heuristic: omit warnings inside try/catch blocks because presumably
            // the try/catch statement is there to handle the potential run-time
            // error from the unbundled require() call failing.
            if e_.args.len == 1 {
                let first = e_.args.slice()[0];
                let state = TransposeState {
                    is_require_immediately_assigned_to_decl: in_.is_immediately_assigned_to_decl
                        && matches!(first.data, Expr::Data::EString(..)),
                    ..Default::default()
                };
                match &first.data {
                    Expr::Data::EString(..) => {
                        // require(FOO) => require(FOO)
                        return p.transpose_require(first, &state);
                    }
                    Expr::Data::EIf(..) => {
                        // require(FOO  ? '123' : '456') => FOO ? require('123') : require('456')
                        // This makes static analysis later easier
                        return p.require_transposer.transpose_known_to_be_if(first, &state);
                    }
                    _ => {}
                }
            }

            // Ignore calls to require() if the control flow is provably
            // dead here. We don't want to spend time scanning the required files
            // if they will never be used.
            if p.is_control_flow_dead {
                return p.new_expr(E::Null {}, expr.loc);
            }

            if p.options.warn_about_unbundled_modules {
                let r = js_lexer::range_of_identifier(p.source, e_.target.loc);
                p.log
                    .add_range_debug(
                        p.source,
                        r,
                        b"This call to \"require\" will not be bundled because it has multiple arguments",
                    )
                    .expect("unreachable");
            }

            if e_.args.len >= 1 {
                p.check_dynamic_specifier(e_.args.slice()[0], e_.target.loc, b"require()");
            }

            if p.options.features.allow_runtime {
                p.record_usage_of_runtime_require();
            }

            return expr;
        } else if matches!(e_.target.data, Expr::Data::ERequireResolveCallTarget(..)) {
            // Ignore calls to require.resolve() if the control flow is provably
            // dead here. We don't want to spend time scanning the required files
            // if they will never be used.
            if p.is_control_flow_dead {
                return p.new_expr(E::Null {}, expr.loc);
            }

            if e_.args.len == 1 {
                let first = e_.args.slice()[0];
                match &first.data {
                    Expr::Data::EString(..) => {
                        // require.resolve(FOO) => require.resolve(FOO)
                        // (this will register dependencies)
                        return p.transpose_require_resolve_known_string(first);
                    }
                    Expr::Data::EIf(..) => {
                        // require.resolve(FOO  ? '123' : '456')
                        //  =>
                        // FOO ? require.resolve('123') : require.resolve('456')
                        // This makes static analysis later easier
                        return p
                            .require_resolve_transposer
                            .transpose_known_to_be_if(first, e_.target);
                    }
                    _ => {}
                }
            }

            if e_.args.len >= 1 {
                p.check_dynamic_specifier(
                    e_.args.slice()[0],
                    e_.target.loc,
                    b"require.resolve()",
                );
            }

            return expr;
        } else if let Some(special) = e_.target.data.as_e_special() {
            match special {
                E::Special::HotAccept => {
                    p.handle_import_meta_hot_accept_call(e_);
                    // After validating that the import.meta.hot
                    // code is correct, discard the entire
                    // expression in production.
                    if !p.options.features.hot_module_reloading {
                        return Expr {
                            data: Expr::Data::EUndefined(E::Undefined {}),
                            loc: expr.loc,
                        };
                    }
                }
                _ => {}
            }
        }

        if Self::ALLOW_MACROS {
            if is_macro_ref && !p.options.features.is_macro_runtime {
                let ref_ = match &e_.target.data {
                    Expr::Data::EImportIdentifier(ident) => ident.ref_,
                    Expr::Data::EDot(dot) => dot.target.data.e_identifier().ref_,
                    _ => unreachable!(),
                };

                let macro_ref_data = *p.macro_.refs.get(&ref_).unwrap();
                p.ignore_usage(ref_);
                if p.is_control_flow_dead {
                    return p.new_expr(E::Undefined {}, e_.target.loc);
                }

                if p.options.features.no_macros {
                    p.log
                        .add_error(p.source, expr.loc, b"Macros are disabled")
                        .expect("unreachable");
                    return p.new_expr(E::Undefined {}, expr.loc);
                }

                if p.source.path.is_node_module() {
                    p.log
                        .add_error(
                            p.source,
                            expr.loc,
                            b"For security reasons, macros cannot be run from node_modules.",
                        )
                        .expect("unreachable");
                    return p.new_expr(E::Undefined {}, expr.loc);
                }

                let name = macro_ref_data
                    .name
                    .unwrap_or_else(|| e_.target.data.e_dot().name);
                let record = &p.import_records.as_slice()[macro_ref_data.import_record_id];
                let copied = Expr {
                    loc: expr.loc,
                    data: Expr::Data::ECall(e_),
                };
                let start_error_count = p.log.msgs.len();
                p.macro_call_count += 1;
                let macro_result = match p.options.macro_context.call(
                    record.path.text,
                    p.source.path.source_dir(),
                    p.log,
                    p.source,
                    record.range,
                    copied,
                    name,
                ) {
                    Ok(v) => v,
                    Err(err) => {
                        if err == bun_core::err!("MacroFailed") {
                            if p.log.msgs.len() == start_error_count {
                                p.log
                                    .add_error(p.source, expr.loc, b"macro threw exception")
                                    .expect("unreachable");
                            }
                        } else {
                            p.log
                                .add_error_fmt(
                                    p.source,
                                    expr.loc,
                                    p.allocator,
                                    format_args!("\"{}\" error in macro", err.name()),
                                )
                                .expect("unreachable");
                        }
                        return expr;
                    }
                };

                if !matches!(macro_result.data, Expr::Data::ECall(..)) {
                    return p.visit_expr(macro_result);
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
        if p.options.features.react_fast_refresh
            || p.options.features.server_components.is_server_side()
        {
            'try_record_hook: {
                let original_name = match &e_.target.data {
                    Expr::Data::EIdentifier(id) => {
                        &p.symbols.as_slice()[id.ref_.inner_index()].original_name
                    }
                    Expr::Data::EImportIdentifier(id) => {
                        &p.symbols.as_slice()[id.ref_.inner_index()].original_name
                    }
                    Expr::Data::ECommonjsExportIdentifier(id) => {
                        &p.symbols.as_slice()[id.ref_.inner_index()].original_name
                    }
                    Expr::Data::EDot(dot) => dot.name,
                    _ => break 'try_record_hook,
                };
                if !ReactRefresh::is_hook_name(original_name) {
                    break 'try_record_hook;
                }
                if p.options.features.react_fast_refresh {
                    p.handle_react_refresh_hook_call(e_, original_name);
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
                    if matches!(e_.target.data, Expr::Data::EImportIdentifier(..)) {
                        break 'check_for_usestate true;
                    }
                    // Also check for `React.useState(...)`
                    if let Expr::Data::EDot(dot) = &e_.target.data {
                        if let Expr::Data::EImportIdentifier(id) = &dot.target.data {
                            let name =
                                &p.symbols.as_slice()[id.ref_.inner_index()].original_name;
                            break 'check_for_usestate name == b"React";
                        }
                    }
                    break 'check_for_usestate false;
                } {
                    debug_assert!(p.options.features.server_components.is_server_side());
                    if !strings::starts_with(p.source.path.pretty, b"node_modules")
                        && original_name == b"useState"
                    {
                        // PERF(port): was arena allocPrint — profile in Phase B
                        let mut msg = bumpalo::collections::Vec::new_in(p.allocator);
                        write!(
                            &mut msg,
                            "\"useState\" is not available in a server component. If you need interactivity, consider converting part of this to a Client Component (by adding `\"use client\";` to the top of the file)."
                        )
                        .unwrap();
                        p.log
                            .add_error(p.source, expr.loc, msg.into_bump_slice());
                    }
                }
            }
        }

        // Implement constant folding for 'string'.charCodeAt(n)
        if e_.args.len == 1 {
            if let Some(dot) = e_.target.data.as_e_dot() {
                if matches!(dot.target.data, Expr::Data::EString(..))
                    && dot.target.data.e_string().is_utf8()
                    && dot.name == b"charCodeAt"
                {
                    let str_ = dot.target.data.e_string().data;
                    let arg1 = e_.args.at(0).unwrap_inlined();
                    if let Expr::Data::ENumber(n) = &arg1.data {
                        let float = n.value;
                        if float % 1.0 == 0.0 && float < (str_.len() as f64) && float >= 0.0 {
                            let char_ = str_[float as usize];
                            if char_ < 0x80 {
                                return p.new_expr(
                                    E::Number {
                                        value: f64::from(char_),
                                    },
                                    expr.loc,
                                );
                            }
                        }
                    }
                }
            }
        }

        expr
    }

    fn e_new(
        p: &mut P<PARSER_FEATURE_TYPESCRIPT, PARSER_FEATURE_JSX, PARSER_FEATURE_SCAN_ONLY>,
        expr: Expr,
        _: ExprIn,
    ) -> Expr {
        let e_ = expr.data.e_new();
        e_.target = p.visit_expr(e_.target);

        for arg in e_.args.slice_mut() {
            *arg = p.visit_expr(*arg);
        }

        if p.options.features.minify_syntax {
            if let Some(minified) = KnownGlobal::minify_global_constructor(
                p.allocator,
                e_,
                p.symbols.as_slice(),
                expr.loc,
                p.options.features.minify_whitespace,
            ) {
                return minified;
            }
        }
        expr
    }

    fn e_arrow(
        p: &mut P<PARSER_FEATURE_TYPESCRIPT, PARSER_FEATURE_JSX, PARSER_FEATURE_SCAN_ONLY>,
        expr: Expr,
        _: ExprIn,
    ) -> Expr {
        let e_ = expr.data.e_arrow();
        if p.is_revisit_for_substitution {
            return expr;
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

        p.push_scope_for_visit_pass(Scope::Kind::FunctionArgs, expr.loc)
            .expect("unreachable");
        // PERF(port): was arena dupe — profile in Phase B
        let dupe = p.allocator.alloc_slice_copy(e_.body.stmts);

        p.visit_args(
            e_.args,
            VisitArgsOpts {
                has_rest_arg: e_.has_rest_arg,
                body: dupe,
                is_unique_formal_parameters: true,
                ..Default::default()
            },
        );
        p.push_scope_for_visit_pass(Scope::Kind::FunctionBody, e_.body.loc)
            .expect("unreachable");

        let mut react_hook_data: Option<ReactRefresh::HookContext> = None;
        let prev = p.react_refresh.hook_ctx_storage;
        // PORT NOTE: Zig `defer` restores at scope exit; restored manually below before each return.
        p.react_refresh.hook_ctx_storage = Some(&mut react_hook_data);
        // TODO(port): lifetime — storing `&mut Option<HookContext>` on `p` is a self-referential
        // borrow in Rust. Phase B may need to reshape `hook_ctx_storage` as a raw ptr or move the
        // storage onto a stack the parser owns.

        let mut stmts_list =
            bumpalo::collections::Vec::from_iter_in(dupe.iter().copied(), p.allocator);
        // TODO(port): Zig `ListManaged(Stmt).fromOwnedSlice(p.allocator, dupe)` takes ownership of
        // the arena slice without copying. bumpalo Vec cannot adopt an existing slice; Phase B may
        // want a custom arena Vec that can. Left as a copy with PERF note.
        // PERF(port): was fromOwnedSlice (no copy) — profile in Phase B
        let mut temp_opts = PrependTempRefsOpts {
            kind: js_parser::PrependTempRefsKind::FnBody,
            ..Default::default()
        };
        p.visit_stmts_and_prepend_temp_refs(&mut stmts_list, &mut temp_opts)
            .expect("unreachable");
        // Zig: `p.allocator.free(e_.body.stmts)` — arena-backed, no individual free in Rust.
        e_.body.stmts = stmts_list.as_slice();
        // TODO(port): `stmts_list.items` in Zig aliases the live Vec; we need the slice to outlive
        // this fn. With bumpalo this is `into_bump_slice()` once we're done growing it; but it's
        // grown again below. Phase B should pick the right ownership shape.
        p.pop_scope();
        p.pop_scope();

        p.fn_only_data_visit.is_inside_async_arrow_fn = old_inside_async_arrow_fn;
        p.fn_or_arrow_data_visit = old_fn_or_arrow_data;

        if let Some(hook) = &mut react_hook_data {
            'try_mark_hook: {
                let Some(stmts) = p.nearest_stmt_list.as_mut() else {
                    break 'try_mark_hook;
                };
                stmts.push(p.get_react_refresh_hook_signal_decl(hook.signature_cb));

                p.handle_react_refresh_post_visit_function_body(&mut stmts_list, hook);
                e_.body.stmts = stmts_list.into_bump_slice();

                p.react_refresh.hook_ctx_storage = prev;
                return p.get_react_refresh_hook_signal_init(hook, expr);
            }
        }
        p.react_refresh.hook_ctx_storage = prev;
        expr
    }

    fn e_function(
        p: &mut P<PARSER_FEATURE_TYPESCRIPT, PARSER_FEATURE_JSX, PARSER_FEATURE_SCAN_ONLY>,
        expr: Expr,
        _: ExprIn,
    ) -> Expr {
        let e_ = expr.data.e_function();
        if p.is_revisit_for_substitution {
            return expr;
        }

        let mut react_hook_data: Option<ReactRefresh::HookContext> = None;
        let prev = p.react_refresh.hook_ctx_storage;
        p.react_refresh.hook_ctx_storage = Some(&mut react_hook_data);
        // TODO(port): lifetime — see note in e_arrow about hook_ctx_storage.

        e_.func = p.visit_func(e_.func, expr.loc);

        // Remove unused function names when minifying (only when bundling is enabled)
        // unless --keep-names is specified
        if p.options.features.minify_syntax
            && p.options.bundle
            && !p.options.features.minify_keep_names
            && !p.current_scope.contains_direct_eval
            && e_.func.name.is_some()
            && e_.func.name.unwrap().ref_.is_some()
            && p.symbols.as_slice()[e_.func.name.unwrap().ref_.unwrap().inner_index()]
                .use_count_estimate
                == 0
        {
            e_.func.name = None;
        }

        let mut final_expr = expr;

        if let Some(hook) = &mut react_hook_data {
            'try_mark_hook: {
                let Some(stmts) = p.nearest_stmt_list.as_mut() else {
                    break 'try_mark_hook;
                };
                stmts.push(p.get_react_refresh_hook_signal_decl(hook.signature_cb));
                final_expr = p.get_react_refresh_hook_signal_init(hook, expr);
            }
        }

        p.react_refresh.hook_ctx_storage = prev;

        if let Some(name) = e_.func.name {
            final_expr = p.keep_expr_symbol_name(
                final_expr,
                &p.symbols.as_slice()[name.ref_.unwrap().inner_index()].original_name,
            );
        }

        final_expr
    }

    fn e_class(
        p: &mut P<PARSER_FEATURE_TYPESCRIPT, PARSER_FEATURE_JSX, PARSER_FEATURE_SCAN_ONLY>,
        expr: Expr,
        _: ExprIn,
    ) -> Expr {
        let e_ = expr.data.e_class();
        if p.is_revisit_for_substitution {
            return expr;
        }

        // Save name from assignment context before visiting (nested visits may overwrite it)
        let decorator_name_from_context = p.decorator_class_name;
        p.decorator_class_name = None;

        let _ = p.visit_class(expr.loc, e_, Ref::NONE);

        // Lower standard decorators for class expressions
        if e_.should_lower_standard_decorators {
            return p.lower_standard_decorators_expr(e_, expr.loc, decorator_name_from_context);
        }

        // Remove unused class names when minifying (only when bundling is enabled)
        // unless --keep-names is specified
        if p.options.features.minify_syntax
            && p.options.bundle
            && !p.options.features.minify_keep_names
            && !p.current_scope.contains_direct_eval
            && e_.class_name.is_some()
            && e_.class_name.unwrap().ref_.is_some()
            && p.symbols.as_slice()[e_.class_name.unwrap().ref_.unwrap().inner_index()]
                .use_count_estimate
                == 0
        {
            e_.class_name = None;
        }

        expr
    }

    /// Handles `feature("FLAG_NAME")` calls from `import { feature } from "bun:bundle"`.
    /// This enables statically analyzable dead-code elimination through feature gating.
    ///
    /// When a feature flag is enabled via `--feature=FLAG_NAME`, `feature("FLAG_NAME")`
    /// is replaced with `true`, otherwise it's replaced with `false`. This allows
    /// bundlers to eliminate dead code branches at build time.
    ///
    /// Returns the replacement expression if this is a feature() call, or None otherwise.
    /// Note: Caller must check `p.bundler_feature_flag_ref.is_valid()` before calling.
    fn maybe_replace_bundler_feature_call(
        p: &mut P<PARSER_FEATURE_TYPESCRIPT, PARSER_FEATURE_JSX, PARSER_FEATURE_SCAN_ONLY>,
        e_: &mut E::Call,
        loc: logger::Loc,
    ) -> Option<Expr> {
        // Check if the target is the `feature` function from "bun:bundle"
        // It could be e_identifier (for unbound) or e_import_identifier (for imports)
        let target_ref: Option<Ref> = match &e_.target.data {
            Expr::Data::EIdentifier(ident) => Some(ident.ref_),
            Expr::Data::EImportIdentifier(ident) => Some(ident.ref_),
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
        if e_.args.len != 1 {
            p.log
                .add_error(
                    p.source,
                    loc,
                    b"feature() requires exactly one string argument",
                )
                .expect("unreachable");
            return Some(p.new_expr(E::Boolean { value: false }, loc));
        }

        let arg = e_.args.slice()[0];

        // Validate: argument must be a string literal
        if !matches!(arg.data, Expr::Data::EString(..)) {
            p.log
                .add_error(
                    p.source,
                    arg.loc,
                    b"feature() argument must be a string literal",
                )
                .expect("unreachable");
            return Some(p.new_expr(E::Boolean { value: false }, loc));
        }

        // Check if the feature flag is enabled
        // Use the underlying string data directly without allocation.
        // Feature flag names should be ASCII identifiers, so UTF-16 is unexpected.
        let flag_string = arg.data.e_string();
        if flag_string.is_utf16 {
            p.log
                .add_error(
                    p.source,
                    arg.loc,
                    b"feature() flag name must be an ASCII string",
                )
                .expect("unreachable");
            return Some(p.new_expr(E::Boolean { value: false }, loc));
        }

        // feature() can only be used directly in an if statement or ternary condition
        if !p.in_branch_condition {
            p.log
                .add_error(
                    p.source,
                    loc,
                    b"feature() from \"bun:bundle\" can only be used directly in an if statement or ternary condition",
                )
                .expect("unreachable");
            return Some(p.new_expr(E::Boolean { value: false }, loc));
        }

        let is_enabled = p
            .options
            .features
            .bundler_feature_flags
            .map
            .contains_key(flag_string.data);
        Some(Expr {
            data: Expr::Data::EBranchBoolean(E::BranchBoolean { value: is_enabled }),
            loc,
        })
    }
}

// Zig: `var jsxChildrenKeyData = Expr.Data{ .e_string = &Prefill.String.Children };`
// TODO(port): Expr::Data is a tagged union with an arena pointer payload for e_string; the exact
// Rust spelling depends on how Expr::Data is ported. Kept as a static for now.
static JSX_CHILDREN_KEY_DATA: Expr::Data = Expr::Data::EString(&Prefill::String::CHILDREN);

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/js_parser/ast/visitExpr.zig (1801 lines)
//   confidence: medium
//   todos:      13
//   notes:      Const-generic type-generator + arena-backed Expr::Data accessors (e_dot()/e_string()/...) assumed; hook_ctx_storage self-borrow and BinaryExpressionVisitor type need Phase-B reshaping.
// ──────────────────────────────────────────────────────────────────────────
