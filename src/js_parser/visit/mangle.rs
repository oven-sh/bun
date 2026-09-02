//! Statement-level syntax minification. Ports of esbuild's `mangleStmts`,
//! `mangleIf`, `mangleFor`, and of the conditional-expression folding
//! (`MangleIfExpr`) the statement passes build on.
//!
//! `mangle_stmts` is the tail of `visit_stmts`: it runs once every statement in
//! a list has been visited, so every branch and loop body it looks at has
//! already been mangled. The passes that merge or restructure statements check
//! `P::full_minify_syntax()`; the ones that only fold constants run whenever
//! `minify_syntax` is on.

use crate::p::P;
use crate::parser::{StmtsKind, statement_cares_about_scope};
use crate::scan::scan_side_effects::SideEffects;
use bun_alloc::{Arena as Bump, ArenaVec as BumpVec, ArenaVecExt as _};
use bun_ast::b::B as BData;
use bun_ast::expr::{Equality, StrictEql};
use bun_ast::s::{Kind as LocalKind, LocalOrigin};
use bun_ast::{
    E, Expr, ExprData, G, Loc, OpCode, OptionalChain, Ref, S, Stmt, StmtData, StoreRef, StoreSlice,
    Symbol,
};
use bun_collections::VecExt;

type ListManaged<'bump, T> = BumpVec<'bump, T>;

impl<'a, const TYPESCRIPT: bool, const SCAN_ONLY: bool> P<'a, TYPESCRIPT, SCAN_ONLY> {
    /// Merge and simplify a list of visited statements. Port of esbuild's
    /// `mangleStmts`. The caller checks `minify_syntax` and
    /// `dead_code_elimination`.
    pub(crate) fn mangle_stmts(
        &mut self,
        mut stmts: ListManaged<'a, Stmt>,
        kind: StmtsKind,
    ) -> ListManaged<'a, Stmt> {
        let p = self;

        // SAFETY: current_scope is a valid arena ptr for the parse.
        if p.current_scope().parent.is_some() && !p.current_scope().contains_direct_eval {
            // Remove inlined constants now that we know whether any of these statements
            // contained a direct eval() or not. This can't be done earlier when we
            // encounter the constant because we haven't encountered the eval() yet.
            // Inlined constants are not removed if they are in a top-level scope or
            // if they are exported (which could be in a nested TypeScript namespace).
            if p.const_values.count() > 0 {
                let items: &mut [Stmt] = stmts.as_mut_slice();
                for stmt in items.iter_mut() {
                    match stmt.data {
                        StmtData::SEmpty(_)
                        | StmtData::SComment(_)
                        | StmtData::SDirective(_)
                        | StmtData::SDebugger(_)
                        | StmtData::STypeScript(_) => continue,
                        StmtData::SLocal(mut local) => {
                            // "using" / "await using" declarations have disposal
                            // side-effects on scope exit. Their refs can end up in
                            // `const_values` via the macro path in `visitDecl`
                            // (`could_be_macro`), so skip them here to avoid
                            // silently dropping the declaration.
                            if local.kind.is_using() {
                                continue;
                            }
                            if !local.is_export && !local.origin.is_commonjs_export() {
                                let mut any_decl_in_const_values = local.kind == LocalKind::KConst;
                                let decls: &mut [G::Decl] = local.decls.slice_mut();
                                let mut end: usize = 0;
                                for idx in 0..decls.len() {
                                    if let BData::BIdentifier(id_ptr) = decls[idx].binding.data {
                                        let id_ref = id_ptr.r#ref;
                                        if p.const_values.contains(&id_ref) {
                                            any_decl_in_const_values = true;
                                            let symbol = &p.symbols[id_ref.inner_index() as usize];
                                            if symbol.use_count_estimate == 0 {
                                                // Skip declarations that are constants with zero usage
                                                continue;
                                            }
                                        }
                                    }
                                    // `Decl` is field-wise `Copy` but lacks the
                                    // derive; `swap` compacts in place (idx >= end always).
                                    decls.swap(end, idx);
                                    end += 1;
                                }
                                local.decls.truncate(end);
                                if any_decl_in_const_values {
                                    if end == 0 {
                                        *stmt = stmt.to_empty();
                                    }
                                    continue;
                                }
                            }
                        }
                        _ => {}
                    }

                    // Break after processing relevant statements
                    break;
                }
            }
        }

        let full = p.full_minify_syntax();
        let mut is_control_flow_dead = false;

        let mut output: ListManaged<'a, Stmt> = ListManaged::with_capacity_in(stmts.len(), p.arena);

        for i in 0..stmts.len() {
            let stmt = stmts[i];
            if is_control_flow_dead
                && !SideEffects::should_keep_stmt_in_dead_control_flow(stmt, p.arena)
            {
                // Strip unnecessary statements if the control flow is dead here
                continue;
            }

            // Inline single-use variable declarations where possible:
            //
            //   // Before
            //   let x = fn();
            //   return x.y();
            //
            //   // After
            //   return fn().y();
            //
            // The declaration must not be exported. We can't just check for the
            // "export" keyword because something might do "export {id};" later on.
            // Instead we just ignore all top-level declarations for now. That means
            // this optimization currently only applies in nested scopes.
            //
            // Ignore declarations if the scope is shadowed by a direct "eval" call.
            // The eval'd code may indirectly reference this symbol and the actual
            // use count may be greater than 1.
            // SAFETY: current_scope is a valid arena ptr for the parse.
            if p.current_scope != p.module_scope && !p.current_scope().contains_direct_eval {
                // Keep inlining variables until a failure or until there are none left.
                // That handles cases like this:
                //
                //   // Before
                //   let x = fn();
                //   let y = x.prop;
                //   return y;
                //
                //   // After
                //   return fn().prop;
                //
                'inner: while output.len() > 0 {
                    // Ignore "var" declarations since those have function-level scope and
                    // we may not have visited all of their uses yet by this point. We
                    // should have visited all the uses of "let" and "const" declarations
                    // by now since they are scoped to this block which we just finished
                    // visiting.
                    let prev_idx = output.len() - 1;
                    // borrowck: read the `StoreRef` (Copy) first, then re-borrow
                    // `output` only when truncating.
                    let StmtData::SLocal(mut local) = output[prev_idx].data else {
                        break;
                    };
                    // "using" / "await using" declarations have disposal
                    // side-effects on scope exit, so they must not be
                    // removed by inlining their initializer into the use.
                    if local.decls.len_u32() == 0
                        || local.kind == LocalKind::KVar
                        || local.kind.is_using()
                        || local.is_export
                    {
                        break;
                    }

                    // The variable must be initialized, since we will be substituting
                    // the value into the usage.
                    let last_idx = (local.decls.len_u32() - 1) as usize;
                    let last: &mut G::Decl = &mut local.decls.slice_mut()[last_idx];
                    let Some(replacement) = last.value else { break };

                    // The binding must be an identifier that is only used once.
                    // Ignore destructuring bindings since that's not the simple case.
                    // Destructuring bindings could potentially execute side-effecting
                    // code which would invalidate reordering.
                    let BData::BIdentifier(ident_ptr) = last.binding.data else {
                        break;
                    };
                    let id = ident_ptr.r#ref;

                    let symbol: &Symbol = &p.symbols[id.inner_index() as usize];

                    // Try to substitute the identifier with the initializer. This will
                    // fail if something with side effects is in between the declaration
                    // and the usage.
                    if symbol.use_count_estimate == 1
                        && p.substitute_single_use_symbol_in_stmt(stmt, id, replacement)
                    {
                        // `const ns = await import(x); return ns` — the single use just
                        // moved into `replacement`; unless it was an accounted-for read
                        // (`f(ns.a)`), the namespace escapes there.
                        if p.dynamic_import_namespace_locals.contains_key(&id)
                            && p.namespace_tracked_uses.get(&id).copied().unwrap_or(0) == 0
                        {
                            // Read as "more uses than accounted for" when finalizing.
                            p.namespace_tracked_uses.insert(id, u32::MAX);
                        }
                        match local.decls.len_u32() {
                            1 => {
                                local.decls.clear();
                                let new_len = output.len() - 1;
                                output.truncate(new_len);
                                continue 'inner;
                            }
                            _ => {
                                let n = local.decls.len() - 1;
                                local.decls.truncate(n);
                                continue 'inner;
                            }
                        }
                    }
                    break;
                }
            }

            // don't merge super calls to ensure they are called before "this" is accessed
            if stmt.is_super_call() {
                output.push(stmt);
                continue;
            }

            match stmt.data {
                StmtData::SEmpty(_) => continue,

                // skip directives for now
                StmtData::SDirective(_) => continue,

                StmtData::SLocal(local) => {
                    // Merge adjacent local statements
                    if output.len() > 0 {
                        let prev_idx = output.len() - 1;
                        let prev_stmt = &mut output[prev_idx];
                        if let StmtData::SLocal(mut prev_local) = prev_stmt.data {
                            if local.can_merge_with(&prev_local) {
                                append_decls(&mut prev_local.decls, local.decls.slice());
                                continue;
                            }
                        }
                    }
                }

                StmtData::SExpr(s_expr) => {
                    // Merge adjacent expression statements
                    if output.len() > 0 {
                        let prev_idx = output.len() - 1;
                        let prev_stmt = &mut output[prev_idx];
                        if let StmtData::SExpr(mut prev_expr) = prev_stmt.data {
                            if !prev_stmt.is_super_call() && full {
                                prev_expr.does_not_affect_tree_shaking = prev_expr
                                    .does_not_affect_tree_shaking
                                    && s_expr.does_not_affect_tree_shaking;
                                prev_expr.value =
                                    Expr::join_with_comma(prev_expr.value, s_expr.value);
                                continue;
                            }
                        } else if let StmtData::SLocal(prev_local) = prev_stmt.data {
                            //
                            // Input:
                            //      var f;
                            //      f = 123;
                            // Output:
                            //      var f = 123;
                            //
                            // This doesn't handle every case. Only the very simple one.
                            if let ExprData::EBinary(bin_assign) = s_expr.value.data {
                                if prev_local.decls.len_u32() == 1
                                    && bin_assign.op == OpCode::BinAssign
                                    // we can only do this with var because var is hoisted
                                    // the statement we are merging into may use the statement before its defined.
                                    && prev_local.kind == LocalKind::KVar
                                {
                                    if let ExprData::EIdentifier(left_id) = bin_assign.left.data {
                                        // `prev_local` is a `StoreRef` (Copy) so
                                        // re-slicing here writes through to the arena slot.
                                        let mut prev_local = prev_local;
                                        let decl = &mut prev_local.decls.slice_mut()[0];
                                        if let BData::BIdentifier(bid_ptr) = decl.binding.data {
                                            let bid_ref = bid_ptr.r#ref;
                                            if bid_ref.eql(left_id.ref_)
                                                // If the value was assigned, we shouldn't merge it incase it was used in the current statement
                                                // https://github.com/oven-sh/bun/issues/2948
                                                // We don't have a more granular way to check symbol usage so this is the best we can do
                                                && decl.value.is_none()
                                            {
                                                decl.value = Some(bin_assign.right);
                                                p.ignore_usage(left_id.ref_);
                                                continue;
                                            }
                                        }
                                    }
                                }
                            }
                        }
                    }
                }
                StmtData::SSwitch(mut s_switch) => {
                    // Absorb a previous expression statement
                    if output.len() > 0 && full {
                        let prev_idx = output.len() - 1;
                        let prev_stmt = output[prev_idx];
                        if let StmtData::SExpr(prev_expr) = prev_stmt.data {
                            if !prev_stmt.is_super_call() {
                                s_switch.test =
                                    Expr::join_with_comma(prev_expr.value, s_switch.test);
                                output.truncate(prev_idx);
                            }
                        }
                    }
                }
                StmtData::SIf(mut s_if) => {
                    // Absorb a previous expression statement
                    if output.len() > 0 && full {
                        let prev_idx = output.len() - 1;
                        let prev_stmt = output[prev_idx];
                        if let StmtData::SExpr(prev_expr) = prev_stmt.data {
                            if !prev_stmt.is_super_call() {
                                s_if.test = Expr::join_with_comma(prev_expr.value, s_if.test);
                                output.truncate(prev_idx);
                            }
                        }
                    }

                    if full && is_jump_statement(s_if.yes.data) {
                        // Absorb a previous if statement
                        if let Some(&prev_stmt) = output.last() {
                            if let StmtData::SIf(prev_if) = prev_stmt.data {
                                if prev_if.no.is_none()
                                    && p.jump_stmts_look_the_same(prev_if.yes.data, s_if.yes.data)
                                {
                                    // "if (a) break c; if (b) break c;" => "if (a || b) break c;"
                                    // "if (a) continue c; if (b) continue c;" => "if (a || b) continue c;"
                                    // "if (a) return c; if (b) return c;" => "if (a || b) return c;"
                                    // "if (a) throw c; if (b) throw c;" => "if (a || b) throw c;"
                                    s_if.test = Expr::join_with_left_associative_op(
                                        OpCode::BinLogicalOr,
                                        prev_if.test,
                                        s_if.test,
                                    );
                                    let new_len = output.len() - 1;
                                    output.truncate(new_len);
                                }
                            }
                        }

                        // "while (x) { if (y) continue; z(); }" => "while (x) { if (!y) z(); }"
                        // "while (x) { if (y) continue; else z(); w(); }" => "while (x) { if (!y) { z(); w(); } }" => "for (; x;) !y && (z(), w());"
                        //
                        // "let x = () => { if (y) return; z(); };" => "let x = () => { if (!y) z(); };"
                        // "let x = () => { if (y) return; else z(); w(); };" => "let x = () => { if (!y) { z(); w(); } };" => "let x = () => { !y && (z(), w()); };"
                        let optimize_implicit_jump = match (kind, s_if.yes.data) {
                            (StmtsKind::LoopBody, StmtData::SContinue(c)) => c.label.is_none(),
                            (StmtsKind::FnBody, StmtData::SReturn(r)) => r.value.is_none(),
                            _ => false,
                        };

                        if optimize_implicit_jump && p.stack_check.is_safe_to_recurse() {
                            let mut body: ListManaged<'a, Stmt> =
                                ListManaged::with_capacity_in(1 + stmts.len() - i, p.arena);
                            if let Some(no) = s_if.no {
                                body.push(no);
                            }
                            body.extend_from_slice(&stmts[i + 1..]);

                            // Don't do this transformation if the branch condition could
                            // potentially access symbols declared later on this scope below.
                            // If so, inverting the branch condition and nesting statements after
                            // this in a block would break that access which is a behavior change.
                            //
                            //   // This transformation is incorrect
                            //   if (a()) return; function a() {}
                            //   if (!a()) { function a() {} }
                            //
                            //   // This transformation is incorrect
                            //   if (a(() => b)) return; let b;
                            //   if (a(() => b)) { let b; }
                            //
                            if !stmts_care_about_scope(&body) {
                                let body = p.mangle_stmts(body, kind);
                                let body_loc = body.first().map_or(s_if.yes.loc, |s| s.loc);
                                let test = SideEffects::simplify_boolean(p, s_if.test.not(p.arena));
                                let yes =
                                    p.stmts_to_single_stmt(body_loc, body.into_bump_slice_mut());
                                let new_if = p.s(
                                    S::If {
                                        test,
                                        yes,
                                        no: None,
                                    },
                                    stmt.loc,
                                );
                                let StmtData::SIf(new_if_ref) = new_if.data else {
                                    unreachable!()
                                };
                                p.mangle_if(&mut output, stmt.loc, new_if_ref);
                                return output;
                            }
                        }

                        if s_if.no.is_some() {
                            // "if (a) return b; else if (c) return d; else return e;" => "if (a) return b; if (c) return d; return e;"
                            let mut cur_stmt = stmt;
                            let mut cur_if = s_if;
                            loop {
                                output.push(cur_stmt);
                                cur_stmt = cur_if.no.take().expect("checked above");
                                let StmtData::SIf(next_if) = cur_stmt.data else {
                                    break;
                                };
                                if !is_jump_statement(next_if.yes.data) || next_if.no.is_none() {
                                    break;
                                }
                                cur_if = next_if;
                            }
                            p.append_if_body_preserving_scope(&mut output, cur_stmt);
                            if is_jump_statement(cur_stmt.data) {
                                is_control_flow_dead = true;
                            }
                            continue;
                        }
                    }
                }

                StmtData::SReturn(mut ret) => {
                    // Merge return statements with the previous expression statement
                    if output.len() > 0 && ret.value.is_some() && full {
                        let prev_idx = output.len() - 1;
                        let prev_stmt = output[prev_idx];
                        if let StmtData::SExpr(prev_expr) = prev_stmt.data {
                            if !prev_stmt.is_super_call() {
                                ret.value = Some(Expr::join_with_comma(
                                    prev_expr.value,
                                    ret.value.unwrap(),
                                ));
                                output[prev_idx] = stmt;
                                continue;
                            }
                        }
                    }

                    is_control_flow_dead = true;
                }

                StmtData::SBreak(_) | StmtData::SContinue(_) => {
                    is_control_flow_dead = true;
                }

                StmtData::SThrow(s_throw) => {
                    // Merge throw statements with the previous expression statement
                    if output.len() > 0 && full {
                        let prev_idx = output.len() - 1;
                        let prev_stmt = output[prev_idx];
                        if let StmtData::SExpr(prev_expr) = prev_stmt.data {
                            if !prev_stmt.is_super_call() {
                                output[prev_idx] = p.s(
                                    S::Throw {
                                        value: Expr::join_with_comma(
                                            prev_expr.value,
                                            s_throw.value,
                                        ),
                                    },
                                    stmt.loc,
                                );
                                continue;
                            }
                        }
                    }

                    is_control_flow_dead = true;
                }

                StmtData::SFor(mut s_for) if full => {
                    if let Some(&prev_stmt) = output.last() {
                        let prev_idx = output.len() - 1;
                        if let StmtData::SExpr(prev_expr) = prev_stmt.data {
                            if !prev_stmt.is_super_call() {
                                // Insert the previous expression into the for loop initializer
                                match s_for.init {
                                    None => {
                                        s_for.init = Some(p.s(
                                            S::SExpr {
                                                value: prev_expr.value,
                                                ..Default::default()
                                            },
                                            prev_stmt.loc,
                                        ));
                                        output[prev_idx] = stmt;
                                        continue;
                                    }
                                    Some(init) => {
                                        if let StmtData::SExpr(init_expr) = init.data {
                                            s_for.init = Some(p.s(
                                                S::SExpr {
                                                    value: Expr::join_with_comma(
                                                        prev_expr.value,
                                                        init_expr.value,
                                                    ),
                                                    ..Default::default()
                                                },
                                                prev_stmt.loc,
                                            ));
                                            output[prev_idx] = stmt;
                                            continue;
                                        }
                                    }
                                }
                            }
                        } else if let StmtData::SLocal(mut prev_local) = prev_stmt.data {
                            // Insert the previous variable declaration into the for loop
                            // initializer if it's a "var" declaration, since the scope
                            // doesn't matter due to scope hoisting
                            if prev_local.kind == LocalKind::KVar
                                && !prev_local.is_export
                                && prev_local.origin == LocalOrigin::Normal
                            {
                                match s_for.init {
                                    None => {
                                        s_for.init = Some(prev_stmt);
                                        output[prev_idx] = stmt;
                                        continue;
                                    }
                                    Some(init) => {
                                        if let StmtData::SLocal(init_local) = init.data
                                            && init_local.kind == LocalKind::KVar
                                            && init_local.origin == LocalOrigin::Normal
                                        {
                                            append_decls(
                                                &mut prev_local.decls,
                                                init_local.decls.slice(),
                                            );
                                            s_for.init = Some(prev_stmt);
                                            output[prev_idx] = stmt;
                                            continue;
                                        }
                                    }
                                }
                            }
                        }
                    }
                }

                StmtData::STry(mut s_try) if full => {
                    // Drop an unused identifier binding: "try { x() } catch (y) {}" => "try { x() } catch {}"
                    if let Some(catch) = &mut s_try.catch
                        && let Some(binding) = catch.binding
                        && let BData::BIdentifier(id) = binding.data
                    {
                        let symbol = &p.symbols[id.r#ref.inner_index() as usize];
                        // We cannot transform "try { x() } catch (y) { var y = 1 }" into
                        // "try { x() } catch { var y = 1 }" even though "y" is never used
                        // because the hoisted variable "y" would have different values
                        // after the statement ends due to a strange JavaScript quirk:
                        //
                        //   try { x() } catch (y) { var y = 1 }
                        //   console.log(y) // undefined
                        //
                        //   try { x() } catch { var y = 1 }
                        //   console.log(y) // 1
                        //
                        // We also cannot transform "try { x() } catch (y) { eval('z = y') }"
                        // into "try { x() } catch { eval('z = y') }" because the variable
                        // "y" is actually still used.
                        // SAFETY: current_scope is a valid arena ptr for the parse.
                        if symbol.use_count_estimate == 0
                            && symbol.link.get() == Ref::NONE
                            && !p.current_scope().contains_direct_eval
                        {
                            catch.binding = None;
                        }
                    }
                }

                _ => {}
            }

            output.push(stmt);
        }

        if !full {
            return output;
        }

        // Drop a trailing unconditional jump statement if applicable
        if let Some(&last) = output.last() {
            let last_idx = output.len() - 1;
            match kind {
                StmtsKind::LoopBody => {
                    // "while (x) { y(); continue; }" => "while (x) { y(); }"
                    if let StmtData::SContinue(c) = last.data
                        && c.label.is_none()
                    {
                        output.truncate(last_idx);
                    }
                }
                StmtsKind::FnBody => {
                    if let StmtData::SReturn(ret) = last.data {
                        match ret.value {
                            // "function f() { x(); return; }" => "function f() { x(); }"
                            None => output.truncate(last_idx),
                            // "function f() { return void x(); }" => "function f() { x(); }"
                            Some(value) => {
                                if let ExprData::EUnary(unary) = value.data
                                    && unary.op == OpCode::UnVoid
                                {
                                    output[last_idx] = p.s(
                                        S::SExpr {
                                            value: unary.value,
                                            ..Default::default()
                                        },
                                        last.loc,
                                    );
                                }
                            }
                        }
                    }
                }
                _ => {}
            }
        }

        // Merge certain statements in reverse order
        if output.len() >= 2 {
            let last_stmt = output[output.len() - 1];
            if let StmtData::SReturn(last_return) = last_stmt.data {
                // "if (a) return b; if (c) return d; return e;" => "return a ? b : c ? d : e;"
                let mut last_loc = last_stmt.loc;
                let mut last_value = last_return.value;
                while output.len() >= 2 {
                    let prev_index = output.len() - 2;
                    let prev_stmt = output[prev_index];
                    match prev_stmt.data {
                        StmtData::SExpr(prev_expr) => {
                            // This return statement must have a value
                            let Some(value) = last_value else { break };
                            if prev_stmt.is_super_call() {
                                break;
                            }
                            // "a(); return b;" => "return a(), b;"
                            last_value = Some(Expr::join_with_comma(prev_expr.value, value));
                        }
                        StmtData::SIf(mut prev_if) => {
                            // The previous statement must be an if statement with no else clause
                            if prev_if.no.is_some() {
                                break;
                            }
                            // The then clause must be a return
                            let StmtData::SReturn(prev_return) = prev_if.yes.data else {
                                break;
                            };

                            // Handle some or all of the values being undefined
                            // "if (a) return; return b;" => "return a ? void 0 : b;"
                            let mut left = prev_return
                                .value
                                .unwrap_or_else(|| p.new_expr(E::Undefined {}, prev_if.yes.loc));
                            // "if (a) return a; return;" => "return a ? b : void 0;"
                            let mut right =
                                last_value.unwrap_or_else(|| p.new_expr(E::Undefined {}, last_loc));

                            // "if (!a) return b; return c;" => "return a ? c : b;"
                            if let ExprData::EUnary(not) = prev_if.test.data
                                && not.op == OpCode::UnNot
                            {
                                prev_if.test = not.value;
                                core::mem::swap(&mut left, &mut right);
                            }

                            last_value = Some(p.mangle_test_to_if_expr(prev_if.test, left, right));
                        }
                        _ => break,
                    }

                    // Merge the last two statements
                    last_loc = prev_stmt.loc;
                    output[prev_index] = p.s(S::Return { value: last_value }, last_loc);
                    let new_len = output.len() - 1;
                    output.truncate(new_len);
                }
            } else if let StmtData::SThrow(last_throw) = last_stmt.data {
                // "if (a) throw b; if (c) throw d; throw e;" => "throw a ? b : c ? d : e;"
                let mut last_value = last_throw.value;
                while output.len() >= 2 {
                    let prev_index = output.len() - 2;
                    let prev_stmt = output[prev_index];
                    match prev_stmt.data {
                        StmtData::SExpr(prev_expr) => {
                            if prev_stmt.is_super_call() {
                                break;
                            }
                            // "a(); throw b;" => "throw a(), b;"
                            last_value = Expr::join_with_comma(prev_expr.value, last_value);
                        }
                        StmtData::SIf(mut prev_if) => {
                            // The previous statement must be an if statement with no else clause
                            if prev_if.no.is_some() {
                                break;
                            }
                            // The then clause must be a throw
                            let StmtData::SThrow(prev_throw) = prev_if.yes.data else {
                                break;
                            };

                            let mut left = prev_throw.value;
                            let mut right = last_value;

                            // "if (!a) throw b; throw c;" => "throw a ? c : b;"
                            if let ExprData::EUnary(not) = prev_if.test.data
                                && not.op == OpCode::UnNot
                            {
                                prev_if.test = not.value;
                                core::mem::swap(&mut left, &mut right);
                            }

                            last_value = p.mangle_test_to_if_expr(prev_if.test, left, right);
                        }
                        _ => break,
                    }

                    // Merge the last two statements
                    output[prev_index] = p.s(S::Throw { value: last_value }, prev_stmt.loc);
                    let new_len = output.len() - 1;
                    output.truncate(new_len);
                }
            }
        }

        output
    }

    /// `test ? yes : no` for the return and throw chains above.
    /// "if (a, b) return c; return d;" => "return a, b ? c : d;"
    fn mangle_test_to_if_expr(&mut self, test: Expr, yes: Expr, no: Expr) -> Expr {
        if let ExprData::EBinary(comma) = test.data
            && comma.op == OpCode::BinComma
        {
            let e_if = self.new_expr(
                E::If {
                    test: comma.right,
                    yes,
                    no,
                },
                comma.right.loc,
            );
            let ExprData::EIf(e_if_ref) = e_if.data else {
                unreachable!()
            };
            let mangled = self.mangle_if_expr(comma.right.loc, e_if_ref);
            return Expr::join_with_comma(comma.left, mangled);
        }
        let e_if = self.new_expr(E::If { test, yes, no }, test.loc);
        let ExprData::EIf(e_if_ref) = e_if.data else {
            unreachable!()
        };
        self.mangle_if_expr(test.loc, e_if_ref)
    }

    /// Append the body of an `if` branch or a label without changing what the
    /// block scopes. Port of esbuild's `appendIfOrLabelBodyPreservingScope`.
    pub(crate) fn append_if_body_preserving_scope(
        &mut self,
        stmts: &mut ListManaged<'a, Stmt>,
        body: Stmt,
    ) {
        if let StmtData::SBlock(block) = body.data {
            let block_stmts: &[Stmt] = block.stmts.slice();
            if !stmts_care_about_scope(block_stmts) {
                stmts.extend_from_slice(block_stmts);
                return;
            }
        }

        if statement_cares_about_scope(&body) {
            let block_stmts = self.arena.alloc_slice_copy(&[body]);
            stmts.push(self.s(
                S::Block {
                    stmts: block_stmts.into(),
                    close_brace_loc: Loc::EMPTY,
                },
                body.loc,
            ));
            return;
        }

        stmts.push(body);
    }

    /// Simplify a visited `if` statement and append the result. Port of
    /// esbuild's `mangleIf`. The caller checks `minify_syntax`.
    pub(crate) fn mangle_if(
        &mut self,
        stmts: &mut ListManaged<'a, Stmt>,
        loc: Loc,
        mut s: StoreRef<S::If>,
    ) {
        let p = self;
        let full = p.full_minify_syntax();

        // Constant folding using the test expression
        if let Some(known) = SideEffects::to_boolean(p, &s.test.data) {
            if known.value {
                // The test is truthy
                if s.no.is_none_or(|no| {
                    !SideEffects::should_keep_stmt_in_dead_control_flow(no, p.arena)
                }) {
                    // We can drop the "no" branch
                    if known.side_effects == SideEffects::CouldHaveSideEffects {
                        // Keep the condition if it could have side effects (but is still known to be truthy)
                        if let Some(test) = SideEffects::simplify_unused_expr(p, s.test) {
                            stmts.push(p.s(
                                S::SExpr {
                                    value: test,
                                    ..Default::default()
                                },
                                test.loc,
                            ));
                        }
                    }
                    p.append_if_body_preserving_scope(stmts, s.yes);
                    return;
                }
                // We have to keep the "no" branch
            } else {
                // The test is falsy
                if !SideEffects::should_keep_stmt_in_dead_control_flow(s.yes, p.arena) {
                    // We can drop the "yes" branch
                    if known.side_effects == SideEffects::CouldHaveSideEffects {
                        // Keep the condition if it could have side effects (but is still known to be falsy)
                        if let Some(test) = SideEffects::simplify_unused_expr(p, s.test) {
                            stmts.push(p.s(
                                S::SExpr {
                                    value: test,
                                    ..Default::default()
                                },
                                test.loc,
                            ));
                        }
                    }
                    if let Some(no) = s.no {
                        p.append_if_body_preserving_scope(stmts, no);
                    }
                    return;
                }
                // We have to keep the "yes" branch
            }

            // Use "1" and "0" instead of "true" and "false" to be shorter
            if full && known.side_effects == SideEffects::NoSideEffects {
                s.test = p.new_expr(
                    E::Number::new(if known.value { 1.0 } else { 0.0 }),
                    s.test.loc,
                );
            }
        }

        // `s_expr` drops an expression statement without side effects, so an
        // emptied branch is an `SEmpty`. An `SExpr` with a missing value is the
        // same thing to the passes below.
        let yes_is_empty = matches!(s.yes.data, StmtData::SEmpty(_)) || s.yes.is_missing_expr();

        if !full {
            // "if (a) {}" => "" and "if (a) {} else {}" => "" when the test has no side effects
            if yes_is_empty
                && s.no.is_none_or(|no| no.is_missing_expr())
                && p.expr_can_be_removed_if_unused(&s.test)
            {
                return;
            }
            stmts.push(Stmt {
                loc,
                data: StmtData::SIf(s),
            });
            return;
        }

        let mut expr: Option<Expr> = None;

        if let StmtData::SExpr(yes) = s.yes.data
            && !yes_is_empty
        {
            // "yes" is an expression
            match s.no {
                None => {
                    if let ExprData::EUnary(not) = s.test.data
                        && not.op == OpCode::UnNot
                    {
                        // "if (!a) b();" => "a || b();"
                        expr = Some(Expr::join_with_left_associative_op(
                            OpCode::BinLogicalOr,
                            not.value,
                            yes.value,
                        ));
                    } else {
                        // "if (a) b();" => "a && b();"
                        expr = Some(Expr::join_with_left_associative_op(
                            OpCode::BinLogicalAnd,
                            s.test,
                            yes.value,
                        ));
                    }
                }
                Some(no) => {
                    if let StmtData::SExpr(no_expr) = no.data {
                        // "if (a) b(); else c();" => "a ? b() : c();"
                        let e_if = p.new_expr(
                            E::If {
                                test: s.test,
                                yes: yes.value,
                                no: no_expr.value,
                            },
                            loc,
                        );
                        let ExprData::EIf(e_if_ref) = e_if.data else {
                            unreachable!()
                        };
                        expr = Some(p.mangle_if_expr(loc, e_if_ref));
                    }
                }
            }
        } else if yes_is_empty {
            // "yes" is missing
            match s.no {
                None => {
                    // "yes" and "no" are both missing
                    if p.expr_can_be_removed_if_unused(&s.test) {
                        // "if (1) {}" => ""
                        return;
                    }
                    // "if (a) {}" => "a;"
                    expr = Some(s.test);
                }
                Some(no) => {
                    if let StmtData::SExpr(no_expr) = no.data {
                        if let ExprData::EUnary(not) = s.test.data
                            && not.op == OpCode::UnNot
                        {
                            // "if (!a) {} else b();" => "a && b();"
                            expr = Some(Expr::join_with_left_associative_op(
                                OpCode::BinLogicalAnd,
                                not.value,
                                no_expr.value,
                            ));
                        } else {
                            // "if (a) {} else b();" => "a || b();"
                            expr = Some(Expr::join_with_left_associative_op(
                                OpCode::BinLogicalOr,
                                s.test,
                                no_expr.value,
                            ));
                        }
                    } else {
                        // "yes" is missing and "no" is not missing (and is not an expression)
                        if let ExprData::EUnary(not) = s.test.data
                            && not.op == OpCode::UnNot
                        {
                            // "if (!a) {} else throw b;" => "if (a) throw b;"
                            s.test = not.value;
                        } else {
                            // "if (a) {} else throw b;" => "if (!a) throw b;"
                            s.test = s.test.not(p.arena);
                        }
                        s.yes = no;
                        s.no = None;
                    }
                }
            }
        } else {
            // "yes" is not missing (and is not an expression)
            match s.no {
                Some(no) => {
                    // "yes" is not missing (and is not an expression) and "no" is not missing
                    if let ExprData::EUnary(not) = s.test.data
                        && not.op == OpCode::UnNot
                    {
                        // "if (!a) return b; else return c;" => "if (a) return c; else return b;"
                        s.test = not.value;
                        s.no = Some(s.yes);
                        s.yes = no;
                    }
                }
                None => {
                    // "no" is missing
                    if let StmtData::SIf(s2) = s.yes.data
                        && s2.no.is_none()
                    {
                        // "if (a) if (b) return c;" => "if (a && b) return c;"
                        s.test = Expr::join_with_left_associative_op(
                            OpCode::BinLogicalAnd,
                            s.test,
                            s2.test,
                        );
                        s.yes = s2.yes;
                    }
                }
            }
        }

        // Return an expression if we replaced the if statement with an expression above
        if let Some(expr) = expr {
            if let Some(expr) = SideEffects::simplify_unused_expr(p, expr) {
                stmts.push(p.s(
                    S::SExpr {
                        value: expr,
                        ..Default::default()
                    },
                    loc,
                ));
            }
            return;
        }

        stmts.push(Stmt {
            loc,
            data: StmtData::SIf(s),
        });
    }

    /// Rewrite a conditional expression into a shorter equivalent. Port of
    /// esbuild's `MangleIfExpr`. `e` is updated in place when the result is
    /// still a conditional.
    pub(crate) fn mangle_if_expr(&mut self, loc: Loc, mut e: StoreRef<E::If>) -> Expr {
        if !self.stack_check.is_safe_to_recurse() {
            return Expr {
                loc,
                data: ExprData::EIf(e),
            };
        }

        let mut test = e.test;
        let mut yes = e.yes;
        let mut no = e.no;

        // "(a, b) ? c : d" => "a, b ? c : d"
        if let ExprData::EBinary(comma) = test.data
            && comma.op == OpCode::BinComma
        {
            e.test = comma.right;
            let inner = self.mangle_if_expr(comma.right.loc, e);
            return Expr::join_with_comma(comma.left, inner);
        }

        // "!a ? b : c" => "a ? c : b"
        if let ExprData::EUnary(not) = test.data
            && not.op == OpCode::UnNot
        {
            test = not.value;
            core::mem::swap(&mut yes, &mut no);
        }

        if self.values_look_the_same(&yes.data, &no.data) {
            // "/* @__PURE__ */ a() ? b : b" => "b"
            if self.expr_can_be_removed_if_unused(&test) {
                return yes;
            }

            // "a ? b : b" => "a, b"
            return Expr::join_with_comma(test, yes);
        }

        // "a ? true : false" => "!!a"
        // "a ? false : true" => "!a"
        if let (
            ExprData::EBoolean(y) | ExprData::EBranchBoolean(y),
            ExprData::EBoolean(n) | ExprData::EBranchBoolean(n),
        ) = (yes.data, no.data)
        {
            if y.value && !n.value {
                return test.not(self.arena).not(self.arena);
            }
            if !y.value && n.value {
                return test.not(self.arena);
            }
        }

        if let ExprData::EIdentifier(id) = test.data {
            // "a ? a : b" => "a || b"
            if let ExprData::EIdentifier(id2) = yes.data
                && id.ref_ == id2.ref_
            {
                return Expr::join_with_left_associative_op(OpCode::BinLogicalOr, test, no);
            }

            // "a ? b : a" => "a && b"
            if let ExprData::EIdentifier(id2) = no.data
                && id.ref_ == id2.ref_
            {
                return Expr::join_with_left_associative_op(OpCode::BinLogicalAnd, test, yes);
            }
        }

        // "a ? b ? c : d : d" => "a && b ? c : d"
        if let ExprData::EIf(yes_if) = yes.data
            && self.values_look_the_same(&yes_if.no.data, &no.data)
        {
            e.test = Expr::join_with_left_associative_op(OpCode::BinLogicalAnd, test, yes_if.test);
            e.yes = yes_if.yes;
            e.no = no;
            return Expr {
                loc,
                data: ExprData::EIf(e),
            };
        }

        // "a ? b : c ? b : d" => "a || c ? b : d"
        if let ExprData::EIf(no_if) = no.data
            && self.values_look_the_same(&yes.data, &no_if.yes.data)
        {
            e.test = Expr::join_with_left_associative_op(OpCode::BinLogicalOr, test, no_if.test);
            e.yes = yes;
            e.no = no_if.no;
            return Expr {
                loc,
                data: ExprData::EIf(e),
            };
        }

        // "a ? c : (b, c)" => "(a || b), c"
        if let ExprData::EBinary(comma) = no.data
            && comma.op == OpCode::BinComma
            && self.values_look_the_same(&yes.data, &comma.right.data)
        {
            return Expr::join_with_comma(
                Expr::join_with_left_associative_op(OpCode::BinLogicalOr, test, comma.left),
                comma.right,
            );
        }

        // "a ? (b, c) : c" => "(a && b), c"
        if let ExprData::EBinary(comma) = yes.data
            && comma.op == OpCode::BinComma
            && self.values_look_the_same(&comma.right.data, &no.data)
        {
            return Expr::join_with_comma(
                Expr::join_with_left_associative_op(OpCode::BinLogicalAnd, test, comma.left),
                comma.right,
            );
        }

        // "a ? b || c : c" => "(a && b) || c"
        if let ExprData::EBinary(binary) = yes.data
            && binary.op == OpCode::BinLogicalOr
            && self.values_look_the_same(&binary.right.data, &no.data)
        {
            return Expr::init(
                E::Binary {
                    op: OpCode::BinLogicalOr,
                    left: Expr::join_with_left_associative_op(
                        OpCode::BinLogicalAnd,
                        test,
                        binary.left,
                    ),
                    right: binary.right,
                },
                loc,
            );
        }

        // "a ? c : b && c" => "(a || b) && c"
        if let ExprData::EBinary(binary) = no.data
            && binary.op == OpCode::BinLogicalAnd
            && self.values_look_the_same(&yes.data, &binary.right.data)
        {
            return Expr::init(
                E::Binary {
                    op: OpCode::BinLogicalAnd,
                    left: Expr::join_with_left_associative_op(
                        OpCode::BinLogicalOr,
                        test,
                        binary.left,
                    ),
                    right: binary.right,
                },
                loc,
            );
        }

        // "a ? b(c, d) : b(e, d)" => "b(a ? c : e, d)"
        if let ExprData::ECall(mut y) = yes.data
            && !y.args.is_empty()
            && let ExprData::ECall(n) = no.data
            && n.args.len() == y.args.len()
            && y.optional_chain == n.optional_chain
            && y.is_direct_eval == n.is_direct_eval
            && y.can_be_unwrapped_if_unused == n.can_be_unwrapped_if_unused
            && self.values_look_the_same(&y.target.data, &n.target.data)
            // Only do this if the condition can be reordered past the call target
            // without side effects. For example, if the test or the call target is
            // an unbound identifier, reordering could potentially mean evaluating
            // the code could throw a different ReferenceError.
            && self.expr_can_be_removed_if_unused(&test)
            && self.expr_can_be_removed_if_unused(&y.target)
        {
            let same_tail_args = (1..y.args.len())
                .all(|i| self.values_look_the_same(&y.args[i].data, &n.args[i].data));
            if same_tail_args {
                let y0 = y.args[0];
                let n0 = n.args[0];
                match (y0.data, n0.data) {
                    // "a ? b(...c) : b(...e)" => "b(...a ? c : e)"
                    (ExprData::ESpread(yes_spread), ExprData::ESpread(no_spread)) => {
                        e.test = test;
                        e.yes = yes_spread.value;
                        e.no = no_spread.value;
                        let inner = self.mangle_if_expr(loc, e);
                        y.args[0] = self.new_expr(E::Spread { value: inner }, loc);
                        return Expr {
                            loc,
                            data: ExprData::ECall(y),
                        };
                    }
                    (ExprData::ESpread(_), _) | (_, ExprData::ESpread(_)) => {}
                    // "a ? b(c) : b(e)" => "b(a ? c : e)"
                    _ => {
                        e.test = test;
                        e.yes = y0;
                        e.no = n0;
                        y.args[0] = self.mangle_if_expr(loc, e);
                        return Expr {
                            loc,
                            data: ExprData::ECall(y),
                        };
                    }
                }
            }
        }

        // Try using the "??" or "?." operators
        if let ExprData::EBinary(binary) = test.data {
            let (check, when_null, when_non_null) = match binary.op {
                OpCode::BinLooseEq => {
                    if matches!(binary.right.data, ExprData::ENull(_)) {
                        // "a == null ? _ : _"
                        (Some(binary.left), yes, no)
                    } else if matches!(binary.left.data, ExprData::ENull(_)) {
                        // "null == a ? _ : _"
                        (Some(binary.right), yes, no)
                    } else {
                        (None, yes, no)
                    }
                }
                OpCode::BinLooseNe => {
                    if matches!(binary.right.data, ExprData::ENull(_)) {
                        // "a != null ? _ : _"
                        (Some(binary.left), no, yes)
                    } else if matches!(binary.left.data, ExprData::ENull(_)) {
                        // "null != a ? _ : _"
                        (Some(binary.right), no, yes)
                    } else {
                        (None, yes, no)
                    }
                }
                _ => (None, yes, no),
            };

            if let Some(check) = check
                && self.expr_can_be_removed_if_unused(&check)
            {
                // "a != null ? a : b" => "a ?? b"
                if self.values_look_the_same(&check.data, &when_non_null.data) {
                    return Expr::join_with_left_associative_op(
                        OpCode::BinNullishCoalescing,
                        check,
                        when_null,
                    );
                }

                // "a != null ? a.b.c[d](e) : undefined" => "a?.b.c[d](e)"
                if matches!(when_null.data, ExprData::EUndefined(_))
                    && self.try_to_insert_optional_chain(check, when_non_null)
                {
                    return when_non_null;
                }
            }
        }

        e.test = test;
        e.yes = yes;
        e.no = no;
        Expr {
            loc,
            data: ExprData::EIf(e),
        }
    }

    /// Make `expr` an optional chain rooted at `test`: "a.b.c" => "a?.b.c"
    /// when `test` is "a". Port of esbuild's `TryToInsertOptionalChain`.
    pub(crate) fn try_to_insert_optional_chain(&mut self, test: Expr, expr: Expr) -> bool {
        if !self.stack_check.is_safe_to_recurse() {
            return false;
        }
        match expr.data {
            ExprData::EDot(mut e) => {
                if self.values_look_the_same(&test.data, &e.target.data) {
                    e.optional_chain = Some(OptionalChain::Start);
                    return true;
                }
                if self.try_to_insert_optional_chain(test, e.target) {
                    if e.optional_chain.is_none() {
                        e.optional_chain = Some(OptionalChain::Continuation);
                    }
                    return true;
                }
            }
            ExprData::EIndex(mut e) => {
                if self.values_look_the_same(&test.data, &e.target.data) {
                    e.optional_chain = Some(OptionalChain::Start);
                    return true;
                }
                if self.try_to_insert_optional_chain(test, e.target) {
                    if e.optional_chain.is_none() {
                        e.optional_chain = Some(OptionalChain::Continuation);
                    }
                    return true;
                }
            }
            ExprData::ECall(mut e) => {
                if self.values_look_the_same(&test.data, &e.target.data) {
                    e.optional_chain = Some(OptionalChain::Start);
                    return true;
                }
                if self.try_to_insert_optional_chain(test, e.target) {
                    if e.optional_chain.is_none() {
                        e.optional_chain = Some(OptionalChain::Continuation);
                    }
                    return true;
                }
            }
            _ => {}
        }
        false
    }

    /// True when two expressions are written the same way and evaluating
    /// either one gives the same value. Port of esbuild's `ValuesLookTheSame`.
    pub(crate) fn values_look_the_same(&mut self, left: &ExprData, right: &ExprData) -> bool {
        if !self.stack_check.is_safe_to_recurse() {
            return false;
        }

        if let ExprData::EInlinedEnum(b) = right {
            return self.values_look_the_same(left, &b.value.data);
        }

        match left {
            ExprData::EInlinedEnum(a) => return self.values_look_the_same(&a.value.data, right),

            ExprData::EIdentifier(a) => {
                if let ExprData::EIdentifier(b) = right
                    && a.ref_ == b.ref_
                {
                    return true;
                }
            }

            ExprData::EDot(a) => {
                if let ExprData::EDot(b) = right
                    && a.optional_chain == b.optional_chain
                    && a.can_be_removed_if_unused == b.can_be_removed_if_unused
                    && a.call_can_be_unwrapped_if_unused == b.call_can_be_unwrapped_if_unused
                    && a.name.slice() == b.name.slice()
                    && self.values_look_the_same(&a.target.data, &b.target.data)
                {
                    return true;
                }
            }

            ExprData::EIndex(a) => {
                if let ExprData::EIndex(b) = right
                    && a.optional_chain == b.optional_chain
                    && self.values_look_the_same(&a.target.data, &b.target.data)
                    && self.values_look_the_same(&a.index.data, &b.index.data)
                {
                    return true;
                }
            }

            ExprData::EIf(a) => {
                if let ExprData::EIf(b) = right
                    && self.values_look_the_same(&a.test.data, &b.test.data)
                    && self.values_look_the_same(&a.yes.data, &b.yes.data)
                    && self.values_look_the_same(&a.no.data, &b.no.data)
                {
                    return true;
                }
            }

            ExprData::EUnary(a) => {
                if let ExprData::EUnary(b) = right
                    && a.op == b.op
                    && self.values_look_the_same(&a.value.data, &b.value.data)
                {
                    return true;
                }
            }

            ExprData::EBinary(a) => {
                if let ExprData::EBinary(b) = right
                    && a.op == b.op
                    && self.values_look_the_same(&a.left.data, &b.left.data)
                    && self.values_look_the_same(&a.right.data, &b.right.data)
                {
                    return true;
                }
            }

            ExprData::ECall(a) => {
                if let ExprData::ECall(b) = right
                    && a.optional_chain == b.optional_chain
                    && a.is_direct_eval == b.is_direct_eval
                    && a.can_be_unwrapped_if_unused == b.can_be_unwrapped_if_unused
                    && a.args.len() == b.args.len()
                    && self.values_look_the_same(&a.target.data, &b.target.data)
                {
                    return (0..a.args.len())
                        .all(|i| self.values_look_the_same(&a.args[i].data, &b.args[i].data));
                }
            }

            // Special-case to distinguish between negative an non-negative zero when mangling
            // "a ? -0 : 0" => "a ? -0 : 0"
            // https://developer.mozilla.org/en-US/docs/Web/JavaScript/Equality_comparisons_and_sameness
            ExprData::ENumber(a) => {
                if let ExprData::ENumber(b) = right
                    && a.value() == 0.0
                    && b.value() == 0.0
                    && a.value().is_sign_negative() != b.value().is_sign_negative()
                {
                    return false;
                }
            }

            _ => {}
        }

        matches!(
            ExprData::eql::<_, StrictEql>(left, right, self),
            Equality::Equal
        )
    }

    /// True when two jump statements do the same thing. Port of esbuild's
    /// `jumpStmtsLookTheSame`.
    fn jump_stmts_look_the_same(&mut self, left: StmtData, right: StmtData) -> bool {
        match (left, right) {
            (StmtData::SBreak(a), StmtData::SBreak(b)) => match (a.label, b.label) {
                (None, None) => true,
                (Some(a), Some(b)) => a.ref_ == b.ref_,
                _ => false,
            },
            (StmtData::SContinue(a), StmtData::SContinue(b)) => match (a.label, b.label) {
                (None, None) => true,
                (Some(a), Some(b)) => a.ref_ == b.ref_,
                _ => false,
            },
            (StmtData::SReturn(a), StmtData::SReturn(b)) => match (a.value, b.value) {
                (None, None) => true,
                (Some(a), Some(b)) => self.values_look_the_same(&a.data, &b.data),
                _ => false,
            },
            (StmtData::SThrow(a), StmtData::SThrow(b)) => {
                self.values_look_the_same(&a.value.data, &b.value.data)
            }
            _ => false,
        }
    }
}

/// `Vec::extend_from_slice` needs `T: Clone`, and `G::Decl` is field-wise `Copy`
/// without the derive, so each declaration is copied bitwise.
fn append_decls(dst: &mut G::DeclList, src: &[G::Decl]) {
    for d in src {
        // SAFETY: Decl is field-wise Copy (Binding, Option<Expr>).
        dst.push(unsafe { core::ptr::read(d) });
    }
}

pub(crate) fn is_jump_statement(data: StmtData) -> bool {
    matches!(
        data,
        StmtData::SBreak(_) | StmtData::SContinue(_) | StmtData::SReturn(_) | StmtData::SThrow(_)
    )
}

pub(crate) fn stmts_care_about_scope(stmts: &[Stmt]) -> bool {
    stmts.iter().any(statement_cares_about_scope)
}

/// Fold a leading `if (x) break;` of a loop body into the loop test. Port of
/// esbuild's `mangleFor`. `while` loops are converted to `for` first so that
/// both shapes get this.
pub(crate) fn mangle_for(s: &mut S::For, bump: &Bump) {
    // Get the first statement in the loop
    let mut first = s.body;
    if let StmtData::SBlock(block) = first.data
        && !block.stmts.is_empty()
    {
        first = block.stmts[0];
    }

    let StmtData::SIf(if_s) = first.data else {
        return;
    };

    // "for (;;) if (x) break;" => "for (; !x;) ;"
    // "for (; a;) if (x) break;" => "for (; a && !x;) ;"
    // "for (;;) if (x) break; else y();" => "for (; !x;) y();"
    // "for (; a;) if (x) break; else y();" => "for (; a && !x;) y();"
    if let StmtData::SBreak(break_s) = if_s.yes.data
        && break_s.label.is_none()
    {
        let not = match if_s.test.data {
            ExprData::EUnary(unary) if unary.op == OpCode::UnNot => unary.value,
            _ => if_s.test.not(bump),
        };
        s.test = Some(match s.test {
            Some(test) => Expr::init(
                E::Binary {
                    op: OpCode::BinLogicalAnd,
                    left: test,
                    right: not,
                },
                test.loc,
            ),
            None => not,
        });
        s.body = drop_first_statement(s.body, if_s.no);
        return;
    }

    // "for (;;) if (x) y(); else break;" => "for (; x;) y();"
    // "for (; a;) if (x) y(); else break;" => "for (; a && x;) y();"
    if let Some(no) = if_s.no
        && let StmtData::SBreak(break_s) = no.data
        && break_s.label.is_none()
    {
        s.test = Some(match s.test {
            Some(test) => Expr::init(
                E::Binary {
                    op: OpCode::BinLogicalAnd,
                    left: test,
                    right: if_s.test,
                },
                test.loc,
            ),
            None => if_s.test,
        });
        s.body = drop_first_statement(s.body, Some(if_s.yes));
    }
}

fn drop_first_statement(body: Stmt, replace: Option<Stmt>) -> Stmt {
    if let StmtData::SBlock(mut block) = body.data
        && !block.stmts.is_empty()
    {
        if let Some(replace) = replace {
            block.stmts.slice_mut()[0] = replace;
        } else if block.stmts.len() == 2 && !statement_cares_about_scope(&block.stmts[1]) {
            return block.stmts[1];
        } else {
            block.stmts = StoreSlice::new(&block.stmts.slice()[1..]);
        }
        return body;
    }
    if let Some(replace) = replace {
        return replace;
    }
    body.to_empty()
}
