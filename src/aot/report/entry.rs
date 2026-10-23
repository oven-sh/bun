use bun_ast::Kind;
use bun_options_types::aot_options::ExplainSet;
use bun_sema::messages::Category;
use bun_sema::util::SharedSort;
use bun_sema_driver::{self as driver, log_message};

use super::message::ReportMessage;
use super::source_texts::{ModuleLocator, SourceTexts};
use crate::diagnostics::new_driver_diagnostic;
use crate::engine::Position;

#[derive(Clone, PartialEq, Eq, Debug)]
pub struct EntryNote {
    pub text: Vec<u8>,
    pub position: Option<Position>,
}

#[derive(Clone, PartialEq, Eq, Debug)]
pub struct ReportEntry {
    pub kind: ExplainSet,
    pub text: Vec<u8>,
    pub position: Option<Position>,
    pub notes: Vec<EntryNote>,
}

impl ReportEntry {
    pub fn line(kind: ExplainSet, text: Vec<u8>) -> ReportEntry {
        ReportEntry {
            kind,
            text,
            position: None,
            notes: Vec::new(),
        }
    }

    pub fn add_note(&mut self, text: Vec<u8>) {
        self.notes.push(EntryNote {
            text,
            position: None,
        });
    }
}

fn locate_text(
    text: &[u8],
    position: Option<Position>,
    locator: &mut ModuleLocator<'_>,
) -> driver::Diagnostic {
    let reported = new_driver_diagnostic(0, Category::Warning, text.to_vec(), &[]);
    match position {
        Some(position) => locator.locate(position, reported),
        None => reported,
    }
}

/// The text of each entry, followed by the texts of its notes.
fn locate_texts(texts: &SourceTexts, entries: &[ReportEntry]) -> Vec<driver::Diagnostic> {
    let mut parts: Vec<(&[u8], Option<Position>)> = Vec::new();
    for entry in entries {
        parts.push((&entry.text[..], entry.position));
        parts.extend(
            entry
                .notes
                .iter()
                .map(|note| (&note.text[..], note.position)),
        );
    }
    // Ascending, so the locator scans the text of each module once. Entries arrive by rank.
    let mut order: Vec<usize> = (0..parts.len()).collect();
    order.shared_sort_unstable_by_key(|&index| parts[index].1);

    let mut locator = ModuleLocator::new(texts);
    let mut located: Vec<Option<driver::Diagnostic>> = parts.iter().map(|_| None).collect();
    for index in order {
        let (text, position) = parts[index];
        located[index] = Some(locate_text(text, position, &mut locator));
    }
    located.into_iter().flatten().collect()
}

pub fn to_messages(texts: &SourceTexts, entries: &[ReportEntry]) -> Vec<ReportMessage> {
    let mut located = locate_texts(texts, entries).into_iter();
    entries
        .iter()
        .map(|entry| {
            let mut reported = located.next().expect("every entry has a located text");
            reported.related = located.by_ref().take(entry.notes.len()).collect();
            let mut message = log_message(&reported).expect("a warning has a message");
            message.kind = Kind::Note;
            ReportMessage {
                kind: entry.kind,
                message,
            }
        })
        .collect()
}
