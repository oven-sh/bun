use crate::{EnteredFrom, Feature, FeatureSet, is_removed};

#[derive(Copy, Clone, PartialEq, Eq, Debug)]
pub enum RuntimeRequirement {
    Nothing,
    Feature(Feature),
    WholeRuntime,
    RuntimeCode,
}

impl RuntimeRequirement {
    pub fn required_features(self) -> FeatureSet {
        match self {
            RuntimeRequirement::Nothing => FeatureSet::EMPTY,
            RuntimeRequirement::Feature(feature) => FeatureSet::from_features(&[feature]),
            RuntimeRequirement::WholeRuntime | RuntimeRequirement::RuntimeCode => {
                Feature::all_entered_from(EnteredFrom::Program)
            }
        }
    }

    pub fn is_available(self) -> bool {
        self.is_available_with(is_removed)
    }

    fn is_available_with(self, is_removed: impl Fn(Feature) -> bool) -> bool {
        match self {
            RuntimeRequirement::Nothing => true,
            RuntimeRequirement::Feature(feature) => !is_removed(feature),
            RuntimeRequirement::WholeRuntime | RuntimeRequirement::RuntimeCode => {
                !self.required_features().iter().any(is_removed)
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const ALL: [RuntimeRequirement; 4] = [
        RuntimeRequirement::Nothing,
        RuntimeRequirement::Feature(Feature::Jit),
        RuntimeRequirement::WholeRuntime,
        RuntimeRequirement::RuntimeCode,
    ];

    const RUNS_UNSEEN_CODE: [RuntimeRequirement; 2] = [
        RuntimeRequirement::WholeRuntime,
        RuntimeRequirement::RuntimeCode,
    ];

    fn is_available_without(requirement: RuntimeRequirement, removed: Feature) -> bool {
        requirement.is_available_with(|feature| feature == removed)
    }

    #[test]
    fn untrimmed_executable_has_every_requirement() {
        for requirement in ALL {
            assert!(requirement.is_available(), "{requirement:?}");
        }
    }

    #[test]
    fn required_features_follow_requirement() {
        assert!(RuntimeRequirement::Nothing.required_features().is_empty());
        assert_eq!(
            RuntimeRequirement::Feature(Feature::Jit).required_features(),
            FeatureSet::from_features(&[Feature::Jit])
        );
        for requirement in RUNS_UNSEEN_CODE {
            let features = requirement.required_features();
            assert!(features.contains(Feature::Interpreter));
            assert!(features.contains(Feature::RuntimeTranspiler));
            assert!(!features.contains(Feature::Jit));
            assert!(!features.contains(Feature::Tools));
        }
    }

    #[test]
    fn removed_feature_is_unavailable() {
        let requirement = RuntimeRequirement::Feature(Feature::Sql);
        assert!(!is_available_without(requirement, Feature::Sql));
        assert!(is_available_without(requirement, Feature::Valkey));
        assert!(is_available_without(
            RuntimeRequirement::Nothing,
            Feature::Sql
        ));
    }

    #[test]
    fn removed_program_feature_makes_runtime_unavailable() {
        for requirement in RUNS_UNSEEN_CODE {
            assert!(!is_available_without(requirement, Feature::Sql));
        }
    }

    #[test]
    fn startup_and_command_line_features_are_ignored() {
        for requirement in RUNS_UNSEEN_CODE {
            assert!(is_available_without(requirement, Feature::Jit));
            assert!(is_available_without(requirement, Feature::Tools));
        }
    }
}
