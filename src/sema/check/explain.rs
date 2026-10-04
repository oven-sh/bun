//! Errors in display form.

use super::Checker;
use super::sink::{Args, Reported};
use crate::messages::{self, Category};
use crate::program::FileId;

/// One line of a message: `DiagnosticMessageChain`.
#[derive(Clone, PartialEq, Eq, Debug)]
pub struct Line {
    pub code: u32,
    pub args: Args,
    /// Indentation level relative to the first line, which is at 0.
    pub level: u32,
}

/// The location of an item that has none: a line of a chain, related information without a
/// location.
pub(super) const NOWHERE: (FileId, u32, u32) = (FileId(u32::MAX), 0, 0);

/// Sentinel for the end of an error with an empty span. TypeScript reports such errors on missing
/// nodes and at bare positions.
pub(super) const NO_LENGTH: u32 = u32::MAX;

/// `chain` and its nested chains, each line under the line it elaborates. The first is at level 1.
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

/// The inverse of `lines_of`.
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

/// Related information in display form.
#[derive(Clone, PartialEq, Eq, Debug)]
pub struct RelatedExplained {
    pub at: Option<(FileId, u32, u32)>,
    pub code: u32,
    pub category: Category,
    pub text: Vec<u8>,
}

/// An error in display form.
#[derive(Clone, PartialEq, Eq, Debug)]
pub struct Explained {
    pub start: u32,
    pub end: u32,
    pub code: u32,
    pub category: Category,
    /// The lines of the message. Those after the first are indented by two spaces for each level.
    pub text: Vec<u8>,
    pub related: Vec<RelatedExplained>,
}

impl Checker<'_> {
    /// Whether `GetSuggestionDiagnostics` are reported as well.
    pub(super) fn captures_suggestions(&self) -> bool {
        self.files().options.captures_suggestions
    }

    /// `name` as printed in a message.
    pub(super) fn atom_text(&self, name: crate::atom::Atom) -> Vec<u8> {
        self.atoms().bytes(name).to_vec()
    }

    /// The source text of `file` from `start` to `end`.
    pub(super) fn source_text(&self, file: FileId, start: u32, end: u32) -> Vec<u8> {
        let text = &self.hir(file).text;
        let end = (end as usize).min(text.len());
        text[(start as usize).min(end)..end].to_vec()
    }

    /// Computes the end of `d`, if it has not been set.
    pub(super) fn settle_place(&self, d: &mut Reported) {
        d.was_bare = d.is_bare();
        let hir = self.hir(d.file);
        // A diagnostic at a line break is between two tokens and has an empty span. In a JSDoc
        // comment the line break is a token.
        let token_end = match hir.text.get(d.start as usize) {
            Some(b'\n' | b'\r') if !hir.is_in_jsdoc(d.start) => d.start,
            _ => self.end_of_token_at(d.file, d.start),
        };
        d.end = match d.end {
            NO_LENGTH => d.start,
            end if end != 0 && end >= d.start => end,
            // No end was given.
            _ => token_end,
        };
    }
}

impl Explained {
    /// `d` in display form.
    pub(super) fn new(d: Reported) -> Explained {
        // The message of `d` and the lines under it, each indented by two spaces for each level.
        fn reported(d: &mut Reported, otherwise: Category) -> (Category, Vec<u8>) {
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
        let (category, text) = reported(&mut d, Category::Error);
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
                    let (category, text) = reported(&mut related, Category::Message);
                    let end = match related.end {
                        NO_LENGTH => related.start,
                        end => end,
                    };
                    let at = (related.file, related.start, end);
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
}
