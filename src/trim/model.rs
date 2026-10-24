use core::ops::Range;

use bun_exe_format::cut_model::Uncut;
use bun_exe_format::image::{AddressRange, ExecutableFormat};
use bun_options_types::trim::TrimRequest;
use bun_removable_features::{Feature, FeatureSet, Removal, RuntimeRequirement, TrimFeature};

#[derive(Copy, Clone, PartialEq, Eq, PartialOrd, Ord, Hash, Debug)]
pub struct WitnessIndex(pub u32);

#[derive(Copy, Clone, PartialEq, Eq, Debug)]
pub struct UsedFeature {
    pub feature: Feature,
    pub witness: Option<WitnessIndex>,
}

#[derive(Copy, Clone, PartialEq, Eq, Debug)]
pub enum UnseenCodeCause {
    ProgramNotCompiled,
    ReportMissing,
    FlowResultDisabled,
    FlowGaveUp,
    EvaluatesText,
    ImportsUncompiledCode,
    LoadsModuleByName,
    LoadsCodeByName,
    RunsUnseenCode,
    OptionAdmitsCode,
}

impl UnseenCodeCause {
    pub const ALL: [UnseenCodeCause; 10] = [
        UnseenCodeCause::ProgramNotCompiled,
        UnseenCodeCause::ReportMissing,
        UnseenCodeCause::FlowResultDisabled,
        UnseenCodeCause::FlowGaveUp,
        UnseenCodeCause::EvaluatesText,
        UnseenCodeCause::ImportsUncompiledCode,
        UnseenCodeCause::LoadsModuleByName,
        UnseenCodeCause::LoadsCodeByName,
        UnseenCodeCause::RunsUnseenCode,
        UnseenCodeCause::OptionAdmitsCode,
    ];

    pub fn lets_unseen_code_run(self) -> bool {
        !matches!(self, UnseenCodeCause::LoadsModuleByName)
    }

    pub fn admits_library_text(self) -> bool {
        !matches!(
            self,
            UnseenCodeCause::FlowGaveUp
                | UnseenCodeCause::EvaluatesText
                | UnseenCodeCause::LoadsModuleByName
                | UnseenCodeCause::RunsUnseenCode
        )
    }
}

#[derive(Copy, Clone, PartialEq, Eq, Debug)]
pub struct UnseenCode {
    pub cause: UnseenCodeCause,
    pub witness: Option<WitnessIndex>,
}

#[derive(Clone, PartialEq, Eq, PartialOrd, Ord, Debug)]
pub struct LocaleTag(pub Box<[u8]>);

#[derive(Clone, PartialEq, Eq, Debug)]
pub enum UsedLocales {
    Unknown(Option<WitnessIndex>),
    Listed(Vec<LocaleTag>),
}

#[derive(Clone, PartialEq, Eq, Debug)]
pub struct UsedFeatures {
    pub features: Vec<UsedFeature>,
    pub causes: Vec<UnseenCode>,
    pub locales: UsedLocales,
}

impl UsedFeatures {
    pub fn with_cause(cause: UnseenCodeCause) -> UsedFeatures {
        UsedFeatures {
            features: Vec::new(),
            causes: vec![UnseenCode {
                cause,
                witness: None,
            }],
            locales: UsedLocales::Unknown(None),
        }
    }

    pub fn from_features(features: &[Feature]) -> UsedFeatures {
        let without_witness = |feature: &Feature| UsedFeature {
            feature: *feature,
            witness: None,
        };
        UsedFeatures {
            features: features.iter().map(without_witness).collect(),
            causes: Vec::new(),
            locales: UsedLocales::Unknown(None),
        }
    }

    pub fn has_cause(&self, cause: UnseenCodeCause) -> bool {
        self.causes.iter().any(|unseen| unseen.cause == cause)
    }
}

impl Default for UsedFeatures {
    fn default() -> UsedFeatures {
        UsedFeatures::with_cause(UnseenCodeCause::ReportMissing)
    }
}

#[derive(Clone, PartialEq, Eq, Debug)]
pub struct OptionRequirement {
    pub requirement: RuntimeRequirement,
    pub label: Box<[u8]>,
}

#[derive(Clone, PartialEq, Eq, Debug, Default)]
pub struct ExecutableSettings {
    pub autoloads_bunfig: bool,
    pub autoloads_package_json: bool,
    pub autoloads_tsconfig: bool,
    pub embeds_source_maps: bool,
    pub exec_argv: Vec<OptionRequirement>,
}

#[derive(Copy, Clone)]
pub struct TrimInput<'a> {
    pub used: &'a UsedFeatures,
    pub settings: &'a ExecutableSettings,
    pub request: &'a TrimRequest,
}

impl TrimInput<'_> {
    pub fn is_program_compiled(&self) -> bool {
        !self.used.has_cause(UnseenCodeCause::ProgramNotCompiled)
    }

    pub fn removes_anything(&self) -> bool {
        self.request.is_enabled() || self.is_program_compiled()
    }
}

bun_removable_features::trim_table_records!();

#[derive(Clone, PartialEq, Eq, Debug, Default)]
pub struct FeatureEdges {
    pub(crate) edges: Vec<FeatureEdge>,
}

#[derive(Copy, Clone, PartialEq, Eq, Debug)]
pub enum RetainReason {
    Allowed(TrimFeature),
    Used(Option<WitnessIndex>),
    RequiredByOption(usize),
    AlwaysEntered,
    ReachableByUnseenCode(usize),
    NeededBy {
        feature: Feature,
        strength: EdgeStrength,
    },
    NotRequested,
}

#[derive(Copy, Clone, PartialEq, Eq, Debug)]
pub struct Retained {
    pub feature: Feature,
    pub reason: RetainReason,
}

#[derive(Clone, PartialEq, Eq, Debug)]
pub struct Decision {
    pub unused: FeatureSet,
    /// Those of `unused` that `compile.trim.remove` names.
    pub requested: FeatureSet,
    pub retained: Vec<Retained>,
    pub requirements: Vec<OptionRequirement>,
}

impl Decision {
    pub fn empty() -> Decision {
        Decision {
            unused: FeatureSet::EMPTY,
            requested: FeatureSet::EMPTY,
            retained: Vec::new(),
            requirements: Vec::new(),
        }
    }

    pub fn removed(&self) -> FeatureSet {
        self.unused
    }

    pub fn removal_of(&self, feature: Feature) -> Removal {
        if self.requested.contains(feature) {
            Removal::Requested
        } else if self.unused.contains(feature) {
            Removal::Unused
        } else {
            Removal::Present
        }
    }

    pub fn reason_of(&self, feature: Feature) -> Option<RetainReason> {
        let position = self
            .retained
            .binary_search_by_key(&feature, |retained| retained.feature)
            .ok()?;
        Some(self.retained[position].reason)
    }

    pub fn chain_of(&self, feature: Feature) -> Vec<Feature> {
        let mut chain = vec![feature];
        let mut current = feature;
        while let Some(RetainReason::NeededBy {
            feature: dependent, ..
        }) = self.reason_of(current)
        {
            if chain.contains(&dependent) {
                break;
            }
            chain.push(dependent);
            current = dependent;
        }
        chain
    }
}

#[derive(Copy, Clone, PartialEq, Eq, PartialOrd, Ord, Debug)]
pub struct SetIndex(pub u16);

#[derive(Copy, Clone, PartialEq, Eq, PartialOrd, Ord, Debug)]
pub struct LocaleGroup(pub u16);

#[derive(Clone, PartialEq, Eq, Debug)]
pub struct TrimTable {
    pub features_hash: u64,
    pub base_address: u64,
    pub edges: FeatureEdges,
    pub sets: Vec<FeatureSet>,
    pub ranges: Vec<RemovableRange>,
    pub icu_packages: Vec<IcuPackage>,
    pub icu_languages: Vec<IcuLanguage>,
    pub module_texts: Vec<ModuleText>,
}

#[derive(Clone, PartialEq, Eq, Debug)]
pub(crate) enum WantedLocaleGroups {
    All,
    Listed(Vec<LocaleGroup>),
}

#[derive(Copy, Clone, PartialEq, Eq, Debug)]
pub(crate) struct PlannedRange {
    pub(crate) range: AddressRange,
    pub(crate) is_code: bool,
    pub(crate) can_be_cut: bool,
    pub(crate) can_be_filled: bool,
    pub(crate) named_feature: Feature,
}

#[derive(Clone, PartialEq, Eq, Debug)]
pub(crate) struct PlannedIcuPackage {
    pub(crate) range: AddressRange,
    pub(crate) removed_items: Vec<Range<u32>>,
    pub(crate) tombstoned_items: Vec<Range<u32>>,
}

#[derive(Clone, Debug)]
pub struct TrimPlan {
    pub(crate) decision: Decision,
    pub(crate) ranges: Vec<PlannedRange>,
    pub(crate) icu_packages: Vec<PlannedIcuPackage>,
    pub(crate) keeps_table: bool,
}

impl TrimPlan {
    pub(crate) fn empty() -> TrimPlan {
        TrimPlan {
            decision: Decision::empty(),
            ranges: Vec::new(),
            icu_packages: Vec::new(),
            keeps_table: false,
        }
    }

    pub fn decision(&self) -> &Decision {
        &self.decision
    }

    pub fn removal_of(&self, feature: Feature) -> Removal {
        self.decision.removal_of(feature)
    }

    pub fn removed(&self) -> FeatureSet {
        self.decision.removed()
    }

    pub fn is_empty(&self) -> bool {
        self.decision.unused.is_empty() && self.icu_packages.is_empty()
    }
}

#[derive(Clone, Debug)]
pub struct TrimSummary {
    pub removed: FeatureSet,
    pub cut_bytes: u64,
    pub filled_bytes: u64,
    pub file_bytes_saved: u64,
    pub uncut: Option<Uncut>,
    pub format: Option<ExecutableFormat>,
}

impl TrimSummary {
    pub fn removed_bytes(&self) -> u64 {
        self.cut_bytes + self.filled_bytes
    }
}
