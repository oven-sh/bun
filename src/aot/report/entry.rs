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
        ReportEntry::at(kind, text, None)
    }

    pub(crate) fn at(kind: ExplainSet, text: Vec<u8>, position: Option<Position>) -> ReportEntry {
        ReportEntry {
            kind,
            text,
            position,
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

pub fn to_messages(texts: &SourceTexts, entries: &[ReportEntry]) -> Vec<ReportMessage> {
    let mut parts: Vec<(&[u8], Option<Position>)> = Vec::new();
    for entry in entries {
        parts.push((&entry.text[..], entry.position));
        let notes = entry.notes.iter();
        parts.extend(notes.map(|note| (&note.text[..], note.position)));
    }
    // Ascending, so the locator scans the text of each module once. Entries arrive by rank.
    let mut order: Vec<usize> = (0..parts.len()).collect();
    order.shared_sort_unstable_by_key(|&index| parts[index].1);

    let mut locator = ModuleLocator::new(texts);
    let mut located: Vec<Option<driver::Diagnostic>> = parts.iter().map(|_| None).collect();
    for index in order {
        let (text, position) = parts[index];
        let reported = new_driver_diagnostic(0, Category::Warning, text.to_vec(), &[]);
        located[index] = Some(match position {
            Some(position) => locator.locate(position, reported),
            None => reported,
        });
    }

    let mut located = located.into_iter().flatten();
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

#[cfg(test)]
mod tests {
    use bstr::BString;
    use bun_ast::Log;
    use bun_sema_standalone as _;

    use super::super::message::{
        add_messages_to_log, has_line_label, is_json_report, is_message_report, write_lines,
    };
    use super::super::source_texts::ModuleSource;
    use super::*;
    use crate::ir::ids::{Id, ModuleId};

    const KINDS: [(ExplainSet, bool, bool, bool); 12] = [
        (ExplainSet::TEXT, false, true, false),
        (ExplainSet::JSON, true, false, false),
        (ExplainSet::CHECKS, false, true, false),
        (ExplainSet::CHECKS_JSON, true, false, false),
        (ExplainSet::RUNTIME_USE, false, false, true),
        (ExplainSet::DECLINES, false, false, true),
        (ExplainSet::ALLOCATIONS, false, false, true),
        (ExplainSet::ONLY_UNKNOWN_CODE, false, false, true),
        (ExplainSet::ONLY_UNPROVEN_TYPE, false, false, true),
        (ExplainSet::ONLY_MUTATION, false, false, true),
        (ExplainSet::STATISTICS, false, false, false),
        (ExplainSet::ONLY_LIMIT, false, false, true),
    ];

    fn texts() -> SourceTexts {
        SourceTexts::new(vec![Some(ModuleSource::new(
            b"/p/a.ts",
            b"first;\nsecond;\n",
        ))])
    }

    fn messages_of(entries: &[ReportEntry]) -> Vec<ReportMessage> {
        to_messages(&texts(), entries)
    }

    fn lines(entries: &[(ExplainSet, &str)], is_json: bool) -> BString {
        let entries: Vec<ReportEntry> = entries
            .iter()
            .map(|&(kind, text)| ReportEntry::line(kind, text.as_bytes().to_vec()))
            .collect();
        let mut out = Vec::new();
        write_lines(&messages_of(&entries), is_json, &mut out);
        BString::from(out)
    }

    #[test]
    fn each_kind_prints_one_way() {
        for (kind, is_json, is_message, has_label) in KINDS {
            assert_eq!(is_json_report(kind), is_json, "{kind:?}");
            assert_eq!(is_message_report(kind), is_message, "{kind:?}");
            assert_eq!(has_line_label(kind), has_label, "{kind:?}");
        }
    }

    #[test]
    fn line_reports_have_label() {
        let entries = [
            (ExplainSet::DECLINES, "missed optimizations: none"),
            (ExplainSet::STATISTICS, "TypesInterned 3"),
        ];
        assert_eq!(
            lines(&entries, false),
            "aot: missed optimizations: none\nTypesInterned 3\n"
        );
    }

    #[test]
    fn lines_are_filtered_by_format() {
        let entries = [
            (ExplainSet::TEXT, "heading"),
            (ExplainSet::JSON, r#"{"rank":1}"#),
            (ExplainSet::CHECKS_JSON, r#"{"aot":"type-check"}"#),
            (ExplainSet::ONLY_MUTATION, "mutation: field-deleted"),
        ];
        assert_eq!(lines(&entries, false), "aot: mutation: field-deleted\n");
        assert_eq!(
            lines(&entries, true),
            "{\"rank\":1}\n{\"aot\":\"type-check\"}\n"
        );
        assert_eq!(lines(&[], false), "");
    }

    #[test]
    fn located_entry_carries_line_of_compiled_text() {
        let mut entry = ReportEntry::line(ExplainSet::TEXT, b"unknown-object: x".to_vec());
        entry.position = Some(Position {
            module: ModuleId::new(0),
            offset: 7,
        });
        entry.add_note(b"fix: y".to_vec());
        let messages = messages_of(&[entry]);
        let message = &messages[0].message;
        assert!(message.kind == Kind::Note);
        assert_eq!(BString::from(&message.data.text[..]), "unknown-object: x");
        let location = message.data.location.as_ref().expect("a location");
        assert_eq!((location.line, location.column), (2, 1));
        assert_eq!(location.line_text.as_deref(), Some(&b"second;"[..]));
        assert_eq!(message.notes.len(), 1);
        assert_eq!(BString::from(&message.notes[0].text[..]), "fix: y");
        assert!(message.notes[0].location.is_none());
    }

    #[test]
    fn only_message_reports_reach_log() {
        let entries = [
            ReportEntry::line(ExplainSet::TEXT, b"a".to_vec()),
            ReportEntry::line(ExplainSet::JSON, b"{}".to_vec()),
            ReportEntry::line(ExplainSet::DECLINES, b"b".to_vec()),
            ReportEntry::line(ExplainSet::CHECKS, b"c".to_vec()),
        ];
        let mut log = Log::init();
        add_messages_to_log(messages_of(&entries), &mut log);
        let texts: Vec<BString> = log
            .msgs
            .iter()
            .map(|message| BString::from(&message.data.text[..]))
            .collect();
        assert_eq!(texts, ["a", "c"]);
        assert_eq!((log.errors, log.warnings), (0, 0));
    }
}
