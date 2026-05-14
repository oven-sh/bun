#![allow(
    unused_imports,
    unused_variables,
    dead_code,
    unused_mut,
    unreachable_code,
    unused_unsafe
)]
#![warn(unused_must_use)]
use crate::lexer as js_lexer;
use crate::p::{P, ReactRefreshExportKind, null_expr_data};
use crate::parser::{
    PrependTempRefsOpts, ReactRefresh, Ref, RelocateVars, RelocateVarsMode, SideEffects,
    StmtsKind, statement_cares_about_scope,
};
use bun_alloc::{ArenaVec as BumpVec, ArenaVecExt as _};
use bun_ast::G::Decl;
use bun_ast::expr::Data as ExprData;
use bun_ast::expr::PrimitiveType;
use bun_ast::flags;
use bun_ast::scope::Kind as ScopeKind;
use bun_ast::stmt::Data as StmtData;
use bun_ast::ts;
use bun_ast::{self as js_ast, B, Binding, E, Expr, G, S, Stmt};
use bun_collections::VecExt;
use bun_core::Error;
use bun_core::strings;

// `ListManaged(Stmt)` in the parser is arena-backed (`p.arena`).
type StmtList<'bump> = BumpVec<'bump, Stmt>;

use bun_ast::StmtNodeList;

// ─── file-local arena helpers ────────────────────────────────────────────────
// Slice fields are `StoreStr` / `StoreSlice<T>` (see ast/mod.rs). All slices
// are arena-owned and outlive the visit pass.

// Helper: visit a `StmtNodeList` arena slice in-place. Mirrors the
// `ListManaged.fromOwnedSlice` → `visitStmts` → `.items` pattern from Zig: copy the
// slice into a fresh arena-backed Vec, visit (which may grow/shrink it), then
// leak the result back into the bump arena and return the new view.
#[inline]
fn visit_stmt_slice<'a, const TS: bool, const SO: bool>(
    p: &mut P<'a, TS, SO>,
    slice: StmtNodeList,
    kind: StmtsKind,
) -> StmtNodeList {
    let src: &[Stmt] = slice.slice();
    let mut list: StmtList<'a> = BumpVec::with_capacity_in(src.len(), p.arena);
    list.extend_from_slice(src);
    p.visit_stmts(&mut list, kind).expect("unreachable");
    StmtNodeList::from_bump(list)
}

// ─── arena slice ↔ BumpVec helpers ──────────────────────────────────────────
// `StmtNodeList = StoreSlice<Stmt>` (arena-owned). Zig's `ListManaged.fromOwnedSlice`
// adopts the existing backing storage; bumpalo Vec cannot, so we copy. The arena
// reclaims both at end-of-parse.
// PERF(port): was fromOwnedSlice (no copy) — profile in Phase B.
#[inline]
fn stmts_to_list<'a>(arena: &'a bun_alloc::Arena, ptr: StmtNodeList) -> StmtList<'a> {
    bun_alloc::vec_from_iter_in(ptr.iter().copied(), arena)
}
#[inline]
fn list_to_stmts<'a>(list: StmtList<'a>) -> StmtNodeList {
    StmtNodeList::from_bump(list)
}

// Zig: `pub fn VisitStmt(comptime ts, comptime jsx, comptime scan_only) type { return struct { ... } }`
// — file-split mixin pattern. Round-C lowered `const JSX: JSXTransformType` → `J: JsxT`, so this is
// a direct `impl P` block. The 30+ per-variant `s_*` helpers are private; only
// `visit_and_append_stmt` is surfaced. Full draft body preserved under  mod _draft below.

impl<'a, const TYPESCRIPT: bool, const SCAN_ONLY: bool> P<'a, TYPESCRIPT, SCAN_ONLY> {
    // Thin alias of `current_scope_mut()` kept for local readability.
    #[inline(always)]
    fn cur_scope(&mut self) -> &mut js_ast::Scope {
        self.current_scope_mut()
    }

    pub fn visit_and_append_stmt(
        &mut self,
        stmts: &mut StmtList<'a>,
        stmt: &mut Stmt,
    ) -> Result<(), Error> {
        let p = self;
        // By default any statement ends the const local prefix
        let was_after_after_const_local_prefix = p.cur_scope().is_after_const_local_prefix;
        p.cur_scope().is_after_const_local_prefix = true;

        // Zig: `switch (@as(Stmt.Tag, stmt.data))` with `inline else` reflection over @tagName.
        // PORT NOTE: reshaped for borrowck — `Stmt::Data` is `Copy` (`StoreRef<T>` is a thin
        // `NonNull`); take a copy of the enum so the StoreRef payload can be DerefMut'd
        // without aliasing the `&mut Stmt` we also pass through. The deref'd `&mut S::*`
        // points into the arena, not into `*stmt`.
        let data_copy = stmt.data;
        match data_copy {
            StmtData::SDirective(_) | StmtData::SComment(_) | StmtData::SEmpty(_) => {
                p.cur_scope().is_after_const_local_prefix = was_after_after_const_local_prefix;
                stmts.push(*stmt);
                Ok(())
            }
            StmtData::STypeScript(_) => {
                p.cur_scope().is_after_const_local_prefix = was_after_after_const_local_prefix;
                Ok(())
            }
            StmtData::SDebugger(_) => {
                p.cur_scope().is_after_const_local_prefix = was_after_after_const_local_prefix;
                if p.define.drop_debugger {
                    return Ok(());
                }
                stmts.push(*stmt);
                Ok(())
            }

            // Zig: `inline .s_enum, .s_local => |tag| return @field(visitors, @tagName(tag))(p, stmts, stmt, @field(stmt.data, @tagName(tag)), was_after_after_const_local_prefix)`
            StmtData::SEnum(mut sr) => {
                Self::s_enum(p, stmts, stmt, &mut *sr, was_after_after_const_local_prefix)
            }
            StmtData::SLocal(mut sr) => {
                Self::s_local(p, stmts, stmt, &mut *sr, was_after_after_const_local_prefix)
            }

            // Zig: `inline else => |tag| return @field(visitors, @tagName(tag))(p, stmts, stmt, @field(stmt.data, @tagName(tag)))`
            StmtData::SImport(mut sr) => Self::s_import(p, stmts, stmt, &mut *sr),
            StmtData::SExportClause(mut sr) => Self::s_export_clause(p, stmts, stmt, &mut *sr),
            StmtData::SExportFrom(mut sr) => Self::s_export_from(p, stmts, stmt, &mut *sr),
            StmtData::SExportStar(mut sr) => Self::s_export_star(p, stmts, stmt, &mut *sr),
            StmtData::SExportDefault(mut sr) => Self::s_export_default(p, stmts, stmt, &mut *sr),
            StmtData::SFunction(mut sr) => Self::s_function(p, stmts, stmt, &mut *sr),
            StmtData::SClass(mut sr) => Self::s_class(p, stmts, stmt, &mut *sr),
            StmtData::SExportEquals(mut sr) => Self::s_export_equals(p, stmts, stmt, &mut *sr),
            StmtData::SBreak(mut sr) => Self::s_break(p, stmts, stmt, &mut *sr),
            StmtData::SContinue(mut sr) => Self::s_continue(p, stmts, stmt, &mut *sr),
            StmtData::SLabel(mut sr) => Self::s_label(p, stmts, stmt, &mut *sr),
            StmtData::SExpr(mut sr) => Self::s_expr(p, stmts, stmt, &mut *sr),
            StmtData::SThrow(mut sr) => Self::s_throw(p, stmts, stmt, &mut *sr),
            StmtData::SReturn(mut sr) => Self::s_return(p, stmts, stmt, &mut *sr),
            StmtData::SBlock(mut sr) => Self::s_block(p, stmts, stmt, &mut *sr),
            StmtData::SWith(mut sr) => Self::s_with(p, stmts, stmt, &mut *sr),
            StmtData::SWhile(mut sr) => Self::s_while(p, stmts, stmt, &mut *sr),
            StmtData::SDoWhile(mut sr) => Self::s_do_while(p, stmts, stmt, &mut *sr),
            StmtData::SIf(mut sr) => Self::s_if(p, stmts, stmt, &mut *sr),
            StmtData::SFor(mut sr) => Self::s_for(p, stmts, stmt, &mut *sr),
            StmtData::SForIn(mut sr) => Self::s_for_in(p, stmts, stmt, &mut *sr),
            StmtData::SForOf(mut sr) => Self::s_for_of(p, stmts, stmt, &mut *sr),
            StmtData::STry(mut sr) => Self::s_try(p, stmts, stmt, &mut *sr),
            StmtData::SSwitch(mut sr) => Self::s_switch(p, stmts, stmt, &mut *sr),
            StmtData::SNamespace(mut sr) => Self::s_namespace(p, stmts, stmt, &mut *sr),

            // Only used by the bundler for lazy export ASTs.
            StmtData::SLazyExport(_) => unreachable!(),
        }
    }

    // ─── visitors ───────────────────────────────────────────────────────────
    // In Zig these live on a nested `const visitors = struct { ... }`; in Rust they are private
    // associated fns on this impl so they can see the const-generic feature params.

    fn s_import(
        p: &mut Self,
        stmts: &mut StmtList<'a>,
        stmt: &mut Stmt,
        data: &mut S::Import,
    ) -> Result<(), Error> {
        p.record_declared_symbol(data.namespace_ref);

        if let Some(default_name) = data.default_name {
            p.record_declared_symbol(default_name.ref_.expect("infallible: ref bound"));
        }

        let items = data.items.slice();
        if !items.is_empty() {
            for item in items.iter() {
                p.record_declared_symbol(item.name.ref_.expect("infallible: ref bound"));
            }
        }

        stmts.push(*stmt);
        Ok(())
    }

    fn s_export_equals(
        p: &mut Self,
        stmts: &mut StmtList<'a>,
        stmt: &mut Stmt,
        data: &mut S::ExportEquals,
    ) -> Result<(), Error> {
        // "module.exports = value"
        // Zig: p.@"module.exports"(stmt.loc) — mapped to `module_exports`
        // PORT NOTE: Zig evaluates lhs before rhs at the call site; preserve that order
        // (`module_exports` builds via `new_expr`, `visit_expr` mutates parser state).
        let lhs = p.module_exports(stmt.loc);
        p.visit_expr(&mut data.value);
        stmts.push(Stmt::assign(lhs, data.value));
        p.record_usage(p.module_ref);
        Ok(())
    }

    fn s_export_clause(
        p: &mut Self,
        stmts: &mut StmtList<'a>,
        stmt: &mut Stmt,
        data: &mut S::ExportClause,
    ) -> Result<(), Error> {
        // "export {foo}"
        let items = data.items.slice_mut();
        let items_len = items.len();
        let mut end: usize = 0;
        let mut any_replaced = false;
        if p.options.features.replace_exports.count() > 0 {
            for i in 0..items_len {
                let name = p.load_name_from_ref(items[i].name.ref_.expect("infallible: ref bound"));
                let symbol = p.find_symbol(items[i].alias_loc, name)?;
                let ref_ = symbol.r#ref;

                // PORT NOTE: reshaped for borrowck — get_ptr borrows options; clone the
                // small enum payload so `inject_replacement_export(&mut self, ...)` can run.
                if let Some(entry) = p.options.features.replace_exports.get_ptr(name).cloned() {
                    if !entry.is_replace() {
                        p.ignore_usage(symbol.r#ref);
                    }
                    let _ = p.inject_replacement_export(stmts, symbol.r#ref, stmt.loc, &entry);
                    any_replaced = true;
                    continue;
                }

                if p.symbols[ref_.inner_index() as usize].kind == js_ast::symbol::Kind::Unbound {
                    // Silently strip exports of non-local symbols in TypeScript, since
                    // those likely correspond to type-only exports. But report exports of
                    // non-local symbols as errors in JavaScript.
                    if !TYPESCRIPT {
                        let r = js_lexer::range_of_identifier(p.source, items[i].name.loc);
                        p.log().add_range_error_fmt(
                            Some(p.source),
                            r,
                            format_args!(
                                "\"{}\" is not declared in this file",
                                bstr::BStr::new(name)
                            ),
                        );
                    }
                    continue;
                }

                items[i].name.ref_ = Some(ref_);
                // Compaction: items[..end] is the kept prefix; items[i] is dead
                // after this iteration and the slice is truncated to `end` below.
                items.swap(end, i);
                end += 1;
            }
        } else {
            for i in 0..items_len {
                let name = p.load_name_from_ref(items[i].name.ref_.expect("infallible: ref bound"));
                let symbol = p.find_symbol(items[i].alias_loc, name)?;
                let ref_ = symbol.r#ref;

                if p.symbols[ref_.inner_index() as usize].kind == js_ast::symbol::Kind::Unbound {
                    // Silently strip exports of non-local symbols in TypeScript, since
                    // those likely correspond to type-only exports. But report exports of
                    // non-local symbols as errors in JavaScript.
                    if !TYPESCRIPT {
                        let r = js_lexer::range_of_identifier(p.source, items[i].name.loc);
                        p.log().add_range_error_fmt(
                            Some(p.source),
                            r,
                            format_args!(
                                "\"{}\" is not declared in this file",
                                bstr::BStr::new(name)
                            ),
                        );
                        continue;
                    }
                    continue;
                }

                items[i].name.ref_ = Some(ref_);
                // Compaction: items[..end] is the kept prefix; items[i] is dead
                // after this iteration and the slice is truncated to `end` below.
                items.swap(end, i);
                end += 1;
            }
        }

        let remove_for_tree_shaking =
            any_replaced && end == 0 && items_len > 0 && p.options.tree_shaking;
        // Truncate `data.items` to `end` by reslicing the arena view.
        data.items.truncate(end);

        if remove_for_tree_shaking {
            return Ok(());
        }

        stmts.push(*stmt);
        Ok(())
    }

    fn s_export_from(
        p: &mut Self,
        stmts: &mut StmtList<'a>,
        stmt: &mut Stmt,
        data: &mut S::ExportFrom,
    ) -> Result<(), Error> {
        // "export {foo} from 'path'"
        let name = p.load_name_from_ref(data.namespace_ref);

        data.namespace_ref = p.new_symbol(js_ast::symbol::Kind::Other, name)?;
        VecExt::append(&mut p.cur_scope().generated, data.namespace_ref);
        p.record_declared_symbol(data.namespace_ref);

        let items = data.items.slice_mut();

        if p.options.features.replace_exports.count() > 0 {
            let mut j: usize = 0;
            // This is a re-export and the symbols created here are used to reference
            for i in 0..items.len() {
                let old_ref = items[i].name.ref_.expect("infallible: ref bound");

                // alias is arena-owned (`ArenaStr`), valid for 'a.
                let alias = items[i].alias.slice();
                if let Some(entry) = p.options.features.replace_exports.get_ptr(alias).cloned() {
                    let _ =
                        p.inject_replacement_export(stmts, old_ref, bun_ast::Loc::EMPTY, &entry);
                    continue;
                }

                let _name = p.load_name_from_ref(old_ref);
                let ref_ = p.new_symbol(js_ast::symbol::Kind::Import, _name)?;
                VecExt::append(&mut p.cur_scope().generated, ref_);
                p.record_declared_symbol(ref_);
                // Compaction: items[..j] is the kept prefix; items[i] is dead
                // after this iteration and the slice is truncated to `j` below.
                items.swap(j, i);
                items[j].name.ref_ = Some(ref_);
                j += 1;
            }

            // Truncate `data.items` to `j` by reslicing the arena view.
            data.items.truncate(j);

            // TODO(port): dead branch in Zig — `data.items.len = j;` runs first, so
            // `j == 0 and data.items.len > 0` is always false. Mirrored bug-for-bug.
            #[allow(unreachable_code)]
            if j == 0 && data.items.len() > 0 {
                return Ok(());
            }
        } else {
            // This is a re-export and the symbols created here are used to reference
            for item in items.iter_mut() {
                let _name = p.load_name_from_ref(item.name.ref_.expect("infallible: ref bound"));
                let ref_ = p.new_symbol(js_ast::symbol::Kind::Import, _name)?;
                VecExt::append(&mut p.cur_scope().generated, ref_);
                p.record_declared_symbol(ref_);
                item.name.ref_ = Some(ref_);
            }
        }

        stmts.push(*stmt);
        Ok(())
    }

    fn s_export_star(
        p: &mut Self,
        stmts: &mut StmtList<'a>,
        stmt: &mut Stmt,
        data: &mut S::ExportStar,
    ) -> Result<(), Error> {
        // "export * from 'path'"
        let name = p.load_name_from_ref(data.namespace_ref);
        data.namespace_ref = p.new_symbol(js_ast::symbol::Kind::Other, name)?;
        VecExt::append(&mut p.cur_scope().generated, data.namespace_ref);
        p.record_declared_symbol(data.namespace_ref);

        // "export * as ns from 'path'"
        if let Some(alias) = &data.alias {
            if p.options.features.replace_exports.count() > 0 {
                let alias_name = alias.original_name.slice();
                if let Some(entry) = p
                    .options
                    .features
                    .replace_exports
                    .get_ptr(alias_name)
                    .cloned()
                {
                    let declared = p
                        .declare_symbol(
                            js_ast::symbol::Kind::Other,
                            bun_ast::Loc::EMPTY,
                            alias_name,
                        )
                        .expect("unreachable");
                    let _ =
                        p.inject_replacement_export(stmts, declared, bun_ast::Loc::EMPTY, &entry);
                    return Ok(());
                }
            }
        }

        stmts.push(*stmt);
        Ok(())
    }

    fn s_export_default(
        p: &mut Self,
        stmts: &mut StmtList<'a>,
        stmt: &mut Stmt,
        data: &mut S::ExportDefault,
    ) -> Result<(), Error> {
        // Zig: defer { if (data.default_name.ref) |ref| p.recordDeclaredSymbol(ref) catch unreachable; }
        // PORT NOTE: scopeguard can't borrow `p` across the body; restructured to a tail
        // closure invoked at every return site below.
        macro_rules! record_on_exit {
            () => {
                if let Some(ref_) = data.default_name.ref_ {
                    p.record_declared_symbol(ref_);
                }
            };
        }

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
        macro_rules! restore_dead {
            () => {
                p.is_control_flow_dead = orig_dead;
            };
        }

        match &mut data.value {
            js_ast::StmtOrExpr::Expr(expr) => {
                let was_anonymous_named_expr = expr.is_anonymous_named();
                // Propagate `"default"` as the class name for anonymous decorated
                // class expressions so standard-decorator lowering sees it.
                let prev_decorator_class_name = p.decorator_class_name;
                if was_anonymous_named_expr
                    && matches!(expr.data, js_ast::ExprData::EClass(_))
                    && expr
                        .data
                        .e_class()
                        .expect("infallible: variant checked")
                        .should_lower_standard_decorators
                {
                    p.decorator_class_name = Some(js_ast::ClauseItem::DEFAULT_ALIAS);
                }
                p.visit_expr(expr);
                p.decorator_class_name = prev_decorator_class_name;

                if p.is_control_flow_dead {
                    restore_dead!();
                    record_on_exit!();
                    return Ok(());
                }

                // Optionally preserve the name
                *expr = p.maybe_keep_expr_symbol_name(
                    *expr,
                    js_ast::ClauseItem::DEFAULT_ALIAS,
                    was_anonymous_named_expr,
                );

                // Discard type-only export default statements
                if TYPESCRIPT {
                    if let js_ast::ExprData::EIdentifier(ident) = expr.data {
                        if !ident.ref_.is_source_contents_slice() {
                            let symbol = &p.symbols[ident.ref_.inner_index() as usize];
                            if symbol.kind == js_ast::symbol::Kind::Unbound {
                                let original_name = symbol.original_name.slice();
                                if p.local_type_names.get(original_name).copied() == Some(true) {
                                    // the name points to a type — don't try to declare
                                    // this symbol, drop the statement.
                                    data.default_name.ref_ = None;
                                    restore_dead!();
                                    record_on_exit!();
                                    return Ok(());
                                }
                            }
                        }
                    }
                }

                if data
                    .default_name
                    .ref_
                    .expect("infallible: ref bound")
                    .is_source_contents_slice()
                {
                    data.default_name = p.create_default_name(expr.loc).expect("unreachable");
                }

                let should_emit_temp_var = p.options.features.react_fast_refresh
                    && match expr.data {
                        js_ast::ExprData::EArrow(_) => true,
                        js_ast::ExprData::ECall(call) => match call.target.data {
                            js_ast::ExprData::EIdentifier(id) => {
                                id.ref_ == p.react_refresh.latest_signature_ref
                            }
                            _ => false,
                        },
                        _ => false,
                    };
                if should_emit_temp_var {
                    // declare a temporary ref for this
                    let temp_id = p.generate_temp_ref(Some(b"default_export"));
                    VecExt::append(&mut p.cur_scope().generated, temp_id);

                    let value_expr = *expr;
                    stmts.push(Stmt::alloc(
                        S::Local {
                            kind: S::Kind::KConst,
                            decls: G::DeclList::from_slice(&[G::Decl {
                                binding: Binding::alloc(
                                    p.arena,
                                    B::Identifier { r#ref: temp_id },
                                    stmt.loc,
                                ),
                                value: Some(value_expr),
                            }]),
                            ..Default::default()
                        },
                        stmt.loc,
                    ));

                    *expr = Expr::init_identifier(temp_id, stmt.loc);

                    p.emit_react_refresh_register(
                        stmts,
                        b"default",
                        temp_id,
                        ReactRefreshExportKind::Default,
                    )?;
                }

                if p.options.features.server_components.wraps_exports() {
                    *expr = p.wrap_value_for_server_component_reference(*expr, b"default");
                }

                // If there are lowered "using" declarations, change this into a "var"
                if p.current_scope().parent.is_none() && p.will_wrap_module_in_try_catch_for_using {
                    stmts.reserve(2);

                    let mut decls = G::DeclList::init_capacity(1);
                    VecExt::append(
                        &mut decls,
                        G::Decl {
                            binding: p.b(
                                B::Identifier {
                                    r#ref: data.default_name.ref_.expect("infallible: ref bound"),
                                },
                                data.default_name.loc,
                            ),
                            value: Some(*expr),
                        },
                    );
                    // PERF(port): was assume_capacity
                    stmts.push(p.s(
                        S::Local {
                            decls,
                            ..Default::default()
                        },
                        stmt.loc,
                    ));
                    let items = core::slice::from_mut(p.arena.alloc(js_ast::ClauseItem {
                        alias: js_ast::StoreStr::new(b"default"),
                        alias_loc: data.default_name.loc,
                        name: data.default_name,
                        ..Default::default()
                    }));
                    // PERF(port): was assume_capacity
                    stmts.push(p.s(
                        S::ExportClause {
                            items: bun_ast::StoreSlice::new_mut(items),
                            is_single_line: false,
                        },
                        stmt.loc,
                    ));
                }

                if mark_for_replace {
                    let entry = p
                        .options
                        .features
                        .replace_exports
                        .get_ptr(b"default")
                        .cloned()
                        .unwrap();
                    if let crate::parser::Runtime::ReplaceableExport::Replace(replace_expr) = entry
                    {
                        *expr = replace_expr;
                    } else {
                        let _ = p.inject_replacement_export(
                            stmts,
                            Ref::NONE,
                            bun_ast::Loc::EMPTY,
                            &entry,
                        );
                        restore_dead!();
                        record_on_exit!();
                        return Ok(());
                    }
                }
            }

            js_ast::StmtOrExpr::Stmt(s2) => {
                // PORT NOTE: reshaped for borrowck — `s2` borrows from `data.value`; copy
                // `s2.loc`/`s2.data` (both Copy) so we can mutate `data.value` below.
                let s2_loc = s2.loc;
                let s2_data = s2.data;
                let s2_copy = *s2;
                match s2_data {
                    StmtData::SFunction(mut func_ref) => {
                        let func: &mut S::Function = &mut *func_ref;
                        let name: &'a [u8] = if let Some(func_loc) = func.func.name {
                            p.load_name_from_ref(func_loc.ref_.expect("infallible: ref bound"))
                        } else {
                            func.func.name = Some(data.default_name);
                            js_ast::ClauseItem::DEFAULT_ALIAS
                        };

                        let mut react_hook_data: Option<crate::parser::HookContext> = None;
                        let prev = p.react_refresh.hook_ctx_storage;
                        p.react_refresh.hook_ctx_storage =
                            Some(core::ptr::NonNull::from(&mut react_hook_data));

                        let open_parens_loc = func.func.open_parens_loc;
                        func.func = p.visit_func(core::mem::take(&mut func.func), open_parens_loc);

                        if p.is_control_flow_dead {
                            p.react_refresh.hook_ctx_storage = prev;
                            restore_dead!();
                            record_on_exit!();
                            return Ok(());
                        }

                        if data
                            .default_name
                            .ref_
                            .expect("infallible: ref bound")
                            .is_source_contents_slice()
                        {
                            data.default_name =
                                p.create_default_name(stmt.loc).expect("unreachable");
                        }

                        // Capture the original function name before any `mem::take` below resets
                        // `func.func` to its default. The Zig spec copies `func.func` by value into
                        // the E.Function expr, leaving `func.func.name` intact for the
                        // react_fast_refresh temp-var emission that follows.
                        let func_name = func.func.name;

                        if let Some(hook) = react_hook_data.as_mut() {
                            let signature_cb = hook.signature_cb;
                            stmts.push(p.get_react_refresh_hook_signal_decl(signature_cb));

                            let func_expr = p.new_expr(
                                E::Function {
                                    func: core::mem::take(&mut func.func),
                                },
                                stmt.loc,
                            );
                            data.value = js_ast::StmtOrExpr::Expr(
                                p.get_react_refresh_hook_signal_init(hook, func_expr),
                            );
                        }

                        if mark_for_replace {
                            let entry = p
                                .options
                                .features
                                .replace_exports
                                .get_ptr(b"default")
                                .cloned()
                                .unwrap();
                            if let crate::parser::Runtime::ReplaceableExport::Replace(
                                replace_expr,
                            ) = entry
                            {
                                data.value = js_ast::StmtOrExpr::Expr(replace_expr);
                            } else {
                                let _ = p.inject_replacement_export(
                                    stmts,
                                    Ref::NONE,
                                    bun_ast::Loc::EMPTY,
                                    &entry,
                                );
                                p.react_refresh.hook_ctx_storage = prev;
                                restore_dead!();
                                record_on_exit!();
                                return Ok(());
                            }
                        }

                        if p.options.features.react_fast_refresh
                            && (ReactRefresh::is_componentish_name(name)
                                || name == js_ast::ClauseItem::DEFAULT_ALIAS)
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
                            let ref_ = if let js_ast::StmtOrExpr::Expr(e) = data.value {
                                'emit_temp_var: {
                                    let ref_to_use = 'brk: {
                                        if let Some(loc_ref) = func_name {
                                            // Input:
                                            //
                                            //  export default function Foo() {}
                                            //
                                            // Output:
                                            //
                                            //  const Foo = _s(function Foo() {})
                                            //  export default Foo;
                                            if let Some(r) = loc_ref.ref_ {
                                                break 'brk r;
                                            }
                                        }

                                        let temp_id = p.generate_temp_ref(Some(b"default_export"));
                                        VecExt::append(&mut p.cur_scope().generated, temp_id);
                                        break 'brk temp_id;
                                    };

                                    stmts.push(Stmt::alloc(
                                        S::Local {
                                            kind: S::Kind::KConst,
                                            decls: G::DeclList::from_slice(&[G::Decl {
                                                binding: Binding::alloc(
                                                    p.arena,
                                                    B::Identifier { r#ref: ref_to_use },
                                                    stmt.loc,
                                                ),
                                                value: Some(e),
                                            }]),
                                            ..Default::default()
                                        },
                                        stmt.loc,
                                    ));

                                    data.value = js_ast::StmtOrExpr::Expr(Expr::init_identifier(
                                        ref_to_use, stmt.loc,
                                    ));

                                    break 'emit_temp_var ref_to_use;
                                }
                            } else {
                                data.default_name.ref_.expect("infallible: ref bound")
                            };

                            if p.options.features.server_components.wraps_exports() {
                                let inner = if let js_ast::StmtOrExpr::Expr(e) = data.value {
                                    e
                                } else {
                                    p.new_expr(
                                        E::Function {
                                            func: core::mem::take(&mut func.func),
                                        },
                                        stmt.loc,
                                    )
                                };
                                data.value = js_ast::StmtOrExpr::Expr(
                                    p.wrap_value_for_server_component_reference(inner, b"default"),
                                );
                            }

                            stmts.push(*stmt);
                            p.emit_react_refresh_register(
                                stmts,
                                name,
                                ref_,
                                ReactRefreshExportKind::Default,
                            )?;
                        } else {
                            if p.options.features.server_components.wraps_exports() {
                                let func_expr = p.new_expr(
                                    E::Function {
                                        func: core::mem::take(&mut func.func),
                                    },
                                    stmt.loc,
                                );
                                data.value = js_ast::StmtOrExpr::Expr(
                                    p.wrap_value_for_server_component_reference(
                                        func_expr, b"default",
                                    ),
                                );
                            }

                            stmts.push(*stmt);
                        }

                        // if (func.func.name != null and func.func.name.?.ref != null) {
                        //     stmts.append(p.keepStmtSymbolName(func.func.name.?.loc, func.func.name.?.ref.?, name)) catch unreachable;
                        // }
                        p.react_refresh.hook_ctx_storage = prev;
                        restore_dead!();
                        record_on_exit!();
                        return Ok(());
                    }
                    StmtData::SClass(mut class_ref) => {
                        let class: &mut S::Class = &mut *class_ref;
                        let _ = p.visit_class(
                            s2_loc,
                            &mut class.class,
                            data.default_name.ref_.expect("infallible: ref bound"),
                        );

                        if p.is_control_flow_dead {
                            restore_dead!();
                            record_on_exit!();
                            return Ok(());
                        }

                        if mark_for_replace {
                            let entry = p
                                .options
                                .features
                                .replace_exports
                                .get_ptr(b"default")
                                .cloned()
                                .unwrap();
                            if let crate::parser::Runtime::ReplaceableExport::Replace(
                                replace_expr,
                            ) = entry
                            {
                                data.value = js_ast::StmtOrExpr::Expr(replace_expr);
                            } else {
                                let _ = p.inject_replacement_export(
                                    stmts,
                                    Ref::NONE,
                                    bun_ast::Loc::EMPTY,
                                    &entry,
                                );
                                restore_dead!();
                                record_on_exit!();
                                return Ok(());
                            }
                        }

                        if data
                            .default_name
                            .ref_
                            .expect("infallible: ref bound")
                            .is_source_contents_slice()
                        {
                            data.default_name =
                                p.create_default_name(stmt.loc).expect("unreachable");
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
                        let class_stmts = p.lower_class(js_ast::StmtOrExpr::Stmt(s2_copy));

                        // Find the s_class statement in the returned list
                        let mut class_stmt_idx: usize = 0;
                        for (idx, cs) in class_stmts.iter().enumerate() {
                            if matches!(cs.data, StmtData::SClass(_)) {
                                class_stmt_idx = idx;
                                break;
                            }
                        }

                        // Emit any prefix statements before the export default
                        stmts.extend_from_slice(&class_stmts[0..class_stmt_idx]);

                        data.value = js_ast::StmtOrExpr::Stmt(class_stmts[class_stmt_idx]);
                        stmts.push(*stmt);

                        // Emit any suffix statements after the export default
                        if class_stmt_idx + 1 < class_stmts.len() {
                            stmts.extend_from_slice(&class_stmts[class_stmt_idx + 1..]);
                        }

                        if p.options.features.server_components.wraps_exports() {
                            // TODO(port): Zig spec mutates `data.value` *after* pushing `stmt` —
                            // mirrored bug-for-bug. The class expr wrap likely belongs before push.
                            let class_expr =
                                p.new_expr(core::mem::take(&mut class.class), stmt.loc);
                            data.value = js_ast::StmtOrExpr::Expr(
                                p.wrap_value_for_server_component_reference(class_expr, b"default"),
                            );
                        }

                        restore_dead!();
                        record_on_exit!();
                        return Ok(());
                    }
                    _ => {}
                }
            }
        }

        stmts.push(*stmt);
        restore_dead!();
        record_on_exit!();
        Ok(())
    }

    fn s_function(
        p: &mut Self,
        stmts: &mut StmtList<'a>,
        stmt: &mut Stmt,
        data: &mut S::Function,
    ) -> Result<(), Error> {
        // We mark it as dead, but the value may not actually be dead
        // We just want to be sure to not increment the usage counts for anything in the function
        let mark_as_dead = p.options.features.dead_code_elimination
            && data.func.flags.contains(flags::Function::IsExport)
            && p.options.features.replace_exports.count() > 0
            && p.is_export_to_eliminate(
                data.func
                    .name
                    .expect("infallible: name checked")
                    .ref_
                    .expect("infallible: ref bound"),
            );
        let original_is_dead = p.is_control_flow_dead;

        if mark_as_dead {
            p.is_control_flow_dead = true;
        }

        // Spec (visitStmt.zig:517-520) unconditionally points p.react_refresh.hook_ctx_storage
        // at this stack-local before visit_func and defer-restores it. Field is now
        // `Option<NonNull<_>>` (Copy) matching Zig's `?*?HookContext`, so save/set/restore
        // are trivial; no `'a` constraint to fight.
        let mut react_hook_data: Option<crate::parser::HookContext> = None;
        let prev_hook_storage = p.react_refresh.hook_ctx_storage;
        p.react_refresh.hook_ctx_storage = Some(core::ptr::NonNull::from(&mut react_hook_data));

        let open_parens_loc = data.func.open_parens_loc;
        data.func = p.visit_func(core::mem::take(&mut data.func), open_parens_loc);

        let name_ref = data
            .func
            .name
            .expect("infallible: name checked")
            .ref_
            .expect("infallible: ref bound");
        debug_assert!(name_ref.is_symbol());
        let name_symbol = &p.symbols[name_ref.inner_index() as usize];
        let original_name: &'a [u8] = name_symbol.original_name.slice();
        let remove_overwritten = name_symbol.remove_overwritten_function_declaration;

        // Handle exporting this function from a namespace
        if data.func.flags.contains(flags::Function::IsExport)
            && p.enclosing_namespace_arg_ref.is_some()
        {
            data.func.flags.remove(flags::Function::IsExport);

            let enclosing_namespace_arg_ref = p
                .enclosing_namespace_arg_ref
                .expect("infallible: in namespace");
            stmts.reserve(3);
            stmts.push(*stmt); // PERF(port): was assume_capacity
            let func_name = data.func.name.expect("infallible: name checked");
            stmts.push(Stmt::assign(
                p.new_expr(
                    E::Dot {
                        target: Expr::init_identifier(enclosing_namespace_arg_ref, stmt.loc),
                        name: original_name.into(),
                        name_loc: func_name.loc,
                        ..Default::default()
                    },
                    stmt.loc,
                ),
                Expr::init_identifier(
                    func_name.ref_.expect("infallible: ref bound"),
                    func_name.loc,
                ),
            )); // PERF(port): was assume_capacity
        } else if !mark_as_dead {
            if remove_overwritten {
                // Zig: defer { ... } — restore on early return.
                p.react_refresh.hook_ctx_storage = prev_hook_storage;
                if mark_as_dead {
                    p.is_control_flow_dead = original_is_dead;
                }
                return Ok(());
            }

            if p.options.features.server_components.wraps_exports()
                && data.func.flags.contains(flags::Function::IsExport)
            {
                // Convert this into `export var <name> = registerClientReference(<func>, ...);`
                let name = data.func.name.expect("infallible: name checked");
                // From the inner scope, have code reference the wrapped function.
                data.func.name = None;
                let func_expr = p.new_expr(
                    E::Function {
                        func: core::mem::take(&mut data.func),
                    },
                    stmt.loc,
                );
                let wrapped = p.wrap_value_for_server_component_reference(func_expr, original_name);
                let binding = p.b(B::Identifier { r#ref: name_ref }, name.loc);
                stmts.push(p.s(
                    S::Local {
                        kind: S::Kind::KVar,
                        is_export: true,
                        decls: G::DeclList::from_slice(&[G::Decl {
                            binding,
                            value: Some(wrapped),
                        }]),
                        ..Default::default()
                    },
                    stmt.loc,
                ));
            } else {
                stmts.push(*stmt);
            }
        } else if mark_as_dead {
            if let Some(replacement) = p
                .options
                .features
                .replace_exports
                .get_ptr(original_name)
                .cloned()
            {
                let _ = p.inject_replacement_export(
                    stmts,
                    name_ref,
                    data.func.name.expect("infallible: name checked").loc,
                    &replacement,
                );
            }
        }

        let mut rr: Result<(), Error> = Ok(());
        if p.options.features.react_fast_refresh {
            if let Some(hook) = react_hook_data.as_mut() {
                let signature_cb = hook.signature_cb;
                stmts.push(p.get_react_refresh_hook_signal_decl(signature_cb));
                let init = p.get_react_refresh_hook_signal_init(
                    hook,
                    Expr::init_identifier(name_ref, bun_ast::Loc::EMPTY),
                );
                stmts.push(p.s(
                    S::SExpr {
                        value: init,
                        ..Default::default()
                    },
                    bun_ast::Loc::EMPTY,
                ));
            }

            if p.current_scope == p.module_scope {
                // PORT NOTE: defer-vs-drop-scope — restore hook_ctx_storage/is_control_flow_dead
                // before propagating Err so the stack-local `react_hook_data` ptr is never left in
                // p.react_refresh on the OOM path (Zig defer covers all exits).
                rr = p.handle_react_refresh_register(
                    stmts,
                    original_name,
                    name_ref,
                    ReactRefreshExportKind::Named,
                );
            }
        }

        // Zig: defer p.react_refresh.hook_ctx_storage = prev;
        p.react_refresh.hook_ctx_storage = prev_hook_storage;
        // Zig: defer { if (mark_as_dead) p.is_control_flow_dead = original_is_dead; }
        if mark_as_dead {
            p.is_control_flow_dead = original_is_dead;
        }
        rr
    }

    fn s_class(
        p: &mut Self,
        stmts: &mut StmtList<'a>,
        stmt: &mut Stmt,
        data: &mut S::Class,
    ) -> Result<(), Error> {
        let mark_as_dead = p.options.features.dead_code_elimination
            && data.is_export
            && p.options.features.replace_exports.count() > 0
            && p.is_export_to_eliminate(
                data.class
                    .class_name
                    .expect("infallible: name checked")
                    .ref_
                    .expect("infallible: ref bound"),
            );
        let original_is_dead = p.is_control_flow_dead;

        if mark_as_dead {
            p.is_control_flow_dead = true;
        }

        let _ = p.visit_class(stmt.loc, &mut data.class, Ref::NONE);

        // Remove the export flag inside a namespace
        let was_export_inside_namespace = data.is_export && p.enclosing_namespace_arg_ref.is_some();
        if was_export_inside_namespace {
            data.is_export = false;
        }

        // Lower class field syntax for browsers that don't support it
        let lowered = p.lower_class(js_ast::StmtOrExpr::Stmt(*stmt));

        if !mark_as_dead || was_export_inside_namespace {
            // Lower class field syntax for browsers that don't support it
            stmts.extend_from_slice(lowered);
        } else {
            let ref_ = data
                .class
                .class_name
                .expect("infallible: name checked")
                .ref_
                .expect("infallible: ref bound");
            let name = p.load_name_from_ref(ref_);
            if let Some(replacement) = p.options.features.replace_exports.get_ptr(name).cloned() {
                if p.inject_replacement_export(
                    stmts,
                    ref_,
                    data.class.class_name.expect("infallible: name checked").loc,
                    &replacement,
                ) {
                    p.is_control_flow_dead = original_is_dead;
                }
            }
        }

        // Handle exporting this class from a namespace
        if was_export_inside_namespace {
            let class_name = data.class.class_name.expect("infallible: name checked");
            let class_name_ref = class_name.ref_.expect("infallible: ref bound");
            let original_name = p.symbols[class_name_ref.inner_index() as usize]
                .original_name
                .slice();
            stmts.push(Stmt::assign(
                p.new_expr(
                    E::Dot {
                        target: Expr::init_identifier(
                            p.enclosing_namespace_arg_ref
                                .expect("infallible: in namespace"),
                            stmt.loc,
                        ),
                        name: original_name.into(),
                        name_loc: class_name.loc,
                        ..Default::default()
                    },
                    stmt.loc,
                ),
                Expr::init_identifier(class_name_ref, class_name.loc),
            ));
        }

        // Zig: defer { if (mark_as_dead) p.is_control_flow_dead = original_is_dead; }
        if mark_as_dead {
            p.is_control_flow_dead = original_is_dead;
        }
        Ok(())
    }

    fn s_local(
        p: &mut Self,
        stmts: &mut StmtList<'a>,
        stmt: &mut Stmt,
        data: &mut S::Local,
        was_after_after_const_local_prefix: bool,
    ) -> Result<(), Error> {
        // TODO: Silently remove unsupported top-level "await" in dead code branches
        // (this was from 'await using' syntax)

        // Local statements do not end the const local prefix
        p.cur_scope().is_after_const_local_prefix = was_after_after_const_local_prefix;

        // visit_decls returns the surviving decl count; truncate `data.decls.len` to it.
        let was_const = data.kind == S::Kind::KConst;
        let new_len = if !(data.is_export && p.options.features.replace_exports.entries.len() > 0) {
            p.visit_decls::<false>(data.decls.slice_mut(), was_const)
        } else {
            p.visit_decls::<true>(data.decls.slice_mut(), was_const)
        };
        // Spec (visitStmt.zig:724-727): drop the whole statement when every decl was
        // eliminated; otherwise we'd emit an empty `var;`/`let;`/`const;`.
        if data.decls.len_u32() > 0 && new_len == 0 {
            return Ok(());
        }
        data.decls.truncate(new_len);

        // Handle being exported inside a namespace
        if data.is_export && p.enclosing_namespace_arg_ref.is_some() {
            for d in data.decls.slice() {
                if let Some(val) = d.value {
                    p.record_usage(
                        p.enclosing_namespace_arg_ref
                            .expect("infallible: in namespace"),
                    );
                    // TODO: is it necessary to lowerAssign? why does esbuild do it _most_ of the time?
                    // PORT NOTE: ToExprWrapper is Copy; pass by value to avoid borrowing `*p`
                    // across `p.s(...)`. The `*mut P` ctx is derived from the live `&mut Self`
                    // here so its provenance is a child of the active Unique borrow.
                    let wrapper = p.to_expr_wrapper_namespace;
                    let ctx = core::ptr::addr_of_mut!(*p).cast::<core::ffi::c_void>();
                    let lhs = Binding::to_expr(&d.binding, ctx, wrapper);
                    stmts.push(p.s(
                        S::SExpr {
                            value: Expr::assign(lhs, val),
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
        if p.options.features.minify_syntax && data.kind == S::Kind::KUsing {
            data.kind = S::Kind::KLet;
            for d in data.decls.slice() {
                if let Some(val) = d.value {
                    if !matches!(val.data, js_ast::ExprData::ENull(_))
                        && !matches!(val.data, js_ast::ExprData::EUndefined(_))
                    {
                        data.kind = S::Kind::KUsing;
                        break;
                    }
                }
            }
        }

        // We must relocate vars in order to safely handle removing if/else depending on NODE_ENV.
        // Edgecase:
        //  `export var` is skipped because it's unnecessary. That *should* be a noop, but it loses the `is_export` flag if we're in HMR.
        let kind = p.select_local_kind(data.kind);
        if kind == S::Kind::KVar && !data.is_export {
            let relocated =
                p.maybe_relocate_vars_to_top_level(data.decls.slice(), RelocateVarsMode::Normal);
            if relocated.ok {
                if let Some(new_stmt) = relocated.stmt {
                    stmts.push(new_stmt);
                }

                return Ok(());
            }
        }

        data.kind = kind;
        stmts.push(*stmt);

        if p.options.features.react_fast_refresh && p.current_scope == p.module_scope {
            for decl in data.decls.slice() {
                'try_register: {
                    let Some(val) = decl.value else {
                        break 'try_register;
                    };
                    match val.data {
                        // Assigning a component to a local.
                        js_ast::ExprData::EArrow(_) | js_ast::ExprData::EFunction(_) => {}

                        // A wrapped component.
                        js_ast::ExprData::ECall(call) => match call.target.data {
                            js_ast::ExprData::EIdentifier(id) => {
                                if id.ref_ != p.react_refresh.latest_signature_ref {
                                    break 'try_register;
                                }
                            }
                            _ => break 'try_register,
                        },
                        _ => break 'try_register,
                    }
                    let id = match decl.binding.data {
                        js_ast::binding::Data::BIdentifier(b) => b.r#ref,
                        _ => break 'try_register,
                    };
                    let original_name = p.symbols[id.inner_index() as usize].original_name.slice();
                    p.handle_react_refresh_register(
                        stmts,
                        original_name,
                        id,
                        ReactRefreshExportKind::Named,
                    )?;
                }
            }
        }

        if data.is_export && p.options.features.server_components.wraps_exports() {
            for decl in data.decls.slice_mut() {
                'try_annotate: {
                    let Some(val) = decl.value else {
                        break 'try_annotate;
                    };
                    let id = match decl.binding.data {
                        js_ast::binding::Data::BIdentifier(b) => b.r#ref,
                        _ => break 'try_annotate,
                    };
                    let original_name = p.symbols[id.inner_index() as usize].original_name.slice();
                    decl.value =
                        Some(p.wrap_value_for_server_component_reference(val, original_name));
                }
            }
        }

        Ok(())
    }

    // ─── control-flow / scope visitors ──────────────────────────────────────

    fn s_break(
        p: &mut Self,
        stmts: &mut StmtList<'a>,
        stmt: &mut Stmt,
        data: &mut S::Break,
    ) -> Result<(), Error> {
        if let Some(label) = &mut data.label {
            let r = label.ref_.unwrap_or_else(|| {
                p.panic_loc(
                    "Expected label to have a ref",
                    format_args!(""),
                    Some(label.loc),
                )
            });
            let name = p.load_name_from_ref(r);
            let res = p.find_label_symbol(label.loc, name);
            if res.found {
                label.ref_ = Some(res.r#ref);
            } else {
                data.label = None;
            }
        } else if !p.fn_or_arrow_data_visit.is_inside_loop
            && !p.fn_or_arrow_data_visit.is_inside_switch
        {
            let r = js_lexer::range_of_identifier(p.source, stmt.loc);
            p.log()
                .add_range_error(Some(p.source), r, b"Cannot use \"break\" here");
        }

        stmts.push(*stmt);
        Ok(())
    }

    fn s_continue(
        p: &mut Self,
        stmts: &mut StmtList<'a>,
        stmt: &mut Stmt,
        data: &mut S::Continue,
    ) -> Result<(), Error> {
        if let Some(label) = &mut data.label {
            let r = label.ref_.unwrap_or_else(|| {
                p.panic_loc(
                    "Expected continue label to have a ref",
                    format_args!(""),
                    Some(label.loc),
                )
            });
            let name = p.load_name_from_ref(r);
            let res = p.find_label_symbol(label.loc, name);
            label.ref_ = Some(res.r#ref);
            if res.found && !res.is_loop {
                let r = js_lexer::range_of_identifier(p.source, stmt.loc);
                p.log().add_range_error_fmt(
                    Some(p.source),
                    r,
                    format_args!("Cannot \"continue\" to label {}", bstr::BStr::new(name)),
                );
            }
        } else if !p.fn_or_arrow_data_visit.is_inside_loop {
            let r = js_lexer::range_of_identifier(p.source, stmt.loc);
            p.log()
                .add_range_error(Some(p.source), r, b"Cannot use \"continue\" here");
        }

        stmts.push(*stmt);
        Ok(())
    }

    fn s_label(
        p: &mut Self,
        stmts: &mut StmtList<'a>,
        stmt: &mut Stmt,
        data: &mut S::Label,
    ) -> Result<(), Error> {
        p.push_scope_for_visit_pass(js_ast::scope::Kind::Label, stmt.loc)
            .expect("unreachable");
        let name = p.load_name_from_ref(data.name.ref_.expect("infallible: ref bound"));
        let ref_ = p
            .new_symbol(js_ast::symbol::Kind::Label, name)
            .expect("unreachable");
        data.name.ref_ = Some(ref_);
        p.cur_scope().label_ref = Some(ref_);
        match data.stmt.data {
            StmtData::SFor(_)
            | StmtData::SForIn(_)
            | StmtData::SForOf(_)
            | StmtData::SWhile(_)
            | StmtData::SDoWhile(_) => {
                p.cur_scope().label_stmt_is_loop = true;
            }
            _ => {}
        }

        data.stmt = p.visit_single_stmt(data.stmt, StmtsKind::None);
        p.pop_scope();

        stmts.push(*stmt);
        Ok(())
    }

    fn s_expr(
        p: &mut Self,
        stmts: &mut StmtList<'a>,
        stmt: &mut Stmt,
        data: &mut S::SExpr,
    ) -> Result<(), Error> {
        let should_trim_primitive = p.options.features.dead_code_elimination
            && (p.options.features.minify_syntax && data.value.is_primitive_literal());
        p.stmt_expr_value = data.value.data;

        let is_top_level = p.current_scope == p.module_scope;
        if p.should_unwrap_common_js_to_esm() {
            p.commonjs_named_exports_needs_conversion = if is_top_level {
                u32::MAX
            } else {
                p.commonjs_named_exports_needs_conversion
            };
        }

        p.visit_expr(&mut data.value);

        // Zig: defer p.stmt_expr_value = .{ .e_missing = .{} };
        // PORT NOTE: restructured — restored at every return below.
        macro_rules! restore_stmt_expr {
            () => {
                p.stmt_expr_value = js_ast::ExprData::EMissing(E::Missing {});
            };
        }

        if should_trim_primitive && data.value.is_primitive_literal() {
            restore_stmt_expr!();
            return Ok(());
        }

        // simplify unused
        let Some(simplified) = SideEffects::simplify_unused_expr(p, data.value) else {
            restore_stmt_expr!();
            return Ok(());
        };
        data.value = simplified;

        if p.should_unwrap_common_js_to_esm() {
            if is_top_level {
                if matches!(data.value.data, js_ast::ExprData::EBinary(_)) {
                    let to_convert = p.commonjs_named_exports_needs_conversion;
                    if to_convert != u32::MAX {
                        p.commonjs_named_exports_needs_conversion = u32::MAX;
                        'convert: {
                            // PORT NOTE: reshaped for borrowck — copy StoreRef so DerefMut
                            // points into the arena, freeing `&mut data.value`.
                            let js_ast::ExprData::EBinary(mut bin_ref) = data.value.data else {
                                break 'convert;
                            };
                            let bin: &mut E::Binary = &mut *bin_ref;
                            if bin.op == js_ast::OpCode::BinAssign
                                && matches!(
                                    bin.left.data,
                                    js_ast::ExprData::ECommonjsExportIdentifier(_)
                                )
                            {
                                // last entry's value — `keys()` borrows the map; wrap as
                                // `StoreStr` so the borrow is detached before re-borrowing
                                // `commonjs_named_exports` mutably below.
                                let key: &'a [u8] = js_ast::StoreStr::new(
                                    &p.commonjs_named_exports.keys()[to_convert as usize][..],
                                )
                                .slice();
                                let last =
                                    &mut p.commonjs_named_exports.values_mut()[to_convert as usize];
                                if !last.needs_decl {
                                    break 'convert;
                                }
                                last.needs_decl = false;
                                let last_loc = last.loc_ref.loc;

                                let mut decls = G::DeclList::init_capacity(1);
                                let ref_ = match bin.left.data {
                                    js_ast::ExprData::ECommonjsExportIdentifier(id) => id.ref_,
                                    _ => unreachable!(),
                                };
                                VecExt::append(
                                    &mut decls,
                                    G::Decl {
                                        binding: p.b(B::Identifier { r#ref: ref_ }, bin.left.loc),
                                        value: Some(bin.right),
                                    },
                                );
                                // we have to ensure these are known to be top-level
                                p.declared_symbols
                                    .append(js_ast::DeclaredSymbol {
                                        ref_,
                                        is_top_level: true,
                                    })
                                    .expect("oom");
                                p.esm_export_keyword.loc = stmt.loc;
                                p.esm_export_keyword.len = 5;
                                p.had_commonjs_named_exports_this_visit = true;
                                let clause_items =
                                    core::slice::from_mut(p.arena.alloc(js_ast::ClauseItem {
                                        // We want the generated name to not conflict
                                        alias: js_ast::StoreStr::new(key),
                                        alias_loc: bin.left.loc,
                                        name: js_ast::LocRef {
                                            ref_: Some(ref_),
                                            loc: last_loc,
                                        },
                                        ..Default::default()
                                    }));
                                let local = p.s(
                                    S::Local {
                                        kind: S::Kind::KVar,
                                        is_export: false,
                                        was_commonjs_export: true,
                                        decls,
                                        ..Default::default()
                                    },
                                    stmt.loc,
                                );
                                let export = p.s(
                                    S::ExportClause {
                                        items: bun_ast::StoreSlice::new_mut(clause_items),
                                        is_single_line: true,
                                    },
                                    stmt.loc,
                                );
                                stmts.extend_from_slice(&[local, export]);

                                restore_stmt_expr!();
                                return Ok(());
                            }
                        }
                    } else if p.commonjs_replacement_stmts.len() > 0 {
                        // PORT NOTE: Zig directly swaps backing storage; commonjs_replacement_stmts
                        // is `StmtNodeList = StoreSlice<Stmt>` here, so copy then clear.
                        let repl: &[Stmt] = p.commonjs_replacement_stmts.slice();
                        if stmts.is_empty() {
                            *stmts = bun_alloc::vec_from_iter_in(repl.iter().copied(), p.arena);
                        } else {
                            stmts.extend_from_slice(repl);
                        }
                        p.commonjs_replacement_stmts = StmtNodeList::EMPTY;

                        restore_stmt_expr!();
                        return Ok(());
                    }
                }
            }
        }

        stmts.push(*stmt);
        restore_stmt_expr!();
        Ok(())
    }

    fn s_throw(
        p: &mut Self,
        stmts: &mut StmtList<'a>,
        stmt: &mut Stmt,
        data: &mut S::Throw,
    ) -> Result<(), Error> {
        p.visit_expr(&mut data.value);
        stmts.push(*stmt);
        Ok(())
    }

    fn s_return(
        p: &mut Self,
        stmts: &mut StmtList<'a>,
        stmt: &mut Stmt,
        data: &mut S::Return,
    ) -> Result<(), Error> {
        // Forbid top-level return inside modules with ECMAScript-style exports
        if p.fn_or_arrow_data_visit.is_outside_fn_or_arrow {
            let where_ = if p.esm_export_keyword.len > 0 {
                p.esm_export_keyword
            } else if p.top_level_await_keyword.len > 0 {
                p.top_level_await_keyword
            } else {
                bun_ast::Range::NONE
            };

            if where_.len > 0 {
                p.log().add_range_error(
                    Some(p.source),
                    where_,
                    b"Top-level return cannot be used inside an ECMAScript module",
                );
            }
        }

        if let Some(val) = data.value.as_mut() {
            p.visit_expr(val);

            // "return undefined;" can safely just always be "return;"
            if let Some(v) = data.value {
                if matches!(v.data, js_ast::ExprData::EUndefined(_)) {
                    // Returning undefined is implicit
                    data.value = None;
                }
            }
        }

        stmts.push(*stmt);
        Ok(())
    }

    fn s_block(
        p: &mut Self,
        stmts: &mut StmtList<'a>,
        stmt: &mut Stmt,
        data: &mut S::Block,
    ) -> Result<(), Error> {
        {
            p.push_scope_for_visit_pass(js_ast::scope::Kind::Block, stmt.loc)
                .expect("unreachable");

            // Pass the "is loop body" status on to the direct children of a block used
            // as a loop body. This is used to enable optimizations specific to the
            // topmost scope in a loop body block.
            let kind = if core::mem::discriminant(&p.loop_body)
                == core::mem::discriminant(&stmt.data)
                && match (p.loop_body, stmt.data) {
                    (StmtData::SBlock(a), StmtData::SBlock(b)) => {
                        core::ptr::eq(&raw const *a, &raw const *b)
                    }
                    _ => false,
                } {
                StmtsKind::LoopBody
            } else {
                StmtsKind::None
            };
            let mut _stmts = stmts_to_list(p.arena, data.stmts);
            p.visit_stmts(&mut _stmts, kind).expect("unreachable");
            data.stmts = list_to_stmts(_stmts);
            p.pop_scope();
        }

        if p.options.features.minify_syntax {
            // // trim empty statements
            let block_stmts: &[Stmt] = data.stmts.slice();
            if block_stmts.is_empty() {
                stmts.push(Stmt {
                    data: Stmt::empty().data,
                    loc: stmt.loc,
                });
                return Ok(());
            } else if block_stmts.len() == 1 && !statement_cares_about_scope(&block_stmts[0]) {
                // Unwrap blocks containing a single statement
                stmts.push(block_stmts[0]);
                return Ok(());
            }
        }

        stmts.push(*stmt);
        Ok(())
    }

    fn s_with(
        p: &mut Self,
        stmts: &mut StmtList<'a>,
        stmt: &mut Stmt,
        data: &mut S::With,
    ) -> Result<(), Error> {
        p.visit_expr(&mut data.value);

        p.push_scope_for_visit_pass(js_ast::scope::Kind::With, data.body_loc)
            .expect("unreachable");

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
        p: &mut Self,
        stmts: &mut StmtList<'a>,
        stmt: &mut Stmt,
        data: &mut S::While,
    ) -> Result<(), Error> {
        p.visit_expr(&mut data.test_);
        data.body = p.visit_loop_body(data.body);

        data.test_ = SideEffects::simplify_boolean(p, data.test_);
        let result = SideEffects::to_boolean(p, &data.test_.data);
        if result.ok && result.side_effects == SideEffects::NoSideEffects {
            data.test_ = p.new_expr(
                E::Boolean {
                    value: result.value,
                },
                data.test_.loc,
            );
        }

        stmts.push(*stmt);
        Ok(())
    }

    fn s_do_while(
        p: &mut Self,
        stmts: &mut StmtList<'a>,
        stmt: &mut Stmt,
        data: &mut S::DoWhile,
    ) -> Result<(), Error> {
        data.body = p.visit_loop_body(data.body);
        p.visit_expr(&mut data.test_);

        data.test_ = SideEffects::simplify_boolean(p, data.test_);
        stmts.push(*stmt);
        Ok(())
    }

    fn s_if(
        p: &mut Self,
        stmts: &mut StmtList<'a>,
        stmt: &mut Stmt,
        data: &mut S::If,
    ) -> Result<(), Error> {
        let prev_in_branch = p.in_branch_condition;
        p.in_branch_condition = true;
        p.visit_expr(&mut data.test_);
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

            // Trim an "else" clause whose body was emptied by dead-code
            // elimination. This avoids emitting `else {}` for e.g.
            // `if (true) { A } else { B }` where B was pruned. Gated on
            // the union of DCE and minify_syntax so the pre-existing
            // `deadCodeElimination: false, minify: { syntax: true }`
            // configuration (which already dropped the `else {}`)
            // doesn't regress to `else ;`.
            if p.options.features.dead_code_elimination || p.options.features.minify_syntax {
                if let Some(no2) = data.no {
                    let no_is_empty = match no2.data {
                        StmtData::SEmpty(_) => true,
                        StmtData::SBlock(block) => block.stmts.len() == 0,
                        _ => false,
                    };
                    if no_is_empty {
                        data.no = None;
                    }
                }
            }
        }

        if p.options.features.minify_syntax {
            if effects.ok {
                if effects.value {
                    if data.no.is_none()
                        || !SideEffects::should_keep_stmt_in_dead_control_flow(
                            data.no.unwrap(),
                            p.arena,
                        )
                    {
                        if effects.side_effects == SideEffects::CouldHaveSideEffects {
                            // Keep the condition if it could have side effects (but is still known to be truthy)
                            if let Some(test_) = SideEffects::simplify_unused_expr(p, data.test_) {
                                stmts.push(p.s(
                                    S::SExpr {
                                        value: test_,
                                        ..Default::default()
                                    },
                                    test_.loc,
                                ));
                            }
                        }

                        return p.append_if_body_preserving_scope(stmts, data.yes);
                    } else {
                        // We have to keep the "no" branch
                    }
                } else {
                    // The test is falsy
                    if !SideEffects::should_keep_stmt_in_dead_control_flow(data.yes, p.arena) {
                        if effects.side_effects == SideEffects::CouldHaveSideEffects {
                            // Keep the condition if it could have side effects (but is still known to be truthy)
                            if let Some(test_) = SideEffects::simplify_unused_expr(p, data.test_) {
                                stmts.push(p.s(
                                    S::SExpr {
                                        value: test_,
                                        ..Default::default()
                                    },
                                    test_.loc,
                                ));
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
            match data.yes.data {
                StmtData::SExpr(yes_expr) => {
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
                StmtData::SEmpty(_) => {
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
        p: &mut Self,
        stmts: &mut StmtList<'a>,
        stmt: &mut Stmt,
        data: &mut S::For,
    ) -> Result<(), Error> {
        p.push_scope_for_visit_pass(js_ast::scope::Kind::Block, stmt.loc)
            .expect("unreachable");

        if let Some(initst) = data.init {
            data.init = Some(p.visit_for_loop_init(initst, false));
        }

        if let Some(mut test_) = data.test_ {
            p.visit_expr(&mut test_);
            data.test_ = Some(SideEffects::simplify_boolean(p, test_));

            let result = SideEffects::to_boolean(p, &data.test_.unwrap().data);
            if result.ok && result.value && result.side_effects == SideEffects::NoSideEffects {
                data.test_ = None;
            }
        }

        if let Some(update) = data.update.as_mut() {
            p.visit_expr(update);
        }

        data.body = p.visit_loop_body(data.body);

        if let Some(for_init) = data.init {
            if let StmtData::SLocal(local) = for_init.data {
                // Potentially relocate "var" declarations to the top level. Note that this
                // must be done inside the scope of the for loop or they won't be relocated.
                if local.kind == S::Kind::KVar {
                    let relocate = p.maybe_relocate_vars_to_top_level(
                        local.decls.slice(),
                        RelocateVarsMode::Normal,
                    );
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
        p: &mut Self,
        stmts: &mut StmtList<'a>,
        stmt: &mut Stmt,
        data: &mut S::ForIn,
    ) -> Result<(), Error> {
        {
            p.push_scope_for_visit_pass(js_ast::scope::Kind::Block, stmt.loc)
                .expect("unreachable");
            // Zig: defer p.popScope(); — restructured: pop at end of block
            let _ = p.visit_for_loop_init(data.init, true);
            p.visit_expr(&mut data.value);
            data.body = p.visit_loop_body(data.body);

            // Check for a variable initializer
            if let StmtData::SLocal(mut local_ref) = data.init.data {
                let local: &mut S::Local = &mut *local_ref;
                if local.kind == S::Kind::KVar {
                    // Lower for-in variable initializers in case the output is used in strict mode
                    if local.decls.len_u32() == 1 {
                        let decl: &mut G::Decl = &mut local.decls.slice_mut()[0];
                        if let js_ast::binding::Data::BIdentifier(b_id) = decl.binding.data {
                            if let Some(val) = decl.value {
                                let id_ref = b_id.r#ref;
                                stmts.push(Stmt::assign(
                                    Expr::init_identifier(id_ref, decl.binding.loc),
                                    val,
                                ));
                                decl.value = None;
                            }
                        }
                    }

                    let relocate = p.maybe_relocate_vars_to_top_level(
                        local.decls.slice(),
                        RelocateVarsMode::ForInOrForOf,
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
        p: &mut Self,
        stmts: &mut StmtList<'a>,
        stmt: &mut Stmt,
        data: &mut S::ForOf,
    ) -> Result<(), Error> {
        p.push_scope_for_visit_pass(js_ast::scope::Kind::Block, stmt.loc)
            .expect("unreachable");
        // Zig: defer p.popScope();
        let _ = p.visit_for_loop_init(data.init, true);
        p.visit_expr(&mut data.value);
        data.body = p.visit_loop_body(data.body);

        if let StmtData::SLocal(_) = data.init.data {
            if let StmtData::SLocal(local) = data.init.data {
                if local.kind == S::Kind::KVar {
                    let relocate = p.maybe_relocate_vars_to_top_level(
                        local.decls.slice(),
                        RelocateVarsMode::ForInOrForOf,
                    );
                    if let Some(relocated_stmt) = relocate.stmt {
                        data.init = relocated_stmt;
                    }
                }
            }

            // Handle "for (using x of y)" and "for (await using x of y)"
            if let StmtData::SLocal(mut init2_ref) = data.init.data {
                let init2: &mut S::Local = &mut *init2_ref;
                if init2.kind.is_using() && p.options.features.lower_using {
                    // fn lowerUsingDeclarationInForOf()
                    let loc = data.init.loc;
                    let binding = init2.decls.at(0).binding;
                    // `StoreRef<B::Identifier>` is `Copy` + `Deref`/`DerefMut` over the
                    // arena node, so hoisting it to a local lets every read/write below
                    // go through the safe accessor instead of a raw `as_ptr()` deref.
                    let mut id = match binding.data {
                        js_ast::binding::Data::BIdentifier(b) => b,
                        _ => unreachable!("for-of using must bind an identifier"),
                    };
                    let id_original_name = p.symbols[id.r#ref.inner_index() as usize]
                        .original_name
                        .slice();
                    let temp_ref = p.generate_temp_ref(Some(id_original_name));

                    let mut first_decls = G::DeclList::init_capacity(1);
                    VecExt::append(
                        &mut first_decls,
                        G::Decl {
                            binding: p.b(B::Identifier { r#ref: id.r#ref }, loc),
                            value: Some(Expr::init_identifier(temp_ref, loc)),
                        },
                    );
                    let first = p.s(
                        S::Local {
                            kind: init2.kind,
                            decls: first_decls,
                            ..Default::default()
                        },
                        loc,
                    );

                    let length = if let StmtData::SBlock(b) = data.body.data {
                        b.stmts.len()
                    } else {
                        1
                    };
                    let mut statements: BumpVec<'a, Stmt> =
                        BumpVec::with_capacity_in(1 + length, p.arena);
                    statements.push(first);
                    if let StmtData::SBlock(b) = data.body.data {
                        statements.extend_from_slice(b.stmts.slice());
                    } else {
                        statements.push(data.body);
                    }

                    let mut ctx = crate::p::LowerUsingDeclarationsContext::init(p)?;
                    let stmts_slice = statements.into_bump_slice_mut();
                    ctx.scan_stmts(p, stmts_slice);
                    let visited_stmts = ctx.finalize(
                        p,
                        stmts_slice,
                        p.will_wrap_module_in_try_catch_for_using
                            && p.current_scope().parent.is_none(),
                    );
                    if let StmtData::SBlock(mut b) = data.body.data {
                        b.stmts = list_to_stmts(visited_stmts);
                    } else {
                        data.body = p.s(
                            S::Block {
                                stmts: list_to_stmts(visited_stmts),
                                ..Default::default()
                            },
                            loc,
                        );
                    }
                    id.r#ref = temp_ref;
                    init2.kind = S::Kind::KConst;
                }
            }
        }

        p.pop_scope();
        stmts.push(*stmt);
        Ok(())
    }

    fn s_try(
        p: &mut Self,
        stmts: &mut StmtList<'a>,
        stmt: &mut Stmt,
        data: &mut S::Try,
    ) -> Result<(), Error> {
        p.push_scope_for_visit_pass(js_ast::scope::Kind::Block, stmt.loc)
            .expect("unreachable");
        {
            let mut _stmts = stmts_to_list(p.arena, data.body);
            p.fn_or_arrow_data_visit.try_body_count += 1;
            p.visit_stmts(&mut _stmts, StmtsKind::None)
                .expect("unreachable");
            p.fn_or_arrow_data_visit.try_body_count -= 1;
            data.body = list_to_stmts(_stmts);
        }
        p.pop_scope();

        if let Some(catch_) = &mut data.catch_ {
            p.push_scope_for_visit_pass(js_ast::scope::Kind::CatchBinding, catch_.loc)
                .expect("unreachable");
            {
                if let Some(catch_binding) = catch_.binding {
                    p.visit_binding(catch_binding, None);
                }
                let mut _stmts = stmts_to_list(p.arena, catch_.body);
                p.push_scope_for_visit_pass(js_ast::scope::Kind::Block, catch_.body_loc)
                    .expect("unreachable");
                p.visit_stmts(&mut _stmts, StmtsKind::None)
                    .expect("unreachable");
                p.pop_scope();
                catch_.body = list_to_stmts(_stmts);
            }
            p.pop_scope();
        }

        if let Some(finally) = &mut data.finally {
            p.push_scope_for_visit_pass(js_ast::scope::Kind::Block, finally.loc)
                .expect("unreachable");
            {
                let mut _stmts = stmts_to_list(p.arena, finally.stmts);
                p.visit_stmts(&mut _stmts, StmtsKind::None)
                    .expect("unreachable");
                finally.stmts = list_to_stmts(_stmts);
            }
            p.pop_scope();
        }

        stmts.push(*stmt);
        Ok(())
    }

    fn s_switch(
        p: &mut Self,
        stmts: &mut StmtList<'a>,
        stmt: &mut Stmt,
        data: &mut S::Switch,
    ) -> Result<(), Error> {
        p.visit_expr(&mut data.test_);
        {
            p.push_scope_for_visit_pass(js_ast::scope::Kind::Block, data.body_loc)
                .expect("unreachable");
            let old_is_inside_switch = p.fn_or_arrow_data_visit.is_inside_switch;
            p.fn_or_arrow_data_visit.is_inside_switch = true;
            let cases = data.cases.slice_mut();
            for i in 0..cases.len() {
                if let Some(val) = cases[i].value.as_mut() {
                    p.visit_expr(val);
                    // TODO: error messages
                    // Check("case", *c.Value, c.Value.Loc)
                    //                 p.warnAboutTypeofAndString(s.Test, *c.Value)
                }
                let mut _stmts = stmts_to_list(p.arena, cases[i].body);
                p.visit_stmts(&mut _stmts, StmtsKind::None)
                    .expect("unreachable");
                cases[i].body = list_to_stmts(_stmts);
            }
            p.fn_or_arrow_data_visit.is_inside_switch = old_is_inside_switch;
            p.pop_scope();
        }
        // TODO: duplicate case checker

        stmts.push(*stmt);
        Ok(())
    }

    fn s_enum(
        p: &mut Self,
        stmts: &mut StmtList<'a>,
        stmt: &mut Stmt,
        data: &mut S::Enum,
        was_after_after_const_local_prefix: bool,
    ) -> Result<(), Error> {
        // Do not end the const local prefix after TypeScript enums. We process
        // them first within their scope so that they are inlined into all code in
        // that scope. We don't want that to cause the const local prefix to end.
        p.cur_scope().is_after_const_local_prefix = was_after_after_const_local_prefix;

        // Track cross-module enum constants during bundling. This
        // part of the code is different from esbuilt in that we are
        // only storing a list of enum indexes. At the time of
        // referencing, `esbuild` builds a separate hash map of hash
        // maps. We are avoiding that to reduce memory usage, since
        // enum inlining already uses alot of hash maps.
        if p.current_scope == p.module_scope && p.options.bundle {
            p.top_level_enums
                .push(data.name.ref_.expect("infallible: ref bound"));
        }

        p.record_declared_symbol(data.name.ref_.expect("infallible: ref bound"));
        p.push_scope_for_visit_pass(js_ast::scope::Kind::Entry, stmt.loc)?;
        // Zig: defer p.popScope(); — moved to end (no early returns).
        p.record_declared_symbol(data.arg);

        // Scan ahead for any variables inside this namespace. This must be done
        // ahead of time before visiting any statements inside the namespace
        // because we may end up visiting the uses before the declarations.
        // We need to convert the uses into property accesses on the namespace.
        let values = data.values.slice_mut();
        for value in values.iter() {
            if value.ref_.is_valid() {
                p.is_exported_inside_namespace.insert(value.ref_, data.arg);
            }
        }

        // Values without initializers are initialized to one more than the
        // previous value if the previous value is numeric. Otherwise values
        // without initializers are initialized to undefined.
        let mut next_numeric_value: Option<f64> = Some(0.0);

        let mut value_exprs: BumpVec<'a, Expr> = BumpVec::with_capacity_in(values.len(), p.arena);

        let mut all_values_are_pure = true;

        // ts_namespace is set for the enum scope (push_scope_for_visit_pass populated it
        // during the parse pass); exported_members is an arena-backed `StoreRef`.
        let mut exported_members: js_ast::StoreRef<js_ast::TSNamespaceMemberMap> =
            p.cur_scope().ts_namespace.unwrap().exported_members;

        // We normally don't fold numeric constants because they might increase code
        // size, but it's important to fold numeric constants inside enums since
        // that's what the TypeScript compiler does.
        let old_should_fold_typescript_constant_expressions =
            p.should_fold_typescript_constant_expressions;
        p.should_fold_typescript_constant_expressions = true;

        // Create an assignment for each enum value
        for value in values.iter_mut() {
            let name: &'a [u8] = value.name.slice();

            let mut has_string_value = false;
            if let Some(enum_value) = value.value {
                next_numeric_value = None;

                let mut visited = enum_value;
                p.visit_expr(&mut visited);

                // "See through" any wrapped comments
                let underlying_value = if let js_ast::ExprData::EInlinedEnum(ie) = visited.data {
                    ie.value
                } else {
                    visited
                };
                value.value = Some(underlying_value);

                match underlying_value.data {
                    js_ast::ExprData::ENumber(num) => {
                        exported_members.get_ptr_mut(name).unwrap().data =
                            js_ast::ts::Data::EnumNumber(num.value);

                        p.ref_to_ts_namespace_member
                            .insert(value.ref_, js_ast::ts::Data::EnumNumber(num.value));

                        next_numeric_value = Some(num.value + 1.0);
                    }
                    js_ast::ExprData::EString(str_) => {
                        has_string_value = true;

                        exported_members.get_ptr_mut(name).unwrap().data =
                            js_ast::ts::Data::EnumString(str_);

                        p.ref_to_ts_namespace_member
                            .insert(value.ref_, js_ast::ts::Data::EnumString(str_));
                    }
                    _ => {
                        if visited.known_primitive() == js_ast::expr::PrimitiveType::String {
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

                exported_members.get_ptr_mut(name).unwrap().data =
                    js_ast::ts::Data::EnumNumber(num);

                p.ref_to_ts_namespace_member
                    .insert(value.ref_, js_ast::ts::Data::EnumNumber(num));
            } else {
                value.value = Some(p.new_expr(E::Undefined {}, value.loc));
            }

            let is_assign_target =
                p.options.features.minify_syntax && js_lexer::is_identifier(name);

            let name_as_e_string = if !is_assign_target || !has_string_value {
                Some(p.new_expr(value.name_as_e_string(p.arena), value.loc))
            } else {
                None
            };

            let assign_target = if is_assign_target {
                // "Enum.Name = value"
                Expr::assign(
                    p.new_expr(
                        E::Dot {
                            target: Expr::init_identifier(data.arg, value.loc),
                            name: name.into(),
                            name_loc: value.loc,
                            ..Default::default()
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
                            target: Expr::init_identifier(data.arg, value.loc),
                            index: name_as_e_string.unwrap(),
                            optional_chain: None,
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
                            target: Expr::init_identifier(data.arg, value.loc),
                            index: assign_target,
                            optional_chain: None,
                        },
                        value.loc,
                    ),
                    name_as_e_string.unwrap(),
                ));
                p.record_usage(data.arg);
            }
        }

        p.should_fold_typescript_constant_expressions =
            old_should_fold_typescript_constant_expressions;

        let mut value_stmts: StmtList<'a> = BumpVec::with_capacity_in(value_exprs.len(), p.arena);
        // Generate statements from expressions
        for expr in value_exprs.iter() {
            // PERF(port): was assume_capacity
            value_stmts.push(p.s(
                S::SExpr {
                    value: *expr,
                    ..Default::default()
                },
                expr.loc,
            ));
        }
        drop(value_exprs);
        p.generate_closure_for_type_script_namespace_or_enum(
            stmts,
            stmt.loc,
            data.is_export,
            data.name.loc,
            data.name.ref_.expect("infallible: ref bound"),
            data.arg,
            value_stmts.into_bump_slice_mut(),
            all_values_are_pure,
        )?;
        p.pop_scope();
        Ok(())
    }

    fn s_namespace(
        p: &mut Self,
        stmts: &mut StmtList<'a>,
        stmt: &mut Stmt,
        data: &mut S::Namespace,
    ) -> Result<(), Error> {
        p.record_declared_symbol(data.name.ref_.expect("infallible: ref bound"));

        // Scan ahead for any variables inside this namespace. This must be done
        // ahead of time before visiting any statements inside the namespace
        // because we may end up visiting the uses before the declarations.
        // We need to convert the uses into property accesses on the namespace.
        let child_stmts: &[Stmt] = data.stmts.slice();
        for child_stmt in child_stmts.iter() {
            if let StmtData::SLocal(local) = child_stmt.data {
                if local.is_export {
                    p.mark_exported_decls_inside_namespace(data.arg, local.decls.slice());
                }
            }
        }

        let mut prepend_temp_refs = PrependTempRefsOpts {
            kind: StmtsKind::FnBody,
            ..Default::default()
        };
        let mut prepend_list = stmts_to_list(p.arena, data.stmts);

        let old_enclosing_namespace_arg_ref = p.enclosing_namespace_arg_ref;
        p.enclosing_namespace_arg_ref = Some(data.arg);
        p.push_scope_for_visit_pass(js_ast::scope::Kind::Entry, stmt.loc)
            .expect("unreachable");
        p.record_declared_symbol(data.arg);
        p.visit_stmts_and_prepend_temp_refs(&mut prepend_list, &mut prepend_temp_refs)?;
        p.pop_scope();
        p.enclosing_namespace_arg_ref = old_enclosing_namespace_arg_ref;

        p.generate_closure_for_type_script_namespace_or_enum(
            stmts,
            stmt.loc,
            data.is_export,
            data.name.loc,
            data.name.ref_.expect("infallible: ref bound"),
            data.arg,
            prepend_list.into_bump_slice_mut(),
            false,
        )?;
        Ok(())
    }
}
