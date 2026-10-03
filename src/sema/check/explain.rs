//! Errors that are reported in two steps, and errors as they are shown.
//!
//! `error` makes an `ast.Diagnostic` whole. What is here finds the one last reported at a place again and adds to it, for whoever
//! does not have it all at hand where it reports.

use super::Checker;
use super::sink::{Arg, Args, Reported, held};
use crate::messages::{self, Category};
use crate::program::FileId;

/// One line of a message: `DiagnosticMessageChain`.
#[derive(Clone, PartialEq, Eq, Debug)]
pub struct Line {
    pub code: u32,
    pub args: Args,
    /// How far it is indented under the first line, which is at 0.
    pub level: u32,
}

/// The place of what has none: a line of a chain, related information that does not say where.
pub(super) const NOWHERE: (FileId, u32, u32) = (FileId(u32::MAX), 0, 0);

/// Given as the end of an error: it ends where it starts. TypeScript reports such errors on nodes that are missing and at bare positions.
pub(super) const NO_LENGTH: u32 = u32::MAX;

/// `chain` and what hangs on it, each line under the one it is a reason for. The first is at level 1.
pub(super) fn lines_of(chain: Vec<Reported>) -> Vec<Line> {
    fn add(chain: Vec<Reported>, level: u32, lines: &mut Vec<Line>) {
        for one in chain {
            lines.push(Line {
                code: one.code,
                args: one.args,
                level,
            });
            add(one.message_chain, level + 1, lines);
        }
    }
    let mut lines = Vec::new();
    add(chain, 1, &mut lines);
    lines
}

/// `lines_of`, the other way.
pub(super) fn add_lines(chain: &mut Vec<Reported>, lines: Vec<Line>) {
    for line in lines {
        let mut under = &mut *chain;
        for _ in 1..line.level {
            if under.is_empty() {
                break;
            }
            under = &mut under.last_mut().unwrap().message_chain;
        }
        under.push(Reported::new(NOWHERE, line.code, line.args));
    }
}

/// Related information as it is shown.
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
    /// What was last reported as `code` at `start`, by no question that is settled, or else what has been noted of it ahead.
    fn last_reported(&mut self, start: u32, code: u32) -> Option<&mut Reported> {
        (self.reported.iter_mut().rev())
            .chain(self.noted_ahead.iter_mut().rev())
            .find(|d| d.start == start && d.code == code)
    }

    /// The same, and that the error ends at `end`: the end of the node TypeScript reports it on.
    pub(super) fn explain_to(
        &mut self,
        start: u32,
        end: u32,
        code: u32,
        args: impl FnOnce(&mut Self) -> Vec<String>,
    ) {
        let args = held(args(self));
        self.note_printed(start, end, code, args);
    }

    /// The same, of arguments that are at hand. Of an error that has its arguments it is another error.
    pub(super) fn note(&mut self, start: u32, end: u32, code: u32, args: &[Arg<'_>]) {
        let args = self.stringify_args(args);
        self.note_printed(start, end, code, args);
    }

    pub(super) fn note_printed(&mut self, start: u32, end: u32, code: u32, args: Args) {
        let last = self.last_reported_or_ahead(start, code);
        if last.is_bare() {
            (last.end, last.args) = (end, args);
        } else if last.file != NOWHERE.0 {
            let another = Reported::new((last.file, start, end), code, args);
            self.reported.push(another);
        } else if last.end != end {
            let ahead = Reported::new((NOWHERE.0, start, end), code, args);
            self.noted_ahead.push(ahead);
        }
    }

    /// `last_reported`. Who works out the code may say what goes with it, and whoever asked reports it afterwards.
    fn last_reported_or_ahead(&mut self, start: u32, code: u32) -> &mut Reported {
        if self.last_reported(start, code).is_none() {
            let ahead = Reported::bare((NOWHERE.0, start, 0), code);
            self.noted_ahead.push(ahead);
        }
        self.last_reported(start, code).unwrap()
    }

    /// Merges each pending note into the diagnostic with the same start and code. Notes without a match are dropped.
    pub(super) fn settle_what_was_noted_ahead(&mut self) {
        for ahead in std::mem::take(&mut self.noted_ahead) {
            let is_it = |d: &&mut Reported| d.start == ahead.start && d.code == ahead.code;
            match self.reported.iter_mut().find(is_it) {
                Some(d) if d.is_bare() || ahead.is_bare() => {
                    if !ahead.is_bare() {
                        (d.end, d.args) = (ahead.end, ahead.args);
                        d.message_chain = ahead.message_chain;
                    }
                    d.related_information.extend(ahead.related_information);
                    d.is_suggestion |= ahead.is_suggestion;
                }
                // It was said first, and the first of two errors in one place is kept.
                Some(d) if ahead.end == 0 || ahead.end == d.end => {
                    (d.args, d.message_chain) = (ahead.args, ahead.message_chain);
                    d.related_information = ahead.related_information;
                }
                Some(d) => {
                    let file = d.file;
                    self.reported.push(Reported { file, ..ahead });
                }
                None => {}
            }
        }
    }

    /// `AddRelatedInfo`, to what was last reported as `code` at `start`.
    pub(super) fn relate(
        &mut self,
        start: u32,
        code: u32,
        related: impl FnOnce(&mut Self) -> Vec<Reported>,
    ) {
        let related = related(self);
        let last = self.last_reported_or_ahead(start, code);
        last.related_information.extend(related);
    }

    /// Whether `GetSuggestionDiagnostics` are reported as well.
    pub(super) fn captures_suggestions(&self) -> bool {
        self.files().options.captures_suggestions
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

    /// `check_file` and `finish_file`, for whoever checks one file by itself.
    pub fn check_file_explained(&mut self, file: FileId) -> Vec<Explained> {
        let checked = self.check_file(file);
        self.finish_file(file, checked)
    }

    /// `d` as it is shown.
    pub(super) fn explained(&self, d: Reported) -> Explained {
        // The message of `d` and the lines under it, each indented by two spaces for each level.
        fn said(d: &mut Reported, otherwise: Category) -> (Category, String) {
            let (category, template) =
                messages::message(d.code).unwrap_or((otherwise, "Unknown error."));
            let mut text = Vec::new();
            messages::format(&mut text, template, &d.args);
            for line in lines_of(std::mem::take(&mut d.message_chain)) {
                text.push(b'\n');
                text.extend(std::iter::repeat_n(b' ', 2 * line.level as usize));
                let template = messages::message(line.code).map_or("", |m| m.1);
                messages::format(&mut text, template, &line.args);
            }
            (category, super::print::to_valid_utf8(text))
        }
        let mut d = d;
        let (category, text) = said(&mut d, Category::Error);
        Explained {
            start: d.start,
            end: d.end,
            code: d.code,
            category: if d.is_suggestion {
                Category::Suggestion
            } else {
                category
            },
            text,
            related: (d.related_information.into_iter())
                .map(|mut related| {
                    let (category, text) = said(&mut related, Category::Message);
                    let at = (related.file, related.start, related.end);
                    RelatedExplained {
                        at: (related.file != NOWHERE.0).then_some(at),
                        code: related.code,
                        category,
                        text,
                    }
                })
                .collect(),
        }
    }

    /// Where `d` ends, if that has not been said, and the arguments of its message, if they can be read off the source.
    pub(super) fn settle_place(&self, d: &mut Reported) {
        let hir = self.hir(d.file);
        // What is reported where a line ends is reported between two tokens, and is empty. In a JSDoc comment the end of a line is a token.
        let token_end = match hir.text.get(d.start as usize) {
            Some(b'\n' | b'\r') if !hir.is_in_jsdoc(d.start) => d.start,
            _ => self.end_of_token_at(d.file, d.start),
        };
        d.end = match d.end {
            NO_LENGTH => d.start,
            end if end != 0 && end >= d.start => end,
            // Nobody has said. What the parser reported it on, if it is one of its errors.
            _ => hir
                .error_ends
                .iter()
                .find(|e| e.0 == d.start && e.1 == d.code)
                .map_or(token_end, |e| e.2),
        };
    }
}
