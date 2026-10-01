//! What goes into the messages of errors, and where errors end.
//!
//! A [`Diagnostic`] is a place and a code, which is all that deciding whether there is an error takes. What a person reads besides is
//! noted on the side, where the error is reported, and only if somebody is going to read it.

use super::Checker;
use super::errors::Diagnostic;
use crate::messages::{self, Category};
use crate::program::FileId;

/// One line of a message: `DiagnosticMessageChain`.
#[derive(Clone, PartialEq, Eq, Debug)]
pub struct Line {
    pub code: u32,
    pub args: Vec<String>,
    /// How far it is indented under the first line, which is at 0.
    pub level: u32,
}

/// `DiagnosticRelatedInformation`: something, mostly elsewhere, that has to do with an error. `'x' is declared here.`
#[derive(Clone, PartialEq, Eq, Debug)]
pub struct Related {
    /// The file, and from where to where in it. `None`: it is nowhere.
    pub at: Option<(FileId, u32, u32)>,
    pub code: u32,
    pub args: Vec<String>,
}

/// Given as the end of an error: it ends where it starts. TypeScript reports such errors on nodes that are missing and at bare positions.
pub(super) const NO_LENGTH: u32 = u32::MAX;

/// What is noted of the error `code` at `start`.
#[derive(Clone, Debug)]
pub(super) struct Note {
    start: u32,
    code: u32,
    /// `0`: not said.
    end: u32,
    args: Vec<String>,
    chain: Vec<Line>,
    related: Vec<Related>,
    /// It is an error of its own, though another with the same code is at the same place.
    is_another: bool,
}

/// [`Related`] as it is shown.
#[derive(Clone, PartialEq, Eq, Debug)]
pub struct RelatedExplained {
    pub at: Option<(FileId, u32, u32)>,
    pub code: u32,
    pub category: Category,
    pub text: String,
}

/// An error as it is shown.
#[derive(Clone, PartialEq, Eq, Debug)]
pub struct Explained {
    pub start: u32,
    pub end: u32,
    pub code: u32,
    pub category: Category,
    /// The lines of the message. Those after the first are indented by two spaces for each level.
    pub text: String,
    pub related: Vec<RelatedExplained>,
}

impl Checker<'_> {
    /// From now on what is noted of errors is kept.
    pub fn set_explains(&mut self, explains: bool) {
        self.explains = explains;
    }

    /// Notes the arguments of the message of the error `code` reported at `start`. `args` is only called if they will be read.
    pub(super) fn explain(
        &mut self,
        start: u32,
        code: u32,
        args: impl FnOnce(&mut Self) -> Vec<String>,
    ) {
        self.explain_to(start, 0, code, args);
    }

    /// The same, and that the error ends at `end`: the end of the node TypeScript reports it on.
    pub(super) fn explain_to(
        &mut self,
        start: u32,
        end: u32,
        code: u32,
        args: impl FnOnce(&mut Self) -> Vec<String>,
    ) {
        if !self.explains {
            return;
        }
        let args = args(self);
        self.note(start, end, code, args);
    }

    /// The same for a place that only has `&self`: the arguments are at hand, and no type has to be printed for them.
    pub(super) fn note(&self, start: u32, end: u32, code: u32, args: Vec<String>) {
        if !self.explains {
            return;
        }
        self.notes.borrow_mut().push(Note {
            start,
            code,
            end,
            args,
            chain: Vec::new(),
            related: Vec::new(),
            is_another: false,
        });
    }

    /// Notes an error that is reported besides another with the same code, from the same place to the same place, and says something else.
    /// TypeScript keeps both. Without this the first one noted is the one.
    pub(super) fn explain_another(
        &mut self,
        start: u32,
        end: u32,
        code: u32,
        args: impl FnOnce(&mut Self) -> Vec<String>,
    ) {
        if !self.explains {
            return;
        }
        let args = args(self);
        self.note(start, end, code, args);
        if let Some(note) = self.notes.borrow_mut().last_mut() {
            note.is_another = true;
        }
    }

    /// `AddRelatedInfo`: adds to what was last noted of the error `code` at `start`. `related` is only called if it will be read.
    pub(super) fn relate(
        &mut self,
        start: u32,
        code: u32,
        related: impl FnOnce(&mut Self) -> Vec<Related>,
    ) {
        if !self.explains {
            return;
        }
        let related = related(self);
        let mut notes = self.notes.borrow_mut();
        match notes
            .iter_mut()
            .rev()
            .find(|n| n.start == start && n.code == code)
        {
            Some(note) => note.related.extend(related),
            // Nothing was noted of a message whose arguments are read off the source.
            None => notes.push(Note {
                start,
                code,
                end: 0,
                args: Vec::new(),
                chain: Vec::new(),
                related,
                is_another: false,
            }),
        }
    }

    /// `relate` for a place that only has `&self`.
    pub(super) fn relate_by_ref(
        &self,
        start: u32,
        code: u32,
        related: impl FnOnce(&Self) -> Vec<Related>,
    ) {
        if !self.explains {
            return;
        }
        let related = related(self);
        let mut notes = self.notes.borrow_mut();
        match notes
            .iter_mut()
            .rev()
            .find(|n| n.start == start && n.code == code)
        {
            Some(note) => note.related.extend(related),
            None => notes.push(Note {
                start,
                code,
                end: 0,
                args: Vec::new(),
                chain: Vec::new(),
                related,
                is_another: false,
            }),
        }
    }

    /// `compactAndMergeRelatedInfos`: adds related information to what was first noted of the error `code` at `start`, which is what is
    /// shown. `is_again`: the error has been reported before. Then what goes with any of the reports is put in the order of errors,
    /// each thing once.
    pub(super) fn relate_reports_merged(
        &self,
        start: u32,
        code: u32,
        is_again: bool,
        related: Vec<Related>,
    ) {
        let files = self.files();
        let mut notes = self.notes.borrow_mut();
        let Some(note) = notes
            .iter_mut()
            .find(|n| n.start == start && n.code == code)
        else {
            return;
        };
        note.related.extend(related);
        if is_again {
            let place = |r: &Related| {
                r.at.map(|(file, from, to)| (&files.module(file).path[..], from, to))
            };
            note.related
                .sort_by(|a, b| (place(a), a.code, &a.args).cmp(&(place(b), b.code, &b.args)));
            note.related.dedup();
        }
    }

    /// What was last noted at `start` is an error of its own as well: see `explain_another`.
    pub(super) fn explain_as_another(&self, start: u32) {
        if let Some(note) = self
            .notes
            .borrow_mut()
            .iter_mut()
            .rev()
            .find(|n| n.start == start)
        {
            note.is_another = true;
        }
    }

    /// `name` as it is written in a message.
    pub(super) fn atom_text(&self, name: crate::atom::Atom) -> String {
        String::from_utf8_lossy(self.files().atoms.bytes(name)).into_owned()
    }

    /// In what was last noted of the error `code` at `start`, the type that reads `from` goes by the name `to`.
    pub(super) fn explain_renamed(&self, start: u32, code: u32, from: &str, to: &str) {
        if let Some(note) = self
            .notes
            .borrow_mut()
            .iter_mut()
            .rev()
            .find(|n| n.start == start && n.code == code)
        {
            let reasons = note.chain.iter_mut().map(|line| &mut line.args);
            for arg in std::iter::once(&mut note.args).chain(reasons).flatten() {
                if arg.as_str() == from {
                    *arg = to.to_owned();
                }
            }
        }
    }

    /// The source text of `file` from `start` to `end`.
    pub(super) fn source_text(&self, file: FileId, start: u32, end: u32) -> String {
        let text = &self.hir(file).text;
        let end = (end as usize).min(text.len());
        String::from_utf8_lossy(&text[(start as usize).min(end)..end]).into_owned()
    }

    /// Adds lines under the message last noted for the error `code` at `start`: the reasons, outermost first.
    pub(super) fn explain_chain(
        &mut self,
        start: u32,
        code: u32,
        lines: impl FnOnce(&mut Self) -> Vec<Line>,
    ) {
        if !self.explains {
            return;
        }
        let lines = lines(self);
        if let Some(note) = self
            .notes
            .borrow_mut()
            .iter_mut()
            .rev()
            .find(|n| n.start == start && n.code == code)
        {
            note.chain.extend(lines);
        }
    }

    /// `NewDiagnosticChain`: puts the message `head` on top of what was last noted for the error `code` at `start`. The error goes by
    /// `head` from now on, and what it said is the first of its reasons.
    pub(super) fn explain_under(&self, start: u32, code: u32, head: u32, args: Vec<String>) {
        if !self.explains {
            return;
        }
        let mut notes = self.notes.borrow_mut();
        match notes
            .iter_mut()
            .rev()
            .find(|n| n.start == start && n.code == code)
        {
            Some(note) => {
                for line in &mut note.chain {
                    line.level += 1;
                }
                let said = Line {
                    code,
                    args: std::mem::replace(&mut note.args, args),
                    level: 1,
                };
                note.chain.insert(0, said);
                note.code = head;
            }
            // Nothing was noted of a message that takes no arguments.
            None => notes.push(Note {
                start,
                code: head,
                end: 0,
                args,
                chain: vec![Line {
                    code,
                    args: Vec::new(),
                    level: 1,
                }],
                related: Vec::new(),
                is_another: false,
            }),
        }
    }

    /// The error `code` last noted at `start` is reported at `to` instead, and ends at `end`.
    pub(super) fn explain_moved(&self, start: u32, code: u32, to: u32, end: u32) {
        if let Some(note) = self
            .notes
            .borrow_mut()
            .iter_mut()
            .rev()
            .find(|n| n.start == start && n.code == code)
        {
            note.start = to;
            note.end = end;
        }
    }

    /// `check_file`, with messages.
    pub fn check_file_explained(&mut self, file: FileId) -> Vec<Explained> {
        let explained_before = std::mem::replace(&mut self.explains, true);
        self.notes.borrow_mut().clear();
        self.release_shapes_for_now();
        let errors = self.check_file(file);
        self.explains = explained_before;
        let notes = self.notes.take();
        let mut explained: Vec<Explained> = Vec::with_capacity(errors.len());
        for d in errors {
            let from = explained.len();
            // Errors are the same if they also reach as far: `(a, b, c)` has one about `a` and one about `a, b`. Of those that do, the
            // first one noted: TypeScript keeps the first of two errors that are the same.
            for note in notes
                .iter()
                .filter(|n| n.start == d.start && n.code == d.code)
            {
                let one = self.explained(file, d, Some(note));
                if !explained[from..]
                    .iter()
                    .any(|e| e.end == one.end && (!note.is_another || e.text == one.text))
                {
                    explained.push(one);
                }
            }
            if explained.len() == from {
                explained.push(self.explained(file, d, None));
            }
        }
        explained
    }

    fn explained(&self, file: FileId, d: Diagnostic, note: Option<&Note>) -> Explained {
        let text = &self.hir(file).text;
        let (category, template) =
            messages::message(d.code).unwrap_or((Category::Error, "Unknown error."));
        let token_end = end_of_token(text, d.start);
        let mut message = match note {
            Some(note) if !note.args.is_empty() => messages::format(template, &note.args),
            _ => messages::format(
                template,
                &args_from_source(text, d.start, token_end, d.code),
            ),
        };
        for line in note.map_or(&[][..], |n| &n.chain) {
            message.push('\n');
            for _ in 0..line.level {
                message.push_str("  ");
            }
            let template = messages::message(line.code).map_or("", |m| m.1);
            message.push_str(&messages::format(template, &line.args));
        }
        Explained {
            start: d.start,
            end: match note {
                Some(note) if note.end == NO_LENGTH => d.start,
                Some(note) if note.end > d.start => note.end,
                // What the parser reported it on, if it is one of its errors.
                _ => self
                    .hir(file)
                    .error_ends
                    .iter()
                    .find(|e| e.0 == d.start && e.1 == d.code)
                    .map_or(token_end, |e| e.2),
            },
            code: d.code,
            category,
            text: message,
            related: note
                .map_or(&[][..], |n| &n.related)
                .iter()
                .map(|related| {
                    let (category, template) = messages::message(related.code)
                        .unwrap_or((Category::Message, "Unknown error."));
                    let mut text = messages::format(template, &related.args);
                    // An argument that starts on a new line is a line under the message.
                    for line in related.args.iter().filter(|arg| arg.starts_with('\n')) {
                        text.push_str(line);
                    }
                    RelatedExplained {
                        at: related.at,
                        code: related.code,
                        category,
                        text,
                    }
                })
                .collect(),
        }
    }
}

fn is_identifier_part(b: u8) -> bool {
    b.is_ascii_alphanumeric() || b == b'_' || b == b'$' || b >= 0x80
}

/// Where the token that starts at `start` ends: a name, a number, a string, or else one character.
pub(super) fn end_of_token(text: &[u8], start: u32) -> u32 {
    let at = start as usize;
    let Some(&first) = text.get(at) else {
        return start;
    };
    let mut end = at + 1;
    match first {
        b'"' | b'\'' | b'`' => {
            while let Some(&b) = text.get(end) {
                end += 1;
                if b == b'\\' {
                    end += 1;
                } else if b == first || b == b'\n' && first != b'`' {
                    break;
                }
            }
        }
        b'#' | b'@' => {
            while text.get(end).copied().is_some_and(is_identifier_part) {
                end += 1;
            }
        }
        _ if is_identifier_part(first) => {
            while text
                .get(end)
                .copied()
                .is_some_and(|b| is_identifier_part(b) || first.is_ascii_digit() && b == b'.')
            {
                end += 1;
            }
        }
        _ => {}
    }
    end.min(text.len()) as u32
}

/// The arguments of a message that nothing was noted for, where they can be read off the source: the name or the string the error is
/// reported on.
fn args_from_source(text: &[u8], start: u32, end: u32, code: u32) -> Vec<String> {
    use super::explain_table::Source;
    let token = &text[(start as usize).min(text.len())..(end as usize).min(text.len())];
    super::explain_table::sources(code)
        .iter()
        .map(|source| match source {
            Source::Name => String::from_utf8_lossy(token).into_owned(),
            Source::StringContents => {
                let inner = match token {
                    [q @ (b'"' | b'\'' | b'`'), inner @ .., last] if last == q => inner,
                    _ => token,
                };
                String::from_utf8_lossy(inner).into_owned()
            }
            Source::Const(text) => (*text).to_owned(),
        })
        .collect()
}
