use super::*;
use crate::diagnostic_codes::Code;
use crate::ir::generated::{LimitId, TypeSiteKind, UserDiagnosticKind};

const BUG_REPORT_REQUEST: &str = "this is a bug in Bun";
const EXPLAIN_PAGE: &str = include_str!("../../../../docs/bundler/aot-explain.mdx");
const BANNED: &[&str] = &[
    "admit",
    "unseen",
    "refuse",
    "refusal",
    "dearer",
    " road",
    "leaves its slot",
    "made at run time",
    "text at run time",
    "evaluates text",
    "evaluating text",
    " stands",
    "the very ",
    "goes on",
    " go on",
    "at once",
    "work it out",
    "works it out",
    "works them out",
    "all the same",
    "counts on",
    "brings in",
    "bring in",
    " given",
    "retain",
    "it protects",
    "predicted",
    "written type",
    "type is written",
    "that you wrote",
    "claim",
    "decline",
    "closed program",
    "open program",
];

type ReasonSentence = fn(u32) -> Option<&'static str>;

fn starts_in_lower_case(text: &str) -> bool {
    text.starts_with(|first: char| first.is_ascii_lowercase())
}

fn is_sentence(text: &str) -> bool {
    text.starts_with(|first: char| first.is_ascii_uppercase()) && text.ends_with('.')
}

fn is_clause(text: &str) -> bool {
    starts_in_lower_case(text) && !text.ends_with('.')
}

fn is_kebab_case(code: &str) -> bool {
    let is_letter_or_digit = |byte: u8| byte.is_ascii_lowercase() || byte.is_ascii_digit();
    let is_word = |word: &str| !word.is_empty() && word.bytes().all(is_letter_or_digit);
    code.split('-').all(is_word)
}

fn assert_distinct(texts: &[&str]) {
    for (index, text) in texts.iter().enumerate() {
        assert!(!texts[..index].contains(text), "{text}");
    }
}

fn assert_distinct_codes(codes: &[&str]) {
    for code in codes {
        assert!(is_kebab_case(code), "{code}");
    }
    assert_distinct(codes);
}

fn banned_phrase_in(text: &str) -> Option<&'static str> {
    let lower_case = text.to_lowercase();
    let mut phrases = BANNED.iter().copied();
    phrases.find(|phrase| lower_case.contains(phrase))
}

fn assert_plain(text: &str) {
    assert_eq!(banned_phrase_in(text), None, "{text}");
}

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

fn report_wordings() -> Vec<&'static str> {
    let mut texts = Vec::new();
    for cause in UnprovenCause::ALL {
        let CauseWording { message, fix } = cause_wording(cause);
        texts.extend([cause_code(cause), message, fix]);
    }
    for cause in CheckCause::ALL {
        let CheckWording {
            counted_as,
            headline,
            fix,
        } = check_wording(cause);
        texts.extend([guard_cause_code(cause), counted_as, headline, fix]);
    }
    for IllTypedWording { code, message, fix } in ill_typed_wordings() {
        texts.extend([code, message, fix]);
    }
    for kind in DeclineKind::ALL {
        texts.extend([missed_optimization_code(kind), decline_sentence(kind)]);
    }
    let reason_sentences: [(usize, ReasonSentence); 7] = [
        (
            TypedResultDeclineReason::COUNT,
            typed_result_decline_sentence,
        ),
        (CallDeclineReason::COUNT, call_decline_sentence),
        (
            GeneratorFusionDeclineReason::COUNT,
            generator_fusion_decline_sentence,
        ),
        (ArrayChainDeclineReason::COUNT, array_chain_decline_sentence),
        (
            StringBuilderDeclineReason::COUNT,
            string_builder_decline_sentence,
        ),
        (LoopDeclineReason::COUNT, loop_decline_sentence),
        (InterpretedCause::COUNT, interpreted_cause_sentence),
    ];
    for (member_count, sentence_of) in reason_sentences {
        texts.extend((0..member_count as u32).filter_map(sentence_of));
    }
    let heap_causes = AllocationHeapCause::ALL.into_iter();
    texts.extend(heap_causes.filter_map(heap_cause_sentence));
    for cause in UnseenCodeCause::ALL {
        texts.extend([trim_blocker_code(cause), unseen_code_sentence(cause)]);
    }
    texts.extend(KnowledgeLevel::ALL.map(level_label));
    for column in AccessColumn::ALL {
        texts.extend([column_label(column), column_description(column)]);
    }
    texts.extend(ESCAPE_REASONS.map(|(_, sentence)| sentence));
    texts
}

#[test]
fn cause_messages_are_sentences() {
    for cause in UnprovenCause::ALL {
        let CauseWording { message, fix } = cause_wording(cause);
        assert!(is_sentence(message), "{cause:?}");
        assert!(starts_in_lower_case(fix), "{cause:?}");
        assert!(fix.ends_with('.'), "{cause:?}");
    }
}

#[test]
fn cause_wordings_differ() {
    assert_distinct(&UnprovenCause::ALL.map(|cause| cause_wording(cause).message));
    assert_distinct(&UnprovenCause::ALL.map(|cause| cause_wording(cause).fix));
}

#[test]
fn check_wordings_are_clauses() {
    for cause in CheckCause::ALL {
        let wording = check_wording(cause);
        assert!(is_clause(wording.counted_as), "{cause:?}");
        assert!(is_clause(wording.headline), "{cause:?}");
        assert!(is_clause(wording.fix), "{cause:?}");
    }
}

#[test]
fn check_wordings_differ() {
    assert_distinct(&CheckCause::ALL.map(|cause| check_wording(cause).counted_as));
    assert_distinct(&CheckCause::ALL.map(|cause| check_wording(cause).headline));
    assert_distinct(&CheckCause::ALL.map(|cause| check_wording(cause).fix));
}

#[test]
fn each_ill_typed_cause_but_none_has_wording() {
    for cause in IllTypedCause::ALL {
        let wording = ill_typed_cause_wording(cause);
        assert_eq!(wording.is_none(), cause == IllTypedCause::None, "{cause:?}");
    }
}

#[test]
fn ill_typed_messages_are_sentences() {
    for IllTypedWording { code, message, fix } in ill_typed_wordings() {
        assert!(is_sentence(message), "{code}");
        assert!(starts_in_lower_case(fix), "{code}");
        assert!(fix.ends_with('.'), "{code}");
    }
}

#[test]
fn ill_typed_wordings_differ() {
    let wordings = ill_typed_wordings();
    let messages: Vec<&str> = wordings.iter().map(|wording| wording.message).collect();
    let fixes: Vec<&str> = wordings.iter().map(|wording| wording.fix).collect();
    assert_distinct(&messages);
    assert_distinct(&fixes);
}

#[test]
fn only_unknown_causes_ask_for_bug_report() {
    for cause in UnprovenCause::ALL {
        let asks = cause_wording(cause).fix.starts_with(BUG_REPORT_REQUEST);
        assert_eq!(asks, cause == UnprovenCause::Unknown, "{cause:?}");
    }
    for cause in CheckCause::ALL {
        let asks = check_wording(cause).fix.starts_with(BUG_REPORT_REQUEST);
        assert_eq!(asks, cause == CheckCause::Unknown, "{cause:?}");
    }
    for cause in IllTypedCause::ALL {
        let wording = ill_typed_cause_wording(cause);
        let asks = wording.is_some_and(|wording| wording.fix.starts_with(BUG_REPORT_REQUEST));
        assert_eq!(asks, cause == IllTypedCause::Unclassified, "{cause:?}");
    }
}

#[test]
fn decline_sentences_are_distinct_clauses() {
    let sentences = DeclineKind::ALL.map(decline_sentence);
    for (kind, sentence) in DeclineKind::ALL.into_iter().zip(sentences) {
        assert!(is_clause(sentence), "{kind:?}");
    }
    assert_distinct(&sentences);
}

fn assert_each_reason_has_sentence(
    member_count: usize,
    none: Option<u32>,
    sentence_of: ReasonSentence,
) {
    let mut sentences = Vec::new();
    for reason in 0..member_count as u32 {
        let sentence = sentence_of(reason);
        assert_eq!(sentence.is_none(), none == Some(reason), "{reason}");
        sentences.extend(sentence);
    }
    for sentence in &sentences {
        assert!(is_clause(sentence), "{sentence}");
    }
    assert_distinct(&sentences);

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
    let mut sentences = Vec::new();
    for cause in AllocationHeapCause::ALL {
        let sentence = heap_cause_sentence(cause);
        assert_eq!(
            sentence.is_none(),
            cause == AllocationHeapCause::None,
            "{cause:?}"
        );
        sentences.extend(sentence);
    }
    assert!(sentences.iter().all(|sentence| is_clause(sentence)));
    assert_distinct(&sentences);
}

#[test]
fn each_interpreted_cause_has_sentence() {
    let mut sentences = Vec::new();
    for cause in InterpretedCause::ALL {
        let sentence = interpreted_cause_sentence(cause.to_wire());
        assert_eq!(
            sentence.is_none(),
            cause == InterpretedCause::None,
            "{cause:?}"
        );
        sentences.extend(sentence);
    }
    assert!(sentences.iter().all(|sentence| is_clause(sentence)));
    assert_distinct(&sentences);
}

#[test]
fn undeclared_interpreted_cause_has_no_sentence() {
    assert_eq!(
        interpreted_cause_sentence(InterpretedCause::COUNT as u32),
        None
    );
    assert_eq!(interpreted_cause_sentence(u32::MAX), None);
}

#[test]
fn unseen_code_sentences_are_distinct_clauses() {
    let sentences = UnseenCodeCause::ALL.map(unseen_code_sentence);
    for (cause, sentence) in UnseenCodeCause::ALL.into_iter().zip(sentences) {
        assert!(is_clause(sentence), "{cause:?}");
    }
    assert_distinct(&causes_told_apart().map(unseen_code_sentence));
}

// Whether a dynamic path may find code on disk hangs on the build. What the program does is the same, and so is what its author reads.
fn causes_told_apart() -> [UnseenCodeCause; UnseenCodeCause::ALL.len() - 1] {
    let by_name = UnseenCodeCause::LoadsModuleByName;
    let code_by_name = UnseenCodeCause::LoadsCodeByName;
    assert_eq!(
        unseen_code_sentence(code_by_name),
        unseen_code_sentence(by_name)
    );
    assert_eq!(trim_blocker_code(code_by_name), trim_blocker_code(by_name));
    let mut others = UnseenCodeCause::ALL
        .into_iter()
        .filter(|&cause| cause != code_by_name);
    core::array::from_fn(|_| others.next().expect("one cause fewer"))
}

#[test]
fn level_labels_are_proven_guarded_unknown() {
    assert_eq!(KnowledgeLevel::COUNT, 3);
    assert_eq!(level_label(KnowledgeLevel::Proven), "proven");
    assert_eq!(level_label(KnowledgeLevel::Expected), "guarded");
    assert_eq!(level_label(KnowledgeLevel::Unknown), "unknown");
}

#[test]
fn column_labels_are_free_tested_by_name() {
    assert_eq!(
        AccessColumn::ALL.map(column_label),
        ["free", "tested", "by name"]
    );
    assert_eq!(
        AccessColumn::ALL.map(column_key),
        ["free", "tested", "byName"]
    );
}

#[test]
fn column_descriptions_are_distinct_clauses() {
    let descriptions = AccessColumn::ALL.map(column_description);
    for (column, description) in AccessColumn::ALL.into_iter().zip(descriptions) {
        assert!(is_clause(description), "{column:?}");
    }
    assert_distinct(&descriptions);
}

#[test]
fn column_descriptions_start_with_label() {
    for column in AccessColumn::ALL {
        let label = format!("{}: ", column_label(column));
        assert!(column_description(column).starts_with(&label), "{column:?}");
    }
}

#[test]
fn escape_reasons_cover_every_bit_in_order() {
    let mut covered = AllocationEscapeReason::default();
    for (bit, (reason, sentence)) in ESCAPE_REASONS.into_iter().enumerate() {
        assert_eq!(reason, AllocationEscapeReason(1 << bit), "{sentence}");
        assert!(is_clause(sentence), "{sentence}");
        covered |= reason;
    }
    assert_eq!(covered, AllocationEscapeReason::ALL);
    assert_distinct(&ESCAPE_REASONS.map(|(_, sentence)| sentence));
}

#[test]
fn codes_are_kebab_case_and_distinct() {
    assert_distinct_codes(&UnprovenCause::ALL.map(cause_code));
    assert_distinct_codes(&CheckCause::ALL.map(guard_cause_code));
    assert_distinct_codes(&DeclineKind::ALL.map(missed_optimization_code));
    assert_distinct_codes(&causes_told_apart().map(trim_blocker_code));
    let wordings = ill_typed_wordings();
    let ill_typed_codes: Vec<&str> = wordings.iter().map(|wording| wording.code).collect();
    assert_distinct_codes(&ill_typed_codes);
}

#[test]
fn codes_do_not_follow_enumerator_names() {
    assert_eq!(
        cause_code(UnprovenCause::ReachesUnknownJavaScript),
        "passed-to-untyped-code"
    );
    assert_eq!(cause_code(UnprovenCause::UnknownBase), "untyped-base");
    assert_eq!(
        cause_code(UnprovenCause::OwnPropertyHidesMember),
        "method-shadowed"
    );
    assert_eq!(
        cause_code(UnprovenCause::LeftByPasses),
        "missed-optimization"
    );
    assert_eq!(guard_cause_code(CheckCause::MayFail), "wrong-type");
    assert_eq!(
        missed_optimization_code(DeclineKind::HotCallNotInlined),
        "not-inlined"
    );
    assert_eq!(trim_blocker_code(UnseenCodeCause::EvaluatesText), "eval");
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

#[test]
fn no_report_wording_uses_a_banned_phrase() {
    for text in report_wordings() {
        assert_plain(text);
    }
}

#[test]
fn no_diagnostic_uses_a_banned_phrase() {
    for code in Code::ALL {
        assert_plain(code.template());
    }
    for kind in UserDiagnosticKind::ALL {
        assert_plain(kind.message());
    }
    for limit in LimitId::ALL {
        assert_plain(limit.purpose());
    }
    for kind in TypeSiteKind::ALL {
        assert_plain(kind.log_word());
    }
}

#[test]
fn banned_phrase_is_found_in_any_case() {
    assert_eq!(
        banned_phrase_in("the callee isn't known at build time"),
        None
    );
    assert_eq!(
        banned_phrase_in("Compile with --Admit=runtime-code"),
        Some("admit")
    );
    assert_eq!(
        banned_phrase_in("The callee is PREDICTED"),
        Some("predicted")
    );
}

#[test]
fn documentation_url_takes_anchor() {
    assert!(DOCUMENTATION_URL.starts_with(b"https://bun.com/docs/"));
    assert!(DOCUMENTATION_URL.ends_with(b"#"));
}
