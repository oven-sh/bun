use bun_options_types::aot_options::ExplainSet;
use bun_sema::util::SharedSort;

use super::declines::write_limit;
use super::format::{lower_camel_case, write_count};
use super::positions::{
    PathStyle, Positions, is_listed_site, resolve_ascending, write_shown_position,
};
use super::wording::{ESCAPE_REASONS, heap_cause_sentence};
use super::{ReportEntry, ReportInput};
use crate::diagnostics::SourcePosition;
use crate::engine::{AllocationRemarkRecord, Position, position_of};
use crate::ir::generated::{AllocationEscapeReason, AllocationOutcome};
use crate::link::ProgramNames;

fn forcing_operation_name<'o>(
    record: &AllocationRemarkRecord,
    operation: &'o [u8],
) -> Option<&'o [u8]> {
    if !operation.is_empty() {
        Some(operation)
    } else if record.reasons.contains(AllocationEscapeReason::RETURNED) {
        Some(b"Return")
    } else if record.reasons.contains(AllocationEscapeReason::THROWN) {
        Some(b"Throw")
    } else {
        None
    }
}

fn write_heap_outcome(out: &mut Vec<u8>, record: &AllocationRemarkRecord, operation: &[u8]) {
    if record.copies <= 1 {
        out.extend_from_slice(b"heap");
    } else {
        out.extend_from_slice(b"allocated at ");
        write_count(out, u64::from(record.copies));
        out.extend_from_slice(b" sites");
    }
    if let Some(name) = forcing_operation_name(record, operation) {
        out.extend_from_slice(b": ");
        out.extend_from_slice(name);
    }
}

fn write_outcome(out: &mut Vec<u8>, record: &AllocationRemarkRecord, operation: &[u8]) {
    match record.outcome {
        AllocationOutcome::Unknown => out.extend_from_slice(b"unknown"),
        AllocationOutcome::Removed => out.extend_from_slice(b"removed"),
        AllocationOutcome::Heap => write_heap_outcome(out, record, operation),
        AllocationOutcome::Frame => out.extend_from_slice(b"stack"),
        AllocationOutcome::FrameUntilMaterialized => {
            out.extend_from_slice(b"stack, moved to the heap if it escapes");
        }
        AllocationOutcome::Slim => out.extend_from_slice(b"closure without a function object"),
        AllocationOutcome::Deferred => out.extend_from_slice(b"created lazily"),
    }
}

pub(super) fn write_reasons(out: &mut Vec<u8>, reasons: AllocationEscapeReason) {
    let mut separator: &[u8] = b"";
    let mut covered = 0u32;
    for (reason, sentence) in ESCAPE_REASONS {
        covered |= reason.0;
        if reasons.contains(reason) {
            out.extend_from_slice(separator);
            out.extend_from_slice(sentence.as_bytes());
            separator = b"; ";
        }
    }
    for bit in 0..u32::BITS {
        if reasons.0 & !covered & (1 << bit) != 0 {
            out.extend_from_slice(separator);
            out.extend_from_slice(b"reason bit ");
            write_count(out, u64::from(bit));
            separator = b"; ";
        }
    }
}

fn write_cause_and_reasons(out: &mut Vec<u8>, record: &AllocationRemarkRecord) {
    let cause = heap_cause_sentence(record.cause);
    if cause.is_none() && record.reasons.is_empty() {
        return;
    }
    out.extend_from_slice(b" (");
    out.extend_from_slice(cause.unwrap_or_default().as_bytes());
    if cause.is_some() && !record.reasons.is_empty() {
        out.extend_from_slice(b": ");
    }
    write_reasons(out, record.reasons);
    out.push(b')');
}

fn write_remark_line(
    out: &mut Vec<u8>,
    record: &AllocationRemarkRecord,
    operation: &[u8],
    location: Option<&SourcePosition>,
    forced_by: Option<&SourcePosition>,
    limit_value: u64,
) {
    out.extend_from_slice(b"allocation: ");
    out.extend_from_slice(&lower_camel_case(record.kind.name()));
    out.extend_from_slice(b" at ");
    write_shown_position(out, location);
    out.extend_from_slice(b": ");
    write_outcome(out, record, operation);
    write_cause_and_reasons(out, record);
    write_limit(out, record.limit, limit_value);
    if let Some(forced_by) = forced_by.filter(|_| forced_by != location) {
        out.extend_from_slice(b", escapes at ");
        write_shown_position(out, Some(forced_by));
    }
}

fn sort_key(record: &AllocationRemarkRecord) -> (bool, Option<Position>) {
    let position = position_of(record.location);
    (position.is_none(), position)
}

fn listed_remarks<'r>(
    records: &'r [AllocationRemarkRecord],
    names: &ProgramNames,
) -> Vec<&'r AllocationRemarkRecord> {
    let mut listed: Vec<&AllocationRemarkRecord> = records
        .iter()
        .filter(|record| is_listed_site(names, record.location, record.function_id()))
        .collect();
    listed.shared_sort_by_key(|record| sort_key(record));
    listed
}

fn remark_entry(
    input: &ReportInput<'_>,
    record: &AllocationRemarkRecord,
    location: Option<&SourcePosition>,
    forced_by: Option<&SourcePosition>,
) -> ReportEntry {
    let operation = input.engine.text(record.forcing_operation);
    let limit_value = input.engine.limit_value(record.limit);

    let mut text = Vec::new();
    write_remark_line(
        &mut text,
        record,
        operation,
        location,
        forced_by,
        limit_value,
    );
    ReportEntry {
        kind: ExplainSet::ALLOCATIONS,
        text,
        position: position_of(record.location),
        notes: Vec::new(),
    }
}

pub(super) fn collect(input: &ReportInput<'_>, out: &mut Vec<ReportEntry>) {
    let records = listed_remarks(input.engine.allocation_remarks(), input.names);
    if records.is_empty() {
        let text = b"allocations: none".to_vec();
        out.push(ReportEntry::line(ExplainSet::ALLOCATIONS, text));
        return;
    }

    let wanted: Vec<Option<Position>> = records
        .iter()
        .flat_map(|record| [record.location, record.forced_by].map(position_of))
        .collect();
    let mut positions = Positions::new(input, PathStyle::Native);
    let resolved = resolve_ascending(&wanted, |position| positions.resolve(position));
    for (record, shown) in records.iter().zip(resolved.as_chunks::<2>().0) {
        out.push(remark_entry(
            input,
            record,
            shown[0].as_ref(),
            shown[1].as_ref(),
        ));
    }
}
