use super::code_barrels::ImportRequests;
use super::code_load::{Analyzed, CodeTarget, LoadKey, LoadedCode};
use super::*;
use crate::import_sites::{
    ImportSite, ImportSiteKind, ImportSpecifier, ResolvedFrom, is_linked_by_bundler,
    is_name_read_by_transpiler,
};
use crate::resolve::{
    CodeFailure, CodeFile, CodeImportForm, CodeImportKind, CodeRequest, CodeResolution,
    ComputedCandidate, ComputedCodeRequest, ComputedResolution, ComputedUnknown, ExternalKind,
    FinishedFile, HostPayload, HostResolution, LoaderRequest, SiteResolution, join,
};

pub(super) fn resolve_code_imports<'s, 'r>(
    context: &CodeLoadContext<'_, 's, 'r>,
    key: LoadKey<'r>,
    hir: &hir::File<'s>,
    bound: &Bound<'s>,
    analyzed: Analyzed<'s, 'r>,
) -> LoadedCode<'s, 'r> {
    let atoms = &context.atoms;
    let sites = analyzed.analysis.import_sites;
    let erased_before = find_sites_erased_before(context, key, sites);
    let mut resolutions = Vec::with_capacity(sites.len());
    let mut targets = Vec::new();
    for (index, site) in sites.iter().enumerate() {
        if erased_before.is_some_and(|answers| answers[index] == CodeAnswer::Erased) {
            resolutions.push(SiteResolution::Constant(CodeResolution::Erased));
            continue;
        }
        let key = match analyzed.analysis.path_to_resolve_from(index) {
            Some(ResolvedFrom::File(path)) => LoadKey {
                path: context.resolver.keep(atoms.bytes(path)),
                ..key
            },
            Some(ResolvedFrom::PathFromOwnFolder(path)) => {
                let path = atoms.bytes(path);
                let mut whole = join(&context.host.directory_of(key.path), path);
                if path.ends_with(b"/") {
                    whole.extend_from_slice(b"/noop.js");
                }
                LoadKey {
                    path: context.resolver.keep(&whole),
                    ..key
                }
            }
            None => key,
        };
        let alternatives = analyzed.analysis.alternatives_of(&site.specifier);
        let decisions = &analyzed.analysis.decisions;
        let names = match is_name_read_by_transpiler(hir, bound, decisions, site.kind) {
            true => NamesKnown::ToTranspiler,
            false => NamesKnown::ToLoader,
        };
        let resolution = resolve_site(context, key, hir, site, alternatives, names);
        resolutions.push(resolution);
        let origin = TargetOrigin {
            kind: loader_kind(site),
            is_linked_by_bundler: matches!(site.specifier, ImportSpecifier::Constant(_))
                && is_linked_by_bundler(hir, bound, site.kind),
            type_attribute: loader_attribute(hir, site).map(|value| atoms.bytes(value)),
            embed_attribute: embed_attribute(hir, site).map(|value| atoms.bytes(value)),
            is_statement: matches!(
                site.kind,
                ImportSiteKind::Import(_)
                    | ImportSiteKind::ExportFrom(_)
                    | ImportSiteKind::ExportStar(_)
            ),
            increases_depth: (alternatives.iter())
                .any(|&specifier| !is_relative(constant_prefix(atoms, specifier))),
        };
        for file in files_of(resolution) {
            let increases_depth = origin.increases_depth
                && (file.host_module.is_some()
                    || !context.resolver.is_same_package(key.path, file.path));
            let origin = TargetOrigin {
                increases_depth,
                ..origin
            };
            add_target(context, &mut targets, origin, file);
        }
    }
    let mut code = LoadedCode {
        analyzed,
        resolutions,
        implied: Vec::new(),
        targets,
        targets_by_specifier: FxHashMap::default(),
        types_answers: Vec::new(),
        is_in_types_program: false,
        requests: ImportRequests::default(),
        exported_requires: Vec::new(),
    };
    code.index_targets_by_specifier();
    code
}

/// The answers of `CompileInputs::loaded_before` for the sites of the file. Nobody asked for what is behind a site that it erased.
fn find_sites_erased_before<'s>(
    context: &CodeLoadContext<'_, 's, '_>,
    key: LoadKey<'_>,
    sites: &[ImportSite],
) -> Option<&'s [CodeAnswer<'s>]> {
    let known = context.find_loaded_before(key)?.compiled;
    let sites_before = known.analysis.import_sites;
    let has_same_sites = sites.len() == sites_before.len()
        && (sites.iter().zip(sites_before)).all(|(site, before)| site.kind == before.kind);
    debug_assert!(has_same_sites);
    has_same_sites.then_some(known.code_answers)
}

impl<'s, 'r> LoadedCode<'s, 'r> {
    pub(super) fn forget_implied(&mut self) {
        let of_sites = self.resolutions.iter().map(|&it| files_of(it).count());
        self.targets.truncate(of_sites.sum());
        self.implied.clear();
    }

    pub(super) fn index_targets_by_specifier(&mut self) {
        self.targets_by_specifier.clear();
        let mut target = 0;
        let analysis = &self.analyzed.analysis;
        let sites = analysis.import_sites.iter().enumerate();
        for ((index, site), &resolution) in sites.zip(&self.resolutions) {
            if let SiteResolution::Constant(CodeResolution::File(_)) = resolution
                && let ImportSpecifier::Constant(specifier) = site.specifier
                && analysis.path_to_resolve_from(index).is_none()
            {
                let kind = CodeImportKind::from_site(site.kind);
                self.targets_by_specifier
                    .entry((specifier, kind))
                    .or_insert(target);
            }
            target += files_of(resolution).count() as u32;
        }
    }

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

/// `import_sites::is_name_read_by_transpiler`
#[derive(Copy, Clone, PartialEq, Eq)]
enum NamesKnown {
    ToTranspiler,
    ToLoader,
}

fn resolve_site<'r>(
    context: &CodeLoadContext<'_, '_, 'r>,
    key: LoadKey<'r>,
    hir: &hir::File<'_>,
    site: &ImportSite,
    alternatives: &[ImportSpecifier],
    names: NamesKnown,
) -> SiteResolution<'r> {
    // `import.meta.require("bun:fs")`
    let is_unknown = |name: &[u8]| {
        names == NamesKnown::ToLoader && context.host.is_name_for_transpiler_alone(name)
    };
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
        ImportSpecifier::OneOf(_) => {
            let texts = alternatives.iter().map(|&it| match it {
                ImportSpecifier::Constant(text) => (atoms.bytes(text), None),
                ImportSpecifier::Pattern { prefix, suffix } => {
                    (atoms.bytes(prefix), Some(atoms.bytes(suffix)))
                }
                ImportSpecifier::OneOf(_) | ImportSpecifier::Unknown => (&b""[..], Some(&b""[..])),
            });
            let texts = texts.filter(|&(text, end)| end.is_some() || !is_unknown(text));
            let texts: Vec<(&[u8], Option<&[u8]>)> = texts.collect();
            let request = ComputedCodeRequest {
                prefix: b"",
                suffix: b"",
                importer: key.path,
                directory: &directory_of_request(context, key, kind.1),
                kind: kind.0,
                form: kind.1,
            };
            return SiteResolution::Computed(resolver.resolve_alternative_code(&request, &texts));
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
    let resolution = match is_unknown(specifier) {
        true => CodeResolution::NotFound(CodeFailure::ModuleNotFound),
        false => resolve_specifier(context, key, specifier, kind),
    };
    let resolution =
        resolve_file_loaded_another_way(context, key, hir, site, specifier, resolution);
    let resolution = resolve_data_url(context, hir, site, resolution).unwrap_or(resolution);
    let resolution =
        resolve_at_run_time(context, site, specifier, resolution).unwrap_or(resolution);
    SiteResolution::Constant(match is_get_builtin_module(site.kind) {
        true => builtin_module_or_erased(resolution, &|specifier| {
            context.host.is_builtin_module_in_other_program(specifier)
        }),
        false => resolution,
    })
}

/// `import path from "package/dist/library.js" with { type: "file" }`: another program of the realm holds the file as code, and would answer with what the code exports.
/// What is asked for is the path of the file, its text or its data, and that is a module of its own, which this program holds.
/// `import text from "./page.html" with { type: "text" }`: so it is with a page, which the run time would bundle and serve.
fn resolve_file_loaded_another_way<'r>(
    context: &CodeLoadContext<'_, '_, 'r>,
    key: LoadKey<'r>,
    hir: &hir::File<'_>,
    site: &ImportSite,
    specifier: &[u8],
    resolution: CodeResolution<'r>,
) -> CodeResolution<'r> {
    let is_outside = matches!(resolution, CodeResolution::External { .. });
    let hands_type_to_loader = site.kind.hands_type_to_loader();
    if let (CodeResolution::File(file), Some(type_attribute)) =
        (resolution, loader_attribute(hir, site))
        && hands_type_to_loader
        && file.host_module.is_none()
        && (context.host).is_form_in_other_program(file.path, context.atoms.bytes(type_attribute))
    {
        return CodeResolution::External {
            specifier: file.path,
            kind: ExternalKind::UncompiledCode,
        };
    }
    let Some(type_attribute) = loader_attribute(hir, site).filter(|_| is_outside) else {
        return resolution;
    };
    // As for a macro: the file itself is looked for, whoever holds it.
    let kind = (CodeImportKind::from_site(site.kind), CodeImportForm::Macro);
    let path = match resolve_specifier(context, key, specifier, kind) {
        CodeResolution::External {
            specifier: path,
            kind: ExternalKind::UncompiledCode,
        } if context.host.is_in_other_program(path) && !context.host.is_left_to_loader(path) => {
            path
        }
        CodeResolution::External {
            specifier: path,
            kind: ExternalKind::HostValue,
        } if context.host.leaves_to_run_time(path) => path,
        _ => return resolution,
    };
    if hands_type_to_loader
        && (context.host).is_form_in_other_program(path, context.atoms.bytes(type_attribute))
    {
        return resolution;
    }
    let loader_with = |type_attribute| {
        let kind = loader_kind(site);
        let request = (context.resolver).loader_request(path, kind, type_attribute, None);
        context.host.loader_of(&request)
    };
    match loader_with(Some(context.atoms.bytes(type_attribute))) == loader_with(None) {
        true => resolution,
        false => CodeResolution::File(CodeFile {
            path,
            host_module: None,
        }),
    }
}

fn resolve_data_url<'r>(
    context: &CodeLoadContext<'_, '_, 'r>,
    hir: &hir::File<'_>,
    site: &ImportSite,
    resolution: CodeResolution<'r>,
) -> Option<CodeResolution<'r>> {
    let CodeResolution::External {
        specifier,
        kind: ExternalKind::UncompiledCode,
    } = resolution
    else {
        return None;
    };
    let type_attribute = context.atoms.bytes(loader_attribute(hir, site)?);
    let path = (context.host).create_file_from_data_url(specifier, type_attribute)?;
    Some(CodeResolution::File(CodeFile {
        path: context.resolver.keep(&path),
        host_module: None,
    }))
}

// A program may name a file that is created after the build, such as a configuration file under `/etc`.
fn resolve_at_run_time<'r>(
    context: &CodeLoadContext<'_, '_, 'r>,
    site: &ImportSite,
    specifier: &[u8],
    resolution: CodeResolution<'r>,
) -> Option<CodeResolution<'r>> {
    let is_load = matches!(
        site.kind,
        ImportSiteKind::ImportCall(_)
            | ImportSiteKind::Require(_)
            | ImportSiteKind::RequireResolve(_)
            | ImportSiteKind::ImportMetaRequire(_)
    );
    let is_declaration = matches!(
        site.kind,
        ImportSiteKind::Import(_)
            | ImportSiteKind::ExportFrom(_)
            | ImportSiteKind::ExportStar(_)
            | ImportSiteKind::ImportEquals(_)
    );
    if !is_load && !is_declaration {
        return None;
    }
    let kind = context.host.kind_of_file_missing_at_build()?;
    let is_absent = match resolution {
        CodeResolution::NotFound(CodeFailure::ModuleNotFound) => {
            is_load && bun_paths::is_absolute(specifier)
        }
        // `./a.ts?fresh=1` is one more module of the file. Where the program holds none, `CodeHost::holds_modules_with_queries`, only code from disk can be one.
        CodeResolution::NotFound(CodeFailure::QueryString) => kind == ExternalKind::UncompiledCode,
        _ => false,
    };
    is_absent.then(|| CodeResolution::External {
        specifier: context.resolver.keep(specifier),
        kind,
    })
}

fn is_get_builtin_module(kind: ImportSiteKind) -> bool {
    matches!(kind, ImportSiteKind::GetBuiltinModule(_))
}

fn builtin_module_or_erased<'r>(
    resolution: CodeResolution<'r>,
    is_builtin_module_in_other_program: &dyn Fn(&[u8]) -> bool,
) -> CodeResolution<'r> {
    match resolution {
        CodeResolution::HostModule(_)
        | CodeResolution::External {
            kind: ExternalKind::HostValue,
            ..
        } => resolution,
        CodeResolution::File(file) if file.host_module.is_some() => resolution,
        CodeResolution::External {
            kind: ExternalKind::UncompiledCode,
            specifier,
        } if is_builtin_module_in_other_program(specifier) => resolution,
        CodeResolution::File(_)
        | CodeResolution::External {
            kind: ExternalKind::UncompiledCode,
            ..
        }
        | CodeResolution::Erased
        | CodeResolution::NotFound(_) => CodeResolution::Erased,
    }
}

fn directory_of_request<'r>(
    context: &CodeLoadContext<'_, '_, 'r>,
    key: LoadKey<'r>,
    form: CodeImportForm,
) -> Cow<'r, [u8]> {
    match form {
        CodeImportForm::Dynamic => context.host.directory_of_dynamic_imports(key.path),
        CodeImportForm::Static | CodeImportForm::ResolveOnly | CodeImportForm::Macro => {
            context.host.directory_of(key.path)
        }
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
        directory: &directory_of_request(context, key, form),
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
            directory: &directory_of_request(context, key, form),
            kind,
            form,
        })
}

fn constant_prefix<'a>(atoms: &'a Interner<'_>, specifier: ImportSpecifier) -> &'a [u8] {
    match specifier {
        ImportSpecifier::Constant(text) | ImportSpecifier::Pattern { prefix: text, .. } => {
            atoms.bytes(text)
        }
        ImportSpecifier::OneOf(_) | ImportSpecifier::Unknown => b"",
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

fn loader_kind(site: &ImportSite) -> CodeImportKind {
    match site.kind {
        ImportSiteKind::ImportEquals(_)
        | ImportSiteKind::Require(_)
        | ImportSiteKind::ImportMetaRequire(_) => CodeImportKind::Require,
        _ => CodeImportKind::Import,
    }
}

#[derive(Copy, Clone)]
struct TargetOrigin<'a> {
    kind: CodeImportKind,
    is_linked_by_bundler: bool,
    type_attribute: Option<&'a [u8]>,
    embed_attribute: Option<&'a [u8]>,
    is_statement: bool,
    increases_depth: bool,
}

const IMPLIED_IMPORT: TargetOrigin<'static> = TargetOrigin {
    kind: CodeImportKind::Import,
    is_linked_by_bundler: true,
    type_attribute: None,
    embed_attribute: None,
    is_statement: true,
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
        is_linked_by_bundler,
        type_attribute,
        embed_attribute,
        is_statement,
        increases_depth,
    } = origin;
    let request = LoaderRequest {
        is_linked_by_bundler,
        ..resolver.loader_request(file.path, kind, type_attribute, embed_attribute)
    };
    let loader = host.loader_of(&request);
    let key = LoadKey {
        path: file.path,
        loader,
    };
    let index = targets.len() as u32;
    targets.push(CodeTarget {
        key: find_file_required_before(context, key).unwrap_or(key),
        host_module: file.host_module,
        increases_depth,
        has_loader_attribute: type_attribute.is_some(),
        is_loaded_with_importer: is_statement,
        has_shared_type: is_statement && type_attribute.is_some_and(|it| it != b"json"),
    });
    index
}

/// `import_what_is_required`, as `CompileInputs::loaded_before` has decided it: the file that is required may be one that this load does not reach.
fn find_file_required_before<'r>(
    context: &CodeLoadContext<'_, '_, 'r>,
    key: LoadKey<'r>,
) -> Option<LoadKey<'r>> {
    context.inputs.loaded_before?;
    if key.loader != HostLoader::default() {
        return None;
    }
    let required = LoadKey {
        path: context.resolver.file_required_in_place_of(key.path)?,
        ..key
    };
    context.find_loaded_before(required).map(|_| required)
}

pub(super) fn files_of(resolution: SiteResolution<'_>) -> impl Iterator<Item = CodeFile<'_>> {
    let (file, candidates) = match resolution {
        SiteResolution::Constant(resolution) => (file_of(resolution), &[][..]),
        SiteResolution::Computed(resolution) => (None, candidates_of(resolution)),
    };
    let files = candidates.iter().filter_map(file_of_candidate);
    file.into_iter().chain(files)
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
