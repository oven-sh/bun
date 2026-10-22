use core::cmp::Reverse;

use bun_options_types::aot_options::ExplainSet;

use super::format::{self, PathPrinter};
use super::json::JsonWriter;
use super::levels::{
    ASCENDING_LEVELS, AccessColumn, CostCounts, LevelCounts, ProgramTotals, SiteTotals,
    compute_totals, totals_of,
};
use super::positions::{PathStyle, Positions, write_shown_position};
use super::wording::{
    column_description, column_key, column_label, level_label, unseen_code_sentence,
};
use super::{ReportEntry, ReportInput};
use crate::engine::AccessCountRecord;
use crate::ir::generated::AccessCost;
use crate::ir::ids::ModuleId;
use crate::link::ModuleOrigin;
use crate::statistics::{LimitId, StatisticId, Statistics};

const HINT_BELOW_TENTHS: u32 = 950;
const MAX_LISTED_FILES: usize = 5;
const HINT: &[u8] =
    b"Untyped code works, but runs slower. Run with --explain to see what to fix.\n";

struct FileAccesses<'r> {
    path: &'r [u8],
    accesses: CostCounts,
}

pub fn write_summary(input: &ReportInput<'_>, out: &mut Vec<u8>) {
    let options = input.options;
    let has_text_report = options.explain.contains(ExplainSet::TEXT);
    write_trim_causes(input, out);
    write_lines(
        &compute_totals(input),
        has_text_report,
        &options.option_words,
        out,
    );
}

pub fn write_untyped_note(statistics: &Statistics, out: &mut Vec<u8>) {
    let demoted_files = statistics.get(StatisticId::SourceFilesDemoted);
    if demoted_files == 0 {
        return;
    }
    format::write_counted(out, demoted_files, "file", "files");
    out.extend_from_slice(b" compiled without types");
}

pub(super) fn collect_details(input: &ReportInput<'_>, out: &mut Vec<ReportEntry>) {
    let text = details_text(
        input.engine.access_counts(),
        |module| input.names.module_path(module),
        |module| input.names.module_origin(module),
        input.statistics,
        |limit| input.engine.limit_value(limit),
        &PathPrinter::new(),
    );
    if let Some(text) = text {
        out.push(ReportEntry::line(ExplainSet::TEXT, text));
    }
}

pub(super) fn write_level_counts(json: &mut JsonWriter, key: &str, counts: &LevelCounts) {
    json.begin_object(key);
    for level in ASCENDING_LEVELS {
        json.number(level_label(level), counts.get(level));
    }
    json.end_object();
}

/// The three columns, which add up to every access.
pub(super) fn write_access_counts(json: &mut JsonWriter, key: &str, totals: &SiteTotals) {
    let costs = &totals.access_costs;
    json.begin_object(key);
    for column in AccessColumn::ALL.into_iter().rev() {
        json.number(column_key(column), costs.in_column(column));
    }
    json.number("testedSlotOnly", costs.get(AccessCost::TestsSlot));
    json.number("provenWithoutAnyTest", totals.accesses.typed());
    json.end_object();
}

fn free_tenths(costs: &CostCounts) -> u32 {
    format::percent_tenths(costs.free(), costs.total())
}

fn write_columns_line(out: &mut Vec<u8>, label: &str, costs: &CostCounts) {
    out.extend_from_slice(label.as_bytes());
    format::write_percent(out, free_tenths(costs));
    let mut separator: &[u8] = b" of property accesses are one load: ";
    for column in AccessColumn::ALL {
        out.extend_from_slice(separator);
        format::write_count(out, costs.in_column(column));
        out.push(b' ');
        out.extend_from_slice(column_label(column).as_bytes());
        separator = b", ";
    }
    out.extend_from_slice(b" (");
    format::write_count(out, costs.total());
    out.extend_from_slice(b")\n");
}

fn write_lines(
    totals: &ProgramTotals,
    has_text_report: bool,
    option_words: &[Box<[u8]>],
    out: &mut Vec<u8>,
) {
    let (program, dependencies) = (&totals.program.access_costs, &totals.dependencies.access_costs);
    if !option_words.is_empty() {
        out.extend_from_slice(b"Built with developer options:");
        for word in option_words {
            out.extend_from_slice(b" --aot-");
            out.extend_from_slice(word);
        }
        out.push(b'\n');
    }
    if program.total() > 0 && free_tenths(program) < HINT_BELOW_TENTHS && !has_text_report {
        out.extend_from_slice(HINT);
    }
    if dependencies.total() > 0 {
        write_columns_line(out, "Dependencies: ", dependencies);
    }
    if program.total() > 0 {
        write_columns_line(out, "", program);
    }
}

fn write_trim_causes(input: &ReportInput<'_>, out: &mut Vec<u8>) {
    if !input.options.trim.removes_unused {
        return;
    }
    let records = input.engine.unseen_code();
    let mut positions = Positions::new(input, PathStyle::Native);
    for unseen in &input.used_features.causes {
        let position = unseen
            .witness
            .and_then(|witness| records.get(witness.0 as usize))
            .and_then(|record| positions.resolve_location(record.witness.location));
        out.extend_from_slice(b"--trim kept APIs your code doesn't call because ");
        out.extend_from_slice(unseen_code_sentence(unseen.cause).as_bytes());
        if position.is_some() {
            out.extend_from_slice(b" (");
            write_shown_position(out, position.as_ref());
            out.push(b')');
        }
        out.push(b'\n');
    }
}

fn details_text<'r>(
    records: &[AccessCountRecord],
    path_of: impl Fn(ModuleId) -> &'r [u8],
    origin_of: impl Fn(ModuleId) -> ModuleOrigin,
    statistics: &Statistics,
    limit_value_of: impl Fn(LimitId) -> u64,
    printer: &PathPrinter,
) -> Option<Vec<u8>> {
    let all = totals_of(records, &origin_of).combined().access_costs;
    if all.total() == 0 {
        return None;
    }
    let files = collect_untyped_files(records, path_of, origin_of);
    let mut text = Vec::new();
    write_access_columns(&mut text, &all);
    write_call_counts(&mut text, statistics);
    write_most_untyped_files(&mut text, &files, printer);
    write_reached_limits(&mut text, statistics, limit_value_of);
    Some(text)
}

fn collect_untyped_files<'r>(
    records: &[AccessCountRecord],
    path_of: impl Fn(ModuleId) -> &'r [u8],
    origin_of: impl Fn(ModuleId) -> ModuleOrigin,
) -> Vec<FileAccesses<'r>> {
    let mut files = Vec::new();
    for record in records {
        let module = record.module_id();
        let accesses = CostCounts::from_words(record.access_costs);
        if accesses.not_free() > 0 && origin_of(module) == ModuleOrigin::Program {
            files.push(FileAccesses {
                path: path_of(module),
                accesses,
            });
        }
    }
    files.sort_by_key(|file| (Reverse(file.accesses.not_free()), file.path));
    files
}

fn count_text(count: u64) -> Vec<u8> {
    let mut text = Vec::new();
    format::write_count(&mut text, count);
    text
}

fn write_access_columns(out: &mut Vec<u8>, all: &CostCounts) {
    let rows = AccessColumn::ALL
        .map(|column| (count_text(all.in_column(column)), column_description(column)));
    let width = rows.iter().map(|(count, _)| count.len()).max().unwrap_or(0);
    out.extend_from_slice(b"All property accesses, including dependencies:");
    for (count, description) in &rows {
        out.extend_from_slice(b"\n  ");
        out.resize(out.len() + width - count.len(), b' ');
        out.extend_from_slice(count);
        out.extend_from_slice(b"  ");
        out.extend_from_slice(description.as_bytes());
    }
}

fn write_call_counts(out: &mut Vec<u8>, statistics: &Statistics) {
    out.extend_from_slice(b"\nCalls: ");
    format::write_count(out, statistics.get(StatisticId::DirectCalls));
    out.extend_from_slice(b" direct, ");
    format::write_count(out, statistics.get(StatisticId::IndirectCalls));
    out.extend_from_slice(b" indirect");
}

fn write_typed_ratio(out: &mut Vec<u8>, accesses: &CostCounts) {
    format::write_percent(out, free_tenths(accesses));
    out.extend_from_slice(b" typed (");
    format::write_count(out, accesses.free());
    out.extend_from_slice(b" of ");
    format::write_count(out, accesses.total());
    out.push(b')');
}

fn write_most_untyped_files(out: &mut Vec<u8>, files: &[FileAccesses<'_>], printer: &PathPrinter) {
    if files.is_empty() {
        return;
    }
    out.extend_from_slice(b"\nFiles with the most untyped accesses:");
    for file in files.iter().take(MAX_LISTED_FILES) {
        out.extend_from_slice(b"\n  ");
        printer.write_path(out, file.path);
        out.extend_from_slice(b"  ");
        write_typed_ratio(out, &file.accesses);
    }
    if files.len() > MAX_LISTED_FILES {
        out.extend_from_slice(b"\n  and ");
        format::write_count(out, (files.len() - MAX_LISTED_FILES) as u64);
        out.extend_from_slice(b" more");
    }
}

fn write_reached_limits(
    out: &mut Vec<u8>,
    statistics: &Statistics,
    limit_value_of: impl Fn(LimitId) -> u64,
) {
    let mut reached = LimitId::ALL
        .into_iter()
        .filter(|&limit| limit != LimitId::None)
        .map(|limit| (limit, statistics.get(limit.hits())))
        .filter(|&(_, hits)| hits > 0)
        .peekable();
    if reached.peek().is_none() {
        return;
    }
    out.extend_from_slice(b"\nCompiler limits hit:");
    for (limit, hits) in reached {
        out.extend_from_slice(b"\n  ");
        out.extend_from_slice(limit.name().as_bytes());
        out.extend_from_slice(b" = ");
        format::write_count(out, limit_value_of(limit));
        out.extend_from_slice(b", hit ");
        format::write_counted(out, hits, "time", "times");
        out.extend_from_slice(b" (limits ");
        out.extend_from_slice(limit.purpose().as_bytes());
        out.push(b')');
    }
}

#[cfg(test)]
mod tests;
