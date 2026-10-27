use bun_sema::bind::{Binding, Decl, ScopeId, SymbolId};
use bun_sema::check::aot::FunctionRef;
use bun_sema::fold::{TreeNode, push_children};
use bun_sema::hir::{ExprId, ExprKind, FnId, StmtId, is_moved_to_file_start};
use rustc_hash::FxHashMap;
use smallvec::SmallVec;

use super::prepass::{
    collect_class_decorators, collect_eval_variable_scopes, collect_implicit_uses,
    collect_inner_module_parameters,
};
use super::{Context, Initialization, ScopeWalk, Task, WalkedFunction, WalkedFunctionId, Walker};
use crate::ir::FunctionKey;
use crate::lower::commonjs;
use crate::lower::scope::analysis::sort_unique;
use crate::lower::scope::lexical_owners::{ScopeObjectSearch, for_each_scope_object};
use crate::lower::scope::{BindingRef, ScopeInput, ScopeSlot};
use crate::modules::ModuleKind;

pub(in crate::lower::scope) fn walk_file(
    input: &ScopeInput<'_, '_>,
    lexical_owners: &[ScopeId],
) -> ScopeWalk {
    let mut walker = Walker::new(input, lexical_owners);
    walker.walk_module();
    let mut walk = walker.walk;
    if !walker.unprinted_uses.is_empty() {
        let mut named: Vec<SymbolId> = walker.unprinted_uses.iter().map(|named| named.1).collect();
        sort_unique(&mut named);
        let printed_users = walk
            .uses
            .iter()
            .filter_map(|&(user, binding)| match binding {
                BindingRef::Symbol(symbol) if named.binary_search(&symbol).is_ok() => {
                    Some((symbol, user))
                }
                _ => None,
            });
        walk.printed_users = printed_users.collect();
        walk.printed_users.sort_unstable();
        walk.symbols_named_in_unprinted_statements = named;
        let unprinted_uses = walker.unprinted_uses.iter();
        walk.uses
            .extend(unprinted_uses.map(|&(user, symbol)| (user, BindingRef::Symbol(symbol))));
    }
    sort_unique(&mut walk.uses);
    sort_unique(&mut walk.function_references);
    sort_unique(&mut walk.eval_uses);
    sort_unique(&mut walk.stored_slots);
    walk.this_bindings.sort_unstable();
    sort_unique(&mut walk.symbols_read_by_enums);
    sort_unique(&mut walk.symbols_in_export_lists);
    walk.symbol_stores
        .sort_unstable_by_key(|store| (store.0, store.1));
    sort_unique(&mut walk.function_of_field);
    sort_unique(&mut walk.slot_initializations);
    for walked_loop in &mut walk.loops {
        sort_unique(&mut walked_loop.stored);
    }
    merge_redeclared_functions(&mut walk.hoisted_functions);
    walk
}

pub(super) fn entries_of<K: Copy + Ord, V>(list: &[(K, V)], key: K) -> &[(K, V)] {
    let start = list.partition_point(|entry| entry.0 < key);
    let entries = list[start..].iter();
    let length = entries.take_while(|entry| entry.0 == key).count();
    &list[start..start + length]
}

pub(super) fn bindings_of<K: Copy + Ord>(list: &[(K, Binding)], key: K) -> SmallVec<[Binding; 4]> {
    entries_of(list, key).iter().map(|entry| entry.1).collect()
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
    fn new(input: &'x ScopeInput<'x, 's>, lexical_owners: &'x [ScopeId]) -> Walker<'x, 's> {
        let (hir, bound) = (input.hir, input.bound);
        let decisions = &input.compiled.analysis.decisions;
        let is_commonjs = input.modules.kind(input.file) == ModuleKind::CommonJs;
        let (jsx_uses, metadata_uses) = collect_implicit_uses(bound);
        let (eval_variable_scopes, parameter_eval_variable_scopes) =
            collect_eval_variable_scopes(hir, bound, decisions);
        Walker {
            input,
            hir,
            bound,
            decisions,
            lexical_owners,
            is_commonjs,
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
            unprinted_uses: Vec::new(),
            pending_stores: Vec::new(),
            halves_in_front: Vec::new(),
            unconditional_statements: Vec::new(),
            clock: 0,
            walk: ScopeWalk {
                function_of_fn: vec![None; hir.fns.len()],
                symbol_initializations: vec![None; bound.symbols.len()],
                last_store_times: vec![0; bound.symbols.len()],
                symbols_read_by_enums: Vec::new(),
                symbols_in_export_lists: Vec::new(),
                is_initialized_conditionally: vec![false; bound.symbols.len()],
                is_switch_scope: vec![false; bound.scopes.len()],
                is_repeated_scope: vec![false; bound.scopes.len()],
                eval_variable_scopes,
                parameter_eval_variable_scopes,
                has_wrapper_parameters: is_commonjs
                    && commonjs::keeps_wrapper(bound, decisions, input.builtins),
                ..ScopeWalk::default()
            },
            stack: Vec::new(),
            children: Vec::new(),
        }
    }

    fn walk_module(&mut self) {
        let body = self.add_function(FunctionKey::ModuleBody(self.input.file), None);
        let inner_bodies = self.declare_inner_module_bodies();
        let root = self.enter_unit(body, self.file_scope);
        let hir = self.hir;
        let moves = self.input.modules.kind(self.input.file) != ModuleKind::RuntimeSource;
        let is_moved = |statement: &StmtId| moves && is_moved_to_file_start(hir, *statement);
        let moved = hir.ids(hir.body).filter(is_moved);
        let others = hir.ids(hir.body).filter(|statement| !is_moved(statement));
        self.push_statements(moved.chain(others), root);
        self.run_pushed_tasks();
        for (function, id) in inner_bodies {
            let context = self.enter_unit(id, self.bound.fns[function.idx()].scope);
            self.push_function_code(function, context);
            self.run_pushed_tasks();
        }
    }

    // The callback of `__commonJS(cb)` or `__esm(fn)` is the body of a module of its own.
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

    fn run_task(&mut self, task: Task, context: Context) {
        match task {
            Task::Statement(statement) => self.visit_statement(statement, context),
            Task::Expression(expression) => self.visit_expression(expression, context),
            Task::MarkCreated(function) => {
                let time = self.tick();
                self.walk.functions[function.index()].created_at = time;
            }
            Task::InitializeSymbol(symbol) => self.initialize_symbol(symbol, false, context),
            Task::InitializeParameter(symbol) => self.initialize_symbol(symbol, true, context),
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
            // The decorators are walked first, and run among the other parts of the class or behind them all. So none of the stores that the function makes while it evaluates the class counts as made until the class is.
            Task::EndDecoratedClass { first_store } => {
                let time = self.tick();
                for &(symbol, _, function) in &self.walk.symbol_stores[first_store as usize..] {
                    if function == context.function {
                        let last = &mut self.walk.last_store_times[symbol.idx()];
                        *last = (*last).max(time);
                    }
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

    #[inline]
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
                _ => {
                    debug_assert!(false, "every child of this expression is an expression");
                }
            }
        }
        self.children = children;
    }

    pub(super) fn record_symbols_read_by_enum(&mut self, initializer: ExprId) {
        if initializer.is_none() {
            return;
        }
        let mut nodes = vec![TreeNode::Expr(initializer)];
        while let Some(node) = nodes.pop() {
            if let TreeNode::Expr(expression) = node
                && matches!(self.hir[expression].kind, ExprKind::Ident(_))
                && let Binding::Symbol(symbol) = self.bound.binding(expression)
            {
                self.walk.symbols_read_by_enums.push(symbol);
            }
            push_children(self.hir, node, &mut nodes);
        }
    }

    // The code of a function, of a field initializer or of the file, whose top scope is `scope`. The file alone runs once.
    pub(super) fn enter_unit(&mut self, function: WalkedFunctionId, scope: ScopeId) -> Context {
        let context = Context {
            function,
            lexical_scope: self.lexical_owners[scope.idx()],
            enclosing_loop: None,
            enclosing_try: None,
            is_repeated: function != WalkedFunctionId::MODULE_BODY,
            is_conditional: false,
            is_unprinted: false,
        };
        self.enter_scope(scope, context);
        context
    }

    pub(super) fn enter_scope(&mut self, scope: ScopeId, context: Context) {
        if scope.is_some() && context.is_repeated {
            self.walk.is_repeated_scope[scope.idx()] = true;
        }
    }

    pub(super) fn record_symbol_use(&mut self, context: Context, symbol: SymbolId) {
        if context.is_unprinted {
            self.unprinted_uses.push((context.function, symbol));
            return;
        }
        self.record_unwritten_symbol_use(context, symbol);
    }

    // A use for which the source text has no name.
    pub(super) fn record_unwritten_symbol_use(&mut self, context: Context, symbol: SymbolId) {
        let last_user = &mut self.last_users[symbol.idx()];
        if *last_user == Some(context.function) {
            return;
        }
        *last_user = Some(context.function);
        let binding = BindingRef::Symbol(symbol);
        self.walk.uses.push((context.function, binding));
    }

    pub(super) fn record_slot_use(
        &mut self,
        function: WalkedFunctionId,
        scope: ScopeId,
        slot: ScopeSlot,
    ) {
        if scope.is_some() {
            let binding = BindingRef::Slot(scope, slot);
            self.walk.uses.push((function, binding));
        }
    }

    pub(super) fn record_store(&mut self, context: Context, binding: BindingRef) {
        let mut next = context.enclosing_loop;
        while let Some(index) = next {
            let walked_loop = &mut self.walk.loops[index as usize];
            walked_loop.stored.push(binding);
            next = walked_loop.parent;
        }
        let mut next = context.enclosing_try;
        while let Some(index) = next {
            let walked_try = &mut self.walk.tries[index as usize];
            walked_try.stored.push(binding);
            next = walked_try.parent;
        }
    }

    pub(super) fn record_slot_store(&mut self, context: Context, scope: ScopeId, slot: ScopeSlot) {
        self.walk.stored_slots.push((scope, slot));
        self.record_store(context, BindingRef::Slot(scope, slot));
    }

    pub(super) fn record_scope_objects(
        &mut self,
        function: WalkedFunctionId,
        search: ScopeObjectSearch,
    ) {
        let walk = &mut self.walk;
        for_each_scope_object(self.hir, self.bound, search, |object| {
            let is_made = match object {
                BindingRef::Slot(scope, ScopeSlot::EvalVariables) => {
                    walk.eval_variable_scopes.binary_search(&scope).is_ok()
                }
                BindingRef::Slot(scope, ScopeSlot::ParameterEvalVariables) => {
                    let scopes = &walk.parameter_eval_variable_scopes;
                    scopes.binary_search(&scope).is_ok()
                }
                _ => true,
            };
            if is_made {
                walk.uses.push((function, object));
            }
        });
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
