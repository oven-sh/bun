#[cfg(test)]
mod tests;

use bun_sema::import_sites::{ImportSite, ImportSiteKind};
use bun_sema::program::HostModuleId;
use bun_sema::resolve::{
    CodeResolution, ExternalKind, FinishedFile, HostResolution, SiteResolution,
};
use bun_sema::util::SharedSort;

use crate::builtins::resolve::resolve_file_served_by_other_images;
use crate::builtins::{
    BuiltinNames, ImportTargets, Platforms, ReplacedMembersSought, ResolveInput, ResolvedBuiltins,
    RuntimeFunction, RuntimeModule, SourceDialect, resolve_file, table,
};
use crate::load::evaluated_texts::{EvaluatedTexts, find_evaluated_function};
use crate::load::react_compiler;
use crate::load::replaced_builtins::{ProductFiles, members_sought_in_file_outside_packages};
use crate::load::runtime_modules::RuntimeModules;
use crate::load::sources::{EvaluatedTextSite, ParsedSource, SourceKind};

pub(crate) struct BuiltinUseInput<'a> {
    pub names: &'a BuiltinNames,
    pub platform: Platforms,
    pub replaced: &'a [u32],
    pub replaced_members_sought: ReplacedMembersSought,
    /// `AotOptions::imports_are_in_other_images`
    pub is_served_by_other_images: bool,
}

pub(crate) fn finish_application_file(
    input: &BuiltinUseInput<'_>,
    texts: Option<&EvaluatedTexts>,
    needs_react_declarations: bool,
    request: &FinishedFile<'_, '_>,
    source: &mut ParsedSource,
) -> Vec<HostResolution> {
    source.evaluated_text_sites.clear();
    source.names_main_module_in_text_left_to_run_time = false;
    source
        .library_modules_named_in_text_left_to_run_time
        .clear();
    if source.kind == SourceKind::EvaluatedText {
        source.evaluated_function =
            find_evaluated_function(request, input.is_served_by_other_images);
    }
    let resolved = resolve_builtins(input, request, SourceDialect::Program);
    let mut answers: Vec<HostResolution> = collect_host_module_ids(resolved.loaded_modules())
        .into_iter()
        .map(HostResolution::Module)
        .collect();
    // Where the executable forbids the evaluation of text, a call with constant text stays a call, which throws.
    let compiled_texts = texts.map_or(&[][..], |_| resolved.evaluated_texts());
    for (index, text) in compiled_texts.iter().enumerate() {
        let Some(path) =
            texts.and_then(|texts| texts.add(request.path, index, text, request.atoms))
        else {
            for part in text.texts.iter().map(|&part| request.atoms.bytes(part)) {
                if !bun_core::strings::contains(part, b"mainModule") {
                    continue;
                }
                source.names_main_module_in_text_left_to_run_time = true;
                // What stands between two quotes, whatever the text does with it.
                let quoted = bun_core::strings::split_any(part, b"\"'`");
                (source.library_modules_named_in_text_left_to_run_time)
                    .extend(quoted.filter_map(table::module_by_specifier));
            }
            continue;
        };
        source.evaluated_text_sites.push(EvaluatedTextSite {
            call: text.call,
            implied_answer: answers.len() as u32,
        });
        answers.push(HostResolution::Path(path));
    }
    if needs_react_declarations {
        answers.push(HostResolution::Path(
            react_compiler::DECLARATIONS_PATH.to_vec(),
        ));
    }
    source.builtins = resolved;
    answers
}

pub(crate) fn finish_runtime_file(
    input: &BuiltinUseInput<'_>,
    runtime_modules: &RuntimeModules,
    request: &FinishedFile<'_, '_>,
    source: &mut ParsedSource,
) -> Vec<HostResolution> {
    let resolved = resolve_builtins(input, request, SourceDialect::Runtime);
    let mut answers = collect_implied_answers(
        runtime_modules,
        resolved.loaded_modules(),
        resolved.called_functions(),
        request.path,
    );
    let declarations = runtime_modules.declarations_of_module(request.path);
    answers.extend(declarations.map(HostResolution::Path));
    source.builtins = resolved;
    answers
}

fn resolve_builtins(
    input: &BuiltinUseInput<'_>,
    request: &FinishedFile<'_, '_>,
    dialect: SourceDialect,
) -> ResolvedBuiltins {
    let targets = collect_import_targets(request.analysis.import_sites, request.resolutions);
    let resolve = match input.is_served_by_other_images {
        true => resolve_file_served_by_other_images,
        false => resolve_file,
    };
    resolve(&ResolveInput {
        hir: request.hir,
        bound: request.bound,
        decisions: &request.analysis.decisions,
        module_format: request.analysis.module_format,
        targets: &ImportTargets::new(&targets),
        names: input.names,
        platform: input.platform,
        dialect,
        replaced: input.replaced,
        replaced_members_sought: match input.replaced_members_sought {
            // The scan before the first build has read the helpers of the tests.
            ReplacedMembersSought::WrittenOrNamed => members_sought_in_file_outside_packages(
                &targets,
                false,
                ProductFiles::AreReadAsTestsAre,
            ),
            sought => sought,
        },
    })
}

pub(crate) fn takes_from_test_runner(request: &FinishedFile<'_, '_>) -> bool {
    let targets = collect_import_targets(request.analysis.import_sites, request.resolutions);
    (targets.iter()).any(|target| target.1 == Some(RuntimeModule::BunTest))
}

fn collect_import_targets(
    sites: &[ImportSite],
    resolutions: &[SiteResolution<'_>],
) -> Vec<(ImportSiteKind, Option<RuntimeModule>)> {
    debug_assert_eq!(sites.len(), resolutions.len());
    let mut targets: Vec<(ImportSiteKind, Option<RuntimeModule>)> = sites
        .iter()
        .zip(resolutions)
        .map(|(site, &resolution)| (site.kind, target_module(resolution)))
        .collect();
    targets.shared_sort_unstable_by_key(|target| target.0);
    targets
}

fn target_module(resolution: SiteResolution<'_>) -> Option<RuntimeModule> {
    let id = match resolution {
        SiteResolution::Constant(CodeResolution::HostModule(id)) => id,
        SiteResolution::Constant(CodeResolution::File(file)) => file.host_module?,
        // With --no-builtin-modules. The exports of "bun" are the members of the global `Bun`, which needs no module.
        SiteResolution::Constant(CodeResolution::External {
            specifier: b"bun",
            kind: ExternalKind::HostValue,
        }) => return Some(RuntimeModule::Bun),
        SiteResolution::Constant(
            CodeResolution::External { .. } | CodeResolution::Erased | CodeResolution::NotFound(_),
        )
        | SiteResolution::Computed(_) => return None,
    };
    RuntimeModule::from_registry_id(id.0)
}

fn collect_host_module_ids(modules: impl Iterator<Item = RuntimeModule>) -> Vec<HostModuleId> {
    let mut ids: Vec<HostModuleId> = modules
        .map(|module| HostModuleId(module.registry_id()))
        .collect();
    ids.shared_sort_unstable();
    ids.dedup();
    ids
}

fn collect_implied_answers(
    runtime_modules: &RuntimeModules,
    modules: impl Iterator<Item = RuntimeModule>,
    functions: impl Iterator<Item = RuntimeFunction>,
    own_path: &[u8],
) -> Vec<HostResolution> {
    let mut function_files: Vec<Vec<u8>> = functions
        .filter_map(|function| runtime_modules.function_file_path(function))
        .collect();
    function_files.shared_sort_unstable();
    function_files.dedup();
    collect_host_module_ids(modules)
        .into_iter()
        .map(|id| runtime_modules.module_resolution(id))
        .chain(function_files.into_iter().map(HostResolution::Path))
        .filter(|answer| answer_path(answer) != Some(own_path))
        .collect()
}

fn answer_path(answer: &HostResolution) -> Option<&[u8]> {
    match answer {
        HostResolution::Path(path) | HostResolution::ModuleSource { path, .. } => {
            Some(path.as_slice())
        }
        _ => None,
    }
}
