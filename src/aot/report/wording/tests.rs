use super::*;

const EXPLAIN_PAGE: &str = include_str!("../../../../docs/compiler/explain.mdx");

type ReasonSentence = fn(u32) -> Option<&'static str>;

fn assert_has_heading(code: &str) {
    let heading = format!("### {code}");
    assert!(
        EXPLAIN_PAGE.lines().any(|line| line == heading),
        "{heading}"
    );
}

fn ill_typed_wordings() -> Vec<IllTypedWording> {
    IllTypedCause::ALL
        .into_iter()
        .filter_map(ill_typed_cause_wording)
        .collect()
}

#[test]
fn each_ill_typed_cause_but_none_has_wording() {
    for cause in IllTypedCause::ALL {
        let wording = ill_typed_cause_wording(cause);
        assert_eq!(wording.is_none(), cause == IllTypedCause::None, "{cause:?}");
    }
}

fn assert_each_reason_has_sentence(
    member_count: usize,
    none: Option<u32>,
    sentence_of: ReasonSentence,
) {
    for reason in 0..member_count as u32 {
        let sentence = sentence_of(reason);
        assert_eq!(sentence.is_none(), none == Some(reason), "{reason}");
    }
    assert_eq!(sentence_of(member_count as u32), None);
    assert_eq!(sentence_of(u32::MAX), None);
}

#[test]
fn each_decline_reason_but_none_has_sentence() {
    assert_each_reason_has_sentence(
        TypedResultDeclineReason::COUNT,
        Some(TypedResultDeclineReason::None.to_wire()),
        typed_result_decline_sentence,
    );
    assert_each_reason_has_sentence(
        CallDeclineReason::COUNT,
        Some(CallDeclineReason::None.to_wire()),
        call_decline_sentence,
    );
    assert_each_reason_has_sentence(
        GeneratorFusionDeclineReason::COUNT,
        Some(GeneratorFusionDeclineReason::None.to_wire()),
        generator_fusion_decline_sentence,
    );
    assert_each_reason_has_sentence(
        ArrayChainDeclineReason::COUNT,
        Some(ArrayChainDeclineReason::None.to_wire()),
        array_chain_decline_sentence,
    );
    assert_each_reason_has_sentence(
        StringBuilderDeclineReason::COUNT,
        None,
        string_builder_decline_sentence,
    );
    assert_each_reason_has_sentence(
        LoopDeclineReason::COUNT,
        Some(LoopDeclineReason::None.to_wire()),
        loop_decline_sentence,
    );
}

#[test]
fn each_heap_cause_but_none_has_sentence() {
    for cause in AllocationHeapCause::ALL {
        let sentence = heap_cause_sentence(cause);
        assert_eq!(
            sentence.is_none(),
            cause == AllocationHeapCause::None,
            "{cause:?}"
        );
    }
}

#[test]
fn each_interpreted_cause_but_none_has_sentence() {
    assert_each_reason_has_sentence(
        InterpretedCause::COUNT,
        Some(InterpretedCause::None.to_wire()),
        interpreted_cause_sentence,
    );
}

#[test]
fn escape_reasons_cover_every_bit_in_order() {
    let mut covered = AllocationEscapeReason::default();
    for (bit, (reason, sentence)) in ESCAPE_REASONS.into_iter().enumerate() {
        assert_eq!(reason, AllocationEscapeReason(1 << bit), "{sentence}");
        covered |= reason;
    }
    assert_eq!(covered, AllocationEscapeReason::ALL);
}

#[test]
fn every_cause_code_has_a_heading_in_the_docs() {
    for cause in UnprovenCause::ALL {
        assert_has_heading(cause_code(cause));
    }
    for wording in ill_typed_wordings() {
        assert_has_heading(wording.code);
    }
}
