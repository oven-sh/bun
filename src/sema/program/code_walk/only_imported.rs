//! `bun run` has two loaders. The one behind `require`, which also loads an entry point and everything that is imported while an ES module is being
//! required, takes `.cjs` for CommonJS and `.mjs` for an ES module. The one behind `import` asks only for the "type" of the package. Most texts say
//! what they are. A file whose text does not is loaded again here once the walk knows that `import` alone reaches it.

use super::*;
use crate::module_format::ModuleFormat;
use crate::resolve::CodeImportKind;

#[derive(Copy, Clone, PartialEq, Eq, Debug)]
pub(super) enum LoadedBy {
    Require,
    ImportAlone,
    /// Loading it as an import brought a `require` of it into the program.
    RequireAfterAll,
}

impl LoadedBy {
    pub(super) fn as_loaded_before(was_only_imported: bool) -> LoadedBy {
        match was_only_imported {
            true => LoadedBy::ImportAlone,
            false => LoadedBy::Require,
        }
    }

    pub(super) fn is_import_alone(self) -> bool {
        self == LoadedBy::ImportAlone
    }
}

fn loading_kind(site: ImportSiteKind) -> Option<CodeImportKind> {
    match site {
        ImportSiteKind::RequireResolve(_) | ImportSiteKind::ImportMetaResolve(_) => None,
        _ => Some(CodeImportKind::from_site(site)),
    }
}

/// Calls `visit` with each file that `file` loads and with how: `None` for what the host implied.
fn visit_loaded_files(
    file: &WalkedFile<'_, '_>,
    visit: &mut dyn FnMut(u32, Option<CodeImportKind>),
) {
    let Some(parsed) = &file.parsed else {
        return;
    };
    let mut targets = file.targets.iter().copied();
    let sites = parsed.code.analyzed.analysis.import_sites;
    for (site, &resolution) in sites.iter().zip(&parsed.code.resolutions) {
        let kind = loading_kind(site.kind);
        for target in targets.by_ref().take(files_of(resolution).count()) {
            if target != NOT_LOADED && kind.is_some() {
                visit(target, kind);
            }
        }
    }
    for target in targets.filter(|&target| target != NOT_LOADED) {
        visit(target, None);
    }
}

fn find_files_that_require_may_load(
    context: &CodeLoadContext<'_, '_, '_>,
    state: &WalkState<'_, '_>,
) -> Vec<bool> {
    let files = &state.files;
    let is_module = |file: u32| {
        let parsed = files[file as usize].parsed.as_ref();
        parsed.is_some_and(|it| it.code.analyzed.analysis.module_format == ModuleFormat::Esm)
    };
    let mut may_be_required = vec![false; files.len()];
    let mut runs_inside_require = vec![false; files.len()];
    let mut to_visit: Vec<u32> = Vec::new();
    for entry_point in &context.entry_points {
        let index = state.index_of[&context.canonical_key(entry_point.key)];
        may_be_required[index as usize] = true;
    }
    for file in files {
        visit_loaded_files(file, &mut |target, kind| {
            if kind == Some(CodeImportKind::Import) {
                return;
            }
            may_be_required[target as usize] = true;
            let starts_synchronous_load =
                kind == Some(CodeImportKind::Require) && is_module(target);
            if starts_synchronous_load && !runs_inside_require[target as usize] {
                runs_inside_require[target as usize] = true;
                to_visit.push(target);
            }
        });
    }
    while let Some(file) = to_visit.pop() {
        visit_loaded_files(&files[file as usize], &mut |target, _| {
            may_be_required[target as usize] = true;
            if !std::mem::replace(&mut runs_inside_require[target as usize], true) {
                to_visit.push(target);
            }
        });
    }
    may_be_required
}

fn is_another_format_where_imported(
    context: &CodeLoadContext<'_, '_, '_>,
    file: &WalkedFile<'_, '_>,
) -> bool {
    let Some(parsed) = &file.parsed else {
        return false;
    };
    let analysis = &parsed.code.analyzed.analysis;
    let path = file.target.key.path;
    !analysis.module_formats.is_decided_by_text()
        && file.target.host_module.is_none()
        && !context.host.is_plugin_source(path)
        && analysis
            .module_formats
            .get(context.resolver.package_module_type(path))
            != analysis.module_format
}

pub(super) fn forget_files_that_another_loader_reads(
    context: &CodeLoadContext<'_, '_, '_>,
    state: &mut WalkState<'_, '_>,
) -> bool {
    let depends_on_loader = |file: &WalkedFile<'_, '_>| match file.loaded_by {
        LoadedBy::Require => is_another_format_where_imported(context, file),
        LoadedBy::ImportAlone => true,
        LoadedBy::RequireAfterAll => false,
    };
    let candidates: Vec<u32> = (0..state.files.len() as u32)
        .filter(|&file| depends_on_loader(&state.files[file as usize]))
        .collect();
    if candidates.is_empty() {
        return false;
    }
    let may_be_required = find_files_that_require_may_load(context, state);
    let mut has_changed = false;
    for index in candidates {
        let file = &mut state.files[index as usize];
        file.loaded_by = match (file.loaded_by, may_be_required[index as usize]) {
            (LoadedBy::Require, false) => LoadedBy::ImportAlone,
            (LoadedBy::ImportAlone, true) => LoadedBy::RequireAfterAll,
            _ => continue,
        };
        forget_parsed_file(state, index);
        has_changed = true;
    }
    has_changed
}
