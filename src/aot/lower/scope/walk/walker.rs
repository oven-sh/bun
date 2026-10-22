use bun_sema::bind::{Binding, Bound, Decl, ScopeId, ScopeKind, SymbolId};
use bun_sema::check::aot::FunctionRef;
use bun_sema::fold::{TreeNode, push_children};
use bun_sema::hir::{ExprId, FnId, StmtId, is_moved_to_file_start};
use rustc_hash::FxHashMap;
use smallvec::SmallVec;

use super::prepass::{
    collect_class_decorators, collect_eval_variable_scopes, collect_implicit_uses,
    collect_inner_module_parameters,
};
use super::{
    Context, Initialization, ScopeWalk, Task, WalkInput, WalkedFunction, WalkedFunctionId, Walker,
};
use crate::ir::FunctionKey;
use crate::lower::scope::{BindingRef, ScopeSlot};

pub(super) fn run(input: &WalkInput<'_, '_>) -> ScopeWalk {
    let mut walker = Walker::new(input);
    walker.walk_module();
    let mut walk = walker.walk;
    sort_unique(&mut walk.uses);
    sort_unique(&mut walk.function_references);
    sort_unique(&mut walk.eval_uses);
    sort_unique(&mut walk.stored_slots);
    walk.symbol_stores.sort_unstable_by_key(|store| store.0);
    sort_unique(&mut walk.function_of_field);
    sort_unique(&mut walk.slot_initializations);
    for walked_loop in &mut walk.loops {
        sort_unique(&mut walked_loop.stored);
    }
    merge_redeclared_functions(&mut walk.hoisted_functions);
    walk
}

pub(super) fn sort_unique<T: Ord>(list: &mut Vec<T>) {
    list.sort_unstable();
    list.dedup();
}

pub(super) fn entries_of<K: Copy + Ord, V>(list: &[(K, V)], key: K) -> &[(K, V)] {
    let start = list.partition_point(|entry| entry.0 < key);
    let length = list[start..].partition_point(|entry| entry.0 == key);
    &list[start..start + length]
}

pub(super) fn bindings_of<K: Copy + Ord>(
    list: &[(K, Binding)],
    key: K,
) -> SmallVec<[Binding; 4]> {
    entries_of(list, key).iter().map(|entry| entry.1).collect()
}

pub(super) fn scope_chain(bound: &Bound<'_>, from: ScopeId) -> impl Iterator<Item = ScopeId> {
    let parent_of = move |scope: &ScopeId| bound.scopes[scope.idx()].parent.some();
    std::iter::successors(from.some(), parent_of)
}

fn merge_redeclared_functions(functions: &mut Vec<(ScopeId, SymbolId, FnId)>) {
    functions.sort_by_key(|entry| entry.0);
    let mut positions: FxHashMap<(ScopeId, SymbolId), usize> = FxHashMap::default();
    let mut length = 0;
    for index in 0..functions.len() {
        let entry = functions[index];
        let position = *positions.entry((entry.0, entry.1)).or_insert(length);
        functions[position] = entry;
        if position == length {
            length += 1;
        }
    }
    functions.truncate(length);
}

impl<'x, 's> Walker<'x, 's> {
    fn new(input: &'x WalkInput<'x, 's>) -> Walker<'x, 's> {
        let (hir, bound) = (input.hir, input.bound);
        let decisions = &input.compiled.analysis.decisions;
        let (jsx_uses, metadata_uses) = collect_implicit_uses(bound);
        Walker {
            input,
            hir,
            bound,
            decisions,
            file_scope: bound.scope_of_declaration(hir, Decl::File),
            inner_module_parameters: collect_inner_module_parameters(
                hir,
                bound,
                input.modules.inner_modules(input.file),
            ),
            jsx_uses,
            metadata_uses,
            class_decorators: collect_class_decorators(hir, bound),
            last_users: vec![None; bound.symbols.len()],
            pending_stores: Vec::new(),
            clock: 0,
            walk: ScopeWalk {
                function_of_fn: vec![None; hir.fns.len()],
                symbol_initializations: vec![None; bound.symbols.len()],
                last_store_times: vec![0; bound.symbols.len()],
                is_initialized_conditionally: vec![false; bound.symbols.len()],
                is_switch_scope: vec![false; bound.scopes.len()],
                is_repeated_scope: vec![false; bound.scopes.len()],
                eval_variable_scopes: collect_eval_variable_scopes(bound, decisions),
                has_wrapper_parameters: input.has_wrapper_parameters,
                ..ScopeWalk::default()
            },
            stack: Vec::new(),
            children: Vec::new(),
        }
    }

    fn walk_module(&mut self) {
        let key = FunctionKey::ModuleBody(self.input.file);
        let root = Context {
            function: self.add_function(key, None),
            lexical_scope: self.input.lexical_owners[self.file_scope.idx()],
            enclosing_loop: None,
            is_repeated: false,
            is_conditional: false,
        };
        let inner_bodies = self.declare_inner_module_bodies();
        self.enter_scope(self.file_scope, root);
        let hir = self.hir;
        let moves = self.input.moves_statements_to_file_start;
        let is_moved = |statement: &StmtId| moves && is_moved_to_file_start(hir, *statement);
        let moved = hir.ids(hir.body).filter(is_moved);
        let others = hir.ids(hir.body).filter(|statement| !is_moved(statement));
        self.push_statements(moved.chain(others), root);
        self.run_pushed_tasks();
        for (function, id) in inner_bodies {
            self.push_function_code(function, id);
            self.run_pushed_tasks();
        }
    }

    // The callback of `__commonJS(cb)` or `__esm(fn)` is the body of a module of its own. Whoever evaluates that module calls it,
    // and nothing creates a closure of it, so it has no creator and no captures. It is declared ahead of the statement that it
    // is written in, which then finds nothing to walk.
    fn declare_inner_module_bodies(&mut self) -> Vec<(FnId, WalkedFunctionId)> {
        let file = self.input.file;
        let callbacks = self.input.modules.inner_modules(file);
        let mut bodies = Vec::with_capacity(callbacks.len());
        for &function in callbacks {
            if !self.is_live_function(function) {
                continue;
            }
            let id = self.add_function(FunctionKey::Source(FunctionRef { file, function }), None);
            self.walk.function_of_fn[function.idx()] = Some(id);
            bodies.push((function, id));
        }
        bodies
    }

    fn run_pushed_tasks(&mut self) {
        self.stack.reverse();
        while let Some((task, context)) = self.stack.pop() {
            let first_child = self.stack.len();
            self.run_task(task, context);
            self.stack[first_child..].reverse();
        }
    }

    pub(super) fn is_module_body(&self, function: WalkedFunctionId) -> bool {
        self.walk.functions[function.index()].creator.is_none()
    }

    fn run_task(&mut self, task: Task, context: Context) {
        match task {
            Task::Statement(statement) => self.visit_statement(statement, context),
            Task::Expression(expression) => self.visit_expression(expression, context),
            Task::MarkCreated(function) => {
                let time = self.tick();
                self.walk.functions[function.index()].created_at = time;
            }
            Task::InitializeSymbol {
                symbol,
                precedes_hoisted_functions,
            } => self.initialize_symbol(symbol, precedes_hoisted_functions, context),
            Task::InitializeSlot(scope, slot) => {
                let time = self.tick();
                self.walk.slot_initializations.push(((scope, slot), time));
            }
            Task::EndStores { first_pending } => {
                let time = self.tick();
                for symbol in self.pending_stores.drain(first_pending as usize..) {
                    self.walk.last_store_times[symbol.idx()] = time;
                }
            }
            Task::EndLoop(index) => {
                let time = self.tick();
                for &binding in &self.walk.loops[index as usize].stored {
                    if let BindingRef::Symbol(symbol) = binding {
                        let last = &mut self.walk.last_store_times[symbol.idx()];
                        *last = (*last).max(time);
                    }
                }
            }
        }
    }

    pub(super) fn tick(&mut self) -> u32 {
        self.clock += 1;
        self.clock
    }

    pub(super) fn add_function(
        &mut self,
        key: FunctionKey,
        creator: Option<WalkedFunctionId>,
    ) -> WalkedFunctionId {
        self.walk.functions.push(WalkedFunction {
            key,
            creator,
            created_at: 0,
            hoisted_to: None,
        });
        WalkedFunctionId(self.walk.functions.len() as u32 - 1)
    }

    pub(super) fn push_task(&mut self, task: Task, context: Context) {
        self.stack.push((task, context));
    }

    pub(super) fn push_statements(
        &mut self,
        statements: impl IntoIterator<Item = StmtId>,
        context: Context,
    ) {
        for statement in statements {
            self.push_task(Task::Statement(statement), context);
        }
    }

    pub(super) fn push_expressions(
        &mut self,
        expressions: impl IntoIterator<Item = ExprId>,
        context: Context,
    ) {
        for expression in expressions {
            self.push_task(Task::Expression(expression), context);
        }
    }

    pub(super) fn push_evaluated_children(&mut self, expression: ExprId, context: Context) {
        let mut children = std::mem::take(&mut self.children);
        children.clear();
        push_children(self.hir, TreeNode::Expr(expression), &mut children);
        for &child in &children {
            match child {
                TreeNode::Expr(child) => self.push_task(Task::Expression(child), context),
                TreeNode::Stmt(_)
                | TreeNode::Function(_)
                | TreeNode::Class(_)
                | TreeNode::Pattern(_) => {
                    debug_assert!(false, "every child of this expression is an expression");
                }
            }
        }
        self.children = children;
    }

    pub(super) fn enter_scope(&mut self, scope: ScopeId, context: Context) {
        if scope.is_some() && context.is_repeated {
            self.walk.is_repeated_scope[scope.idx()] = true;
        }
    }

    pub(super) fn record_use(&mut self, function: WalkedFunctionId, binding: BindingRef) {
        self.walk.uses.push((function, binding));
    }

    pub(super) fn record_symbol_use(&mut self, context: Context, symbol: SymbolId) {
        let last_user = &mut self.last_users[symbol.idx()];
        if *last_user == Some(context.function) {
            return;
        }
        *last_user = Some(context.function);
        self.record_use(context.function, BindingRef::Symbol(symbol));
    }

    pub(super) fn record_slot_use(
        &mut self,
        function: WalkedFunctionId,
        scope: ScopeId,
        slot: ScopeSlot,
    ) {
        if scope.is_some() {
            self.record_use(function, BindingRef::Slot(scope, slot));
        }
    }

    pub(super) fn record_store(&mut self, context: Context, binding: BindingRef) {
        let mut next = context.enclosing_loop;
        while let Some(index) = next {
            let walked_loop = &mut self.walk.loops[index as usize];
            walked_loop.stored.push(binding);
            next = walked_loop.parent;
        }
    }

    pub(super) fn record_slot_store(&mut self, context: Context, scope: ScopeId, slot: ScopeSlot) {
        self.walk.stored_slots.push((scope, slot));
        self.record_store(context, BindingRef::Slot(scope, slot));
    }

    pub(super) fn record_scope_chain(
        &mut self,
        function: WalkedFunctionId,
        from: ScopeId,
        until: ScopeId,
    ) {
        let bound = self.bound;
        for scope in scope_chain(bound, from).take_while(|&scope| scope != until) {
            match bound.scopes[scope.idx()].kind {
                ScopeKind::With(_) => self.record_slot_use(function, scope, ScopeSlot::WithObject),
                ScopeKind::File
                | ScopeKind::Module(_)
                | ScopeKind::Fn(_)
                | ScopeKind::Block
                | ScopeKind::Class(_)
                | ScopeKind::Interface(_)
                | ScopeKind::TypeAlias(_)
                | ScopeKind::TypeParams
                | ScopeKind::Enum(_)
                | ScopeKind::TypeParamList(_)
                | ScopeKind::Param(_)
                | ScopeKind::ReturnType(_)
                | ScopeKind::Extends
                | ScopeKind::InferConstraint
                | ScopeKind::StaticMember
                | ScopeKind::ComputedName
                | ScopeKind::BaseExpression
                | ScopeKind::FunctionName(_)
                | ScopeKind::PropertyDeclaration(..)
                | ScopeKind::PropertyType(..)
                | ScopeKind::FieldInitializer(_)
                | ScopeKind::ClassDecorators(_)
                | ScopeKind::ImplicitBlock(_) => {
                    if self.walk.eval_variable_scopes.binary_search(&scope).is_ok() {
                        self.record_slot_use(function, scope, ScopeSlot::EvalVariables);
                    }
                }
            }
        }
    }

    fn initialize_symbol(
        &mut self,
        symbol: SymbolId,
        precedes_hoisted_functions: bool,
        context: Context,
    ) {
        if symbol.is_none() {
            return;
        }
        let scope = self.bound.symbol_scope(symbol);
        if scope.is_some() && self.walk.is_switch_scope[scope.idx()] {
            return;
        }
        if self.walk.symbol_initializations[symbol.idx()].is_none() {
            let time = self.tick();
            self.walk.symbol_initializations[symbol.idx()] = Some(Initialization {
                time,
                precedes_hoisted_functions,
            });
            self.walk.is_initialized_conditionally[symbol.idx()] = context.is_conditional;
        }
    }
}
