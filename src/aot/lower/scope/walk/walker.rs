use bun_sema::bind::{Binding, CodeUnit, Decl, ScopeId, SymbolId};
use bun_sema::check::aot::FunctionRef;
use bun_sema::fold::{TreeNode, push_children};
use bun_sema::hir::{ExprId, FnId, StmtId, is_moved_to_file_start};
use bun_sema::util::SharedSort;
use bun_sort_by_number::{SortByNumber, number_of_pair};
use rustc_hash::FxHashMap;
use smallvec::SmallVec;

use super::prepass::{
    collect_class_decorators, collect_eval_variable_scopes, collect_implicit_uses,
    collect_inner_module_parameters,
};
use super::{
    Context, DeclarationRead, Initialization, ScopeWalk, Task, WalkedFunction, WalkedFunctionId,
    WalkedLoop, Walker,
};
use crate::ir::FunctionKey;
use crate::lower::commonjs;
use crate::lower::scope::analysis::{find_by_key, shared_sort_unique, sort_unique};
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
    sort_unique(&mut walk.uses);
    sort_unique(&mut walk.function_references);
    sort_unique(&mut walk.calls_by_name);
    sort_unique(&mut walk.declarations_read_by_every_run);
    let always_read = std::mem::take(&mut walk.declarations_read_by_every_run);
    sort_unique(&mut walk.makers_of_closures_in_every_run);
    let makers = std::mem::take(&mut walk.makers_of_closures_in_every_run);
    let reads = std::mem::take(&mut walk.declaration_reads);
    let nested_reads = reads.iter().filter(|read| read.reader != read.owner);
    let mut read_by_nested_functions: Vec<SymbolId> =
        nested_reads.map(|read| read.symbol).collect();
    sort_unique(&mut read_by_nested_functions);
    for read in reads {
        // The closure is kept in a local of the owner unless a nested function reads the name too.
        let needs_shared_place = read_by_nested_functions.binary_search(&read.symbol).is_ok();
        let is_made_at_entry = always_read.binary_search(&read.symbol).is_ok()
            || makers.binary_search(&read.owner).is_ok();
        if needs_shared_place && is_made_at_entry {
            continue;
        }
        walk.made_at_first_read.push((read.symbol, read.function));
        walk.function_references.push((read.reader, read.function));
        let loop_behind_creation = match needs_shared_place {
            true => None,
            false => find_outermost_loop_sharing_binding(input, &walk.loops, read),
        };
        if let Some(index) = loop_behind_creation {
            let walked = &walk.loops[index];
            walk.sites_that_start
                .push((read.function, read.reader, walked.entered_at));
            walk.functions_created_before_loops
                .push((walked.statement, read.symbol));
            continue;
        }
        walk.sites_that_start
            .push((read.function, read.reader, read.time));
        // The read may store the function object: Walker::record_store().
        if let Some(index) = read.enclosing_loop {
            let innermost = &mut walk.loops[index as usize];
            innermost.stored.push(BindingRef::Symbol(read.symbol));
            let outermost = innermost.outermost as usize;
            walk.loops[outermost]
                .symbols_stored_within
                .push(read.symbol);
        }
    }
    sort_unique(&mut walk.made_at_first_read);
    sort_unique(&mut walk.functions_created_before_loops);
    sort_unique(&mut walk.function_references);
    sort_unique(&mut walk.names_called);
    shared_sort_unique(&mut walk.eval_uses);
    shared_sort_unique(&mut walk.stored_slots);
    walk.this_bindings.shared_sort_unstable();
    walk.symbol_stores
        .sort_by_u64(|store| number_of_pair(store.0.0, store.1.0));
    sort_unique(&mut walk.function_of_field);
    shared_sort_unique(&mut walk.slot_initializations);
    for walked_loop in &mut walk.loops {
        sort_unique(&mut walked_loop.stored);
    }
    merge_redeclared_functions(&mut walk.hoisted_functions);
    find_starts_of_functions_made_late(input, &mut walk);
    walk
}

// Every iteration of a loop around the declaration has a binding of its own.
fn find_outermost_loop_sharing_binding(
    input: &ScopeInput<'_, '_>,
    loops: &[WalkedLoop],
    read: DeclarationRead,
) -> Option<usize> {
    let scopes = &input.bound.scopes;
    let declared_in = input.bound.symbol_scope(read.symbol);
    let mut found = None;
    let mut current = read.enclosing_loop;
    while let Some(index) = current {
        let walked = &loops[index as usize];
        let parent_of = |&scope: &ScopeId| scopes[scope.idx()].parent.some();
        if !std::iter::successors(walked.boundary.some(), parent_of)
            .any(|scope| scope == declared_in)
        {
            break;
        }
        found = Some(index as usize);
        current = walked.parent;
    }
    found
}

// A function runs once something starts it: a call in the function that declares it, from the time of that call on, or a call in another function below that one, from the time on from which that function could run:
// a closure from its making, a function that is itself made late from its own start. So two functions that call each other start where the first call from outside stands.
// The time counts against what the function that declares it owns, and against nothing else: is_initialized_before().
fn find_starts_of_functions_made_late(input: &ScopeInput<'_, '_>, walk: &mut ScopeWalk) {
    let sites = std::mem::take(&mut walk.sites_that_start);
    if sites.is_empty() {
        return;
    }
    let bound = input.bound;
    let (functions, function_of_fn) = (&mut walk.functions, &walk.function_of_fn);
    for &(_, symbol, function) in &walk.hoisted_functions {
        // As FunctionLowering::instantiate_functions() asks.
        let is_never_made = matches!(
            bound.code_unit(bound.symbol_scope(symbol)),
            CodeUnit::Function(_)
        ) && !bound.is_visible_to_eval(symbol)
            && walk.use_counts.get(symbol.idx()) == Some(&0);
        let is_made_at_first_read = find_by_key(&walk.made_at_first_read, symbol).is_some();
        if !is_never_made && !is_made_at_first_read {
            continue;
        }
        if let Some(walked) = function_of_fn[function.idx()] {
            functions[walked.index()].is_made_late = true;
            functions[walked.index()].is_only_called_directly = is_never_made;
            functions[walked.index()].created_at = u32::MAX;
        }
    }
    let mut has_changed = true;
    while has_changed {
        has_changed = false;
        for &(function, user, time) in &sites {
            let Some(function) = function_of_fn[function.idx()] else {
                continue;
            };
            let started = functions[function.index()];
            if !started.is_made_late {
                continue;
            }
            let mut start = time;
            let mut below_owner = user;
            while Some(below_owner) != started.creator {
                let around = functions[below_owner.index()];
                let is_made_with_hoisted_functions =
                    around.hoisted_to.is_some() && !around.is_made_late;
                start = if is_made_with_hoisted_functions {
                    0
                } else {
                    around.created_at
                };
                match around.creator {
                    Some(creator) => below_owner = creator,
                    // The call stands outside of the function that declares the name.
                    None => {
                        start = 0;
                        break;
                    }
                }
            }
            if start < started.created_at {
                functions[function.index()].created_at = start;
                has_changed = true;
            }
        }
    }
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
    functions.sort_by_u32(|entry| entry.0.0);
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
            pending_stores: Vec::new(),
            unconditional_statements: Vec::new(),
            clock: 0,
            walk: ScopeWalk {
                function_of_fn: vec![None; hir.fns.len()],
                use_counts: vec![0; bound.symbols.len()],
                symbol_initializations: vec![None; bound.symbols.len()],
                last_store_times: vec![0; bound.symbols.len()],
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
            // What is stored in a loop is stored until the loop ends, and the outermost loop ends last.
            Task::EndLoop(index) => {
                let time = self.tick();
                let ended = &mut self.walk.loops[index as usize];
                for symbol in std::mem::take(&mut ended.symbols_stored_within) {
                    let last = &mut self.walk.last_store_times[symbol.idx()];
                    *last = (*last).max(time);
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
            is_made_late: false,
            is_only_called_directly: false,
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

    // The code of a function, of a field initializer or of the file, whose top scope is `scope`. The file alone runs once.
    pub(super) fn enter_unit(&mut self, function: WalkedFunctionId, scope: ScopeId) -> Context {
        let context = Context {
            function,
            lexical_scope: self.lexical_owners[scope.idx()],
            enclosing_loop: None,
            is_repeated: function != WalkedFunctionId::MODULE_BODY,
            is_conditional: false,
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
        let count = &mut self.walk.use_counts[symbol.idx()];
        *count = count.saturating_add(1);
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
        let Some(index) = context.enclosing_loop else {
            return;
        };
        let innermost = &mut self.walk.loops[index as usize];
        innermost.stored.push(binding);
        if let BindingRef::Symbol(symbol) = binding {
            let outermost = innermost.outermost as usize;
            let stored = &mut self.walk.loops[outermost].symbols_stored_within;
            stored.push(symbol);
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
