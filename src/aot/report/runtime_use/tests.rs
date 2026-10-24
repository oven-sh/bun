use bstr::BString;
use bun_trim::{
    EdgeStrength, FeatureSet, LocaleTag, OptionRequirement, RuntimeRequirement, TrimFeature,
    UnseenCode, UnseenCodeCause,
};

use super::*;
use crate::engine::testing::ResultRecords;
use crate::engine::{FeatureUseRecord, LocaleUseRecord, TextRange, UnseenCodeRecord};
use crate::ir::generated::{FeatureUseKind, LocaleUseKind, UnseenCodeCause as EngineCause};
use crate::ir::ids::ABSENT_WORD;
use crate::report::testing::{
    DEPENDENCY, LINE_1_COLUMN_5, LINE_2_COLUMN_14, NO_LOCATION, PROGRAM, RUNTIME, ReportFixture,
    at, location, witness,
};

fn use_of_word(builtin: u32, uses: BuiltinUse) -> BuiltinUseRecord {
    BuiltinUseRecord {
        builtin,
        uses,
        witness: witness(ABSENT_WORD, NO_LOCATION),
    }
}

fn use_of(builtin: BuiltinId, uses: BuiltinUse) -> BuiltinUseRecord {
    use_of_word(builtin.to_wire(), uses)
}

fn items(records: &[BuiltinUseRecord]) -> Vec<BString> {
    let lines = item_lines(records);
    let items = lines.iter().map(|line| line.strip_prefix(PREFIX));
    items
        .map(|item| BString::from(item.expect("a line starts with the prefix")))
        .collect()
}

fn item(id: BuiltinId) -> Option<String> {
    let mut line = Vec::new();
    write_item(&mut line, id).then(|| String::from_utf8(line).expect("an item is ASCII"))
}

fn feature_text(feature: Feature) -> BString {
    let mut line = Vec::new();
    write_feature(&mut line, feature);
    BString::from(line)
}

fn unseen(cause: UnseenCodeCause, witness: Option<u32>) -> UnseenCode {
    UnseenCode {
        cause,
        witness: witness.map(WitnessIndex),
    }
}

fn unseen_record(builtin: u32, location: SourceLocation) -> UnseenCodeRecord {
    UnseenCodeRecord {
        cause: EngineCause::EvaluatesText,
        builtin,
        witness: witness(ABSENT_WORD, location),
    }
}

fn feature_use(feature: Feature, builtin: u32, location: SourceLocation) -> FeatureUseRecord {
    FeatureUseRecord {
        feature: u32::from(feature.index()),
        builtin,
        witness: witness(ABSENT_WORD, location),
        kind: FeatureUseKind::Named,
    }
}

fn with_positions<R>(
    fixture: &ReportFixture<'_>,
    then: impl FnOnce(&ReportInput<'_>, &mut Positions<'_>) -> R,
) -> R {
    fixture.with_input(|input| then(input, &mut Positions::new(input, PathStyle::Native)))
}

fn lines_and_positions(entries: &[ReportEntry]) -> Vec<(BString, Option<Position>)> {
    let described = entries.iter().map(|entry| {
        assert_eq!(entry.kind, ExplainSet::RUNTIME_USE);
        assert!(entry.notes.is_empty());
        let line = entry
            .text
            .strip_prefix(PREFIX)
            .expect("a line starts with the prefix");
        (BString::from(line), entry.position)
    });
    described.collect()
}

fn line(text: &str, position: Option<Position>) -> (BString, Option<Position>) {
    (BString::from(text), position)
}

fn reason_text(
    fixture: &ReportFixture<'_>,
    decision: &Decision,
    retained: Retained,
) -> (BString, Option<Position>) {
    with_positions(fixture, |input, positions| {
        let Retained { feature, reason } = retained;
        let mut text = Vec::new();
        let position = write_reason(&mut text, reason, input, decision, feature, positions);
        (BString::from(text), position)
    })
}

fn locale_text(fixture: &ReportFixture<'_>) -> (BString, Option<Position>) {
    let entry = with_positions(fixture, locale_line);
    lines_and_positions(&[entry]).remove(0)
}

#[test]
fn entry_carries_line_and_position() {
    let position = at(DEPENDENCY, 7);
    let entry = entry_at(line_from(&[b"blocked by ", b"eval"]), position);
    assert_eq!(entry.kind, ExplainSet::RUNTIME_USE);
    assert_eq!(BString::from(entry.text), "trim: blocked by eval");
    assert_eq!(entry.position, position);
    assert!(entry.notes.is_empty());
}

#[test]
fn witness_indexes_section() {
    let records = [10, 20];
    assert_eq!(record_at(&records, Some(WitnessIndex(1))), Some(&20));
    assert_eq!(record_at(&records, Some(WitnessIndex(2))), None);
    assert_eq!(record_at(&records, None), None);
}

#[test]
fn blocker_codes_do_not_follow_enumerator_names() {
    assert_eq!(
        UnseenCodeCause::ALL.map(trim_blocker_code),
        [
            "no-aot",
            "no-report",
            "analysis-disabled",
            "limit-reached",
            "eval",
            "external-import",
            "dynamic-import",
            "dynamic-import",
            "runtime-code",
            "build-option",
        ]
    );
}

#[test]
fn write_item_forms() {
    assert_eq!(
        item(BuiltinId::ConsoleLog).as_deref(),
        Some("uses console log")
    );
    assert_eq!(item(BuiltinId::BunServe).as_deref(), Some("uses Bun serve"));
    assert_eq!(item(BuiltinId::Intl).as_deref(), Some("uses global Intl"));
    assert_eq!(
        item(BuiltinId::NumberPrototypeToLocaleString).as_deref(),
        Some("uses property toLocaleString")
    );
    assert_eq!(
        item(BuiltinId::AsyncFunction).as_deref(),
        Some("uses builtin %AsyncFunction%")
    );
    assert_eq!(item(BuiltinId::GlobalThis), None);
}

#[test]
fn write_item_module_namespace() {
    let module = table::module_by_specifier(b"bun:sqlite").expect("the table has bun:sqlite");
    assert_eq!(
        item(table::namespace_of(module)).as_deref(),
        Some("uses module bun:sqlite")
    );
    assert_eq!(
        item(BuiltinId::BunSqliteDatabase).as_deref(),
        Some("uses bun:sqlite Database")
    );
}

#[test]
fn write_item_native_binding() {
    let mut ids = BuiltinId::ALL.iter().copied();
    let binding = ids
        .find(|&id| table::entry(id).kind == BuiltinKind::NativeBinding)
        .expect("the table has a native binding");
    assert_eq!(table::entry(binding).holder, None);
    assert_eq!(
        item(binding),
        Some(format!("uses native {}", table::text_of(binding)))
    );
}

#[test]
fn used_member_lists_root() {
    let records = [use_of(BuiltinId::ConsoleLog, BuiltinUse::CALLED)];
    assert_eq!(items(&records), ["uses console log", "uses global console"]);
}

#[test]
fn escaped_builtin_may_use_any_member() {
    let escaped = [use_of(BuiltinId::Console, BuiltinUse::ESCAPED)];
    assert_eq!(
        items(&escaped),
        [
            "uses console (escapes, so any member may be used)",
            "uses global console"
        ]
    );
    let read = [use_of(BuiltinId::Console, BuiltinUse::READ)];
    assert_eq!(items(&read), ["uses global console"]);
}

#[test]
fn tested_builtin_is_not_listed() {
    let uses_listed = |uses| !items(&[use_of(BuiltinId::ConsoleLog, uses)]).is_empty();
    assert!(!uses_listed(BuiltinUse::TESTED));
    assert!(!uses_listed(BuiltinUse::default()));
    assert!(uses_listed(BuiltinUse::TESTED | BuiltinUse::CALLED));
    for used in [
        BuiltinUse::READ,
        BuiltinUse::CALLED,
        BuiltinUse::CONSTRUCTED,
        BuiltinUse::WRITTEN,
        BuiltinUse::ESCAPED,
    ] {
        assert!(uses_listed(used), "{used:?}");
    }
}

#[test]
fn no_line_occurs_twice() {
    let records = [
        use_of(BuiltinId::ConsoleLog, BuiltinUse::CALLED),
        use_of(BuiltinId::Console, BuiltinUse::READ | BuiltinUse::ESCAPED),
        use_of(BuiltinId::ConsoleWarn, BuiltinUse::CALLED),
        use_of(BuiltinId::BunServe, BuiltinUse::CALLED),
        use_of(BuiltinId::ConsoleLog, BuiltinUse::READ),
    ];
    assert_eq!(
        items(&records),
        [
            "uses Bun serve",
            "uses console (escapes, so any member may be used)",
            "uses console log",
            "uses console warn",
            "uses global Bun",
            "uses global console",
        ]
    );
}

#[test]
fn undeclared_builtin_is_skipped() {
    let records = [
        use_of_word(ABSENT_WORD, BuiltinUse::CALLED),
        use_of_word(BuiltinId::COUNT, BuiltinUse::ESCAPED),
    ];
    assert!(items(&records).is_empty());
}

#[test]
fn global_object_has_no_item() {
    assert!(items(&[use_of(BuiltinId::GlobalThis, BuiltinUse::READ)]).is_empty());
}

#[test]
fn feature_line_has_trim_feature() {
    assert_eq!(
        feature_text(Feature::Lint),
        format!("{} (lint)", Feature::Lint.text())
    );
}

#[test]
fn feature_line_without_trim_feature() {
    assert_eq!(Feature::RegExp.narrowest_trim_feature(), None);
    assert_eq!(feature_text(Feature::RegExp), Feature::RegExp.text());
}

#[test]
fn program_with_every_api_visible_has_one_cause_line() {
    let fixture = ReportFixture::new(ResultRecords::default());
    let mut entries = Vec::new();
    with_positions(&fixture, |input, positions| {
        cause_lines(input, positions, &mut entries)
    });
    assert_eq!(
        lines_and_positions(&entries),
        [line(
            "the compiler can see every API this program uses",
            None
        )]
    );
}

#[test]
fn cause_line_has_builtin_and_position() {
    let records = [
        unseen_record(
            BuiltinId::Eval.to_wire(),
            location(PROGRAM, LINE_2_COLUMN_14),
        ),
        unseen_record(ABSENT_WORD, location(RUNTIME, 3)),
        unseen_record(ABSENT_WORD, NO_LOCATION),
    ];
    let mut fixture = ReportFixture::new(ResultRecords {
        unseen_code: &records,
        ..ResultRecords::default()
    });
    fixture.used_features.causes = vec![
        unseen(UnseenCodeCause::EvaluatesText, Some(0)),
        unseen(UnseenCodeCause::RunsUnseenCode, Some(1)),
        unseen(UnseenCodeCause::LoadsModuleByName, Some(2)),
        unseen(UnseenCodeCause::FlowGaveUp, Some(3)),
        unseen(UnseenCodeCause::ReportMissing, None),
    ];
    let mut entries = Vec::new();
    with_positions(&fixture, |input, positions| {
        cause_lines(input, positions, &mut entries)
    });
    assert_eq!(
        lines_and_positions(&entries),
        [
            line(
                "blocked by eval: the program calls eval() or new Function() (eval) at src/a.ts:2:14",
                at(PROGRAM, LINE_2_COLUMN_14),
            ),
            line(
                "blocked by runtime-code: the program can run code that isn't in the executable",
                at(RUNTIME, 3),
            ),
            line(
                "blocked by dynamic-import: the program calls import() or require() with a dynamic path",
                None,
            ),
            line(
                "blocked by limit-reached: the analysis hit a compiler limit",
                None
            ),
            line(
                "blocked by no-report: the compiler didn't report which APIs are used",
                None
            ),
        ]
    );
}

#[test]
fn locale_line_lists_tags() {
    let mut fixture = ReportFixture::new(ResultRecords::default());
    assert_eq!(locale_text(&fixture), line("locales: none", None));
    let tags = [&b"de"[..], b"en-US"].map(|tag| LocaleTag(tag.into()));
    fixture.used_features.locales = UsedLocales::Listed(tags.to_vec());
    assert_eq!(locale_text(&fixture), line("locales: de, en-US", None));
}

#[test]
fn locale_line_lists_requested_tags_alone() {
    let mut fixture = ReportFixture::new(ResultRecords::default());
    fixture.used_features.locales = UsedLocales::Listed(vec![LocaleTag((&b"fr"[..]).into())]);
    fixture.options.trim.locales = Some(vec![(&b"de"[..]).into(), (&b"en-US"[..]).into()]);
    let text = "locales: de, en-US: listed in compile.trim.locales";
    assert_eq!(locale_text(&fixture), line(text, None));
    fixture.options.trim.locales = Some(Vec::new());
    let text = "locales: none: listed in compile.trim.locales";
    assert_eq!(locale_text(&fixture), line(text, None));
}

#[test]
fn unknown_locales_have_position() {
    let record = |kind, builtin| LocaleUseRecord {
        kind,
        tag: TextRange {
            offset: 0,
            length: 0,
        },
        builtin,
        witness: witness(ABSENT_WORD, location(PROGRAM, LINE_1_COLUMN_5)),
    };
    let records = [
        record(LocaleUseKind::Unknown, ABSENT_WORD),
        record(LocaleUseKind::Unknown, BuiltinId::ConsoleLog.to_wire()),
        record(LocaleUseKind::HostDefault, BuiltinId::ConsoleLog.to_wire()),
    ];
    let mut fixture = ReportFixture::new(ResultRecords {
        locales_used: &records,
        ..ResultRecords::default()
    });
    let texts = [
        "locales: all, because the locale isn't a constant at src/a.ts:1:5",
        "locales: all, because the locale isn't a constant (console.log) at src/a.ts:1:5",
        "locales: all, because a call passes no locale, so the system's applies (console.log) at src/a.ts:1:5",
    ];
    for (index, text) in texts.into_iter().enumerate() {
        fixture.used_features.locales = UsedLocales::Unknown(Some(WitnessIndex(index as u32)));
        assert_eq!(
            locale_text(&fixture),
            line(text, at(PROGRAM, LINE_1_COLUMN_5))
        );
    }
    for witness in [Some(WitnessIndex(3)), None] {
        fixture.used_features.locales = UsedLocales::Unknown(witness);
        assert_eq!(locale_text(&fixture), line("locales: all", None));
    }
}

#[test]
fn each_reason_has_text() {
    let records = [
        feature_use(
            Feature::RegExp,
            BuiltinId::ConsoleLog.to_wire(),
            location(PROGRAM, LINE_2_COLUMN_14),
        ),
        feature_use(Feature::Fetch, ABSENT_WORD, NO_LOCATION),
    ];
    let mut fixture = ReportFixture::new(ResultRecords {
        features_used: &records,
        ..ResultRecords::default()
    });
    fixture.used_features.causes = vec![unseen(UnseenCodeCause::EvaluatesText, None)];
    let decision = Decision {
        requirements: vec![OptionRequirement {
            requirement: RuntimeRequirement::Feature(Feature::Inspector),
            label: Box::from(&b"--inspect"[..]),
        }],
        ..Decision::empty()
    };
    let used = |index| RetainReason::Used(Some(WitnessIndex(index)));
    let cases = [
        (
            RetainReason::Allowed(TrimFeature::Lint),
            line("listed in compile.trim.allow (lint)", None),
        ),
        (
            used(0),
            line(
                "used (console.log) at src/a.ts:2:14",
                at(PROGRAM, LINE_2_COLUMN_14),
            ),
        ),
        (used(1), line("used", None)),
        (used(2), line("used", None)),
        (RetainReason::Used(None), line("used", None)),
        (
            RetainReason::RequiredByOption(0),
            line("needed by --inspect", None),
        ),
        (
            RetainReason::RequiredByOption(1),
            line("needed by an option", None),
        ),
        (RetainReason::AlwaysEntered, line("runs at startup", None)),
        (
            RetainReason::ReachableByUnseenCode(0),
            line("code loaded at run time could use it (eval)", None),
        ),
        (
            RetainReason::ReachableByUnseenCode(1),
            line("code loaded at run time could use it", None),
        ),
        (
            RetainReason::NotRequested,
            line("not selected for removal", None),
        ),
    ];
    for (reason, expected) in cases {
        let retained = Retained {
            feature: Feature::RegExp,
            reason,
        };
        assert_eq!(
            reason_text(&fixture, &decision, retained),
            expected,
            "{reason:?}"
        );
    }
}

#[test]
fn chain_lists_dependents_in_order() {
    let needed_by = |feature| RetainReason::NeededBy {
        feature,
        strength: EdgeStrength::Reference,
    };
    let mut retained = vec![
        Retained {
            feature: Feature::Interpreter,
            reason: needed_by(Feature::Inspector),
        },
        Retained {
            feature: Feature::Inspector,
            reason: needed_by(Feature::Fetch),
        },
        Retained {
            feature: Feature::Fetch,
            reason: RetainReason::Used(None),
        },
    ];
    retained.sort_unstable_by_key(|retained| retained.feature);
    let decision = Decision {
        retained: retained.clone(),
        ..Decision::empty()
    };
    let fixture = ReportFixture::new(ResultRecords::default());
    let text_of = |feature| {
        let mut retained = retained.iter().copied();
        let retained = retained.find(|retained| retained.feature == feature);
        reason_text(&fixture, &decision, retained.expect("a retained feature")).0
    };
    let (inspector, fetch) = (Feature::Inspector.text(), Feature::Fetch.text());
    assert_eq!(
        text_of(Feature::Interpreter),
        format!("needed by {inspector} <- {fetch}")
    );
    assert_eq!(text_of(Feature::Inspector), format!("needed by {fetch}"));
}

#[test]
fn feature_lines_list_kept_then_removed() {
    let decision = Decision {
        unused: FeatureSet::from_features(&[Feature::RegExp, Feature::Sqlite]),
        requested: FeatureSet::from_features(&[Feature::Sqlite]),
        retained: vec![
            Retained {
                feature: Feature::Inspector,
                reason: RetainReason::AlwaysEntered,
            },
            Retained {
                feature: Feature::Lint,
                reason: RetainReason::Allowed(TrimFeature::Lint),
            },
        ],
        requirements: Vec::new(),
    };
    let fixture = ReportFixture::new(ResultRecords::default());
    let mut entries = Vec::new();
    with_positions(&fixture, |input, positions| {
        feature_lines(input, &decision, positions, &mut entries);
    });
    let expected = [
        format!("kept {}: runs at startup", feature_text(Feature::Inspector)),
        format!(
            "kept {}: listed in compile.trim.allow (lint)",
            feature_text(Feature::Lint)
        ),
        format!("removed {}: unused", feature_text(Feature::RegExp)),
        format!(
            "removed {}: listed in compile.trim.remove",
            feature_text(Feature::Sqlite)
        ),
    ];
    assert_eq!(
        lines_and_positions(&entries),
        expected.map(|text| line(&text, None))
    );
}

#[test]
fn report_lists_causes_items_locales_and_decision() {
    let records = [use_of(BuiltinId::ConsoleLog, BuiltinUse::CALLED)];
    let fixture = ReportFixture::new(ResultRecords {
        builtins_used: &records,
        ..ResultRecords::default()
    });
    let decision = Decision {
        unused: FeatureSet::from_features(&[Feature::RegExp]),
        ..Decision::empty()
    };
    let report = |decision: Option<&Decision>| {
        let mut entries = Vec::new();
        fixture.with_input(|input| collect(&ReportInput { decision, ..*input }, &mut entries));
        let lines = lines_and_positions(&entries).into_iter();
        lines.map(|(line, _)| line).collect::<Vec<BString>>()
    };
    let start = [
        "the compiler can see every API this program uses",
        "uses console log",
        "uses global console",
        "locales: none",
    ]
    .map(str::to_owned);
    let without_decision = "nothing removed: --trim wasn't passed".to_owned();
    assert_eq!(report(None), [&start[..], &[without_decision]].concat());
    let removed = format!("removed {}: unused", feature_text(Feature::RegExp));
    assert_eq!(report(Some(&decision)), [&start[..], &[removed]].concat());
}
