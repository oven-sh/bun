use bstr::{BString, ByteSlice};

use super::*;
use crate::ir::generated::Protects;

fn object_with(write: impl FnOnce(&mut JsonWriter)) -> BString {
    let mut json = JsonWriter::object();
    write(&mut json);
    BString::from(json.finish())
}

fn count_of(document: &BString, text: &str) -> usize {
    document.find_iter(text).count()
}

fn protects_word(protects: Protects) -> &'static str {
    match protects {
        Protects::CompileTime => "compileTime",
        Protects::CodeSize => "codeSize",
        Protects::BitWidth => "bitWidth",
        Protects::Memory => "memory",
    }
}

#[test]
fn limits_list_every_limit_once() {
    let document = object_with(|json| write_limits(json, &LimitValues::for_host()));
    for limit in LimitId::ALL {
        let name = format!(r#"{{"name":"{}","#, limit.name());
        let expected = usize::from(limit != LimitId::None);
        assert_eq!(count_of(&document, &name), expected, "{limit:?}");
    }
    assert_eq!(count_of(&document, r#"{"name":"#), LimitId::COUNT - 1);
    assert!(document.starts_with(br#"{"limits":[{"name":""#));
    assert!(document.ends_with(br#""}]}"#));
}

#[test]
fn limit_has_five_members_in_order() {
    let limits = LimitValues::for_host();
    let document = object_with(|json| write_limits(json, &limits));
    for limit in LimitId::ALL
        .into_iter()
        .filter(|&limit| limit != LimitId::None)
    {
        let degrades_to = BString::from(lower_camel_case(limit.degrades_to().name()));
        let element = format!(
            concat!(
                r#"{{"name":"{}","value":{},"stage":"{}","#,
                r#""protects":"{}","degradesTo":"{}"}}"#,
            ),
            limit.name(),
            limits.get(limit),
            limit.stage().name(),
            protects_word(limit.protects()),
            degrades_to,
        );
        assert_eq!(count_of(&document, &element), 1, "{limit:?}");
    }
}

#[test]
fn limit_values_come_from_build() {
    let mut limits = LimitValues::for_host();
    limits.lower(LimitId::MaxTypeNodes, 3);
    let document = object_with(|json| write_limits(json, &limits));
    assert_eq!(
        count_of(&document, r#"{"name":"MaxTypeNodes","value":3,"#),
        1
    );
}

#[test]
fn names_are_listed_in_given_order() {
    let names = ["Optimize", "AnalyzeFlow"];
    assert_eq!(
        object_with(|json| write_names(json, "passes", names.into_iter())),
        r#"{"passes":["Optimize","AnalyzeFlow"]}"#
    );
    assert_eq!(
        object_with(|json| write_names(json, "passes", core::iter::empty())),
        r#"{"passes":[]}"#
    );
}

#[test]
fn only_placeholder_members_are_named_none() {
    assert_eq!(StatisticId::ALL[0], StatisticId::None);
    assert_eq!(RuntimeCounterId::ALL[0], RuntimeCounterId::None);
    assert_eq!(PassId::ALL[0], PassId::None);
    assert_eq!(LimitId::ALL[0], LimitId::None);
    assert!(!FlowResultKind::NAMES.contains(&"None"));
}
