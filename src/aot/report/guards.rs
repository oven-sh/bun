use bun_options_types::aot_options::ExplainSet;
use bun_sema::util::SharedSort;

use super::format::{write_count, write_counted};
use super::json::JsonWriter;
use super::names::Names;
use super::positions::{
    PathStyle, Positions, is_listed_site, resolve_ascending, write_position_members,
};
use super::wording::{
    GuardClass, GuardWording, failure_code, failure_sentence, guard_cause_code, guard_class,
    guard_wording, ill_typed_cause_wording,
};
use super::{EntryNote, ReportEntry, ReportInput, SourceTexts};
use crate::diagnostics::SourcePosition;
use crate::engine::{Position, TypeTestRecord, position_of};
use crate::ir::generated::IllTypedCause;

const MAX_SHOWN_PER_CLASS: usize = 200;

pub(super) fn collect_text(input: &ReportInput<'_>, out: &mut Vec<ReportEntry>) {
    let names = Names::new(input);
    let guards = listed_guards(input.engine.type_tests(), names);
    add_headings(&count_by_class(&guards), out);

    let mut shown_per_class = [0; GuardClass::COUNT];
    let mut number = 0;
    for record in &guards {
        let shown = &mut shown_per_class[class_of(record) as usize];
        if *shown == MAX_SHOWN_PER_CLASS {
            continue;
        }
        *shown += 1;
        number += 1;
        out.push(text_entry(number, record, names, input.texts));
    }

    let hidden = guards.len() - number;
    if hidden > 0 {
        let mut note = Vec::new();
        write_counted(&mut note, hidden as u64, "more guard", "more guards");
        note.extend_from_slice(
            b" not shown. Use --explain=guards-json to print all of them, one JSON object per line.",
        );
        out.push(line_entry(note));
    }
}

pub(super) fn collect_json(input: &ReportInput<'_>, out: &mut Vec<ReportEntry>) {
    let names = Names::new(input);
    let guards = listed_guards(input.engine.type_tests(), names);
    let wanted: Vec<Option<Position>> = guards
        .iter()
        .flat_map(|record| [record.location, record.witness.location].map(position_of))
        .collect();
    let mut positions = Positions::new(input, PathStyle::Posix);
    let resolved = resolve_ascending(&wanted, |position| positions.resolve(position));
    for (record, shown) in guards.iter().zip(resolved.as_chunks::<2>().0) {
        let (location, source) = (shown[0].as_ref(), shown[1].as_ref());
        out.push(json_entry(record, location, source, names));
    }
}

fn listed_guards<'r>(records: &'r [TypeTestRecord], names: Names<'_>) -> Vec<&'r TypeTestRecord> {
    let mut guards: Vec<&TypeTestRecord> = records
        .iter()
        .filter(|record| is_listed_site(names, record.location, record.function_id()))
        .collect();
    guards.shared_sort_by_key(|record| {
        let position = position_of(record.location);
        (position.is_none(), position, record.function)
    });
    guards
}

fn class_of(record: &TypeTestRecord) -> GuardClass {
    if record.ill_typed_cause == IllTypedCause::ReadBeforeInitialized {
        GuardClass::ReadBeforeInitialized
    } else {
        guard_class(record.cause)
    }
}

fn count_by_class(guards: &[&TypeTestRecord]) -> [u64; GuardClass::COUNT] {
    let mut counts = [0; GuardClass::COUNT];
    for guard in guards {
        counts[class_of(guard) as usize] += 1;
    }
    counts
}

fn add_headings(counts: &[u64; GuardClass::COUNT], out: &mut Vec<ReportEntry>) {
    let total: u64 = counts.iter().sum();
    if total == 0 {
        out.push(line_entry(b"No type guard can fail at run time.".to_vec()));
        return;
    }

    let mut heading = Vec::new();
    write_counted(&mut heading, total, "type guard", "type guards");
    heading.extend_from_slice(
        b" can fail at run time. When one fails, the result is the same and at most the rest of that call runs slower.",
    );
    out.push(line_entry(heading));

    let mut classes = b"By cause: ".to_vec();
    let mut separator: &[u8] = b"";
    for class in GuardClass::ALL {
        let count = counts[class as usize];
        if count == 0 {
            continue;
        }
        classes.extend_from_slice(separator);
        write_count(&mut classes, count);
        classes.push(b' ');
        classes.extend_from_slice(guard_wording(class).counted_as.as_bytes());
        separator = b", ";
    }
    classes.push(b'.');
    out.push(line_entry(classes));
}

fn line_entry(text: Vec<u8>) -> ReportEntry {
    ReportEntry::line(ExplainSet::CHECKS, text)
}

fn function_name<'a>(record: &TypeTestRecord, names: Names<'a>) -> &'a [u8] {
    let function = record.function_id();
    function.map_or(&[][..], |function| names.function_name(function))
}

fn type_name<'a>(record: &TypeTestRecord, names: Names<'a>) -> &'a [u8] {
    let layout = record.layout_id();
    layout.map_or(&[][..], |layout| names.layout_name(layout))
}

fn add_name_note(entry: &mut ReportEntry, label: &[u8], name: &[u8]) {
    if !name.is_empty() {
        entry.add_note([label, b"'", name, b"'"].concat());
    }
}

fn add_why_note(entry: &mut ReportEntry, record: &TypeTestRecord) {
    let headline_code = guard_cause_code(class_of(record));
    let why = ill_typed_cause_wording(record.ill_typed_cause);
    if let Some(why) = why.filter(|why| why.code != headline_code) {
        entry.add_note(format!("why ({}): {}", why.code, why.message).into_bytes());
    }
}

fn text_entry(
    number: usize,
    record: &TypeTestRecord,
    names: Names<'_>,
    texts: &SourceTexts,
) -> ReportEntry {
    let GuardWording { headline, fix, .. } = guard_wording(class_of(record));
    let position = position_of(record.location);

    let text = format!("{number}. {headline}").into_bytes();
    let mut entry = ReportEntry::at(ExplainSet::CHECKS, text, position);

    let source = position_of(record.witness.location)
        .filter(|&source| Some(source) != position && texts.get(source.module).is_some());
    if source.is_some() {
        entry.notes.push(EntryNote {
            text: b"The value comes from here.".to_vec(),
            position: source,
        });
    }
    add_name_note(&mut entry, b"in function ", function_name(record, names));
    add_name_note(&mut entry, b"type ", type_name(record, names));
    add_why_note(&mut entry, record);
    entry.add_note(failure_sentence(record.failure).as_bytes().to_vec());
    entry.add_note([&b"fix: "[..], fix.as_bytes()].concat());
    entry
}

fn json_entry(
    record: &TypeTestRecord,
    location: Option<&SourcePosition>,
    source: Option<&SourcePosition>,
    names: Names<'_>,
) -> ReportEntry {
    let mut json = JsonWriter::object();
    json.string("aot", b"type-check");
    let cause = guard_cause_code(class_of(record));
    json.string("cause", cause.as_bytes());
    write_position_members(&mut json, location, "col");
    json.string("function", function_name(record, names));
    json.string("failure", failure_code(record.failure).as_bytes());
    json.number("copies", u64::from(record.copies));
    json.string("type", type_name(record, names));
    if source.is_some() {
        json.begin_object("from");
        write_position_members(&mut json, source, "col");
        json.end_object();
    }
    let position = position_of(record.location);
    ReportEntry::at(ExplainSet::CHECKS_JSON, json.finish(), position)
}

#[cfg(test)]
mod tests;
