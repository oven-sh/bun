use super::code_barrels::ImportRequests;
use super::code_load::{Analyzed, CodeTarget, LoadKey, LoadedCode};
use super::*;
use crate::import_sites::{ImportSite, ImportSiteKind, ImportSpecifier};
use crate::resolve::{
    CodeFile, CodeImportForm, CodeImportKind, CodeRequest, CodeResolution, ComputedCandidate,
    ComputedCodeRequest, ComputedResolution, ComputedUnknown, ExternalKind, FinishedFile,
    HostPayload, HostResolution, SiteResolution,
};

pub(super) fn resolve_code_imports<'s, 'r>(
    context: &CodeLoadContext<'_, 's, 'r>,
    key: LoadKey<'r>,
    hir: &hir::File<'s>,
    analyzed: Analyzed<'s, 'r>,
) -> LoadedCode<'s, 'r> {
    let atoms = &context.atoms;
    let sites = analyzed.analysis.import_sites;
    let mut resolutions = Vec::with_capacity(sites.len());
    let mut targets = Vec::new();
    let mut targets_by_specifier = FxHashMap::default();
    for site in sites {
        let resolution = resolve_site(context, key, hir, site);
        resolutions.push(resolution);
        let origin = TargetOrigin {
            kind: loader_kind(site),
            type_attribute: loader_attribute(hir, site).map(|value| atoms.bytes(value)),
            embed_attribute: embed_attribute(hir, site).map(|value| atoms.bytes(value)),
            increases_depth: !is_relative(constant_prefix(atoms, site.specifier)),
        };
        let origin_of = |file: CodeFile<'r>| TargetOrigin {
            increases_depth: origin.increases_depth
                && (file.host_module.is_some()
                    || !context.resolver.is_same_package(key.path, file.path)),
            ..origin
        };
        match resolution {
            SiteResolution::Constant(resolution) => {
                let Some(file) = file_of(resolution) else {
                    continue;
                };
                let target = add_target(context, &mut targets, origin_of(file), file);
                if let ImportSpecifier::Constant(specifier) = site.specifier {
                    let kind = CodeImportKind::from_site(site.kind);
                    targets_by_specifier
                        .entry((specifier, kind))
                        .or_insert(target);
                }
            }
            SiteResolution::Computed(resolution) => {
                let files = candidates_of(resolution)
                    .iter()
                    .filter_map(file_of_candidate);
                for file in files {
                    add_target(context, &mut targets, origin_of(file), file);
                }
            }
        }
    }
    LoadedCode {
        analyzed,
        resolutions,
        implied: Vec::new(),
        targets,
        targets_by_specifier,
        types_answers: Vec::new(),
        requests: ImportRequests::default(),
    }
}

impl<'s, 'r> LoadedCode<'s, 'r> {
    pub(super) fn add_implied(
        &mut self,
        context: &CodeLoadContext<'_, 's, 'r>,
        key: LoadKey<'r>,
        hir: &hir::File<'s>,
        bound: &Bound<'s>,
        payload: &mut Option<HostPayload>,
    ) {
        debug_assert!(self.implied.is_empty());
        let &CodeLoadContext { host, resolver, .. } = context;
        let request = FinishedFile {
            path: key.path,
            loader: key.loader,
            hir,
            bound,
            analysis: &self.analyzed.analysis,
            atoms: &context.atoms,
            resolutions: &self.resolutions,
        };
        let answers = host.finish_file(&request, payload);
        for answer in answers {
            let resolution = match answer {
                HostResolution::Path(path) => CodeResolution::File(CodeFile {
                    path: resolver.keep(&path),
                    host_module: None,
                }),
                HostResolution::ModuleSource { module, path } => CodeResolution::File(CodeFile {
                    path: resolver.keep(&path),
                    host_module: Some(module),
                }),
                HostResolution::Module(module) => CodeResolution::HostModule(module),
                _ => continue,
            };
            self.implied.push(resolution);
            if let Some(file) = file_of(resolution) {
                add_target(context, &mut self.targets, IMPLIED_IMPORT, file);
            }
        }
    }
}

fn resolve_site<'r>(
    context: &CodeLoadContext<'_, '_, 'r>,
    key: LoadKey<'r>,
    hir: &hir::File<'_>,
    site: &ImportSite,
) -> SiteResolution<'r> {
    let is_constant = matches!(site.specifier, ImportSpecifier::Constant(_));
    debug_assert!(is_constant || !site.is_host_value && !is_get_builtin_module(site.kind));
    let (atoms, resolver) = (&context.atoms, context.resolver);
    let kind = (
        CodeImportKind::from_site(site.kind),
        CodeImportForm::from_site(site.kind),
    );
    let specifier = match site.specifier {
        ImportSpecifier::Constant(specifier) => atoms.bytes(specifier),
        ImportSpecifier::Pattern { prefix, suffix } => {
            let (prefix, suffix) = (atoms.bytes(prefix), atoms.bytes(suffix));
            let resolution = resolve_pattern(context, key, prefix, suffix, kind);
            return SiteResolution::Computed(resolution);
        }
        ImportSpecifier::Unknown => {
            let resolution = resolve_pattern(context, key, b"", b"", kind);
            return SiteResolution::Computed(ComputedResolution::All {
                cause: ComputedUnknown::NoPattern,
                host_modules: candidates_of(resolution),
            });
        }
    };
    if site.is_host_value {
        return SiteResolution::Constant(CodeResolution::External {
            specifier: resolver.keep(specifier),
            kind: ExternalKind::HostValue,
        });
    }
    if is_macro_import(hir, site) {
        return SiteResolution::Constant(CodeResolution::Erased);
    }
    let resolution = resolve_specifier(context, key, specifier, kind);
    SiteResolution::Constant(match is_get_builtin_module(site.kind) {
        true => builtin_module_or_erased(resolution),
        false => resolution,
    })
}

fn is_get_builtin_module(kind: ImportSiteKind) -> bool {
    matches!(kind, ImportSiteKind::GetBuiltinModule(_))
}

fn builtin_module_or_erased(resolution: CodeResolution<'_>) -> CodeResolution<'_> {
    match resolution {
        CodeResolution::HostModule(_)
        | CodeResolution::External {
            kind: ExternalKind::HostValue,
            ..
        } => resolution,
        CodeResolution::File(file) if file.host_module.is_some() => resolution,
        CodeResolution::File(_)
        | CodeResolution::External {
            kind: ExternalKind::UncompiledCode,
            ..
        }
        | CodeResolution::Erased
        | CodeResolution::NotFound(_) => CodeResolution::Erased,
    }
}

fn resolve_specifier<'r>(
    context: &CodeLoadContext<'_, '_, 'r>,
    key: LoadKey<'r>,
    specifier: &[u8],
    (kind, form): (CodeImportKind, CodeImportForm),
) -> CodeResolution<'r> {
    context.resolver.resolve_code(&CodeRequest {
        specifier,
        importer: key.path,
        directory: &context.host.directory_of(key.path),
        kind,
        form,
    })
}

fn resolve_pattern<'r>(
    context: &CodeLoadContext<'_, '_, 'r>,
    key: LoadKey<'r>,
    prefix: &[u8],
    suffix: &[u8],
    (kind, form): (CodeImportKind, CodeImportForm),
) -> ComputedResolution<'r> {
    context
        .resolver
        .resolve_computed_code(&ComputedCodeRequest {
            prefix,
            suffix,
            importer: key.path,
            directory: &context.host.directory_of(key.path),
            kind,
            form,
        })
}

fn constant_prefix<'a>(atoms: &'a Interner<'_>, specifier: ImportSpecifier) -> &'a [u8] {
    match specifier {
        ImportSpecifier::Constant(text) | ImportSpecifier::Pattern { prefix: text, .. } => {
            atoms.bytes(text)
        }
        ImportSpecifier::Unknown => b"",
    }
}

fn type_attribute(hir: &hir::File<'_>, site: &ImportSite) -> Option<Atom> {
    let attributes = site.attributes.some()?;
    hir.import_attribute(attributes, known::r#type)
}

fn is_macro_import(hir: &hir::File<'_>, site: &ImportSite) -> bool {
    match site.kind {
        ImportSiteKind::Import(_)
        | ImportSiteKind::ExportFrom(_)
        | ImportSiteKind::ExportStar(_) => type_attribute(hir, site) == Some(known::r#macro),
        _ => false,
    }
}

fn loader_attribute(hir: &hir::File<'_>, site: &ImportSite) -> Option<Atom> {
    type_attribute(hir, site).filter(|&value| value != known::r#macro)
}

fn embed_attribute(hir: &hir::File<'_>, site: &ImportSite) -> Option<Atom> {
    let attributes = site.attributes.some()?;
    hir.import_attribute(attributes, known::embed)
}

/// `bun run` reads a required file as code when no loader has its extension.
fn loader_kind(site: &ImportSite) -> CodeImportKind {
    let is_constant = matches!(site.specifier, ImportSpecifier::Constant(_));
    match site.kind {
        ImportSiteKind::ImportEquals(_)
        | ImportSiteKind::Require(_)
        | ImportSiteKind::ImportMetaRequire(_)
            if is_constant =>
        {
            CodeImportKind::Require
        }
        _ => CodeImportKind::Import,
    }
}

#[derive(Copy, Clone)]
struct TargetOrigin<'a> {
    kind: CodeImportKind,
    type_attribute: Option<&'a [u8]>,
    embed_attribute: Option<&'a [u8]>,
    increases_depth: bool,
}

const IMPLIED_IMPORT: TargetOrigin<'static> = TargetOrigin {
    kind: CodeImportKind::Import,
    type_attribute: None,
    embed_attribute: None,
    increases_depth: false,
};

fn add_target<'r>(
    context: &CodeLoadContext<'_, '_, 'r>,
    targets: &mut Vec<CodeTarget<'r>>,
    origin: TargetOrigin<'_>,
    file: CodeFile<'r>,
) -> u32 {
    let &CodeLoadContext { host, resolver, .. } = context;
    let TargetOrigin {
        kind,
        type_attribute,
        embed_attribute,
        increases_depth,
    } = origin;
    let request = resolver.loader_request(file.path, kind, type_attribute, embed_attribute);
    let loader = host.loader_of(&request);
    let can_have_typed_version =
        loader == HostLoader::default() && is_javascript_file(host, file.path);
    let typed_path = match can_have_typed_version {
        true => (resolver.typed_version_of(file.path))
            .filter(|typed| !typed.is_missing)
            .map(|typed| typed.path),
        false => None,
    };
    let index = targets.len() as u32;
    targets.push(CodeTarget {
        key: LoadKey {
            path: file.path,
            loader,
        },
        host_module: file.host_module,
        typed_path,
        increases_depth,
        has_loader_attribute: type_attribute.is_some(),
    });
    index
}

fn file_of(resolution: CodeResolution<'_>) -> Option<CodeFile<'_>> {
    match resolution {
        CodeResolution::File(file) => Some(file),
        _ => None,
    }
}

fn file_of_candidate<'r>(candidate: &ComputedCandidate<'r>) -> Option<CodeFile<'r>> {
    match *candidate {
        ComputedCandidate::File(file) => Some(file),
        ComputedCandidate::HostModule(_) => None,
    }
}

fn candidates_of<'r>(resolution: ComputedResolution<'r>) -> &'r [ComputedCandidate<'r>] {
    match resolution {
        ComputedResolution::Candidates { candidates, .. } => candidates,
        ComputedResolution::All { host_modules, .. } => host_modules,
    }
}

#[cfg(test)]
mod tests;
