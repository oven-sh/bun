use super::*;

const EXPLAIN_PAGE: &str = include_str!("../../../../docs/compiler/explain.mdx");

fn assert_all_differ(texts: &[&str]) {
    for (index, text) in texts.iter().enumerate() {
        assert!(!texts[..index].contains(text), "{text}");
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
fn codes_of_one_table_differ() {
    assert_all_differ(&UnprovenCause::ALL.map(cause_code));
    assert_all_differ(&TypeTestFailure::ALL.map(failure_code));
    assert_all_differ(&TypeTestFailure::ALL.map(failure_sentence));
    assert_all_differ(&CodeForm::ALL.map(form_label));
    assert_all_differ(&TypeOriginReason::ALL.map(origin_code));
}

#[test]
fn documented_causes_are_codes() {
    let codes = UnprovenCause::ALL.map(cause_code);
    let headings: Vec<&str> = EXPLAIN_PAGE
        .lines()
        .filter_map(|line| line.strip_prefix("### "))
        .collect();
    assert!(!headings.is_empty());
    for heading in headings {
        assert!(codes.contains(&heading), "{heading}");
    }
}
