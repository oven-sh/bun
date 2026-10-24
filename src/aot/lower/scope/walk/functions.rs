use bun_sema::bind::{CodeUnit, Decl, EvalScope, FnOwner, ScopeId, ScopeKind};
use bun_sema::check::aot::FunctionRef;
use bun_sema::hir::{FnBody, FnId, FnKind, StmtId};

use super::{Context, EvalUse, Initialization, PatternRole, Task, WalkedFunctionId, Walker};
use crate::ir::{ClassSlot, FunctionKey};
use crate::lower::scope::{BindingRef, ScopeSlot};
use crate::lower::{class, commonjs};

impl Walker<'_, '_> {
    pub(super) fn is_live_function(&self, function: FnId) -> bool {
        function.is_some()
            && !matches!(self.hir[function].body, FnBody::None)
            && !self.decisions.is_dead_function(function)
    }

    pub(super) fn visit_function(&mut self, function: FnId, creator: WalkedFunctionId) {
        if let Some(id) = self.declare_function(function, creator) {
            self.push_function(function, id);
        }
    }

    pub(super) fn declare_function(
        &mut self,
        function: FnId,
        creator: WalkedFunctionId,
    ) -> Option<WalkedFunctionId> {
        if !self.is_live_function(function) || self.walk.function_of_fn[function.idx()].is_some() {
            return None;
        }
        let file = self.input.file;
        let key = FunctionKey::Source(FunctionRef { file, function });
        let id = self.add_function(key, Some(creator));
        self.walk.function_of_fn[function.idx()] = Some(id);
        Some(id)
    }

    fn push_function(&mut self, function: FnId, id: WalkedFunctionId) {
        let context = self.enter_unit(id, self.bound.fns[function.idx()].scope);
        self.push_task(Task::MarkCreated(id), context);
        self.push_function_code(function, context);
    }

    pub(super) fn push_function_code(&mut self, function: FnId, context: Context) {
        let hir = self.hir;
        for parameter in hir[function].params.iter() {
            self.push_expressions([hir[parameter].default], context);
            self.visit_pattern(hir[parameter].pat, PatternRole::Parameter, context);
        }
        match hir[function].body {
            FnBody::Block(statements) => self.push_statements(hir.ids(statements), context),
            FnBody::Expr(expression) => self.push_expressions([expression], context),
            FnBody::None => {}
        }
    }

    pub(super) fn visit_function_statement(
        &mut self,
        statement: StmtId,
        function: FnId,
        context: Context,
    ) {
        let bound = self.bound;
        let Some(id) = self.declare_function(function, context.function) else {
            return;
        };
        let symbol = bound.declared_symbol(Decl::Fn(function));
        if symbol.is_some() {
            let outer_scope = bound.scope_of_stmt(statement);
            let scope = bound.symbol_scope(symbol).some().unwrap_or(outer_scope);
            self.walk.hoisted_functions.push((scope, symbol, function));
            self.walk.functions[id.index()].hoisted_to = Some(scope);
            let initialization = &mut self.walk.symbol_initializations[symbol.idx()];
            initialization.get_or_insert(Initialization::WITH_HOISTED_FUNCTIONS);
        }
        let annex_b_functions = bound.runtime.annex_b_functions();
        let found = annex_b_functions.binary_search_by_key(&function, |entry| entry.function);
        if let Ok(index) = found {
            let entry = annex_b_functions[index];
            self.record_store(context, BindingRef::Symbol(entry.var_symbol));
            self.record_symbol_use(context, entry.block_symbol);
            self.record_symbol_use(context, entry.var_symbol);
            self.push_initialization(entry.var_symbol, context);
        }
        self.push_function(function, id);
    }

    fn use_lexical_slot(&mut self, context: Context, slot: ScopeSlot) {
        self.record_slot_use(context.function, context.lexical_scope, slot);
    }

    pub(super) fn use_this(&mut self, context: Context) {
        let has_this = match self.bound.code_unit(context.lexical_scope) {
            CodeUnit::File => self.is_commonjs,
            CodeUnit::Function(_) | CodeUnit::FieldInitializer(_) => true,
        };
        if has_this {
            self.use_lexical_slot(context, ScopeSlot::This);
        }
    }

    pub(super) fn use_new_target(&mut self, context: Context) {
        let function = match self.bound.code_unit(context.lexical_scope) {
            CodeUnit::Function(function) => function,
            CodeUnit::File | CodeUnit::FieldInitializer(_) => return,
        };
        match self.hir.runtime_function_kind(function) {
            FnKind::Decl | FnKind::Expr | FnKind::Constructor => {
                self.use_lexical_slot(context, ScopeSlot::NewTarget);
            }
            FnKind::Arrow
            | FnKind::Method
            | FnKind::Getter
            | FnKind::Setter
            | FnKind::StaticBlock
            | FnKind::CallSignature
            | FnKind::ConstructSignature
            | FnKind::FunctionType
            | FnKind::ConstructorType
            | FnKind::IndexSignature => {}
        }
    }

    pub(super) fn use_home_object(&mut self, context: Context) {
        let function = match self.bound.code_unit(context.lexical_scope) {
            CodeUnit::Function(function) => function,
            CodeUnit::File | CodeUnit::FieldInitializer(_) => {
                return self.use_class_object(context);
            }
        };
        match self.bound.fns[function.idx()].owner {
            FnOwner::Expr(_) => {}
            FnOwner::None | FnOwner::Stmt(_) | FnOwner::Member(_) | FnOwner::Type(_) => {
                return self.use_class_object(context);
            }
        }
        match self.hir[function].kind {
            FnKind::Method | FnKind::Getter | FnKind::Setter => {
                self.use_lexical_slot(context, ScopeSlot::HomeObject);
            }
            FnKind::Decl
            | FnKind::Expr
            | FnKind::Arrow
            | FnKind::Constructor
            | FnKind::StaticBlock
            | FnKind::CallSignature
            | FnKind::ConstructSignature
            | FnKind::FunctionType
            | FnKind::ConstructorType
            | FnKind::IndexSignature => {}
        }
    }

    pub(super) fn use_class_object(&mut self, context: Context) {
        let class = match self.bound.code_unit(context.lexical_scope) {
            CodeUnit::File => None,
            CodeUnit::Function(function) => self.bound.function_class(function),
            CodeUnit::FieldInitializer(member) => self.bound.member_class(member),
        };
        if let Some(class) = class {
            let slot = ScopeSlot::Class(ClassSlot::ClassObject);
            self.record_slot_use(context.function, self.bound.class_scope[class.idx()], slot);
        }
    }

    pub(super) fn use_arguments_binding(
        &mut self,
        owner: CodeUnit,
        is_store: bool,
        context: Context,
    ) {
        let creator = match owner {
            CodeUnit::File if self.walk.has_wrapper_parameters => {
                Some(WalkedFunctionId::MODULE_BODY)
            }
            CodeUnit::File | CodeUnit::FieldInitializer(_) => return,
            CodeUnit::Function(function) => self.walk.function_of_fn[function.idx()],
        };
        let scope = self.bound.top_scope(self.hir, owner);
        self.record_slot_use(context.function, scope, ScopeSlot::ArgumentsBinding);
        if let Some(creator) = creator {
            self.record_slot_use(creator, scope, ScopeSlot::Arguments);
        }
        if is_store {
            self.record_slot_store(context, scope, ScopeSlot::ArgumentsBinding);
        }
    }

    fn record_eval_use(&mut self, context: Context, binding: BindingRef, time: u32) {
        self.walk.uses.push((context.function, binding));
        self.walk.eval_uses.push(EvalUse {
            function: context.function,
            binding,
            time,
        });
    }

    pub(super) fn visit_direct_eval(&mut self, eval: EvalScope, context: Context) {
        let (hir, bound) = (self.hir, self.bound);
        let time = self.tick();
        for symbol in bound.ids(eval.symbols) {
            self.record_eval_use(context, BindingRef::Symbol(symbol), time);
            self.record_store(context, BindingRef::Symbol(symbol));
        }
        let first_use = self.walk.uses.len();
        self.use_this(context);
        self.use_new_target(context);
        self.use_home_object(context);
        for index in first_use..self.walk.uses.len() {
            let (function, binding) = self.walk.uses[index];
            self.walk.eval_uses.push(EvalUse {
                function,
                binding,
                time,
            });
        }
        self.record_eval_function_slots(eval, context, time);
        if self.walk.has_wrapper_parameters {
            for variable in commonjs::undeclared_wrapper_parameters(bound) {
                let slot = ScopeSlot::CommonJs(variable);
                self.record_eval_use(context, BindingRef::Slot(self.file_scope, slot), time);
                self.record_slot_store(context, self.file_scope, slot);
            }
        }
        self.record_scope_chain(context.function, eval.scope, ScopeId::NONE);
        let parent_of = |&scope: &ScopeId| bound.runtime_parent_scope(hir, scope).some();
        for scope in std::iter::successors(eval.scope.some(), parent_of) {
            let ScopeKind::Class(class) = bound.scopes[scope.idx()].kind else {
                continue;
            };
            for slot in class::class_slots(hir, bound, self.input.compiled.settings, class) {
                match slot {
                    ClassSlot::ComputedKey(_) | ClassSlot::DecoratorState => {}
                    _ => {
                        let binding = BindingRef::Slot(scope, ScopeSlot::Class(slot));
                        self.record_eval_use(context, binding, time);
                    }
                }
            }
        }
    }

    fn record_eval_arguments_slots(&mut self, eval: EvalScope, context: Context, time: u32) {
        let scope = context.lexical_scope;
        for slot in [ScopeSlot::Arguments, ScopeSlot::ArgumentsBinding] {
            self.record_eval_use(context, BindingRef::Slot(scope, slot), time);
        }
        if eval.is_sloppy {
            self.record_slot_store(context, scope, ScopeSlot::ArgumentsBinding);
        }
    }

    fn record_eval_function_slots(&mut self, eval: EvalScope, context: Context, time: u32) {
        let scope = context.lexical_scope;
        let function = match self.bound.code_unit(scope) {
            CodeUnit::Function(function) => function,
            CodeUnit::File if self.walk.has_wrapper_parameters => {
                return self.record_eval_arguments_slots(eval, context, time);
            }
            CodeUnit::File | CodeUnit::FieldInitializer(_) => return,
        };
        let kind = self.hir.runtime_function_kind(function);
        if kind != FnKind::StaticBlock {
            self.record_eval_arguments_slots(eval, context, time);
        }
        if kind == FnKind::Constructor {
            self.record_slot_store(context, scope, ScopeSlot::This);
            self.use_lexical_slot(context, ScopeSlot::Callee);
            let reference = (context.function, function);
            self.walk.function_references.push(reference);
        }
    }
}
