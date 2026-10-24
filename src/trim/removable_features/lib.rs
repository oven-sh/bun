#![cfg_attr(not(test), no_std)]
#![warn(unused_must_use)]
pub mod entry_point;
mod feature_set;
mod requirement;
mod state;

mod generated {
    use super::{EnteredFrom, FeatureRecord, TrimFeatureRecord};
    include!(concat!(env!("BUN_CODEGEN_DIR"), "/removable_features.rs"));
}

pub use feature_set::FeatureSet;
pub use generated::{FEATURES_HASH, Feature, TrimFeature};
pub use requirement::RuntimeRequirement;
pub use state::{
    MAX_REMOVED_RANGES, RemovableFeatureState, RemovedRange, abort_for_removed_feature,
    find_removed_range, is_removed, is_trimmed, removal_of, removed_feature_at,
};

#[repr(u8)]
#[derive(Copy, Clone, PartialEq, Eq, Debug)]
pub enum EnteredFrom {
    Program,
    Startup,
    CommandLine,
}

#[repr(u8)]
#[derive(Copy, Clone, PartialEq, Eq, Debug)]
pub enum Removal {
    Present = 0,
    Unused = 1,
    Requested = 2,
}

#[repr(u8)]
#[derive(Copy, Clone, PartialEq, Eq, Debug)]
pub enum StubKind {
    Abort = 0,
    Throw = 1,
    ReturnUndefined = 2,
    ReturnDefault = 3,
}

#[repr(u8)]
#[derive(Copy, Clone, PartialEq, Eq, Debug)]
pub enum GuardOrigin {
    NativeCode = 0,
    Builtin = 1,
    Definition = 2,
    BuiltinNamedByEngine = 3,
}

/// `generated::FEATURE_RECORDS` has one for each of `generated::ALL_FEATURES`, in the same order.
pub(crate) struct FeatureRecord {
    pub(crate) name: &'static str,
    pub(crate) text: &'static str,
    pub(crate) entered_from: EnteredFrom,
    pub(crate) narrowest_trim_feature: Option<TrimFeature>,
}

/// `generated::TRIM_FEATURE_RECORDS` has one for each of `generated::ALL_TRIM_FEATURES`, in the same order.
pub(crate) struct TrimFeatureRecord {
    pub(crate) name: &'static str,
    pub(crate) features: &'static [Feature],
}

const _: () = {
    assert!(generated::RUST_SOURCE_VERSION == 3);
    assert!(!generated::ALL_FEATURES.is_empty());
    assert!(!generated::ALL_TRIM_FEATURES.is_empty());
    assert!(generated::FEATURE_RECORDS.len() == generated::ALL_FEATURES.len());
    assert!(generated::TRIM_FEATURE_RECORDS.len() == generated::ALL_TRIM_FEATURES.len());

    let mut position = 0;
    while position < generated::ALL_FEATURES.len() {
        let index = generated::ALL_FEATURES[position] as u16;
        assert!((index as usize) < Feature::INDEX_LIMIT);
        assert!(position == 0 || (generated::ALL_FEATURES[position - 1] as u16) < index);
        position += 1;
    }

    let mut position = 0;
    while position < generated::ALL_TRIM_FEATURES.len() {
        assert!(generated::ALL_TRIM_FEATURES[position] as usize == position);
        position += 1;
    }
};

impl Feature {
    pub const ALL: &'static [Feature] = generated::ALL_FEATURES;
    pub const COUNT: u32 = generated::ALL_FEATURES[generated::ALL_FEATURES.len() - 1] as u32 + 1;
    pub const INDEX_LIMIT: usize = 512;
    pub const FIRST_EMBEDDER_INDEX: u16 = 128;

    pub const fn index(self) -> u16 {
        self as u16
    }

    pub fn from_index(index: u16) -> Option<Feature> {
        let position = generated::ALL_FEATURES
            .binary_search_by_key(&index, |feature| feature.index())
            .ok()?;
        Some(generated::ALL_FEATURES[position])
    }

    pub fn from_name(name: &[u8]) -> Option<Feature> {
        generated::FEATURE_RECORDS
            .iter()
            .position(|record| record.name.as_bytes() == name)
            .map(|position| generated::ALL_FEATURES[position])
    }

    pub fn name(self) -> &'static str {
        self.record().name
    }

    pub fn text(self) -> &'static str {
        self.record().text
    }

    pub fn entered_from(self) -> EnteredFrom {
        self.record().entered_from
    }

    pub fn all_entered_from(origin: EnteredFrom) -> FeatureSet {
        Feature::ALL
            .iter()
            .copied()
            .filter(|feature| feature.entered_from() == origin)
            .collect()
    }

    /// What only the command line enters, and the JIT. A program compiled ahead of time enters neither, and nothing it can name holds a pointer to their code.
    pub fn all_outside_compiled_programs() -> FeatureSet {
        let mut features = Feature::all_entered_from(EnteredFrom::CommandLine);
        features.insert(Feature::Jit);
        features
    }

    pub fn is_engine(self) -> bool {
        self.index() < Feature::FIRST_EMBEDDER_INDEX
    }

    pub fn narrowest_trim_feature(self) -> Option<TrimFeature> {
        self.record().narrowest_trim_feature
    }

    fn record(self) -> &'static FeatureRecord {
        match generated::ALL_FEATURES.binary_search(&self) {
            Ok(position) => &generated::FEATURE_RECORDS[position],
            Err(_) => unreachable!(),
        }
    }
}

impl TrimFeature {
    pub const ALL: &'static [TrimFeature] = generated::ALL_TRIM_FEATURES;

    pub fn from_name(name: &[u8]) -> Option<TrimFeature> {
        generated::TRIM_FEATURE_RECORDS
            .iter()
            .position(|record| record.name.as_bytes() == name)
            .map(|position| generated::ALL_TRIM_FEATURES[position])
    }

    pub fn name(self) -> &'static str {
        self.record().name
    }

    pub fn features(self) -> FeatureSet {
        FeatureSet::from_features(self.record().features)
    }

    fn record(self) -> &'static TrimFeatureRecord {
        &generated::TRIM_FEATURE_RECORDS[self as usize]
    }
}

#[cfg(test)]
mod tests {
    use core::ffi::{CStr, c_char};

    use super::*;

    unsafe extern "C" {
        safe fn Bun__removableFeatureName(index: u16) -> *const c_char;
    }

    #[test]
    fn feature_round_trips_through_index_and_name() {
        for &feature in Feature::ALL {
            assert_eq!(Feature::from_index(feature.index()), Some(feature));
            assert_eq!(Feature::from_name(feature.name().as_bytes()), Some(feature));
        }
    }

    #[test]
    fn trim_feature_round_trips_through_name() {
        for &trim_feature in TrimFeature::ALL {
            assert_eq!(
                TrimFeature::from_name(trim_feature.name().as_bytes()),
                Some(trim_feature)
            );
        }
    }

    #[test]
    fn narrowest_trim_feature_has_fewest_members() {
        for &feature in Feature::ALL {
            let Some(narrowest) = feature.narrowest_trim_feature() else {
                assert!(
                    TrimFeature::ALL
                        .iter()
                        .all(|trim_feature| !trim_feature.features().contains(feature))
                );
                continue;
            };
            assert!(narrowest.features().contains(feature));
            for &trim_feature in TrimFeature::ALL {
                if trim_feature.features().contains(feature) {
                    assert!(trim_feature.features().len() >= narrowest.features().len());
                }
            }
        }
    }

    #[test]
    fn no_program_enters_what_is_outside_compiled_programs() {
        let outside = Feature::all_outside_compiled_programs();
        assert!(TrimFeature::Cli.features().is_subset_of(&outside));
        assert!(TrimFeature::Jit.features().is_subset_of(&outside));
        assert!(!outside.intersects(&Feature::all_entered_from(EnteredFrom::Program)));
    }

    #[test]
    fn entered_from_follows_feature_files() {
        assert_eq!(Feature::Jit.entered_from(), EnteredFrom::Startup);
        assert_eq!(Feature::CliOptions.entered_from(), EnteredFrom::Startup);
        assert_eq!(Feature::Tools.entered_from(), EnteredFrom::CommandLine);
        assert_eq!(
            Feature::ImageCompiler.entered_from(),
            EnteredFrom::CommandLine
        );
        assert_eq!(Feature::Interpreter.entered_from(), EnteredFrom::Program);
        assert_eq!(Feature::Sql.entered_from(), EnteredFrom::Program);
    }

    #[test]
    fn origins_partition_features() {
        let origins = [
            EnteredFrom::Program,
            EnteredFrom::Startup,
            EnteredFrom::CommandLine,
        ];
        let counts = origins.map(|origin| Feature::all_entered_from(origin).len());
        assert_eq!(counts.iter().sum::<usize>(), Feature::ALL.len());
        assert!(counts.iter().all(|count| *count > 0));
    }

    #[test]
    fn engine_and_embedder_indexes() {
        assert_eq!(Feature::Jit.index(), 0);
        assert_eq!(Feature::Tools.index(), 128);
        assert!(Feature::Jit.is_engine());
        assert!(!Feature::Tools.is_engine());
    }

    #[test]
    fn trim_feature_from_kebab_case_name() {
        assert_eq!(
            TrimFeature::from_name(b"html-rewriter"),
            Some(TrimFeature::HtmlRewriter)
        );
    }

    #[test]
    fn from_index_rejects_undeclared_indexes() {
        assert_eq!(Feature::from_index(127), None);
        assert_eq!(Feature::from_index(511), None);
        assert_eq!(Feature::from_index(u16::MAX), None);
    }

    #[test]
    fn count_is_above_every_index() {
        let highest = Feature::ALL[Feature::ALL.len() - 1];
        assert_eq!(Feature::COUNT, highest as u32 + 1);
        assert!(
            Feature::ALL
                .iter()
                .all(|&feature| (feature as u32) < Feature::COUNT)
        );
        assert!(Feature::COUNT as usize <= Feature::INDEX_LIMIT);
    }

    #[test]
    fn exported_name_equals_feature_name() {
        for &feature in Feature::ALL {
            let name = Bun__removableFeatureName(feature.index());
            // SAFETY: a declared index gives a C string literal.
            let name = unsafe { CStr::from_ptr(name) };
            assert_eq!(name.to_bytes(), feature.name().as_bytes());
        }
    }

    #[test]
    fn exported_name_of_undeclared_index_is_null() {
        assert!(Bun__removableFeatureName(127).is_null());
        assert!(Bun__removableFeatureName(511).is_null());
        assert!(Bun__removableFeatureName(u16::MAX).is_null());
    }

    #[test]
    fn from_name_matches_exact_bytes() {
        assert_eq!(Feature::from_name(b"jit"), None);
        assert_eq!(Feature::from_name(b""), None);
        assert_eq!(Feature::from_name(b"JIT "), None);
        assert_eq!(TrimFeature::from_name(b"htmlrewriter"), None);
    }
}
