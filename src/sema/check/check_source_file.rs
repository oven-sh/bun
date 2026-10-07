//! `checkSourceFile`: checks the statements of a file from top to bottom, each with everything
//! nested in it, then the nodes deferred on the way (`checkDeferredNodes`).
//!
//! A function here has the name of the checker.go function it ports. It visits what that one
//! visits, in that order, and returns where that one returns. So every query is first made at the
//! point where TypeScript makes it, and where the result depends on what is in progress, it is the
//! same result.

use super::errors_operators::{
    check_grammar_rest_element, check_instance_of_expression, check_satisfies,
    check_tagged_template, check_template_spans, check_yield_result,
};
use super::errors_statements::is_with_statement;
use super::task::{Finished, Published};
use super::*;
use crate::bind::{Decl, FnOwner, Parent, PatParent};
use crate::types::LinkCounts;
use crate::util::InParallel;
use smallvec::SmallVec;

/// How much native stack a checker may use, measured from `Checker::begin_stack_budget`. One
/// constant, on every thread, on every platform, in the product and in the harness: the point where
/// a task runs out of stack has to be a function of the program. The smallest stack of a pool
/// thread is 4 MB (`DEFAULT_THREAD_STACK_SIZE`: Linux with glibc or musl, macOS). `StackCheck`
/// reserves up to 512 KB of it (under a sanitizer), and the frames of the pool and of the driver
/// are subtracted too.
const TASK_STACK: usize = 3 << 20;

/// The barrier after a step. `finished`: the tasks of that step, in task order. No task is running.
impl<'s> Program<'s> {
    /// Optimistic concurrency control: validation, before link and publish. `getVariancesWorker`
    /// returns an empty list for a symbol whose variances are being computed and caches whatever
    /// results from that, so the variances of mutually recursive types depend on which type of the
    /// cycle is queried first. The serial order is step order, then program order within a step,
    /// which is task order. (Not quite program order: the warm-up steps are a sample of the
    /// program. Deferring what their tasks publish until all earlier files are checked makes a
    /// check 17% slower.) A task is invalid if it computed a different value than an earlier task
    /// or step did and a result of the task depends on the difference (`OrderDependent`). The
    /// caller aborts an invalid task: it discards the task's output and retries its files, which
    /// then read `serial_variances`. The first task to compute the variances of a symbol is valid
    /// with respect to that symbol. Returns whether each task is invalid.
    ///
    /// Likewise for `markNodeAssignments`: what it has found about a variable depends on which of
    /// the functions around the assignments was walked first
    /// (`has_order_dependent_assignment_marks`). A task is invalid if it walked a function of a
    /// file it was visiting that is inside or around one that an earlier task of the step walked,
    /// on demand. Retried, it finds those walks published, with what was evaluated along with them.
    pub fn validate(&self, finished: &[Finished<'s>]) -> Vec<bool> {
        let mut serial = self.serial_variances.lock();
        let mut walked: Vec<(FileId, Node)> = Vec::new();
        (finished.iter())
            .map(|finished| {
                let is_invalid = (finished.order_dependent_variances.iter()).any(|it| {
                    serial
                        .get(&it.sym)
                        .is_some_and(|first| it.conflicts_with(first))
                });
                if is_invalid || self.has_walked_across_earlier_walk(finished, &walked) {
                    return true;
                }
                for it in &finished.order_dependent_variances {
                    serial.entry(it.sym).or_insert(it.variances);
                }
                walked.extend(finished.assignments_walked.iter().map(|it| (it.0, it.1)));
                false
            })
            .collect()
    }

    /// `earlier`: `Finished::assignments_walked` of the valid tasks before it.
    fn has_walked_across_earlier_walk(
        &self,
        finished: &Finished<'s>,
        earlier: &[(FileId, Node)],
    ) -> bool {
        (finished.assignments_walked.iter()).any(|&(file, node, is_visiting)| {
            let hir = self.files.hir(file);
            let is_in =
                |inner: Node, outer: Node| hir.find_ancestor(inner, |n| n == outer).is_some();
            is_visiting
                && (earlier.iter()).any(|&(of, other)| {
                    of == file && other != node && (is_in(node, other) || is_in(other, node))
                })
        })
    }

    /// The first half. Of the types, signatures, mappers and component lists that several tasks
    /// have created, the copy of the lowest task is kept. Each task gets its `Link`, through which
    /// `publish` rewrites its keys and values.
    pub fn link(&self, finished: &mut [Finished<'s>], in_parallel: InParallel<'_>) -> LinkCounts {
        let own = finished.iter_mut().map(|it| std::mem::take(&mut it.own));
        // For a union whose member order depended on task-local ids. Few steps have one.
        let checker = std::cell::OnceCell::new();
        let (links, counts) =
            (self.types).link(&self.files.atoms, own.collect(), in_parallel, &|types| {
                checker.get_or_init(|| self.checker()).sort_types(types)
            });
        for (finished, link) in finished.iter_mut().zip(links) {
            finished.link = link;
        }
        counts
    }

    /// The second half. The buffered entries are moved to the published state, and the first entry
    /// for a key wins. Then the diagnostics: the first task to report under a query is the one that
    /// reports, so this is called for the steps in plan order, on one thread.
    /// `with_digest`: `Published::digest` is computed.
    pub fn publish(
        &self,
        finished: &mut [Finished<'s>],
        in_parallel: InParallel<'_>,
        with_digest: bool,
    ) -> Published {
        let published = task::publish(self, finished, in_parallel, with_digest);
        if finished.iter().any(|finished| finished.closed_a_cycle) {
            (self.closed_a_cycle).store(true, std::sync::atomic::Ordering::Relaxed);
        }
        for finished in finished {
            self.publish_diagnostics(finished);
        }
        published
    }
}

impl<'s> Checker<'_, 's> {
    /// Called at the start of a task, or of a checker outside the plan. See `TASK_STACK`.
    pub fn begin_stack_budget(&mut self) {
        let left = bun_core::StackCheck::init().remaining();
        assert!(
            left >= TASK_STACK,
            "the thread has too little stack for a task"
        );
        self.set_stack_limit(TASK_STACK);
    }

    /// Called before `check_file`. `step` counts from 0. `index`: the position of the task in its
    /// step, in task order.
    /// `is_read_later`: whether anything will read what this task publishes. If not, only its
    /// diagnostics go to the barrier.
    /// A checker for which this is not called is outside the plan: its writes are dropped with it.
    pub fn begin_task(&mut self, step: u32, index: u32, is_read_later: bool) {
        self.task.begin(step, index, is_read_later);
        self.order_dependent.clear();
        self.order_dependent_filter = 0;
    }

    /// Called on the thread of the task, after everything else this checker does.
    pub fn end_task(&mut self) -> Finished<'s> {
        let diagnostics = self.take_diagnostics();
        self.task.finish(self.p, diagnostics)
    }

    /// After `check_file`: whether the native stack ran out in that file. A task checks several files.
    pub fn take_ran_out_of_stack(&mut self) -> bool {
        self.ran_out_of_stack.replace(false)
    }

    /// How many entries of `relations` this checker has stored under a generic key whose hash
    /// included a task-local id. Such an entry is bound to its task: after the link the same two
    /// references hash differently. A function of the program.
    pub fn generic_relation_entries_not_published(&self) -> u64 {
        self.generic_relation_entries_not_published
    }

    /// `checkSourceFile`
    pub(super) fn check_source_file(&mut self, file: FileId) {
        self.deferred_nodes.clear();
        self.deferred_type_parameters.clear();
        self.is_deferred_node.clear();
        self.renamed_binding_elements_in_types.clear();
        self.unvisited_exprs.clear();
        let hir = self.hir(file);
        let is_ambient = |flags: Flags| flags.contains(Flags::AMBIENT);
        self.has_ambient_context = hir.kind == FileKind::Declaration
            || hir.modules.iter().any(|it| is_ambient(it.flags))
            || hir.classes.iter().any(|it| is_ambient(it.flags))
            || hir.fns.iter().any(|it| is_ambient(it.flags));
        self.parsed_again_for_await = None;
        // The kinds that `type_of_expr_uncached` defers. Sorted by position: a single evaluation
        // reaches them in that order.
        let index = self.exprs_by_kind(file);
        let tags = [ExprTag::Fn, ExprTag::Class, ExprTag::Jsx, ExprTag::Unary];
        let mut earlier: Vec<ExprId> = (tags.iter())
            .flat_map(|&tag| index.of(tag).iter().copied())
            .filter(|&e| (self.p.deferred_nodes.get(&self.task, &(file, e))).is_some())
            .collect();
        earlier.sort_unstable_by_key(|&e| hir[e].pos);
        for e in earlier {
            self.check_node_deferred(file, e);
        }
        self.check_source_elements(file, self.hir(file).body);
        self.check_deferred_nodes(file);
        // `checkFunctionOrConstructorSymbol`, which compares an implementation with its overloads.
        self.check_overloads(file);
        self.check_exprs_visited_by_queries(file);
        if hir.kind != FileKind::Declaration {
            self.check_unused_renamed_binding_elements(file);
        }
        self.note_assignments_marked_by_check(file);
        self.reported_unreachable_nodes.clear();
    }

    /// Settles `unvisited_exprs`. A query that computes a type from one checks the whole of it
    /// (`checkDeclarationInitializer`, `checkComputedPropertyName`,
    /// `checkAndAggregateYieldOperandTypes`). What no query has reached by the end of
    /// `checkSourceFile` is never checked.
    fn check_exprs_visited_by_queries(&mut self, file: FileId) {
        let mut unvisited = Vec::new();
        loop {
            unvisited.append(&mut self.unvisited_exprs);
            let (visited, rest): (Vec<_>, Vec<_>) = unvisited.into_iter().partition(|&(_, e)| {
                self.cached_type_of_expr(file, e).is_some()
                    || self.checked_with_contextual_type.contains(&(file, e))
            });
            unvisited = rest;
            if visited.is_empty() {
                break;
            }
            for (_, e) in visited {
                self.check_expression(file, e);
            }
            self.check_deferred_nodes(file);
        }
        for (start, e) in unvisited {
            let range = (start, self.end_of_expr(file, e));
            self.never_check_unless_visited_by_query(file, self.hir(file).node(e), range);
        }
        self.never_check_with_bodies(file);
    }

    /// Whether `pos` is in a range given to `never_check`.
    pub(super) fn is_never_checked(&self, pos: u32) -> bool {
        let never_checked = self.never_checked.borrow();
        never_checked
            .iter()
            .any(|&(from, to)| (from..to).contains(&pos))
    }

    /// `getTypeFromBindingElement` has checked `initializer`, in the parameter `root`.
    pub(super) fn note_checked_with_contextual_type(
        &mut self,
        file: FileId,
        root: ParamId,
        initializer: ExprId,
    ) {
        let func = self.bound(file).param_fn[root.idx()];
        if func.is_some() && !has_body(&self.hir(file)[func]) {
            self.checked_with_contextual_type.push((file, initializer));
        }
    }

    /// `checkSourceElement` for the statements of `file`, a declaration file, that begin in the
    /// range `from..to` of its text (`PlanOptions::split_files`). The only work of its task.
    ///
    /// The task does not visit `file`. So every query is evaluated on demand, as a task evaluates
    /// what it needs of any other file, and what goes to the barrier is what any task may publish
    /// about `file`: an entry whose evaluation has a side effect that `check_file` reads is not
    /// stored. The task of `file` runs in the next step and finds the entries.
    ///
    /// A diagnostic that belongs to a query goes to the barrier with the entry. One that belongs to
    /// the task is dropped: `check_file` reports it.
    ///
    /// `publishes_everything`: otherwise `Task::withhold_tables_of_records`.
    ///
    /// Returns the obstacles to publishing, as a bit set. Each is an event after which a stored
    /// result can depend on what was evaluated before, so the task of `file`, which begins at the
    /// first statement, might have stored another one.
    /// - 1: a query has re-entered itself.
    /// - 2: an instantiation limit was reached, or the native stack ran low.
    /// - 4: a comparison was cut short because both types were deeply nested.
    /// - 8: `check_file` does not check the statements of `file`.
    pub fn check_statements_ahead(
        &mut self,
        file: FileId,
        (from, to): (u32, u32),
        publishes_everything: bool,
    ) -> u8 {
        if self.expected != Requested::All || !self.reports_semantic_errors(file) {
            return 8;
        }
        self.task.store_densely(file);
        if !publishes_everything {
            self.task.withhold_tables_of_records();
        }
        self.has_ambient_context = true;
        self.save_deferred_diagnostics = true;
        let hir = self.hir(file);
        for s in hir.ids(hir.body) {
            if (from..to).contains(&hir[s].start) {
                self.check_source_element(file, s);
            }
        }
        self.produce_type_not_iterable_errors(0);
        self.reported.clear();
        self.task.diagnostics.retain(|(owner, _)| owner.is_some());
        let is_cut_short = self.ran_out_of_stack.replace(false)
            || self.cuts() != 0
            || self.instantiation_limit_hits != 0;
        u8::from(self.task.closed_a_cycle)
            | u8::from(is_cut_short) << 1
            | u8::from(self.comparisons_of_deeply_nested_types != 0) << 2
    }

    /// `checkSourceElements`
    fn check_source_elements(&mut self, file: FileId, statements: IdList<StmtId>) {
        for s in self.hir(file).ids(statements) {
            self.check_source_element(file, s);
        }
    }

    /// `checkTruthinessExpression`
    fn check_truthiness_expression(&mut self, file: FileId, node: ExprId) {
        if node.is_some() {
            self.check_expression(file, node);
            let ty = self.type_of_expr(file, node);
            self.check_truthiness_of_type(file, node, ty);
        }
    }

    /// `checkNodeDeferred`. `links.deferredNodes` belongs to the file of the node and is in call
    /// order, whichever file was being checked at the time. So nodes evaluated on demand before
    /// `checkSourceFile` of their file come first: `Program::deferred_nodes` holds them until then.
    pub(super) fn check_node_deferred(&mut self, file: FileId, e: ExprId) {
        if self.task.file != Some(file) {
            (self.p.deferred_nodes).insert(&self.task, (file, e), (), Stored::new());
        } else if !self.is_type_checked && self.is_deferred_node.insert(e) {
            self.deferred_nodes.push_back(e);
        }
    }

    /// `checkNodeDeferred(node)` at the end of `checkTypeParameter`, for the type parameters
    /// `params` of the class expression `e`: before what the heritage clauses defer, and before the
    /// class. Only `in` and `out` have a deferred check. A class that another file's check has
    /// deferred has one entry.
    fn check_type_parameters_node_deferred(
        &mut self,
        file: FileId,
        e: ExprId,
        params: Span<TypeParamId>,
    ) {
        let hir = self.hir(file);
        if self.task.file == Some(file)
            && !self.is_type_checked
            && !self.is_deferred_node.contains(&e)
            && !self.deferred_type_parameters.iter().any(|it| it.0 == e)
            && (params.iter()).any(|tp| hir[tp].flags.intersects(Flags::IN | Flags::OUT))
        {
            self.deferred_type_parameters.push((e, false));
            self.deferred_nodes.push_back(e);
        }
    }

    /// `checkDeferredNodes`: nodes deferred in the meantime are appended to the queue.
    fn check_deferred_nodes(&mut self, file: FileId) {
        while let Some(e) = self.deferred_nodes.pop_front() {
            let saved = self.enter_source_element(CurrentNode::Expr(file, e));
            self.check_deferred_node(file, e);
            self.current_source_element = saved;
        }
    }

    /// `checkSourceElement`: `c.currentNode = node`, `c.instantiationCount = 0`. Returns
    /// `saveCurrentNode`.
    #[inline]
    fn enter_source_element(&mut self, node: CurrentNode) -> Option<CurrentNode> {
        self.instantiation_count = 0;
        self.current_source_element.replace(node)
    }

    /// `checkDeferredNode`
    fn check_deferred_node(&mut self, file: FileId, e: ExprId) {
        let hir = self.hir(file);
        match hir[e].kind {
            // `checkFunctionExpressionOrObjectLiteralMethodDeferred`, `checkAccessorDeclaration`
            ExprKind::Fn(func) => {
                if matches!(hir[func].kind, FnKind::Getter | FnKind::Setter) {
                    if !self.check_grammar_function_like_declaration(file, func)
                        && !self.check_grammar_accessor(file, func)
                        && let Parent::Prop(p) = self.bound(file).expr_parent[e.idx()]
                    {
                        self.check_grammar_computed_property_name(file, hir[p].key);
                    }
                    self.check_signature_declaration(file, func);
                    if let Parent::Prop(p) = self.bound(file).expr_parent[e.idx()]
                        && !hir.prop_modifiers(p).is_empty()
                    {
                        self.check_accessor_pair(file, Decl::Property(p));
                    }
                }
                self.check_getter_returns_a_value(file, func);
                if hir[func].ret.is_none() {
                    self.return_type_of_fn(file, func);
                }
                self.check_all_code_paths_in_non_void_function_return_or_throw(file, func);
                self.check_function_body(file, func);
            }
            // `checkTypeParameterDeferred`, `checkClassExpressionDeferred`
            ExprKind::Class(class) => {
                // `None`: the class has one entry, for both.
                let mut entries = self.deferred_type_parameters.iter_mut();
                let is_second =
                    (entries.find(|it| it.0 == e)).map(|it| std::mem::replace(&mut it.1, true));
                if is_second != Some(true) {
                    let symbol = self.bound(file).class_symbol[class.idx()];
                    self.check_type_parameters_deferred(
                        file,
                        symbol,
                        hir[class].type_params,
                        false,
                    );
                }
                if is_second != Some(false) {
                    // `checkClassLikeDeclaration` begins with it. Here no query is in progress.
                    if !hir[class].modifiers.is_empty() {
                        self.check_grammar_class_like_declaration(file, class);
                    }
                    self.check_members(file, hir[class].members)
                }
            }
            ExprKind::Jsx(jsx) => self.check_jsx_element_deferred(file, jsx),
            ExprKind::As { expr, ty } => self.check_assertion_deferred(file, e, expr, ty),
            // `checkVoidExpression`
            ExprKind::Unary { operand, .. } => self.check_expression(file, operand),
            // `resolveUntypedCall`
            ExprKind::Call(c) | ExprKind::New(c) | ExprKind::TaggedTemplate(c) => {
                for x in hir.ids(hir[c].args) {
                    self.check_expression(file, x);
                }
                // `checkExpression(node.Template)`
                if matches!(hir[e].kind, ExprKind::TaggedTemplate(_)) {
                    check_template_spans(self, file, hir[c].args);
                }
            }
            _ => {}
        }
    }

    /// `checkBlock` of an `IsFunctionOrModuleBlock`
    fn check_function_or_module_block(&mut self, file: FileId, statements: IdList<StmtId>) {
        let save_flow_analysis_disabled = self.flow_analysis_disabled;
        self.check_source_elements(file, statements);
        self.flow_analysis_disabled = save_flow_analysis_disabled;
    }

    /// `checkSourceElement(node.Body())`, `checkExpressionCached(node.Body())`
    fn check_function_body(&mut self, file: FileId, func: FnId) {
        let function = &self.hir(file)[func];
        match function.body {
            // A static block is not function-like.
            FnBody::Block(list) if function.kind == FnKind::StaticBlock => {
                self.check_source_elements(file, list);
            }
            FnBody::Block(list) => self.check_function_or_module_block(file, list),
            FnBody::Expr(e) => {
                self.check_expression(file, e);
                self.check_returned_body(file, func, e);
            }
            FnBody::None => {}
        }
    }

    /// `checkDecorators`
    fn check_decorators(&mut self, file: FileId, modifiers: Span<ModifierId>) {
        for modifier in self.hir(file).modifier_list(modifiers) {
            if let ModifierKind::Decorator(e) = modifier.kind {
                self.check_decorator_expression(file, e);
            }
        }
    }

    /// `checkDecorators` returns before it checks the decorators of a node that cannot be
    /// decorated.
    fn check_decorator_expression(&mut self, file: FileId, e: ExprId) {
        if self.bound(file).refused_decorators.contains(&e) {
            self.never_check(self.start_of(file, e), self.end_of_expr(file, e));
        } else {
            self.check_expression(file, e);
        }
    }

    /// `checkTypeParameters`: 2706.
    fn check_type_parameters(&mut self, file: FileId, type_params: Span<TypeParamId>) {
        let hir = self.hir(file);
        let mut seen_default = false;
        for (index, tp) in type_params.iter().enumerate() {
            self.check_type_parameter(file, tp);
            if hir[tp].default.is_some() {
                seen_default = true;
                self.check_type_parameters_not_referenced(
                    file,
                    hir[tp].default,
                    type_params,
                    index,
                );
            } else if seen_default {
                let at = (file, hir[tp].start, self.end_of_type_param(file, tp));
                self.error_at(at, 2706, &[]);
            }
        }
    }

    /// `checkTypeParametersNotReferenced`: 2744, for the nodes in the default `root` of the type
    /// parameter at `index`.
    fn check_type_parameters_not_referenced(
        &mut self,
        file: FileId,
        root: TypeNodeId,
        type_params: Span<TypeParamId>,
        index: usize,
    ) {
        fn visit(hir: &File, node: Node, references: &mut SmallVec<[TypeNodeId; 8]>) {
            if let NodeData::Type(t) = hir.data(node)
                && matches!(hir[t].kind, TypeNodeKind::Ref { name, .. } if name.len() == 1)
            {
                references.push(t);
            }
            hir.for_each_child(node, &mut |child| {
                visit(hir, child, references);
                false
            });
        }
        let hir = self.hir(file);
        let mut references = SmallVec::new();
        visit(hir, hir.node(root), &mut references);
        for node in references {
            // `getTypeFromTypeReference`, which comes before `getConditionalFlowTypeOfType`.
            let t = self.type_from_node(file, node);
            let t = match *self.data(t) {
                TypeData::Substitution { base, .. } => base,
                _ => t,
            };
            if (type_params.iter().skip(index)).any(|p| self.type_param(file, p) == t) {
                self.error(file, node, 2744, &[]);
            }
        }
    }

    /// `checkTypeParameter`
    fn check_type_parameter(&mut self, file: FileId, tp: TypeParamId) {
        let decl = &self.hir(file)[tp];
        if !decl.modifiers.is_empty() {
            self.check_grammar_modifiers(file, tp);
        }
        self.check_type_node(file, decl.constraint);
        self.check_type_node(file, decl.default);
        let ty = self.type_param(file, tp);
        self.base_constraint(ty);
        self.check_type_parameter_default(file, tp, ty);
        self.check_type_name_is_reserved(file, tp, decl.name, 2368);
    }

    /// `checkSignatureDeclaration`
    fn check_signature_declaration(&mut self, file: FileId, func: FnId) {
        let hir = self.hir(file);
        if matches!(
            hir[func].kind,
            FnKind::FunctionType
                | FnKind::Decl
                | FnKind::ConstructorType
                | FnKind::CallSignature
                | FnKind::Constructor
                | FnKind::ConstructSignature
        ) {
            self.check_grammar_function_like_declaration(file, func);
        }
        self.check_type_parameters(file, hir[func].type_params);
        let saved = self.current_source_element;
        if hir[func].this_param.is_some() {
            self.enter_source_element(CurrentNode::Node(file, hir.node(hir[func].this_param)));
            self.check_parameter(file, func, hir[func].this_param);
            self.type_of_this_parameter(file, func);
        }
        for p in hir[func].params.iter() {
            self.enter_source_element(CurrentNode::Node(file, hir.node(p)));
            self.check_parameter(file, func, p);
        }
        self.current_source_element = saved;
        self.check_signature_implicitly_any(file, func);
        self.check_type_node(file, hir[func].ret);
        self.check_generator_return_type(file, func);
        self.check_async_function_return_type(file, func);
        self.check_generator_return_annotation(file, func);
        self.check_full_signature(file, func);
    }

    /// `checkParameter`
    fn check_parameter(&mut self, file: FileId, func: FnId, p: ParamId) {
        let hir = self.hir(file);
        let (node, kind) = (&hir[p], hir[func].kind);
        if !hir.param_modifiers(p).is_empty() {
            self.check_grammar_modifiers(file, p);
        }
        for &(owner, decorator) in hir.decorators.iter() {
            if owner == DecoratorOwner::Param(p) {
                self.check_decorator_expression(file, decorator);
            }
        }
        self.check_type_node(file, node.ty);
        let name = match hir[node.pat].kind {
            PatKind::Ident(name) => name,
            _ => Atom::NONE,
        };
        // `NodeIsPresent(fn.Body())`: present in the source, whether or not it is stored.
        let has_body = has_body(&hir[func]);
        let is_pattern = matches!(hir[node.pat].kind, PatKind::Object(_) | PatKind::Array(_));
        if p != hir[func].this_param {
            if self.check_name_and_initializer(file, node.pat, node.default, !has_body) {
                self.error(file, p, 2371, &[]);
            } else {
                self.check_parameter_initializer(file, p);
            }
        }
        if node.flags.contains(Flags::PARAMETER_PROPERTY) {
            if self.should_check_erasable_syntax(file) {
                self.error(file, p, 1294, &[]);
            }
            if !(kind == FnKind::Constructor && has_body) {
                self.error(file, p, 2369, &[]);
            }
            if kind == FnKind::Constructor && name == known::constructor {
                self.error(file, node.pat, 2398, &[]);
            }
        }
        // `fn.Body() != nil`, which holds for a block whose `{` is missing.
        if node.default.is_none()
            && node.flags.contains(Flags::OPTIONAL)
            && is_pattern
            && (has_body || hir[func].flags.contains(Flags::MISSING_BODY))
        {
            self.error(file, p, 2463, &[]);
        }
        if name == known::this && p != hir[func].this_param {
            self.error(file, p, 2680, &[Arg::Atom(name)]);
        }
        if name == known::this && !node.flags.contains(Flags::REPARSED) {
            match kind {
                FnKind::Constructor | FnKind::ConstructSignature | FnKind::ConstructorType => {
                    self.error(file, p, 2681, &[]);
                }
                FnKind::Arrow => {
                    self.error(file, p, 2730, &[]);
                }
                FnKind::Getter | FnKind::Setter => {
                    self.error(file, p, 2784, &[]);
                }
                _ => {}
            }
        }
        if node.flags.contains(Flags::REST) && !is_pattern {
            self.check_rest_parameter_type(file, func, p);
        }
    }

    /// The end of `checkParameter`: 2370.
    pub(super) fn check_rest_parameter_type(&mut self, file: FileId, func: FnId, p: ParamId) {
        let (hir, bound) = (self.hir(file), self.bound(file));
        let (param, f) = (&hir[p], &hir[func]);
        let mut ty = self.type_of_param(file, p);
        // `assignParameterType`: by the time it is checked, a parameter of a context sensitive function expression has had its `?`
        // added.
        if param.flags.contains(Flags::OPTIONAL)
            && param.ty.is_none()
            && param.default.is_none()
            && f.type_params.is_empty()
            && matches!(f.kind, FnKind::Expr | FnKind::Arrow | FnKind::Method)
            && matches!(bound.fns[func.idx()].owner, FnOwner::Expr(_))
        {
            ty = self.optional(ty);
        }
        let ty = self.reduced(ty);
        let list = self.readonly_array_of(TypeId::ANY);
        if !self.is_assignable(ty, list) {
            self.error(file, p, 2370, &[]);
        }
    }

    /// `shouldCheckErasableSyntax`
    fn should_check_erasable_syntax(&self, file: FileId) -> bool {
        self.p.files.options.erasable_syntax_only && !self.hir(file).is_js
    }

    /// From `checkAssertion`: 1294, of `<T>operand`, from the `<` up to `node.Expression().Pos()`.
    fn check_erasable_type_assertion(&mut self, file: FileId, e: ExprId, operand: ExprId) {
        let hir = self.hir(file);
        let start = self.start_inside_parentheses(file, e);
        let written = self.start_of(file, operand);
        if start < written && self.should_check_erasable_syntax(file) {
            let end = skip_trivia_back(&hir.text, written as usize) as u32;
            self.error_at((file, start, end), 1294, &[]);
        }
    }

    /// `checkFunctionOrMethodDeclaration`: the body is not deferred.
    fn check_function_or_method_declaration(&mut self, file: FileId, func: FnId) {
        if func.is_none() {
            return;
        }
        let hir = self.hir(file);
        self.check_signature_declaration(file, func);
        self.check_function_body(file, func);
        self.check_all_code_paths_in_non_void_function_return_or_throw(file, func);
        if hir[func].ret.is_none()
            && hir[func].flags.contains(Flags::GENERATOR)
            && !matches!(hir[func].body, FnBody::None)
        {
            self.return_type_of_fn(file, func);
        }
    }

    /// The part of `checkVariableLikeDeclaration` from `node.Name()` to the initializer, for a parameter or a binding element.
    /// `is_bodiless`: the declaration belongs to a parameter of a function without a body. Returns true where tsgo reports TS2371 and
    /// returns early; the caller reports it on its own node.
    fn check_name_and_initializer(
        &mut self,
        file: FileId,
        name: PatId,
        initializer: ExprId,
        is_bodiless: bool,
    ) -> bool {
        let exits = is_bodiless && initializer.is_some();
        // Binding pattern elements are checked before the early return; the type of an identifier is resolved after it.
        if !exits || !matches!(self.hir(file)[name].kind, PatKind::Ident(_)) {
            self.check_binding_name(file, name, is_bodiless);
        }
        if exits {
            self.leave_unvisited(file, initializer);
        } else {
            self.check_expression(file, initializer);
        }
        exits
    }

    /// The check of the parent of `e` returns before it checks `e`.
    pub(super) fn leave_unvisited(&mut self, file: FileId, e: ExprId) {
        if e.is_some() {
            let start = self.start_of(file, e);
            self.unvisited_exprs.push((start, e));
        }
    }

    /// `checkVariableLikeDeclaration`, the part for `node.Name()`: a name, or the elements of a
    /// pattern (`checkBindingElement`).
    fn check_binding_name(&mut self, file: FileId, pat: PatId, is_bodiless: bool) {
        if pat.is_none() {
            return;
        }
        let hir = self.hir(file);
        match hir[pat].kind {
            PatKind::Missing => {}
            PatKind::Ident(name) => {
                self.type_of_pat(file, pat);
                self.report_on_circular_pat(file, pat);
                self.check_collisions_for_declaration_name(file, pat, name);
            }
            PatKind::Object(props) => {
                self.check_empty_binding_pattern(file, pat);
                let saved = self.current_source_element;
                for (i, p) in props.iter().enumerate() {
                    self.enter_source_element(CurrentNode::Node(file, hir.node(p)));
                    if hir[p].is_rest && !has_parse_diagnostics(hir) {
                        let (is_last, is_named) =
                            (i + 1 == props.len(), hir[p].key != PropKey::None);
                        check_grammar_rest_element(
                            self,
                            file,
                            hir[p].value,
                            is_last,
                            is_named,
                            hir[p].default,
                        );
                    }
                    let (name, prop) = (hir[p].value, &hir[p]);
                    if is_bodiless && self.is_renamed_binding_element(file, p) {
                        self.renamed_binding_elements_in_types.push(p);
                        if let PropKey::Computed(key) = prop.key {
                            self.unvisited_exprs.push((prop.key_pos, key));
                        }
                        self.leave_unvisited(file, prop.default);
                        continue;
                    }
                    if let PropKey::Computed(key) = prop.key {
                        self.check_expression(file, key);
                    }
                    self.check_binding_element_accessibility(file, pat, name);
                    // "For a commonjs `const x = require`, validate the alias and exit"
                    if matches!(hir[name].kind, PatKind::Ident(_))
                        && self.bound(file).required_by(hir, name).is_some()
                    {
                        continue;
                    }
                    if self.check_name_and_initializer(file, name, prop.default, is_bodiless) {
                        self.error(file, name, 2371, &[]);
                    }
                    self.check_binding_element_initializer(file, hir[p].value, hir[p].default);
                }
                self.current_source_element = saved;
            }
            PatKind::Array(elems) => {
                self.check_empty_binding_pattern(file, pat);
                let saved = self.current_source_element;
                for (i, e) in elems.iter().enumerate() {
                    self.enter_source_element(CurrentNode::Node(file, hir.node(e)));
                    if hir[e].is_rest && !has_parse_diagnostics(hir) {
                        let is_last = i + 1 == elems.len();
                        check_grammar_rest_element(
                            self,
                            file,
                            hir[e].pat,
                            is_last,
                            false,
                            hir[e].default,
                        );
                    }
                    self.check_binding_element_accessibility(file, pat, hir[e].pat);
                    // "For a commonjs `const x = require`, validate the alias and exit"
                    if matches!(hir[hir[e].pat].kind, PatKind::Ident(_))
                        && self.bound(file).required_by(hir, hir[e].pat).is_some()
                    {
                        continue;
                    }
                    if self.check_name_and_initializer(
                        file,
                        hir[e].pat,
                        hir[e].default,
                        is_bodiless,
                    ) {
                        self.error(file, hir[e].pat, 2371, &[]);
                    }
                    self.check_binding_element_initializer(file, hir[e].pat, hir[e].default);
                }
                self.current_source_element = saved;
            }
        }
    }

    /// Whether the element `p` of a pattern has a `PropertyName` and a name: `{ a: b }`, not `{ a }`.
    pub(super) fn is_renamed_binding_element(&self, file: FileId, p: PatPropId) -> bool {
        let hir = self.hir(file);
        matches!(hir[hir[p].value].kind, PatKind::Ident(_))
            && hir[hir[p].value].pos != hir[p].key_pos
    }

    /// Whether `checkVariableLikeDeclaration` returns before `getTypeOfSymbol` for the parameter or
    /// the binding element whose name is the identifier `name`: it is part of a parameter of a
    /// function without a body, and it is renamed or has an initializer.
    pub(super) fn returns_before_type_of_symbol(&self, file: FileId, name: PatId) -> bool {
        let (hir, bound) = (self.hir(file), self.bound(file));
        let PatParent::Param(root) = root_declaration(bound, name) else {
            return false;
        };
        let func = bound.param_fn[root.idx()];
        func.is_some()
            && !has_body(&hir[func])
            && match bound.pat_parent[name.idx()] {
                PatParent::Prop(_, p) if self.is_renamed_binding_element(file, p) => true,
                declaration => declaration.initializer(hir).is_some(),
            }
    }

    /// `checkUnusedRenamedBindingElements`: 2842
    fn check_unused_renamed_binding_elements(&mut self, file: FileId) {
        let (hir, bound) = (self.hir(file), self.bound(file));
        for p in std::mem::take(&mut self.renamed_binding_elements_in_types) {
            let symbol = bound.pat_symbol[hir[p].value.idx()];
            // `WalkUpBindingElementsAndPatterns`
            let PatParent::Param(param) = root_declaration(bound, hir[p].value) else {
                continue;
            };
            if symbol.is_none() {
                continue;
            }
            // `referenceKinds`: `Resolve` notes the reference, so only an identifier that is
            // checked is one.
            if (bound.expr_symbol.iter().enumerate()).any(|(i, &resolved)| {
                resolved == symbol
                    && !bound.is_unchecked(i)
                    && !self.is_never_checked(hir.exprs[i].pos)
            }) {
                continue;
            }
            let start = hir[hir[p].value].pos;
            let (node, name) = match hir[hir[p].value].kind {
                PatKind::Ident(name) if name != known::empty => {
                    (self.place_of_token(file, start), Arg::Atom(name))
                }
                _ => ((file, start, start), Arg::Bytes(b"(Missing)")),
            };
            let property = self.declaration_name_at(file, hir[p].key_pos);
            let related = hir[param].ty.is_none().then(|| {
                let end = self.end_of_param(file, param);
                self.new_diagnostic((file, end, end), 2843, &[Arg::Bytes(&property)])
            });
            let diagnostic = self.error_at(node, 2842, &[name, Arg::Bytes(&property)]);
            if let Some(related) = related {
                diagnostic.add_related_info(related);
            }
        }
    }

    /// `checkVariableDeclarationList`, `checkVariableDeclaration`. `parent`: `node.Parent.Kind`.
    fn check_variable_declaration_list(
        &mut self,
        file: FileId,
        decls: Span<VarDeclId>,
        parent: Kind,
    ) {
        let saved = self.current_source_element;
        for d in decls.iter() {
            self.enter_source_element(CurrentNode::Node(file, self.hir(file).node(d)));
            self.check_grammar_variable_declaration(file, d, parent);
            self.check_variable_declaration(file, d, parent == Kind::ForInStatement);
        }
        self.current_source_element = saved;
    }

    /// The initializer of a loop: a `VariableDeclarationList`, or an expression.
    fn check_for_initializer(&mut self, file: FileId, initializer: StmtId, parent: Kind) {
        match initializer.some().map(|s| self.hir(file)[s].kind) {
            Some(StmtKind::Var(decls)) => self.check_variable_declaration_list(file, decls, parent),
            // `checkForOfStatement`: `checkDestructuringAssignment`
            Some(StmtKind::Expr(target)) if parent == Kind::ForOfStatement => {
                self.check_destructuring_assignment_target(file, target);
            }
            _ => self.check_source_element_worker(file, initializer),
        }
    }

    /// `checkVariableLikeDeclaration` for a variable. `is_in_for_in`:
    /// `IsForInStatement(node.Parent.Parent)`.
    fn check_variable_declaration(&mut self, file: FileId, d: VarDeclId, is_in_for_in: bool) {
        let (hir, bound) = (self.hir(file), self.bound(file));
        let decl = &hir[d];
        self.check_type_node(file, decl.ty);
        // "For a commonjs `const x = require`, validate the alias and exit". `checkAliasSymbol`
        // begins with `resolveAlias`.
        if decl.pat.is_some()
            && matches!(hir[decl.pat].kind, PatKind::Ident(_))
            && bound.required_by(hir, decl.pat).is_some()
        {
            let symbol = bound.pat_symbol[decl.pat.idx()];
            if symbol.is_some() {
                self.resolve_alias(self.files().sym(file, symbol));
            }
            return;
        }
        self.check_binding_name(file, decl.pat, false);
        // "Don't validate for-in initializer as it is already an error"
        if is_in_for_in {
            self.leave_unvisited(file, decl.init);
            return;
        }
        self.check_expression(file, decl.init);
        self.check_variable_initializer(file, d);
        if matches!(decl.kind, VarKind::Using | VarKind::AwaitUsing) {
            self.check_initializer_of_using_declaration(file, d);
        }
    }

    /// `checkClassLikeDeclaration`
    pub(super) fn check_class_like_declaration(&mut self, file: FileId, class: ClassId) {
        let decl = &self.hir(file)[class];
        self.check_decorators(file, decl.modifiers);
        self.check_collisions_for_declaration_name(file, class, decl.name);
        self.check_type_parameters(file, decl.type_params);
        let symbol = self.bound(file).class_symbol[class.idx()];
        // A class expression is checked while its holder is being resolved.
        match self.bound(file).class_owner[class.idx()] {
            crate::bind::ClassOwner::Stmt(_) => {
                self.check_type_parameters_deferred(file, symbol, decl.type_params, false)
            }
            crate::bind::ClassOwner::Expr(e) => {
                self.check_type_parameters_node_deferred(file, e, decl.type_params)
            }
        }
        if symbol.is_some() {
            let sym = self.files().sym(file, symbol);
            self.declared_type(sym);
            self.type_of_symbol(sym);
            // `getSymbolOfDeclaration(member)` is the first to ask for a computed name, before
            // anything asks for the members of the class.
            let node = self.hir(file).node(class);
            self.check_object_type_for_duplicate_declarations(file, node, decl.members, true);
            self.check_type_nodes(file, decl.extends_args);
            self.check_expression(file, decl.extends);
            self.check_type_arguments_of_base(file, class, sym);
            self.report_class_like_declaration(file, class, sym);
        }
        self.check_heritage_clause_elements(file, decl.implements);
        if symbol.is_some() {
            self.check_class_heritage(file, class);
            self.check_property_initialization(file, class);
        }
    }

    /// `checkInterfaceDeclaration`
    fn check_interface_declaration(&mut self, file: FileId, interface: InterfaceId) {
        let decl = &self.hir(file)[interface];
        self.check_type_parameters(file, decl.type_params);
        self.check_type_name_is_reserved(file, interface, decl.name, 2427);
        let symbol = self.bound(file).interface_symbol[interface.idx()];
        self.check_type_parameters_deferred(file, symbol, decl.type_params, false);
        if symbol.is_some() {
            self.check_grammar_interface_declaration(file, interface);
            let sym = self.files().sym(file, symbol);
            let declared = self.declared_type(sym);
            let bases = self.base_types(sym);
            // `typeWithThis`, and `getTypeWithThisArgument(baseType, t.thisType)`: created before
            // the members are checked, and `isDeeplyNestedType` depends on the type creation order.
            // An interface without type parameters may be thisless, which is expensive to
            // determine.
            if !decl.type_params.is_empty() {
                let this = self.intern(TypeData::ThisParam(sym));
                self.type_with_this_argument(declared, this);
                for &base in bases.iter() {
                    self.type_with_this_argument(base, this);
                }
            }
        }
        if symbol.is_some() {
            self.check_interface_heritage(file, interface);
        }
        self.check_bases_of_interface(file, interface);
        self.check_heritage_clause_elements(file, decl.extends);
        self.check_members(file, decl.members);
    }

    /// `checkTypeAliasDeclaration`
    fn check_type_alias_declaration(&mut self, file: FileId, alias: AliasId) {
        let decl = &self.hir(file)[alias];
        self.check_type_name_is_reserved(file, alias, decl.name, 2457);
        let symbol = self.bound(file).alias_symbol[alias.idx()];
        self.check_type_parameters(file, decl.type_params);
        self.check_type_parameters_deferred(file, symbol, decl.type_params, true);
        self.check_intrinsic_alias(file, alias);
        self.check_type_node(file, decl.ty);
    }

    /// `checkSourceElements(node.Members())`, of a class, an interface or a type literal: `checkPropertyDeclaration`,
    /// `checkMethodDeclaration`, `checkConstructorDeclaration`, `checkAccessorDeclaration`, `checkClassStaticBlockDeclaration`,
    /// `checkSignatureDeclaration`.
    fn check_members(&mut self, file: FileId, members: Span<MemberId>) {
        let hir = self.hir(file);
        let saved = self.current_source_element;
        for m in members.iter() {
            self.enter_source_element(CurrentNode::Node(file, hir.node(m)));
            let member = &hir[m];
            if !member.modifiers.is_empty() {
                self.check_grammar_modifiers_of_member(file, m);
            }
            if member.kind == MemberKind::IndexSignature {
                self.check_grammar_index_signature_parameters(file, m);
            }
            self.check_private_name_in_signature(file, m);
            match member.kind {
                MemberKind::Property => {
                    if !self.check_grammar_modifiers(file, m)
                        && !self.check_grammar_property(file, m)
                    {
                        self.check_grammar_computed_property_name(file, member.key);
                    }
                }
                _ if member.func.is_none() => {}
                MemberKind::Method => {
                    if !self.check_grammar_method(file, member.func) {
                        self.check_grammar_computed_property_name(file, member.key);
                        if hir[member.func].flags.contains(Flags::GENERATOR)
                            && self.is_identifier_named_constructor(file, m)
                        {
                            self.error(file, hir.name(hir.node(m)), 1368, &[]);
                        }
                    }
                }
                MemberKind::Getter | MemberKind::Setter => {
                    if !self.check_grammar_function_like_declaration(file, member.func)
                        && !self.check_grammar_accessor(file, member.func)
                    {
                        self.check_grammar_computed_property_name(file, member.key);
                    }
                    if self.is_identifier_named_constructor(file, m)
                        && hir.kind(hir.parent(hir.node(m))).is_class_like()
                    {
                        self.error(file, hir.name(hir.node(m)), 1341, &[]);
                    }
                }
                _ => {}
            }
            self.check_decorators(file, member.modifiers);
            // `checkVariableLikeDeclaration`. The type of an index signature is the return type of
            // its signature, the same node.
            if member.kind != MemberKind::IndexSignature {
                self.check_type_node(file, member.ty);
            }
            if member.func.is_some() {
                self.check_signature_declaration(file, member.func);
                self.check_getter_returns_a_value(file, member.func);
            }
            if member.kind == MemberKind::Constructor
                && !self.check_grammar_constructor_type_parameters(file, member.func)
            {
                self.check_grammar_constructor_type_annotation(file, member.func);
            }
            // `checkComputedPropertyName`
            if let PropKey::Computed(key) = member.key
                && !self.is_computed_name_never_checked(file, key)
            {
                self.check_expression(file, key);
            }
            // `checkAccessorDeclaration`: `getTypeOfAccessors` comes before the body, whose `return`
            // asks for the return type of the signature, which is another resolution.
            if matches!(member.kind, MemberKind::Getter | MemberKind::Setter)
                && self.bound(file).member_symbol[m.idx()].is_some()
            {
                let symbol = self.symbol_of_member(file, m);
                self.type_of_symbol(symbol);
            }
            if member.func.is_some() {
                self.check_function_body(file, member.func);
                self.check_all_code_paths_in_non_void_function_return_or_throw(file, member.func);
            }
            if member.kind == MemberKind::Constructor {
                self.check_super_call_in_constructor(file, m);
            }
            // `checkVariableLikeDeclaration`: `getTypeOfSymbol` comes before
            // `checkExpressionCached(initializer)`, unless the name is computed.
            if member.kind == MemberKind::Property
                && !matches!(member.key, PropKey::Computed(_))
                && member.ty.is_none()
                && self.bound(file).member_symbol[m.idx()].is_some()
            {
                let symbol = self.symbol_of_member(file, m);
                self.type_of_symbol(symbol);
            }
            self.check_expression(file, member.init);
            self.check_property_initializer(file, m);
            if member.kind == MemberKind::Property {
                self.check_variable_like_declaration(file, Decl::Member(m));
            }
            if member
                .flags
                .intersects(Flags::ABSTRACT | Flags::PRIVATE | Flags::PROTECTED)
            {
                self.check_abstract_member_or_accessor_pair(file, m);
            }
            if matches!(member.key, PropKey::Private(_)) && hir.kind(hir.node(m)).is_class_element()
            {
                self.set_node_links_for_private_identifier_scope(file, m);
            }
        }
        self.current_source_element = saved;
    }

    /// `IsIdentifier(node.Name()) && node.Name().Text() == "constructor"`
    fn is_identifier_named_constructor(&self, file: FileId, m: MemberId) -> bool {
        let hir = self.hir(file);
        hir[m].key == PropKey::Name(known::constructor)
            && hir.kind(hir.name(hir.node(m))) == Kind::Identifier
    }

    /// The first test of `checkComputedPropertyName`: `e` is `a in b`, and `[e]` is the name of a
    /// member of a type literal, a class or an interface that is no accessor. Its type is the error
    /// type, and it is not checked.
    fn is_computed_name_never_checked(&self, file: FileId, e: ExprId) -> bool {
        let hir = self.hir(file);
        matches!(hir[e].kind, ExprKind::Binary { op: BinOp::In, .. })
            && !is_parenthesized(hir, e)
            && matches!(self.bound(file).expr_parent[e.idx()], Parent::MemberKey(m)
                if !matches!(hir[m].kind, MemberKind::Getter | MemberKind::Setter))
    }

    /// `checkComputedPropertyName` of the name `[e]`. `check_computed_names` reports 2464.
    /// `checkExpression(e)` has no such test: `checkIndexConstraints` and `getTypeOfNode` check
    /// `a in b`.
    pub(super) fn check_computed_property_name(&mut self, file: FileId, e: ExprId) -> TypeId {
        if self.is_computed_name_never_checked(file, e) {
            return TypeId::ERROR;
        }
        self.type_of_expr(file, e)
    }

    /// `checkPropertyDeclaration`: 1267. `checkMethodDeclaration`: 1245.
    /// `checkAccessorDeclaration`: 2676, 2808. For a class member declared `abstract`, `private` or
    /// `protected`.
    fn check_abstract_member_or_accessor_pair(&mut self, file: FileId, m: MemberId) {
        let hir = self.hir(file);
        let (member, name) = (&hir[m], hir.name(hir.node(m)));
        let is_abstract = member.flags.contains(Flags::ABSTRACT);
        let code = match member.kind {
            MemberKind::Property if is_abstract && member.init.is_some() => 1267,
            MemberKind::Method
                if is_abstract && member.func.is_some() && has_body_node(&hir[member.func]) =>
            {
                1245
            }
            MemberKind::Getter | MemberKind::Setter => 0,
            _ => return,
        };
        if !hir.kind(hir.node(m)).is_class_element() {
            return;
        }
        if code != 0 {
            let (start, end) = self.get_error_range_for_node(file, name);
            let text = self.source_text(file, start, end);
            self.error_at((file, start, end), code, &[Arg::Bytes(&text)]);
            return;
        }
        self.check_accessor_pair(file, Decl::Member(m));
    }

    /// `checkAccessorDeclaration`, "Accessors for the same member name must specify the same
    /// accessibility": 2676, 2808. `accessor`: of a class or of an object literal.
    fn check_accessor_pair(&mut self, file: FileId, accessor: Decl) {
        let hir = self.hir(file);
        // `GetDeclarationOfKind(symbol, KindGetAccessor)`, `KindSetAccessor`
        let declarations = self.declarations_of_member(file, accessor);
        let of_kind = |kind: Kind| {
            let mut here = declarations.iter().filter(|it| it.0 == file);
            here.find(|it| hir.kind(hir.node(it.1)) == kind)
        };
        let (Some(&(_, getter)), Some(&(_, setter))) =
            (of_kind(Kind::GetAccessor), of_kind(Kind::SetAccessor))
        else {
            return;
        };
        // `ModifierFlags()`
        let modifier_flags = |declaration: Decl| match declaration {
            Decl::Member(m) => hir[m].flags,
            Decl::Property(p) => hir.modifiers_to_flags(hir.prop_modifiers(p)),
            _ => Flags::empty(),
        };
        let (get, set) = (modifier_flags(getter), modifier_flags(setter));
        let is_less_accessible = get.contains(Flags::PROTECTED)
            && !set.intersects(Flags::PROTECTED | Flags::PRIVATE)
            || get.contains(Flags::PRIVATE) && !set.contains(Flags::PRIVATE);
        for accessor in [getter, setter] {
            let name = hir.name(hir.node(accessor));
            if get.contains(Flags::ABSTRACT) != set.contains(Flags::ABSTRACT) {
                self.error(file, name, 2676, &[]);
            }
            if is_less_accessible {
                self.error(file, name, 2808, &[]);
            }
        }
    }

    /// `checkSourceElements` for type nodes.
    fn check_type_nodes(&mut self, file: FileId, nodes: IdList<TypeNodeId>) {
        for node in self.hir(file).ids(nodes) {
            self.check_type_node(file, node);
        }
    }

    /// `checkTypeReferenceNode` for the elements of a heritage clause. `checkSourceElement` does
    /// not visit them: `c.currentNode` stays the declaration.
    fn check_heritage_clause_elements(&mut self, file: FileId, elements: IdList<TypeNodeId>) {
        for element in self.hir(file).ids(elements) {
            if element.is_some() {
                self.check_type_node_worker(file, element);
            }
        }
    }

    /// `checkSourceElement` for a type node.
    pub(super) fn check_type_node(&mut self, file: FileId, node: TypeNodeId) {
        if node.is_none() || self.is_stack_low() {
            return;
        }
        let saved = self.enter_source_element(CurrentNode::TypeNode(file, node));
        self.check_type_node_worker(file, node);
        self.current_source_element = saved;
    }

    /// `checkSourceElementWorker` for a type node.
    fn check_type_node_worker(&mut self, file: FileId, node: TypeNodeId) {
        let hir = self.hir(file);
        match hir[node].kind {
            // `checkTypeReferenceNode`
            TypeNodeKind::Ref { args, .. } => {
                self.check_type_nodes(file, args);
                self.check_type_reference_or_import(file, node);
            }
            // `checkImportType` checks the argument, never the type arguments. A non-literal argument is stored in `args` (`spec` is `NONE`).
            TypeNodeKind::Import { spec, args, .. } => {
                if spec.is_none() {
                    self.check_type_nodes(file, args);
                }
                self.check_type_reference_or_import(file, node)
            }
            // `checkThisType`
            TypeNodeKind::Keyword(Keyword::This) => {
                self.type_from_node(file, node);
            }
            // `checkTypeQuery`: `checkExpressionWithTypeArguments`
            TypeNodeKind::Typeof { args, expr, .. } => {
                self.check_type_nodes(file, args);
                self.check_expression(file, expr);
                self.type_from_node(file, node);
            }
            // `checkTypeLiteral`
            TypeNodeKind::Object(members) => {
                self.check_members(file, members);
                let ty = self.type_from_node(file, node);
                if (members.iter()).any(|m| hir[m].kind == MemberKind::IndexSignature) {
                    self.check_index_constraints(file, ty, &[(file, members)], false, None);
                }
            }
            // `checkArrayType`, `checkTypeOperator`
            TypeNodeKind::Array(of) | TypeNodeKind::Keyof(of) => self.check_type_node(file, of),
            TypeNodeKind::Readonly(of) | TypeNodeKind::Unique(of) => {
                self.check_grammar_type_operator_node(file, node);
                self.check_type_node(file, of);
            }
            TypeNodeKind::UniqueSymbol => self.check_grammar_type_operator_node(file, node),
            // `checkSourceElementWorker` has no case for these two: nothing below them is checked.
            TypeNodeKind::JSDoc {
                kind: JSDocTypeKind::Optional | JSDocTypeKind::Variadic,
                ..
            } => {}
            // `checkJSDocType`: `checkJSDocTypeIsInJsFile`
            TypeNodeKind::JSDoc {
                ty,
                kind,
                is_postfix,
            } => {
                let is_nullable = kind == JSDocTypeKind::Nullable;
                if !hir.is_js {
                    let mut suggestion = self.type_from_node(file, ty);
                    // `getNullableType`
                    if is_nullable && !suggestion.is_never() && suggestion != TypeId::VOID {
                        let null: &[TypeId] = if is_postfix { &[] } else { &[TypeId::NULL] };
                        suggestion = self.union(&[&[suggestion, TypeId::UNDEFINED], null].concat());
                    }
                    let token = Arg::Text(if is_nullable { "?" } else { "!" });
                    let code = if is_postfix { 17019 } else { 17020 };
                    self.grammar_error_on_node(file, node, code, &[token, Arg::Type(suggestion)]);
                }
                self.check_type_node(file, ty);
            }
            // `checkTupleType`, `checkNamedTupleMember`
            TypeNodeKind::Tuple(elems) => {
                self.check_tuple_type(file, elems);
                for elem in elems.iter() {
                    self.check_type_node(file, hir[elem].ty);
                }
                self.type_from_node(file, node);
            }
            // `checkUnionOrIntersectionType`
            TypeNodeKind::Union(parts) | TypeNodeKind::Intersection(parts) => {
                self.check_type_nodes(file, parts);
                self.type_from_node(file, node);
            }
            // `checkSignatureDeclaration`
            TypeNodeKind::Fn(func) => self.check_signature_declaration(file, func),
            // `checkConditionalType`
            TypeNodeKind::Cond {
                check,
                extends,
                yes,
                no,
            } => {
                self.check_type_node(file, check);
                self.check_type_node(file, extends);
                self.check_type_node(file, yes);
                self.check_type_node(file, no);
            }
            // `checkInferType`
            TypeNodeKind::Infer(tp) => {
                self.check_infer_type(file, node, tp);
                let saved = self.enter_source_element(CurrentNode::Node(file, hir.node(tp)));
                self.check_type_parameter(file, tp);
                self.current_source_element = saved;
            }
            // `checkTemplateLiteralType`
            TypeNodeKind::Template { types, .. } => {
                for placeholder in hir.ids(types) {
                    self.check_type_node(file, placeholder);
                }
                self.check_template_literal_type(file, types);
                self.type_from_node(file, node);
            }
            // `checkIndexedAccessType`
            TypeNodeKind::IndexedAccess { obj, index } => {
                self.check_type_node(file, obj);
                self.check_type_node(file, index);
                self.check_indexed_access_type(file, node);
            }
            // `checkMappedType`
            TypeNodeKind::Mapped(mapped) => {
                let param = CurrentNode::Node(file, hir.node(hir[mapped].param));
                let saved = self.enter_source_element(param);
                self.check_type_parameter(file, hir[mapped].param);
                self.current_source_element = saved;
                self.check_type_node(file, hir[mapped].name_ty);
                self.check_type_node(file, hir[mapped].ty);
                if hir[mapped].ty.is_none() && self.p.files.options.no_implicit_any {
                    self.error(file, node, 7039, &[]);
                }
                self.type_from_node(file, node);
                self.check_mapped_type_keys(file, mapped);
            }
            TypeNodeKind::Predicate { .. } => self.check_type_predicate(file, node),
            // The rest has no `check` function.
            _ => {}
        }
    }

    /// `checkSourceElement` for a statement. The last call of `checkIfStatement`,
    /// `checkSourceElement(node.ElseStatement)`, is the next turn of the loop: a chain of `else if`
    /// takes no stack.
    fn check_source_element(&mut self, file: FileId, s: StmtId) {
        if s.is_none() || self.is_stack_low() {
            return;
        }
        let hir = self.hir(file);
        let save_current_node = self.current_source_element;
        let save_within_unreachable_code = self.within_unreachable_code;
        let mut node = s;
        loop {
            self.enter_source_element(CurrentNode::Node(file, hir.node(node)));
            if !self.within_unreachable_code
                && self.p.files.options.allow_unreachable_code != Some(true)
                && self.check_source_element_unreachable(file, node)
            {
                self.within_unreachable_code = true;
            }
            self.check_source_element_worker(file, node);
            match hir[node].kind {
                StmtKind::If { no, .. } if no.is_some() => node = no,
                _ => break,
            }
        }
        self.current_source_element = save_current_node;
        self.within_unreachable_code = save_within_unreachable_code;
    }

    /// `checkSourceElementWorker`. The head of a `for` and the object of a `with` are stored as
    /// statements but are not statements.
    fn check_source_element_worker(&mut self, file: FileId, s: StmtId) {
        if s.is_none() {
            return;
        }
        let (hir, bound) = (self.hir(file), self.bound(file));
        // `checkGrammarStatementInAmbientContext`, for the statements that continue regardless of
        // its result.
        if self.has_ambient_context
            && match hir[s].kind {
                StmtKind::Empty
                | StmtKind::Debugger
                | StmtKind::Expr(_)
                | StmtKind::If { .. }
                | StmtKind::While { .. }
                | StmtKind::DoWhile { .. }
                | StmtKind::Switch { .. }
                | StmtKind::Try { .. } => true,
                StmtKind::Block(_) => !is_with_statement(hir, s),
                _ => false,
            }
        {
            self.check_grammar_statement_in_ambient_context(file, s);
        }
        if !hir[s].modifiers.is_empty() {
            self.check_grammar_modifiers_of_statement(file, s);
        }
        match hir[s].kind {
            StmtKind::Expr(e) => self.check_expression(file, e),
            // `checkThrowStatement`: after a line break the thrown expression is missing.
            StmtKind::Throw(e) => {
                if !self.check_grammar_statement_in_ambient_context(file, s)
                    && matches!(hir[e].kind, ExprKind::Missing)
                {
                    let at = (file, hir[e].pos, super::explain::NO_LENGTH);
                    self.grammar_error_at(at, 1142, &[]);
                }
                self.check_expression(file, e);
            }
            // `checkExportAssignment`: misplaced, or in a namespace, it is not checked.
            StmtKind::ExportDefault(e) | StmtKind::ExportAssign(e) => {
                let is_visited = match bound.stmt_parent[s.idx()] {
                    Parent::File => true,
                    Parent::Module(m) => !matches!(hir[m].name, ModuleName::Ident(_)),
                    _ => false,
                };
                if is_visited {
                    self.check_expression(file, e);
                    if matches!(hir[s].kind, StmtKind::ExportAssign(_)) {
                        self.check_grammar_export_equals(file, s);
                    }
                } else if e.is_some() && matches!(bound.stmt_parent[s.idx()], Parent::Module(_)) {
                    self.never_check(self.start_of(file, e), hir[s].loc.end);
                }
                if matches!(hir[s].kind, StmtKind::ExportAssign(_))
                    && matches!(bound.stmt_parent[s.idx()], Parent::File | Parent::Module(_))
                    && self.should_check_erasable_syntax(file)
                    && !hir.is_ambient(hir.node(s))
                {
                    self.error(file, s, 1294, &[]);
                }
            }
            // `checkImportBinding` of `* as ns`: `checkAliasSymbol` begins with `resolveAlias`. The
            // first use of a module decides whether it has a synthetic `default`.
            StmtKind::Import(x) if hir[x].namespace.is_some() => {
                let scope = bound.import_scope[x.idx()];
                if scope.is_some()
                    && let Some(local) =
                        bound.lookup(bound.scopes[scope.idx()].locals, hir[x].namespace)
                {
                    self.resolve_alias(self.files().sym(file, local));
                }
            }
            // `checkGrammarTypeOnlyNamedImportsOrExports`: `type` on the statement and again on a
            // name in it. Reported on the first. After `checkGrammarModuleElementContext`. For an
            // import: `check_grammar_import_clause`.
            StmtKind::ExportNamed(x) if hir[x].type_only => {
                if matches!(bound.stmt_parent[s.idx()], Parent::File | Parent::Module(_))
                    && let Some(item) = hir[x].items.iter().find(|&item| hir[item].type_only)
                {
                    self.grammar_error_at((file, hir[item].start, 0), 2207, &[]);
                }
            }
            // `checkImportEqualsDeclaration`, past `checkGrammarModuleElementContext`
            StmtKind::ImportEquals(_) => {
                if matches!(bound.stmt_parent[s.idx()], Parent::File | Parent::Module(_))
                    && self.should_check_erasable_syntax(file)
                    && !hir.is_ambient(hir.node(s))
                {
                    self.error(file, s, 1294, &[]);
                }
            }
            // `checkReturnStatement`: outside a function, or in a static block, the returned
            // expression is not checked. Elsewhere the return type of the function is resolved
            // first.
            StmtKind::Return(e) => {
                if let Some(func) = self.check_grammar_return_statement(file, s) {
                    self.return_type_of_fn(file, func);
                    self.check_expression(file, e);
                    self.check_return_statement(file, s, func, e);
                }
            }
            StmtKind::Var(decls) => {
                self.check_grammar_variable_statement(file, s, decls);
                self.check_variable_declaration_list(file, decls, Kind::VariableStatement)
            }
            // `checkFunctionDeclaration`
            StmtKind::Fn(func) => {
                self.check_function_or_method_declaration(file, func);
                self.check_grammar_for_generator(file, func);
                self.check_collisions_for_declaration_name(file, s, hir[func].name);
            }
            // `checkClassDeclaration`
            StmtKind::Class(class) => {
                self.check_class_like_declaration(file, class);
                self.check_members(file, hir[class].members);
            }
            StmtKind::Interface(interface) => {
                self.check_grammar_type_declaration(file, s, hir[interface].name_pos, "interface");
                self.check_interface_declaration(file, interface)
            }
            StmtKind::TypeAlias(alias) => {
                self.check_grammar_type_declaration(file, s, hir[alias].name_pos, "type");
                self.check_type_alias_declaration(file, alias)
            }
            // `checkIfStatement`, up to `node.ElseStatement`: see `check_source_element`.
            StmtKind::If { test, yes, .. } => {
                self.check_truthiness_expression(file, test);
                let body = Parent::Stmt(yes);
                self.check_testing_known_truthy_callable_or_awaitable_or_enum_member_type(
                    file, test, body,
                );
                self.check_source_element(file, yes);
                if matches!(hir[yes].kind, StmtKind::Empty) {
                    self.check_empty_then_statement(file, s, yes);
                }
            }
            StmtKind::For {
                init,
                test,
                update,
                body,
            } => {
                if !self.check_grammar_statement_in_ambient_context(file, s)
                    && let Some(StmtKind::Var(decls)) = init.some().map(|init| hir[init].kind)
                {
                    self.check_grammar_variable_declaration_list(file, init, decls);
                }
                self.check_for_initializer(file, init, Kind::ForStatement);
                self.check_truthiness_expression(file, test);
                self.check_expression(file, update);
                self.check_source_element(file, body);
            }
            // `checkForInStatement`: the object expression is checked first.
            StmtKind::ForIn { left, expr, body } => {
                self.check_grammar_for_in_or_for_of_statement(file, s, left);
                self.check_expression(file, expr);
                self.check_for_initializer(file, left, Kind::ForInStatement);
                self.check_for_in_statement(file, left, expr);
                // The keys of an object are strings: there is nothing to destructure.
                match hir[left].kind {
                    StmtKind::Var(decls) => {
                        if let Some(d) = decls.iter().next()
                            && matches!(
                                hir[hir[d].pat].kind,
                                PatKind::Object(_) | PatKind::Array(_)
                            )
                        {
                            self.error(file, hir[d].pat, 2491, &[]);
                        }
                    }
                    StmtKind::Expr(x)
                        if matches!(hir[x].kind, ExprKind::Object(_) | ExprKind::Array(_))
                            && !is_parenthesized(hir, x) =>
                    {
                        let end = self.end_inside_parentheses(file, x);
                        self.error_at((file, hir[x].pos, end), 2491, &[]);
                    }
                    _ => {}
                }
                self.check_source_element(file, body);
            }
            // `checkForOfStatement`: the iterated expression is checked for the variable
            // (`checkRightHandSideOfForOf`), so not at all if none is declared, and before an
            // expression that takes the place of a declaration.
            StmtKind::ForOf {
                left,
                expr,
                body,
                is_await,
            } => {
                self.check_grammar_for_in_or_for_of_statement(file, s, left);
                if is_await {
                    self.check_for_await_in_class_static_block(file, s);
                }
                match hir[left].kind {
                    // `parseVariableDeclarationList` leaves the list empty only before `of Identifier )`.
                    StmtKind::Var(decls) if decls.is_empty() => {
                        let start = self.start_of(file, expr);
                        self.never_check(start, start + 1);
                    }
                    StmtKind::Var(_) => {
                        self.check_for_initializer(file, left, Kind::ForOfStatement);
                        self.check_expression(file, expr);
                    }
                    _ => {
                        self.check_expression(file, expr);
                        self.check_for_initializer(file, left, Kind::ForOfStatement);
                        if let StmtKind::Expr(var_expr) = hir[left].kind {
                            self.check_for_of_initializer(file, var_expr, expr, is_await);
                        }
                    }
                }
                self.check_source_element(file, body);
            }
            StmtKind::While { test, body } => {
                self.check_truthiness_expression(file, test);
                self.check_source_element(file, body);
            }
            StmtKind::DoWhile { body, test } => {
                self.check_source_element(file, body);
                self.check_truthiness_expression(file, test);
            }
            // `checkWithStatement`: checks the object, not the body.
            StmtKind::Block(list) if is_with_statement(hir, s) => {
                self.check_with_statement(file, s, list)
            }
            StmtKind::Block(list) => self.check_source_elements(file, list),
            StmtKind::Switch { expr, cases } => {
                self.check_expression(file, expr);
                let expression_type = self.type_of_expr(file, expr);
                for c in cases.iter() {
                    if hir[c].test.is_some() {
                        self.check_expression(file, hir[c].test);
                        self.check_case_clause(file, expression_type, hir[c].test);
                    }
                    self.check_source_elements(file, hir[c].body);
                    let fallthrough = bound.case_fallthrough[c.idx()];
                    if self.p.files.options.no_fallthrough_cases_in_switch
                        && fallthrough.is_some()
                        && self.is_reachable(file, fallthrough)
                    {
                        self.error(file, c, 7029, &[]);
                    }
                }
            }
            // `checkTryStatement`, `checkCatchClause`
            StmtKind::Try {
                block,
                param,
                handler,
                finalizer,
            } => {
                self.check_source_element(file, block);
                if param.is_some() {
                    self.check_variable_declaration(file, param, false);
                    self.check_catch_clause(file, param, handler);
                }
                self.check_source_element(file, handler);
                self.check_source_element(file, finalizer);
            }
            // `checkBreakOrContinueStatement`
            StmtKind::Break(_) | StmtKind::Continue(_) => {
                if !self.check_grammar_statement_in_ambient_context(file, s) {
                    self.check_grammar_break_or_continue_statement(file, s);
                }
            }
            StmtKind::Labeled { label, body } => {
                if !self.check_grammar_statement_in_ambient_context(file, s) {
                    self.check_grammar_duplicate_label(file, s, label);
                }
                if self.p.files.options.allow_unused_labels == Some(false)
                    && bound.unused_labels.contains(&s)
                {
                    self.error_at(self.place_of_token(file, hir[s].start), 7028, &[]);
                }
                self.check_source_element(file, body);
            }
            StmtKind::Module(module) => {
                self.check_function_or_module_block(file, hir[module].body);
                // `checkGrammarModuleElementContext`
                if matches!(bound.stmt_parent[s.idx()], Parent::File | Parent::Module(_)) {
                    if let ModuleName::Ident(name) = hir[module].name {
                        self.check_collisions_for_declaration_name(file, s, name);
                    }
                    let options = &self.p.files.options;
                    // `ShouldPreserveConstEnums`
                    let preserves_const_enums =
                        options.preserve_const_enums || options.isolated_modules;
                    if self.should_check_erasable_syntax(file)
                        && !hir.is_ambient(hir.node(s))
                        && bound.is_instantiated_module(module, preserves_const_enums)
                    {
                        self.error(file, s, 1294, &[]);
                    }
                }
            }
            StmtKind::Enum(e) => {
                if self.should_check_erasable_syntax(file) && !hir.is_ambient(hir.node(s)) {
                    self.error(file, s, 1294, &[]);
                }
                self.check_collisions_for_declaration_name(file, s, hir[e].name);
                for m in hir[e].members.iter() {
                    self.check_expression(file, hir[m].init);
                }
                // `computeEnumMemberValues`
                for m in hir[e].members.iter() {
                    self.get_enum_member_value(file, m);
                }
                self.check_first_members_of_enum_declarations(file, e);
            }
            _ => {}
        }
    }

    /// `checkExpression`: `e`, then the subexpressions that checking `e` did not need to visit.
    pub(super) fn check_expression(&mut self, file: FileId, e: ExprId) {
        if e.is_none() || self.is_stack_low() {
            return;
        }
        let hir = self.hir(file);
        let ty = self.type_of_expr(file, e);
        // `checkExpressionEx`
        let ty = match hir[e].kind {
            ExprKind::Spread(_) => self.type_of_spread_expression(file, e, ty),
            _ => ty,
        };
        if self.is_const_enum_object(ty) {
            self.check_const_enum_access(file, e, ty);
        }
        match hir[e].kind {
            ExprKind::Template { exprs, .. } | ExprKind::Array(exprs) => {
                for x in hir.ids(exprs) {
                    self.check_expression(file, x);
                }
                // `checkTemplateExpression`. `checkTaggedTemplateExpression` never reaches it.
                if matches!(hir[e].kind, ExprKind::Template { .. }) {
                    check_template_spans(self, file, exprs);
                }
            }
            // `resolveCall`: the type arguments of `super<T>()` are those of the `extends` clause.
            ExprKind::Call(c) | ExprKind::New(c) | ExprKind::TaggedTemplate(c) => {
                let callee = hir[c].callee;
                self.check_expression(file, callee);
                if callee.is_none() || !matches!(hir[callee].kind, ExprKind::Super) {
                    self.check_type_nodes(file, hir[c].type_args);
                }
                // `getCandidateForOverloadFailure` begins with `checkNodeDeferred(node)`.
                if (self.p.call_diagnostics)
                    .get_ref(&self.task, &(file, e))
                    .is_some()
                {
                    self.check_node_deferred(file, e);
                } else {
                    for x in hir.ids(hir[c].args) {
                        self.check_expression(file, x);
                    }
                }
                if matches!(hir[e].kind, ExprKind::TaggedTemplate(_)) {
                    check_tagged_template(self, file, c);
                }
            }
            ExprKind::BigInt(_) => self.check_grammar_big_int_literal(file, e),
            ExprKind::Object(props) => {
                for p in props.iter() {
                    if hir[p].kind == PropKind::Spread {
                        self.check_spread(file, e, p);
                    }
                    if let PropKey::Computed(key) = hir[p].key {
                        self.check_expression(file, key);
                    }
                    if matches!(hir[p].kind, PropKind::Getter | PropKind::Setter) {
                        self.check_node_deferred(file, hir[p].value);
                        continue;
                    }
                    let expr = self.checked_expression_of_literal_member(file, p);
                    self.check_expression(file, expr);
                }
            }
            // `checkFunctionExpressionOrObjectLiteralMethod`: the signature now, and its return
            // type if it is contextually typed.
            ExprKind::Fn(func) => {
                if hir[func].kind == FnKind::Expr {
                    self.check_collisions_for_declaration_name(file, e, hir[func].name);
                }
                // `checkObjectLiteralMethod`
                if hir[func].kind == FnKind::Method {
                    self.check_grammar_method(file, func);
                } else if !self.check_grammar_function_like_declaration(file, func)
                    && hir[func].kind == FnKind::Expr
                {
                    self.check_grammar_for_generator(file, func);
                }
                self.check_signature_declaration(file, func);
                if hir[func].ret.is_none() && self.contextual_signature(file, func).is_some() {
                    self.return_type_of_fn(file, func);
                }
                self.check_node_deferred(file, e);
            }
            // `checkClassExpression`: `type_of_expr` has run `checkClassLikeDeclaration`.
            ExprKind::Class(_) => self.check_node_deferred(file, e),
            // `checkYieldExpression`: outside a generator the yielded expression is not checked.
            // `forEachYieldExpression` hands one in the computed name of a method or an accessor to
            // the generator around that, and `checkAndAggregateYieldOperandTypes` checks it.
            ExprKind::Yield { value, .. } => {
                self.check_grammar_yield_expression(file, e);
                if self.containing_generator(file, e).is_some() {
                    self.check_expression(file, value);
                } else {
                    self.leave_unvisited(file, value);
                }
                if matches!(hir[e].kind, ExprKind::Yield { star: false, .. }) {
                    check_yield_result(self, file, e);
                }
            }
            // `checkAwaitExpression`
            ExprKind::Await(x) => {
                self.check_grammar_await_expression(file, e);
                self.check_expression(file, x);
            }
            ExprKind::Super => self.mark_super_property_in_static_initializer(file, e),
            ExprKind::Regex => self.check_grammar_regular_expression_literal(file, e),
            ExprKind::Unary { op: UnOp::Void, .. } => self.check_node_deferred(file, e),
            ExprKind::Dot { obj: x, .. }
            | ExprKind::Unary { operand: x, .. }
            | ExprKind::Spread(x)
            | ExprKind::NonNull(x) => self.check_expression(file, x),
            // `checkAssertion`
            ExprKind::AsConst(x) => {
                self.check_erasable_type_assertion(file, e, x);
                self.check_expression(file, x);
                self.check_const_assertion(file, x);
            }
            // `checkImportCallExpression`
            ExprKind::ImportCall { args, .. } => {
                self.check_grammar_import_call_expression(file, e);
                for x in hir.ids(args) {
                    self.check_expression(file, x);
                }
            }
            // `checkAssertion`
            ExprKind::As { expr, ty } => {
                self.check_erasable_type_assertion(file, e, expr);
                self.check_expression(file, expr);
                self.check_type_node(file, ty);
                self.check_node_deferred(file, e);
            }
            // `checkSatisfiesExpression`
            ExprKind::Satisfies { expr, ty } => {
                self.check_type_node(file, ty);
                self.check_expression(file, expr);
                let source = self.type_of_expr(file, expr);
                check_satisfies(self, file, e, expr, source, ty);
            }
            // `checkExpressionWithTypeArguments`
            ExprKind::Instantiation { expr, type_args } => {
                self.check_type_nodes(file, type_args);
                self.check_expression(file, expr);
            }
            // `checkBinaryLikeExpression`: `checkDestructuringAssignment(left, checkExpression(right))`
            ExprKind::Assign {
                op: None,
                target,
                value,
            } if target.is_some()
                && matches!(hir[target].kind, ExprKind::Object(_) | ExprKind::Array(_))
                && !is_parenthesized(hir, target) =>
            {
                self.check_expression(file, value);
                self.check_destructuring_assignment_target(file, target);
                // One that is a default in a pattern is checked with the pattern.
                if !self.is_definite_assignment_target(file, e) {
                    let source_type = self.type_of_expr(file, value);
                    self.check_destructuring_assignment(file, target, source_type);
                }
            }
            // `checkBinaryLikeExpression`. It iterates over the left spine, as TypeScript's trampoline does, so that a long chain
            // (`a + b + c + ..`) does not recurse. The order of the checks is that of the recursion.
            ExprKind::Binary { .. } => {
                // Down: the start of this function for each operator on the spine.
                let mut spine: SmallVec<[ExprId; 8]> = SmallVec::new();
                spine.push(e);
                while let ExprKind::Binary { left, .. } = hir[spine[spine.len() - 1]].kind
                    && left.is_some()
                    && matches!(hir[left].kind, ExprKind::Binary { .. })
                {
                    let ty = self.type_of_expr(file, left);
                    if self.is_const_enum_object(ty) {
                        self.check_const_enum_access(file, left, ty);
                    }
                    spine.push(left);
                }
                // Up: the leftmost operand, then the right operand and the checks of each operator.
                let mut is_innermost = true;
                while let Some(e) = spine.pop() {
                    let ExprKind::Binary { op, left, right } = hir[e].kind else {
                        unreachable!()
                    };
                    if std::mem::take(&mut is_innermost) {
                        self.check_expression(file, left);
                    }
                    self.check_expression(file, right);
                    match op {
                        BinOp::And | BinOp::Or | BinOp::Nullish => {
                            let is_and = op == BinOp::And;
                            self.check_testing_known_truthy_left_operand(file, e, is_and, left)
                        }
                        BinOp::Comma => self.check_comma_operator(file, e, left, right),
                        BinOp::Instanceof => {
                            check_instance_of_expression(self, file, e, left, right)
                        }
                        _ => {}
                    }
                }
            }
            ExprKind::Index {
                obj: a, index: b, ..
            }
            | ExprKind::Assign {
                target: a,
                value: b,
                ..
            } => {
                self.check_expression(file, a);
                self.check_expression(file, b);
            }
            ExprKind::Cond { test, yes, no } => {
                self.check_expression(file, test);
                let body = Parent::Expr(yes);
                self.check_testing_known_truthy_callable_or_awaitable_or_enum_member_type(
                    file, test, body,
                );
                self.check_expression(file, yes);
                self.check_expression(file, no);
            }
            // `checkJsxFragment`
            ExprKind::Jsx(jsx) if hir[jsx].tag.is_none() => {
                self.check_jsx_element_deferred(file, jsx)
            }
            // `checkJsxElement`, `checkJsxSelfClosingElement`
            ExprKind::Jsx(_) => self.check_node_deferred(file, e),
            _ => {}
        }
    }

    /// Whether `e` is the name of `{ e = 1 }` outside a destructuring pattern, where
    /// `checkShorthandPropertyAssignment` checks the `ObjectAssignmentInitializer` in its place:
    /// nothing resolves the name.
    pub(super) fn is_name_with_object_assignment_initializer(
        &self,
        file: FileId,
        e: ExprId,
    ) -> bool {
        let (hir, bound) = (self.hir(file), self.bound(file));
        let Some(&Parent::Expr(assignment)) = bound.expr_parent.get(e.idx()) else {
            return false;
        };
        matches!(hir[assignment].kind, ExprKind::Assign { op: None, target, .. } if target == e)
            && matches!(bound.expr_parent[assignment.idx()], Parent::Prop(p)
                if hir[p].kind == PropKind::Shorthand
                    && bound.get_assignment_target(hir, bound.prop_owner[p.idx()]).is_none())
    }

    /// `checkDestructuringAssignment`, restricted to what it visits: a literal is destructured, and
    /// anything else, including a parenthesized literal, is an expression
    /// (`checkReferenceAssignment`). A target with a default is an assignment of its own.
    fn check_destructuring_assignment_target(&mut self, file: FileId, e: ExprId) {
        let hir = self.hir(file);
        if e.is_none() {
            return;
        }
        match hir[e].kind {
            ExprKind::Object(properties) if !is_parenthesized(hir, e) => {
                for (i, p) in properties.iter().enumerate() {
                    if let PropKey::Computed(key) = hir[p].key {
                        self.check_expression(file, key);
                    }
                    // A rest element that is not last is rejected and not visited. Neither is a
                    // member that is not a property assignment.
                    let continues = match hir[p].kind {
                        PropKind::Init | PropKind::Shorthand => true,
                        PropKind::Spread => i + 1 == properties.len(),
                        _ => false,
                    };
                    if continues {
                        self.check_destructuring_assignment_target(file, hir[p].value);
                    }
                }
            }
            ExprKind::Array(elements) if !is_parenthesized(hir, e) => {
                for (i, element) in hir.ids(elements).enumerate() {
                    match hir[element].kind {
                        ExprKind::Spread(rest) => {
                            let has_default =
                                matches!(hir[rest].kind, ExprKind::Assign { op: None, .. })
                                    && !is_parenthesized(hir, rest);
                            if i + 1 == elements.len() && !has_default {
                                self.check_destructuring_assignment_target(file, rest);
                            }
                        }
                        _ => self.check_destructuring_assignment_target(file, element),
                    }
                }
            }
            _ => self.check_expression(file, e),
        }
    }

    /// `checkJsxElementDeferred`, `checkJsxSelfClosingElementDeferred`
    fn check_jsx_element_deferred(&mut self, file: FileId, jsx: JsxId) {
        let hir = self.hir(file);
        let component = |c: &Self, tag: ExprId| match tag.some() {
            Some(tag) if c.jsx_intrinsic_tag_name(file, tag).is_none() => tag,
            _ => ExprId::NONE,
        };
        self.check_expression(file, component(self, hir[jsx].tag));
        self.check_type_nodes(file, hir[jsx].type_args);
        let first = hir[jsx].attrs.iter().next();
        let element = first.map(|p| self.bound(file).prop_owner[p.idx()]);
        let is_never_checked =
            element.is_some_and(|e| self.are_jsx_attributes_never_checked(file, e));
        for p in hir[jsx].attrs.iter() {
            let value = hir[p].value;
            if is_never_checked {
                if value.is_some() {
                    self.never_check(self.start_of(file, value), self.end_of_expr(file, value));
                }
                continue;
            }
            self.check_expression(file, value);
            if hir[p].kind == PropKind::Spread {
                self.check_spread(file, self.bound(file).prop_owner[p.idx()], p);
            }
        }
        self.check_expression(file, component(self, hir[jsx].close_tag));
        for x in hir.ids(hir[jsx].children) {
            self.check_expression(file, x);
        }
    }
}
