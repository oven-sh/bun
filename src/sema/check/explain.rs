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

/// Adds `lines` to `chain`, each under the last line of the level above. The first is at level 1.
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

/// An element of `MessageChain`.
#[derive(Clone, PartialEq, Eq, Debug)]
pub struct MessageChain {
    pub code: u32,
    pub args: Args,
    pub message_chain: Vec<MessageChain>,
}

impl MessageChain {
    fn of(chain: Vec<Reported>) -> Vec<MessageChain> {
        let chain = chain.into_iter().map(|one| MessageChain {
            code: one.code,
            args: one.args,
            message_chain: MessageChain::of(one.message_chain),
        });
        chain.collect()
    }

    /// `flattenDiagnosticMessageChain`
    pub fn flatten(&self, text: &mut Vec<u8>, level: usize) {
        text.push(b'\n');
        text.extend(std::iter::repeat_n(b' ', 2 * level));
        let template = messages::message(self.code).map_or("", |m| m.1);
        messages::format(text, template, &self.args);
        for child in &self.message_chain {
            child.flatten(text, level + 1);
        }
    }
}

/// Related information in display form.
#[derive(Clone, PartialEq, Eq, Debug)]
pub struct RelatedExplained {
    pub at: Option<(FileId, u32, u32)>,
    pub code: u32,
    pub category: Category,
    pub text: Vec<u8>,
    pub args: Args,
    pub message_chain: Vec<MessageChain>,
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
    /// What `text` is made of, which `CompareDiagnostics` compares.
    pub args: Args,
    pub message_chain: Vec<MessageChain>,
    pub related: Vec<RelatedExplained>,
}

impl Checker<'_, '_> {
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
        d.end = super::spans::Spans::of(self.hir(d.file)).diagnostic_end(d.start, d.end);
    }
}

impl Explained {
    /// `d` in display form.
    pub(super) fn new(d: Reported) -> Explained {
        // `WriteFlattenedDiagnosticMessage`, and the chain of `d`.
        fn reported(
            d: &mut Reported,
            otherwise: Category,
        ) -> (Category, Vec<u8>, Vec<MessageChain>) {
            let (category, template) =
                messages::message(d.code).unwrap_or((otherwise, "Unknown error."));
            let mut text = Vec::new();
            messages::format(&mut text, template, &d.args);
            let message_chain = MessageChain::of(std::mem::take(&mut d.message_chain));
            for chain in &message_chain {
                chain.flatten(&mut text, 1);
            }
            (category, super::print::to_valid_utf8(text), message_chain)
        }
        let mut d = d;
        let (category, text, message_chain) = reported(&mut d, Category::Error);
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
            args: d.args,
            message_chain,
            related: (d.related_information.into_iter())
                .map(|mut related| {
                    let (category, text, message_chain) = reported(&mut related, Category::Message);
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
                        args: related.args,
                        message_chain,
                    }
                })
                .collect(),
        }
    }
}
