use bun_sema::bind::{Binding, CodeUnit, Decl, ScopeId, SymbolId};
use bun_sema::check::aot::FunctionRef;
use bun_sema::fold::{TreeNode, push_children};
use bun_sema::hir::{ExprId, Flags, FnId, PatKind, StmtId, is_moved_to_file_start};
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
    sort_unique_uses(&mut walk.uses, walk.use_counts.len(), walk.functions.len());
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
    spread_looks_to_what_is_handed_on(input, &mut walk);
    let is_looked_at = std::mem::take(&mut walk.is_looked_at);
    for read in reads {
        let needs_shared_place = read_by_nested_functions.binary_search(&read.symbol).is_ok();
        let sees_itself = walk
            .functions_that_name_arguments
            .binary_search(&read.function)
            .is_ok();
        if needs_shared_place
            && !is_looked_at[read.symbol.idx()]
            && !sees_itself
            && !input.hir[read.function].flags.contains(Flags::GENERATOR)
            && !input.bound.is_visible_to_eval(read.symbol)
        {
            walk.created_at_each_read.push(read.symbol);
            walk.made_at_first_read.push((read.symbol, read.function));
            walk.function_references.push((read.reader, read.function));
            walk.sites_that_start
                .push((read.function, read.reader, read.time));
            continue;
        }
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
    sort_unique(&mut walk.created_at_each_read);
    let without_place = std::mem::take(&mut walk.created_at_each_read);
    if !without_place.is_empty() {
        walk.uses.retain(|&(_, binding)| match binding {
            BindingRef::Symbol(symbol) => without_place.binary_search(&symbol).is_err(),
            BindingRef::Slot(..) => true,
        });
    }
    walk.created_at_each_read = without_place;
    sort_unique(&mut walk.functions_created_before_loops);
    let references = &walk.function_references;
    let by_callee = order_by(references, walk.function_of_fn.len(), |it| it.1.idx());
    walk.function_references = order_by(&by_callee, walk.functions.len(), |it| it.0.0 as usize);
    walk.function_references.dedup();
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
    for function in std::mem::take(&mut walk.functions_laid_in_literals) {
        if let Some(walked) = walk.function_of_fn[function.idx()] {
            walk.functions[walked.index()].is_laid_in_literal = true;
        }
    }
    merge_redeclared_functions(&mut walk.hoisted_functions);
    find_starts_of_functions_made_late(input, &mut walk);
    walk
}

fn sort_unique_uses(
    uses: &mut Vec<(WalkedFunctionId, BindingRef)>,
    symbol_count: usize,
    function_count: usize,
) {
    let mut by_binding = order_by(uses, symbol_count + 1, |entry| match entry.1 {
        BindingRef::Symbol(symbol) => symbol.idx(),
        BindingRef::Slot(..) => symbol_count,
    });
    let first_slot = by_binding.partition_point(|entry| matches!(entry.1, BindingRef::Symbol(_)));
    by_binding[first_slot..].sort_unstable();
    *uses = order_by(&by_binding, function_count, |entry| entry.0.0 as usize);
    uses.dedup();
}

fn order_by<T: Copy>(list: &[T], number_count: usize, number_of: impl Fn(&T) -> usize) -> Vec<T> {
    let Some(&first) = list.first() else {
        return Vec::new();
    };
    let mut places = vec![0u32; number_count];
    for entry in list {
        places[number_of(entry)] += 1;
    }
    let mut total = 0;
    for place in &mut places {
        let count = *place;
        *place = total;
        total += count;
    }
    let mut ordered = vec![first; list.len()];
    for entry in list {
        let place = &mut places[number_of(entry)];
        ordered[*place as usize] = *entry;
        *place += 1;
    }
    ordered
}

fn spread_looks_to_what_is_handed_on(input: &ScopeInput<'_, '_>, walk: &mut ScopeWalk) {
    let (hir, bound) = (input.hir, input.bound);
    sort_unique(&mut walk.functions_that_name_arguments);
    let handed = std::mem::take(&mut walk.names_handed_to_declarations);
    let is_looked_at = &mut walk.is_looked_at;
    let mut taken_by: Vec<(SymbolId, SymbolId)> = Vec::with_capacity(handed.len());
    for (name, callee, index) in handed {
        let mut parameters = hir[callee].params.iter();
        let takes_rest = parameters
            .clone()
            .any(|parameter| hir[parameter].flags.contains(Flags::REST));
        if takes_rest
            || walk
                .functions_that_name_arguments
                .binary_search(&callee)
                .is_ok()
        {
            is_looked_at[name.idx()] = true;
            continue;
        }
        let Some(parameter) = parameters.nth(index as usize) else {
            continue;
        };
        let pattern = hir[parameter].pat;
        let symbol = match hir[pattern].kind {
            PatKind::Ident(_) => bound.declared_symbol(Decl::Param(pattern)).some(),
            _ => None,
        };
        match symbol.filter(|&symbol| !bound.is_visible_to_eval(symbol)) {
            Some(symbol) => taken_by.push((symbol, name)),
            None => is_looked_at[name.idx()] = true,
        }
    }
    let taken_by = order_by(&taken_by, is_looked_at.len(), |entry| entry.0.idx());
    let mut looked_at: Vec<SymbolId> = taken_by.iter().map(|entry| entry.0).collect();
    looked_at.dedup();
    looked_at.retain(|parameter| is_looked_at[parameter.idx()]);
    while let Some(parameter) = looked_at.pop() {
        for &(_, name) in entries_of(&taken_by, parameter) {
            if !std::mem::replace(&mut is_looked_at[name.idx()], true) {
                looked_at.push(name);
            }
        }
    }
}

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

fn find_starts_of_functions_made_late(input: &ScopeInput<'_, '_>, walk: &mut ScopeWalk) {
    let sites = std::mem::take(&mut walk.sites_that_start);
    if sites.is_empty() {
        return;
    }
    let bound = input.bound;
    let (functions, function_of_fn) = (&mut walk.functions, &walk.function_of_fn);
    for &(_, symbol, function) in &walk.hoisted_functions {
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
            let started = functions[function.0 as usize];
            if !started.is_made_late {
                continue;
            }
            let mut start = time;
            let mut below_owner = user;
            while Some(below_owner) != started.creator {
                let around = functions[below_owner.0 as usize];
                let is_made_with_hoisted_functions =
                    around.hoisted_to.is_some() && !around.is_made_late;
                start = if is_made_with_hoisted_functions {
                    0
                } else {
                    around.created_at
                };
                match around.creator {
                    Some(creator) => below_owner = creator,
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
        let keeps_wrapper =
            is_commonjs && commonjs::keeps_wrapper(bound, decisions, input.builtins);
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
            number_walked: 0,
            is_only_called_or_tested: vec![false; hir.exprs.len()],
            walk: ScopeWalk {
                function_of_fn: vec![None; hir.fns.len()],
                use_counts: vec![0; bound.symbols.len()],
                is_looked_at: vec![false; bound.symbols.len()],
                symbol_initializations: vec![None; bound.symbols.len()],
                last_store_times: vec![0; bound.symbols.len()],
                is_initialized_conditionally: vec![false; bound.symbols.len()],
                is_switch_scope: vec![false; bound.scopes.len()],
                is_repeated_scope: vec![false; bound.scopes.len()],
                eval_variable_scopes,
                parameter_eval_variable_scopes,
                has_wrapper_parameters: keeps_wrapper,
                has_values_of_each_run: is_commonjs
                    && !keeps_wrapper
                    && input.modules.runs_again(input.file),
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
            let mut low = self.stack.len();
            self.run_task(task, context);
            let mut high = self.stack.len();
            while low + 1 < high {
                high -= 1;
                let (first, last) = (self.stack[low], self.stack[high]);
                self.stack[low] = last;
                self.stack[high] = first;
                low += 1;
            }
        }
    }

    fn run_task(&mut self, task: Task, context: Context) {
        match task {
            Task::Statement(statement) => {
                self.number_walked += 1;
                self.visit_statement(statement, context);
            }
            Task::Expression(expression) => {
                self.number_walked += 1;
                self.visit_expression(expression, context);
            }
            Task::EndTry(index) => {
                let size = &mut self.walk.tries[index as usize].size;
                *size = self.number_walked - *size;
            }
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
            is_laid_in_literal: false,
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

    pub(super) fn push_present_expressions<const N: usize>(
        &mut self,
        expressions: [ExprId; N],
        context: Context,
    ) {
        for expression in expressions {
            if expression.is_some() {
                self.push_task(Task::Expression(expression), context);
            }
        }
    }

    pub(super) fn push_evaluated_children(&mut self, expression: ExprId, context: Context) {
        self.children.clear();
        push_children(self.hir, TreeNode::Expr(expression), &mut self.children);
        for &child in &self.children {
            match child {
                TreeNode::Expr(child) => self.stack.push((Task::Expression(child), context)),
                _ => {
                    debug_assert!(false, "every child of this expression is an expression");
                }
            }
        }
    }

    pub(super) fn enter_unit(&mut self, function: WalkedFunctionId, scope: ScopeId) -> Context {
        let context = Context {
            function,
            lexical_scope: self.lexical_owners[scope.idx()],
            enclosing_loop: None,
            enclosing_try: None,
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
        if let Some(index) = context.enclosing_try {
            self.walk.tries[index as usize].stored.push(binding);
        }
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
