use super::coerce::Ty;
use super::{Exit, FileBuild, FinallyContext, Fx, Jump};
use crate::builder::Var;
use crate::declared::{Declared, Part, prim};
use crate::fragment::LayoutKey;
use crate::id::{BlockId, LayoutId, TyId, V};
use crate::ir::{self, Op, Operation, Target, Term, CoerceReason, func_flags};
use bun_sema::atom::Atom;
use bun_sema::bind::{Decl, Parent};
use bun_sema::check::{Activation, DeclaredClosure};
use bun_sema::hir::{BinOp, Chain, ExprId, ExprKind, Flags, FnBody, IdList, ImportEqualsTarget, PatId, PatKind, PropKey, StmtId, StmtKind, VarDecl, VarKind};
use bun_sema::program::Sym;

#[derive(Copy, Clone, PartialEq, Eq)]
enum IterationKind {
    Keys,
    Values,
    Entries,
}

struct CollectionLoop {
    collection: V,
    is_pristine: V,
    table: Var,
    found: Var,
    value: Var,
    second: Var,
    is_map: bool,
    yields: IterationKind,
}

impl<'c, 'p, 's> FileBuild<'c, 'p, 's> {

    pub(crate) fn function_body(&mut self, fx: &mut Fx) {
        let hir = self.hir(fx.file);
        let f = &hir[fx.func];
        let has_this = self.out.funcs[fx.id.idx()].has(func_flags::HAS_THIS);
        self.add_captures(fx);
        if has_this {
            fx.this = self.add_entry_param(fx, fx.this_type);
            if f.kind != bun_sema::hir::FnKind::Arrow && self.c.inspects_this(fx.file, fx.func) && self.c.is_sloppy_function(fx.file, fx.func) {
                fx.this = self.sloppy_this(fx, fx.this);
            }
        }
        let params = self.add_parameters(fx);
        self.open_activation(fx, Activation::Call(fx.func));
        self.bind_parameters(fx, &params);
        self.record_type_predicate(fx);
        if self.out.funcs[fx.id.idx()].has(func_flags::STARTS_EAGERLY) {
            let undefined = self.emit(fx, Op::Undefined);
            self.emit_yield(fx, undefined, f.flags.contains(Flags::ASYNC));
        }
        self.record_body_span(fx);
        match f.body {
            FnBody::None => {}
            FnBody::Block(stmts) => self.block_body(fx, stmts),
            FnBody::Expr(e) => {
                if self.makes_tail_calls(fx) {
                    self.record_tail_calls(fx, e);
                }
                let value = self.expr_for_return(fx, e);
                fx.calls_in_tail_position.clear();
                self.terminate_with_return(fx, value);
            }
        }
    }

    fn record_type_predicate(&mut self, fx: &Fx) {
        if !fx.is_typed {
            return;
        }
        let signature = self.c.sig_of_fn(fx.file, fx.func);
        let Some(predicate) = self.c.sig_predicate(signature) else { return };
        let Some(narrowed) = predicate.ty else { return };
        let declared = match predicate.param {
            Some(index) => match self.c.sig_params(signature).iter().nth(index) {
                Some(param) => Ty { id: self.ty_of(param.ty), checked: param.ty },
                None => return,
            },
            None => fx.this_type,
        };
        if declared.id.is_none() {
            return;
        }
        self.c.set_current_site(fx.file, self.out.funcs[fx.id.idx()].pos);
        let described = self.ty_of(narrowed);
        self.record_cast(declared, described, CoerceReason::Flow);
        for (from, to) in self.c.type_pairs_narrowed_together(declared.checked, narrowed) {
            let (have, want) = (self.ty_of(from), self.ty_of(to));
            self.record_cast(Ty { id: have, checked: from }, want, CoerceReason::Flow);
        }
    }

    pub(crate) fn emit_generic_entrypoint(&mut self, fx: &mut Fx) {
        let Some(&typed) = self.typed_bodies.get(&fx.id) else { return };
        let second = self.untyped_clones.get(&fx.id).copied();
        self.add_captures(fx);
        let accepts_this = self.out.funcs[typed.idx()].has(func_flags::HAS_THIS);
        let passed_this = if accepts_this { self.add_entry_param(fx, Ty::NONE) } else { V::NONE };
        let count = self.out.funcs[fx.id.idx()].params.len();
        let given: Vec<V> = (0..count).map(|_| self.add_entry_param(fx, Ty::NONE)).collect();
        let mismatch = fx.b.new_block();
        fx.handlers.push(mismatch);
        let expected_this = self.out.funcs[typed.idx()].declared_this_type;
        let checked_this = if accepts_this && expected_this.is_some() && expected_this != self.out.tys.anything {
            self.emit_throwing(fx, Op::Coerce { value: passed_this, to: expected_this, why: CoerceReason::Claim })
        } else {
            passed_this
        };
        let mut held = Vec::with_capacity(count);
        let written: Vec<_> = self.hir(fx.file)[fx.func].params.iter().collect();
        for (index, &value) in given.iter().enumerate() {
            let mut to = self.out.funcs[typed.idx()].params[index];
            if to.is_none() || to == self.out.tys.anything {
                held.push(value);
                continue;
            }
            if let Some(&p) = written.get(index)
                && !self.generic_entrypoint_ids.contains(&fx.id)
            {
                let (no_undefined, no_null, no_objects) = self.c.annotation_exclusions(fx.file, p);
                let mut claimed = self.out.tys.get(to).clone();
                if no_undefined {
                    claimed.prims &= !prim::UNDEFINED;
                }
                if no_null {
                    claimed.prims &= !prim::NULL;
                }
                if no_objects {
                    claimed.any_object = false;
                    claimed.any_function = false;
                }
                to = self.out.tys.intern(claimed);
            }
            held.push(self.emit_throwing(fx, Op::Coerce { value, to, why: CoerceReason::Claim }));
        }
        fx.handlers.pop();
        let may_tail_call = !self.shared.constants.logs_type_errors && !self.out.funcs[fx.id.idx()].has(func_flags::ASYNC | func_flags::GENERATOR);
        let result = self.emit_direct_call(fx, typed, checked_this, &held);
        if may_tail_call {
            self.mark_call_in_tail_position(fx, result);
        }
        self.terminate_with_return(fx, result);
        fx.b.seal(mismatch);
        fx.b.switch_to(mismatch);
        self.emit(fx, Op::Caught);
        let result = match second {
            Some(second) => self.emit_direct_call(fx, second, passed_this, &given),
            None => {
                let mut destructured = Vec::with_capacity(count);
                for (index, &value) in given.iter().enumerate() {
                    let to = self.out.funcs[typed.idx()].params[index];
                    let record = written.get(index).and_then(|&p| self.destructured_param_record(fx, p, value));
                    destructured.push(match record {
                        Some(record) => record,
                        None if to.is_none() || to == self.out.tys.anything => value,
                        None => self.emit_throwing(fx, Op::Coerce { value, to, why: CoerceReason::Cast }),
                    });
                }
                self.emit_direct_call(fx, typed, passed_this, &destructured)
            }
        };
        if may_tail_call {
            self.mark_call_in_tail_position(fx, result);
        }
        self.terminate_with_return(fx, result);
    }

    fn destructured_param_record(&mut self, fx: &mut Fx, p: bun_sema::hir::ParamId, value: V) -> Option<V> {
        let names = self.destructured_names(fx.file, p)?;
        let file = fx.file;
        let declared = self.query(|c| c.param_storage(file, p)).ty;
        let layout = self.record_layout(declared)?;
        let names: Vec<_> = names.into_iter().map(|name| self.str(name)).collect();
        let fields = &self.out.layouts[layout.idx()].fields;
        let has_field_for_every_name = names.iter().all(|&name| fields.iter().any(|field| field.name == name));
        let lists_every_required_field = fields.iter().all(|field| field.flags & ir::field_flags::OPTIONAL != 0 || names.contains(&field.name));
        if !has_field_for_every_name || !lists_every_required_field {
            return None;
        }
        self.require_object_coercible(fx, value);
        let mut values = Vec::with_capacity(names.len());
        for &name in &names {
            let read = self.emit_throwing(fx, Op::PropGet { obj: value, name });
            let field = self.out.layouts[layout.idx()].field(name).unwrap_or(0);
            let to = self.field_type(layout, field).id;
            values.push(if to.is_none() || to == self.out.tys.anything { read } else { self.emit_throwing(fx, Op::Coerce { value: read, to, why: CoerceReason::Cast }) });
        }
        Some(self.emit_typed_object(fx, layout, &names, &values, None))
    }

    fn sloppy_this(&mut self, fx: &mut Fx, given: V) -> V {
        self.operation(fx, Operation::SloppyThis, &[given])
    }

    fn makes_tail_calls(&self, fx: &Fx) -> bool {
        let func = &self.out.funcs[fx.id.idx()];
        fx.func.is_some()
            && !self.shared.constants.logs_type_errors
            && !fx.returns_this
            && func.kind != ir::FuncKind::Constructor
            && !func.has(func_flags::ASYNC | func_flags::GENERATOR | func_flags::IS_SLOPPY)
            && fx.handlers.is_empty()
            && fx.jumps.iter().all(|jump| jump.iter.is_none() && jump.finally_context.is_none())
    }

    fn returns_from_tail_position(&self, fx: &Fx, stmt: StmtId) -> bool {
        let (hir, bound) = (self.hir(fx.file), self.c.bound(fx.file));
        let mut at = stmt;
        while let Parent::Stmt(parent) = bound.stmt_parent[at.idx()] {
            match hir[parent].kind {
                StmtKind::ForIn { .. } | StmtKind::ForOf { .. } => return false,
                StmtKind::Try { block, handler, finalizer, .. } if at == block || at == handler && finalizer.is_some() => return false,
                _ => {}
            }
            at = parent;
        }
        matches!(bound.stmt_parent[at.idx()], Parent::FnBody(_))
    }

    fn record_tail_calls(&self, fx: &mut Fx, e: ExprId) {
        match self.hir(fx.file)[e].kind {
            ExprKind::Call(_) | ExprKind::TaggedTemplate(_) | ExprKind::Jsx(_) => fx.calls_in_tail_position.push(e),
            ExprKind::Cond { yes, no, .. } => {
                self.record_tail_calls(fx, yes);
                self.record_tail_calls(fx, no);
            }
            ExprKind::Binary { op: BinOp::And | BinOp::Or | BinOp::Nullish | BinOp::Comma, right, .. } => self.record_tail_calls(fx, right),
            ExprKind::As { expr, .. } | ExprKind::Satisfies { expr, .. } | ExprKind::Instantiation { expr, .. } | ExprKind::AsConst(expr) | ExprKind::NonNull(expr) => self.record_tail_calls(fx, expr),
            _ => {}
        }
    }

    fn expr_for_return(&mut self, fx: &mut Fx, e: ExprId) -> V {
        if !fx.returns_this
            && let Some(promised) = self.c.promise_fulfillment_type(fx.file, fx.func, e)
            && let want = (Ty { id: self.ty_of(promised), checked: promised })
            && self.cast_may_allocate(want.id)
        {
            return self.expr_into(fx, e, want, CoerceReason::Cast);
        }
        if fx.is_typed
            && !fx.returns_this
            && self.out.funcs[fx.id.idx()].flags & (func_flags::ASYNC | func_flags::GENERATOR) == func_flags::ASYNC
            && fx.func.is_some()
            && self.hir(fx.file)[fx.func].ret.is_some()
            && self.c.is_predicted(fx.file, e)
        {
            let (own, declared) = (self.c.type_of_expr(fx.file, e), self.c.return_type_of_fn(fx.file, fx.func));
            let (held, slot_type) = (self.c.awaited(own), self.c.awaited(declared));
            self.c.set_current_site(fx.file, self.hir(fx.file)[e].pos);
            self.record_type_flow(held, slot_type);
            let described = self.ty_of(slot_type);
            let views = self.layout_types_in(described);
            self.c.accepts_untyped(held, &views);
        }
        match self.return_coercion(fx) {
            Some((want, why)) if !fx.returns_this => self.expr_into(fx, e, want, why),
            None if !fx.returns_this && !self.out.funcs[fx.id.idx()].has(func_flags::ASYNC | func_flags::GENERATOR) => self.expr_unchecked(fx, e),
            _ => self.expr(fx, e),
        }
    }

    pub(crate) fn record_body_span(&mut self, fx: &mut Fx) {
        if !self.shared.constants.records_spans {
            return;
        }
        let hir = self.hir(fx.file);
        let f = &hir[fx.func];
        let key = if f.kind == bun_sema::hir::FnKind::Arrow { f.start } else { f.anchor } as i32;
        match f.body {
            FnBody::None => {}
            FnBody::Block(stmts) => {
                let start = hir.ids(stmts).next().map_or(0, |first| hir[first].start);
                fx.first_spans.insert(V::NONE, crate::audit::RecordedSpan { start, end: 0, step: key, block: fx.b.block });
            }
            FnBody::Expr(e) => {
                fx.first_spans.insert(V::NONE, crate::audit::RecordedSpan { start: hir[e].pos, end: hir[e].end, step: key, block: fx.b.block });
            }
        }
    }

    pub(crate) fn add_parameters(&mut self, fx: &mut Fx) -> Vec<V> {
        let hir = self.hir(fx.file);
        let f = &hir[fx.func];
        if !self.uses_arguments(fx.file, fx.func) {
            let params = (f.params.iter())
                .map(|p| {
                    let declared = self.param_ty(fx.file, p);
                    let value = self.add_entry_param(fx, declared);
                    self.predict_parameter(fx, value, p);
                    if self.shared.constants.records_spans && matches!(hir[hir[p].pat].kind, PatKind::Ident(_)) {
                        fx.first_spans.insert(value, crate::audit::RecordedSpan { start: hir[hir[p].pat].pos, end: hir[hir[p].pat].end, step: 0, block: fx.b.block });
                    }
                    value
                })
                .collect();
            self.get_new_target(fx);
            return params;
        }
        let all = self.add_entry_param(fx, Ty::NONE);
        self.get_new_target(fx);
        fx.all_arguments = all;
        if self.c.keeps_parameters_in_arguments(fx.file, fx.func) {
            let callee = self.current_closure(fx);
            let count = self.emit(fx, Op::Int(f.params.iter().count() as i64));
            fx.arguments = self.operation(fx, Operation::CreateMappedArguments, &[all, callee, count]);
            let undefined = self.emit(fx, Op::Undefined);
            return f.params.iter().map(|_| undefined).collect();
        }
        if self.using_arguments(fx.file).objects.contains(&fx.func) {
            fx.arguments = self.operation(fx, Operation::CreateArguments, &[all]);
        }
        (f.params.iter().enumerate())
            .map(|(i, p)| {
                let index = self.emit(fx, Op::Int(i as i64));
                let value = if hir[p].flags.contains(Flags::REST) {
                    let name = self.out.strs.intern(b"slice");
                    self.emit_throwing(fx, Op::CallMethod { obj: all, name, args: [index].into_iter().collect() })
                } else {
                    self.emit_throwing(fx, Op::ElemGet { obj: all, key: index })
                };
                let (declared, why) = (self.param_ty(fx.file, p), self.param_cast_reason(fx.file, p));
                self.coerce_to(fx, value, declared, why)
            })
            .collect()
    }

    fn get_new_target(&mut self, fx: &mut Fx) {
        let func = &self.out.funcs[fx.id.idx()];
        if func.kind == ir::FuncKind::Constructor {
            return;
        }
        if func.has(func_flags::HAS_NEW_TARGET) {
            fx.new_target = self.operation(fx, Operation::GetNewTarget, &[]);
        } else if self.c.mentions_new_target(fx.file, fx.func) {
            fx.new_target = self.emit(fx, Op::Undefined);
        }
    }

    pub(crate) fn bind_parameters(&mut self, fx: &mut Fx, params: &[V]) -> Vec<V> {
        let hir = self.hir(fx.file);
        let f = &hir[fx.func];
        let mut names: Vec<Sym> = Vec::new();
        for p in f.params.iter() {
            self.pattern_names(fx.file, hir[p].pat, &mut names);
        }
        if let FnBody::Block(stmts) = f.body {
            for stmt in hir.ids(stmts) {
                self.var_names(fx.file, stmt, &mut names);
            }
        }
        self.declare(fx, &names);
        let mut values = Vec::with_capacity(params.len());
        if self.c.keeps_parameters_in_arguments(fx.file, fx.func) {
            return params.to_vec();
        }
        for (i, p) in f.params.iter().enumerate() {
            let mut value = params[i];
            if hir[p].default.is_some() {
                value = self.emit_default_initializer(fx, value, hir[p].default, self.pat_name(fx, hir[p].pat));
            }
            self.bind_pat(fx, hir[p].pat, value);
            values.push(value);
        }
        self.copy_parameters_to_body_variables(fx);
        values
    }

    fn ty_with_default(&mut self, fx: &Fx, value: V, default: ExprId) -> TyId {
        let given = self.ty(fx, value);
        let described = self.out.tys.get(given).clone();
        if described.has_cells() || described.prims & prim::UNDEFINED == 0 {
            return given;
        }
        let checked = self.c.type_of_expr(fx.file, default);
        let of_default = self.ty_of(checked);
        let either = Declared { prims: described.prims & !prim::UNDEFINED, ..described }.or(self.out.tys.get(of_default));
        self.out.tys.intern(either)
    }

    pub(crate) fn emit_default_initializer(&mut self, fx: &mut Fx, value: V, default: ExprId, name: Atom) -> V {
        let undefined = self.emit(fx, Op::Undefined);
        let is_missing = self.emit(fx, Op::StrictEq { a: value, b: undefined });
        let (missing, given, join) = (fx.b.new_block(), fx.b.new_block(), fx.b.new_block());
        let result = fx.b.new_var(self.ty_with_default(fx, value, default));
        self.branch(fx, is_missing, missing, given);
        fx.b.seal(missing);
        fx.b.seal(given);
        fx.b.switch_to(given);
        self.write_as(fx, result, value, CoerceReason::Store);
        fx.b.jump(join);
        fx.b.switch_to(missing);
        let want = Ty::from_id(fx.b.var_type(result));
        let computed = self.expr_with_name_into(fx, default, name, want, CoerceReason::Cast);
        self.write_as(fx, result, computed, CoerceReason::Cast);
        fx.b.jump(join);
        fx.b.seal(join);
        fx.b.switch_to(join);
        self.read(fx, result)
    }

    pub(crate) fn block_body(&mut self, fx: &mut Fx, stmts: IdList<StmtId>) {
        let is_module_body = std::mem::take(&mut self.enters_module_body);
        let hir = self.hir(fx.file);
        let mut names = Vec::new();
        self.lexical_names(fx.file, stmts, &mut names);
        let mut function_bindings = self.function_bindings(fx, hir.ids(stmts), &mut names);
        if fx.func.is_none() && fx.class.is_none() {
            for stmt in hir.ids(stmts) {
                self.var_names(fx.file, stmt, &mut names);
            }
        }
        self.declare(fx, &names);
        if is_module_body && self.is_commonjs(fx.file) {
            self.emit_redeclared_commonjs_variables(fx);
        }
        let creates_symbols_first = fx.func.is_none() && fx.class.is_none() && self.is_builtin_file(fx.file) && hir.body.start == stmts.start && hir.body.len == stmts.len;
        if creates_symbols_first {
            for stmt in hir.ids(stmts) {
                if self.is_declaration_only_stmt(fx.file, stmt) {
                    self.stmt(fx, stmt);
                }
            }
        }
        for stmt in hir.ids(stmts) {
            match hir[stmt].kind {
                StmtKind::Fn(func) if !matches!(hir[func].body, FnBody::None) => {
                    self.declare_function(fx.file, func, None);
                }
                _ => {}
            }
        }
        if fx.func.is_some()
            && matches!(hir[fx.func].body, FnBody::Block(body) if body.start == stmts.start && body.len == stmts.len)
        {
            for stmt in hir.ids(stmts) {
                let StmtKind::Fn(func) = hir[stmt].kind else { continue };
                let replaced = hir[fx.func].params.iter().rev().find(|&p| matches!(hir[hir[p].pat].kind, PatKind::Ident(name) if name == hir[func].name));
                if let Some(replaced) = replaced.filter(|_| !matches!(hir[func].body, FnBody::None)) {
                    let mut parameter = Vec::new();
                    self.pattern_names(fx.file, hir[replaced].pat, &mut parameter);
                    function_bindings.extend(parameter.into_iter().filter(|&sym| sym != self.function_symbol(fx.file, func)).map(|sym| (func, sym)));
                }
            }
        }
        self.bind_function_declarations(fx, function_bindings);
        let kinds = |stmt: StmtId| match hir[stmt].kind {
            StmtKind::Var(decls) => decls.iter().map(|d| hir[d].kind).collect(),
            _ => Vec::new(),
        };
        let has_using = hir.ids(stmts).any(|stmt| kinds(stmt).iter().any(|kind| matches!(kind, VarKind::Using | VarKind::AwaitUsing)));
        if has_using {
            let has_await = hir.ids(stmts).any(|stmt| kinds(stmt).contains(&VarKind::AwaitUsing));
            self.with_disposable_stack(fx, has_await, |this, fx| {
                for stmt in hir.ids(stmts) {
                    if creates_symbols_first && this.is_declaration_only_stmt(fx.file, stmt) {
                        continue;
                    }
                    this.stmt(fx, stmt);
                }
            });
        } else {
            for stmt in hir.ids(stmts) {
                if creates_symbols_first && self.is_declaration_only_stmt(fx.file, stmt) {
                    continue;
                }
                let mark = if is_module_body { self.begin_part(fx, stmt) } else { None };
                self.stmt(fx, stmt);
                self.end_part(fx, mark);
            }
        }
    }

    fn function_bindings(&mut self, fx: &Fx, stmts: impl Iterator<Item = StmtId>, names: &mut Vec<Sym>) -> Vec<(bun_sema::hir::FnId, Sym)> {
        let hir = self.hir(fx.file);
        let function_values = self.function_values(fx.file);
        let mut function_bindings = Vec::new();
        for stmt in stmts {
            let StmtKind::Fn(func) = hir[stmt].kind else { continue };
            if matches!(hir[func].body, FnBody::None) {
                continue;
            }
            let sym = self.function_symbol(fx.file, func);
            let is_variable = self.files.decls_of(sym).iter().any(|declared| matches!(declared.1, bun_sema::bind::Decl::Var(_) | bun_sema::bind::Decl::Param(_)));
            if is_variable {
                function_bindings.push((func, sym));
            } else if function_values.contains(&sym) && (self.is_assigned(sym) || self.c.declared_closure(fx.file, func) == Some(DeclaredClosure::CreatedAtEntry)) {
                function_bindings.push((func, sym));
                names.push(sym);
            }
        }
        function_bindings
    }

    fn bind_function_declarations(&mut self, fx: &mut Fx, function_bindings: Vec<(bun_sema::hir::FnId, Sym)>) {
        let hir = self.hir(fx.file);
        for (func, sym) in function_bindings {
            if self.try_bind_hoisted_function(fx, sym, func) {
                continue;
            }
            let id = self.declare_function(fx.file, func, None);
            if let Some((activation, field)) = self.function_expression_scope(fx.file, func)
                && self.open_activation(fx, activation)
            {
                let layout = self.activation_layout(activation);
                let env = self.env_for_layout(fx, layout);
                let captures = self.capture_values(fx, id, hir[func].start);
                let closure = self.emit(fx, Op::ClosureOnce { func: id, captures, env, field });
                self.close_env(fx);
                self.write_sym(fx, sym, closure, hir[func].start);
                continue;
            }
            let captures = self.capture_values(fx, id, hir[func].start);
            let closure = self.emit(fx, Op::Closure { func: id, captures });
            self.write_sym(fx, sym, closure, hir[func].start);
        }
    }

    fn is_declaration_only_stmt(&self, file: bun_sema::program::FileId, stmt: StmtId) -> bool {
        let (hir, bound) = (self.hir(file), self.c.bound(file));
        let StmtKind::Var(decls) = hir[stmt].kind else { return false };
        let is_symbol = |e: ExprId| matches!(hir[e].kind, ExprKind::Ident(bun_sema::atom::known::Symbol)) && bound.expr_symbol[e.idx()].is_none();
        !decls.is_empty()
            && decls.iter().all(|d| {
                let decl = &hir[d];
                if decl.kind != VarKind::Const || decl.init.is_none() || !matches!(hir[decl.pat].kind, PatKind::Ident(_)) {
                    return false;
                }
                let ExprKind::Call(call) = hir[decl.init].kind else { return false };
                let is_factory = match hir[hir[call].callee].kind {
                    ExprKind::Dot { obj, name, chain: Chain::No, .. } => hir[call].args.len() == 1 && self.c.atoms().bytes(name) == b"for" && is_symbol(obj),
                    _ => hir[call].args.len() <= 1 && is_symbol(hir[call].callee),
                };
                is_factory && hir[call].chain == Chain::No && hir.ids(hir[call].args).all(|argument: ExprId| matches!(hir[argument].kind, ExprKind::String(_)))
            })
    }

    pub(crate) fn initial_value(&mut self, fx: &mut Fx, decl: &VarDecl) -> V {
        let hir = self.hir(fx.file);
        let name = self.pat_name(fx, decl.pat);
        if !fx.is_typed || decl.ty.is_none() {
            let init = if fx.is_typed { self.c.unasserted_element_read(fx.file, decl.pat).unwrap_or(decl.init) } else { decl.init };
            return self.expr_with_name(fx, init, name);
        }
        let mut names = Vec::new();
        self.pattern_names(fx.file, decl.pat, &mut names);
        let want = match (&hir[decl.pat].kind, names.first()) {
            (PatKind::Ident(_), Some(&sym)) => self.symbol_ty(sym),
            _ => {
                let checked = self.c.type_from_node(fx.file, decl.ty);
                Ty { id: self.ty_of(checked), checked }
            }
        };
        self.expr_with_name_into_if_convertible(fx, decl.init, name, want)
    }

    fn take_label(&mut self, fx: &mut Fx) -> Atom {
        std::mem::replace(&mut fx.label, Atom::NONE)
    }

    pub(crate) fn stmt(&mut self, fx: &mut Fx, stmt: StmtId) {
        if stmt.is_none() {
            return;
        }
        let s = &self.hir(fx.file)[stmt];
        let declares = matches!(s.kind, StmtKind::Fn(_) | StmtKind::Class(_) | StmtKind::Enum(_) | StmtKind::Module(_));
        if fx.func.is_some() && !declares && fx.b.is_unreachable_here() || self.files.is_dead_statement(fx.file, stmt) {
            return self.mark_dead_stmt(fx, stmt);
        }
        let outer = fx.initialized_before_loops.len();
        let outer_modules = fx.modules_touched_before_loops.len();
        if matches!(s.kind, StmtKind::For { .. } | StmtKind::ForIn { .. } | StmtKind::ForOf { .. } | StmtKind::While { .. } | StmtKind::DoWhile { .. }) {
            self.initialize_before_loop(fx, s.start, s.loc.end);
        }
        let in_head = match s.kind {
            StmtKind::For { init, .. } => self.head_using_kind(fx, init),
            _ => None,
        };
        match in_head {
            Some(has_await) => self.with_disposable_stack(fx, has_await, |this, fx| this.stmt_inner(fx, stmt)),
            None => self.stmt_inner(fx, stmt),
        }
        fx.initialized_before_loops.truncate(outer);
        fx.modules_touched_before_loops.truncate(outer_modules);
    }

    fn stmt_inner(&mut self, fx: &mut Fx, stmt: StmtId) {
        if std::mem::take(&mut fx.owes_initialize_without_stores) {
            let this = self.this(fx, self.hir(fx.file)[stmt].start);
            self.operation(fx, Operation::Initialize, &[this]);
        }
        if let Some(at) = fx.first_stores.iter().position(|store| store.stmt == stmt) {
            if at == 0 {
                self.initialize(fx);
            }
            return;
        }
        let hir = self.hir(fx.file);
        let s = &hir[stmt];
        fx.b.pos = s.start;
        if self.c.is_stack_low() {
            return self.problem(fx.file, s.start, "statements nested this deeply (the compiler ran out of stack)");
        }
        match s.kind {
            StmtKind::Empty
            | StmtKind::Debugger
            | StmtKind::Interface(_)
            | StmtKind::TypeAlias(_)
            | StmtKind::Import(_)
            | StmtKind::ExportNamed(_)
            | StmtKind::ExportStar { .. }
            | StmtKind::ExportAsNamespace(_) => {}
            StmtKind::Fn(func) => {
                if !matches!(hir[func].body, FnBody::None) {
                    let sym = self.function_symbol(fx.file, func);
                    self.export_from_namespace(fx, sym, s.start);
                }
            }
            StmtKind::Expr(e) => {
                self.expr_unused(fx, e);
            }
            StmtKind::Var(decls) => {
                for d in decls.iter() {
                    let decl = &hir[d];
                    if decl.flags.contains(Flags::AMBIENT) {
                        continue;
                    }
                    if matches!(decl.kind, VarKind::Using | VarKind::AwaitUsing) {
                        if decl.init.is_none() {
                            continue;
                        }
                        if fx.disposable_stack.is_none() {
                            self.problem(fx.file, s.start, "a `using` declaration that is not directly in a block");
                            continue;
                        }
                        let value = self.initial_value(fx, decl);
                        self.add_disposable_resource(fx, value, decl.kind == VarKind::AwaitUsing);
                        self.bind_pat(fx, decl.pat, value);
                        continue;
                    }
                    if decl.init.is_some() {
                        if fx.func.is_none() && self.c.is_named_export_variables_literal(fx.file, decl.init) {
                            self.store_export_variables(fx, decl.init);
                            continue;
                        }
                        if fx.func.is_none()
                            && fx.class.is_none()
                            && let Some(sym) = self.lazy_variable_declared_at(fx.file, decl.loc.pos)
                        {
                            self.declare_lazy_variable(fx, sym);
                            continue;
                        }
                        if self.bind_export_variables(fx, decl.pat, decl.init) || decl.ty.is_none() && self.bind_required_module_exports(fx, decl.pat, decl.init) || self.bind_required_module(fx, decl.pat, decl.init) {
                            continue;
                        }
                        let value = self.initial_value(fx, decl);
                        self.record_exported_variable_callee(fx, decl.pat, decl.init);
                        let outer = fx.b.pos;
                        if matches!(hir[decl.pat].kind, PatKind::Object(_)) {
                            fx.b.pos = self.last_pos(fx, decl.init);
                        }
                        self.bind_pat(fx, decl.pat, value);
                        fx.b.pos = outer;
                    } else if decl.kind != VarKind::Var {
                        let mut names = Vec::new();
                        self.pattern_names(fx.file, decl.pat, &mut names);
                        for sym in names {
                            self.initialize_sym_without_value(fx, sym, hir[decl.pat].pos);
                        }
                    }
                }
            }
            StmtKind::Class(class) => {
                if !hir[class].flags.contains(Flags::AMBIENT) {
                    let sym = self.class_symbol(fx.file, class);
                    self.emit_class(fx, class, Some(sym));
                    self.export_from_namespace(fx, sym, s.start);
                }
            }
            StmtKind::Enum(e) => {
                if !hir[e].flags.contains(Flags::AMBIENT) {
                    let id = self.c.bound(fx.file).enum_symbol[e.idx()];
                    let sym = self.files.export_symbol_of_value_symbol_if_exported(self.files.sym(fx.file, id));
                    let global = self.enum_global(sym);
                    let declarations = self.enum_declarations(sym);
                    if !self.is_enum_created_at_declaration(sym, &declarations) {
                        let null = self.emit(fx, Op::Null);
                        self.emit(fx, Op::GlobalSet(global, null));
                    } else {
                        if declarations.first() == Some(&(fx.file, e)) && !self.files.flags(sym).contains(bun_sema::bind::SymFlags::VALUE_MODULE) {
                            let fresh = self.emit(fx, Op::NewObject);
                            self.emit(fx, Op::GlobalSet(global, fresh));
                        } else {
                            self.ensure_enum_object(fx, sym);
                        }
                        let obj = self.emit(fx, Op::GlobalGet(global));
                        self.emit_enum_members(fx, obj, fx.file, e);
                    }
                    self.export_from_namespace(fx, sym, s.start);
                }
            }
            StmtKind::Module(m) => {
                if !hir[m].flags.contains(Flags::AMBIENT) && self.c.bound(fx.file).is_instantiated_module(m, true) {
                    let id = self.c.bound(fx.file).module_symbol[m.idx()];
                    let namespace = self.files.export_symbol_of_value_symbol_if_exported(self.files.sym(fx.file, id));
                    if self.files.flags(namespace).intersects(bun_sema::bind::SymFlags::ENUM) && !self.enum_declarations(namespace).is_empty() {
                        self.ensure_enum_object(fx, namespace);
                    }
                    if self.c.is_reified_namespace(namespace) {
                        self.enter_namespace_block(fx, namespace);
                        return self.block_body(fx, hir[m].body);
                    }
                    for (_, member) in self.files.exports(namespace) {
                        let member = self.value_symbol(member);
                        if matches!(self.value_declaration(member), Some((_, Decl::Var(_)))) {
                            self.symbol_global(member);
                        }
                    }
                    self.block_body(fx, hir[m].body);
                }
            }
            StmtKind::Return(e) => {
                if e.is_some() && self.makes_tail_calls(fx) && self.returns_from_tail_position(fx, stmt) {
                    self.record_tail_calls(fx, e);
                }
                let mut value = if e.is_some() { self.expr_for_return(fx, e) } else { V::NONE };
                fx.calls_in_tail_position.clear();
                let flags = self.out.funcs[fx.id.idx()].flags;
                if flags & func_flags::ASYNC != 0 && flags & func_flags::GENERATOR != 0 && value.is_some() {
                    value = self.emit_throwing(fx, Op::Await(value));
                }
                self.emit_return(fx, value);
            }
            StmtKind::If { test, yes, no } => {
                if self.shared.constants.minifies_syntax && no.is_none() && matches!(hir[yes].kind, StmtKind::Block(stmts) if stmts.is_empty()) && self.can_unwrap_if_unused(fx.file, test) {
                    return self.expr_unused(fx, test);
                }
                if let Some(test) = self.constant(fx, test) {
                    let (taken, left_out) = if test.is_truthy() { (yes, no) } else { (no, yes) };
                    self.mark_dead_stmt(fx, left_out);
                    return self.scoped_stmt(fx, taken);
                }
                if let Some(truthy) = self.known_truthiness(fx, test) {
                    let (taken, left_out) = if truthy { (yes, no) } else { (no, yes) };
                    self.expr_unused(fx, test);
                    self.mark_dead_stmt(fx, left_out);
                    return self.scoped_stmt(fx, taken);
                }
                let (then, otherwise, join) = (fx.b.new_block(), fx.b.new_block(), fx.b.new_block());
                self.branch_on(fx, test, then, otherwise);
                fx.b.seal(then);
                fx.b.seal(otherwise);
                fx.b.switch_to(then);
                self.scoped_stmt(fx, yes);
                fx.b.jump(join);
                fx.b.switch_to(otherwise);
                self.scoped_stmt(fx, no);
                fx.b.jump(join);
                fx.b.seal(join);
                fx.b.switch_to(join);
            }
            StmtKind::Block(stmts) => {
                let opened = self.open_activation(fx, Activation::Block(stmt));
                self.block_body(fx, stmts);
                if opened {
                    self.close_env(fx);
                }
            }
            StmtKind::While { test, body } => {
                if self.constant(fx, test).is_some_and(|test| !test.is_truthy()) {
                    self.take_label(fx);
                    return self.mark_dead_stmt(fx, body);
                }
                let label = self.take_label(fx);
                let (header, inside, exit) = (fx.b.new_block(), fx.b.new_block(), fx.b.new_block());
                fx.b.jump(header);
                fx.b.switch_to(header);
                self.branch_on(fx, test, inside, exit);
                fx.b.seal(inside);
                fx.b.switch_to(inside);
                self.emit(fx, Op::Poll);
                self.loop_body(fx, label, body, exit, header, V::NONE);
                fx.b.jump(header);
                fx.b.seal(header);
                fx.b.seal(exit);
                fx.b.switch_to(exit);
            }
            StmtKind::DoWhile { body, test } => {
                let label = self.take_label(fx);
                let (inside, check, exit) = (fx.b.new_block(), fx.b.new_block(), fx.b.new_block());
                fx.b.jump(inside);
                fx.b.switch_to(inside);
                self.emit(fx, Op::Poll);
                self.loop_body(fx, label, body, exit, check, V::NONE);
                fx.b.jump(check);
                fx.b.seal(check);
                fx.b.switch_to(check);
                self.branch_on(fx, test, inside, exit);
                fx.b.seal(inside);
                fx.b.seal(exit);
                fx.b.switch_to(exit);
            }
            StmtKind::For { init, test, update, body } => {
                let label = self.take_label(fx);
                let mut names = Vec::new();
                if init.is_some()
                    && let StmtKind::Var(decls) = hir[init].kind
                {
                    for d in decls.iter() {
                        if hir[d].kind != VarKind::Var {
                            self.pattern_names(fx.file, hir[d].pat, &mut names);
                        }
                    }
                }
                let opened = self.open_activation(fx, Activation::Iteration(stmt));
                self.declare(fx, &names);
                if init.is_some()
                    && let StmtKind::Expr(e) = hir[init].kind
                {
                    fx.b.pos = hir[init].start;
                    self.expr_for_effect(fx, e);
                } else {
                    self.stmt(fx, init);
                }
                if opened && self.c.is_captured_before_iterations(fx.file, stmt) {
                    self.copy_env(fx, &names);
                }
                let (header, inside, next, exit) = (fx.b.new_block(), fx.b.new_block(), fx.b.new_block(), fx.b.new_block());
                fx.b.jump(header);
                fx.b.switch_to(header);
                if test.is_some() {
                    self.branch_on(fx, test, inside, exit);
                } else {
                    fx.b.jump(inside);
                }
                fx.b.seal(inside);
                fx.b.switch_to(inside);
                self.emit(fx, Op::Poll);
                self.loop_body(fx, label, body, exit, next, V::NONE);
                fx.b.jump(next);
                fx.b.seal(next);
                fx.b.switch_to(next);
                if opened {
                    self.copy_env(fx, &names);
                }
                if update.is_some() {
                    self.expr_for_effect(fx, update);
                }
                fx.b.jump(header);
                fx.b.seal(header);
                fx.b.seal(exit);
                fx.b.switch_to(exit);
                if opened {
                    self.close_env(fx);
                }
            }
            StmtKind::ForOf { left, expr, body, is_await: true } => self.for_await(fx, stmt, left, expr, body, None),
            StmtKind::ForOf { left, expr, body, is_await: false } if self.predicted_iterator_class(fx, expr).is_some() => {
                let expected = self.predicted_iterator_class(fx, expr);
                self.for_await(fx, stmt, left, expr, body, expected)
            }
            StmtKind::ForOf { left, expr, body, is_await: false } => {
                let label = self.take_label(fx);
                fx.b.pos = self.loop_binding_pos(fx, left, expr);
                let (iter, table) = self.open_collection_loop(fx, stmt, expr);
                let index = self.new_counter(fx, 0);
                let (header, inside, next, exit) = (fx.b.new_block(), fx.b.new_block(), fx.b.new_block(), fx.b.new_block());
                fx.b.jump(header);
                fx.b.switch_to(header);
                let at = self.read(fx, index);
                let destructures_pair = matches!(hir[left].kind, StmtKind::Var(decls) if !decls.is_empty() && self.is_simple_array_pattern(fx, hir[decls.at(0)].pat));
                let destructures_pair = destructures_pair && table.as_ref().is_some_and(|table| table.yields == IterationKind::Entries);
                match &table {
                    Some(table) => self.step_collection_loop(fx, table, iter, at, destructures_pair, inside, exit),
                    None => {
                        let has = self.emit_throwing(fx, Op::IterHas { iter, index: at });
                        self.branch(fx, has, inside, exit);
                    }
                }
                fx.b.seal(inside);
                fx.b.switch_to(inside);
                self.emit(fx, Op::Poll);
                let value = match &table {
                    Some(_) if destructures_pair => V::NONE,
                    Some(table) => self.read(fx, table.value),
                    None => self.emit_throwing(fx, Op::IterGet { iter, index: at }),
                };
                let mut names = Vec::new();
                let mut target = ExprId::NONE;
                let mut pat = PatId::NONE;
                match hir[left].kind {
                    StmtKind::Var(decls) if !decls.is_empty() => {
                        let d = decls.at(0);
                        pat = hir[d].pat;
                        if hir[d].kind != VarKind::Var {
                            self.pattern_names(fx.file, pat, &mut names);
                        }
                    }
                    StmtKind::Expr(e) => target = e,
                    _ => {}
                }
                let is_just_read = table.is_none() && {
                    let of_iterable = self.c.type_of_expr(fx.file, expr);
                    self.c.parts(of_iterable).iter().all(|&part| self.c.is_array_or_tuple(part))
                };
                let value = if is_just_read && value.is_some() { self.coerce_iteration_value(fx, value, expr, false) } else { value };
                let closing = fx.b.new_block();
                fx.handlers.push(closing);
                let value = if !is_just_read && value.is_some() { self.coerce_iteration_value(fx, value, expr, false) } else { value };
                let opened = self.open_activation(fx, Activation::Iteration(stmt));
                self.declare(fx, &names);
                let head_unwind_depth = fx.handlers.len() - 1;
                fx.jumps.push(Jump { label: Atom::NONE, break_to: BlockId::NONE, continue_to: BlockId::NONE, iter, unwind_depth: head_unwind_depth, is_unlabeled_break_target: false, finally_context: None });
                if let (Some(table), true) = (&table, value.is_none()) {
                    let (there, generally, bound) = (fx.b.new_block(), fx.b.new_block(), fx.b.new_block());
                    self.branch(fx, table.is_pristine, there, generally);
                    fx.b.seal(there);
                    fx.b.seal(generally);
                    fx.b.switch_to(there);
                    let parts = [self.read(fx, table.value), self.read(fx, table.second)];
                    self.bind_simple_array_pattern(fx, pat, &parts);
                    fx.b.jump(bound);
                    fx.b.switch_to(generally);
                    let pair = self.read(fx, table.value);
                    let pair = self.coerce_iteration_value(fx, pair, expr, false);
                    self.bind_pat(fx, pat, pair);
                    fx.b.jump(bound);
                    fx.b.seal(bound);
                    fx.b.switch_to(bound);
                } else if pat.is_some() {
                    self.bind_pat(fx, pat, value);
                } else if target.is_some() {
                    if fx.is_typed {
                        let iterable = self.c.type_of_expr(fx.file, expr);
                        let (source, taking) = (self.c.iterated_type(iterable, false), self.c.type_of_expr(fx.file, target));
                        self.record_type_flow(source, taking);
                    }
                    self.assign_to(fx, target, value);
                }
                fx.jumps.pop();
                let resource = self.head_using_kind(fx, left).map(|is_await| (value, is_await));
                self.loop_body_with_resource(fx, label, body, exit, next, iter, resource);
                if opened {
                    self.close_env(fx);
                }
                fx.handlers.pop();
                fx.b.jump(next);
                fx.b.seal(closing);
                fx.b.switch_to(closing);
                let caught = self.emit(fx, Op::CaughtException);
                self.close_loop_iterator(fx, iter, true);
                let unwind = fx.handlers.last().map(|&handler| Target::new(handler));
                fx.b.terminate(Term::Throw { value: caught, unwind, pos: 0 });
                fx.b.seal(next);
                fx.b.switch_to(next);
                let at = match &table {
                    Some(table) => self.read(fx, table.found),
                    None => self.read(fx, index),
                };
                self.count(fx, index, at);
                fx.b.jump(header);
                fx.b.seal(header);
                fx.b.seal(exit);
                fx.b.switch_to(exit);
            }
            StmtKind::ForIn { left, expr, body } => {
                let label = self.take_label(fx);
                if let StmtKind::Var(decls) = hir[left].kind
                    && !decls.is_empty()
                    && hir[decls.at(0)].kind == VarKind::Var
                    && hir[decls.at(0)].init.is_some()
                {
                    self.stmt(fx, left);
                }
                let object = self.iterated(fx, stmt, expr);
                let keys = self.operation(fx, Operation::ForInKeys, &[object]);
                fx.b.func.values[keys.idx()].ty = self.known.array;
                let length_name = self.out.strs.intern(b"length");
                let length = self.emit_throwing(fx, Op::PropGet { obj: keys, name: length_name });
                fx.b.func.values[length.idx()].ty = self.known.uint32;
                let index = self.new_counter(fx, 0);
                let (header, inside, there, next, exit) = (fx.b.new_block(), fx.b.new_block(), fx.b.new_block(), fx.b.new_block(), fx.b.new_block());
                fx.b.jump(header);
                fx.b.switch_to(header);
                let at = self.read(fx, index);
                let more = self.emit(fx, Op::Relational { op: ir::RelOp::Lt, a: at, b: length });
                self.branch(fx, more, inside, exit);
                fx.b.seal(inside);
                fx.b.switch_to(inside);
                self.emit(fx, Op::Poll);
                let key = self.emit_throwing(fx, Op::ElemGet { obj: keys, key: at });
                let string = self.out.tys.intern(Declared::prims(prim::STRING));
                let key = self.coerce_to(fx, key, Ty::from_id(string), CoerceReason::Claim);
                let is_there = self.operation(fx, Operation::HasEnumerableProperty, &[object, key]);
                self.branch(fx, is_there, there, next);
                fx.b.seal(there);
                fx.b.switch_to(there);
                let mut names = Vec::new();
                let mut target = ExprId::NONE;
                let mut pat = PatId::NONE;
                match hir[left].kind {
                    StmtKind::Var(decls) if !decls.is_empty() => {
                        let d = decls.at(0);
                        pat = hir[d].pat;
                        if hir[d].kind != VarKind::Var {
                            self.pattern_names(fx.file, pat, &mut names);
                        }
                    }
                    StmtKind::Expr(e) => target = e,
                    _ => {}
                }
                let opened = self.open_activation(fx, Activation::Iteration(stmt));
                self.declare(fx, &names);
                if pat.is_some() {
                    self.bind_pat(fx, pat, key);
                } else if target.is_some() {
                    self.assign_to(fx, target, key);
                }
                self.loop_body(fx, label, body, exit, next, V::NONE);
                if opened {
                    self.close_env(fx);
                }
                fx.b.jump(next);
                fx.b.seal(next);
                fx.b.switch_to(next);
                let at = self.read(fx, index);
                self.count(fx, index, at);
                fx.b.jump(header);
                fx.b.seal(header);
                fx.b.seal(exit);
                fx.b.switch_to(exit);
            }
            StmtKind::Switch { expr, cases } => {
                let label = self.take_label(fx);
                let mut entered = None;
                if let Some(constant) = self.constant(fx, expr).filter(|constant| constant.is_non_nan_primitive()) {
                    let mut found = cases.iter().position(|case| hir[case].test.is_none()).unwrap_or(cases.len());
                    let mut is_decided = true;
                    for (i, case) in cases.iter().enumerate() {
                        if hir[case].test.is_none() {
                            continue;
                        }
                        let Some(test) = self.constant(fx, hir[case].test).filter(|test| test.is_non_nan_primitive()) else {
                            is_decided = false;
                            break;
                        };
                        if test == constant {
                            found = i;
                            break;
                        }
                    }
                    entered = is_decided.then_some(found);
                }
                let switched_on = if fx.is_typed { self.c.element_read_without_integer_range(fx.file, expr).unwrap_or(expr) } else { expr };
                let value = if entered.is_some() { V::NONE } else { self.expr(fx, switched_on) };
                let exit = fx.b.new_block();
                let mut names = Vec::new();
                for case in cases.iter() {
                    self.lexical_names(fx.file, hir[case].body, &mut names);
                }
                let function_bindings = self.function_bindings(fx, cases.iter().flat_map(|case| hir.ids(hir[case].body)), &mut names);
                let opened = self.open_activation(fx, Activation::Block(stmt));
                self.declare(fx, &names);
                for inner in cases.iter().flat_map(|case| hir.ids(hir[case].body)) {
                    if let StmtKind::Fn(func) = hir[inner].kind
                        && !matches!(hir[func].body, FnBody::None)
                    {
                        self.declare_function(fx.file, func, None);
                    }
                }
                self.bind_function_declarations(fx, function_bindings);
                let bodies: Vec<BlockId> = cases.iter().map(|_| fx.b.new_block()).collect();
                let mut default = exit;
                if let Some(entered) = entered {
                    default = bodies.get(entered).copied().unwrap_or(exit);
                }
                for (i, case) in cases.iter().enumerate() {
                    if entered.is_some() {
                        break;
                    }
                    if hir[case].test.is_none() {
                        default = bodies[i];
                        continue;
                    }
                    let test = self.expr(fx, hir[case].test);
                    let is_equal = self.emit(fx, Op::StrictEq { a: value, b: test });
                    let next = fx.b.new_block();
                    self.branch(fx, is_equal, bodies[i], next);
                    fx.b.seal(next);
                    fx.b.switch_to(next);
                }
                fx.b.jump(default);
                fx.jumps.push(Jump { label, break_to: exit, continue_to: BlockId::NONE, iter: V::NONE, unwind_depth: 0, is_unlabeled_break_target: true, finally_context: None });
                let outer_stack = std::mem::replace(&mut fx.disposable_stack, V::NONE);
                for (i, case) in cases.iter().enumerate() {
                    fx.b.seal(bodies[i]);
                    fx.b.switch_to(bodies[i]);
                    let is_left_out = entered.is_some() && fx.b.is_unreachable_here();
                    for inner in hir.ids(hir[case].body) {
                        if (is_left_out || (entered.is_some() && fx.b.is_unreachable_here())) && !matches!(hir[inner].kind, StmtKind::Fn(_) | StmtKind::Class(_) | StmtKind::Enum(_) | StmtKind::Module(_)) {
                            self.mark_dead_stmt(fx, inner);
                            continue;
                        }
                        self.stmt(fx, inner);
                    }
                    if is_left_out {
                        fx.b.terminate(Term::Unreachable);
                    }
                    let next = bodies.get(i + 1).copied().unwrap_or(exit);
                    if i + 1 < bodies.len() {
                    }
                    fx.b.jump(next);
                }
                fx.disposable_stack = outer_stack;
                fx.jumps.pop();
                fx.b.seal(exit);
                fx.b.switch_to(exit);
                if opened {
                    self.close_env(fx);
                }
            }
            StmtKind::Try { block, param, handler, finalizer } => {
                if finalizer.is_none() {
                    return self.try_catch(fx, block, param, handler);
                }
                self.try_finally(
                    fx,
                    false,
                    |this, fx| this.try_catch(fx, block, param, handler),
                    |this, fx, _, _| this.scoped_stmt(fx, finalizer),
                );
            }
            StmtKind::Throw(e) => {
                let value = self.expr(fx, e);
                let unwind = fx.handlers.last().map(|&handler| Target::new(handler));
                let pos = self.last_pos(fx, e);
                fx.b.terminate(Term::Throw { value, unwind, pos });
            }
            StmtKind::Break(label) => {
                let Some(at) = fx.jumps.iter().rposition(|j| if label.is_some() { j.break_to.is_some() && j.label == label } else { j.is_unlabeled_break_target }) else {
                    return self.problem(fx.file, s.start, "a `break` without a target");
                };
                let (to, all) = (fx.jumps[at].break_to, fx.jumps.len());
                self.emit_abrupt_completion(fx, at, all, Exit::Goto(to));
            }
            StmtKind::Continue(label) => {
                let Some(at) = fx.jumps.iter().rposition(|j| j.continue_to.is_some() && (label.is_none() || j.label == label)) else {
                    return self.problem(fx.file, s.start, "a `continue` without a target");
                };
                let (to, all) = (fx.jumps[at].continue_to, fx.jumps.len());
                self.emit_abrupt_completion(fx, at + 1, all, Exit::Goto(to));
            }
            StmtKind::Labeled { label, body } => {
                if matches!(
                    hir[body].kind,
                    StmtKind::For { .. } | StmtKind::ForIn { .. } | StmtKind::ForOf { .. } | StmtKind::While { .. } | StmtKind::DoWhile { .. } | StmtKind::Switch { .. }
                ) {
                    fx.label = label;
                    self.stmt(fx, body);
                    return;
                }
                let exit = fx.b.new_block();
                fx.jumps.push(Jump { label, break_to: exit, continue_to: BlockId::NONE, iter: V::NONE, unwind_depth: 0, is_unlabeled_break_target: false, finally_context: None });
                self.stmt(fx, body);
                fx.jumps.pop();
                fx.b.jump(exit);
                fx.b.seal(exit);
                fx.b.switch_to(exit);
            }
            StmtKind::ImportEquals(import) => match hir[import].target {
                ImportEqualsTarget::Entity(_) => self.emit_entity_alias(fx, import, s.start),
                ImportEqualsTarget::Require(specifier) => self.emit_import_by_require(fx, specifier, s.start),
            },
            StmtKind::ExportDefault(e) if self.default_export_binding(fx.file, e).is_some_and(|sym| self.c.is_default_export_equivalent_to_binding(fx.file, e, sym)) => {
                if let Some(sym) = self.default_export_binding(fx.file, e)
                    && self.value_declaration(sym).is_some_and(|(of, _)| of == fx.file)
                    && self.may_be_in_tdz(fx, sym, e)
                {
                    self.read_reference(fx, sym, e);
                }
            }
            StmtKind::ExportDefault(e) => {
                let value = self.expr_with_name(fx, e, bun_sema::atom::known::default);
                let module = self.files.file_symbol(fx.file);
                if let Some(sym) = self.files.export(module, bun_sema::atom::known::default) {
                    let global = self.symbol_global(sym);
                    self.emit(fx, Op::GlobalSet(global, value));
                }
            }
            StmtKind::ExportAssign(e) => {
                let value = self.expr(fx, e);
                let module = self.files.file_symbol(fx.file);
                if let Some(sym) = self.files.export(module, bun_sema::atom::known::export_equals) {
                    let global = self.symbol_global(sym);
                    self.emit(fx, Op::GlobalSet(global, value));
                }
            }
        }
    }

    fn scoped_stmt(&mut self, fx: &mut Fx, stmt: StmtId) {
        self.stmt(fx, stmt);
    }

    fn open_collection_loop(&mut self, fx: &mut Fx, stmt: StmtId, expr: ExprId) -> (V, Option<CollectionLoop>) {
        let hir = self.hir(fx.file);
        let method = match hir[expr].kind {
            ExprKind::Call(call) if hir[call].chain == Chain::No && hir[call].args.is_empty() => match hir[hir[call].callee].kind {
                ExprKind::Dot { obj, name, chain: Chain::No, .. } if !matches!(hir[obj].kind, ExprKind::Super) => match self.c.atoms().bytes(name) {
                    b"keys" => Some((obj, name, IterationKind::Keys)),
                    b"values" => Some((obj, name, IterationKind::Values)),
                    b"entries" => Some((obj, name, IterationKind::Entries)),
                    _ => None,
                },
                _ => None,
            },
            _ => None,
        };
        let checked = self.c.type_of_expr(fx.file, method.map_or(expr, |method| method.0));
        let declared = self.ty_of(checked);
        if !fx.is_typed || self.collection_kind_of_ty(declared).is_none() {
            let iterable = self.iterated(fx, stmt, expr);
            return (self.emit_throwing(fx, Op::IterOpen(iterable)), None);
        }
        let collection = self.iterated(fx, stmt, method.map_or(expr, |method| method.0));
        let iterable_of = |this: &mut Self, fx: &mut Fx| match method {
            Some((_, name, _)) => {
                let name = this.str(name);
                let iterable = this.emit_throwing(fx, Op::CallMethod { obj: collection, name, args: ir::Args::new() });
                this.coerce_to_expr_type(fx, iterable, expr)
            }
            None => collection,
        };
        let Some(is_map) = self.collection_kind_of_ty(self.ty(fx, collection)) else {
            let iterable = iterable_of(self, fx);
            return (self.emit_throwing(fx, Op::IterOpen(iterable)), None);
        };
        let yields = match method {
            Some((.., IterationKind::Keys)) if !is_map => IterationKind::Values,
            Some((.., yields)) => yields,
            None if is_map => IterationKind::Entries,
            None => IterationKind::Values,
        };
        let collection = self.as_predicted_collection(fx, collection);
        let is_pristine = self.operation(fx, Operation::HasOriginalStructure, &[collection]);
        fx.b.func.values[is_pristine.idx()].ty = self.known.boolean;
        let (iter, table, value, second) = (self.new_temporary(fx), self.new_temporary(fx), self.new_temporary(fx), self.new_temporary(fx));
        let found = fx.b.new_var(self.out.tys.intern(Declared::ints(-1, 1 << 52)));
        let (there, generally, opened) = (fx.b.new_block(), fx.b.new_block(), fx.b.new_block());
        let undefined = self.emit(fx, Op::Undefined);
        let zero = self.emit(fx, Op::Int(0));
        fx.b.write(found, zero);
        self.write(fx, value, undefined);
        self.write(fx, second, undefined);
        self.branch(fx, is_pristine, there, generally);
        fx.b.seal(there);
        fx.b.seal(generally);
        fx.b.switch_to(there);
        let first = self.operation(fx, Operation::CollectionTable, &[collection]);
        self.write(fx, table, first);
        self.write(fx, iter, undefined);
        fx.b.jump(opened);
        fx.b.switch_to(generally);
        let iterable = iterable_of(self, fx);
        let opened_generically = self.emit_throwing(fx, Op::IterOpen(iterable));
        self.write(fx, table, undefined);
        self.write(fx, iter, opened_generically);
        fx.b.jump(opened);
        fx.b.seal(opened);
        fx.b.switch_to(opened);
        let iter = self.read(fx, iter);
        fx.skip_close_if.insert(iter, is_pristine);
        (iter, Some(CollectionLoop { collection, is_pristine, table, found, value, second, is_map, yields }))
    }

    fn collection_kind_of_ty(&self, ty: TyId) -> Option<bool> {
        if ty.is_none() {
            return None;
        }
        let described = self.out.tys.get(ty);
        match &described.parts[..] {
            [Part::Global(name, _)] if described.prims & !prim::NULLISH == 0 && described.ints.is_none() && !described.any_object && !described.any_function => match self.out.strs.get(*name) {
                b"Map" | b"ReadonlyMap" => Some(true),
                b"Set" | b"ReadonlySet" => Some(false),
                _ => None,
            },
            _ => None,
        }
    }

    fn step_collection_loop(&mut self, fx: &mut Fx, table: &CollectionLoop, iter: V, at: V, destructures_pair: bool, inside: BlockId, exit: BlockId) {
        let (there, is_there, generally, is_there_generally) = (fx.b.new_block(), fx.b.new_block(), fx.b.new_block(), fx.b.new_block());
        self.branch(fx, table.is_pristine, there, generally);
        fx.b.seal(there);
        fx.b.seal(generally);
        fx.b.switch_to(there);
        let from = self.read(fx, table.table);
        let entry = self.operation(fx, if table.is_map { Operation::MapNext } else { Operation::SetNext }, &[table.collection, from, at]);
        fx.b.func.values[entry.idx()].ty = self.out.tys.intern(Declared::ints(-1, i32::MAX as i64));
        fx.b.write(table.found, entry);
        let zero = self.emit(fx, Op::Int(0));
        let has = self.emit(fx, Op::Relational { op: ir::RelOp::Ge, a: entry, b: zero });
        self.branch(fx, has, is_there, exit);
        fx.b.seal(is_there);
        fx.b.switch_to(is_there);
        if table.yields == IterationKind::Entries {
            let parts = self.collection_entry_parts(fx, table);
            if destructures_pair {
                self.write(fx, table.value, parts[0]);
                self.write(fx, table.second, parts[1]);
            } else {
                let pair = self.emit_throwing(fx, Op::NewArray(parts.into_iter().collect()));
                self.write(fx, table.value, pair);
            }
        } else {
            let part = match (table.is_map, table.yields) {
                (true, IterationKind::Values) => Operation::MapValueAt,
                (true, _) => Operation::MapKeyAt,
                (false, _) => Operation::SetKeyAt,
            };
            let part = self.operation(fx, part, &[table.collection, entry]);
            self.refresh_collection_table(fx, table);
            self.write(fx, table.value, part);
        }
        fx.b.jump(inside);
        fx.b.switch_to(generally);
        let has = self.emit_throwing(fx, Op::IterHas { iter, index: at });
        fx.b.write(table.found, at);
        self.branch(fx, has, is_there_generally, exit);
        fx.b.seal(is_there_generally);
        fx.b.switch_to(is_there_generally);
        let value = self.emit_throwing(fx, Op::IterGet { iter, index: at });
        self.write(fx, table.value, value);
        fx.b.jump(inside);
    }

    fn collection_entry_parts(&mut self, fx: &mut Fx, table: &CollectionLoop) -> [V; 2] {
        let entry = self.read(fx, table.found);
        let first = self.operation(fx, if table.is_map { Operation::MapKeyAt } else { Operation::SetKeyAt }, &[table.collection, entry]);
        let second = if table.is_map { self.operation(fx, Operation::MapValueAt, &[table.collection, entry]) } else { first };
        self.refresh_collection_table(fx, table);
        [first, second]
    }

    fn refresh_collection_table(&mut self, fx: &mut Fx, table: &CollectionLoop) {
        let now = self.operation(fx, Operation::CollectionTable, &[table.collection]);
        self.write(fx, table.table, now);
    }

    fn is_simple_array_pattern(&self, fx: &Fx, pat: PatId) -> bool {
        let hir = self.hir(fx.file);
        let PatKind::Array(elems) = hir[pat].kind else { return false };
        elems.iter().all(|e| !hir[e].is_rest && hir[e].default.is_none() && matches!(hir[hir[e].pat].kind, PatKind::Ident(_) | PatKind::Missing))
    }

    fn bind_simple_array_pattern(&mut self, fx: &mut Fx, pat: PatId, parts: &[V]) {
        let hir = self.hir(fx.file);
        let PatKind::Array(elems) = hir[pat].kind else { return };
        let ty = self.c.type_of_pat(fx.file, pat);
        let is_declared = !self.c.is_inferred_from_javascript(ty);
        for (i, e) in elems.iter().enumerate() {
            let elem = &hir[e];
            if matches!(hir[elem.pat].kind, PatKind::Missing) {
                continue;
            }
            let member = match parts.get(i) {
                Some(&part) => part,
                None => self.emit(fx, Op::Undefined),
            };
            let claim = if is_declared { self.ty_for_pat(fx, elem.pat, true) } else { TyId::NONE };
            let member = self.coerce_to(fx, member, Ty::from_id(claim), CoerceReason::Claim);
            self.bind_pat(fx, elem.pat, member);
        }
    }

    fn close_loop_iterator(&mut self, fx: &mut Fx, iter: V, is_for_throw: bool) {
        let close = |this: &mut Self, fx: &mut Fx| {
            if is_for_throw {
                this.emit(fx, Op::IterCloseForThrow(iter));
            } else {
                this.emit_throwing(fx, Op::IterClose(iter));
            }
        };
        let Some(&has_none) = fx.skip_close_if.get(&iter) else { return close(self, fx) };
        let (closing, closed) = (fx.b.new_block(), fx.b.new_block());
        self.branch(fx, has_none, closed, closing);
        fx.b.seal(closing);
        fx.b.switch_to(closing);
        close(self, fx);
        fx.b.jump(closed);
        fx.b.seal(closed);
        fx.b.switch_to(closed);
    }

    fn loop_body(&mut self, fx: &mut Fx, label: Atom, body: StmtId, break_to: BlockId, continue_to: BlockId, iter: V) {
        self.loop_body_with_resource(fx, label, body, break_to, continue_to, iter, None);
    }

    fn loop_body_with_resource(&mut self, fx: &mut Fx, label: Atom, body: StmtId, break_to: BlockId, continue_to: BlockId, iter: V, resource: Option<(V, bool)>) {
        let unwind_depth = fx.handlers.len() - usize::from(iter.is_some());
        fx.jumps.push(Jump { label, break_to, continue_to, iter, unwind_depth, is_unlabeled_break_target: true, finally_context: None });
        match resource {
            Some((value, is_await)) => self.with_disposable_stack(fx, is_await, |this, fx| {
                this.add_disposable_resource(fx, value, is_await);
                this.stmt(fx, body);
            }),
            None => self.stmt(fx, body),
        }
        fx.jumps.pop();
    }

    pub(crate) fn emit_return(&mut self, fx: &mut Fx, value: V) {
        let all = fx.jumps.len();
        self.emit_abrupt_completion(fx, 0, all, Exit::Return(value));
    }

    fn emit_abrupt_completion(&mut self, fx: &mut Fx, from: usize, to: usize, exit: Exit) {
        for i in (from..to).rev() {
            let iter = fx.jumps[i].iter;
            if iter.is_some() {
                let inner = fx.handlers.split_off(fx.jumps[i].unwind_depth);
                self.close_loop_iterator(fx, iter, false);
                fx.handlers.extend(inner);
            }
            let Some(context) = &mut fx.jumps[i].finally_context else { continue };
            context.exits.push((from, exit));
            let (entry, completion_type, value, exception, number) = (context.entry, context.completion_type, context.value, context.exception, context.exits.len() as i64 + 1);
            let number = self.emit(fx, Op::Int(number));
            self.write(fx, completion_type, number);
            let undefined = self.emit(fx, Op::Undefined);
            fx.b.write(exception, undefined);
            if let Exit::Return(returned) = exit {
                let returned = if returned.is_some() { returned } else { undefined };
                self.write(fx, value, returned);
            }
            return fx.b.jump(entry);
        }
        match exit {
            Exit::Return(value) if fx.returns_this => {
                let handlers = std::mem::take(&mut fx.handlers);
                let pos = fx.b.pos;
                let result = self.constructor_result(fx, value, pos);
                self.terminate_with_return(fx, result);
                fx.handlers = handlers;
            }
            Exit::Return(value) => self.terminate_with_return(fx, value),
            Exit::Goto(block) => fx.b.jump(block),
        }
    }

    pub(crate) fn try_finally(
        &mut self,
        fx: &mut Fx,
        inspects_thrown_value: bool,
        body: impl FnOnce(&mut Self, &mut Fx),
        finalizer: impl FnOnce(&mut Self, &mut Fx, V, V),
    ) {
        let (entry, thrown, join) = (fx.b.new_block(), fx.b.new_block(), fx.b.new_block());
        let (completion_type, value, exception) = (self.new_selector(fx), self.new_temporary(fx), self.new_temporary(fx));
        fx.jumps.push(Jump {
            label: Atom::NONE,
            break_to: BlockId::NONE,
            continue_to: BlockId::NONE,
            iter: V::NONE,
            unwind_depth: 0,
            is_unlabeled_break_target: false,
            finally_context: Some(FinallyContext { entry, completion_type, value, exception, exits: Vec::new() }),
        });
        fx.handlers.push(thrown);
        body(self, fx);
        fx.handlers.pop();
        let exits = fx.jumps.pop().and_then(|jump| jump.finally_context).map_or(Vec::new(), |context| context.exits);
        let undefined = self.emit(fx, Op::Undefined);
        let zero = self.emit(fx, Op::Int(0));
        self.write(fx, completion_type, zero);
        self.write(fx, value, undefined);
        fx.b.write(exception, undefined);
        fx.b.jump(entry);
        fx.b.seal(thrown);
        fx.b.switch_to(thrown);
        let caught = self.emit(fx, Op::CaughtException);
        let thrown_value = self.emit(fx, if inspects_thrown_value { Op::Caught } else { Op::Undefined });
        let one = self.emit(fx, Op::Int(1));
        self.write(fx, completion_type, one);
        self.write(fx, value, thrown_value);
        fx.b.write(exception, caught);
        fx.b.jump(entry);
        fx.b.seal(entry);
        fx.b.switch_to(entry);
        let (chosen, carried, caught) = (self.read(fx, completion_type), self.read(fx, value), fx.b.read(exception));
        let one = self.emit(fx, Op::Int(1));
        let is_throw = self.emit(fx, Op::StrictEq { a: chosen, b: one });
        finalizer(self, fx, is_throw, carried);
        let rethrow = fx.b.new_block();
        let after: Vec<BlockId> = exits.iter().map(|_| fx.b.new_block()).collect();
        let mut cases = vec![(1, Target::new(rethrow))];
        cases.extend(after.iter().enumerate().map(|(i, &block)| (i as i64 + 2, Target::new(block))));
        fx.b.terminate(Term::Switch { value: chosen, cases, default: Target::new(join) });
        fx.b.seal(rethrow);
        fx.b.switch_to(rethrow);
        let unwind = fx.handlers.last().map(|&handler| Target::new(handler));
        fx.b.terminate(Term::Throw { value: caught, unwind, pos: 0 });
        for (&block, &(from, exit)) in after.iter().zip(&exits) {
            fx.b.seal(block);
            fx.b.switch_to(block);
            let exit = if matches!(exit, Exit::Return(_)) { Exit::Return(carried) } else { exit };
            let all = fx.jumps.len();
            self.emit_abrupt_completion(fx, from.min(all), all, exit);
        }
        fx.b.seal(join);
        fx.b.switch_to(join);
    }

    pub(crate) fn predicted_iterator_class(&mut self, fx: &Fx, iterable: ExprId) -> Option<(Ty, LayoutId)> {
        if !fx.is_typed {
            return None;
        }
        let ty = self.c.type_of_expr(fx.file, iterable);
        if self.c.is_inferred_from_javascript(ty) {
            return None;
        }
        let checked = self.c.type_of_iterator(ty)?;
        let id = self.ty_of(checked);
        let described = self.out.tys.get(id);
        let [Part::Class(layout)] = described.parts[..] else { return None };
        if described.any_object || described.any_function || described.prims & !prim::NULLISH != 0 || described.ints.is_some() {
            return None;
        }
        let LayoutKey::Instance(file, class) = self.layout_keys[layout.idx()] else { return None };
        let facts = self.class_info(file, class).facts;
        let next = self.c.atoms().intern(b"next");
        (facts.has_fixed_layout && facts.is_evaluated_once && self.c.declares_method(checked, next)).then_some((Ty { id, checked }, layout))
    }

    fn loop_binding_pos(&self, fx: &Fx, left: StmtId, iterable: ExprId) -> u32 {
        let hir = self.hir(fx.file);
        match hir[left].kind {
            StmtKind::Var(decls) if !decls.is_empty() => self.pat_last_pos(fx, hir[decls.at(0)].pat),
            StmtKind::Expr(target) => self.last_pos(fx, target),
            _ => hir[iterable].pos,
        }
    }

    fn for_await(&mut self, fx: &mut Fx, stmt: StmtId, left: StmtId, iterable: ExprId, body: StmtId, sync: Option<(Ty, LayoutId)>) {
        let is_await = sync.is_none();
        if is_await && !self.out.funcs[fx.id.idx()].has(func_flags::ASYNC) {
            return self.problem(fx.file, fx.b.pos, "`for await` outside an async function");
        }
        let hir = self.hir(fx.file);
        let label = self.take_label(fx);
        let names = ["next", "return", "done", "value"].map(|name| self.out.strs.intern(name.as_bytes()));
        let [next_name, return_name, done_name, value_name] = names;
        let source = iterable;
        fx.b.pos = self.loop_binding_pos(fx, left, source);
        let iterable = self.iterated(fx, stmt, iterable);
        let iterator = self.operation(fx, if is_await { Operation::GetAsyncIterator } else { Operation::GetIterator }, &[iterable]);
        let next_method = if is_await { self.operation(fx, Operation::GetAsyncIteratorNext, &[iterator]) } else { self.emit_throwing(fx, Op::PropGet { obj: iterator, name: next_name }) };
        let expected = sync.map(|(ty, layout)| {
            let seen = fx.b.new_var(self.or_undefined(ty.id));
            let is_expected = self.emit_throwing(fx, Op::IsInstance { value: iterator, layout });
            let (yes, no, asked) = (fx.b.new_block(), fx.b.new_block(), fx.b.new_block());
            self.branch(fx, is_expected, yes, no);
            fx.b.seal(yes);
            fx.b.seal(no);
            fx.b.switch_to(yes);
            let typed = self.coerce_to(fx, iterator, ty, CoerceReason::Flow);
            self.write(fx, seen, typed);
            fx.b.jump(asked);
            fx.b.switch_to(no);
            let undefined = self.emit(fx, Op::Undefined);
            self.write(fx, seen, undefined);
            fx.b.jump(asked);
            fx.b.seal(asked);
            fx.b.switch_to(asked);
            seen
        });
        let needs_close = self.new_flag(fx);
        let no = self.emit(fx, Op::Bool(false));
        self.write(fx, needs_close, no);
        self.try_finally(
            fx,
            false,
            |this, fx| {
                let (header, inside, next, exit) = (fx.b.new_block(), fx.b.new_block(), fx.b.new_block(), fx.b.new_block());
                fx.b.jump(header);
                fx.b.switch_to(header);
                this.emit(fx, Op::Poll);
                let no = this.emit(fx, Op::Bool(false));
                this.write(fx, needs_close, no);
                let mut stepped = None;
                if let Some(seen) = expected {
                    let (as_expected, there, generally) = (fx.b.new_block(), fx.b.new_block(), fx.b.new_block());
                    let seen = this.read(fx, seen);
                    let is_something_else = this.emit(fx, Op::IsNullish(seen));
                    this.branch(fx, is_something_else, generally, as_expected);
                    fx.b.seal(as_expected);
                    fx.b.seal(generally);
                    fx.b.switch_to(as_expected);
                    let step = this.emit_throwing(fx, Op::CallMethod { obj: seen, name: next_name, args: ir::Args::new() });
                    this.operation(fx, Operation::RequireIteratorResultObject, &[step]);
                    let done = this.emit_throwing(fx, Op::PropGet { obj: step, name: done_name });
                    let done = this.emit(fx, Op::Truthy(done));
                    this.branch(fx, done, exit, there);
                    fx.b.seal(there);
                    fx.b.switch_to(there);
                    let value = this.emit_throwing(fx, Op::PropGet { obj: step, name: value_name });
                    let value = this.coerce_iteration_value(fx, value, source, false);
                    let var = fx.b.new_var(this.ty(fx, value));
                    this.write(fx, var, value);
                    stepped = Some(var);
                    fx.b.jump(inside);
                    fx.b.switch_to(generally);
                }
                let step = if is_await { this.async_iterator_next(fx, iterator, next_method, None) } else { this.emit_throwing(fx, Op::Call { callee: next_method, this: iterator, args: ir::Args::new() }) };
                let step = if is_await { this.emit_throwing(fx, Op::Await(step)) } else { step };
                this.operation(fx, Operation::RequireIteratorResultObject, &[step]);
                let done = this.emit_throwing(fx, Op::PropGet { obj: step, name: done_name });
                let done = this.emit(fx, Op::Truthy(done));
                let there = if stepped.is_some() { fx.b.new_block() } else { inside };
                this.branch(fx, done, exit, there);
                fx.b.seal(there);
                fx.b.switch_to(there);
                let value = this.emit_throwing(fx, Op::PropGet { obj: step, name: value_name });
                if is_await {
                    this.clear_async_iterator_result(fx, next_method, step);
                }
                let mut value = this.coerce_iteration_value(fx, value, source, is_await);
                if let Some(var) = stepped {
                    this.write(fx, var, value);
                    fx.b.jump(inside);
                    fx.b.seal(inside);
                    fx.b.switch_to(inside);
                    value = this.read(fx, var);
                }
                let yes = this.emit(fx, Op::Bool(true));
                this.write(fx, needs_close, yes);
                let mut names = Vec::new();
                let mut target = ExprId::NONE;
                let mut pat = PatId::NONE;
                match hir[left].kind {
                    StmtKind::Var(decls) if !decls.is_empty() => {
                        let d = decls.at(0);
                        pat = hir[d].pat;
                        if hir[d].kind != VarKind::Var {
                            this.pattern_names(fx.file, pat, &mut names);
                        }
                    }
                    StmtKind::Expr(e) => target = e,
                    _ => {}
                }
                let opened = this.open_activation(fx, Activation::Iteration(stmt));
                this.declare(fx, &names);
                if pat.is_some() {
                    this.bind_pat(fx, pat, value);
                } else if target.is_some() {
                    this.assign_to(fx, target, value);
                }
                let resource = this.head_using_kind(fx, left).map(|is_await| (value, is_await));
                this.loop_body_with_resource(fx, label, body, exit, next, V::NONE, resource);
                if opened {
                    this.close_env(fx);
                }
                fx.b.jump(next);
                fx.b.seal(next);
                fx.b.switch_to(next);
                fx.b.jump(header);
                fx.b.seal(header);
                fx.b.seal(exit);
                fx.b.switch_to(exit);
            },
            |this, fx, is_throw, _| {
                let (close, done) = (fx.b.new_block(), fx.b.new_block());
                let needed = this.read(fx, needs_close);
                this.branch(fx, needed, close, done);
                fx.b.seal(close);
                fx.b.switch_to(close);
                let (after_throw, otherwise) = (fx.b.new_block(), fx.b.new_block());
                this.branch(fx, is_throw, after_throw, otherwise);
                fx.b.seal(after_throw);
                fx.b.seal(otherwise);
                fx.b.switch_to(after_throw);
                let ignored = fx.b.new_block();
                fx.handlers.push(ignored);
                let method = this.emit_throwing(fx, Op::PropGet { obj: iterator, name: return_name });
                let is_missing = this.emit(fx, Op::IsNullish(method));
                let call = fx.b.new_block();
                this.branch(fx, is_missing, done, call);
                fx.b.seal(call);
                fx.b.switch_to(call);
                let result = this.emit_throwing(fx, Op::Call { callee: method, this: iterator, args: ir::Args::new() });
                if is_await {
                    this.emit_throwing(fx, Op::Await(result));
                }
                fx.handlers.pop();
                fx.b.jump(done);
                fx.b.seal(ignored);
                fx.b.switch_to(ignored);
                this.emit(fx, Op::Caught);
                fx.b.jump(done);
                fx.b.switch_to(otherwise);
                let method = this.emit_throwing(fx, Op::PropGet { obj: iterator, name: return_name });
                let is_missing = this.emit(fx, Op::IsNullish(method));
                let call = fx.b.new_block();
                this.branch(fx, is_missing, done, call);
                fx.b.seal(call);
                fx.b.switch_to(call);
                let result = this.emit_throwing(fx, Op::Call { callee: method, this: iterator, args: ir::Args::new() });
                let result = if is_await { this.emit_throwing(fx, Op::Await(result)) } else { result };
                this.operation(fx, Operation::RequireIteratorResultObject, &[result]);
                fx.b.jump(done);
                fx.b.seal(done);
                fx.b.switch_to(done);
            },
        );
    }

    fn head_using_kind(&self, fx: &Fx, head: StmtId) -> Option<bool> {
        if head.is_none() {
            return None;
        }
        let hir = self.hir(fx.file);
        let StmtKind::Var(decls) = hir[head].kind else { return None };
        let has = |kind: VarKind| decls.iter().any(|d| hir[d].kind == kind);
        (has(VarKind::Using) || has(VarKind::AwaitUsing)).then(|| has(VarKind::AwaitUsing))
    }

    fn with_disposable_stack(&mut self, fx: &mut Fx, has_await: bool, body: impl FnOnce(&mut Self, &mut Fx)) {
        let stack = self.operation(fx, Operation::NewDisposableStack, &[]);
        let outer = std::mem::replace(&mut fx.disposable_stack, stack);
        self.try_finally(fx, true, body, |this, fx, is_throw, value| this.dispose_resources(fx, stack, has_await, is_throw, value));
        fx.disposable_stack = outer;
    }

    fn add_disposable_resource(&mut self, fx: &mut Fx, value: V, is_await: bool) {
        let is_await = self.emit(fx, Op::Bool(is_await));
        let stack = fx.disposable_stack;
        self.operation(fx, Operation::AddDisposableResource, &[stack, value, is_await]);
    }

    fn dispose_resources(&mut self, fx: &mut Fx, stack: V, has_await: bool, is_throw: V, value: V) {
        if has_await {
            let (record, header) = (fx.b.new_block(), fx.b.new_block());
            self.branch(fx, is_throw, record, header);
            fx.b.seal(record);
            fx.b.switch_to(record);
            self.operation(fx, Operation::RecordDisposeError, &[stack, value]);
            let (step, awaits, exit) = (fx.b.new_block(), fx.b.new_block(), fx.b.new_block());
            fx.b.jump(header);
            fx.b.switch_to(header);
            self.emit(fx, Op::Poll);
            let result = self.operation(fx, Operation::DisposeNextResource, &[stack]);
            let is_empty = self.emit(fx, Op::StrictEq { a: result, b: stack });
            self.branch(fx, is_empty, exit, step);
            fx.b.seal(step);
            fx.b.switch_to(step);
            let null = self.emit(fx, Op::Null);
            let is_sync = self.emit(fx, Op::StrictEq { a: result, b: null });
            self.branch(fx, is_sync, header, awaits);
            fx.b.seal(awaits);
            fx.b.switch_to(awaits);
            let (failed, next) = (fx.b.new_block(), fx.b.new_block());
            fx.handlers.push(failed);
            self.emit_throwing(fx, Op::Await(result));
            fx.handlers.pop();
            fx.b.jump(next);
            fx.b.seal(failed);
            fx.b.switch_to(failed);
            let error = self.emit(fx, Op::Caught);
            self.operation(fx, Operation::RecordDisposeError, &[stack, error]);
            fx.b.jump(next);
            fx.b.seal(next);
            fx.b.switch_to(next);
            fx.b.jump(header);
            fx.b.seal(header);
            fx.b.seal(exit);
            fx.b.switch_to(exit);
        }
        self.operation(fx, Operation::DisposeResources, &[stack, is_throw, value]);
    }

    fn try_catch(&mut self, fx: &mut Fx, block: StmtId, param: bun_sema::hir::VarDeclId, handler: StmtId) {
        let hir = self.hir(fx.file);
        if handler.is_none() {
            return self.stmt(fx, block);
        }
        let (catch, join) = (fx.b.new_block(), fx.b.new_block());
        fx.handlers.push(catch);
        self.stmt(fx, block);
        fx.handlers.pop();
        fx.b.jump(join);
        fx.b.seal(catch);
        fx.b.switch_to(catch);
        let caught = self.emit(fx, Op::Caught);
        let mut names = Vec::new();
        if param.is_some() {
            self.pattern_names(fx.file, hir[param].pat, &mut names);
        }
        let opened = self.open_activation(fx, Activation::Block(handler));
        self.declare(fx, &names);
        if param.is_some() {
            self.bind_pat(fx, hir[param].pat, caught);
        }
        self.stmt(fx, handler);
        if opened {
            self.close_env(fx);
        }
        fx.b.jump(join);
        fx.b.seal(join);
        fx.b.switch_to(join);
    }

    fn iterated(&mut self, fx: &mut Fx, stmt: StmtId, expr: ExprId) -> V {
        let opened = self.c.is_captured_before_iterations(fx.file, stmt) && self.open_activation(fx, Activation::Iteration(stmt));
        let hir = self.hir(fx.file);
        if let StmtKind::ForIn { left, .. } | StmtKind::ForOf { left, .. } = hir[stmt].kind
            && let StmtKind::Var(declarations) = hir[left].kind
            && !declarations.is_empty()
            && hir[declarations.at(0)].kind != VarKind::Var
        {
            let mut names = Vec::new();
            self.pattern_names(fx.file, hir[declarations.at(0)].pat, &mut names);
            names.retain(|&name| self.c.is_referenced_in_tdz(name));
            self.declare(fx, &names);
        }
        let value = self.expr(fx, expr);
        if opened {
            self.close_env(fx);
        }
        value
    }

    fn copy_env(&mut self, fx: &mut Fx, names: &[Sym]) {
        for index in (0..fx.envs.len()).rev() {
            let scope = &fx.envs[index];
            let (layout, var, shares_activation_with_previous) = (scope.layout, scope.var, scope.shares_activation_with_previous);
            let old = self.read(fx, var);
            let new = self.new_environment(fx, layout);
            for sym in names {
                if let Some(&super::Place::Env(of, field)) = self.places.get(sym)
                    && of == layout
                {
                    let value = self.emit(fx, Op::FieldGet { obj: old, layout, field });
                    self.emit(fx, Op::FieldSet { obj: new, layout, field, value });
                }
            }
            self.write(fx, var, new);
            if !shares_activation_with_previous {
                break;
            }
        }
    }

    fn coerce_iteration_value(&mut self, fx: &mut Fx, value: V, iterable: ExprId, is_await: bool) -> V {
        if !fx.is_typed || self.is_untyped_file(fx.file) || self.c.is_predicted(fx.file, iterable) || self.c.holds_unknown_elements(fx.file, iterable) {
            return self.predict_iteration_value(fx, value, iterable, is_await);
        }
        let ty = self.c.type_of_expr(fx.file, iterable);
        if self.c.is_inferred_from_javascript(ty) {
            return self.predict_iteration_value(fx, value, iterable, is_await);
        }
        let ty = self.c.without_number_literals_in_arguments(ty);
        let checked = self.c.iterated_type(ty, is_await);
        let element = Ty { id: self.ty_of(checked), checked };
        self.coerce_to(fx, value, element, CoerceReason::Claim)
    }

    fn ty_for_pat(&mut self, fx: &Fx, pat: PatId, may_be_missing: bool) -> TyId {
        if !fx.is_typed || self.c.is_destructured_from_prediction(fx.file, pat) {
            return TyId::NONE;
        }
        let ty = self.c.type_of_pat(fx.file, pat);
        let ty = self.c.without_number_literals_deep(ty);
        let ty = self.declared(ty);
        if ty.is_some() && may_be_missing { self.or_undefined(ty) } else { ty }
    }

    pub(crate) fn bind_pat(&mut self, fx: &mut Fx, pat: PatId, value: V) {
        let hir = self.hir(fx.file);
        let is_declared = fx.is_typed && !self.is_untyped_file(fx.file) && !matches!(hir[pat].kind, PatKind::Missing | PatKind::Ident(_)) && {
            let ty = self.c.type_of_pat(fx.file, pat);
            !self.c.is_inferred_from_javascript(ty)
        };
        match hir[pat].kind {
            PatKind::Missing => {}
            PatKind::Ident(_) => {
                let id = self.c.bound(fx.file).pat_symbol[pat.idx()];
                if id.is_none() {
                    return;
                }
                if let Some(caught) = self.c.redeclared_catch_parameter(fx.file, pat) {
                    let sym = self.files.sym(fx.file, caught);
                    self.write_sym(fx, sym, value, hir[pat].pos);
                    return;
                }
                let sym = self.files.export_symbol_of_value_symbol_if_exported(self.files.sym(fx.file, id));
                if let Some((of, class)) = self.c.class_required_from_runtime_module(fx.file, pat) {
                    let expected = self.class_object(fx, of, class);
                    let is_same = self.emit(fx, Op::StrictEq { a: value, b: expected });
                    let (same, different) = (fx.b.new_block(), fx.b.new_block());
                    self.branch(fx, is_same, same, different);
                    fx.b.seal(same);
                    fx.b.seal(different);
                    fx.b.switch_to(different);
                    self.throw_error(fx, b"TypeError", b"A class exported by a runtime module was replaced");
                    fx.b.switch_to(same);
                }
                let value = self.predict_binding(fx, value, pat);
                self.initialize_sym(fx, sym, value, hir[pat].pos);
            }
            PatKind::Object(props) => {
                self.require_object_coercible(fx, value);
                let mut taken = vec![value];
                let has_rest = props.iter().any(|p| hir[p].is_rest);
                for p in props.iter() {
                    let prop = &hir[p];
                    if prop.is_rest {
                        let rest = self.operation(fx, Operation::CopyDataPropertiesExcluding, &taken);
                        let checked = self.c.type_of_pat(fx.file, prop.value);
                        let rest = self.coerce_fresh(fx, rest, checked);
                        self.bind_pat(fx, prop.value, rest);
                        continue;
                    }
                    let mut member = match prop.key {
                        PropKey::Name(_) | PropKey::None => {
                            let name = match (prop.key, hir[prop.value].kind) {
                                (PropKey::Name(name), _) | (_, PatKind::Ident(name)) => name,
                                _ => continue,
                            };
                            let name = self.str(name);
                            if has_rest {
                                taken.push(self.emit(fx, Op::Str(name)));
                            }
                            let member = self.emit_throwing(fx, Op::PropGet { obj: value, name });
                            let claim = if is_declared { self.ty_for_pat(fx, prop.value, prop.default.is_some()) } else { TyId::NONE };
                            self.coerce_to(fx, member, Ty::from_id(claim), CoerceReason::Claim)
                        }
                        PropKey::Computed(key) => {
                            let key = self.expr(fx, key);
                            let key = self.emit_throwing(fx, Op::ToKey(key));
                            taken.push(key);
                            let member = self.emit_throwing(fx, Op::ElemGet { obj: value, key });
                            let claim = if is_declared { self.ty_for_pat(fx, prop.value, true) } else { TyId::NONE };
                            self.coerce_to(fx, member, Ty::from_id(claim), CoerceReason::Claim)
                        }
                        PropKey::Private(_) => continue,
                    };
                    if prop.default.is_some() {
                        member = self.emit_default_initializer(fx, member, prop.default, self.pat_name(fx, prop.value));
                    }
                    self.bind_pat(fx, prop.value, member);
                }
            }
            PatKind::Array(elems) if self.is_read_by_index(fx, pat, value) => {
                self.emit_throwing(fx, Op::IterOpen(value));
                for (i, e) in elems.iter().enumerate() {
                    let elem = &hir[e];
                    if matches!(hir[elem.pat].kind, PatKind::Missing) {
                        continue;
                    }
                    let key = self.emit(fx, Op::Int(i as i64));
                    let member = self.emit_throwing(fx, Op::ElemGet { obj: value, key });
                    let claim = if is_declared { self.ty_for_pat(fx, elem.pat, true) } else { TyId::NONE };
                    let member = self.coerce_to(fx, member, Ty::from_id(claim), CoerceReason::Claim);
                    self.bind_pat(fx, elem.pat, member);
                }
            }
            PatKind::Array(elems) => {
                let it = self.open_pattern_iterator(fx, value);
                for (i, e) in elems.iter().enumerate() {
                    let elem = &hir[e];
                    if elem.is_rest {
                        let rest = self.collect_pattern_iterator_rest(fx, &it, i as i64);
                        self.with_pattern_iterator_close(fx, &it, |this, fx| this.bind_pat(fx, elem.pat, rest));
                        break;
                    }
                    let is_elision = matches!(hir[elem.pat].kind, PatKind::Missing);
                    let claim = if is_declared && !is_elision { self.ty_for_pat(fx, elem.pat, true) } else { TyId::NONE };
                    let member = self.step_pattern_iterator(fx, &it, i as i64, !is_elision, claim);
                    if is_elision {
                        continue;
                    }
                    self.with_pattern_iterator_close(fx, &it, |this, fx| {
                        let mut member = member;
                        if elem.default.is_some() {
                            member = this.emit_default_initializer(fx, member, elem.default, this.pat_name(fx, elem.pat));
                        }
                        this.bind_pat(fx, elem.pat, member);
                    });
                }
                self.close_pattern_iterator(fx, it);
            }
        }
    }

    fn is_read_by_index(&self, fx: &Fx, pat: PatId, value: V) -> bool {
        let hir = self.hir(fx.file);
        let PatKind::Array(elems) = hir[pat].kind else { return false };
        let described = self.out.tys.get(self.ty(fx, value));
        fx.is_typed
            && !described.parts.is_empty()
            && described.parts.iter().all(|part| matches!(part, Part::Array(_)))
            && !described.any_object
            && !described.any_function
            && described.prims & !prim::NULLISH == 0
            && described.ints.is_none()
            && elems.iter().all(|e| !hir[e].is_rest && hir[e].default.is_none() && matches!(hir[hir[e].pat].kind, PatKind::Ident(_) | PatKind::Missing))
            && elems.iter().any(|e| matches!(hir[hir[e].pat].kind, PatKind::Ident(_)))
    }

    pub(crate) fn pat_name(&self, fx: &Fx, pat: PatId) -> Atom {
        let PatKind::Ident(name) = self.hir(fx.file)[pat].kind else { return Atom::NONE };
        let mut bound = Vec::new();
        self.pattern_names(fx.file, pat, &mut bound);
        if bound.first().is_some_and(|&sym| self.is_exported_by_namespace(sym)) { Atom::NONE } else { name }
    }
}
