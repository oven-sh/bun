//! `ast.Diagnostic`, and `DiagnosticsCollection` for all the tasks of a program.
//!
//! EVERY DIAGNOSTIC BELONGS TO THE TASK OR TO A QUERY.
//! - Reported with no query in flight, by a pass of `check_file`: it belongs to the task, and is reported.
//! - Reported inside a query: it belongs to the query. A hit on its entry reports nothing, but several tasks of one step can each have
//!   evaluated it. AT THE BARRIER, TASKS IN PLAN ORDER, IT IS REPORTED IFF NO EARLIER TASK HAS REPORTED UNDER THAT QUERY. No entry
//!   is needed for that: a step whose entries no later step reads sends only its diagnostics to the barrier.
//! - The texts of two tasks for one error can differ: union members are ordered by id, and the ids of a task's own types are in the order
//!   in which that task created them (`'A | B'`, `'B | A'`). The first task's text is reported. tsc's can be the other one.
//!
//! `add_diagnostic` pushes onto `Checker::reported`. The diagnostics of a frame are the suffix from `QueryFrame::reported_from`.
//! `Checker::leave` calls `settle_reported` for them:
//! - the result is finished: they move to `Task::diagnostics`, tagged with the query;
//! - the result depends on a cycle, a trial or a refused query (`drops_reported`): dropped. The next evaluation reports again;
//! - the result depends on an incomplete flow-loop type (`taint_from`): they stay, and belong to the frame around it.
//!
//! `Program::publish_diagnostics` moves the diagnostics of a task to the buffers of their files (`Sink`). `Program::finish_file` reads
//! the buffer of a file after the last barrier.
//!
//! What belongs to the task and is located in the file of its `check_file` stays in `reported` until that ends, and goes to `finish_file`.
//!
//! A DIAGNOSTIC THAT LEAVES ITS TASK IS SETTLED (`Checker::settle`): whatever only the tree of its file can tell has been filled in. The
//! tree of a file that nothing imports is freed at the end of its task, and `finish_file` reads no tree.

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
    /// `symbolToString`, of a property.
    Prop(&'a Prop),
    /// `signatureToString`
    Sig(SigId),
    Atom(Atom),
    Number(usize),
    Bytes(&'a [u8]),
    Text(&'a str),
}

/// The arguments of a message, printed.
pub(super) type Args = Box<[Box<[u8]>]>;

/// For who still prints the arguments by itself. It goes with its last caller: a diagnostic takes `&[Arg]`.
pub(super) fn held(args: Vec<impl Into<Vec<u8>>>) -> Args {
    (args.into_iter().map(|arg| arg.into().into())).collect()
}

/// A number as it is written in a message.
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
    /// Until `finish_file`, 0: where the token at `start` ends. `NO_LENGTH`: at `start`.
    pub(super) end: u32,
    pub(super) code: u32,
    pub(super) args: Args,
    pub(super) message_chain: Vec<Reported>,
    pub(super) related_information: Vec<Reported>,
    /// `CategorySuggestion`
    pub(super) is_suggestion: bool,
    /// Once settled: where the `@ts-ignore` or `@ts-expect-error` directive starts that suppresses it. `NO_DIRECTIVE`: none does.
    pub(super) directive: u32,
    /// Once settled: `is_bare` before `end` was filled in.
    pub(super) was_bare: bool,
}

pub(super) const NO_DIRECTIVE: u32 = u32::MAX;

impl Reported {
    /// `NewDiagnostic`, of arguments that are printed.
    /// Of a message that takes no arguments.
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
            directive: NO_DIRECTIVE,
            was_bare: false,
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

/// `compareMessageChainContent`, of two of one size.
fn compare_message_chain_content(a: &[Reported], b: &[Reported]) -> std::cmp::Ordering {
    a.iter()
        .zip(b)
        .fold(std::cmp::Ordering::Equal, |order, (a, b)| {
            order
                .then_with(|| a.args.cmp(&b.args))
                .then_with(|| compare_message_chain_content(&a.message_chain, &b.message_chain))
        })
}

pub(super) struct Sink {
    /// For each file what has been reported in it.
    by_file: Box<[Guarded<Vec<Reported>>]>,
    /// The queries under which a task has reported. Touched only at barriers.
    owners: Guarded<crate::util::FxHashSet<Query>>,
}

impl Sink {
    pub(super) fn new(files: usize) -> Sink {
        Sink {
            by_file: (0..files).map(|_| Guarded::default()).collect(),
            owners: Guarded::default(),
        }
    }
}

/// Whether every task names `q` alike: it holds a file and a node, or a symbol. A type, signature or mapper id can be one of the
/// task's own.
fn is_task_independent(q: Query) -> bool {
    match q {
        Query::Symbol(_)
        | Query::Declared(_)
        | Query::Bases(_)
        | Query::BaseConstructor(_)
        | Query::Return(..)
        | Query::ReturnAtFirstLook(..)
        | Query::Pat(..)
        | Query::LiteralProp(..)
        | Query::TypeNode(..)
        | Query::Enum(..)
        | Query::Expr(..)
        | Query::Call(..)
        | Query::InitializerIsUndefined(..)
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

impl super::Program {
    /// At the barrier, tasks in plan order. What belongs to a query is reported iff no earlier task has reported under that query.
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

    /// What the tasks have reported in `file`.
    pub(super) fn take_buffer(&self, file: FileId) -> Vec<Reported> {
        std::mem::take(&mut *self.sink.by_file[file.idx()].lock())
    }

    /// `CompareDiagnostics`
    pub(super) fn compare_diagnostics(&self, a: &Reported, b: &Reported) -> std::cmp::Ordering {
        let path = |file: FileId| self.files.modules.get(file.idx()).map(|m| &m.path[..]);
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
        // `compactAndMergeRelatedInfos`: those that differ in nothing but what they are related to are one, related to all of it.
        reported.dedup_by(|next, first| {
            let is_same = (next.file, next.start, next.end, next.code)
                == (first.file, first.start, first.end, first.code)
                && next.args == first.args
                && next.message_chain == first.message_chain;
            if is_same && !next.related_information.is_empty() {
                let related = &mut first.related_information;
                related.append(&mut next.related_information);
                related.sort_by(|a, b| self.compare_diagnostics(a, b));
                related.dedup();
            }
            is_same
        });
    }
}

impl Checker<'_> {
    /// `StringifyArgs`. They are printed at once, as they are there: printing asks questions.
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

    /// `c.error`, for who has no node to report it on.
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

    /// `grammarErrorAtPos`: whether it reported, which it does not in a file that does not parse.
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
            }
            return self.discarded.insert(diagnostic);
        }
        self.reported.push(diagnostic);
        self.reported.last_mut().unwrap()
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
        }
    }

    /// `settle_reported` for the innermost frame if it stores nothing under its query, before `leave`: an evaluation that is repeated
    /// in order to report, a check by value. Every task that gets there evaluates it, so only `check_file` of the file reports. The diagnostics do not go to the frame around it, which may drop its own.
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

    /// `add_diagnostic` with an owner other than the innermost frame. The frames in flight do not drop it.
    /// - `Some(q)`: the result of a resolution cycle, after the `leave` that found it (`!popTypeResolution()`) or while `q` is still in
    ///   flight below. It belongs to the entry that `q` stores. tsgo caches that result whatever becomes of the resolutions around it.
    /// - `None`: it belongs to the task. A limit, after which no query in flight is cacheable. A cycle that has no query.
    pub(super) fn add_diagnostic_of(&mut self, owner: Option<Query>, diagnostic: Reported) {
        self.log_diagnostic(owner, diagnostic);
    }

    /// What has been reported from `from` on belongs to the task.
    pub(super) fn log_reported_from(&mut self, from: usize) {
        for diagnostic in self.reported.split_off(from) {
            self.log_diagnostic(None, diagnostic);
        }
    }

    /// `owner`: the query whose entry the diagnostic belongs to. `None`: it belongs to the task.
    fn log_diagnostic(&mut self, owner: Option<Query>, diagnostic: Reported) {
        // A query about a file after its `checkSourceFile` reports nothing there: its diagnostics have been collected. A baseline
        // writer can still be the first to evaluate an entry of another file, and then this task owns what that reports.
        if self.is_type_checked && self.task.file == Some(diagnostic.file) {
            return;
        }
        let mut owner = owner;
        if self.task.checker_count != 0 {
            if diagnostic.file != NOWHERE.0 && !self.collects_later(diagnostic.file) {
                return;
            }
            // No other checker reports in the file.
            owner = None;
        }
        if self.task.is_planned() {
            self.task.diagnostics.push((owner, diagnostic));
        } else if let Some(diagnostic) = self.settled(diagnostic, &mut Default::default()) {
            // What a task outside the plan buffers is dropped with it, so nothing competes for its entries.
            self.p.push_diagnostic(diagnostic);
        }
    }

    /// After `begin_task`. The task is one of `count` checkers of `checkerPool`.
    pub fn set_checker_count(&mut self, count: u32) {
        self.task.checker_count = count;
    }

    /// `getBindAndCheckDiagnosticsWithChecker`: the diagnostics of a file are those that its own checker has for it right after
    /// `checkSourceFile`. Whether that is still to come for `file`.
    fn collects_later(&self, file: FileId) -> bool {
        let rank = self.files().rank_of_file(file);
        let is_own = Some(rank % self.task.checker_count) == self.task.index();
        let current = self
            .task
            .file
            .map(|current| self.files().rank_of_file(current));
        is_own && current.is_none_or(|current| rank >= current)
    }

    /// At the end of the task, on its own thread, for `Task::finish`. A query that only this task can name does not go to the barrier:
    /// what was reported under it belongs to the task.
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
