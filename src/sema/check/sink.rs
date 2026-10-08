//! `ast.Diagnostic`, and `DiagnosticsCollection` for all the tasks of a program.
//!
//! Every diagnostic belongs to the task or to a query.
//! - Reported with no query in progress, by a pass of `check_file`: it belongs to the task, and is
//!   reported.
//! - Reported inside a query: it belongs to the query. A hit on its entry reports nothing, but
//!   several tasks of one step can each have evaluated it. At the barrier, with tasks in plan
//!   order, it is reported iff no earlier task has reported under that query. No entry is needed
//!   for that: a step whose entries no later step reads sends only its diagnostics to the barrier.
//! - The texts of two tasks for one error can differ: union members are ordered by id, and the ids
//!   of task-local types are in the order in which that task created them (`'A | B'`, `'B | A'`).
//!   The first task's text is reported. tsc's can be the other one.
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
//! `Program::publish_diagnostics` moves the diagnostics of a task to the buffers of their files
//! (`Sink`). `Program::finish_file` reads the buffer of a file after the last barrier.
//!
//! Diagnostics that belong to the task and are located in the file of its `check_file` stay in
//! `reported` until that ends, and go to `finish_file`.
//!
//! A callback of `addDeferredDiagnostic` whose message prints a type is a `Reported` too, with
//! `Reported::deferred` in place of the arguments. So it belongs to the task or to a query, and is
//! dropped with a frame, like a diagnostic. `produce_type_not_iterable_errors` creates the message.
//!
//! A diagnostic that leaves its task is settled (`Checker::settle`): every field that only the HIR
//! of its file can provide has been filled in. The HIR of a file that nothing imports is freed at
//! the end of its task, and `finish_file` reads no HIR.

use super::explain::NOWHERE;
use super::task::Finished;
use super::*;
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

pub(super) struct Sink<'s> {
    /// The diagnostics reported in each file. A `Reported` owns memory of the regular heap:
    /// `release`.
    by_file: ArenaVec<'s, Guarded<Vec<Reported>>>,
    /// The queries under which a task has reported. Accessed only at barriers.
    owners: Guarded<ArenaHashSet<'s, Query>>,
}

impl<'s> Sink<'s> {
    /// `arena`: that of the thread that runs the barriers, where `owners` grows.
    pub(super) fn new_in(files: usize, arena: &'s Arena) -> Sink<'s> {
        Sink {
            by_file: vec_from_iter_in((0..files).map(|_| Guarded::default()), arena),
            owners: Guarded::new(set_in(arena)),
        }
    }

    /// See `Program::release`.
    pub(super) fn release(&mut self) {
        for reported in &mut self.by_file {
            *reported.get_mut() = Vec::new();
        }
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
        | Query::Call(..)
        | Query::InitializerIsUndefined(..)
        | Query::AliasTarget(_)
        | Query::WriteType(..)
        | Query::Comparison(_) => true,
        Query::ReturnOfSignature(_)
        | Query::Shape(_)
        | Query::Constraint(_)
        | Query::InferredConstraint(_)
        | Query::MappedProp(..)
        | Query::Cond(..)
        | Query::TypeArguments(_) => false,
    }
}

impl super::Program<'_> {
    /// At the barrier, tasks in plan order. A diagnostic that belongs to a query is reported iff no
    /// earlier task has reported under that query.
    pub(super) fn publish_diagnostics(&self, finished: &mut Finished) {
        let mut owners = self.sink.owners.lock();
        let mut own = Vec::new();
        for (owner, diagnostic) in std::mem::take(&mut finished.diagnostics) {
            if let Some(q) = owner {
                if owners.contains(&q) {
                    continue;
                }
                own.push(q);
            }
            self.push_diagnostic(diagnostic);
        }
        owners.extend(own);
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
        (path(a.file), a.start, a.end, a.code, &a.args)
            .cmp(&(path(b.file), b.start, b.end, b.code, &b.args))
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
        reported.sort_by(|a, b| self.compare_diagnostics(a, b));
        // `compactAndMergeRelatedInfos`: diagnostics that differ only in their related information
        // are merged into one that has all of it, sorted.
        reported.dedup_by(|next, first| {
            let is_same = equal_diagnostics_no_related_info(next, first);
            if is_same {
                let related = &mut first.related_information;
                related.append(&mut next.related_information);
                related.sort_by(|a, b| self.compare_diagnostics(a, b));
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
                    Arg::Atom(name) => out.extend_from_slice(&self.symbol_name_with_id(name)),
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

    /// `c.addDiagnostic`
    pub(super) fn add_diagnostic(&mut self, diagnostic: Reported) -> &mut Reported {
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
        let is_checked_again = match (*self.stack.get(from)?, asked_by) {
            (Query::Expr(file, e), Some(Query::Return(..) | Query::ReturnAtFirstLook(..))) => {
                let hir = self.hir(file);
                is_parenthesized(hir, e)
                    || !matches!(self.bound(file).expr_parent[e.idx()],
                        Parent::Stmt(s) if matches!(hir[s].kind, StmtKind::Return(_)))
            }
            (Query::Expr(file, e), Some(Query::Expr(..) | Query::LiteralProp(..))) => {
                let hir = self.hir(file);
                match self.bound(file).expr_parent[e.idx()] {
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
            Query::Expr(file, e) => (file, self.bound(file).expr_parent[e.idx()]),
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
                    bound.expr_parent[e.idx()]
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
            e = match bound.expr_parent[e.idx()] {
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
        let mut owner = owner;
        if self.task.checker_count != 0 {
            if diagnostic.file != NOWHERE.0 && !self.collects_later(diagnostic.file) {
                return;
            }
            // No other checker reports in the file.
            owner = None;
        } else if diagnostic.file != NOWHERE.0
            && !diagnostic.by_emit
            && !self.is_reported_in_time(owner, diagnostic.file)
        {
            return;
        }
        if self.task.is_planned() {
            self.task.diagnostics.push((owner, diagnostic));
        } else if let Some(diagnostic) = self.settled(diagnostic, &mut Default::default()) {
            // The diagnostics buffered by a task outside the plan are dropped with it, so nothing
            // competes for its entries.
            self.p.push_diagnostic(diagnostic);
        }
    }

    /// After `begin_task`. The task is one of `count` checkers of `checkerPool`.
    pub fn set_checker_count(&mut self, count: u32) {
        self.task.checker_count = count;
    }

    /// `getBindAndCheckDiagnosticsWithChecker`: the diagnostics of a file are those that its own
    /// checker has for it right after `checkSourceFile`. Returns whether that has not happened yet
    /// for `file`.
    fn collects_later(&self, file: FileId) -> bool {
        let rank = self.files().rank_of_file(file);
        let is_own = Some(rank % self.task.checker_count) == self.task.index();
        let current = self
            .task
            .file
            .map(|current| self.files().rank_of_file(current));
        is_own && current.is_none_or(|current| rank >= current)
    }

    /// `collects_later` for a task of the plan, which other tasks precede in no particular order.
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
        (owner.iter().chain(in_progress)).any(|&q| {
            is_asked_by_check(q) && q.syntax().is_none_or(|(visited, _)| is_in_time(visited))
        })
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

    /// At the end of the task, on its own thread, for `Task::finish`. A query with a task-local key
    /// does not go to the barrier: the diagnostics reported under it belong to the task.
    pub(super) fn take_diagnostics(&mut self) -> Vec<(Option<Query>, Reported)> {
        let diagnostics = std::mem::take(&mut self.task.diagnostics);
        let mut directives = Default::default();
        (diagnostics.into_iter())
            .filter_map(|(owner, diagnostic)| {
                let diagnostic = self.settled(diagnostic, &mut directives)?;
                Some((owner.filter(|&q| is_task_independent(q)), diagnostic))
            })
            .collect()
    }
}
