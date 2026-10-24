use std::collections::VecDeque;

use bun_removable_features::{EnteredFrom, Feature, FeatureSet, TrimFeature};

use crate::model::{
    Decision, EdgeStrength, FeatureEdges, OptionRequirement, RetainReason, Retained, TrimInput,
    UnseenCodeCause,
};
use crate::settings::collect_requirements;

const ALWAYS_ENTERED: [Feature; 4] = [
    Feature::Bunfig,
    Feature::CliOptions,
    Feature::CrashReport,
    Feature::Profilers,
];

const ENGINE_FEATURES_OUTSIDE_LANGUAGE: [Feature; 3] =
    [Feature::WebAssembly, Feature::Inspector, Feature::Profilers];

// Megabytes of code and data. Evaluated text and computed keys don't keep them: the program has to name them or list them in `allow`.
const KEPT_ONLY_WHEN_NAMED: [TrimFeature; 3] = [
    TrimFeature::Intl,
    TrimFeature::Temporal,
    TrimFeature::Webassembly,
];

const HOLDS_GET_BUILTIN_MODULE: Feature = Feature::ProcessInformation;

// A path that is computed at run time may name a data file on disk: JSON, TOML, text.
const LOADS_FILES_FROM_DISK: Feature = Feature::DataFileLoaders;

// It may also name a file with code, which is transpiled and interpreted. Of Bun's APIs such a file finds what the program uses, like evaluated text.
const RUNS_FILES_FROM_DISK: [Feature; 4] = [
    LOADS_FILES_FROM_DISK,
    Feature::RuntimeTranspiler,
    Feature::Interpreter,
    Feature::BuiltinSourceText,
];

// `Bun.build` checks types, compiles ahead of time, and copies this executable's runtime into the executables it writes.
const ENTERED_BY_BUNDLER: [Feature; 4] = [
    Feature::Check,
    Feature::AotCompiler,
    Feature::ImageCompiler,
    Feature::Jit,
];

struct RetainedFeatures {
    set: FeatureSet,
    reasons: Vec<Retained>,
}

impl RetainedFeatures {
    fn insert(&mut self, feature: Feature, reason: RetainReason) -> bool {
        if self.set.contains(feature) {
            return false;
        }
        self.set.insert(feature);
        self.reasons.push(Retained { feature, reason });
        true
    }

    fn insert_set(&mut self, features: &FeatureSet, reason: RetainReason) {
        for feature in features.iter() {
            self.insert(feature, reason);
        }
    }
}

pub fn decide(input: &TrimInput<'_>, edges: &FeatureEdges) -> Decision {
    let request = input.request;
    let requirements = collect_requirements(input.settings);
    let mut retained = compute_seed(input, &requirements);
    if !request.removes_unused {
        retain_all_a_program_can_enter(&mut retained);
    }
    close(&mut retained, edges);

    let mut unused = FeatureSet::EMPTY;
    if request.removes_unused || input.is_program_compiled() {
        unused = FeatureSet::all();
        unused.subtract(&retained.set);
    }
    for &feature in &request.remove_internal {
        unused.insert(feature);
    }
    // What the request names goes, whoever uses it and whatever needs it.
    let mut requested = FeatureSet::EMPTY;
    for &name in &request.remove {
        for feature in name.features().iter() {
            requested.insert(feature);
            unused.insert(feature);
        }
    }

    let mut present = FeatureSet::all();
    present.subtract(&unused);

    Decision {
        unused,
        requested,
        retained: collect_retained(&present, retained.reasons),
        requirements,
    }
}

fn compute_seed(input: &TrimInput<'_>, requirements: &[OptionRequirement]) -> RetainedFeatures {
    let mut seed = RetainedFeatures {
        set: FeatureSet::EMPTY,
        reasons: Vec::new(),
    };
    // The first reason a feature gets stays, so this order is the priority of reasons.
    for &name in &input.request.allow {
        seed.insert_set(&name.features(), RetainReason::Allowed(name));
    }
    for used in &input.used.features {
        seed.insert(used.feature, RetainReason::Used(used.witness));
    }
    for (index, option) in requirements.iter().enumerate() {
        let features = option.requirement.required_features();
        seed.insert_set(&features, RetainReason::RequiredByOption(index));
    }
    for feature in ALWAYS_ENTERED {
        seed.insert(feature, RetainReason::AlwaysEntered);
    }
    for (index, unseen) in input.used.causes.iter().enumerate() {
        let features = features_reachable_by(unseen.cause);
        seed.insert_set(&features, RetainReason::ReachableByUnseenCode(index));
    }
    seed
}

fn retain_all_a_program_can_enter(retained: &mut RetainedFeatures) {
    if retained.set.contains(Feature::Bundler) {
        let reason = RetainReason::NeededBy {
            feature: Feature::Bundler,
            strength: EdgeStrength::RecoverableGuard,
        };
        for feature in ENTERED_BY_BUNDLER {
            retained.insert(feature, reason);
        }
    }
    let mut features = FeatureSet::all();
    features.subtract(&Feature::all_outside_compiled_programs());
    retained.insert_set(&features, RetainReason::NotRequested);
}

pub fn features_kept_only_when_named() -> FeatureSet {
    let mut features = FeatureSet::EMPTY;
    for name in KEPT_ONLY_WHEN_NAMED {
        features.union_with(&name.features());
    }
    features
}

fn features_reachable_by(cause: UnseenCodeCause) -> FeatureSet {
    let program_features = Feature::all_entered_from(EnteredFrom::Program);
    match cause {
        UnseenCodeCause::ProgramNotCompiled => {
            let mut features = program_features;
            features.insert(Feature::Jit);
            features
        }
        UnseenCodeCause::ReportMissing => program_features,
        UnseenCodeCause::FlowResultDisabled => program_features,
        UnseenCodeCause::FlowGaveUp => {
            let mut features = language_features();
            features.insert(HOLDS_GET_BUILTIN_MODULE);
            features
        }
        UnseenCodeCause::EvaluatesText => features_reachable_by_text(),
        UnseenCodeCause::ImportsUncompiledCode => program_features,
        UnseenCodeCause::LoadsModuleByName => FeatureSet::from_features(&[LOADS_FILES_FROM_DISK]),
        UnseenCodeCause::LoadsCodeByName => {
            let mut features = features_reachable_by_text();
            features.union_with(&FeatureSet::from_features(&RUNS_FILES_FROM_DISK));
            features
        }
        UnseenCodeCause::RunsUnseenCode => {
            let mut features = features_reachable_by_text();
            features.insert(Feature::NativeAddons);
            features
        }
        UnseenCodeCause::OptionAdmitsCode => program_features,
    }
}

fn features_reachable_by_text() -> FeatureSet {
    let mut features = language_features();
    features.subtract(&features_kept_only_when_named());
    features.insert(HOLDS_GET_BUILTIN_MODULE);
    features
}

fn language_features() -> FeatureSet {
    let mut features: FeatureSet = Feature::all_entered_from(EnteredFrom::Program)
        .iter()
        .filter(|feature| feature.is_engine())
        .collect();
    features.subtract(&FeatureSet::from_features(
        &ENGINE_FEATURES_OUTSIDE_LANGUAGE,
    ));
    features
}

fn close(retained: &mut RetainedFeatures, edges: &FeatureEdges) {
    let mut worklist: VecDeque<Feature> = retained.set.iter().collect();
    while let Some(feature) = worklist.pop_front() {
        for edge in edges.leaving(feature) {
            if !edge.is_followed {
                continue;
            }
            let reason = RetainReason::NeededBy {
                feature,
                strength: edge.strength,
            };
            if retained.insert(edge.to, reason) {
                worklist.push_back(edge.to);
            }
        }
    }
}

fn collect_retained(present: &FeatureSet, mut reasons: Vec<Retained>) -> Vec<Retained> {
    reasons.sort_unstable_by_key(|retained| retained.feature);
    let reason_of = |feature: Feature| match reasons
        .binary_search_by_key(&feature, |retained| retained.feature)
    {
        Ok(position) => reasons[position].reason,
        Err(_) => RetainReason::NotRequested,
    };
    present
        .iter()
        .map(|feature| Retained {
            feature,
            reason: reason_of(feature),
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use bun_options_types::trim::TrimRequest;
    use bun_removable_features::{Removal, RuntimeRequirement};

    use super::*;
    use crate::model::EdgeStrength::{self, AbortingGuard, RecoverableGuard, Reference};
    use crate::model::{
        ExecutableSettings, FeatureEdge, UnseenCode, UsedFeature, UsedFeatures, WitnessIndex,
    };

    const OPTION_LABEL: &[u8] = b"--option";

    fn edges(list: &[(Feature, Feature, EdgeStrength, bool)]) -> FeatureEdges {
        let edges = list
            .iter()
            .map(|&(from, to, strength, is_followed)| FeatureEdge {
                from,
                to,
                strength,
                is_followed,
            });
        FeatureEdges::new(edges.collect())
    }

    fn references(pairs: &[(Feature, Feature)]) -> FeatureEdges {
        let list: Vec<_> = pairs
            .iter()
            .map(|&(from, to)| (from, to, Reference, true))
            .collect();
        edges(&list)
    }

    fn using(features: &[Feature]) -> UsedFeatures {
        UsedFeatures::from_features(features)
    }

    fn removing_unused() -> TrimRequest {
        TrimRequest {
            removes_unused: true,
            ..TrimRequest::default()
        }
    }

    fn decide_with_edges(
        used: &UsedFeatures,
        request: &TrimRequest,
        edges: &FeatureEdges,
    ) -> Decision {
        let input = TrimInput {
            used,
            settings: &ExecutableSettings::default(),
            request,
        };
        decide(&input, edges)
    }

    fn decide_request(used: &UsedFeatures, request: &TrimRequest) -> Decision {
        decide_with_edges(used, request, &FeatureEdges::default())
    }

    fn decide_with_option(requirement: RuntimeRequirement, request: &TrimRequest) -> Decision {
        let option = OptionRequirement {
            requirement,
            label: Box::from(OPTION_LABEL),
        };
        let settings = ExecutableSettings {
            exec_argv: vec![option],
            ..ExecutableSettings::default()
        };
        let input = TrimInput {
            used: &using(&[]),
            settings: &settings,
            request,
        };
        decide(&input, &FeatureEdges::default())
    }

    #[test]
    fn removes_everything_when_nothing_is_used() {
        let decision = decide_request(&using(&[]), &removing_unused());
        let always_entered = FeatureSet::from_features(&ALWAYS_ENTERED);
        let mut expected = FeatureSet::all();
        expected.subtract(&always_entered);
        assert_eq!(decision.unused, expected);

        let retained: FeatureSet = decision
            .retained
            .iter()
            .map(|retained| retained.feature)
            .collect();
        assert_eq!(retained, always_entered);
        for retained in &decision.retained {
            assert_eq!(retained.reason, RetainReason::AlwaysEntered);
        }
    }

    #[test]
    fn used_feature_retains_requirements_transitively() {
        let [first, second, third] = [Feature::ALL[0], Feature::ALL[1], Feature::ALL[2]];
        let requirements = references(&[(first, second), (second, third)]);
        let decision = decide_with_edges(&using(&[first]), &removing_unused(), &requirements);
        for feature in [first, second, third] {
            assert!(!decision.unused.contains(feature));
        }
        assert!(!decision.unused.is_empty());
        assert_eq!(
            decision.reason_of(third),
            Some(RetainReason::NeededBy {
                feature: second,
                strength: Reference,
            })
        );
    }

    #[test]
    fn close_terminates_on_cycle() {
        let [first, second] = [Feature::ALL[0], Feature::ALL[1]];
        let mut retained = RetainedFeatures {
            set: FeatureSet::EMPTY,
            reasons: Vec::new(),
        };
        retained.insert(first, RetainReason::AlwaysEntered);
        close(
            &mut retained,
            &references(&[(first, second), (second, first)]),
        );
        assert_eq!(retained.set, FeatureSet::from_features(&[first, second]));
        assert_eq!(retained.reasons.len(), 2);
    }

    const CAUSES_OPENING_WHOLE_RUNTIME: [UnseenCodeCause; 5] = [
        UnseenCodeCause::ProgramNotCompiled,
        UnseenCodeCause::ReportMissing,
        UnseenCodeCause::FlowResultDisabled,
        UnseenCodeCause::ImportsUncompiledCode,
        UnseenCodeCause::OptionAdmitsCode,
    ];

    #[test]
    fn cause_opening_whole_runtime_retains_program_features() {
        for cause in CAUSES_OPENING_WHOLE_RUNTIME {
            let used = UsedFeatures::with_cause(cause);
            let decision = decide_request(&used, &removing_unused());
            for &feature in Feature::ALL {
                let is_removed = decision.unused.contains(feature);
                match feature.entered_from() {
                    EnteredFrom::Program => assert!(!is_removed, "{cause:?} {feature:?}"),
                    EnteredFrom::CommandLine => assert!(is_removed, "{cause:?} {feature:?}"),
                    EnteredFrom::Startup => {}
                }
            }
            assert_eq!(
                decision.reason_of(Feature::Sql),
                Some(RetainReason::ReachableByUnseenCode(0)),
                "{cause:?}"
            );
        }
    }

    #[test]
    fn no_cause_retains_command_line_feature() {
        for cause in UnseenCodeCause::ALL {
            let used = UsedFeatures::with_cause(cause);
            let decision = decide_request(&used, &removing_unused());
            let command_line = Feature::all_entered_from(EnteredFrom::CommandLine);
            assert!(command_line.is_subset_of(&decision.unused), "{cause:?}");
        }
    }

    #[test]
    fn native_code_from_outside_retains_what_text_does_and_addons() {
        let text = UsedFeatures::with_cause(UnseenCodeCause::EvaluatesText);
        let mut expected = decide_request(&text, &removing_unused()).unused;
        assert!(expected.contains(Feature::NativeAddons));
        expected.subtract(&FeatureSet::from_features(&[Feature::NativeAddons]));

        let addon = UsedFeatures::with_cause(UnseenCodeCause::RunsUnseenCode);
        assert_eq!(decide_request(&addon, &removing_unused()).unused, expected);
    }

    #[test]
    fn analysis_that_gave_up_retains_whole_language() {
        let text = UsedFeatures::with_cause(UnseenCodeCause::EvaluatesText);
        let text = decide_request(&text, &removing_unused()).unused;
        let gave_up = UsedFeatures::with_cause(UnseenCodeCause::FlowGaveUp);
        let gave_up = decide_request(&gave_up, &removing_unused()).unused;
        assert!(gave_up.is_subset_of(&text));
        for feature in [Feature::IntlCollation, Feature::Temporal] {
            assert!(text.contains(feature), "{feature:?}");
            assert!(!gave_up.contains(feature), "{feature:?}");
        }
    }

    #[test]
    fn evaluated_text_retains_language_and_get_builtin_module() {
        let used = UsedFeatures::with_cause(UnseenCodeCause::EvaluatesText);
        let decision = decide_request(&used, &removing_unused());
        for feature in [
            Feature::Interpreter,
            Feature::BuiltinSourceText,
            Feature::RegExp,
            Feature::StringNormalize,
            Feature::DataView,
            HOLDS_GET_BUILTIN_MODULE,
        ] {
            assert_eq!(
                decision.reason_of(feature),
                Some(RetainReason::ReachableByUnseenCode(0)),
                "{feature:?}"
            );
        }
        let mut kept_of_host = FeatureSet::from_features(&ALWAYS_ENTERED);
        kept_of_host.insert(HOLDS_GET_BUILTIN_MODULE);
        for &feature in Feature::ALL {
            if !feature.is_engine() && !kept_of_host.contains(feature) {
                assert!(decision.unused.contains(feature), "{feature:?}");
            }
        }
        for feature in [Feature::WebAssembly, Feature::Inspector, Feature::Jit] {
            assert!(decision.unused.contains(feature), "{feature:?}");
        }
    }

    #[test]
    fn only_cause_opening_whole_runtime_retains_what_has_to_be_named() {
        let only_when_named = features_kept_only_when_named();
        for feature in [
            Feature::IntlCollation,
            Feature::IntlSegmenter,
            Feature::IntlLocale,
            Feature::Temporal,
            Feature::WebAssembly,
        ] {
            assert!(only_when_named.contains(feature), "{feature:?}");
        }
        for cause in UnseenCodeCause::ALL {
            let used = UsedFeatures::with_cause(cause);
            let decision = decide_request(&used, &removing_unused());
            if CAUSES_OPENING_WHOLE_RUNTIME.contains(&cause) {
                assert!(!decision.unused.intersects(&only_when_named), "{cause:?}");
            } else if cause != UnseenCodeCause::FlowGaveUp {
                assert!(only_when_named.is_subset_of(&decision.unused), "{cause:?}");
            }
        }
    }

    #[test]
    fn evaluated_text_keeps_what_is_allowed_by_name() {
        let request = TrimRequest {
            allow: vec![TrimFeature::Temporal],
            ..removing_unused()
        };
        let used = UsedFeatures::with_cause(UnseenCodeCause::EvaluatesText);
        let decision = decide_request(&used, &request);
        assert_eq!(
            decision.reason_of(Feature::Temporal),
            Some(RetainReason::Allowed(TrimFeature::Temporal))
        );
        assert!(decision.unused.contains(Feature::IntlCollation));
    }

    #[test]
    fn evaluated_text_keeps_what_program_uses() {
        let used = UsedFeatures {
            causes: vec![UnseenCode {
                cause: UnseenCodeCause::EvaluatesText,
                witness: None,
            }],
            ..using(&[Feature::Sql, Feature::WebAssembly])
        };
        let decision = decide_request(&used, &removing_unused());
        for feature in [Feature::Sql, Feature::WebAssembly] {
            assert_eq!(
                decision.reason_of(feature),
                Some(RetainReason::Used(None)),
                "{feature:?}"
            );
        }
        assert!(decision.unused.contains(Feature::Glob));
    }

    #[test]
    fn dynamic_import_keeps_what_is_used_and_what_loads_files_from_disk() {
        let used = UsedFeatures {
            causes: vec![UnseenCode {
                cause: UnseenCodeCause::LoadsModuleByName,
                witness: None,
            }],
            ..using(&[Feature::Sql])
        };
        let by_name = decide_request(&used, &removing_unused());
        let used = using(&[Feature::Sql, Feature::DataFileLoaders]);
        let expected = decide_request(&used, &removing_unused()).unused;
        assert_eq!(by_name.unused, expected);
        assert!(!by_name.unused.contains(Feature::DataFileLoaders));
        assert!(by_name.unused.contains(Feature::RuntimeTranspiler));
        assert!(by_name.unused.contains(Feature::Interpreter));
    }

    #[test]
    fn dynamic_import_of_code_keeps_what_transpiles_and_interprets_a_file() {
        let used = UsedFeatures {
            causes: vec![UnseenCode {
                cause: UnseenCodeCause::LoadsCodeByName,
                witness: None,
            }],
            ..using(&[Feature::Sql])
        };
        let unused = decide_request(&used, &removing_unused()).unused;
        for feature in RUNS_FILES_FROM_DISK {
            assert!(!unused.contains(feature), "{feature:?}");
        }
        assert!(!unused.contains(Feature::Sql));
        assert!(unused.contains(Feature::Valkey));
        assert!(unused.contains(Feature::Jit));
    }

    #[test]
    fn only_not_compiled_retains_jit() {
        for cause in UnseenCodeCause::ALL {
            let used = UsedFeatures::with_cause(cause);
            let decision = decide_request(&used, &removing_unused());
            assert_eq!(
                !decision.unused.contains(Feature::Jit),
                cause == UnseenCodeCause::ProgramNotCompiled,
                "{cause:?}"
            );
        }
    }

    #[test]
    fn no_cause_removes_interpreter() {
        let interpreter = TrimFeature::Interpreter.features();
        let used = using(&[Feature::Sql]);
        let closed = decide_request(&used, &removing_unused());
        assert!(interpreter.is_subset_of(&closed.unused));

        let evaluating_text = UsedFeatures::with_cause(UnseenCodeCause::EvaluatesText);
        let open = decide_request(&evaluating_text, &removing_unused());
        assert!(!open.unused.contains(Feature::Interpreter));
        assert!(!open.unused.contains(Feature::BuiltinSourceText));

        let admitting_code = UsedFeatures::with_cause(UnseenCodeCause::OptionAdmitsCode);
        let whole = decide_request(&admitting_code, &removing_unused());
        assert!(!interpreter.intersects(&whole.unused));

        let requirement = references(&[(Feature::Sql, Feature::Interpreter)]);
        let needed = decide_with_edges(&used, &removing_unused(), &requirement);
        assert!(!needed.unused.contains(Feature::Interpreter));
    }

    #[test]
    fn unfollowed_guard_is_not_closed_over() {
        for strength in [AbortingGuard, RecoverableGuard] {
            let guard = edges(&[(Feature::BunFile, Feature::S3Client, strength, false)]);
            let decision =
                decide_with_edges(&using(&[Feature::BunFile]), &removing_unused(), &guard);
            assert!(!decision.unused.contains(Feature::BunFile), "{strength:?}");
            assert!(decision.unused.contains(Feature::S3Client), "{strength:?}");
        }
    }

    #[test]
    fn followed_guard_is_closed_over() {
        for strength in [AbortingGuard, RecoverableGuard] {
            let guard = edges(&[(Feature::BunFile, Feature::S3Client, strength, true)]);
            let decision =
                decide_with_edges(&using(&[Feature::BunFile]), &removing_unused(), &guard);
            assert_eq!(
                decision.reason_of(Feature::S3Client),
                Some(RetainReason::NeededBy {
                    feature: Feature::BunFile,
                    strength,
                })
            );
        }
    }

    #[test]
    fn allowed_name_retains_its_features_and_what_they_need() {
        let requirement = references(&[(Feature::Sqlite, Feature::Glob)]);
        let request = TrimRequest {
            allow: vec![TrimFeature::Sqlite],
            ..removing_unused()
        };
        let decision = decide_with_edges(&using(&[]), &request, &requirement);
        let allowed = TrimFeature::Sqlite.features();
        assert!(allowed.len() > 1);
        for feature in allowed.iter() {
            assert_eq!(
                decision.reason_of(feature),
                Some(RetainReason::Allowed(TrimFeature::Sqlite)),
                "{feature:?}"
            );
        }
        assert_eq!(
            decision.reason_of(Feature::Glob),
            Some(RetainReason::NeededBy {
                feature: Feature::Sqlite,
                strength: Reference,
            })
        );
        assert!(decision.unused.contains(Feature::Sql));
    }

    #[test]
    fn allowed_name_alone_removes_nothing() {
        let request = TrimRequest {
            allow: vec![TrimFeature::Sqlite],
            ..TrimRequest::default()
        };
        let not_compiled = UsedFeatures::with_cause(UnseenCodeCause::ProgramNotCompiled);
        assert!(decide_request(&not_compiled, &request).unused.is_empty());
    }

    #[test]
    fn compiled_program_leaves_out_command_line_and_jit() {
        let outside = Feature::all_outside_compiled_programs();
        for cause in UnseenCodeCause::ALL {
            let used = UsedFeatures::with_cause(cause);
            let decision = decide_request(&used, &TrimRequest::default());
            let opens_whole_runtime = CAUSES_OPENING_WHOLE_RUNTIME.contains(&cause);
            for &feature in Feature::ALL {
                let is_expected = match cause {
                    UnseenCodeCause::ProgramNotCompiled => false,
                    _ => {
                        outside.contains(feature)
                            && !(opens_whole_runtime && ENTERED_BY_BUNDLER.contains(&feature))
                    }
                };
                assert_eq!(
                    decision.unused.contains(feature),
                    is_expected,
                    "{cause:?} {feature:?}"
                );
            }
        }
        assert_eq!(
            decide_request(&using(&[Feature::Sql]), &TrimRequest::default()).unused,
            outside
        );
    }

    #[test]
    fn program_that_bundles_keeps_compilers_unless_trimmed() {
        let used = using(&[Feature::Bundler]);
        let decision = decide_request(&used, &TrimRequest::default());
        for feature in ENTERED_BY_BUNDLER {
            assert_eq!(
                decision.reason_of(feature),
                Some(RetainReason::NeededBy {
                    feature: Feature::Bundler,
                    strength: RecoverableGuard,
                }),
                "{feature:?}"
            );
        }
        assert!(
            decision.unused.contains(Feature::Tools) && decision.unused.contains(Feature::Lint)
        );

        let trimmed = decide_request(&used, &removing_unused());
        assert!(FeatureSet::from_features(&ENTERED_BY_BUNDLER).is_subset_of(&trimmed.unused));
    }

    #[test]
    fn option_keeps_part_of_command_line_in_compiled_program() {
        let helping = RuntimeRequirement::Feature(Feature::Tools);
        let decision = decide_with_option(helping, &TrimRequest::default());
        assert_eq!(
            decision.reason_of(Feature::Tools),
            Some(RetainReason::RequiredByOption(0))
        );
        assert!(decision.unused.contains(Feature::Lint));
    }

    #[test]
    fn what_a_kept_feature_refers_to_stays_in_compiled_program() {
        let requirement = references(&[(Feature::Sql, Feature::Install)]);
        let decision = decide_with_edges(&using(&[]), &TrimRequest::default(), &requirement);
        assert_eq!(
            decision.reason_of(Feature::Install),
            Some(RetainReason::NeededBy {
                feature: Feature::Sql,
                strength: Reference,
            })
        );
        assert!(decision.unused.contains(Feature::Tools));
    }

    #[test]
    fn remove_internal_alone_marks_rest_not_requested() {
        let used = using(&[Feature::Sql]);
        let request = TrimRequest {
            remove_internal: vec![Feature::Ffi],
            ..TrimRequest::default()
        };
        let internal_only = decide_request(&used, &request);
        let mut removed = Feature::all_outside_compiled_programs();
        removed.insert(Feature::Ffi);
        assert_eq!(internal_only.unused, removed);
        let expected = [
            (Feature::Glob, Some(RetainReason::NotRequested)),
            (Feature::HotReload, Some(RetainReason::NotRequested)),
            (Feature::Tools, None),
            (Feature::Sql, Some(RetainReason::Used(None))),
            (Feature::Ffi, None),
        ];
        for (feature, reason) in expected {
            assert_eq!(internal_only.reason_of(feature), reason, "{feature:?}");
        }
        assert_eq!(
            internal_only.retained.len(),
            Feature::ALL.len() - removed.len()
        );
        let is_ascending = |pair: &[Retained]| pair[0].feature < pair[1].feature;
        assert!(internal_only.retained.windows(2).all(is_ascending));

        let request = TrimRequest {
            removes_unused: true,
            ..request
        };
        let unused_too = decide_request(&used, &request);
        for retained in &unused_too.retained {
            assert_ne!(retained.reason, RetainReason::NotRequested);
        }
    }

    #[test]
    fn remove_internal_is_never_checked() {
        let requirement = references(&[(Feature::Ffi, Feature::NativeAddons)]);
        let request = TrimRequest {
            allow: vec![TrimFeature::NativeAddons],
            remove_internal: vec![Feature::NativeAddons],
            ..removing_unused()
        };
        let used = using(&[Feature::NativeAddons, Feature::Ffi]);
        let decision = decide_with_edges(&used, &request, &requirement);
        assert!(decision.unused.contains(Feature::NativeAddons));
        assert!(!decision.unused.contains(Feature::Ffi));
        assert_eq!(decision.reason_of(Feature::NativeAddons), None);
    }

    #[test]
    fn removed_by_name_though_used_and_needed() {
        let requirement = references(&[(Feature::Sql, Feature::Sqlite)]);
        let request = TrimRequest {
            remove: vec![TrimFeature::Sqlite],
            ..removing_unused()
        };
        let used = using(&[Feature::Sqlite, Feature::Sql]);
        let decision = decide_with_edges(&used, &request, &requirement);
        for feature in TrimFeature::Sqlite.features().iter() {
            assert!(decision.unused.contains(feature));
            assert_eq!(decision.removal_of(feature), Removal::Requested);
            assert_eq!(decision.reason_of(feature), None);
        }
        assert_eq!(decision.removal_of(Feature::Sql), Removal::Present);
        assert_eq!(decision.removal_of(Feature::Ffi), Removal::Unused);
    }

    #[test]
    fn option_feature_is_retained() {
        let inspecting = RuntimeRequirement::Feature(Feature::Inspector);
        let decision = decide_with_option(inspecting, &removing_unused());
        assert_eq!(
            decision.reason_of(Feature::Inspector),
            Some(RetainReason::RequiredByOption(0))
        );
        assert_eq!(decision.requirements.len(), 1);
        assert_eq!(&*decision.requirements[0].label, OPTION_LABEL);

        let without_requirement =
            decide_with_option(RuntimeRequirement::Nothing, &removing_unused());
        assert!(without_requirement.unused.contains(Feature::Inspector));
        assert!(without_requirement.requirements.is_empty());
    }

    #[test]
    fn runtime_code_option_retains_program_features() {
        let program_features = Feature::all_entered_from(EnteredFrom::Program);
        for requirement in [
            RuntimeRequirement::RuntimeCode,
            RuntimeRequirement::WholeRuntime,
        ] {
            let decision = decide_with_option(requirement, &removing_unused());
            assert!(
                !decision.unused.intersects(&program_features),
                "{requirement:?}"
            );
            assert!(decision.unused.contains(Feature::Jit), "{requirement:?}");
            assert!(decision.unused.contains(Feature::Tools), "{requirement:?}");
            assert_eq!(
                decision.reason_of(Feature::Sql),
                Some(RetainReason::RequiredByOption(0)),
                "{requirement:?}"
            );
        }
    }

    #[test]
    fn first_reason_wins() {
        let with_witness = |feature: Feature, witness: u32| UsedFeature {
            feature,
            witness: Some(WitnessIndex(witness)),
        };
        let used = UsedFeatures {
            features: vec![
                with_witness(Feature::Ffi, 3),
                with_witness(Feature::Sql, 4),
                with_witness(Feature::Sql, 5),
            ],
            causes: vec![UnseenCode {
                cause: UnseenCodeCause::OptionAdmitsCode,
                witness: None,
            }],
            ..using(&[])
        };
        let request = TrimRequest {
            allow: vec![TrimFeature::Ffi],
            ..removing_unused()
        };
        let requirements =
            references(&[(Feature::Sql, Feature::Ffi), (Feature::Sql, Feature::Glob)]);
        let decision = decide_with_edges(&used, &request, &requirements);
        let expected = [
            (Feature::Ffi, RetainReason::Allowed(TrimFeature::Ffi)),
            (Feature::Sql, RetainReason::Used(Some(WitnessIndex(4)))),
            (Feature::Profilers, RetainReason::AlwaysEntered),
            (Feature::Glob, RetainReason::ReachableByUnseenCode(0)),
        ];
        for (feature, reason) in expected {
            assert_eq!(decision.reason_of(feature), Some(reason), "{feature:?}");
        }

        let profiling = RuntimeRequirement::Feature(Feature::Profilers);
        let decision = decide_with_option(profiling, &removing_unused());
        assert_eq!(
            decision.reason_of(Feature::Profilers),
            Some(RetainReason::RequiredByOption(0))
        );
    }

    #[test]
    fn chain_of_returns_shortest_chain() {
        let requirements = references(&[
            (Feature::Sql, Feature::Glob),
            (Feature::Glob, Feature::Hash),
            (Feature::Hash, Feature::Ffi),
            (Feature::Sql, Feature::Color),
            (Feature::Color, Feature::Ffi),
        ]);
        let decision =
            decide_with_edges(&using(&[Feature::Sql]), &removing_unused(), &requirements);
        assert_eq!(
            decision.chain_of(Feature::Ffi),
            [Feature::Ffi, Feature::Color, Feature::Sql]
        );
        assert_eq!(
            decision.chain_of(Feature::Hash),
            [Feature::Hash, Feature::Glob, Feature::Sql]
        );
        assert_eq!(decision.chain_of(Feature::Sql), [Feature::Sql]);
    }
}
