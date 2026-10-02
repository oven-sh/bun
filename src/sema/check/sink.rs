//! `ast.Diagnostic`, and `DiagnosticsCollection` for all the checkers of a program.
//!
//! A diagnostic is reported where the answer it goes with is worked out, by whichever checker gets there first, and goes to the sink of
//! the file it is in. Whoever finds the answer kept has nothing to report. `finish_file` reads the sink of a file once every file has
//! been checked.

use super::errors::Diagnostic;
use super::*;
use std::sync::Mutex;

/// What goes into a message.
#[derive(Copy, Clone)]
pub(super) enum Arg {
    /// `TypeToString`
    Type(TypeId),
    /// `symbolToString`
    Sym(Sym),
    Atom(Atom),
}

/// `ast.Diagnostic`
#[derive(Clone, PartialEq, Eq, Debug)]
pub(super) struct Reported {
    pub(super) file: FileId,
    pub(super) start: u32,
    pub(super) end: u32,
    pub(super) code: u32,
    pub(super) args: Vec<String>,
    pub(super) related_information: Vec<Reported>,
}

impl Reported {
    /// `AddRelatedInfo`
    pub(super) fn add_related_info(&mut self, related: Reported) -> &mut Self {
        self.related_information.push(related);
        self
    }
}

/// For each file what has been reported in it, and the file that the checker that reported it was checking.
pub(super) struct Sink(Box<[Mutex<Vec<(Reported, Option<FileId>)>>]>);

impl Sink {
    pub(super) fn new(files: usize) -> Sink {
        Sink((0..files).map(|_| Mutex::default()).collect())
    }
}

impl Checker<'_> {
    /// `NewDiagnosticForNode`. The arguments are printed at once, as they are there: printing asks questions.
    pub(super) fn new_diagnostic(
        &mut self,
        at: (FileId, u32, u32),
        code: u32,
        args: &[Arg],
    ) -> Reported {
        let args = args
            .iter()
            .map(|arg| match *arg {
                Arg::Type(ty) => self.type_to_string(ty),
                Arg::Sym(symbol) => self.symbol_to_string(symbol),
                Arg::Atom(name) => self.atom_text(name),
            })
            .collect();
        Reported {
            file: at.0,
            start: at.1,
            end: at.2,
            code,
            args,
            related_information: Vec::new(),
        }
    }

    /// `c.diagnostics.Add`, of what goes with an answer that is kept whatever becomes of the questions under way. Call it before the
    /// answer is kept. What is asked about a file after `checkSourceFile` reports nothing there: nobody collects it.
    pub(super) fn commit(&self, diagnostic: Reported) {
        if self.is_type_checked && self.checking == Some(diagnostic.file) {
            return;
        }
        self.p.sink.0[diagnostic.file.idx()]
            .lock()
            .unwrap()
            .push((diagnostic, self.checking));
    }

    /// Adds what all the checkers have reported in `file`, but for where `checkSourceFile` never comes. Equal ones are one
    /// (`DiagnosticsCollection.Add`): `explain_errors` sees to that. `BUN_SEMA_TRACE_SINK=1`: what only the checker of another file
    /// has reported.
    pub(super) fn drain_sink(
        &self,
        file: FileId,
        never_checked: &[(u32, u32)],
        out: &mut Vec<Diagnostic>,
    ) {
        let reported = std::mem::take(&mut *self.p.sink.0[file.idx()].lock().unwrap());
        static TRACE: std::sync::OnceLock<bool> = std::sync::OnceLock::new();
        if *TRACE.get_or_init(|| std::env::var_os("BUN_SEMA_TRACE_SINK").is_some()) {
            let path = |file: FileId| &self.files().modules[file.idx()].path[..];
            for (diagnostic, by) in reported.iter().filter(|one| one.1 != Some(file)) {
                if !reported.contains(&(diagnostic.clone(), Some(file))) {
                    eprintln!(
                        "SINK\t{}\t{}\t{}\tonly by the checker of\t{}",
                        path(file),
                        diagnostic.start,
                        diagnostic.code,
                        by.map_or("no file", path),
                    );
                }
            }
        }
        let mut notes = self.notes.borrow_mut();
        for (diagnostic, _) in reported {
            if never_checked
                .iter()
                .any(|&(from, to)| (from..to).contains(&diagnostic.start))
            {
                continue;
            }
            out.push(Diagnostic {
                start: diagnostic.start,
                code: diagnostic.code,
            });
            notes.push(diagnostic.into());
        }
    }
}
