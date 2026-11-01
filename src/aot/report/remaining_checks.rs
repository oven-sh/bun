use bun_options_types::aot_options::ExplainSet;
use bun_sema::util::SharedSort;

use super::build_report::write_position_members;
use super::format::{write_count, write_counted};
use super::json::JsonWriter;
use super::positions::{PathStyle, Positions, is_listed_site, resolve_ascending};
use super::wording::{CheckWording, check_wording, guard_cause_code};
use super::{EntryNote, ReportEntry, ReportInput};
use crate::diagnostics::SourcePosition;
use crate::engine::{Position, RemainingCheckRecord, position_of};
use crate::ir::generated::CheckCause;
use crate::link::ProgramNames;

const MAX_SHOWN_PER_CAUSE: usize = 200;
const LOGGING_BUILD_NOTE: &[u8] = b"A build with --aot-log-type-mismatches doesn't rely on your types, so it has no guards to list. Run --explain=guards without that flag. Each entry there has the id this build logs.";

pub(super) fn collect_text(input: &ReportInput<'_>, out: &mut Vec<ReportEntry>) {
    if input.options.reports_type_mismatches {
        out.push(line_entry(LOGGING_BUILD_NOTE.to_vec()));
        return;
    }

    let checks = listed_checks(input.engine.remaining_checks(), input.names);
    let mut headings = Vec::new();
    write_headings(&count_by_cause(&checks), &mut headings);
    out.extend(headings.into_iter().map(line_entry));

    let positions = Positions::new(input, PathStyle::Native);
    let mut shown_per_cause = [0; CheckCause::COUNT];
    let mut number = 0;
    for record in &checks {
        let shown = &mut shown_per_cause[record.cause as usize];
        if *shown == MAX_SHOWN_PER_CAUSE {
            continue;
        }
        *shown += 1;
        number += 1;
        out.push(text_entry(number, record, input.names, &positions));
    }

    let skipped = checks.len() - number;
    if skipped > 0 {
        let mut note = Vec::new();
        write_counted(&mut note, skipped as u64, "more guard", "more guards");
        note.extend_from_slice(
            b" not shown. Use --explain=guards-json to print all of them, one JSON object per line.",
        );
        out.push(line_entry(note));
    }
}

pub(super) fn collect_json(input: &ReportInput<'_>, out: &mut Vec<ReportEntry>) {
    if input.options.reports_type_mismatches {
        return;
    }

    let checks = listed_checks(input.engine.remaining_checks(), input.names);
    let mut positions = Positions::new(input, PathStyle::Posix);
    let wanted: Vec<Option<Position>> = checks
        .iter()
        .map(|check| position_of(check.origin))
        .collect();
    let type_positions = resolve_ascending(&wanted, |position| positions.resolve(position));
    for (record, type_position) in checks.iter().zip(&type_positions) {
        let entry = json_entry(record, type_position.as_ref(), input.names, &mut positions);
        out.push(entry);
    }
}

fn listed_checks<'r>(
    records: &'r [RemainingCheckRecord],
    names: &ProgramNames,
) -> Vec<&'r RemainingCheckRecord> {
    let mut checks: Vec<&RemainingCheckRecord> = records
        .iter()
        .filter(|record| {
            is_listed_site(names, record.witness.location, record.witness.function_id())
        })
        .collect();
    checks.shared_sort_unstable_by_key(|record| {
        let position = position_of(record.witness.location);
        (position.is_none(), position, record.id)
    });
    checks
}

fn id_text(id: u64) -> Vec<u8> {
    format!("{id:012x}").into_bytes()
}

fn count_by_cause(checks: &[&RemainingCheckRecord]) -> [u64; CheckCause::COUNT] {
    let mut counts = [0; CheckCause::COUNT];
    for check in checks {
        counts[check.cause as usize] += 1;
    }
    counts
}

fn write_headings(counts: &[u64; CheckCause::COUNT], out: &mut Vec<Vec<u8>>) {
    let total: u64 = counts.iter().sum();
    if total == 0 {
        out.push(b"No type guard can fail at run time.".to_vec());
        return;
    }

    let mut heading = Vec::new();
    write_counted(&mut heading, total, "type guard", "type guards");
    heading.extend_from_slice(
        b" can fail at run time. When one fails, the function falls back to its slow path.",
    );
    out.push(heading);

    let mut causes = b"By cause: ".to_vec();
    let mut separator: &[u8] = b"";
    for cause in CheckCause::ALL {
        let count = counts[cause as usize];
        if count == 0 {
            continue;
        }
        causes.extend_from_slice(separator);
        write_count(&mut causes, count);
        causes.push(b' ');
        causes.extend_from_slice(check_wording(cause).counted_as.as_bytes());
        separator = b", ";
    }
    causes.push(b'.');
    out.push(causes);
}

fn line_entry(text: Vec<u8>) -> ReportEntry {
    ReportEntry::line(ExplainSet::CHECKS, text)
}

fn text_entry(
    number: usize,
    record: &RemainingCheckRecord,
    names: &ProgramNames,
    positions: &Positions<'_>,
) -> ReportEntry {
    let CheckWording { headline, fix, .. } = check_wording(record.cause);
    let function = record.witness.function_id();
    let position = position_of(record.witness.location);

    let text = format!("{number}. {headline}").into_bytes();
    let mut entry = ReportEntry::at(ExplainSet::CHECKS, text, position);

    let type_position = position_of(record.origin)
        .filter(|&origin| Some(origin) != position && positions.locator.has_text(origin.module));
    if type_position.is_some() {
        entry.notes.push(EntryNote {
            text: b"The type is declared here.".to_vec(),
            position: type_position,
        });
    }
    let function_name = function.map_or(&[][..], |function| names.function_name(function));
    if !function_name.is_empty() {
        entry.add_note([&b"in function '"[..], function_name, b"'"].concat());
    }
    entry.add_note([&b"fix: "[..], fix.as_bytes()].concat());
    let log_word = record.site_kind.log_word().as_bytes();
    entry.add_note([&b"id "[..], &id_text(record.id)[..], b" (", log_word, b")"].concat());
    entry
}

fn json_entry(
    record: &RemainingCheckRecord,
    type_position: Option<&SourcePosition>,
    names: &ProgramNames,
    positions: &mut Positions<'_>,
) -> ReportEntry {
    let function = record.witness.function_id();
    let position = position_of(record.witness.location);
    let function_name = function.map_or(&[][..], |function| names.function_name(function));

    let mut json = JsonWriter::object();
    json.string("aot", b"type-check");
    json.string("cause", guard_cause_code(record.cause).as_bytes());
    let shown = position.and_then(|position| positions.resolve(position));
    write_position_members(&mut json, shown.as_ref(), "col");
    json.string("function", function_name);
    json.string("kind", record.site_kind.log_word().as_bytes());
    json.string("id", &id_text(record.id));
    if type_position.is_some() {
        json.begin_object("type");
        write_position_members(&mut json, type_position, "col");
        json.end_object();
    }
    ReportEntry::at(ExplainSet::CHECKS_JSON, json.finish(), position)
}

#[cfg(test)]
mod tests;
