use bun_sema::util::SharedSort;
use bun_trim::{
    FeatureSet, LocaleTag, UnseenCode, UnseenCodeCause, UsedFeature, UsedFeatures, UsedLocales,
    WitnessIndex, features_kept_only_when_named,
};

use super::{
    EngineResult, FeatureUseRecord, LocaleUseRecord, TextRange, UnseenCodeRecord, feature_of,
};
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
    let only_when_named = features_kept_only_when_named();
    let mut seen = FeatureSet::EMPTY;
    let mut used = Vec::new();
    for (index, record) in features.iter().enumerate() {
        // An undeclared word can stand for any feature, so nothing may be removed.
        let Some(feature) = feature_of(record.feature) else {
            return UsedFeatures::default();
        };
        let is_named = record.kind == FeatureUseKind::Named;
        if seen.contains(feature) || (!is_named && only_when_named.contains(feature)) {
            continue;
        }
        seen.insert(feature);
        used.push(UsedFeature {
            feature,
            witness: witness_at(index),
        });
    }
    let causes = unseen.iter().enumerate().map(|(index, record)| UnseenCode {
        cause: cause_of(record.cause),
        witness: witness_at(index),
    });
    UsedFeatures {
        features: used,
        causes: causes.collect(),
        locales: used_locales(locales, text_of),
    }
}

fn cause_of(cause: EngineCause) -> UnseenCodeCause {
    match cause {
        EngineCause::Unknown => UnseenCodeCause::ReportMissing,
        EngineCause::EvaluatesText => UnseenCodeCause::EvaluatesText,
        EngineCause::ImportsUncompiledModule => UnseenCodeCause::ImportsUncompiledCode,
        EngineCause::LoadsModuleByName => UnseenCodeCause::LoadsModuleByName,
        EngineCause::LoadsCodeByName => UnseenCodeCause::LoadsCodeByName,
        EngineCause::RunsUnseenCode | EngineCause::RunsMachineCode => {
            UnseenCodeCause::RunsUnseenCode
        }
        EngineCause::OptionAdmitsCode => UnseenCodeCause::OptionAdmitsCode,
        EngineCause::LimitReached => UnseenCodeCause::FlowGaveUp,
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
