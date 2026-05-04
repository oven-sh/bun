use core::marker::PhantomData;

use bun_core::Error;
use bun_logger as logger;
use bun_js_parser::{
    self as js_parser, JSXTransformType, NewParser, Prefill, PrependTempRefsOpts, ReactRefresh,
    Ref, RelocateVars, SideEffects, StmtsKind, statement_cares_about_scope,
};
use bun_js_parser::ast::{self as js_ast, B, Binding, E, Expr, G, S, Stmt};
use bun_js_parser::ast::G::Decl;
use bun_js_parser::lexer as js_lexer;
use bun_str::strings;
use bumpalo::Bump;
use bumpalo::collections::Vec as BumpVec;

// `ListManaged(Stmt)` in the parser is arena-backed (`p.allocator`).
// TODO(port): thread `'bump` through fn signatures (`stmts: &mut StmtList<'bump>`) in Phase B.
type StmtList<'bump> = BumpVec<'bump, Stmt>;

/// Zig: `pub fn VisitStmt(comptime ts, comptime jsx, comptime scan_only) type { return struct { ... } }`
pub struct VisitStmt<
    const PARSER_FEATURE_TYPESCRIPT: bool,
    const PARSER_FEATURE_JSX: JSXTransformType,
    const PARSER_FEATURE_SCAN_ONLY: bool,
>(PhantomData<()>);

// TODO(port): inherent associated type aliases are unstable; using a free alias.
type P<const TS: bool, const JSX: JSXTransformType, const SO: bool> = NewParser<TS, JSX, SO>;

impl<
        const PARSER_FEATURE_TYPESCRIPT: bool,
        const PARSER_FEATURE_JSX: JSXTransformType,
        const PARSER_FEATURE_SCAN_ONLY: bool,
    > VisitStmt<PARSER_FEATURE_TYPESCRIPT, PARSER_FEATURE_JSX, PARSER_FEATURE_SCAN_ONLY>
{
    const IS_TYPESCRIPT_ENABLED: bool = PARSER_FEATURE_TYPESCRIPT;

    #[inline]
    fn create_default_name(
        p: &mut P<PARSER_FEATURE_TYPESCRIPT, PARSER_FEATURE_JSX, PARSER_FEATURE_SCAN_ONLY>,
        loc: logger::Loc,
    ) -> Result<js_ast::LocRef, Error> {
        // Zig: `const createDefaultName = P.createDefaultName;`
        P::<PARSER_FEATURE_TYPESCRIPT, PARSER_FEATURE_JSX, PARSER_FEATURE_SCAN_ONLY>::create_default_name(p, loc)
    }

    pub fn visit_and_append_stmt(
        p: &mut P<PARSER_FEATURE_TYPESCRIPT, PARSER_FEATURE_JSX, PARSER_FEATURE_SCAN_ONLY>,
        stmts: &mut StmtList,
        stmt: &mut Stmt,
    ) -> Result<(), Error> {
        // By default any statement ends the const local prefix
        let was_after_after_const_local_prefix = p.current_scope.is_after_const_local_prefix;
        p.current_scope.is_after_const_local_prefix = true;

        // Zig: `switch (@as(Stmt.Tag, stmt.data))` with `inline else` reflection over @tagName.
        // Expanded to explicit arms per PORTING.md.
        match &mut stmt.data {
            Stmt::Data::SDirective(_) | Stmt::Data::SComment(_) | Stmt::Data::SEmpty(_) => {
                p.current_scope.is_after_const_local_prefix = was_after_after_const_local_prefix;
                stmts.push(*stmt);
                Ok(())
            }
            Stmt::Data::STypeScript(_) => {
                p.current_scope.is_after_const_local_prefix = was_after_after_const_local_prefix;
                Ok(())
            }
            Stmt::Data::SDebugger(_) => {
                p.current_scope.is_after_const_local_prefix = was_after_after_const_local_prefix;
                if p.define.drop_debugger {
                    return Ok(());
                }
                stmts.push(*stmt);
                Ok(())
            }

            // Zig: `inline .s_enum, .s_local => |tag| return @field(visitors, @tagName(tag))(p, stmts, stmt, @field(stmt.data, @tagName(tag)), was_after_after_const_local_prefix)`
            Stmt::Data::SEnum(data) => {
                Self::s_enum(p, stmts, stmt, data, was_after_after_const_local_prefix)
            }
            Stmt::Data::SLocal(data) => {
                Self::s_local(p, stmts, stmt, data, was_after_after_const_local_prefix)
            }

            // Zig: `inline else => |tag| return @field(visitors, @tagName(tag))(p, stmts, stmt, @field(stmt.data, @tagName(tag)))`
            Stmt::Data::SImport(data) => Self::s_import(p, stmts, stmt, data),
            Stmt::Data::SExportClause(data) => Self::s_export_clause(p, stmts, stmt, data),
            Stmt::Data::SExportFrom(data) => Self::s_export_from(p, stmts, stmt, data),
            Stmt::Data::SExportStar(data) => Self::s_export_star(p, stmts, stmt, data),
            Stmt::Data::SExportDefault(data) => Self::s_export_default(p, stmts, stmt, data),
            Stmt::Data::SFunction(data) => Self::s_function(p, stmts, stmt, data),
            Stmt::Data::SClass(data) => Self::s_class(p, stmts, stmt, data),
            Stmt::Data::SExportEquals(data) => Self::s_export_equals(p, stmts, stmt, data),
            Stmt::Data::SBreak(data) => Self::s_break(p, stmts, stmt, data),
            Stmt::Data::SContinue(data) => Self::s_continue(p, stmts, stmt, data),
            Stmt::Data::SLabel(data) => Self::s_label(p, stmts, stmt, data),
            Stmt::Data::SExpr(data) => Self::s_expr(p, stmts, stmt, data),
            Stmt::Data::SThrow(data) => Self::s_throw(p, stmts, stmt, data),
            Stmt::Data::SReturn(data) => Self::s_return(p, stmts, stmt, data),
            Stmt::Data::SBlock(data) => Self::s_block(p, stmts, stmt, data),
            Stmt::Data::SWith(data) => Self::s_with(p, stmts, stmt, data),
            Stmt::Data::SWhile(data) => Self::s_while(p, stmts, stmt, data),
            Stmt::Data::SDoWhile(data) => Self::s_do_while(p, stmts, stmt, data),
            Stmt::Data::SIf(data) => Self::s_if(p, stmts, stmt, data),
            Stmt::Data::SFor(data) => Self::s_for(p, stmts, stmt, data),
            Stmt::Data::SForIn(data) => Self::s_for_in(p, stmts, stmt, data),
            Stmt::Data::SForOf(data) => Self::s_for_of(p, stmts, stmt, data),
            Stmt::Data::STry(data) => Self::s_try(p, stmts, stmt, data),
            Stmt::Data::SSwitch(data) => Self::s_switch(p, stmts, stmt, data),
            Stmt::Data::SNamespace(data) => Self::s_namespace(p, stmts, stmt, data),

            // Only used by the bundler for lazy export ASTs.
            Stmt::Data::SLazyExport(_) => unreachable!(),
        }
    }

    // ─── visitors ────────────────────────────────────────────────────────────
    // Zig: `const visitors = struct { ... }` — flattened to associated fns.

    fn s_import(
        p: &mut P<PARSER_FEATURE_TYPESCRIPT, PARSER_FEATURE_JSX, PARSER_FEATURE_SCAN_ONLY>,
        stmts: &mut StmtList,
        stmt: &mut Stmt,
        data: &mut S::Import,
    ) -> Result<(), Error> {
        // TODO(port): narrow error set
        p.record_declared_symbol(data.namespace_ref)?;

        if let Some(default_name) = data.default_name {
            p.record_declared_symbol(default_name.ref_.unwrap())?;
        }

        if !data.items.is_empty() {
            for item in data.items.iter() {
                p.record_declared_symbol(item.name.ref_.unwrap())?;
            }
        }

        stmts.push(*stmt);
        Ok(())
    }

    fn s_export_clause(
        p: &mut P<PARSER_FEATURE_TYPESCRIPT, PARSER_FEATURE_JSX, PARSER_FEATURE_SCAN_ONLY>,
        stmts: &mut StmtList,
        stmt: &mut Stmt,
        data: &mut S::ExportClause,
    ) -> Result<(), Error> {
        // "export {foo}"
        let mut end: usize = 0;
        let mut any_replaced = false;
        if p.options.features.replace_exports.count() > 0 {
            // PORT NOTE: reshaped for borrowck — index loop instead of iter_mut + indexed write
            for i in 0..data.items.len() {
                let item = &mut data.items[i];
                let name = p.load_name_from_ref(item.name.ref_.unwrap());

                let symbol = p.find_symbol(item.alias_loc, name)?;
                let ref_ = symbol.ref_;

                if let Some(entry) = p.options.features.replace_exports.get_ptr(name) {
                    if !entry.is_replace() {
                        p.ignore_usage(symbol.ref_);
                    }
                    let _ = p.inject_replacement_export(stmts, symbol.ref_, stmt.loc, entry);
                    any_replaced = true;
                    continue;
                }

                if p.symbols[ref_.inner_index()].kind == js_ast::Symbol::Kind::Unbound {
                    // Silently strip exports of non-local symbols in TypeScript, since
                    // those likely correspond to type-only exports. But report exports of
                    // non-local symbols as errors in JavaScript.
                    if !Self::IS_TYPESCRIPT_ENABLED {
                        let r = js_lexer::range_of_identifier(p.source, item.name.loc);
                        p.log.add_range_error_fmt(
                            p.source,
                            r,
                            p.allocator,
                            format_args!("\"{}\" is not declared in this file", bstr::BStr::new(name)),
                        )?;
                    }
                    continue;
                }

                item.name.ref_ = Some(ref_);
                data.items[end] = data.items[i];
                end += 1;
            }
        } else {
            for i in 0..data.items.len() {
                let item = &mut data.items[i];
                let name = p.load_name_from_ref(item.name.ref_.unwrap());
                let symbol = p.find_symbol(item.alias_loc, name)?;
                let ref_ = symbol.ref_;

                if p.symbols[ref_.inner_index()].kind == js_ast::Symbol::Kind::Unbound {
                    // Silently strip exports of non-local symbols in TypeScript, since
                    // those likely correspond to type-only exports. But report exports of
                    // non-local symbols as errors in JavaScript.
                    if !Self::IS_TYPESCRIPT_ENABLED {
                        let r = js_lexer::range_of_identifier(p.source, item.name.loc);
                        p.log.add_range_error_fmt(
                            p.source,
                            r,
                            p.allocator,
                            format_args!("\"{}\" is not declared in this file", bstr::BStr::new(name)),
                        )?;
                        continue;
                    }
                    continue;
                }

                item.name.ref_ = Some(ref_);
                data.items[end] = data.items[i];
                end += 1;
            }
        }

        let remove_for_tree_shaking =
            any_replaced && end == 0 && !data.items.is_empty() && p.options.tree_shaking;
        data.items.truncate(end);

        if remove_for_tree_shaking {
            return Ok(());
        }

        stmts.push(*stmt);
        Ok(())
    }

    fn s_export_from(
        p: &mut P<PARSER_FEATURE_TYPESCRIPT, PARSER_FEATURE_JSX, PARSER_FEATURE_SCAN_ONLY>,
        stmts: &mut StmtList,
        stmt: &mut Stmt,
        data: &mut S::ExportFrom,
    ) -> Result<(), Error> {
        // "export {foo} from 'path'"
        let name = p.load_name_from_ref(data.namespace_ref);

        data.namespace_ref = p.new_symbol(js_ast::Symbol::Kind::Other, name)?;
        p.current_scope.generated.push(data.namespace_ref);
        p.record_declared_symbol(data.namespace_ref)?;

        if p.options.features.replace_exports.count() > 0 {
            let mut j: usize = 0;
            // This is a re-export and the symbols created here are used to reference
            for i in 0..data.items.len() {
                let item = data.items[i];
                let old_ref = item.name.ref_.unwrap();

                if p.options.features.replace_exports.count() > 0 {
                    if let Some(entry) = p.options.features.replace_exports.get_ptr(item.alias) {
                        let _ = p.inject_replacement_export(stmts, old_ref, logger::Loc::EMPTY, entry);
                        continue;
                    }
                }

                let _name = p.load_name_from_ref(old_ref);

                let ref_ = p.new_symbol(js_ast::Symbol::Kind::Import, _name)?;
                p.current_scope.generated.push(ref_);
                p.record_declared_symbol(ref_)?;
                data.items[j] = item;
                data.items[j].name.ref_ = Some(ref_);
                j += 1;
            }

            data.items.truncate(j);

            // TODO(port): dead branch in Zig — `data.items.len = j;` runs first, so
            // `j == 0 and data.items.len > 0` is always false. Mirrored bug-for-bug.
            #[allow(unreachable_code)]
            if j == 0 && !data.items.is_empty() {
                return Ok(());
            }
        } else {
            // This is a re-export and the symbols created here are used to reference
            for item in data.items.iter_mut() {
                let _name = p.load_name_from_ref(item.name.ref_.unwrap());
                let ref_ = p.new_symbol(js_ast::Symbol::Kind::Import, _name)?;
                p.current_scope.generated.push(ref_);
                p.record_declared_symbol(ref_)?;
                item.name.ref_ = Some(ref_);
            }
        }

        stmts.push(*stmt);
        Ok(())
    }

    fn s_export_star(
        p: &mut P<PARSER_FEATURE_TYPESCRIPT, PARSER_FEATURE_JSX, PARSER_FEATURE_SCAN_ONLY>,
        stmts: &mut StmtList,
        stmt: &mut Stmt,
        data: &mut S::ExportStar,
    ) -> Result<(), Error> {
        // "export * from 'path'"
        let name = p.load_name_from_ref(data.namespace_ref);
        data.namespace_ref = p.new_symbol(js_ast::Symbol::Kind::Other, name)?;
        p.current_scope.generated.push(data.namespace_ref);
        p.record_declared_symbol(data.namespace_ref)?;

        // "export * as ns from 'path'"
        if let Some(alias) = &data.alias {
            if p.options.features.replace_exports.count() > 0 {
                if let Some(entry) = p.options.features.replace_exports.get_ptr(alias.original_name) {
                    let _ = p.inject_replacement_export(
                        stmts,
                        p.declare_symbol(js_ast::Symbol::Kind::Other, logger::Loc::EMPTY, alias.original_name)
                            .expect("unreachable"),
                        logger::Loc::EMPTY,
                        entry,
                    );
                    return Ok(());
                }
            }
        }

        stmts.push(*stmt);
        Ok(())
    }

    fn s_export_default(
        p: &mut P<PARSER_FEATURE_TYPESCRIPT, PARSER_FEATURE_JSX, PARSER_FEATURE_SCAN_ONLY>,
        stmts: &mut StmtList,
        stmt: &mut Stmt,
        data: &mut S::ExportDefault,
    ) -> Result<(), Error> {
        // Zig: defer { if (data.default_name.ref) |ref| p.recordDeclaredSymbol(ref) catch unreachable; }
        // TODO(port): defer side-effect — emulated via scopeguard; borrowck may require restructuring.
        let _record_on_exit = scopeguard::guard((), |_| {
            if let Some(ref_) = data.default_name.ref_ {
                p.record_declared_symbol(ref_).expect("unreachable");
            }
        });

        let mut mark_for_replace: bool = false;

        let orig_dead = p.is_control_flow_dead;
        if p.options.features.replace_exports.count() > 0 {
            if let Some(entry) = p.options.features.replace_exports.get_ptr(b"default") {
                p.is_control_flow_dead =
                    p.options.features.dead_code_elimination && !entry.is_replace();
                mark_for_replace = true;
            }
        }

        // Zig: defer { p.is_control_flow_dead = orig_dead; }
        // TODO(port): defer side-effect — emulated via scopeguard; borrowck may require restructuring.
        let _restore_dead = scopeguard::guard((), |_| {
            p.is_control_flow_dead = orig_dead;
        });

        match &mut data.value {
            js_ast::StmtOrExpr::Expr(expr) => {
                let was_anonymous_named_expr = expr.is_anonymous_named();
                let prev_decorator_class_name = p.decorator_class_name;
                if was_anonymous_named_expr
                    && matches!(expr.data, Expr::Data::EClass(_))
                    && expr.data.e_class().should_lower_standard_decorators
                {
                    p.decorator_class_name = Some(js_ast::ClauseItem::DEFAULT_ALIAS);
                }
                data.value.set_expr(p.visit_expr(*expr));
                p.decorator_class_name = prev_decorator_class_name;

                if p.is_control_flow_dead {
                    return Ok(());
                }

                // Optionally preserve the name

                data.value.set_expr(p.maybe_keep_expr_symbol_name(
                    data.value.expr(),
                    js_ast::ClauseItem::DEFAULT_ALIAS,
                    was_anonymous_named_expr,
                ));

                // Discard type-only export default statements
                if Self::IS_TYPESCRIPT_ENABLED {
                    if let Expr::Data::EIdentifier(ident) = &data.value.expr().data {
                        if !ident.ref_.is_source_contents_slice() {
                            let symbol = &p.symbols[ident.ref_.inner_index()];
                            if symbol.kind == js_ast::Symbol::Kind::Unbound {
                                if let Some(local_type) = p.local_type_names.get(symbol.original_name) {
                                    if *local_type {
                                        // the name points to a type
                                        // don't try to declare this symbol
                                        data.default_name.ref_ = None;
                                        return Ok(());
                                    }
                                }
                            }
                        }
                    }
                }

                if data.default_name.ref_.unwrap().is_source_contents_slice() {
                    data.default_name =
                        Self::create_default_name(p, data.value.expr().loc).expect("unreachable");
                }

                let should_emit_temp_var = p.options.features.react_fast_refresh
                    && match &data.value.expr().data {
                        Expr::Data::EArrow(_) => true,
                        Expr::Data::ECall(call) => match &call.target.data {
                            Expr::Data::EIdentifier(id) => {
                                id.ref_ == p.react_refresh.latest_signature_ref
                            }
                            _ => false,
                        },
                        _ => false,
                    };
                if should_emit_temp_var {
                    // declare a temporary ref for this
                    let temp_id = p.generate_temp_ref(b"default_export");
                    p.current_scope.generated.push(temp_id);

                    stmts.push(Stmt::alloc(
                        S::Local {
                            kind: S::Local::Kind::KConst,
                            decls: G::Decl::List::from_slice(&[G::Decl {
                                binding: Binding::alloc(B::Identifier { ref_: temp_id }, stmt.loc),
                                value: Some(data.value.expr()),
                            }])?,
                            ..Default::default()
                        },
                        stmt.loc,
                    ));

                    data.value = js_ast::StmtOrExpr::Expr(Expr::init_identifier(temp_id, stmt.loc));

                    p.emit_react_refresh_register(stmts, b"default", temp_id, ReactRefresh::RegisterKind::Default)?;
                }

                if p.options.features.server_components.wraps_exports() {
                    data.value.set_expr(
                        p.wrap_value_for_server_component_reference(data.value.expr(), b"default"),
                    );
                }

                // If there are lowered "using" declarations, change this into a "var"
                if p.current_scope.parent.is_none() && p.will_wrap_module_in_try_catch_for_using {
                    stmts.reserve(2);

                    let mut decls = BumpVec::with_capacity_in(1, p.allocator);
                    decls.push(G::Decl {
                        binding: p.b(
                            B::Identifier { ref_: data.default_name.ref_.unwrap() },
                            data.default_name.loc,
                        ),
                        value: Some(data.value.expr()),
                    });
                    // PERF(port): was assume_capacity
                    stmts.push(p.s(
                        S::Local {
                            decls: G::Decl::List::from_owned_slice(decls),
                            ..Default::default()
                        },
                        stmt.loc,
                    ));
                    let mut items = BumpVec::with_capacity_in(1, p.allocator);
                    items.push(js_ast::ClauseItem {
                        alias: b"default",
                        alias_loc: data.default_name.loc,
                        name: data.default_name,
                    });
                    // PERF(port): was assume_capacity
                    stmts.push(p.s(
                        S::ExportClause { items, is_single_line: false },
                        stmt.loc,
                    ));
                }

                if mark_for_replace {
                    let entry = p.options.features.replace_exports.get_ptr(b"default").unwrap();
                    if entry.is_replace() {
                        data.value.set_expr(entry.replace());
                    } else {
                        let _ = p.inject_replacement_export(stmts, Ref::NONE, logger::Loc::EMPTY, entry);
                        return Ok(());
                    }
                }
            }

            js_ast::StmtOrExpr::Stmt(s2) => match &mut s2.data {
                Stmt::Data::SFunction(func) => {
                    let name = if let Some(func_loc) = func.func.name {
                        p.load_name_from_ref(func_loc.ref_.unwrap())
                    } else {
                        func.func.name = Some(data.default_name);
                        js_ast::ClauseItem::DEFAULT_ALIAS
                    };

                    let mut react_hook_data: Option<ReactRefresh::HookContext> = None;
                    let prev = p.react_refresh.hook_ctx_storage;
                    // Zig: defer p.react_refresh.hook_ctx_storage = prev;
                    // TODO(port): defer side-effect — borrowck restructure needed
                    let _restore_hook = scopeguard::guard((), |_| {
                        p.react_refresh.hook_ctx_storage = prev;
                    });
                    p.react_refresh.hook_ctx_storage = Some(&mut react_hook_data as *mut _);

                    func.func = p.visit_func(func.func, func.func.open_parens_loc);

                    if p.is_control_flow_dead {
                        return Ok(());
                    }

                    if data.default_name.ref_.unwrap().is_source_contents_slice() {
                        data.default_name = Self::create_default_name(p, stmt.loc).expect("unreachable");
                    }

                    if let Some(hook) = react_hook_data.as_mut() {
                        stmts.push(p.get_react_refresh_hook_signal_decl(hook.signature_cb));

                        data.value = js_ast::StmtOrExpr::Expr(
                            p.get_react_refresh_hook_signal_init(
                                hook,
                                p.new_expr(E::Function { func: func.func }, stmt.loc),
                            ),
                        );
                    }

                    if mark_for_replace {
                        let entry = p.options.features.replace_exports.get_ptr(b"default").unwrap();
                        if entry.is_replace() {
                            data.value = js_ast::StmtOrExpr::Expr(entry.replace());
                        } else {
                            let _ = p.inject_replacement_export(stmts, Ref::NONE, logger::Loc::EMPTY, entry);
                            return Ok(());
                        }
                    }

                    if p.options.features.react_fast_refresh
                        && (ReactRefresh::is_componentish_name(name) || name == b"default")
                    {
                        // If server components or react refresh had wrapped the value (convert to .expr)
                        // then a temporary variable must be emitted.
                        //
                        // > export default _s(function App() { ... }, "...")
                        // > $RefreshReg(App, "App.tsx:default")
                        //
                        // > const default_export = _s(function App() { ... }, "...")
                        // > export default default_export;
                        // > $RefreshReg(default_export, "App.tsx:default")
                        let ref_ = if matches!(data.value, js_ast::StmtOrExpr::Expr(_)) {
                            'emit_temp_var: {
                                let ref_to_use = 'brk: {
                                    if let Some(loc_ref) = &func.func.name {
                                        // Input:
                                        //
                                        //  export default function Foo() {}
                                        //
                                        // Output:
                                        //
                                        //  const Foo = _s(function Foo() {})
                                        //  export default Foo;
                                        if let Some(ref_) = loc_ref.ref_ {
                                            break 'brk ref_;
                                        }
                                    }

                                    let temp_id = p.generate_temp_ref(b"default_export");
                                    p.current_scope.generated.push(temp_id);
                                    break 'brk temp_id;
                                };

                                stmts.push(Stmt::alloc(
                                    S::Local {
                                        kind: S::Local::Kind::KConst,
                                        decls: G::Decl::List::from_slice(&[G::Decl {
                                            binding: Binding::alloc(
                                                B::Identifier { ref_: ref_to_use },
                                                stmt.loc,
                                            ),
                                            value: Some(data.value.expr()),
                                        }])?,
                                        ..Default::default()
                                    },
                                    stmt.loc,
                                ));

                                data.value =
                                    js_ast::StmtOrExpr::Expr(Expr::init_identifier(ref_to_use, stmt.loc));

                                break 'emit_temp_var ref_to_use;
                            }
                        } else {
                            data.default_name.ref_.unwrap()
                        };

                        if p.options.features.server_components.wraps_exports() {
                            let inner = if let js_ast::StmtOrExpr::Expr(e) = &data.value {
                                *e
                            } else {
                                p.new_expr(E::Function { func: func.func }, stmt.loc)
                            };
                            data.value = js_ast::StmtOrExpr::Expr(
                                p.wrap_value_for_server_component_reference(inner, b"default"),
                            );
                        }

                        stmts.push(*stmt);
                        p.emit_react_refresh_register(stmts, name, ref_, ReactRefresh::RegisterKind::Default)?;
                    } else {
                        if p.options.features.server_components.wraps_exports() {
                            data.value = js_ast::StmtOrExpr::Expr(
                                p.wrap_value_for_server_component_reference(
                                    p.new_expr(E::Function { func: func.func }, stmt.loc),
                                    b"default",
                                ),
                            );
                        }

                        stmts.push(*stmt);
                    }

                    // if (func.func.name != null and func.func.name.?.ref != null) {
                    //     stmts.append(p.keepStmtSymbolName(func.func.name.?.loc, func.func.name.?.ref.?, name)) catch unreachable;
                    // }
                    return Ok(());
                }
                Stmt::Data::SClass(class) => {
                    let _ = p.visit_class(s2.loc, &mut class.class, data.default_name.ref_.unwrap());

                    if p.is_control_flow_dead {
                        return Ok(());
                    }

                    if mark_for_replace {
                        let entry = p.options.features.replace_exports.get_ptr(b"default").unwrap();
                        if entry.is_replace() {
                            data.value = js_ast::StmtOrExpr::Expr(entry.replace());
                        } else {
                            let _ = p.inject_replacement_export(stmts, Ref::NONE, logger::Loc::EMPTY, entry);
                            return Ok(());
                        }
                    }

                    if data.default_name.ref_.unwrap().is_source_contents_slice() {
                        data.default_name = Self::create_default_name(p, stmt.loc).expect("unreachable");
                    }

                    // We only inject a name into classes when there is a decorator
                    if class.class.has_decorators {
                        if class.class.class_name.is_none()
                            || class.class.class_name.unwrap().ref_.is_none()
                        {
                            class.class.class_name = Some(data.default_name);
                        }
                    }

                    // Lower the class (handles both TS legacy and standard decorators).
                    // Standard decorator lowering may produce prefix statements
                    // (variable declarations) before the class statement.
                    let class_stmts = p.lower_class(js_ast::StmtOrExpr::Stmt(*s2));

                    // Find the s_class statement in the returned list
                    let mut class_stmt_idx: usize = 0;
                    for (idx, cs) in class_stmts.iter().enumerate() {
                        if matches!(cs.data, Stmt::Data::SClass(_)) {
                            class_stmt_idx = idx;
                            break;
                        }
                    }

                    // Emit any prefix statements before the export default
                    let _ = stmts.extend_from_slice(&class_stmts[0..class_stmt_idx]);

                    data.value = js_ast::StmtOrExpr::Stmt(class_stmts[class_stmt_idx]);
                    let _ = stmts.push(*stmt);

                    // Emit any suffix statements after the export default
                    if class_stmt_idx + 1 < class_stmts.len() {
                        let _ = stmts.extend_from_slice(&class_stmts[class_stmt_idx + 1..]);
                    }

                    if p.options.features.server_components.wraps_exports() {
                        data.value = js_ast::StmtOrExpr::Expr(
                            p.wrap_value_for_server_component_reference(
                                p.new_expr(class.class, stmt.loc),
                                b"default",
                            ),
                        );
                    }

                    return Ok(());
                }
                _ => {}
            },
        }

        stmts.push(*stmt);
        Ok(())
    }

    fn s_function(
        p: &mut P<PARSER_FEATURE_TYPESCRIPT, PARSER_FEATURE_JSX, PARSER_FEATURE_SCAN_ONLY>,
        stmts: &mut StmtList,
        stmt: &mut Stmt,
        data: &mut S::Function,
    ) -> Result<(), Error> {
        // We mark it as dead, but the value may not actually be dead
        // We just want to be sure to not increment the usage counts for anything in the function
        let mark_as_dead = p.options.features.dead_code_elimination
            && data.func.flags.contains(G::Fn::Flags::IsExport)
            && p.options.features.replace_exports.count() > 0
            && p.is_export_to_eliminate(data.func.name.unwrap().ref_.unwrap());
        let original_is_dead = p.is_control_flow_dead;

        if mark_as_dead {
            p.is_control_flow_dead = true;
        }
        // Zig: defer { if (mark_as_dead) p.is_control_flow_dead = original_is_dead; }
        // TODO(port): defer side-effect — borrowck restructure needed
        let _restore_dead = scopeguard::guard((), |_| {
            if mark_as_dead {
                p.is_control_flow_dead = original_is_dead;
            }
        });

        let mut react_hook_data: Option<ReactRefresh::HookContext> = None;
        let prev = p.react_refresh.hook_ctx_storage;
        // Zig: defer p.react_refresh.hook_ctx_storage = prev;
        // TODO(port): defer side-effect — borrowck restructure needed
        let _restore_hook = scopeguard::guard((), |_| {
            p.react_refresh.hook_ctx_storage = prev;
        });
        p.react_refresh.hook_ctx_storage = Some(&mut react_hook_data as *mut _);

        data.func = p.visit_func(data.func, data.func.open_parens_loc);

        let name_ref = data.func.name.unwrap().ref_.unwrap();
        debug_assert!(name_ref.tag == Ref::Tag::Symbol);
        // PORT NOTE: reshaped for borrowck — capture original_name as owned/static slice
        let name_symbol = &p.symbols[name_ref.inner_index()];
        let original_name = name_symbol.original_name;
        let remove_overwritten = name_symbol.remove_overwritten_function_declaration;

        // Handle exporting this function from a namespace
        if data.func.flags.contains(G::Fn::Flags::IsExport) && p.enclosing_namespace_arg_ref.is_some() {
            data.func.flags.remove(G::Fn::Flags::IsExport);

            let enclosing_namespace_arg_ref = p.enclosing_namespace_arg_ref.unwrap();
            stmts.reserve(3);
            // PERF(port): was assume_capacity
            stmts.push(*stmt);
            // PERF(port): was assume_capacity
            stmts.push(Stmt::assign(
                p.new_expr(
                    E::Dot {
                        target: p.new_expr(
                            E::Identifier { ref_: enclosing_namespace_arg_ref },
                            stmt.loc,
                        ),
                        name: original_name,
                        name_loc: data.func.name.unwrap().loc,
                    },
                    stmt.loc,
                ),
                p.new_expr(
                    E::Identifier { ref_: data.func.name.unwrap().ref_.unwrap() },
                    data.func.name.unwrap().loc,
                ),
            ));
        } else if !mark_as_dead {
            if remove_overwritten {
                return Ok(());
            }

            if p.options.features.server_components.wraps_exports()
                && data.func.flags.contains(G::Fn::Flags::IsExport)
            {
                // Convert this into `export var <name> = registerClientReference(<func>, ...);`
                let name = data.func.name.unwrap();
                // From the inner scope, have code reference the wrapped function.
                data.func.name = None;
                stmts.push(p.s(
                    S::Local {
                        kind: S::Local::Kind::KVar,
                        is_export: true,
                        decls: G::Decl::List::from_slice(&[G::Decl {
                            binding: p.b(B::Identifier { ref_: name_ref }, name.loc),
                            value: Some(p.wrap_value_for_server_component_reference(
                                p.new_expr(E::Function { func: data.func }, stmt.loc),
                                original_name,
                            )),
                        }])?,
                        ..Default::default()
                    },
                    stmt.loc,
                ));
            } else {
                stmts.push(*stmt);
            }
        } else if mark_as_dead {
            if let Some(replacement) = p.options.features.replace_exports.get_ptr(original_name) {
                let _ = p.inject_replacement_export(stmts, name_ref, data.func.name.unwrap().loc, replacement);
            }
        }

        if p.options.features.react_fast_refresh {
            if let Some(hook) = react_hook_data.as_mut() {
                stmts.push(p.get_react_refresh_hook_signal_decl(hook.signature_cb));
                stmts.push(p.s(
                    S::SExpr {
                        value: p.get_react_refresh_hook_signal_init(
                            hook,
                            Expr::init_identifier(name_ref, logger::Loc::EMPTY),
                        ),
                        ..Default::default()
                    },
                    logger::Loc::EMPTY,
                ));
            }

            if core::ptr::eq(p.current_scope, p.module_scope) {
                p.handle_react_refresh_register(stmts, original_name, name_ref, ReactRefresh::RegisterKind::Named)?;
            }
        }

        Ok(())
    }

    fn s_class(
        p: &mut P<PARSER_FEATURE_TYPESCRIPT, PARSER_FEATURE_JSX, PARSER_FEATURE_SCAN_ONLY>,
        stmts: &mut StmtList,
        stmt: &mut Stmt,
        data: &mut S::Class,
    ) -> Result<(), Error> {
        let mark_as_dead = p.options.features.dead_code_elimination
            && data.is_export
            && p.options.features.replace_exports.count() > 0
            && p.is_export_to_eliminate(data.class.class_name.unwrap().ref_.unwrap());
        let original_is_dead = p.is_control_flow_dead;

        if mark_as_dead {
            p.is_control_flow_dead = true;
        }
        // Zig: defer { if (mark_as_dead) p.is_control_flow_dead = original_is_dead; }
        // TODO(port): defer side-effect — borrowck restructure needed
        let _restore_dead = scopeguard::guard((), |_| {
            if mark_as_dead {
                p.is_control_flow_dead = original_is_dead;
            }
        });

        let _ = p.visit_class(stmt.loc, &mut data.class, Ref::NONE);

        // Remove the export flag inside a namespace
        let was_export_inside_namespace = data.is_export && p.enclosing_namespace_arg_ref.is_some();
        if was_export_inside_namespace {
            data.is_export = false;
        }

        let lowered = p.lower_class(js_ast::StmtOrExpr::Stmt(*stmt));

        if !mark_as_dead || was_export_inside_namespace {
            // Lower class field syntax for browsers that don't support it
            stmts.extend_from_slice(lowered);
        } else {
            let ref_ = data.class.class_name.unwrap().ref_.unwrap();
            if let Some(replacement) =
                p.options.features.replace_exports.get_ptr(p.load_name_from_ref(ref_))
            {
                if p.inject_replacement_export(
                    stmts,
                    ref_,
                    data.class.class_name.unwrap().loc,
                    replacement,
                ) {
                    p.is_control_flow_dead = original_is_dead;
                }
            }
        }

        // Handle exporting this class from a namespace
        if was_export_inside_namespace {
            stmts.push(Stmt::assign(
                p.new_expr(
                    E::Dot {
                        target: p.new_expr(
                            E::Identifier { ref_: p.enclosing_namespace_arg_ref.unwrap() },
                            stmt.loc,
                        ),
                        name: p.symbols
                            [data.class.class_name.unwrap().ref_.unwrap().inner_index()]
                        .original_name,
                        name_loc: data.class.class_name.unwrap().loc,
                    },
                    stmt.loc,
                ),
                p.new_expr(
                    E::Identifier { ref_: data.class.class_name.unwrap().ref_.unwrap() },
                    data.class.class_name.unwrap().loc,
                ),
            ));
        }

        Ok(())
    }

    fn s_export_equals(
        p: &mut P<PARSER_FEATURE_TYPESCRIPT, PARSER_FEATURE_JSX, PARSER_FEATURE_SCAN_ONLY>,
        stmts: &mut StmtList,
        stmt: &mut Stmt,
        data: &mut S::ExportEquals,
    ) -> Result<(), Error> {
        // "module.exports = value"
        stmts.push(Stmt::assign(
            // Zig: p.@"module.exports"(stmt.loc)
            // TODO(port): method name `@"module.exports"` — mapped to `module_exports`
            p.module_exports(stmt.loc),
            p.visit_expr(data.value),
        ));
        p.record_usage(p.module_ref);
        Ok(())
    }

    fn s_break(
        p: &mut P<PARSER_FEATURE_TYPESCRIPT, PARSER_FEATURE_JSX, PARSER_FEATURE_SCAN_ONLY>,
        stmts: &mut StmtList,
        stmt: &mut Stmt,
        data: &mut S::Break,
    ) -> Result<(), Error> {
        if let Some(label) = &mut data.label {
            let name = p.load_name_from_ref(
                label
                    .ref_
                    .unwrap_or_else(|| p.panic_loc("Expected label to have a ref", label.loc)),
            );
            let res = p.find_label_symbol(label.loc, name);
            if res.found {
                label.ref_ = Some(res.ref_);
            } else {
                data.label = None;
            }
        } else if !p.fn_or_arrow_data_visit.is_inside_loop
            && !p.fn_or_arrow_data_visit.is_inside_switch
        {
            let r = js_lexer::range_of_identifier(p.source, stmt.loc);
            p.log
                .add_range_error(p.source, r, "Cannot use \"break\" here")
                .expect("unreachable");
        }

        stmts.push(*stmt);
        Ok(())
    }

    fn s_continue(
        p: &mut P<PARSER_FEATURE_TYPESCRIPT, PARSER_FEATURE_JSX, PARSER_FEATURE_SCAN_ONLY>,
        stmts: &mut StmtList,
        stmt: &mut Stmt,
        data: &mut S::Continue,
    ) -> Result<(), Error> {
        if let Some(label) = &mut data.label {
            let name = p.load_name_from_ref(
                label
                    .ref_
                    .unwrap_or_else(|| p.panic_loc("Expected continue label to have a ref", label.loc)),
            );
            let res = p.find_label_symbol(label.loc, name);
            label.ref_ = Some(res.ref_);
            if res.found && !res.is_loop {
                let r = js_lexer::range_of_identifier(p.source, stmt.loc);
                p.log
                    .add_range_error_fmt(
                        p.source,
                        r,
                        p.allocator,
                        format_args!("Cannot \"continue\" to label {}", bstr::BStr::new(name)),
                    )
                    .expect("unreachable");
            }
        } else if !p.fn_or_arrow_data_visit.is_inside_loop {
            let r = js_lexer::range_of_identifier(p.source, stmt.loc);
            p.log
                .add_range_error(p.source, r, "Cannot use \"continue\" here")
                .expect("unreachable");
        }

        stmts.push(*stmt);
        Ok(())
    }

    fn s_label(
        p: &mut P<PARSER_FEATURE_TYPESCRIPT, PARSER_FEATURE_JSX, PARSER_FEATURE_SCAN_ONLY>,
        stmts: &mut StmtList,
        stmt: &mut Stmt,
        data: &mut S::Label,
    ) -> Result<(), Error> {
        p.push_scope_for_visit_pass(js_ast::Scope::Kind::Label, stmt.loc).expect("unreachable");
        let name = p.load_name_from_ref(data.name.ref_.unwrap());
        let ref_ = p.new_symbol(js_ast::Symbol::Kind::Label, name).expect("unreachable");
        data.name.ref_ = Some(ref_);
        p.current_scope.label_ref = Some(ref_);
        match data.stmt.data {
            Stmt::Data::SFor(_)
            | Stmt::Data::SForIn(_)
            | Stmt::Data::SForOf(_)
            | Stmt::Data::SWhile(_)
            | Stmt::Data::SDoWhile(_) => {
                p.current_scope.label_stmt_is_loop = true;
            }
            _ => {}
        }

        data.stmt = p.visit_single_stmt(data.stmt, StmtsKind::None);
        p.pop_scope();

        stmts.push(*stmt);
        Ok(())
    }

    fn s_local(
        p: &mut P<PARSER_FEATURE_TYPESCRIPT, PARSER_FEATURE_JSX, PARSER_FEATURE_SCAN_ONLY>,
        stmts: &mut StmtList,
        stmt: &mut Stmt,
        data: &mut S::Local,
        was_after_after_const_local_prefix: bool,
    ) -> Result<(), Error> {
        // TODO: Silently remove unsupported top-level "await" in dead code branches
        // (this was from 'await using' syntax)

        // Local statements do not end the const local prefix
        p.current_scope.is_after_const_local_prefix = was_after_after_const_local_prefix;

        let decls_len = if !(data.is_export && p.options.features.replace_exports.entries.len() > 0) {
            p.visit_decls(data.decls.slice_mut(), data.kind == S::Local::Kind::KConst, false)
        } else {
            p.visit_decls(data.decls.slice_mut(), data.kind == S::Local::Kind::KConst, true)
        };

        let is_now_dead = data.decls.len() > 0 && decls_len == 0;
        if is_now_dead {
            return Ok(());
        }

        data.decls.set_len(decls_len as u32);

        // Handle being exported inside a namespace
        if data.is_export && p.enclosing_namespace_arg_ref.is_some() {
            for d in data.decls.slice() {
                if let Some(val) = d.value {
                    p.record_usage(p.enclosing_namespace_arg_ref.unwrap());
                    // TODO: is it necessary to lowerAssign? why does esbuild do it _most_ of the time?
                    stmts.push(p.s(
                        S::SExpr {
                            value: Expr::assign(
                                Binding::to_expr(&d.binding, p.to_expr_wrapper_namespace),
                                val,
                            ),
                            ..Default::default()
                        },
                        stmt.loc,
                    ));
                }
            }

            return Ok(());
        }

        // Optimization: Avoid unnecessary "using" machinery by changing ones
        // initialized to "null" or "undefined" into a normal variable. Note that
        // "await using" still needs the "await", so we can't do it for those.
        if p.options.features.minify_syntax && data.kind == S::Local::Kind::KUsing {
            data.kind = S::Local::Kind::KLet;
            for d in data.decls.slice() {
                if let Some(val) = d.value {
                    if !matches!(val.data, Expr::Data::ENull(_)) && !matches!(val.data, Expr::Data::EUndefined(_)) {
                        data.kind = S::Local::Kind::KUsing;
                        break;
                    }
                }
            }
        }

        // We must relocate vars in order to safely handle removing if/else depending on NODE_ENV.
        // Edgecase:
        //  `export var` is skipped because it's unnecessary. That *should* be a noop, but it loses the `is_export` flag if we're in HMR.
        let kind = p.select_local_kind(data.kind);
        if kind == S::Local::Kind::KVar && !data.is_export {
            let relocated = p.maybe_relocate_vars_to_top_level(data.decls.slice(), RelocateVars::Mode::Normal);
            if relocated.ok {
                if let Some(new_stmt) = relocated.stmt {
                    stmts.push(new_stmt);
                }

                return Ok(());
            }
        }

        data.kind = kind;
        stmts.push(*stmt);

        if p.options.features.react_fast_refresh && core::ptr::eq(p.current_scope, p.module_scope) {
            for decl in data.decls.slice() {
                'try_register: {
                    let Some(val) = decl.value else { break 'try_register };
                    match &val.data {
                        // Assigning a component to a local.
                        Expr::Data::EArrow(_) | Expr::Data::EFunction(_) => {}

                        // A wrapped component.
                        Expr::Data::ECall(call) => match &call.target.data {
                            Expr::Data::EIdentifier(id) => {
                                if id.ref_ != p.react_refresh.latest_signature_ref {
                                    break 'try_register;
                                }
                            }
                            _ => break 'try_register,
                        },
                        _ => break 'try_register,
                    }
                    let id = match &decl.binding.data {
                        Binding::Data::BIdentifier(id) => id.ref_,
                        _ => break 'try_register,
                    };
                    let original_name = p.symbols[id.inner_index()].original_name;
                    p.handle_react_refresh_register(stmts, original_name, id, ReactRefresh::RegisterKind::Named)?;
                }
            }
        }

        if data.is_export && p.options.features.server_components.wraps_exports() {
            for decl in data.decls.slice_mut() {
                'try_annotate: {
                    let Some(val) = decl.value else { break 'try_annotate };
                    let id = match &decl.binding.data {
                        Binding::Data::BIdentifier(id) => id.ref_,
                        _ => break 'try_annotate,
                    };
                    let original_name = p.symbols[id.inner_index()].original_name;
                    decl.value = Some(p.wrap_value_for_server_component_reference(val, original_name));
                }
            }
        }

        Ok(())
    }

    fn s_expr(
        p: &mut P<PARSER_FEATURE_TYPESCRIPT, PARSER_FEATURE_JSX, PARSER_FEATURE_SCAN_ONLY>,
        stmts: &mut StmtList,
        stmt: &mut Stmt,
        data: &mut S::SExpr,
    ) -> Result<(), Error> {
        let should_trim_primitive = p.options.features.dead_code_elimination
            && (p.options.features.minify_syntax && data.value.is_primitive_literal());
        p.stmt_expr_value = data.value.data;
        // Zig: defer p.stmt_expr_value = .{ .e_missing = .{} };
        // TODO(port): defer side-effect — borrowck restructure needed
        let _restore_stmt_expr = scopeguard::guard((), |_| {
            p.stmt_expr_value = Expr::Data::EMissing(Default::default());
        });

        let is_top_level = core::ptr::eq(p.current_scope, p.module_scope);
        if p.should_unwrap_common_js_to_esm() {
            p.commonjs_named_exports_needs_conversion = if is_top_level {
                u32::MAX
            } else {
                p.commonjs_named_exports_needs_conversion
            };
        }

        data.value = p.visit_expr(data.value);

        if should_trim_primitive && data.value.is_primitive_literal() {
            return Ok(());
        }

        // simplify unused
        let Some(simplified) = SideEffects::simplify_unused_expr(p, data.value) else {
            return Ok(());
        };
        data.value = simplified;

        if p.should_unwrap_common_js_to_esm() {
            if is_top_level {
                if matches!(data.value.data, Expr::Data::EBinary(_)) {
                    let to_convert = p.commonjs_named_exports_needs_conversion;
                    if to_convert != u32::MAX {
                        p.commonjs_named_exports_needs_conversion = u32::MAX;
                        'convert: {
                            let bin: &mut E::Binary = data.value.data.e_binary_mut();
                            if bin.op == js_ast::Op::Code::BinAssign
                                && matches!(bin.left.data, Expr::Data::ECommonJSExportIdentifier(_))
                            {
                                let last = &mut p.commonjs_named_exports.values_mut()[to_convert as usize];
                                if !last.needs_decl {
                                    break 'convert;
                                }
                                last.needs_decl = false;

                                let mut decls = BumpVec::with_capacity_in(1, p.allocator);
                                let ref_ = bin.left.data.e_commonjs_export_identifier().ref_;
                                decls.push(Decl {
                                    binding: p.b(B::Identifier { ref_ }, bin.left.loc),
                                    value: Some(bin.right),
                                });
                                // we have to ensure these are known to be top-level
                                p.declared_symbols.push(js_ast::DeclaredSymbol {
                                    ref_,
                                    is_top_level: true,
                                });
                                p.esm_export_keyword.loc = stmt.loc;
                                p.esm_export_keyword.len = 5;
                                p.had_commonjs_named_exports_this_visit = true;
                                let mut clause_items = BumpVec::with_capacity_in(1, p.allocator);
                                clause_items.push(js_ast::ClauseItem {
                                    // We want the generated name to not conflict
                                    alias: p.commonjs_named_exports.keys()[to_convert as usize],
                                    alias_loc: bin.left.loc,
                                    name: js_ast::LocRef {
                                        ref_: Some(ref_),
                                        loc: last.loc_ref.loc,
                                    },
                                });
                                stmts.extend_from_slice(&[
                                    p.s(
                                        S::Local {
                                            kind: S::Local::Kind::KVar,
                                            is_export: false,
                                            was_commonjs_export: true,
                                            decls: G::Decl::List::from_owned_slice(decls),
                                            ..Default::default()
                                        },
                                        stmt.loc,
                                    ),
                                    p.s(
                                        S::ExportClause {
                                            items: clause_items,
                                            is_single_line: true,
                                        },
                                        stmt.loc,
                                    ),
                                ]);

                                return Ok(());
                            }
                        }
                    } else if !p.commonjs_replacement_stmts.is_empty() {
                        if stmts.is_empty() {
                            // TODO(port): Zig directly swaps backing storage; emulate with mem::take
                            *stmts = core::mem::take(&mut p.commonjs_replacement_stmts).into();
                            // PORT NOTE: reshaped for borrowck — Zig sets items/capacity directly
                        } else {
                            stmts.extend_from_slice(&p.commonjs_replacement_stmts);
                            p.commonjs_replacement_stmts.clear();
                            // TODO(port): Zig sets `.len = 0` on a slice; here we clear the Vec
                        }

                        return Ok(());
                    }
                }
            }
        }

        stmts.push(*stmt);
        Ok(())
    }

    fn s_throw(
        p: &mut P<PARSER_FEATURE_TYPESCRIPT, PARSER_FEATURE_JSX, PARSER_FEATURE_SCAN_ONLY>,
        stmts: &mut StmtList,
        stmt: &mut Stmt,
        data: &mut S::Throw,
    ) -> Result<(), Error> {
        data.value = p.visit_expr(data.value);
        stmts.push(*stmt);
        Ok(())
    }

    fn s_return(
        p: &mut P<PARSER_FEATURE_TYPESCRIPT, PARSER_FEATURE_JSX, PARSER_FEATURE_SCAN_ONLY>,
        stmts: &mut StmtList,
        stmt: &mut Stmt,
        data: &mut S::Return,
    ) -> Result<(), Error> {
        // Forbid top-level return inside modules with ECMAScript-style exports
        if p.fn_or_arrow_data_visit.is_outside_fn_or_arrow {
            let where_ = 'where_: {
                if p.esm_export_keyword.len > 0 {
                    break 'where_ p.esm_export_keyword;
                } else if p.top_level_await_keyword.len > 0 {
                    break 'where_ p.top_level_await_keyword;
                } else {
                    break 'where_ logger::Range::NONE;
                }
            };

            if where_.len > 0 {
                p.log
                    .add_range_error(
                        p.source,
                        where_,
                        "Top-level return cannot be used inside an ECMAScript module",
                    )
                    .expect("unreachable");
            }
        }

        if let Some(val) = data.value {
            data.value = Some(p.visit_expr(val));

            // "return undefined;" can safely just always be "return;"
            if let Some(v) = &data.value {
                if matches!(v.data, Expr::Data::EUndefined(_)) {
                    // Returning undefined is implicit
                    data.value = None;
                }
            }
        }

        stmts.push(*stmt);
        Ok(())
    }

    fn s_block(
        p: &mut P<PARSER_FEATURE_TYPESCRIPT, PARSER_FEATURE_JSX, PARSER_FEATURE_SCAN_ONLY>,
        stmts: &mut StmtList,
        stmt: &mut Stmt,
        data: &mut S::Block,
    ) -> Result<(), Error> {
        {
            p.push_scope_for_visit_pass(js_ast::Scope::Kind::Block, stmt.loc).expect("unreachable");

            // Pass the "is loop body" status on to the direct children of a block used
            // as a loop body. This is used to enable optimizations specific to the
            // topmost scope in a loop body block.
            let kind = if p.loop_body == stmt.data {
                StmtsKind::LoopBody
            } else {
                StmtsKind::None
            };
            // TODO(port): `ListManaged(Stmt).fromOwnedSlice` — arena-backed; using Vec::from for now
            let mut _stmts: StmtList = core::mem::take(&mut data.stmts).into();
            p.visit_stmts(&mut _stmts, kind).expect("unreachable");
            data.stmts = _stmts.into();
            p.pop_scope();
        }

        if p.options.features.minify_syntax {
            // // trim empty statements
            if data.stmts.is_empty() {
                stmts.push(Stmt { data: Prefill::Data::S_EMPTY, loc: stmt.loc });
                return Ok(());
            } else if data.stmts.len() == 1 && !statement_cares_about_scope(&data.stmts[0]) {
                // Unwrap blocks containing a single statement
                stmts.push(data.stmts[0]);
                return Ok(());
            }
        }

        stmts.push(*stmt);
        Ok(())
    }

    fn s_with(
        p: &mut P<PARSER_FEATURE_TYPESCRIPT, PARSER_FEATURE_JSX, PARSER_FEATURE_SCAN_ONLY>,
        stmts: &mut StmtList,
        stmt: &mut Stmt,
        data: &mut S::With,
    ) -> Result<(), Error> {
        data.value = p.visit_expr(data.value);

        p.push_scope_for_visit_pass(js_ast::Scope::Kind::With, data.body_loc).expect("unreachable");

        // This can be many different kinds of statements.
        // example code:
        //
        //      with(this.document.defaultView || Object.create(null))
        //         with(this.document)
        //           with(this.form)
        //             with(this.element)
        //
        data.body = p.visit_single_stmt(data.body, StmtsKind::None);

        p.pop_scope();
        stmts.push(*stmt);
        Ok(())
    }

    fn s_while(
        p: &mut P<PARSER_FEATURE_TYPESCRIPT, PARSER_FEATURE_JSX, PARSER_FEATURE_SCAN_ONLY>,
        stmts: &mut StmtList,
        stmt: &mut Stmt,
        data: &mut S::While,
    ) -> Result<(), Error> {
        data.test_ = p.visit_expr(data.test_);
        data.body = p.visit_loop_body(data.body);

        data.test_ = SideEffects::simplify_boolean(p, data.test_);
        let result = SideEffects::to_boolean(p, &data.test_.data);
        if result.ok && result.side_effects == SideEffects::NoSideEffects {
            data.test_ = p.new_expr(E::Boolean { value: result.value }, data.test_.loc);
        }

        stmts.push(*stmt);
        Ok(())
    }

    fn s_do_while(
        p: &mut P<PARSER_FEATURE_TYPESCRIPT, PARSER_FEATURE_JSX, PARSER_FEATURE_SCAN_ONLY>,
        stmts: &mut StmtList,
        stmt: &mut Stmt,
        data: &mut S::DoWhile,
    ) -> Result<(), Error> {
        data.body = p.visit_loop_body(data.body);
        data.test_ = p.visit_expr(data.test_);

        data.test_ = SideEffects::simplify_boolean(p, data.test_);
        stmts.push(*stmt);
        Ok(())
    }

    fn s_if(
        p: &mut P<PARSER_FEATURE_TYPESCRIPT, PARSER_FEATURE_JSX, PARSER_FEATURE_SCAN_ONLY>,
        stmts: &mut StmtList,
        stmt: &mut Stmt,
        data: &mut S::If,
    ) -> Result<(), Error> {
        let prev_in_branch = p.in_branch_condition;
        p.in_branch_condition = true;
        data.test_ = p.visit_expr(data.test_);
        p.in_branch_condition = prev_in_branch;

        if p.options.features.minify_syntax {
            data.test_ = SideEffects::simplify_boolean(p, data.test_);
        }

        let effects = SideEffects::to_boolean(p, &data.test_.data);
        if effects.ok && !effects.value {
            let old = p.is_control_flow_dead;
            p.is_control_flow_dead = true;
            data.yes = p.visit_single_stmt(data.yes, StmtsKind::None);
            p.is_control_flow_dead = old;
        } else {
            data.yes = p.visit_single_stmt(data.yes, StmtsKind::None);
        }

        // The "else" clause is optional
        if let Some(no) = data.no {
            if effects.ok && effects.value {
                let old = p.is_control_flow_dead;
                p.is_control_flow_dead = true;
                data.no = Some(p.visit_single_stmt(no, StmtsKind::None));
                p.is_control_flow_dead = old;
            } else {
                data.no = Some(p.visit_single_stmt(no, StmtsKind::None));
            }

            // Trim unnecessary "else" clauses
            if p.options.features.minify_syntax {
                if let Some(no2) = &data.no {
                    if matches!(no2.data, Stmt::Data::SEmpty(_)) {
                        data.no = None;
                    }
                }
            }
        }

        if p.options.features.minify_syntax {
            if effects.ok {
                if effects.value {
                    if data.no.is_none()
                        || !SideEffects::should_keep_stmt_in_dead_control_flow(data.no.unwrap(), p.allocator)
                    {
                        if effects.side_effects == SideEffects::CouldHaveSideEffects {
                            // Keep the condition if it could have side effects (but is still known to be truthy)
                            if let Some(test_) = SideEffects::simplify_unused_expr(p, data.test_) {
                                stmts.push(p.s(S::SExpr { value: test_, ..Default::default() }, test_.loc));
                            }
                        }

                        return p.append_if_body_preserving_scope(stmts, data.yes);
                    } else {
                        // We have to keep the "no" branch
                    }
                } else {
                    // The test is falsy
                    if !SideEffects::should_keep_stmt_in_dead_control_flow(data.yes, p.allocator) {
                        if effects.side_effects == SideEffects::CouldHaveSideEffects {
                            // Keep the condition if it could have side effects (but is still known to be truthy)
                            if let Some(test_) = SideEffects::simplify_unused_expr(p, data.test_) {
                                stmts.push(p.s(S::SExpr { value: test_, ..Default::default() }, test_.loc));
                            }
                        }

                        if data.no.is_none() {
                            return Ok(());
                        }

                        return p.append_if_body_preserving_scope(stmts, data.no.unwrap());
                    }
                }
            }

            // TODO: more if statement syntax minification
            let can_remove_test = p.expr_can_be_removed_if_unused(&data.test_);
            match &data.yes.data {
                Stmt::Data::SExpr(yes_expr) => {
                    if yes_expr.value.is_missing() {
                        if data.no.is_none() {
                            if can_remove_test {
                                return Ok(());
                            }
                        } else if data.no.unwrap().is_missing_expr() && can_remove_test {
                            return Ok(());
                        }
                    }
                }
                Stmt::Data::SEmpty(_) => {
                    if data.no.is_none() {
                        if can_remove_test {
                            return Ok(());
                        }
                    } else if data.no.unwrap().is_missing_expr() && can_remove_test {
                        return Ok(());
                    }
                }
                _ => {}
            }
        }

        stmts.push(*stmt);
        Ok(())
    }

    fn s_for(
        p: &mut P<PARSER_FEATURE_TYPESCRIPT, PARSER_FEATURE_JSX, PARSER_FEATURE_SCAN_ONLY>,
        stmts: &mut StmtList,
        stmt: &mut Stmt,
        data: &mut S::For,
    ) -> Result<(), Error> {
        p.push_scope_for_visit_pass(js_ast::Scope::Kind::Block, stmt.loc).expect("unreachable");

        if let Some(initst) = data.init {
            data.init = Some(p.visit_for_loop_init(initst, false));
        }

        if let Some(test_) = data.test_ {
            data.test_ = Some(SideEffects::simplify_boolean(p, p.visit_expr(test_)));

            let result = SideEffects::to_boolean(p, &data.test_.unwrap().data);
            if result.ok && result.value && result.side_effects == SideEffects::NoSideEffects {
                data.test_ = None;
            }
        }

        if let Some(update) = data.update {
            data.update = Some(p.visit_expr(update));
        }

        data.body = p.visit_loop_body(data.body);

        if let Some(for_init) = &data.init {
            if let Stmt::Data::SLocal(local) = &for_init.data {
                // Potentially relocate "var" declarations to the top level. Note that this
                // must be done inside the scope of the for loop or they won't be relocated.
                if local.kind == S::Local::Kind::KVar {
                    let relocate =
                        p.maybe_relocate_vars_to_top_level(local.decls.slice(), RelocateVars::Mode::Normal);
                    if let Some(relocated) = relocate.stmt {
                        data.init = Some(relocated);
                    }
                }
            }
        }

        p.pop_scope();

        stmts.push(*stmt);
        Ok(())
    }

    fn s_for_in(
        p: &mut P<PARSER_FEATURE_TYPESCRIPT, PARSER_FEATURE_JSX, PARSER_FEATURE_SCAN_ONLY>,
        stmts: &mut StmtList,
        stmt: &mut Stmt,
        data: &mut S::ForIn,
    ) -> Result<(), Error> {
        {
            p.push_scope_for_visit_pass(js_ast::Scope::Kind::Block, stmt.loc).expect("unreachable");
            // Zig: defer p.popScope(); — restructured: pop at end of block
            let _ = p.visit_for_loop_init(data.init, true);
            data.value = p.visit_expr(data.value);
            data.body = p.visit_loop_body(data.body);

            // Check for a variable initializer
            if let Stmt::Data::SLocal(local) = &mut data.init.data {
                if local.kind == S::Local::Kind::KVar {
                    // Lower for-in variable initializers in case the output is used in strict mode
                    if local.decls.len() == 1 {
                        let decl: &mut G::Decl = &mut local.decls.as_mut_slice()[0];
                        if let Binding::Data::BIdentifier(b_id) = &decl.binding.data {
                            if let Some(val) = decl.value {
                                stmts.push(Stmt::assign(
                                    Expr::init_identifier(b_id.ref_, decl.binding.loc),
                                    val,
                                ));
                                decl.value = None;
                            }
                        }
                    }

                    let relocate = p.maybe_relocate_vars_to_top_level(
                        local.decls.slice(),
                        RelocateVars::Mode::ForInOrForOf,
                    );
                    if let Some(relocated_stmt) = relocate.stmt {
                        data.init = relocated_stmt;
                    }
                }
            }
            p.pop_scope();
        }

        stmts.push(*stmt);
        Ok(())
    }

    fn s_for_of(
        p: &mut P<PARSER_FEATURE_TYPESCRIPT, PARSER_FEATURE_JSX, PARSER_FEATURE_SCAN_ONLY>,
        stmts: &mut StmtList,
        stmt: &mut Stmt,
        data: &mut S::ForOf,
    ) -> Result<(), Error> {
        p.push_scope_for_visit_pass(js_ast::Scope::Kind::Block, stmt.loc).expect("unreachable");
        // Zig: defer p.popScope();
        // TODO(port): defer side-effect — restructured to explicit pop before each return
        let _ = p.visit_for_loop_init(data.init, true);
        data.value = p.visit_expr(data.value);
        data.body = p.visit_loop_body(data.body);

        if let Stmt::Data::SLocal(_) = &data.init.data {
            if let Stmt::Data::SLocal(local) = &data.init.data {
                if local.kind == S::Local::Kind::KVar {
                    let relocate = p.maybe_relocate_vars_to_top_level(
                        local.decls.slice(),
                        RelocateVars::Mode::ForInOrForOf,
                    );
                    if let Some(relocated_stmt) = relocate.stmt {
                        data.init = relocated_stmt;
                    }
                }
            }

            // Handle "for (using x of y)" and "for (await using x of y)"
            if let Stmt::Data::SLocal(init2) = &mut data.init.data {
                if init2.kind.is_using() && p.options.features.lower_using {
                    // fn lowerUsingDeclarationInForOf()
                    let loc = data.init.loc;
                    let binding = init2.decls.at(0).binding;
                    let id = binding.data.b_identifier_mut();
                    let temp_ref =
                        p.generate_temp_ref(p.symbols[id.ref_.inner_index].original_name);

                    let first = p.s(
                        S::Local {
                            kind: init2.kind,
                            decls: {
                                let mut decls = BumpVec::with_capacity_in(1, p.allocator);
                                decls.push(G::Decl {
                                    binding: p.b(B::Identifier { ref_: id.ref_ }, loc),
                                    value: Some(p.new_expr(E::Identifier { ref_: temp_ref }, loc)),
                                });
                                G::Decl::List::from_owned_slice(decls)
                            },
                            ..Default::default()
                        },
                        loc,
                    );

                    let length = if let Stmt::Data::SBlock(b) = &data.body.data {
                        b.stmts.len()
                    } else {
                        1
                    };
                    let mut statements: BumpVec<'_, Stmt> = BumpVec::with_capacity_in(1 + length, p.allocator);
                    statements.push(first);
                    if let Stmt::Data::SBlock(b) = &data.body.data {
                        statements.extend_from_slice(&b.stmts);
                    } else {
                        statements.push(data.body);
                    }

                    let mut ctx =
                        P::<PARSER_FEATURE_TYPESCRIPT, PARSER_FEATURE_JSX, PARSER_FEATURE_SCAN_ONLY>::LowerUsingDeclarationsContext::init(p)?;
                    ctx.scan_stmts(p, &statements);
                    let visited_stmts = ctx.finalize(
                        p,
                        statements,
                        p.will_wrap_module_in_try_catch_for_using && p.current_scope.parent.is_none(),
                    );
                    if let Stmt::Data::SBlock(b) = &mut data.body.data {
                        b.stmts = visited_stmts.into();
                    } else {
                        data.body = p.s(S::Block { stmts: visited_stmts.into(), ..Default::default() }, loc);
                    }
                    id.ref_ = temp_ref;
                    init2.kind = S::Local::Kind::KConst;
                }
            }
        }

        p.pop_scope();
        stmts.push(*stmt);
        Ok(())
    }

    fn s_try(
        p: &mut P<PARSER_FEATURE_TYPESCRIPT, PARSER_FEATURE_JSX, PARSER_FEATURE_SCAN_ONLY>,
        stmts: &mut StmtList,
        stmt: &mut Stmt,
        data: &mut S::Try,
    ) -> Result<(), Error> {
        p.push_scope_for_visit_pass(js_ast::Scope::Kind::Block, stmt.loc).expect("unreachable");
        {
            // TODO(port): arena-backed list
            let mut _stmts: StmtList = core::mem::take(&mut data.body).into();
            p.fn_or_arrow_data_visit.try_body_count += 1;
            p.visit_stmts(&mut _stmts, StmtsKind::None).expect("unreachable");
            p.fn_or_arrow_data_visit.try_body_count -= 1;
            data.body = _stmts.into();
        }
        p.pop_scope();

        if let Some(catch_) = &mut data.catch_ {
            p.push_scope_for_visit_pass(js_ast::Scope::Kind::CatchBinding, catch_.loc)
                .expect("unreachable");
            {
                if let Some(catch_binding) = catch_.binding {
                    p.visit_binding(catch_binding, None);
                }
                let mut _stmts: StmtList = core::mem::take(&mut catch_.body).into();
                p.push_scope_for_visit_pass(js_ast::Scope::Kind::Block, catch_.body_loc)
                    .expect("unreachable");
                p.visit_stmts(&mut _stmts, StmtsKind::None).expect("unreachable");
                p.pop_scope();
                catch_.body = _stmts.into();
            }
            p.pop_scope();
        }

        if let Some(finally) = &mut data.finally {
            p.push_scope_for_visit_pass(js_ast::Scope::Kind::Block, finally.loc).expect("unreachable");
            {
                let mut _stmts: StmtList = core::mem::take(&mut finally.stmts).into();
                p.visit_stmts(&mut _stmts, StmtsKind::None).expect("unreachable");
                finally.stmts = _stmts.into();
            }
            p.pop_scope();
        }

        stmts.push(*stmt);
        Ok(())
    }

    fn s_switch(
        p: &mut P<PARSER_FEATURE_TYPESCRIPT, PARSER_FEATURE_JSX, PARSER_FEATURE_SCAN_ONLY>,
        stmts: &mut StmtList,
        stmt: &mut Stmt,
        data: &mut S::Switch,
    ) -> Result<(), Error> {
        data.test_ = p.visit_expr(data.test_);
        {
            p.push_scope_for_visit_pass(js_ast::Scope::Kind::Block, data.body_loc).expect("unreachable");
            let old_is_inside_switch = p.fn_or_arrow_data_visit.is_inside_switch;
            p.fn_or_arrow_data_visit.is_inside_switch = true;
            for i in 0..data.cases.len() {
                if let Some(val) = data.cases[i].value {
                    data.cases[i].value = Some(p.visit_expr(val));
                    // TODO: error messages
                    // Check("case", *c.Value, c.Value.Loc)
                    //                 p.warnAboutTypeofAndString(s.Test, *c.Value)
                }
                let mut _stmts: StmtList = core::mem::take(&mut data.cases[i].body).into();
                p.visit_stmts(&mut _stmts, StmtsKind::None).expect("unreachable");
                data.cases[i].body = _stmts.into();
            }
            p.fn_or_arrow_data_visit.is_inside_switch = old_is_inside_switch;
            p.pop_scope();
        }
        // TODO: duplicate case checker

        stmts.push(*stmt);
        Ok(())
    }

    fn s_enum(
        p: &mut P<PARSER_FEATURE_TYPESCRIPT, PARSER_FEATURE_JSX, PARSER_FEATURE_SCAN_ONLY>,
        stmts: &mut StmtList,
        stmt: &mut Stmt,
        data: &mut S::Enum,
        was_after_after_const_local_prefix: bool,
    ) -> Result<(), Error> {
        // Do not end the const local prefix after TypeScript enums. We process
        // them first within their scope so that they are inlined into all code in
        // that scope. We don't want that to cause the const local prefix to end.
        p.current_scope.is_after_const_local_prefix = was_after_after_const_local_prefix;

        // Track cross-module enum constants during bundling. This
        // part of the code is different from esbuilt in that we are
        // only storing a list of enum indexes. At the time of
        // referencing, `esbuild` builds a separate hash map of hash
        // maps. We are avoiding that to reduce memory usage, since
        // enum inlining already uses alot of hash maps.
        if core::ptr::eq(p.current_scope, p.module_scope) && p.options.bundle {
            p.top_level_enums.push(data.name.ref_.unwrap());
        }

        p.record_declared_symbol(data.name.ref_.unwrap())?;
        p.push_scope_for_visit_pass(js_ast::Scope::Kind::Entry, stmt.loc)?;
        // Zig: defer p.popScope();
        // TODO(port): defer side-effect — scopeguard borrows `p` exclusively; Phase B
        // must reshape (e.g. guard a `*mut P` or split borrow) so the body can use `p`.
        let _pop_scope = scopeguard::guard((), |_| p.pop_scope());
        p.record_declared_symbol(data.arg)?;

        // Scan ahead for any variables inside this namespace. This must be done
        // ahead of time before visiting any statements inside the namespace
        // because we may end up visiting the uses before the declarations.
        // We need to convert the uses into property accesses on the namespace.
        for value in data.values.iter() {
            if value.ref_.is_valid() {
                p.is_exported_inside_namespace.insert(value.ref_, data.arg);
            }
        }

        // Values without initializers are initialized to one more than the
        // previous value if the previous value is numeric. Otherwise values
        // without initializers are initialized to undefined.
        let mut next_numeric_value: Option<f64> = Some(0.0);

        let mut value_exprs: BumpVec<'_, Expr> = BumpVec::with_capacity_in(data.values.len(), p.allocator);

        let mut all_values_are_pure = true;

        let exported_members = p.current_scope.ts_namespace.unwrap().exported_members;

        // We normally don't fold numeric constants because they might increase code
        // size, but it's important to fold numeric constants inside enums since
        // that's what the TypeScript compiler does.
        let old_should_fold_typescript_constant_expressions =
            p.should_fold_typescript_constant_expressions;
        p.should_fold_typescript_constant_expressions = true;

        // Create an assignment for each enum value
        for value in data.values.iter_mut() {
            let name = value.name;

            let mut has_string_value = false;
            if let Some(enum_value) = value.value {
                next_numeric_value = None;

                let visited = p.visit_expr(enum_value);

                // "See through" any wrapped comments
                let underlying_value = if let Expr::Data::EInlinedEnum(ie) = &visited.data {
                    ie.value
                } else {
                    visited
                };
                value.value = Some(underlying_value);

                match &underlying_value.data {
                    Expr::Data::ENumber(num) => {
                        exported_members.get_mut(name).unwrap().data =
                            js_ast::TSNamespaceMemberData::EnumNumber(num.value);

                        p.ref_to_ts_namespace_member
                            .insert(value.ref_, js_ast::TSNamespaceMemberData::EnumNumber(num.value));

                        next_numeric_value = Some(num.value + 1.0);
                    }
                    Expr::Data::EString(str_) => {
                        has_string_value = true;

                        exported_members.get_mut(name).unwrap().data =
                            js_ast::TSNamespaceMemberData::EnumString(*str_);

                        p.ref_to_ts_namespace_member
                            .insert(value.ref_, js_ast::TSNamespaceMemberData::EnumString(*str_));
                    }
                    _ => {
                        if visited.known_primitive() == js_ast::PrimitiveType::String {
                            has_string_value = true;
                        }

                        if !p.expr_can_be_removed_if_unused(&visited) {
                            all_values_are_pure = false;
                        }
                    }
                }
            } else if let Some(num) = next_numeric_value {
                value.value = Some(p.new_expr(E::Number { value: num }, value.loc));

                next_numeric_value = Some(num + 1.0);

                exported_members.get_mut(name).unwrap().data =
                    js_ast::TSNamespaceMemberData::EnumNumber(num);

                p.ref_to_ts_namespace_member
                    .insert(value.ref_, js_ast::TSNamespaceMemberData::EnumNumber(num));
            } else {
                value.value = Some(p.new_expr(E::Undefined {}, value.loc));
            }

            let is_assign_target =
                p.options.features.minify_syntax && js_lexer::is_identifier(value.name);

            let name_as_e_string = if !is_assign_target || !has_string_value {
                Some(p.new_expr(value.name_as_e_string(p.allocator), value.loc))
            } else {
                None
            };

            let assign_target = if is_assign_target {
                // "Enum.Name = value"
                Expr::assign(
                    p.new_expr(
                        E::Dot {
                            target: p.new_expr(E::Identifier { ref_: data.arg }, value.loc),
                            name: value.name,
                            name_loc: value.loc,
                        },
                        value.loc,
                    ),
                    value.value.unwrap(),
                )
            } else {
                // "Enum['Name'] = value"
                Expr::assign(
                    p.new_expr(
                        E::Index {
                            target: p.new_expr(E::Identifier { ref_: data.arg }, value.loc),
                            index: name_as_e_string.unwrap(),
                            ..Default::default()
                        },
                        value.loc,
                    ),
                    value.value.unwrap(),
                )
            };

            p.record_usage(data.arg);

            // String-valued enums do not form a two-way map
            if has_string_value {
                value_exprs.push(assign_target);
            } else {
                // "Enum[assignTarget] = 'Name'"
                value_exprs.push(Expr::assign(
                    p.new_expr(
                        E::Index {
                            target: p.new_expr(E::Identifier { ref_: data.arg }, value.loc),
                            index: assign_target,
                            ..Default::default()
                        },
                        value.loc,
                    ),
                    name_as_e_string.unwrap(),
                ));
                p.record_usage(data.arg);
            }
        }

        p.should_fold_typescript_constant_expressions = old_should_fold_typescript_constant_expressions;

        let mut value_stmts: StmtList = BumpVec::with_capacity_in(value_exprs.len(), p.allocator);
        // Generate statements from expressions
        for expr in value_exprs.iter() {
            // PERF(port): was assume_capacity
            value_stmts.push(p.s(S::SExpr { value: *expr, ..Default::default() }, expr.loc));
        }
        drop(value_exprs);
        p.generate_closure_for_type_script_namespace_or_enum(
            stmts,
            stmt.loc,
            data.is_export,
            data.name.loc,
            data.name.ref_.unwrap(),
            data.arg,
            value_stmts.into(),
            all_values_are_pure,
        )?;
        Ok(())
    }

    fn s_namespace(
        p: &mut P<PARSER_FEATURE_TYPESCRIPT, PARSER_FEATURE_JSX, PARSER_FEATURE_SCAN_ONLY>,
        stmts: &mut StmtList,
        stmt: &mut Stmt,
        data: &mut S::Namespace,
    ) -> Result<(), Error> {
        p.record_declared_symbol(data.name.ref_.unwrap()).expect("unreachable");

        // Scan ahead for any variables inside this namespace. This must be done
        // ahead of time before visiting any statements inside the namespace
        // because we may end up visiting the uses before the declarations.
        // We need to convert the uses into property accesses on the namespace.
        for child_stmt in data.stmts.iter() {
            if let Stmt::Data::SLocal(local) = &child_stmt.data {
                if local.is_export {
                    p.mark_exported_decls_inside_namespace(data.arg, local.decls.slice());
                }
            }
        }

        let mut prepend_temp_refs = PrependTempRefsOpts { kind: StmtsKind::FnBody, ..Default::default() };
        // TODO(port): arena-backed list
        let mut prepend_list: StmtList = core::mem::take(&mut data.stmts).into();

        let old_enclosing_namespace_arg_ref = p.enclosing_namespace_arg_ref;
        p.enclosing_namespace_arg_ref = Some(data.arg);
        p.push_scope_for_visit_pass(js_ast::Scope::Kind::Entry, stmt.loc).expect("unreachable");
        p.record_declared_symbol(data.arg).expect("unreachable");
        p.visit_stmts_and_prepend_temp_refs(&mut prepend_list, &mut prepend_temp_refs)?;
        p.pop_scope();
        p.enclosing_namespace_arg_ref = old_enclosing_namespace_arg_ref;

        p.generate_closure_for_type_script_namespace_or_enum(
            stmts,
            stmt.loc,
            data.is_export,
            data.name.loc,
            data.name.ref_.unwrap(),
            data.arg,
            prepend_list.into(),
            false,
        )?;
        Ok(())
    }
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/js_parser/ast/visitStmt.zig (1590 lines)
//   confidence: medium
//   todos:      19
//   notes:      `defer`/scopeguard sites need borrowck reshaping; `inline else` dispatch expanded by hand; StmtList<'bump> = bumpalo Vec — thread `'bump` through signatures in Phase B; `s_export_from` mirrors Zig's dead `j == 0 && items.len > 0` branch bug-for-bug
// ──────────────────────────────────────────────────────────────────────────
