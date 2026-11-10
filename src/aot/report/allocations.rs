use bun_options_types::aot_options::ExplainSet;
use bun_sema::util::SharedSort;

use super::format::{lower_camel_case, write_count, write_parts};
use super::names::Names;
use super::positions::{
    PathStyle, Positions, is_listed_site, resolve_ascending, write_shown_position,
};
use super::wording::{ESCAPE_REASONS, heap_cause_sentence};
use super::{ReportEntry, ReportInput};
use crate::diagnostics::SourcePosition;
use crate::engine::{AllocationRemarkRecord, Position, position_of};
use crate::ir::generated::{AllocationEscapeReason, AllocationOutcome};

fn write_heap_outcome(out: &mut Vec<u8>, record: &AllocationRemarkRecord, operation: &[u8]) {
    out.extend_from_slice(b"heap");
    if record.copies > 1 {
        out.extend_from_slice(b" in ");
        write_count(out, u64::from(record.copies));
        out.extend_from_slice(b" copies");
    }
    if !operation.is_empty() {
        write_parts(out, &[b": ", operation]);
    } else if record.reasons.contains(AllocationEscapeReason::RETURNED) {
        out.extend_from_slice(b": Return");
    } else if record.reasons.contains(AllocationEscapeReason::THROWN) {
        out.extend_from_slice(b": Throw");
    }
}

fn write_outcome(out: &mut Vec<u8>, record: &AllocationRemarkRecord, operation: &[u8]) {
    match record.outcome {
        AllocationOutcome::Unknown => out.extend_from_slice(b"unknown"),
        AllocationOutcome::Removed => out.extend_from_slice(b"removed"),
        AllocationOutcome::Heap => write_heap_outcome(out, record, operation),
    }
}

pub(super) fn write_reasons(out: &mut Vec<u8>, reasons: AllocationEscapeReason) {
    let mut separator: &[u8] = b"";
    let mut covered = 0u32;
    for (reason, sentence) in ESCAPE_REASONS {
        covered |= reason.0;
        if reasons.contains(reason) {
            write_parts(out, &[separator, sentence.as_bytes()]);
            separator = b"; ";
        }
    }
    for bit in 0..u32::BITS {
        if reasons.0 & !covered & (1 << bit) != 0 {
            write_parts(out, &[separator, b"reason bit "]);
            write_count(out, u64::from(bit));
            separator = b"; ";
        }
    }
}

fn write_remark_line(
    out: &mut Vec<u8>,
    record: &AllocationRemarkRecord,
    operation: &[u8],
    location: Option<&SourcePosition>,
    forced_by: Option<&SourcePosition>,
) {
    let kind = lower_camel_case(record.kind.name());
    write_parts(out, &[b"allocation: ", &kind, b" at "]);
    write_shown_position(out, location);
    out.extend_from_slice(b": ");
    write_outcome(out, record, operation);
    let cause = heap_cause_sentence(record.cause);
    if cause.is_some() || !record.reasons.is_empty() {
        write_parts(out, &[b" (", cause.unwrap_or_default().as_bytes()]);
        if cause.is_some() && !record.reasons.is_empty() {
            out.extend_from_slice(b": ");
        }
        write_reasons(out, record.reasons);
        out.push(b')');
    }
    if let Some(forced_by) = forced_by.filter(|_| forced_by != location) {
        out.extend_from_slice(b", escapes at ");
        write_shown_position(out, Some(forced_by));
    }
}

fn listed_remarks<'r>(
    records: &'r [AllocationRemarkRecord],
    names: Names<'_>,
) -> Vec<&'r AllocationRemarkRecord> {
    let mut listed: Vec<&AllocationRemarkRecord> = records
        .iter()
        .filter(|record| is_listed_site(names, record.location, record.function_id()))
        .collect();
    listed.shared_sort_by_key(|record| {
        let position = position_of(record.location);
        (position.is_none(), position)
    });
    listed
}

pub(super) fn collect(input: &ReportInput<'_>, out: &mut Vec<ReportEntry>) {
    let records = listed_remarks(input.engine.allocation_remarks(), Names::new(input));
    if records.is_empty() {
        let text = b"allocations: none".to_vec();
        out.push(ReportEntry::line(ExplainSet::ALLOCATIONS, text));
        return;
    }

    let wanted: Vec<Option<Position>> = records
        .iter()
        .flat_map(|record| [record.location, record.forced_by].map(position_of))
        .collect();
    let mut positions = Positions::new(input, PathStyle::Posix);
    let resolved = resolve_ascending(&wanted, |position| positions.resolve(position));
    for (record, shown) in records.iter().zip(resolved.as_chunks::<2>().0) {
        let (location, forced_by) = (shown[0].as_ref(), shown[1].as_ref());
        let operation = input.engine.text(record.forcing_operation);
        let mut text = Vec::new();
        write_remark_line(&mut text, record, operation, location, forced_by);
        let position = position_of(record.location);
        out.push(ReportEntry::at(ExplainSet::ALLOCATIONS, text, position));
    }
}

#[cfg(test)]
mod tests {
    use bstr::BString;

    use super::*;
    use crate::engine::testing::ResultRecords;
    use crate::engine::{SourceLocation, TextRange};
    use crate::ir::generated::{AllocationHeapCause, AllocationKind};
    use crate::ir::ids::ABSENT_WORD;
    use crate::report::testing::{
        DEPENDENCY, LINE_1_COLUMN_5, LINE_2_COLUMN_14, PROGRAM, RUNTIME, ReportFixture,
    };

    const NO_LOCATION: SourceLocation = SourceLocation {
        module: ABSENT_WORD,
        position: 0,
    };
    const NO_REASON: AllocationEscapeReason = AllocationEscapeReason(0);
    const PROGRAM_FUNCTION: u32 = 0;
    const RUNTIME_FUNCTION: u32 = 1;
    const UNNAMED_FUNCTION: u32 = 9;

    fn remark(
        outcome: AllocationOutcome,
        copies: u32,
        reasons: AllocationEscapeReason,
    ) -> AllocationRemarkRecord {
        AllocationRemarkRecord {
            location: NO_LOCATION,
            forced_by: NO_LOCATION,
            outcome,
            copies,
            forcing_operation: TextRange {
                offset: 0,
                length: 0,
            },
            reasons,
            function: ABSENT_WORD,
            kind: AllocationKind::Object,
            cause: AllocationHeapCause::None,
        }
    }

    fn remark_at(module: u32, position: u32) -> AllocationRemarkRecord {
        AllocationRemarkRecord {
            location: SourceLocation { module, position },
            ..remark(AllocationOutcome::Heap, 1, NO_REASON)
        }
    }

    fn remark_in_function(function: u32) -> AllocationRemarkRecord {
        AllocationRemarkRecord {
            function,
            ..remark(AllocationOutcome::Heap, 1, NO_REASON)
        }
    }

    fn shown(line: u32, column: u32) -> SourcePosition {
        SourcePosition {
            path: b"a.ts".to_vec(),
            line,
            column,
        }
    }

    fn outcome_text(record: &AllocationRemarkRecord, operation: &[u8]) -> BString {
        let mut out = Vec::new();
        write_outcome(&mut out, record, operation);
        BString::from(out)
    }

    fn reasons_text(reasons: AllocationEscapeReason) -> BString {
        let mut out = Vec::new();
        write_reasons(&mut out, reasons);
        BString::from(out)
    }

    fn remark_line(
        record: &AllocationRemarkRecord,
        location: Option<&SourcePosition>,
        forced_by: Option<&SourcePosition>,
    ) -> BString {
        let mut out = Vec::new();
        write_remark_line(&mut out, record, b"Call", location, forced_by);
        BString::from(out)
    }

    fn listed(records: &[AllocationRemarkRecord]) -> Vec<&AllocationRemarkRecord> {
        ReportFixture::new(ResultRecords::default())
            .with_input(|input| listed_remarks(records, Names::new(input)))
    }

    fn collected(
        text: &[u8],
        remarks: &[AllocationRemarkRecord],
    ) -> Vec<(BString, Option<Position>)> {
        let records = ResultRecords {
            text,
            allocation_remarks: remarks,
            ..ResultRecords::default()
        };
        let mut entries = Vec::new();
        ReportFixture::new(records).with_input(|input| collect(input, &mut entries));
        entries
            .into_iter()
            .map(|entry| {
                assert_eq!(entry.kind, ExplainSet::ALLOCATIONS);
                (BString::from(entry.text), entry.position)
            })
            .collect()
    }

    #[test]
    fn outcomes() {
        let expected = [
            (AllocationOutcome::Unknown, "unknown"),
            (AllocationOutcome::Removed, "removed"),
            (AllocationOutcome::Heap, "heap"),
        ];
        assert_eq!(expected.map(|(outcome, _)| outcome), AllocationOutcome::ALL);
        for (outcome, text) in expected {
            assert_eq!(outcome_text(&remark(outcome, 1, NO_REASON), b""), text);
        }
    }

    #[test]
    fn heap_with_copies_names_operation() {
        let record = remark(AllocationOutcome::Heap, 2, NO_REASON);
        assert_eq!(outcome_text(&record, b"Call"), "heap in 2 copies: Call");
    }

    #[test]
    fn heap_without_operation_uses_returned_reason() {
        let record = remark(AllocationOutcome::Heap, 1, AllocationEscapeReason::RETURNED);
        assert_eq!(outcome_text(&record, b""), "heap: Return");
    }

    #[test]
    fn heap_without_operation_uses_thrown_reason() {
        let record = remark(AllocationOutcome::Heap, 1, AllocationEscapeReason::THROWN);
        assert_eq!(outcome_text(&record, b""), "heap: Throw");
    }

    #[test]
    fn removed_ignores_operation() {
        let record = remark(
            AllocationOutcome::Removed,
            1,
            AllocationEscapeReason::RETURNED,
        );
        assert_eq!(outcome_text(&record, b"Call"), "removed");
    }

    #[test]
    fn reasons_join_in_table_order() {
        let reasons = AllocationEscapeReason::THROWN | AllocationEscapeReason::RETURNED;
        assert_eq!(reasons_text(reasons), "it is returned; it is thrown");
    }

    #[test]
    fn uncovered_reason_prints_bit() {
        assert_eq!(
            reasons_text(AllocationEscapeReason(1 << 31)),
            "reason bit 31"
        );
    }

    #[test]
    fn remark_line_has_every_clause() {
        let record = AllocationRemarkRecord {
            kind: AllocationKind::Closure,
            ..remark(AllocationOutcome::Heap, 1, AllocationEscapeReason::RETURNED)
        };
        assert_eq!(
            remark_line(&record, Some(&shown(3, 5)), Some(&shown(9, 1))),
            "allocation: closure at a.ts:3:5: heap: Call (it is returned), escapes at a.ts:9:1"
        );
    }

    #[test]
    fn cause_without_reasons_explains_heap() {
        let record = AllocationRemarkRecord {
            cause: AllocationHeapCause::LiveAcrossSuspension,
            ..remark(AllocationOutcome::Heap, 1, NO_REASON)
        };
        let mut out = Vec::new();
        write_remark_line(&mut out, &record, b"", Some(&shown(3, 5)), None);
        assert_eq!(
            BString::from(out),
            "allocation: object at a.ts:3:5: heap (it is live across an await or a yield)"
        );
    }

    #[test]
    fn cause_precedes_reasons() {
        let record = AllocationRemarkRecord {
            cause: AllocationHeapCause::Escapes,
            ..remark(AllocationOutcome::Heap, 1, AllocationEscapeReason::RETURNED)
        };
        assert_eq!(
            remark_line(&record, Some(&shown(3, 5)), None),
            "allocation: object at a.ts:3:5: heap: Call (it can outlive the call that creates it: it is returned)"
        );
    }

    #[test]
    fn remark_line_omits_absent_clauses() {
        let record = remark(AllocationOutcome::Removed, 1, NO_REASON);
        assert_eq!(
            remark_line(&record, Some(&shown(3, 5)), None),
            "allocation: object at a.ts:3:5: removed"
        );
    }

    #[test]
    fn remark_line_omits_forcing_location_equal_to_allocation() {
        let record = remark(AllocationOutcome::Heap, 1, NO_REASON);
        assert_eq!(
            remark_line(&record, Some(&shown(3, 5)), Some(&shown(3, 5))),
            "allocation: object at a.ts:3:5: heap: Call"
        );
    }

    #[test]
    fn remark_line_without_location() {
        let record = remark(AllocationOutcome::Heap, 1, NO_REASON);
        assert_eq!(
            remark_line(&record, None, Some(&shown(9, 1))),
            "allocation: object at (no location): heap: Call, escapes at a.ts:9:1"
        );
    }

    #[test]
    fn runtime_allocations_are_skipped() {
        let records = [
            remark_at(RUNTIME, 4),
            remark_at(DEPENDENCY, 4),
            remark_at(PROGRAM, 4),
        ];
        assert_eq!(listed(&records), [&records[2], &records[1]]);
    }

    #[test]
    fn allocation_without_location_uses_function_module() {
        let records = [
            remark_in_function(RUNTIME_FUNCTION),
            remark_in_function(PROGRAM_FUNCTION),
            remark_in_function(ABSENT_WORD),
            remark_in_function(UNNAMED_FUNCTION),
        ];
        assert_eq!(listed(&records), [&records[1], &records[2], &records[3]]);
    }

    #[test]
    fn remarks_ascend_by_position() {
        let records = [
            remark_in_function(PROGRAM_FUNCTION),
            remark_at(DEPENDENCY, 0),
            remark_at(PROGRAM, 9),
            remark_at(PROGRAM, 2),
        ];
        assert_eq!(
            listed(&records),
            [&records[3], &records[2], &records[1], &records[0]]
        );
    }

    #[test]
    fn report_without_listed_allocations_says_none() {
        assert_eq!(
            collected(b"", &[remark_at(RUNTIME, 0)]),
            [(BString::from("allocations: none"), None)]
        );
    }

    #[test]
    fn each_entry_has_position_of_its_allocation() {
        let in_dependency = remark_at(DEPENDENCY, 0);
        let in_program = AllocationRemarkRecord {
            forced_by: SourceLocation {
                module: PROGRAM,
                position: LINE_2_COLUMN_14,
            },
            forcing_operation: TextRange {
                offset: 1,
                length: 4,
            },
            ..remark_at(PROGRAM, LINE_1_COLUMN_5)
        };
        let expected = [
            (
                "allocation: object at src/a.ts:1:5: heap: Call, escapes at src/a.ts:2:14",
                in_program,
            ),
            (
                "allocation: object at node_modules/b/b.js:1:1: heap",
                in_dependency,
            ),
        ];
        assert_eq!(
            collected(b"-Call", &[in_dependency, in_program]),
            expected.map(|(text, record)| (BString::from(text), position_of(record.location)))
        );
    }
}
