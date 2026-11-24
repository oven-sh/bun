use bun_options_types::aot_options::ExplainSet;
use bun_sema::util::SharedSort;

use super::format::write_counted;
use super::json::JsonWriter;
use super::names::Names;
use super::positions::{
    PathStyle, Positions, is_listed_site, resolve_ascending, write_position_members,
};
use super::wording::{GUARD_FIX, GUARD_HEADLINE, failure_code, failure_sentence};
use super::{ReportEntry, ReportInput};
use crate::diagnostics::SourcePosition;
use crate::engine::{Position, TypeTestRecord, position_of};

const MAX_SHOWN: usize = 200;

pub(super) fn collect_text(input: &ReportInput<'_>, out: &mut Vec<ReportEntry>) {
    let names = Names::new(input);
    let guards = listed_guards(input.engine.type_tests(), names);
    out.push(heading(guards.len()));
    for (index, record) in guards.iter().take(MAX_SHOWN).enumerate() {
        out.push(text_entry(index + 1, record, names));
    }

    if guards.len() > MAX_SHOWN {
        let hidden = guards.len() - MAX_SHOWN;
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
        .map(|record| position_of(record.location))
        .collect();
    let mut positions = Positions::new(input, PathStyle::Posix);
    let resolved = resolve_ascending(&wanted, |position| positions.resolve(position));
    for (record, location) in guards.iter().zip(&resolved) {
        out.push(json_entry(record, location.as_ref(), names));
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

fn heading(count: usize) -> ReportEntry {
    if count == 0 {
        return line_entry(b"No type guard can fail at run time.".to_vec());
    }
    let mut heading = Vec::new();
    write_counted(&mut heading, count as u64, "type guard", "type guards");
    heading.extend_from_slice(
        b" can fail at run time. When one fails, the result is the same and at most the rest of that call runs slower.",
    );
    line_entry(heading)
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

fn text_entry(number: usize, record: &TypeTestRecord, names: Names<'_>) -> ReportEntry {
    let text = format!("{number}. {GUARD_HEADLINE}").into_bytes();
    let mut entry = ReportEntry::at(ExplainSet::CHECKS, text, position_of(record.location));
    add_name_note(&mut entry, b"in function ", function_name(record, names));
    add_name_note(&mut entry, b"type ", type_name(record, names));
    entry.add_note(failure_sentence(record.failure).as_bytes().to_vec());
    entry.add_note([&b"fix: "[..], GUARD_FIX.as_bytes()].concat());
    entry
}

fn json_entry(
    record: &TypeTestRecord,
    location: Option<&SourcePosition>,
    names: Names<'_>,
) -> ReportEntry {
    let mut json = JsonWriter::object();
    json.string("aot", b"type-check");
    write_position_members(&mut json, location, "col");
    json.string("function", function_name(record, names));
    json.string("failure", failure_code(record.failure).as_bytes());
    json.number("copies", u64::from(record.copies));
    json.string("type", type_name(record, names));
    let position = position_of(record.location);
    ReportEntry::at(ExplainSet::CHECKS_JSON, json.finish(), position)
}

#[cfg(test)]
mod tests;
