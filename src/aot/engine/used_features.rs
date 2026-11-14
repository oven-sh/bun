use bun_sema::util::SharedSort;
use bun_trim::{
    FeatureSet, LocaleTag, UnseenCode, UnseenCodeCause, UsedFeature, UsedFeatures, UsedLocales,
    WitnessIndex, features_retained_by_name,
};

use super::{
    EngineResult, FeatureUseRecord, LocaleUseRecord, TextRange, UnseenCodeRecord, builtin_of,
    feature_of,
};
use crate::builtins::id::{BuiltinId, Feature};
use crate::builtins::table;
use crate::ir::generated::{FeatureUseKind, LocaleUseKind, UnseenCodeCause as EngineCause};

pub fn used_features(result: &EngineResult) -> UsedFeatures {
    if result.image().is_none() {
        return UsedFeatures::default();
    }
    from_records(
        result.features_used(),
        result.unseen_code(),
        result.locales_used(),
        &|range| result.text(range).to_vec(),
    )
}

fn from_records(
    features: &[FeatureUseRecord],
    unseen: &[UnseenCodeRecord],
    locales: &[LocaleUseRecord],
    text_of: &dyn Fn(TextRange) -> Vec<u8>,
) -> UsedFeatures {
    let only_when_named = features_retained_by_name();
    let mut seen = FeatureSet::EMPTY;
    let mut named = FeatureSet::EMPTY;
    let mut used = Vec::new();
    for (index, record) in features.iter().enumerate() {
        let Some(feature) = feature_of(record.feature) else {
            return UsedFeatures::default();
        };
        if record.kind == FeatureUseKind::NamedAtRunTime || is_entered_by_bun_build(record) {
            continue;
        }
        let is_named = matches!(
            record.kind,
            FeatureUseKind::Named | FeatureUseKind::FoundByName
        );
        if is_named {
            named.insert(feature);
        }
        if seen.contains(feature) || (!is_named && only_when_named.contains(feature)) {
            continue;
        }
        seen.insert(feature);
        used.push(UsedFeature {
            feature,
            witness: witness_at(index),
            is_named,
        });
    }
    for used in &mut used {
        used.is_named = named.contains(used.feature);
    }
    let causes = unseen.iter().enumerate().map(|(index, record)| UnseenCode {
        cause: cause_of(record.cause),
        witness: witness_at(index),
    });
    UsedFeatures {
        features: used,
        causes: causes.collect(),
        locales: used_locales(locales, text_of),
        starts_workers_from_unseen_code: true,
        names_bun_build: features.iter().any(names_bun_build),
        can_reach_test_runner: !unseen.is_empty() || features.iter().any(leads_to_test_runner),
    }
}

fn is_entered_by_bun_build(record: &FeatureUseRecord) -> bool {
    let stands_outside_programs =
        |feature| Feature::all_outside_compiled_programs().contains(feature);
    builtin_of(record.builtin).is_none_or(|builtin| builtin == BuiltinId::BunBuild)
        && feature_of(record.feature).is_some_and(stands_outside_programs)
}

fn names_bun_build(record: &FeatureUseRecord) -> bool {
    record.kind == FeatureUseKind::Named
        && builtin_of(record.builtin).is_some()
        && is_entered_by_bun_build(record)
}

fn leads_to_test_runner(record: &FeatureUseRecord) -> bool {
    if feature_of(record.feature) != Some(Feature::Test) {
        return false;
    }
    let is_named = matches!(
        record.kind,
        FeatureUseKind::Named | FeatureUseKind::FoundByName
    );
    let hangs_under_no_name = |builtin| table::text_of(builtin).starts_with('%');
    is_named || !builtin_of(record.builtin).is_some_and(hangs_under_no_name)
}

fn cause_of(cause: EngineCause) -> UnseenCodeCause {
    match cause {
        EngineCause::Unknown => UnseenCodeCause::ReportMissing,
        EngineCause::EvaluatesText => UnseenCodeCause::EvaluatesText,
        EngineCause::ImportsUncompiledModule => UnseenCodeCause::ImportsUncompiledCode,
        EngineCause::LoadsModuleByName => UnseenCodeCause::LoadsModuleByName,
        EngineCause::LoadsCodeByName => UnseenCodeCause::LoadsCodeByName,
        EngineCause::RunsUnseenCode => UnseenCodeCause::RunsUnseenCode,
        EngineCause::RunsMachineCode => UnseenCodeCause::RunsMachineCode,
        EngineCause::OptionAdmitsCode => UnseenCodeCause::OptionAdmitsCode,
        EngineCause::FlowResultDisabled => UnseenCodeCause::FlowResultDisabled,
    }
}

fn used_locales(
    locales: &[LocaleUseRecord],
    text_of: &dyn Fn(TextRange) -> Vec<u8>,
) -> UsedLocales {
    let mut tags = Vec::with_capacity(locales.len());
    for (index, record) in locales.iter().enumerate() {
        match record.kind {
            LocaleUseKind::Constant => tags.push(LocaleTag(text_of(record.tag).into_boxed_slice())),
            LocaleUseKind::HostDefault | LocaleUseKind::Unknown => {
                return UsedLocales::Unknown(witness_at(index));
            }
        }
    }
    tags.shared_sort_unstable();
    tags.dedup();
    UsedLocales::Listed(tags)
}

fn witness_at(index: usize) -> Option<WitnessIndex> {
    u32::try_from(index).ok().map(WitnessIndex)
}

#[cfg(test)]
mod tests;
