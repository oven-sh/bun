//! Diagnostics formatted for display.

use super::Checker;
use super::sink::{Args, Reported};
use crate::messages::{self, Category};
use crate::program::FileId;

/// One line of a `DiagnosticMessageChain`.
#[derive(Clone, PartialEq, Eq, Debug)]
pub struct Line {
    pub code: u32,
    pub args: Args,
    /// Indentation level relative to the first line, which is at 0.
    pub level: u32,
}

/// Placeholder location for items without one: chain lines, and related information that has no
/// location.
pub(super) const NOWHERE: (FileId, u32, u32) = (FileId(u32::MAX), 0, 0);

/// Sentinel for the end of an error with an empty span. TypeScript reports such errors on missing
/// nodes and at bare positions.
pub(super) const NO_LENGTH: u32 = u32::MAX;

/// Appends `lines` to `chain`, nesting each under the last line one level up. The first line is at
/// level 1.
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

/// One entry of a diagnostic's `MessageChain`.
#[derive(Clone, PartialEq, Eq, Debug)]
pub struct MessageChain {
    pub code: u32,
    pub args: Args,
    pub message_chain: Vec<MessageChain>,
}

impl MessageChain {
    fn from_reported(chain: Vec<Reported>) -> Vec<MessageChain> {
        let chain = chain.into_iter().map(|reported_entry| MessageChain {
            code: reported_entry.code,
            args: reported_entry.args,
            message_chain: MessageChain::from_reported(reported_entry.message_chain),
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

/// Related information formatted for display.
#[derive(Clone, PartialEq, Eq, Debug)]
pub struct RelatedExplained {
    pub at: Option<(FileId, u32, u32)>,
    pub code: u32,
    pub category: Category,
    pub text: Vec<u8>,
    pub args: Args,
    pub message_chain: Vec<MessageChain>,
}

/// A diagnostic formatted for display.
#[derive(Clone, PartialEq, Eq, Debug)]
pub struct Explained {
    pub start: u32,
    pub end: u32,
    pub code: u32,
    pub category: Category,
    /// The message's lines. Each line after the first is indented two spaces per level.
    pub text: Vec<u8>,
    /// The arguments `text` was formatted from. `CompareDiagnostics` compares them.
    pub args: Args,
    pub message_chain: Vec<MessageChain>,
    pub related: Vec<RelatedExplained>,
}

impl Checker<'_, '_> {
    /// True if `GetSuggestionDiagnostics` results are reported too.
    pub(super) fn captures_suggestions(&self) -> bool {
        self.files().options.captures_suggestions
    }

    /// Returns `name`'s text for use in a message.
    pub(super) fn atom_text(&self, name: crate::atom::Atom) -> Vec<u8> {
        self.atoms().bytes(name).to_vec()
    }

    /// Returns `file`'s source text from `start` to `end`.
    pub(super) fn source_text(&self, file: FileId, start: u32, end: u32) -> Vec<u8> {
        let text = &self.hir(file).text;
        let end = (end as usize).min(text.len());
        text[(start as usize).min(end)..end].to_vec()
    }

    /// Computes `d`'s end if it isn't set yet.
    pub(super) fn resolve_span_end(&self, d: &mut Reported) {
        d.was_bare = d.is_bare();
        d.end = super::spans::Spans::of(self.hir(d.file)).diagnostic_end(d.start, d.end);
    }
}

impl Explained {
    /// Formats `d` for display.
    pub(super) fn new(d: Reported) -> Explained {
        // `WriteFlattenedDiagnosticMessage`. Also returns `d`'s chain.
        fn reported(
            d: &mut Reported,
            default_category: Category,
        ) -> (Category, Vec<u8>, Vec<MessageChain>) {
            let (category, template) =
                messages::message(d.code).unwrap_or((default_category, "Unknown error."));
            let mut text = Vec::new();
            messages::format(&mut text, template, &d.args);
            let message_chain = MessageChain::from_reported(std::mem::take(&mut d.message_chain));
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
