use bstr::BString;

use super::*;
use crate::engine::testing::ResultRecords;
use crate::ir::generated::{
    ArrayChainDeclineReason, CallDeclineReason, GeneratorFusionDeclineReason, InterpretedCause,
    LoopDeclineReason, StringBuilderDeclineReason, TypedResultDeclineReason,
};
use crate::ir::ids::ABSENT_WORD;
use crate::report::testing::{
    DEPENDENCY, LINE_2_COLUMN_14, NO_LOCATION, PROGRAM, PROGRAM_FUNCTION, RUNTIME,
    RUNTIME_FUNCTION, ReportFixture, at, location, names, witness,
};

const LOWERED_LIMIT_VALUE: u64 = 1204;

fn record(kind: DeclineKind, module: u32, position: u32, count: u32) -> DeclineRecord {
    DeclineRecord {
        kind,
        limit: LimitId::None,
        count,
        reason: 0,
        witness: witness(ABSENT_WORD, location(module, position)),
    }
}

fn record_with_reason(kind: DeclineKind, reason: u32) -> DeclineRecord {
    DeclineRecord {
        reason,
        ..record(kind, PROGRAM, 10, 0)
    }
}

fn report(records: &[DeclineRecord]) -> Vec<(BString, Option<Position>)> {
    let fixture = ReportFixture::new(ResultRecords {
        limit_values: &[(LimitId::MaxThreadedPathCost, LOWERED_LIMIT_VALUE)],
        declines: records,
        ..ResultRecords::default()
    });
    let mut entries = Vec::new();
    fixture.with_input(|input| collect(input, &mut entries));
    let described = entries.into_iter().map(|entry| {
        assert_eq!(entry.kind, ExplainSet::DECLINES);
        assert!(entry.notes.is_empty());
        (BString::from(entry.text), entry.position)
    });
    described.collect()
}

fn merged_times(records: &[DeclineRecord]) -> Vec<(DeclineRecord, u32)> {
    let merged = merge(records);
    merged
        .iter()
        .map(|decline| (*decline.record, decline.times))
        .collect()
}

fn written(write: impl FnOnce(&mut Vec<u8>)) -> BString {
    let mut out = Vec::new();
    write(&mut out);
    BString::from(out)
}

fn decline_line(record: &DeclineRecord, times: u32, function_name: &[u8]) -> BString {
    let position = SourcePosition {
        path: b"a.ts".to_vec(),
        line: 3,
        column: 5,
    };
    let decline = MergedDecline { record, times };
    written(|out| {
        write_decline_line(
            out,
            &decline,
            Some(&position),
            function_name,
            LOWERED_LIMIT_VALUE,
        );
    })
}

#[test]
fn merge_counts_records_at_one_location() {
    let decline = record(DeclineKind::LoopNotVersioned, PROGRAM, 10, 2);
    assert_eq!(merged_times(&[decline; 3]), [(decline, 3)]);
}

#[test]
fn merge_joins_nonadjacent_records() {
    let first = record(DeclineKind::LoopNotVersioned, PROGRAM, 10, 0);
    let second = record(DeclineKind::LoopNotVersioned, PROGRAM, 4, 0);
    assert_eq!(
        merged_times(&[first, second, first]),
        [(second, 1), (first, 2)]
    );
}

#[test]
fn merge_separates_kinds_at_one_location() {
    let not_versioned = record(DeclineKind::LoopNotVersioned, PROGRAM, 10, 0);
    let not_inlined = record(DeclineKind::HotCallNotInlined, PROGRAM, 10, 0);
    assert_eq!(
        merged_times(&[not_versioned, not_inlined]),
        [(not_inlined, 1), (not_versioned, 1)]
    );
}

#[test]
fn merge_never_sums_counts() {
    let larger = record(DeclineKind::HotCallNotInlined, PROGRAM, 10, 3);
    let smaller = record(DeclineKind::HotCallNotInlined, PROGRAM, 10, 1);
    assert_eq!(
        merged_times(&[larger, smaller, larger]),
        [(smaller, 1), (larger, 2)]
    );
}

#[test]
fn merge_orders_by_reason_before_count() {
    let kind = DeclineKind::StringBuilderNotCreated;
    let too_few_appends = DeclineRecord {
        count: 1,
        ..record_with_reason(kind, StringBuilderDeclineReason::TooFewAppends.to_wire())
    };
    let two_states_live =
        record_with_reason(kind, StringBuilderDeclineReason::TwoStatesLive.to_wire());
    assert_eq!(
        merged_times(&[two_states_live, too_few_appends]),
        [(too_few_appends, 1), (two_states_live, 1)]
    );
}

#[test]
fn merge_separates_limits_at_one_location() {
    let without_limit = record(DeclineKind::HotCallNotInlined, PROGRAM, 10, 0);
    let with_limit = DeclineRecord {
        limit: LimitId::MaxInlineDepth,
        ..without_limit
    };
    assert_eq!(
        merged_times(&[with_limit, without_limit]),
        [(without_limit, 1), (with_limit, 1)]
    );
}

#[test]
fn merge_separates_positions() {
    let records = [
        record(DeclineKind::Unknown, PROGRAM, 11, 0),
        record(DeclineKind::Unknown, RUNTIME, 0, 0),
        record(DeclineKind::Unknown, PROGRAM, 10, 0),
    ];
    assert_eq!(
        merged_times(&records),
        [(records[2], 1), (records[0], 1), (records[1], 1)]
    );
}

#[test]
fn merge_sorts_absent_module_last() {
    let unlocated = record(DeclineKind::Unknown, ABSENT_WORD, 0, 0);
    let located = record(DeclineKind::StretchNotGuarded, 7, 99, 0);
    assert_eq!(
        merged_times(&[unlocated, located]),
        [(located, 1), (unlocated, 1)]
    );
}

#[test]
fn merge_separates_absent_locations() {
    let unlocated = record(DeclineKind::LoopNotVersioned, ABSENT_WORD, 0, 0);
    assert_eq!(merged_times(&[unlocated; 2]), [(unlocated, 1); 2]);
}

#[test]
fn runtime_declines_are_not_listed() {
    let names = names();
    let unlocated = record(DeclineKind::LoopNotVersioned, ABSENT_WORD, 0, 0);
    let unlocated_in_runtime = DeclineRecord {
        witness: witness(RUNTIME_FUNCTION, NO_LOCATION),
        ..unlocated
    };
    assert!(is_listed(
        &record(DeclineKind::LoopNotVersioned, PROGRAM, 0, 0),
        &names
    ));
    assert!(!is_listed(
        &record(DeclineKind::LoopNotVersioned, RUNTIME, 0, 0),
        &names
    ));
    assert!(is_listed(&unlocated, &names));
    assert!(!is_listed(&unlocated_in_runtime, &names));
}

#[test]
fn kind_total_has_count_code_and_sentence() {
    let entry = kind_total_entry(DeclineKind::HotCallNotInlined, 1204);
    assert_eq!(entry.kind, ExplainSet::DECLINES);
    assert_eq!(
        BString::from(entry.text),
        "missed optimizations: 1,204 not-inlined: a hot call was not inlined"
    );
    assert_eq!(entry.position, None);
    assert!(entry.notes.is_empty());
}

#[test]
fn limit_clause_has_name_and_build_value() {
    let limit = LimitId::MaxInlineDepth;
    assert_eq!(
        written(|out| write_limit(out, limit, LOWERED_LIMIT_VALUE)),
        format!(
            ", limit MaxInlineDepth = 1,204 (limits {})",
            limit.purpose()
        )
    );
}

#[test]
fn absent_limit_has_no_clause() {
    assert_eq!(written(|out| write_limit(out, LimitId::None, 0)), "");
}

#[test]
fn decline_line_has_every_clause() {
    let limit = LimitId::MaxThreadedPathCost;
    let record = DeclineRecord {
        limit,
        reason: LoopDeclineReason::LimitReached.to_wire(),
        ..record(DeclineKind::LoopNotVersioned, PROGRAM, 10, 2000)
    };
    let limit_clause = written(|out| write_limit(out, limit, LOWERED_LIMIT_VALUE));
    let line = "missed: loop-guards-not-hoisted at a.ts:3:5 in load, 3 times, the loop exceeds a compiler limit, count 2,000";
    assert_eq!(
        decline_line(&record, 3, b"load"),
        format!("{line}{limit_clause}")
    );
}

#[test]
fn decline_line_omits_absent_clauses() {
    let record = record(DeclineKind::LoopNotVersioned, PROGRAM, 10, 0);
    assert_eq!(
        decline_line(&record, 1, b""),
        "missed: loop-guards-not-hoisted at a.ts:3:5"
    );
}

#[test]
fn decline_line_without_location() {
    let record = record(DeclineKind::LoopNotVersioned, ABSENT_WORD, 0, 0);
    let decline = MergedDecline {
        record: &record,
        times: 1,
    };
    assert_eq!(
        written(|out| write_decline_line(out, &decline, None, b"run", 0)),
        "missed: loop-guards-not-hoisted at (no location) in run"
    );
}

#[test]
fn kind_selects_enum_of_reason() {
    let expected = [
        (
            DeclineKind::HotCallNotResolved,
            CallDeclineReason::CalleeNotCallable.to_wire(),
            "none of the possible callees can be called this way",
        ),
        (
            DeclineKind::GeneratorLoopNotFused,
            GeneratorFusionDeclineReason::BodyIsNotDescribed.to_wire(),
            "the generator function's body isn't visible here",
        ),
        (
            DeclineKind::ArrayChainNotFused,
            ArrayChainDeclineReason::SourceIsNotPristine.to_wire(),
            "the first array may have holes, or its methods may have been overridden",
        ),
        (
            DeclineKind::StringBuilderNotCreated,
            StringBuilderDeclineReason::TooFewAppends.to_wire(),
            "too few appends for a string builder to be worth it",
        ),
        (
            DeclineKind::TypedResultNotSelected,
            TypedResultDeclineReason::TargetIsNotModeledByFlow.to_wire(),
            "the declared type only becomes visible after inlining, or it reaches more object and array types than one call handles",
        ),
        (
            DeclineKind::LoopNotVersioned,
            LoopDeclineReason::SeveralEntries.to_wire(),
            "the loop has more than one entry",
        ),
        (
            DeclineKind::LoopBoundNotClamped,
            LoopDeclineReason::SeveralEntries.to_wire(),
            "the loop has more than one entry",
        ),
    ];
    for (kind, reason, sentence) in expected {
        assert_eq!(reason, 2, "{kind:?}");
        let record = record_with_reason(kind, reason);
        assert_eq!(reason_of(&record), Reason::Sentence(sentence), "{kind:?}");
    }
}

#[test]
fn reason_and_count_have_separate_clauses() {
    let record = DeclineRecord {
        count: 3,
        ..record_with_reason(
            DeclineKind::StringBuilderNotCreated,
            StringBuilderDeclineReason::TooFewAppends.to_wire(),
        )
    };
    assert_eq!(
        decline_line(&record, 1, b""),
        "missed: no-string-builder at a.ts:3:5, too few appends for a string builder to be worth it, 3 appends"
    );
}

#[test]
fn count_has_unit_of_kind() {
    let line = |kind, count| decline_line(&record(kind, PROGRAM, 10, count), 1, b"");
    assert_eq!(
        line(DeclineKind::HotCallNotInlined, 2000),
        "missed: not-inlined at a.ts:3:5, 2,000 bytes over the inlining budget"
    );
    assert_eq!(
        line(DeclineKind::HotCallNotInlined, 1),
        "missed: not-inlined at a.ts:3:5, 1 byte over the inlining budget"
    );
    assert_eq!(
        line(DeclineKind::StretchNotGuarded, 2),
        "missed: no-fast-path at a.ts:3:5, count 2"
    );
    assert_eq!(
        line(DeclineKind::GenericVersionNotCreated, 2),
        "missed: guarded-at-every-use at a.ts:3:5, 2 checks"
    );
    assert_eq!(
        line(DeclineKind::GenericVersionNotCreated, 1),
        "missed: guarded-at-every-use at a.ts:3:5, 1 check"
    );
}

#[test]
fn function_without_generic_version_has_no_reason() {
    for reason in [0, 2] {
        let record = record_with_reason(DeclineKind::GenericVersionNotCreated, reason);
        assert_eq!(reason_of(&record), Reason::Absent, "{reason}");
    }
}

#[test]
fn count_is_not_read_as_reason() {
    let count = TypedResultDeclineReason::NoTarget.to_wire();
    let record = record(DeclineKind::TypedResultNotSelected, PROGRAM, 10, count);
    assert_eq!(reason_of(&record), Reason::Absent);
    assert_eq!(
        decline_line(&record, 1, b""),
        "missed: boxed-result at a.ts:3:5, count 1"
    );
}

#[test]
fn reason_of_allocation_is_flag_word() {
    let reasons = AllocationEscapeReason::RETURNED | AllocationEscapeReason::RETAINED_BY_CALLEE;
    let record = record_with_reason(DeclineKind::AllocationNotSunk, reasons.0);
    assert_eq!(reason_of(&record), Reason::Escape(reasons));
    assert_eq!(
        decline_line(&record, 1, b""),
        "missed: heap-allocation at a.ts:3:5, it is returned; a callee keeps a reference to it"
    );
    assert_eq!(
        decline_line(
            &record_with_reason(DeclineKind::AllocationNotSunk, 0),
            1,
            b""
        ),
        "missed: heap-allocation at a.ts:3:5"
    );
}

#[test]
fn reason_of_interpreted_node_is_cause() {
    let line = |kind, reason| {
        let record = DeclineRecord {
            reason,
            ..record(kind, PROGRAM, 10, 0)
        };
        decline_line(&record, 1, b"")
    };
    let never_parsed = InterpretedCause::LayoutIsNotModeled.to_wire();
    assert_eq!(
        line(DeclineKind::ResultNodeInterpreted, never_parsed),
        "missed: generic-parser at a.ts:3:5, no call in the program parses this type"
    );
    assert_eq!(
        line(
            DeclineKind::ResultNodeInterpreted,
            InterpretedCause::None.to_wire()
        ),
        "missed: generic-parser at a.ts:3:5"
    );
    assert_eq!(
        line(DeclineKind::StretchNotGuarded, never_parsed),
        "missed: no-fast-path at a.ts:3:5"
    );
}

#[test]
fn merge_separates_reasons_at_one_location() {
    let with_reason = |cause: InterpretedCause| DeclineRecord {
        reason: cause.to_wire(),
        ..record(DeclineKind::ResultNodeInterpreted, PROGRAM, 10, 0)
    };
    let recursion = with_reason(InterpretedCause::RepeatedRecursion);
    let never_parsed = with_reason(InterpretedCause::LayoutIsNotModeled);
    assert_eq!(
        merged_times(&[never_parsed, recursion, never_parsed]),
        [(recursion, 1), (never_parsed, 2)]
    );
}

#[test]
fn typed_result_without_reason_has_no_sentence() {
    let line = |reason| {
        decline_line(
            &record_with_reason(DeclineKind::TypedResultNotSelected, reason),
            1,
            b"",
        )
    };
    let without_reason = "missed: boxed-result at a.ts:3:5";
    assert_eq!(
        line(TypedResultDeclineReason::None.to_wire()),
        without_reason
    );
    assert_eq!(line(TypedResultDeclineReason::COUNT as u32), without_reason);
}

#[test]
fn build_without_listed_decline_says_none() {
    let none = [(BString::from("missed optimizations: none"), None)];
    assert_eq!(report(&[]), none);
    assert_eq!(
        report(&[record(DeclineKind::LoopNotVersioned, RUNTIME, 0, 0)]),
        none
    );
}

#[test]
fn report_lists_totals_by_kind_then_declines_by_position() {
    let limit = LimitId::MaxThreadedPathCost;
    let not_versioned = DeclineRecord {
        limit,
        witness: witness(PROGRAM_FUNCTION, location(PROGRAM, LINE_2_COLUMN_14)),
        ..record(DeclineKind::LoopNotVersioned, PROGRAM, 0, 0)
    };
    let records = [
        record(DeclineKind::HotCallNotInlined, RUNTIME, 0, 0),
        record(DeclineKind::HotCallNotInlined, DEPENDENCY, 0, 0),
        not_versioned,
        not_versioned,
    ];
    let limit_clause = written(|out| write_limit(out, limit, LOWERED_LIMIT_VALUE));
    let not_versioned_line = "missed: loop-guards-not-hoisted at src/a.ts:2:14 in double, 2 times";
    let expected = [
        (
            "missed optimizations: 1 not-inlined: a hot call was not inlined".to_owned(),
            None,
        ),
        (
            format!(
                "missed optimizations: 2 loop-guards-not-hoisted: {}",
                decline_sentence(DeclineKind::LoopNotVersioned)
            ),
            None,
        ),
        (
            format!("{not_versioned_line}{limit_clause}"),
            at(PROGRAM, LINE_2_COLUMN_14),
        ),
        (
            "missed: not-inlined at node_modules/b/b.js:1:1".to_owned(),
            at(DEPENDENCY, 0),
        ),
    ];
    assert_eq!(
        report(&records),
        expected.map(|(text, position)| (BString::from(text), position))
    );
}
