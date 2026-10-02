//! `ast.Diagnostic`, and `DiagnosticsCollection` for all the checkers of a program.
//!
//! A diagnostic is reported where the answer it goes with is worked out, by whichever checker gets there first, and goes to the sink of
//! the file it is in. Whoever finds the answer kept has nothing to report. `finish_file` reads the sink of a file once every file has
//! been checked.
//!
//! `error` puts it in `Checker::reported`. `Checker::leave` settles what the question that is left has put there:
//! - the answer holds: to the sink, before the answer is kept;
//! - the answer rests on a circle, a trial or a guess (`drops_reported`): dropped, and reported when it is worked out again;
//! - the answer is not kept only because a loop is under way (`taint_from`): it stays, and is settled with the question around.
//!
//! What is reported with no question under way stays there until `check_file` ends, and is handed to `finish_file`.

use super::*;
use std::sync::Mutex;

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
}

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
        }
    }

    /// Nothing but the place and the code has been said of it.
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

/// For each file what has been reported in it.
pub(super) struct Sink(Box<[Mutex<Vec<Reported>>]>);

impl Sink {
    pub(super) fn new(files: usize) -> Sink {
        Sink((0..files).map(|_| Mutex::default()).collect())
    }
}

impl super::Program {
    /// Whether `finish_file` would come back with nothing. Most files are like that, and no checker is made to hear it.
    pub fn has_nothing_to_finish(&self, file: FileId, checked: &super::errors::Checked) -> bool {
        let (hir, files) = (self.files.hir(file), &self.files);
        checked.is_empty()
            && hir.comment_directives.is_empty()
            && hir.jsdoc_errors.is_empty()
            && files.module(file).missing_references.is_empty()
            && files.include_problems_in(file).next().is_none()
            && self.sink.0[file.idx()].lock().unwrap().is_empty()
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
                    Arg::Atom(name) => out.extend_from_slice(self.files().atoms.bytes(name)),
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
        self.reported.push(diagnostic);
        self.reported.last_mut().unwrap()
    }

    /// Of the question `frame`, which has just been left.
    #[cold]
    pub(super) fn settle_reported(&mut self, frame: QueryFrame) {
        let from = frame.reported_from as usize;
        if frame.drops_reported {
            self.reported.truncate(from);
        } else if !frame.tainted {
            self.commit_reported_from(from);
        }
    }

    pub(super) fn commit_reported_from(&mut self, from: usize) {
        for diagnostic in self.reported.split_off(from) {
            self.commit(diagnostic);
        }
    }

    /// `c.diagnostics.Add`, of what goes with an answer that is kept whatever becomes of the questions under way. What is asked about
    /// a file after `checkSourceFile` reports nothing there: nobody collects it.
    pub(super) fn commit(&self, diagnostic: Reported) {
        if self.is_type_checked && self.checking == Some(diagnostic.file) {
            return;
        }
        self.p.sink.0[diagnostic.file.idx()]
            .lock()
            .unwrap()
            .push(diagnostic);
    }

    /// `CompareDiagnostics`
    pub(super) fn compare_diagnostics(&self, a: &Reported, b: &Reported) -> std::cmp::Ordering {
        let path = |file: FileId| self.files().modules.get(file.idx()).map(|m| &m.path[..]);
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

    /// What all the checkers have reported in `file`, but for where `checkSourceFile` never comes.
    pub(super) fn drain_sink(&self, file: FileId, never_checked: &[(u32, u32)]) -> Vec<Reported> {
        let mut reported = std::mem::take(&mut *self.p.sink.0[file.idx()].lock().unwrap());
        reported.retain(|d| {
            !never_checked
                .iter()
                .any(|&(from, to)| (from..to).contains(&d.start))
        });
        reported
    }

    /// `SortAndDeduplicateDiagnostics`: in what order the checkers got there does not show.
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
