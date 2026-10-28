use std::borrow::Cow;

use bun_core::ZStr;
use bun_options_types::aot_options::{AotOptions, ExplainSet};
use bun_options_types::trim::TrimRequest;
use bun_standalone_graph::StandaloneModuleGraph::{Flags, target_executable};
use bun_standalone_graph::with_executable_image;
use bun_trim::{
    Decision, Feature, FeatureEdges, OptionRequirement, RuntimeRequirement, TrimError, TrimInput,
    TrimPlan, UsedFeatures,
};

use super::{CompileFailure, CompileProduct, CompileRequest};
use crate::cli::startup_options::{INSPECTOR_REQUIREMENT, read_exec_argv};

pub(crate) fn collect_exec_argv_requirements(exec_argv: &[u8]) -> Vec<OptionRequirement> {
    read_exec_argv(exec_argv).requirements
}

// The engine reads the name of a check without regard to hyphens and case.
fn names_validate(check: &[u8]) -> bool {
    check
        .iter()
        .filter(|&&byte| byte != b'-')
        .map(u8::to_ascii_lowercase)
        .eq(*b"validate")
}

fn validates_at_run_time(options: &AotOptions) -> bool {
    options
        .option_words
        .iter()
        .any(|word| match word.strip_prefix(b"check=") {
            Some(checks) => bun_core::strings::split(checks, b",").any(names_validate),
            None => &**word == b"validate",
        })
}

// An embedded `--inspect` admits the inspector too, and is listed already.
pub(super) fn add_build_option_requirements(
    options: &AotOptions,
    requirements: &mut Vec<OptionRequirement>,
) {
    let build_options = [
        (
            options.admits_inspector,
            INSPECTOR_REQUIREMENT,
            "--compile-inspector",
        ),
        (
            validates_at_run_time(options),
            RuntimeRequirement::Feature(Feature::ImageCompiler),
            "--aot-validate",
        ),
    ];
    for (is_set, requirement, label) in build_options {
        let is_listed = requirements
            .iter()
            .any(|option| option.requirement == requirement);
        if is_set && !is_listed {
            requirements.push(OptionRequirement {
                requirement,
                label: Box::from(label.as_bytes()),
            });
        }
    }
}

pub(crate) fn trim_settings_of(
    flags: Flags,
    exec_argv: &[u8],
    embeds_source_maps: bool,
) -> bun_trim::ExecutableSettings {
    bun_trim::ExecutableSettings {
        autoloads_bunfig: !flags.contains(Flags::DISABLE_AUTOLOAD_BUNFIG),
        autoloads_package_json: !flags.contains(Flags::DISABLE_AUTOLOAD_PACKAGE_JSON),
        autoloads_tsconfig: !flags.contains(Flags::DISABLE_AUTOLOAD_TSCONFIG),
        embeds_source_maps,
        exec_argv: collect_exec_argv_requirements(exec_argv),
    }
}

pub(crate) fn plan_trimming(
    used: &UsedFeatures,
    settings: &bun_trim::ExecutableSettings,
    request: &TrimRequest,
    template: &ZStr,
) -> Result<Option<TrimPlan>, CompileFailure> {
    let input = TrimInput {
        used,
        settings,
        request,
    };
    if !input.removes_anything() {
        return Ok(None);
    }
    match with_executable_image(template, |image| bun_trim::plan(&input, image)) {
        Err(error) => Err(CompileFailure::TemplateUnreadable { error }),
        // Nobody asked: a Bun that can't be cut is copied whole.
        Ok(Err(TrimError::Unsupported(_))) if !request.is_enabled() => Ok(None),
        Ok(Err(error)) => Err(CompileFailure::Trim(error)),
        Ok(Ok(plan)) => Ok(Some(plan)),
    }
}

/// `without_tools`: what every executable leaves out, `--trim` or not.
#[allow(clippy::large_enum_variant)]
pub(super) enum Trimming {
    NotAsked {
        without_tools: Option<TrimPlan>,
    },
    Decided {
        decision: Decision,
        has_edges: bool,
        without_tools: Option<TrimPlan>,
    },
    Planned(TrimPlan),
}

impl Trimming {
    pub(super) fn plan(&self) -> Option<&TrimPlan> {
        match self {
            Trimming::Planned(plan) => Some(plan),
            Trimming::NotAsked { without_tools } | Trimming::Decided { without_tools, .. } => {
                without_tools.as_ref()
            }
        }
    }

    pub(super) fn decision(&self) -> Option<&Decision> {
        match self {
            Trimming::NotAsked { .. } => None,
            Trimming::Decided { decision, .. } => Some(decision),
            Trimming::Planned(plan) => Some(plan.decision()),
        }
    }

    pub(super) fn has_edges(&self) -> bool {
        match self {
            Trimming::Decided { has_edges, .. } => *has_edges,
            Trimming::NotAsked { .. } | Trimming::Planned(_) => true,
        }
    }
}

pub(super) fn decide_trimming(
    request: &mut CompileRequest<'_, '_>,
    used: &UsedFeatures,
) -> Result<Trimming, CompileFailure> {
    let options = request.options;
    let trim = &options.trim;
    let executable = &mut request.executable;
    let mut settings = trim_settings_of(
        executable.flags,
        executable.exec_argv,
        executable.embeds_source_maps,
    );
    add_build_option_requirements(options, &mut settings.exec_argv);
    let template = target_executable(
        executable.target,
        executable.env,
        executable.executable_path,
    )
    .map_err(CompileFailure::Executable)?;

    let plan = match request.product {
        CompileProduct::Executable { .. } => plan_trimming(used, &settings, trim, &template)?,
        _ => None,
    };
    match plan {
        Some(plan) if trim.is_enabled() => Ok(Trimming::Planned(plan)),
        without_tools if trim.is_enabled() || options.explain.contains(ExplainSet::RUNTIME_USE) => {
            Ok(decide_without_plan(
                used,
                &settings,
                trim,
                &template,
                without_tools,
            ))
        }
        without_tools => Ok(Trimming::NotAsked { without_tools }),
    }
}

fn decide_without_plan(
    used: &UsedFeatures,
    settings: &bun_trim::ExecutableSettings,
    trim: &TrimRequest,
    template: &ZStr,
    without_tools: Option<TrimPlan>,
) -> Trimming {
    let (edges, has_edges) = match with_executable_image(template, bun_trim::read_feature_edges) {
        Ok(Ok(edges)) => (edges, true),
        Ok(Err(_)) | Err(_) => (FeatureEdges::default(), false),
    };
    // A report without `--trim` shows what `--trim` would do.
    let request = if trim.is_enabled() {
        Cow::Borrowed(trim)
    } else {
        Cow::Owned(TrimRequest {
            removes_unused: true,
            ..trim.clone()
        })
    };
    let input = TrimInput {
        used,
        settings,
        request: &request,
    };
    Trimming::Decided {
        decision: bun_trim::decide(&input, &edges),
        has_edges,
        without_tools,
    }
}
