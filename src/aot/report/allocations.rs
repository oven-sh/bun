use bun_options_types::aot_options::ExplainSet;
use bun_sema::util::SharedSort;

use super::declines::write_limit;
use super::format::{lower_camel_case, write_count, write_parts};
use super::positions::{
    PathStyle, Positions, is_listed_site, resolve_ascending, write_shown_position,
};
use super::wording::{ESCAPE_REASONS, heap_cause_sentence};
use super::{ReportEntry, ReportInput};
use crate::diagnostics::SourcePosition;
use crate::engine::{AllocationRemarkRecord, Position, position_of};
use crate::ir::generated::{AllocationEscapeReason, AllocationOutcome};
use crate::link::ProgramNames;

fn write_heap_outcome(out: &mut Vec<u8>, record: &AllocationRemarkRecord, operation: &[u8]) {
    if record.copies <= 1 {
        out.extend_from_slice(b"heap");
    } else {
        out.extend_from_slice(b"allocated at ");
        write_count(out, u64::from(record.copies));
        out.extend_from_slice(b" sites");
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
    limit_value: u64,
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
    write_limit(out, record.limit, limit_value);
    if let Some(forced_by) = forced_by.filter(|_| forced_by != location) {
        out.extend_from_slice(b", escapes at ");
        write_shown_position(out, Some(forced_by));
    }
}

fn listed_remarks<'r>(
    records: &'r [AllocationRemarkRecord],
    names: &ProgramNames,
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
        let (location, forced_by) = (shown[0].as_ref(), shown[1].as_ref());
        let operation = input.engine.text(record.forcing_operation);
        let limit = input.engine.limit_value(record.limit);
        let mut text = Vec::new();
        write_remark_line(&mut text, record, operation, location, forced_by, limit);
        let position = position_of(record.location);
        out.push(ReportEntry::at(ExplainSet::ALLOCATIONS, text, position));
    }
}

#[cfg(test)]
mod tests {
    use bstr::BString;

    use super::*;
    use crate::engine::{SourceLocation, TextRange};
    use crate::ir::generated::{AllocationHeapCause, AllocationKind, LimitId};
    use crate::ir::ids::{ABSENT_WORD, ModuleId};
    use crate::link::ModuleOrigin;

    const NO_LOCATION: SourceLocation = SourceLocation {
        module: ABSENT_WORD,
        position: 0,
    };
    const NO_REASON: AllocationEscapeReason = AllocationEscapeReason(0);

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
            limit: LimitId::None,
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

    fn names() -> ProgramNames {
        let module = |word| Some(ModuleId::from_word(word));
        ProgramNames::from_lists(
            &[(&b"main"[..], module(0)), (&b"request"[..], module(2))],
            &[],
            &[
                (&b"/p/a.ts"[..], ModuleOrigin::Program),
                (&b"/p/node_modules/b/b.js"[..], ModuleOrigin::Dependency),
                (&b"node:http"[..], ModuleOrigin::Runtime),
            ],
        )
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
        write_remark_line(&mut out, record, b"Call", location, forced_by, 1024);
        BString::from(out)
    }

    #[test]
    fn outcomes() {
        let expected = [
            (AllocationOutcome::Unknown, "unknown"),
            (AllocationOutcome::Removed, "removed"),
            (AllocationOutcome::Heap, "heap"),
            (AllocationOutcome::Frame, "stack"),
            (
                AllocationOutcome::FrameUntilMaterialized,
                "stack, moved to the heap if it escapes",
            ),
            (AllocationOutcome::Slim, "closure without a function object"),
            (AllocationOutcome::Deferred, "created lazily"),
        ];
        assert_eq!(expected.map(|(outcome, _)| outcome), AllocationOutcome::ALL);
        for (outcome, text) in expected {
            assert_eq!(outcome_text(&remark(outcome, 1, NO_REASON), b""), text);
        }
    }

    #[test]
    fn heap_with_copies_names_operation() {
        let record = remark(AllocationOutcome::Heap, 2, NO_REASON);
        assert_eq!(outcome_text(&record, b"Call"), "allocated at 2 sites: Call");
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
            kind: AllocationKind::IteratorResult,
            ..remark(
                AllocationOutcome::Heap,
                1,
                AllocationEscapeReason::RETAINED_BY_CALLEE,
            )
        };
        assert_eq!(
            remark_line(&record, Some(&shown(3, 5)), Some(&shown(9, 1))),
            "allocation: iteratorResult at a.ts:3:5: heap: Call (a callee keeps a reference to it), escapes at a.ts:9:1"
        );
    }

    #[test]
    fn cause_without_reasons_explains_heap() {
        let record = AllocationRemarkRecord {
            cause: AllocationHeapCause::SeveralLiveInstances,
            ..remark(AllocationOutcome::Heap, 1, NO_REASON)
        };
        let mut out = Vec::new();
        write_remark_line(&mut out, &record, b"", Some(&shown(3, 5)), None, 0);
        assert_eq!(
            BString::from(out),
            "allocation: object at a.ts:3:5: heap (more than one object created here can be live at the same time)"
        );
    }

    #[test]
    fn cause_precedes_reasons() {
        let record = AllocationRemarkRecord {
            cause: AllocationHeapCause::Escapes,
            ..remark(
                AllocationOutcome::Heap,
                1,
                AllocationEscapeReason::RETAINED_BY_CALLEE,
            )
        };
        assert_eq!(
            remark_line(&record, Some(&shown(3, 5)), None),
            "allocation: object at a.ts:3:5: heap: Call (it can outlive the call that creates it: a callee keeps a reference to it)"
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
        let record = remark(AllocationOutcome::Frame, 1, NO_REASON);
        assert_eq!(
            remark_line(&record, Some(&shown(3, 5)), Some(&shown(3, 5))),
            "allocation: object at a.ts:3:5: stack"
        );
    }

    #[test]
    fn remark_line_without_location() {
        let record = remark(AllocationOutcome::Frame, 1, NO_REASON);
        assert_eq!(
            remark_line(&record, None, Some(&shown(9, 1))),
            "allocation: object at (no location): stack, escapes at a.ts:9:1"
        );
    }

    #[test]
    fn limit_clause_follows_reasons() {
        let limit = LimitId::MaxTypeNodes;
        let record = AllocationRemarkRecord {
            limit,
            ..remark(
                AllocationOutcome::Heap,
                1,
                AllocationEscapeReason::LIMIT_REACHED,
            )
        };
        let expected = format!(
            "allocation: object at a.ts:3:5: heap: Call (escape analysis hit a limit), limit {} = 1,024 (limits {}), escapes at a.ts:9:1",
            limit.name(),
            limit.purpose(),
        );
        assert_eq!(
            remark_line(&record, Some(&shown(3, 5)), Some(&shown(9, 1))),
            expected
        );
    }

    #[test]
    fn runtime_allocations_are_skipped() {
        let records = [remark_at(2, 4), remark_at(1, 4), remark_at(0, 4)];
        assert_eq!(
            listed_remarks(&records, &names()),
            [&records[2], &records[1]]
        );
    }

    #[test]
    fn allocation_without_location_uses_function_module() {
        let records = [
            remark_in_function(1),
            remark_in_function(0),
            remark_in_function(ABSENT_WORD),
            remark_in_function(9),
        ];
        let listed = listed_remarks(&records, &names());
        assert_eq!(listed, [&records[1], &records[2], &records[3]]);
    }

    #[test]
    fn remarks_ascend_by_position() {
        let records = [
            remark_in_function(0),
            remark_at(1, 0),
            remark_at(0, 9),
            remark_at(0, 2),
        ];
        let listed = listed_remarks(&records, &names());
        assert_eq!(listed, [&records[3], &records[2], &records[1], &records[0]]);
    }
}
