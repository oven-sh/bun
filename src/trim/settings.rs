use bun_removable_features::{Feature, RuntimeRequirement};

use crate::model::{ExecutableSettings, OptionRequirement};

pub fn collect_requirements(settings: &ExecutableSettings) -> Vec<OptionRequirement> {
    let ExecutableSettings {
        autoloads_bunfig,
        autoloads_package_json,
        autoloads_tsconfig,
        embeds_source_maps,
        exec_argv,
    } = settings;

    let setting_features: [(bool, Feature, &str); 4] = [
        (
            *autoloads_bunfig,
            Feature::Bunfig,
            "autoloading bunfig.toml",
        ),
        (
            *autoloads_package_json,
            Feature::PackageFiles,
            "autoloading package.json",
        ),
        (
            *autoloads_tsconfig,
            Feature::PackageFiles,
            "autoloading tsconfig.json",
        ),
        (
            *embeds_source_maps,
            Feature::SourceMaps,
            "the embedded source maps",
        ),
    ];

    let mut requirements = Vec::new();
    for (is_enabled, feature, label) in setting_features {
        if is_enabled {
            requirements.push(OptionRequirement {
                requirement: RuntimeRequirement::Feature(feature),
                label: Box::from(label.as_bytes()),
            });
        }
    }
    let required_options = exec_argv
        .iter()
        .filter(|option| option.requirement != RuntimeRequirement::Nothing);
    requirements.extend(required_options.cloned());
    requirements
}

#[cfg(test)]
mod tests {
    use super::*;

    fn option(requirement: RuntimeRequirement, label: &str) -> OptionRequirement {
        OptionRequirement {
            requirement,
            label: Box::from(label.as_bytes()),
        }
    }

    fn feature_option(feature: Feature, label: &str) -> OptionRequirement {
        option(RuntimeRequirement::Feature(feature), label)
    }

    #[test]
    fn default_settings_require_nothing() {
        assert!(collect_requirements(&ExecutableSettings::default()).is_empty());
    }

    #[test]
    fn autoloaded_bunfig_requires_bunfig() {
        let settings = ExecutableSettings {
            autoloads_bunfig: true,
            ..ExecutableSettings::default()
        };
        assert_eq!(
            collect_requirements(&settings),
            [feature_option(Feature::Bunfig, "autoloading bunfig.toml")]
        );
    }

    #[test]
    fn autoloaded_package_json_requires_package_files() {
        let settings = ExecutableSettings {
            autoloads_package_json: true,
            ..ExecutableSettings::default()
        };
        assert_eq!(
            collect_requirements(&settings),
            [feature_option(
                Feature::PackageFiles,
                "autoloading package.json"
            )]
        );
    }

    #[test]
    fn autoloaded_tsconfig_requires_package_files() {
        let settings = ExecutableSettings {
            autoloads_tsconfig: true,
            ..ExecutableSettings::default()
        };
        assert_eq!(
            collect_requirements(&settings),
            [feature_option(
                Feature::PackageFiles,
                "autoloading tsconfig.json"
            )]
        );
    }

    #[test]
    fn embedded_source_maps_require_source_maps() {
        let settings = ExecutableSettings {
            embeds_source_maps: true,
            ..ExecutableSettings::default()
        };
        assert_eq!(
            collect_requirements(&settings),
            [feature_option(
                Feature::SourceMaps,
                "the embedded source maps"
            )]
        );
    }

    #[test]
    fn exec_argv_option_keeps_requirement_and_label() {
        let options = [
            feature_option(Feature::Profilers, "--cpu-prof"),
            option(RuntimeRequirement::WholeRuntime, "--trace-exit"),
            option(RuntimeRequirement::RuntimeCode, "--preload"),
        ];
        for exec_argv_option in options {
            let settings = ExecutableSettings {
                exec_argv: vec![exec_argv_option.clone()],
                ..ExecutableSettings::default()
            };
            assert_eq!(collect_requirements(&settings), [exec_argv_option]);
        }
    }

    #[test]
    fn requirements_follow_field_order() {
        let preload = option(RuntimeRequirement::RuntimeCode, "--preload");
        let cpu_profile = feature_option(Feature::Profilers, "--cpu-prof");
        let settings = ExecutableSettings {
            autoloads_bunfig: true,
            autoloads_package_json: true,
            autoloads_tsconfig: true,
            embeds_source_maps: true,
            exec_argv: vec![preload.clone(), cpu_profile.clone()],
        };
        assert_eq!(
            collect_requirements(&settings),
            [
                feature_option(Feature::Bunfig, "autoloading bunfig.toml"),
                feature_option(Feature::PackageFiles, "autoloading package.json"),
                feature_option(Feature::PackageFiles, "autoloading tsconfig.json"),
                feature_option(Feature::SourceMaps, "the embedded source maps"),
                preload,
                cpu_profile,
            ]
        );
    }

    #[test]
    fn option_requiring_nothing_is_dropped() {
        let cpu_profile = feature_option(Feature::Profilers, "--cpu-prof");
        let settings = ExecutableSettings {
            exec_argv: vec![
                option(RuntimeRequirement::Nothing, "--max-old-space-size"),
                cpu_profile.clone(),
                option(RuntimeRequirement::Nothing, "--smol"),
            ],
            ..ExecutableSettings::default()
        };
        assert_eq!(collect_requirements(&settings), [cpu_profile]);
    }
}
