use bun_sema::bind::{CommonJsVariable, Decl, ScopeId, SymbolId};
use bun_sema::hir::{Flags, Span, StmtId, StmtKind, VarDeclId, VarKind};

use super::{Context, PatternRole, Task, WalkedLoop, WalkedTry, Walker};
use crate::lower::scope::ScopeSlot;

impl Walker<'_, '_> {
    pub(super) fn visit_statement(&mut self, statement: StmtId, context: Context) {
        if statement.is_none() || self.decisions.is_dead_stmt(statement) {
            return;
        }
        let is_module_body = self.walk.functions[context.function.index()]
            .creator
            .is_none();
        if is_module_body && self.input.modules.erased(self.input.file, statement) {
            return;
        }
        let (hir, bound) = (self.hir, self.bound);
        let own_scope = bound.own_scope(statement);
        let outer_scope = bound.scope_of_stmt(statement);
        self.enter_scope(own_scope, context);
        if let StmtKind::Expr(expression) = hir[statement].kind
            && !context.is_conditional
        {
            self.unconditional_statements.push(expression);
        }
        match hir[statement].kind {
            StmtKind::Expr(expression)
            | StmtKind::Return(expression)
            | StmtKind::Throw(expression) => self.push_expressions([expression], context),
            StmtKind::ExportNamed(_) => {}
            StmtKind::ExportDefault(value) => {
                self.push_expressions([value], context);
                let symbol = bound.declared_symbol(Decl::ExportExpr(statement));
                self.push_initialization(symbol, context);
            }
            StmtKind::ExportAssign(value) => {
                if self.walk.has_wrapper_parameters {
                    let slot = ScopeSlot::CommonJs(CommonJsVariable::Module);
                    self.record_slot_use(context.function, self.file_scope, slot);
                }
                self.push_expressions([value], context);
            }
            StmtKind::Var(declarations) => self.visit_variables(declarations, false, context),
            StmtKind::Fn(function) => self.visit_function_statement(statement, function, context),
            StmtKind::Class(class) if hir[class].flags.contains(Flags::AMBIENT) => {}
            StmtKind::Class(class) => {
                self.visit_class(class, context);
                self.push_initialization(bound.declared_symbol(Decl::Class(class)), context);
            }
            StmtKind::Enum(id) if hir[id].flags.contains(Flags::AMBIENT) => {}
            StmtKind::Enum(id) => {
                self.push_initialization(bound.declared_symbol(Decl::Enum(id)), context);
                self.enter_container_scope(bound.enum_scope[id.idx()], context);
                for member in hir[id].members.iter() {
                    let member = hir[member];
                    self.push_expressions([member.computed_name, member.init], context);
                }
            }
            StmtKind::Module(id) => {
                if bound.makes_namespace_object(hir, id) {
                    self.push_initialization(bound.declared_symbol(Decl::Module(id)), context);
                    self.enter_container_scope(bound.module_scope[id.idx()], context);
                    self.push_statements(hir.ids(hir[id].body), context);
                }
            }
            StmtKind::ImportEquals(import) => {
                self.note_binding_is_looked_at(bound.entity_root_binding(import));
                self.record_binding_use(context, bound.entity_root_binding(import), false);
                let symbol = bound.declared_symbol(Decl::ImportEquals(import));
                self.push_initialization(symbol, context);
            }
            StmtKind::If { test, yes, no } => {
                self.note_name_that_nobody_looks_at(test);
                self.push_expressions([test], context);
                self.push_statements([yes, no], context.conditional());
            }
            StmtKind::Labeled { body, .. } => {
                self.push_statements([body], context.conditional());
            }
            StmtKind::Block(list) => self.push_statements(hir.ids(list), context),
            StmtKind::With { object, body } => {
                self.record_slot_use(context.function, own_scope, ScopeSlot::WithObject);
                self.push_expressions([object], context);
                self.push_statements([body], context.conditional());
            }
            StmtKind::Switch { expr, cases } => {
                if own_scope.is_some() {
                    self.walk.is_switch_scope[own_scope.idx()] = true;
                }
                self.push_expressions([expr], context);
                self.push_expressions(cases.iter().map(|case| hir[case].test), context);
                for case in cases.iter() {
                    self.push_statements(hir.ids(hir[case].body), context.conditional());
                }
            }
            StmtKind::For {
                init,
                test,
                update,
                body,
            } => {
                self.push_statements([init], context);
                let boundary = own_scope.some().unwrap_or(outer_scope);
                let inner = self.enter_loop(statement, boundary, context);
                self.push_expressions([test, update], inner);
                self.push_loop_body(body, inner);
            }
            StmtKind::ForIn { left, expr, body }
            | StmtKind::ForOf {
                left, expr, body, ..
            } => {
                if let StmtKind::Var(declarations) = hir[left].kind {
                    let initializers = declarations.iter().map(|id| hir[id].init);
                    self.push_expressions(initializers, context);
                }
                self.push_expressions([expr], context);
                let inner = self.enter_loop(statement, outer_scope, context);
                match hir[left].kind {
                    StmtKind::Var(declarations) => self.visit_variables(declarations, true, inner),
                    _ => self.push_statements([left], inner),
                }
                self.push_loop_body(body, inner);
            }
            StmtKind::While { test, body } | StmtKind::DoWhile { body, test } => {
                let inner = self.enter_loop(statement, outer_scope, context);
                self.push_expressions([test], inner);
                self.push_loop_body(body, inner);
            }
            StmtKind::Try {
                block,
                param,
                handler,
                finalizer,
            } => {
                let context = context.conditional();
                let index = self.walk.tries.len() as u32;
                self.walk.tries.push(WalkedTry {
                    statement,
                    boundary: outer_scope,
                    function: context.function,
                    parent: context.enclosing_try,
                    stored: Vec::new(),
                    size: self.number_walked,
                });
                let covered = Context {
                    enclosing_try: Some(index),
                    ..context
                };
                self.push_statements([block], covered);
                let around_handler = if finalizer.is_some() {
                    covered
                } else {
                    context
                };
                if param.is_some() {
                    let pattern = hir[param].pat;
                    self.visit_pattern(pattern, PatternRole::LexicalDeclaration, around_handler);
                }
                self.push_statements([handler], around_handler);
                self.push_statements([finalizer], context);
                self.push_task(Task::EndTry(index), context);
            }
            StmtKind::Empty
            | StmtKind::Debugger
            | StmtKind::Break(_)
            | StmtKind::Continue(_)
            | StmtKind::Interface(_)
            | StmtKind::TypeAlias(_)
            | StmtKind::Import(_)
            | StmtKind::ExportStar { .. }
            | StmtKind::ExportAsNamespace(_)
            | StmtKind::Directive { .. } => {}
        }
    }

    fn enter_container_scope(&mut self, scope: ScopeId, context: Context) {
        let parameter = self.bound.container_parameter(scope);
        self.push_task(Task::InitializeParameter(parameter), context);
        self.enter_scope(scope, context);
    }

    pub(super) fn push_initialization(&mut self, symbol: SymbolId, context: Context) {
        self.push_task(Task::InitializeSymbol(symbol), context);
    }

    fn push_loop_body(&mut self, body: StmtId, inner: Context) {
        self.push_statements([body], inner);
        if let Some(index) = inner.enclosing_loop {
            self.push_task(Task::EndLoop(index), inner);
        }
    }

    fn enter_loop(&mut self, statement: StmtId, boundary: ScopeId, outer: Context) -> Context {
        let index = self.walk.loops.len() as u32;
        let around = outer.enclosing_loop;
        let entered_at = self.tick();
        self.walk.loops.push(WalkedLoop {
            statement,
            boundary,
            function: outer.function,
            parent: around,
            entered_at,
            outermost: around.map_or(index, |around| self.walk.loops[around as usize].outermost),
            stored: Vec::new(),
            symbols_stored_within: Vec::new(),
        });
        let inner = Context {
            enclosing_loop: Some(index),
            is_repeated: true,
            is_conditional: true,
            ..outer
        };
        self.enter_scope(self.bound.own_scope(statement), inner);
        inner
    }

    fn visit_variables(&mut self, list: Span<VarDeclId>, is_loop_head: bool, context: Context) {
        for id in list.iter() {
            let declaration = self.hir[id];
            if declaration.flags.contains(Flags::AMBIENT) {
                continue;
            }
            let role = match self.bound.variable_kind(self.hir, id) {
                VarKind::Var if is_loop_head || declaration.init.is_some() => {
                    PatternRole::StoredVar
                }
                VarKind::Var => PatternRole::UnstoredVar,
                VarKind::Let | VarKind::Const | VarKind::Using | VarKind::AwaitUsing => {
                    PatternRole::LexicalDeclaration
                }
            };
            if !is_loop_head {
                self.push_expressions([declaration.init], context);
            }
            self.visit_pattern(declaration.pat, role, context);
        }
    }
}
