//! `ast.Diagnostic`, and `DiagnosticsCollection` for all the tasks of a program.
//!
//! Every diagnostic belongs to the task or to a query.
//! - Reported with no query in progress, by a pass of `check_file`: it belongs to the task, and is
//!   reported.
//! - Reported inside a query: it belongs to the query. A hit on its entry reports nothing, but
//!   several tasks can each have evaluated it. The first task that commits a diagnostic under the
//!   query reports. What later tasks commit under it is dropped (`Program::publish_reported`).
//!
//! `add_diagnostic` pushes onto `Checker::reported`. The diagnostics of a frame are the suffix from
//! `QueryFrame::reported_from`.
//! `Checker::leave` calls `settle_reported` for them:
//! - the result is final: they move to `Task::diagnostics`, tagged with the query;
//! - the result depends on a cycle, a trial or a refused query (`drops_reported`): dropped. The
//!   next evaluation reports again;
//! - the result depends on an incomplete flow-loop type (`taint_from`): they stay, and belong to
//!   the enclosing frame.
//!
//! A commit moves the diagnostics of a task to the buffers of their files (`Sink`).
//! `Program::finish_file` reads the buffer of a file after the last task has ended.
//!
//! Diagnostics that belong to the task and are located in the file of its `check_file` stay in
//! `reported` until that ends, and go to `finish_file`.
//!
//! A callback of `addDeferredDiagnostic` whose message prints a type is a `Reported` too, with
//! `Reported::deferred` in place of the arguments. So it belongs to the task or to a query, and is
//! dropped with a frame, like a diagnostic. `produce_type_not_iterable_errors` creates the message.
//!
//! A diagnostic that leaves its task is settled (`Checker::settled`): every field that only the HIR
//! of its file can provide has been filled in. The HIR of a file that nothing imports is freed at
//! the end of its task, and `finish_file` reads no HIR.

use super::explain::NOWHERE;
use super::*;
use crate::util::SharedSort;
use bun_threading::Guarded;

/// `args ...any` of `NewDiagnostic` and `reportError`.
#[derive(Copy, Clone)]
pub(super) enum Arg<'a> {
    /// `TypeToString`
    Type(TypeId),
    /// `symbolToString`
    Sym(Sym),
    /// `symbolToString` of a property.
    Prop(&'a Prop<'a>),
    /// `signatureToString`
    Sig(SigId),
    Atom(Atom),
    Number(usize),
    Bytes(&'a [u8]),
    Text(&'a str),
    /// A path in the checker's format: `displayed_path`.
    Path(&'a [u8]),
}

/// The arguments of a message, printed.
pub(super) type Args = Box<[Box<[u8]>]>;

/// For callers that still print the arguments themselves. To be removed with its last caller: a
/// diagnostic takes `&[Arg]`.
pub(super) fn held(args: Vec<impl Into<Vec<u8>>>) -> Args {
    (args.into_iter().map(|arg| arg.into().into())).collect()
}

/// A number as printed in a message.
pub(super) fn number_text(number: usize) -> Vec<u8> {
    bun_core::fmt::itoa(&mut bun_core::fmt::ItoaBuf::new(), number).to_vec()
}

/// `maxSerializationLevel`
pub(super) const MAX_SERIALIZATION_LEVEL: u32 = 2;

/// `ast.Diagnostic`
#[derive(Clone, PartialEq, Eq, Debug)]
pub(super) struct Reported {
    pub(super) file: FileId,
    pub(super) start: u32,
    /// Until `finish_file`, 0 means the end of the token at `start`. `NO_LENGTH`: an empty span at
    /// `start`.
    pub(super) end: u32,
    pub(super) code: u32,
    pub(super) args: Args,
    pub(super) message_chain: Vec<Reported>,
    pub(super) related_information: Vec<Reported>,
    /// `CategorySuggestion`
    pub(super) is_suggestion: bool,
    /// `SkippedOnNoEmit`
    pub(super) skipped_on_no_emit: bool,
    /// Once settled: the start of the `@ts-ignore` or `@ts-expect-error` directive that suppresses
    /// it. `NO_DIRECTIVE`: none does.
    pub(super) directive: u32,
    /// Once settled: `is_bare` before `end` was filled in.
    pub(super) was_bare: bool,
    /// `Emit` reported it, before the check (`Options::emits_first`). It stays where
    /// `checkSourceFile` never comes.
    pub(super) by_emit: bool,
    /// The check of another node than the one it points at reported it: `checkUnusedIdentifiers`
    /// for the container of a declaration, `resolveAlias` for a reference. It stays where
    /// `checkSourceFile` never comes.
    pub(super) by_another_node: bool,
    /// It is a callback of `addDeferredDiagnostic` that has not been called: `args` is empty.
    pub(super) deferred: Option<TypeNotIterable>,
}

/// What a callback of `getIterationTypesOfIterableWorker` passes to `reportTypeNotIterableError`
/// with the error node.
#[derive(Copy, Clone, PartialEq, Eq, Debug)]
pub(super) struct TypeNotIterable {
    pub(super) ty: TypeId,
    pub(super) allows_async: bool,
    /// The error node is the iterated expression of a `for..of`.
    pub(super) is_of_for_of: bool,
}

pub(super) const NO_DIRECTIVE: u32 = u32::MAX;

impl Reported {
    /// `NewDiagnostic` with already printed arguments.
    /// For a message without arguments.
    pub(super) fn bare(at: (FileId, u32, u32), code: u32) -> Reported {
        Reported::new(at, code, Args::default())
    }

    pub(super) fn new(at: (FileId, u32, u32), code: u32, args: Args) -> Reported {
        Reported {
            file: at.0,
            start: at.1,
            end: at.2,
            code,
            args,
            message_chain: Vec::new(),
            related_information: Vec::new(),
            is_suggestion: false,
            skipped_on_no_emit: false,
            directive: NO_DIRECTIVE,
            was_bare: false,
            by_emit: false,
            by_another_node: false,
            deferred: None,
        }
    }

    /// Converts a diagnostic stored in the HIR of `file`.
    pub(super) fn from_hir(file: FileId, d: &hir::Diagnostic) -> Reported {
        let related = d
            .related
            .iter()
            .map(|related| Reported::from_hir(file, related));
        Reported {
            related_information: related.collect(),
            ..Reported::new((file, d.start, d.end), d.code, d.args.clone())
        }
    }

    /// What stands in `Task::diagnostics` for a diagnostic that a commit has taken out while a file was being checked:
    /// `check_file` remembers places in that list.
    fn taken() -> Reported {
        Reported::bare(NOWHERE, 0)
    }

    fn is_taken(&self) -> bool {
        self.code == 0
    }

    /// It has a start and a code, and no end, arguments or chain.
    pub(super) fn is_bare(&self) -> bool {
        self.end == 0 && self.args.is_empty() && self.message_chain.is_empty()
    }

    /// `AddRelatedInfo`
    pub(super) fn add_related_info(&mut self, related: Reported) -> &mut Self {
        self.related_information.push(related);
        self
    }
}

/// `compareMessageChainSize`: the longer first.
fn compare_message_chain_size(a: &[Reported], b: &[Reported]) -> std::cmp::Ordering {
    a.iter()
        .zip(b)
        .fold(b.len().cmp(&a.len()), |order, (a, b)| {
            order.then_with(|| compare_message_chain_size(&a.message_chain, &b.message_chain))
        })
}

/// `compareMessageChainContent` for two chains of equal size.
fn compare_message_chain_content(a: &[Reported], b: &[Reported]) -> std::cmp::Ordering {
    a.iter()
        .zip(b)
        .fold(std::cmp::Ordering::Equal, |order, (a, b)| {
            order
                .then_with(|| a.args.cmp(&b.args))
                .then_with(|| compare_message_chain_content(&a.message_chain, &b.message_chain))
        })
}

/// `EqualDiagnostics`
fn equal_diagnostics(a: &Reported, b: &Reported) -> bool {
    let (related_to_a, related_to_b) = (&a.related_information, &b.related_information);
    equal_diagnostics_no_related_info(a, b)
        && related_to_a.len() == related_to_b.len()
        && (related_to_a.iter().zip(related_to_b)).all(|(a, b)| equal_diagnostics(a, b))
}

/// `EqualDiagnosticsNoRelatedInfo`
fn equal_diagnostics_no_related_info(a: &Reported, b: &Reported) -> bool {
    (a.file, a.start, a.end, a.code) == (b.file, b.start, b.end, b.code)
        && a.args == b.args
        && equal_message_chains(&a.message_chain, &b.message_chain)
}

/// `slices.EqualFunc(a, b, equalMessageChain)`
fn equal_message_chains(a: &[Reported], b: &[Reported]) -> bool {
    a.len() == b.len()
        && a.iter().zip(b).all(|(a, b)| {
            a.code == b.code
                && a.args == b.args
                && equal_message_chains(&a.message_chain, &b.message_chain)
        })
}

/// Diagnostics as in `Task::diagnostics`.
pub(super) type Logged = Vec<(Option<Query>, Reported)>;

pub(super) struct Sink<'s> {
    /// The diagnostics reported in each file. A `Reported` owns memory of the regular heap:
    /// `release`.
    by_file: ArenaVec<'s, Guarded<Vec<Reported>>>,
    /// The queries under which a task has reported, each with `Task::number` of the first that has. Any thread adds to it,
    /// so it is on the regular heap too.
    owners: Guarded<FxHashMap<Query, u64>>,
}

impl<'s> Sink<'s> {
    pub(super) fn new_in(files: usize, arena: &'s Arena) -> Sink<'s> {
        Sink {
            by_file: vec_from_iter_in((0..files).map(|_| Guarded::default()), arena),
            owners: Guarded::default(),
        }
    }

    /// See `Program::release`.
    pub(super) fn release(&mut self) {
        for reported in &mut self.by_file {
            *reported.get_mut() = Vec::new();
        }
        *self.owners.get_mut() = FxHashMap::default();
    }
}

/// Whether `q` is the same key in every task: it holds a file and a node, or a symbol. A type,
/// signature or mapper id can be task-local.
fn is_task_independent(q: Query) -> bool {
    match q {
        Query::Symbol(_)
        | Query::Declared(_)
        | Query::Bases(_)
        | Query::BaseConstructor(_)
        | Query::Return(..)
        | Query::ReturnAtFirstLook(..)
        | Query::Pat(..)
        | Query::ParameterSymbol(..)
        | Query::LiteralProp(..)
        | Query::TypeNode(..)
        | Query::Enum(..)
        | Query::Expr(..)
        | Query::ExprInFlowLoop(..)
        | Query::Call(..)
        | Query::InitializerIsUndefined(..)
        | Query::AliasTarget(_)
        | Query::WriteType(..)
        | Query::Comparison(_) => true,
        Query::ReturnOfSignature(_)
        | Query::Shape(_)
        | Query::Properties(_)
        | Query::Constraint(_)
        | Query::InferredConstraint(_)
        | Query::MappedProp(..)
        | Query::Cond(..)
        | Query::TypeArguments(_) => false,
    }
}

/// `is_task_independent` for tasks that publish their records when they create them (`Sharing::Publishes`): an id without
/// `LOCAL` is the same in every task too.
fn is_same_in_every_task(q: Query) -> bool {
    let is_shared = |number: u32| !crate::local::is_local_number(number);
    match q {
        Query::ReturnOfSignature(signature) => is_shared(signature.0),
        Query::Shape(ty)
        | Query::Properties(ty)
        | Query::Constraint(ty)
        | Query::InferredConstraint(ty)
        | Query::TypeArguments(ty) => is_shared(ty.0),
        Query::MappedProp(ty, name) => is_shared(ty.0) && is_shared(name.0),
        Query::Cond(_, _, mapper) => is_shared(mapper.0),
        q => is_task_independent(q),
    }
}

impl super::Program<'_> {
    /// Moves what a task has reported to the buffers of the files. Called in a commit. `task` is `Task::number`.
    pub(super) fn publish_reported(&self, task: u64, reported: Logged) {
        let mut owners = self.sink.owners.lock();
        for (owner, diagnostic) in reported {
            if owner.is_some_and(|q| *owners.entry(q).or_insert(task) != task) {
                continue;
            }
            self.push_diagnostic(diagnostic);
        }
    }

    /// The number of the commit that has stored the entry of `q`. `None`: there is no such entry, or `q` is not about
    /// syntax, or stores none.
    fn commit_of_entry(&self, q: Query) -> Option<u32> {
        match q {
            Query::Expr(file, e) => self.expr_types.commit_of((file, e)),
            Query::Call(file, e) => self.calls.commit_of((file, e)),
            Query::Symbol(symbol) => self.symbol_types.commit_of(symbol),
            Query::Declared(symbol) => self.declared_types.commit_of(symbol),
            Query::Bases(symbol) => self.base_types.commit_of(symbol),
            Query::BaseConstructor(symbol) => self.base_constructor_types.commit_of(symbol),
            Query::Return(file, func) | Query::ReturnAtFirstLook(file, func) => {
                self.fn_return_types.commit_of((file, func))
            }
            Query::Pat(file, pat) | Query::ParameterSymbol(file, pat) => {
                self.pat_types.commit_of((file, pat))
            }
            Query::LiteralProp(file, prop) => self.literal_prop_types.commit_of((file, prop)),
            Query::TypeNode(file, node) => self.type_node_types.commit_of((file, node)),
            _ => None,
        }
    }

    /// At a commit, under its mutex, before it stores. What was reported while a query was evaluated belongs to the entry
    /// that the query stores. If another task has stored that entry, this task's loses: every reader goes by the
    /// other one, and what belongs to it is what its task has reported. `is_own`: whether a commit is one of this task.
    ///
    /// Only for a diagnostic in the file that the query is about. A task of that file or of an earlier one logs it, so such
    /// a winner has logged it if there was anything to log. A task of a later file doesn't.
    pub(super) fn drop_diagnostics_of_losers(
        &self,
        reported: &mut Logged,
        is_own: impl Fn(u32) -> bool,
    ) {
        reported.retain(|(owner, diagnostic)| {
            !owner.is_some_and(|q| {
                let winner = self.commit_of_entry(q);
                // A task of a later file hasn't logged it.
                let has_logged_it = |commit: u32| {
                    let rank = self.commits.rank_of(commit);
                    rank <= Some(self.files.rank_of_file(diagnostic.file))
                };
                q.syntax() == Some(diagnostic.file)
                    && winner.is_some_and(|commit| !is_own(commit) && has_logged_it(commit))
            })
        });
    }

    /// To the buffer of the file, or to `global_errors` if it is located in no file (`c.error(nil, ..)`).
    fn push_diagnostic(&self, diagnostic: Reported) {
        if diagnostic.file != NOWHERE.0 {
            return self.sink.by_file[diagnostic.file.idx()]
                .lock()
                .push(diagnostic);
        }
        let args = diagnostic.args.iter();
        let args = args.map(|arg| arg.to_vec());
        (self.global_errors.lock()).insert((diagnostic.code, args.collect()));
    }

    /// The diagnostics the tasks have reported in `file`.
    pub(super) fn take_buffer(&self, file: FileId) -> Vec<Reported> {
        std::mem::take(&mut *self.sink.by_file[file.idx()].lock())
    }

    /// `CompareDiagnostics`
    pub(super) fn compare_diagnostics(&self, a: &Reported, b: &Reported) -> std::cmp::Ordering {
        // `getDiagnosticPath`
        let path = |file: FileId| match file {
            crate::program::IN_CONFIGURATION => Some(&self.files.options.config_path[..]),
            file => self.files.modules.get(file.idx()).map(|m| m.file_name()),
        };
        let path = |file: FileId| path(file).map(crate::resolve::typescript_path);
        // Nearly always two of one file.
        let by_path = match a.file == b.file {
            true => std::cmp::Ordering::Equal,
            false => path(a.file).cmp(&path(b.file)),
        };
        by_path
            .then_with(|| (a.start, a.end, a.code, &a.args).cmp(&(b.start, b.end, b.code, &b.args)))
            .then_with(|| compare_message_chain_size(&a.message_chain, &b.message_chain))
            .then_with(|| compare_message_chain_content(&a.message_chain, &b.message_chain))
            // `compareRelatedInfo`
            .then_with(|| {
                let (a, b) = (&a.related_information, &b.related_information);
                let by_length = b.len().cmp(&a.len());
                a.iter().zip(b).fold(by_length, |order, (a, b)| {
                    order.then_with(|| self.compare_diagnostics(a, b))
                })
            })
    }

    /// `SortAndDeduplicateDiagnostics`
    pub(super) fn sort_and_deduplicate_diagnostics(&self, reported: &mut Vec<Reported>) {
        reported.shared_sort_by(|a, b| self.compare_diagnostics(a, b));
        // `compactAndMergeRelatedInfos`: diagnostics that differ only in their related information
        // are merged into one that has all of it, sorted.
        reported.dedup_by(|next, first| {
            let is_same = equal_diagnostics_no_related_info(next, first);
            if is_same {
                let related = &mut first.related_information;
                related.append(&mut next.related_information);
                related.shared_sort_by(|a, b| self.compare_diagnostics(a, b));
                related.dedup_by(|next, first| equal_diagnostics(next, first));
            }
            is_same
        });
    }
}

impl Checker<'_, '_> {
    /// `StringifyArgs`. They are printed eagerly, as in tsgo: printing runs queries.
    pub(super) fn stringify_args(&mut self, args: &[Arg<'_>]) -> Args {
        args.iter()
            .map(|arg| {
                let mut out = Vec::new();
                match *arg {
                    Arg::Type(ty) => self.write_type(&mut out, ty, super::print::TYPE_TO_STRING),
                    Arg::Sym(symbol) => self.write_symbol(&mut out, symbol),
                    Arg::Prop(prop) => self.write_prop(&mut out, prop),
                    Arg::Sig(signature) => self.write_signature(&mut out, signature),
                    Arg::Atom(name) => out.extend_from_slice(self.atoms().bytes(name)),
                    Arg::Number(number) => out.extend_from_slice(bun_core::fmt::itoa(
                        &mut bun_core::fmt::ItoaBuf::new(),
                        number,
                    )),
                    Arg::Bytes(bytes) => out.extend_from_slice(bytes),
                    Arg::Text(text) => out.extend_from_slice(text.as_bytes()),
                    Arg::Path(path) => {
                        out.extend_from_slice(&crate::resolve::displayed_path(path));
                    }
                }
                out.into_boxed_slice()
            })
            .collect()
    }

    /// `NewDiagnosticForNode`
    pub(super) fn new_diagnostic(
        &mut self,
        at: (FileId, u32, u32),
        code: u32,
        args: &[Arg<'_>],
    ) -> Reported {
        Reported::new(at, code, self.stringify_args(args))
    }

    /// `NewDiagnosticChainForNode`
    pub(super) fn new_diagnostic_chain(
        &mut self,
        chain: Option<Reported>,
        at: (FileId, u32, u32),
        code: u32,
        args: &[Arg<'_>],
    ) -> Reported {
        let Some(mut chain) = chain else {
            return self.new_diagnostic(at, code, args);
        };
        // `NewDiagnosticChain`
        let mut diagnostic = self.new_diagnostic((chain.file, chain.start, chain.end), code, args);
        diagnostic.related_information = std::mem::take(&mut chain.related_information);
        diagnostic.message_chain.push(chain);
        diagnostic
    }

    /// `c.error`
    #[cold]
    pub(super) fn error(
        &mut self,
        file: FileId,
        node: impl ToNode,
        code: u32,
        args: &[Arg<'_>],
    ) -> &mut Reported {
        let (start, end) = self.get_error_range_for_node(file, self.hir(file).node(node));
        self.error_at((file, start, end), code, args)
    }

    /// `c.error`, for callers that have no node to report on.
    #[cold]
    pub(super) fn error_at(
        &mut self,
        at: (FileId, u32, u32),
        code: u32,
        args: &[Arg<'_>],
    ) -> &mut Reported {
        let diagnostic = self.new_diagnostic(at, code, args);
        self.add_diagnostic(diagnostic)
    }

    /// `grammarErrorAtPos`: returns whether it reported, which it does not in a file with parse
    /// errors.
    pub(super) fn grammar_error_at(
        &mut self,
        at: (FileId, u32, u32),
        code: u32,
        args: &[Arg<'_>],
    ) -> bool {
        if has_parse_diagnostics(self.hir(at.0)) {
            return false;
        }
        self.error_at(at, code, args);
        true
    }

    /// `addErrorOrSuggestion`
    pub(super) fn add_error_or_suggestion(&mut self, is_error: bool, mut diagnostic: Reported) {
        diagnostic.is_suggestion = !is_error;
        if is_error || self.captures_suggestions() {
            self.add_diagnostic(diagnostic);
        }
    }

    /// Notes the files whose own tasks have to evaluate what led to an error in `file`: that file, and the files that the
    /// queries in progress are about. See `View::hides`.
    #[cold]
    pub(super) fn note_error_in(&mut self, file: FileId) {
        let about = self.stack.iter().filter_map(|q| q.syntax());
        let others = about.chain([file]).filter(|&it| self.task.file != Some(it));
        self.files_with_errors.extend(others);
    }

    /// True if this task doesn't report an error in `file`, because it checks a later file. tsc never collects such an error:
    /// it's reported after `file` was checked. If the check of `file`, or of a file before it, gets to the error too, its
    /// own task reports it.
    /// - An entry under a record is shared whoever stores it, so its errors go with it.
    /// - tsc's check of a file resolves every alias the file declares. Here that happens on demand, so whoever is first
    ///   reports.
    fn is_left_to_an_earlier_file(&self, owner: Option<Query>, file: FileId) -> bool {
        let is_late = |visited: FileId| !self.is_checked_no_later_than(visited, file);
        self.task.file.is_some_and(is_late)
            && match owner {
                Some(Query::AliasTarget(alias)) => is_late(alias.file),
                Some(q) if q.syntax().is_none() => !self.is_reported_in_time(owner, file),
                _ => true,
            }
    }

    /// `c.addDiagnostic`
    pub(super) fn add_diagnostic(&mut self, diagnostic: Reported) -> &mut Reported {
        self.note_error_in(diagnostic.file);
        // "Discard diagnostics created while at the maximum number of recursive TypeToString invocations."
        if self.serialization_level >= MAX_SERIALIZATION_LEVEL {
            // For a diagnostic in another file, tsgo's result depends on file order. Mark the innermost query non-cacheable so that
            // the owning file recomputes it during its own check and reports the diagnostic there.
            if self.task.file != Some(diagnostic.file) {
                self.mark_tainted_from(self.frames.len().saturating_sub(1));
            } else if let Some(from) = self.expressions_checked_again() {
                self.mark_tainted_from(from);
            }
            return self.discarded.insert(diagnostic);
        }
        if self.is_reported_too_late(None, diagnostic.file) {
            self.mark_tainted_from(0);
            return self.discarded.insert(diagnostic);
        }
        self.reported.push(diagnostic);
        self.reported.last_mut().unwrap()
    }

    /// `checkExpression` stores no result, and creates a discarded diagnostic again. The index in
    /// `stack` of the outermost of the expressions that check one another, up to the innermost
    /// query, if `checkSourceFile` checks it again.
    /// - `getReturnTypeFromBody` checks the expression of a `return` statement, without its
    ///   parentheses, with `checkExpressionCached`, and `checkReturnStatement` with them. An
    ///   expression body and the operand of a `yield` are checked again with `checkExpression`.
    /// - `getTypeOfExpression`, for the assigned type of a reference, stores nothing that
    ///   `checkExpression` reads.
    /// - `checkObjectLiteral` checks every member. Here whoever reads a member first checks it.
    fn expressions_checked_again(&self) -> Option<usize> {
        use crate::bind::Parent;
        let floor = self.printing_floors.last().copied().unwrap_or(0);
        let is_check = |q: &&Query| matches!(q, Query::Expr(..) | Query::LiteralProp(..));
        let checks = self.stack.get(floor..)?.iter().rev().take_while(is_check);
        let lowest = self.stack.len() - checks.count();
        let from = (lowest + 1..self.stack.len())
            .rev()
            .find(|&i| !self.is_part_of(self.stack[i], self.stack[i - 1]))
            .unwrap_or(lowest);
        let asked_by = (from > floor).then(|| self.stack[from - 1]);
        // `getTypeOfAccessors` of a getter of an object literal calls `getReturnTypeFromBody` itself.
        let is_return_type_from_body = match asked_by {
            Some(Query::Return(..) | Query::ReturnAtFirstLook(..)) => true,
            Some(Query::LiteralProp(file, p)) => self.hir(file)[p].kind == PropKind::Getter,
            _ => false,
        };
        // The walk checks a parenthesized `return` expression and an expression body with `checkExpression`, whoever
        // evaluated them first.
        let is_body = |file: FileId, e: ExprId| match self.bound(file).parent_of_expr(e) {
            Parent::Stmt(s) => {
                let hir = self.hir(file);
                matches!(hir[s].kind, StmtKind::Return(_)) && is_parenthesized(hir, e)
            }
            Parent::FnBody(_) => true,
            _ => false,
        };
        let is_checked_again = match (*self.stack.get(from)?, asked_by) {
            (Query::Expr(file, e), _) if is_return_type_from_body || is_body(file, e) => {
                let hir = self.hir(file);
                is_parenthesized(hir, e)
                    || !matches!(self.bound(file).parent_of_expr(e),
                        Parent::Stmt(s) if matches!(hir[s].kind, StmtKind::Return(_)))
            }
            (Query::Expr(file, e), Some(Query::Expr(..) | Query::LiteralProp(..))) => {
                let hir = self.hir(file);
                match self.bound(file).parent_of_expr(e) {
                    Parent::Expr(parent) if parent.is_some() => {
                        matches!(hir[parent].kind, ExprKind::Assign { value, .. } if value == e)
                    }
                    Parent::Stmt(s) => {
                        matches!(hir[s].kind, StmtKind::ForOf { expr, .. } if expr == e)
                    }
                    _ => false,
                }
            }
            (Query::LiteralProp(file, p), _) => self.is_member_checked_again(file, p),
            _ => false,
        };
        is_checked_again.then_some(from)
    }

    /// Whether the check of `whole` checks `part`, through expressions and members of object
    /// literals alone.
    fn is_part_of(&self, part: Query, whole: Query) -> bool {
        use crate::bind::Parent;
        let (file, mut parent) = match part {
            Query::Expr(file, e) => (file, self.bound(file).parent_of_expr(e)),
            Query::LiteralProp(file, p) => {
                (file, Parent::Expr(self.bound(file).prop_owner[p.idx()]))
            }
            _ => return false,
        };
        let bound = self.bound(file);
        loop {
            parent = match parent {
                Parent::Expr(e) if e.is_some() => {
                    if whole == Query::Expr(file, e) {
                        return true;
                    }
                    bound.parent_of_expr(e)
                }
                Parent::Prop(p) => {
                    if whole == Query::LiteralProp(file, p) {
                        return true;
                    }
                    Parent::Expr(bound.prop_owner[p.idx()])
                }
                _ => return false,
            };
        }
    }

    /// Whether `checkSourceFile` checks the member `p` of an object literal again, whatever has
    /// checked the literal: no expression around it has a stored type or a resolved signature.
    fn is_member_checked_again(&self, file: FileId, p: PropId) -> bool {
        use crate::bind::Parent;
        let (hir, bound) = (self.hir(file), self.bound(file));
        let mut e = bound.prop_owner[p.idx()];
        loop {
            // The attributes of a JSX element are checked with its signature.
            if e.is_none() || matches!(hir[e].kind, ExprKind::Jsx(_)) {
                return false;
            }
            e = match bound.parent_of_expr(e) {
                Parent::FnBody(_) => return true,
                Parent::Stmt(s) => {
                    return match hir[s].kind {
                        StmtKind::Return(_) => {
                            is_parenthesized(hir, e) || matches!(hir[e].kind, ExprKind::Await(_))
                        }
                        StmtKind::ExportDefault(_) | StmtKind::ExportAssign(_) => false,
                        _ => true,
                    };
                }
                Parent::Prop(member) => bound.prop_owner[member.idx()],
                Parent::Expr(parent) if parent.is_some() => match hir[parent].kind {
                    ExprKind::Yield { .. } => return true,
                    ExprKind::Call(_) | ExprKind::New(_) | ExprKind::TaggedTemplate(_) => {
                        return false;
                    }
                    _ => parent,
                },
                _ => return false,
            };
        }
    }

    /// `c.addDeferredDiagnostic`. `callback`: see `Reported::deferred`.
    pub(super) fn add_deferred_diagnostic(&mut self, callback: Reported) {
        if self.save_deferred_diagnostics {
            self.reported.push(callback);
        }
    }

    /// The diagnostics reported from index `from` on, for a caller that stores or rewrites them. A
    /// callback of `addDeferredDiagnostic` stays.
    pub(super) fn take_reported_from(&mut self, from: usize) -> Vec<Reported> {
        let taken = self.reported.split_off(from).into_iter();
        let (callbacks, reported): (Vec<_>, Vec<_>) = taken.partition(|d| d.deferred.is_some());
        self.reported.extend(callbacks);
        reported
    }

    /// The diagnostics of `frame`, the frame of `q`, which `leave` has just popped.
    #[cold]
    pub(super) fn settle_reported(&mut self, frame: QueryFrame, q: Query) {
        let from = frame.reported_from as usize;
        if frame.drops_reported {
            self.reported.truncate(from);
        } else if !frame.tainted {
            for diagnostic in self.reported.split_off(from) {
                self.log_diagnostic(Some(q), diagnostic);
            }
        } else {
            return;
        }
        let requests = &self.reported_iteration_requests;
        let since_entered = requests.partition_point(|request| request.0 < frame.serial);
        self.settle_iteration_requests(since_entered, frame.drops_reported);
    }

    /// `settle_reported` for the innermost frame if it stores nothing under its query, before
    /// `leave`: an evaluation that is repeated to report, an uncached check. Every task that gets
    /// there evaluates it, so only `check_file` of the file reports. The diagnostics do not go to
    /// the enclosing frame, which may drop its own.
    pub(super) fn settle_reported_without_entry(&mut self) {
        if let Some(frame) = self.frames.last()
            && !frame.tainted
            && !frame.drops_reported
        {
            for diagnostic in self.reported.split_off(frame.reported_from as usize) {
                if self.task.file == Some(diagnostic.file) {
                    self.log_diagnostic(None, diagnostic);
                }
            }
        }
    }

    /// `add_diagnostic` with an owner other than the innermost frame. The frames in progress do not
    /// drop it.
    /// - `Some(q)`: the result of a resolution cycle, after the `leave` that found it
    ///   (`!popTypeResolution()`) or while `q` is still in progress below. It belongs to the entry
    ///   that `q` stores. tsgo caches that result regardless of the enclosing resolutions.
    /// - `None`: it belongs to the task. A limit, after which no query in progress is cacheable. A
    ///   cycle that has no query.
    pub(super) fn add_diagnostic_of(&mut self, owner: Option<Query>, diagnostic: Reported) {
        // As in `add_diagnostic`. In another file tsgo's result depends on file order, and the
        // entry is stored already: the diagnostic stays with it.
        if self.serialization_level >= MAX_SERIALIZATION_LEVEL
            && self.task.file == Some(diagnostic.file)
        {
            return;
        }
        self.log_diagnostic(owner, diagnostic);
    }

    /// Whether the diagnostic that was logged last belongs to the task and is `Reported::bare(at, code)`.
    /// It is still there, so whatever has reported it was not discarded.
    pub(super) fn is_last_diagnostic_of_task(&self, at: (FileId, u32, u32), code: u32) -> bool {
        (self.task.diagnostics.last()).is_some_and(|(owner, last)| {
            owner.is_none()
                && last.code == code
                && (last.file, last.start, last.end) == at
                && last.by_emit == self.is_emitting
        })
    }

    /// The diagnostics reported from index `from` on belong to the task.
    pub(super) fn log_reported_from(&mut self, from: usize) {
        for diagnostic in self.reported.split_off(from) {
            self.log_diagnostic(None, diagnostic);
        }
    }

    /// The diagnostics reported from index `from` on are kept whatever the frames in progress do with theirs. See
    /// `Query::ExprInFlowLoop`.
    pub(super) fn log_reported_in_flow_loop(&mut self, from: usize, file: FileId, e: ExprId) {
        for diagnostic in self.reported.split_off(from) {
            self.log_diagnostic(Some(Query::ExprInFlowLoop(file, e)), diagnostic);
        }
    }

    /// `owner`: the query whose entry the diagnostic belongs to. `None`: it belongs to the task.
    fn log_diagnostic(&mut self, owner: Option<Query>, mut diagnostic: Reported) {
        // A query about a file after its `checkSourceFile` reports nothing there: its diagnostics have been collected. A baseline
        // writer can still be the first to evaluate an entry of another file, and then this task owns what that reports.
        if self.is_type_checked && self.task.file == Some(diagnostic.file) {
            return;
        }
        // `GetGlobalDiagnostics` comes after the last `checkSourceFile` and before `Emit` or a baseline writer. What those are
        // the first to evaluate is not stored then, so the check of a later file that asks for it reports.
        if self.is_type_checked && diagnostic.file == NOWHERE.0
            || self.is_reported_too_late(owner, diagnostic.file)
        {
            return self.mark_tainted_from(0);
        }
        diagnostic.by_emit |= self.is_emitting;
        if diagnostic.file != NOWHERE.0
            && !diagnostic.by_emit
            && self.is_left_to_an_earlier_file(owner, diagnostic.file)
        {
            // Not every error comes through `add_diagnostic`.
            return self.note_error_in(diagnostic.file);
        }
        if self.task.is_planned() {
            self.task.diagnostics.push((owner, diagnostic));
        } else if let Some(diagnostic) = self.settled(diagnostic, &mut Default::default()) {
            // A checker without a task shares no entries, so no other task reports under its queries.
            self.p.push_diagnostic(diagnostic);
        }
    }

    /// `getBindAndCheckDiagnosticsWithChecker`: a file's diagnostics are those that the checker has for it right after
    /// `checkSourceFile`. True if what is reported now for `file` is reported by then. Other tasks run before this one in
    /// no particular order.
    /// The check of a file asks for the queries about its own syntax. So what is reported now is
    /// reported no later than the first of these files is checked: that of the task, and those
    /// whose syntax `owner` and the queries in progress are about. Any file can be the first to ask
    /// for a query about a type. No check asks for the type of a symbol that
    /// `is_resolved_on_request`, nor for what its pattern implies but for a name in it, and the
    /// check of a declaration asks for its inferred return type only if
    /// `is_inferred_return_type_requested`.
    pub(super) fn is_reported_in_time(&self, owner: Option<Query>, file: FileId) -> bool {
        self.is_reported_in_time_under(owner, &self.stack, file)
    }

    /// `is_reported_in_time` for what the innermost query reports, if no check asks for that query.
    pub(super) fn is_reported_in_time_on_request(&self, file: FileId) -> bool {
        let below = self.stack.len().saturating_sub(1);
        self.is_reported_in_time_under(None, &self.stack[..below], file)
    }

    /// `is_reported_in_time` for what follows from the state of `stack[height]`, a resolution in
    /// progress: a check that begins at a query above it does not find that state.
    pub(super) fn is_reported_in_time_under_resolution(&self, height: usize, file: FileId) -> bool {
        self.is_reported_in_time_under(None, &self.stack[..height], file)
    }

    /// `in_progress`: the queries in progress that count.
    fn is_reported_in_time_under(
        &self,
        owner: Option<Query>,
        in_progress: &[Query],
        file: FileId,
    ) -> bool {
        (self.task.file).is_none_or(|current| self.is_checked_no_later_than(current, file))
            || self.is_asked_by_check_in_time(owner, in_progress, file)
    }

    /// `is_reported_in_time_under` without the file of the task.
    fn is_asked_by_check_in_time(
        &self,
        owner: Option<Query>,
        in_progress: &[Query],
        file: FileId,
    ) -> bool {
        let is_in_time = |visited: FileId| self.is_checked_no_later_than(visited, file);
        let is_asked_by_check = |q: Query| match q {
            Query::ParameterSymbol(of, name) => !matches!(
                self.bound(of).pat_parent[name.idx()],
                crate::bind::PatParent::Param(p) if self.is_resolved_on_request(of, p)
            ),
            // `getTypeForBindingElementParent`, for an element of the pattern.
            Query::Pat(of, pattern) => !matches!(
                self.bound(of).pat_parent[pattern.idx()],
                crate::bind::PatParent::Param(p) if self.is_resolved_on_request(of, p)
                    && self.returns_before_type_of_every_name(of, pattern)
            ),
            Query::Return(of, func) => {
                self.hir(of)[func].ret.is_some() || self.is_inferred_return_type_requested(of, func)
            }
            _ => true,
        };
        (owner.iter().chain(in_progress))
            .any(|&q| is_asked_by_check(q) && q.syntax().is_none_or(is_in_time))
    }

    /// Whether `checkVariableLikeDeclaration` `returns_before_type_of_symbol` for every name that
    /// `pattern` binds, so that it never asks for the type that `pattern` takes apart.
    fn returns_before_type_of_every_name(&self, file: FileId, pattern: PatId) -> bool {
        let mut names = Vec::new();
        names_bound_by(self.hir(file), pattern, &mut names);
        (names.iter()).all(|&(_, name)| self.returns_before_type_of_symbol(file, name))
    }

    /// `GetDiagnosticsOfAnyProgram`: `Emit`, like a baseline writer, comes after the diagnostics of
    /// every file are collected, here after those of the task's file. Whether a diagnostic in
    /// `file`, another file that is checked, is one that only they cause: no check asks in time for
    /// `owner` or a query in progress. The caller stores no result, so the check of a later file
    /// that does ask evaluates it, and reports.
    fn is_reported_too_late(&self, owner: Option<Query>, file: FileId) -> bool {
        self.is_type_checked
            && file != NOWHERE.0
            && self.task.file != Some(file)
            && self.reports_semantic_errors(file)
            && !self.is_asked_by_check_in_time(owner, &self.stack, file)
    }

    /// Takes the diagnostics that a commit publishes. What belongs to a query goes with the entry of the query, which the commit stores.
    /// What belongs to the task goes when the file is checked to the end (`is_between_files`): if the task is lost before,
    /// whoever checks the file again reports it.
    /// `None`: not now. A callback among them has not been called, which `check_file` does at the end of the file.
    ///
    /// The first list: what belongs to a query about a shared record and was logged while the task wrote at once. The entry
    /// of such a query is there for all already, so this is reported also if the commit fails or the task is lost:
    /// whoever checks the file again finds the entry and does not report.
    pub(super) fn take_diagnostics_for_commit(
        &mut self,
        is_between_files: bool,
    ) -> Option<[Logged; 2]> {
        let while_writing_at_once = self.task.logged_while_writing_at_once();
        let logged = &mut self.task.diagnostics;
        if !is_between_files && logged.iter().any(|it| it.1.deferred.is_some()) {
            return None;
        }
        let mut taken: Vec<(usize, (Option<Query>, Reported))> = Vec::new();
        // See `withhold_until_the_file_ends`.
        let in_doubt = &self.task.files_in_doubt;
        let is_withheld = |q: Query| {
            !matches!(q, Query::Cond(..)) && q.syntax().is_some_and(|file| in_doubt.contains(&file))
        };
        for (at, it) in logged.iter_mut().enumerate() {
            if is_between_files
                || it
                    .0
                    .is_some_and(|q| is_same_in_every_task(q) && !is_withheld(q))
            {
                taken.push((at, std::mem::replace(it, (None, Reported::taken()))));
            }
        }
        if is_between_files {
            logged.clear();
        }
        let mut directives = Default::default();
        let [mut of_entries_written_at_once, mut others] = [Vec::new(), Vec::new()];
        for (at, (owner, diagnostic)) in taken {
            if diagnostic.is_taken() {
                continue;
            }
            let Some(diagnostic) = self.settled(diagnostic, &mut directives) else {
                continue;
            };
            let owner = owner.filter(|&q| is_same_in_every_task(q));
            match at < while_writing_at_once && owner.is_some_and(|q| !is_task_independent(q)) {
                true => of_entries_written_at_once.push((owner, diagnostic)),
                false => others.push((owner, diagnostic)),
            }
        }
        Some([of_entries_written_at_once, others])
    }
}
