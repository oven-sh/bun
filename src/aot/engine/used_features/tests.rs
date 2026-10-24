use bun_trim::Feature;

use super::*;
use crate::engine::SourceLocation;
use crate::engine::testing::ResultRecords;
use crate::ir::generated::Witness;
use crate::ir::ids::ABSENT_WORD;

const TEXT: &[u8] = b"frdeen-US";
const FR: TextRange = TextRange {
    offset: 0,
    length: 2,
};
const DE: TextRange = TextRange {
    offset: 2,
    length: 2,
};
const EN_US: TextRange = TextRange {
    offset: 4,
    length: 5,
};
const NO_TEXT: TextRange = TextRange {
    offset: 0,
    length: 0,
};
const NO_WITNESS: Witness = Witness {
    function: ABSENT_WORD,
    value: ABSENT_WORD,
    location: SourceLocation {
        module: ABSENT_WORD,
        position: 0,
    },
};

fn use_of_word(feature: u32) -> FeatureUseRecord {
    FeatureUseRecord {
        feature,
        builtin: ABSENT_WORD,
        witness: NO_WITNESS,
        kind: FeatureUseKind::Named,
    }
}

fn use_of(feature: Feature) -> FeatureUseRecord {
    use_of_word(u32::from(feature.index()))
}

fn unnamed_use_of(feature: Feature) -> FeatureUseRecord {
    FeatureUseRecord {
        kind: FeatureUseKind::Unnamed,
        ..use_of(feature)
    }
}

fn unseen_code(cause: EngineCause) -> UnseenCodeRecord {
    UnseenCodeRecord {
        cause,
        builtin: ABSENT_WORD,
        witness: NO_WITNESS,
    }
}

fn locale_use(kind: LocaleUseKind, tag: TextRange) -> LocaleUseRecord {
    LocaleUseRecord {
        kind,
        tag,
        builtin: ABSENT_WORD,
        witness: NO_WITNESS,
    }
}

fn constant(tag: TextRange) -> LocaleUseRecord {
    locale_use(LocaleUseKind::Constant, tag)
}

fn text_of(range: TextRange) -> Vec<u8> {
    TEXT[range.offset as usize..][..range.length as usize].to_vec()
}

fn at(index: u32) -> Option<WitnessIndex> {
    Some(WitnessIndex(index))
}

fn used(feature: Feature, index: u32) -> UsedFeature {
    UsedFeature {
        feature,
        witness: at(index),
    }
}

fn listed(tags: &[&str]) -> UsedLocales {
    let tags = tags.iter().map(|tag| LocaleTag(tag.as_bytes().into()));
    UsedLocales::Listed(tags.collect())
}

fn features_of(records: &[FeatureUseRecord]) -> UsedFeatures {
    from_records(records, &[], &[], &text_of)
}

fn locales_of(records: &[LocaleUseRecord]) -> UsedLocales {
    from_records(&[], &[], records, &text_of).locales
}

fn used_features_of_result(image: &[u8]) -> UsedFeatures {
    let records = ResultRecords {
        image,
        text: TEXT,
        features_used: &[use_of(Feature::RegExp), use_of(Feature::Fetch)],
        unseen_code: &[unseen_code(EngineCause::EvaluatesText)],
        locales_used: &[constant(EN_US), constant(DE)],
        ..ResultRecords::default()
    };
    records.with_result(used_features)
}

#[test]
fn features_keep_first_witness() {
    let records = [
        use_of(Feature::RegExp),
        use_of(Feature::RegExp),
        use_of(Feature::Fetch),
        use_of(Feature::RegExp),
        use_of(Feature::Fetch),
    ];
    let found = features_of(&records);
    assert_eq!(
        found.features,
        [used(Feature::RegExp, 0), used(Feature::Fetch, 2)]
    );
    assert!(found.causes.is_empty());
}

#[test]
fn unnamed_use_keeps_only_what_needs_no_name() {
    let records = [
        unnamed_use_of(Feature::RegExp),
        unnamed_use_of(Feature::IntlCollation),
        unnamed_use_of(Feature::Temporal),
        unnamed_use_of(Feature::IntlSegmenter),
        use_of(Feature::IntlSegmenter),
        unnamed_use_of(Feature::WebAssembly),
    ];
    assert_eq!(
        features_of(&records).features,
        [used(Feature::RegExp, 0), used(Feature::IntlSegmenter, 4)]
    );
}

#[test]
fn undeclared_feature_gives_default() {
    let beyond_index_width = 0x1_0000 + u32::from(Feature::RegExp.index());
    for undeclared in [127, u32::from(u16::MAX), beyond_index_width, ABSENT_WORD] {
        let features = [
            use_of(Feature::RegExp),
            use_of_word(undeclared),
            use_of(Feature::Fetch),
        ];
        let found = from_records(&features, &[], &[constant(DE)], &text_of);
        assert_eq!(found, UsedFeatures::default(), "{undeclared}");
    }
}

#[test]
fn default_lets_nothing_be_removed() {
    let missing = UnseenCode {
        cause: UnseenCodeCause::ReportMissing,
        witness: None,
    };
    let expected = UsedFeatures {
        features: Vec::new(),
        causes: vec![missing],
        locales: UsedLocales::Unknown(None),
    };
    assert_eq!(features_of(&[use_of_word(ABSENT_WORD)]), expected);
}

#[test]
fn every_engine_cause_maps() {
    let table = [
        (EngineCause::Unknown, UnseenCodeCause::ReportMissing),
        (EngineCause::EvaluatesText, UnseenCodeCause::EvaluatesText),
        (
            EngineCause::ImportsUncompiledModule,
            UnseenCodeCause::ImportsUncompiledCode,
        ),
        (
            EngineCause::LoadsModuleByName,
            UnseenCodeCause::LoadsModuleByName,
        ),
        (EngineCause::RunsUnseenCode, UnseenCodeCause::RunsUnseenCode),
        (
            EngineCause::OptionAdmitsCode,
            UnseenCodeCause::OptionAdmitsCode,
        ),
        (EngineCause::LimitReached, UnseenCodeCause::FlowGaveUp),
        (
            EngineCause::FlowResultDisabled,
            UnseenCodeCause::FlowResultDisabled,
        ),
        (
            EngineCause::RunsMachineCode,
            UnseenCodeCause::RunsUnseenCode,
        ),
        (
            EngineCause::LoadsCodeByName,
            UnseenCodeCause::LoadsCodeByName,
        ),
    ];
    assert_eq!(
        table.map(|(engine_cause, _)| engine_cause),
        EngineCause::ALL
    );
    for (engine_cause, cause) in table {
        assert_eq!(cause_of(engine_cause), cause, "{engine_cause:?}");
    }
}

#[test]
fn causes_follow_section() {
    let records = [
        unseen_code(EngineCause::LimitReached),
        unseen_code(EngineCause::EvaluatesText),
        unseen_code(EngineCause::LimitReached),
    ];
    let cause = |cause, index| UnseenCode {
        cause,
        witness: at(index),
    };
    assert_eq!(
        from_records(&[], &records, &[], &text_of).causes,
        [
            cause(UnseenCodeCause::FlowGaveUp, 0),
            cause(UnseenCodeCause::EvaluatesText, 1),
            cause(UnseenCodeCause::FlowGaveUp, 2),
        ]
    );
}

#[test]
fn host_default_locale_makes_list_unknown() {
    for kind in [LocaleUseKind::HostDefault, LocaleUseKind::Unknown] {
        let records = [
            constant(DE),
            locale_use(kind, NO_TEXT),
            constant(FR),
            locale_use(kind, NO_TEXT),
        ];
        assert_eq!(
            locales_of(&records),
            UsedLocales::Unknown(at(1)),
            "{kind:?}"
        );
    }
}

#[test]
fn constant_tags_are_sorted_and_unique() {
    let records = [FR, EN_US, DE, FR, EN_US].map(constant);
    assert_eq!(locales_of(&records), listed(&["de", "en-US", "fr"]));
}

#[test]
fn no_record_gives_empty_list_and_no_cause() {
    let expected = UsedFeatures {
        features: Vec::new(),
        causes: Vec::new(),
        locales: listed(&[]),
    };
    assert_eq!(features_of(&[]), expected);
}

#[test]
fn result_without_image_gives_default() {
    assert_eq!(used_features_of_result(b""), UsedFeatures::default());
}

#[test]
fn result_with_image_gives_its_records() {
    let evaluates_text = UnseenCode {
        cause: UnseenCodeCause::EvaluatesText,
        witness: at(0),
    };
    let expected = UsedFeatures {
        features: vec![used(Feature::RegExp, 0), used(Feature::Fetch, 1)],
        causes: vec![evaluates_text],
        locales: listed(&["de", "en-US"]),
    };
    assert_eq!(used_features_of_result(b"image"), expected);
}
