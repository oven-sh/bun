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

/// What is noted of the error `code` at `start`.
#[derive(Clone, Debug)]
pub(super) struct Note {
    start: u32,
    code: u32,
    /// `0`: not said.
    end: u32,
    args: Vec<String>,
    chain: Vec<Line>,
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
        });
    }

    /// `name` as it is written in a message.
    pub(super) fn atom_text(&self, name: crate::atom::Atom) -> String {
        String::from_utf8_lossy(self.files().atoms.bytes(name)).into_owned()
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

    /// `check_file`, with messages.
    pub fn check_file_explained(&mut self, file: FileId) -> Vec<Explained> {
        let explained_before = std::mem::replace(&mut self.explains, true);
        self.notes.borrow_mut().clear();
        let errors = self.check_file(file);
        self.explains = explained_before;
        let notes = self.notes.take();
        errors
            .into_iter()
            .map(|d| {
                // The first one noted: TypeScript keeps the first of two errors that are the same.
                let note = notes
                    .iter()
                    .find(|n| n.start == d.start && n.code == d.code);
                self.explained(file, d, note)
            })
            .collect()
    }

    fn explained(&self, file: FileId, d: Diagnostic, note: Option<&Note>) -> Explained {
        let text = &self.hir(file).text;
        let (category, template) =
            messages::message(d.code).unwrap_or((Category::Error, "Unknown error."));
        let token_end = end_of_token(text, d.start);
        let mut message = match note {
            Some(note) => messages::format(template, &note.args),
            None => messages::format(
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
                Some(note) if note.end > d.start => note.end,
                _ => token_end,
            },
            code: d.code,
            category,
            text: message,
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
