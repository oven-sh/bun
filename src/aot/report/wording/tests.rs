use super::*;

const EXPLAIN_PAGE: &str = include_str!("../../../../docs/compiler/explain.mdx");

const CAUSES_WITH_OWN_CLASS: [(UnprovenCause, GuardClass); 5] = [
    (UnprovenCause::Unknown, GuardClass::OtherType),
    (UnprovenCause::ResultDisabled, GuardClass::ProofWithheld),
    (UnprovenCause::UnknownCallee, GuardClass::UnknownCallee),
    (
        UnprovenCause::ResultOfUnknownCallee,
        GuardClass::UnknownCallee,
    ),
    (
        UnprovenCause::UnprovenContents,
        GuardClass::UnprovenContents,
    ),
];

fn assert_has_heading(code: &str) {
    let heading = format!("### {code}");
    assert!(
        EXPLAIN_PAGE.lines().any(|line| line == heading),
        "{heading}"
    );
}

fn assert_all_differ(texts: &[&str]) {
    for (index, text) in texts.iter().enumerate() {
        assert!(!texts[..index].contains(text), "{text}");
    }
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
fn escape_reasons_cover_every_bit_in_order() {
    let mut covered = AllocationEscapeReason::default();
    for (bit, (reason, sentence)) in ESCAPE_REASONS.into_iter().enumerate() {
        assert_eq!(reason, AllocationEscapeReason(1 << bit), "{sentence}");
        covered |= reason;
    }
    assert_eq!(covered, AllocationEscapeReason::ALL);
}

#[test]
fn guard_classes_are_listed_in_numeric_order() {
    for (number, class) in GuardClass::ALL.into_iter().enumerate() {
        assert_eq!(class as usize, number, "{class:?}");
    }
}

#[test]
fn each_guard_class_has_its_own_code_and_wording() {
    assert_all_differ(&GuardClass::ALL.map(guard_cause_code));
    assert_all_differ(&GuardClass::ALL.map(|class| guard_wording(class).counted_as));
    assert_all_differ(&GuardClass::ALL.map(|class| guard_wording(class).headline));
}

#[test]
fn each_cause_has_its_guard_class() {
    for cause in UnprovenCause::ALL {
        let mut rows = CAUSES_WITH_OWN_CLASS.into_iter();
        let own = rows.find(|&(listed, _)| listed == cause);
        let expected = own.map_or(GuardClass::UnknownObject, |(_, class)| class);
        assert_eq!(guard_class(cause), expected, "{cause:?}");
    }
}

#[test]
fn cause_and_guard_class_with_one_code_belong_together() {
    for cause in UnprovenCause::ALL {
        for class in GuardClass::ALL {
            if cause_code(cause) == guard_cause_code(class) {
                assert_eq!(guard_class(cause), class, "{cause:?}");
            }
        }
    }
}

#[test]
fn codes_of_one_table_differ() {
    assert_all_differ(&UnprovenCause::ALL.map(cause_code));
    let ill_typed_codes: Vec<&str> = ill_typed_wordings()
        .into_iter()
        .map(|wording| wording.code)
        .collect();
    assert_all_differ(&ill_typed_codes);
    assert_all_differ(&TypeTestFailure::ALL.map(failure_code));
    assert_all_differ(&TypeTestFailure::ALL.map(failure_sentence));
    assert_all_differ(&CodeForm::ALL.map(form_label));
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
