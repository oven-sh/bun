//! `bun run` has two loaders. The one behind `require`, which also loads an entry point and everything that is imported while an ES module is being
//! required, takes `.cjs` for CommonJS and `.mjs` for an ES module. The one behind `import` asks only for the "type" of the package. Most texts say
//! what they are. A file whose text does not is loaded again here once the walk knows that `import` alone reaches it.
//!
//! Whichever loader comes to a file first reads it, and the other takes what it finds. A `require` runs once its own file is loaded, and with that
//! file everything without which no way of loads leads to it. So it reads none of those, whether it names one or requires an ES module above one.
//!
//! No ES module runs before a loader has followed the import statements below it to their end. So where the code of a file runs, all that statements
//! lead to from it, or from a file above it, is loaded too. Not for CommonJS that a statement imports: it runs where the loader comes to it, in the
//! midst of the statements, and so does whatever it loads.

use super::*;
use crate::module_format::ModuleFormat;
use crate::resolve::{CodeImportKind, ComputedResolution, SiteResolution};

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
        ImportSiteKind::RequireResolve(_)
        | ImportSiteKind::ImportMetaResolve(_)
        | ImportSiteKind::MockModule(_) => None,
        _ => Some(CodeImportKind::from_site(site)),
    }
}

/// Calls `visit` with each file that a site of `file` names and with the site: `None` for what the host implied.
fn visit_named_files(
    file: &WalkedFile<'_, '_>,
    visit: &mut dyn FnMut(u32, Option<ImportSiteKind>),
) {
    let Some(parsed) = &file.parsed else {
        return;
    };
    let mut targets = file.targets.iter().copied();
    let sites = parsed.code.analyzed.analysis.import_sites;
    for (site, &resolution) in sites.iter().zip(&parsed.code.resolutions) {
        for target in targets.by_ref().take(files_of(resolution).count()) {
            if target != NOT_LOADED {
                visit(target, Some(site.kind));
            }
        }
    }
    for target in targets.filter(|&target| target != NOT_LOADED) {
        visit(target, None);
    }
}

/// Calls `visit` with each file that `file` loads and with how: `None` for what the host implied.
fn visit_loaded_files(
    file: &WalkedFile<'_, '_>,
    visit: &mut dyn FnMut(u32, Option<CodeImportKind>),
) {
    visit_named_files(file, &mut |target, site| match site.map(loading_kind) {
        None => visit(target, None),
        Some(None) => {}
        Some(kind) => visit(target, kind),
    });
}

fn is_module(file: &WalkedFile<'_, '_>) -> bool {
    let parsed = file.parsed.as_ref();
    parsed.is_some_and(|it| it.code.analyzed.analysis.module_format == ModuleFormat::Esm)
}

/// The loads noted so far that may read a file.
#[derive(Copy, Clone, PartialEq, Eq)]
struct Behind {
    /// The lowest of what is loaded when any of them runs. `NOT_LOADED`: none is noted.
    lowest: u32,
    /// `LoadOrder::runs_amid_statements` of a file that holds one of them.
    is_amid_statements: bool,
}

const BEHIND_NO_LOAD: Behind = Behind {
    lowest: NOT_LOADED,
    is_amid_statements: false,
};

/// What is loaded by the time the code of a file runs.
struct LoadOrder {
    /// By file: the lowest file that every way of loads from the host to it passes. Behind the files come `any_file()` and `host()`.
    above: Vec<u32>,
    /// By file: its place in the order in which a walk along the loads leaves the files, each behind what it loads. What is above a file has a higher one.
    /// `NOT_LOADED`: no way leads to it.
    left_at: Vec<u32>,
    /// By file: the files with a statement that imports it and finds no mock in its place.
    importers: Vec<Vec<u32>>,
    /// By file: it may run while a loader follows statements.
    runs_amid_statements: Vec<bool>,
}

impl LoadOrder {
    /// It loads every file. A file that loads under a name of which the build knows nothing loads it.
    fn any_file(&self) -> u32 {
        self.above.len() as u32 - 2
    }

    /// It loads the entry points.
    fn host(&self) -> u32 {
        self.above.len() as u32 - 1
    }

    fn new(context: &CodeLoadContext<'_, '_, '_>, state: &WalkState<'_, '_>) -> LoadOrder {
        let files = &state.files;
        let mut order = LoadOrder {
            above: vec![NOT_LOADED; files.len() + 2],
            left_at: vec![NOT_LOADED; files.len() + 2],
            importers: vec![Vec::new(); files.len() + 2],
            runs_amid_statements: vec![false; files.len() + 2],
        };
        let (any_file, host) = (order.any_file(), order.host());
        // More than is loaded: what a file only resolves is among its targets. Then fewer files are above others.
        let mut loads: Vec<Vec<u32>> = (files.iter())
            .map(|file| {
                let targets = file.targets.iter().copied();
                let mut loads: Vec<u32> = targets.filter(|&target| target != NOT_LOADED).collect();
                if loads_under_unknown_name(file) {
                    loads.push(any_file);
                }
                loads
            })
            .collect();
        loads.push((0..any_file).collect());
        let mut entry_points: Vec<u32> = Vec::new();
        for entry_point in &context.entry_points() {
            entry_points.push(state.index_of[&context.canonical_key(entry_point.key)]);
        }
        loads.push(entry_points);
        order.follow_statements(files, &loads);

        let mut in_order_left: Vec<u32> = Vec::with_capacity(loads.len());
        let mut loaders: Vec<Vec<u32>> = vec![Vec::new(); loads.len()];
        let mut is_met = vec![false; loads.len()];
        is_met[host as usize] = true;
        let mut way: Vec<(u32, usize)> = vec![(host, 0)];
        while let Some(&mut (file, ref mut next)) = way.last_mut() {
            let Some(&target) = loads[file as usize].get(*next) else {
                order.left_at[file as usize] = in_order_left.len() as u32;
                in_order_left.push(file);
                way.pop();
                continue;
            };
            *next += 1;
            loaders[target as usize].push(file);
            if !std::mem::replace(&mut is_met[target as usize], true) {
                way.push((target, 0));
            }
        }

        order.above[host as usize] = host;
        let mut has_changed = true;
        while has_changed {
            has_changed = false;
            for &file in in_order_left.iter().rev().skip(1) {
                let known = |&&loader: &&u32| order.above[loader as usize] != NOT_LOADED;
                let mut loaders = loaders[file as usize].iter().filter(known).copied();
                let first = loaders
                    .next()
                    .expect("a walk comes to a file from a file that it has come to");
                let lowest = loaders.fold(first, |lowest, loader| {
                    order.lowest_above_both(lowest, loader)
                });
                has_changed |= std::mem::replace(&mut order.above[file as usize], lowest) != lowest;
            }
        }
        order
    }

    fn follow_statements(&mut self, files: &[WalkedFile<'_, '_>], loads: &[Vec<u32>]) {
        let mut may_be_mocked = vec![false; files.len()];
        let mut is_any_file_mocked = false;
        for file in files {
            is_any_file_mocked |=
                names_unknown_file(file, &|site| matches!(site, ImportSiteKind::MockModule(_)));
            visit_named_files(file, &mut |target, site| {
                may_be_mocked[target as usize] |=
                    matches!(site, Some(ImportSiteKind::MockModule(_)));
            });
        }
        let mut to_visit: Vec<u32> = Vec::new();
        for (index, file) in (0..).zip(files) {
            visit_named_files(file, &mut |target, site| {
                let is_statement = matches!(
                    site,
                    Some(
                        ImportSiteKind::Import(_)
                            | ImportSiteKind::ExportFrom(_)
                            | ImportSiteKind::ExportStar(_)
                    )
                );
                if !is_statement {
                    return;
                }
                if !is_any_file_mocked && !may_be_mocked[target as usize] {
                    self.importers[target as usize].push(index);
                }
                let imported = &files[target as usize];
                if !is_module(imported) && imported.target.host_module.is_none() {
                    to_visit.push(target);
                }
            });
        }
        while let Some(file) = to_visit.pop() {
            if !std::mem::replace(&mut self.runs_amid_statements[file as usize], true) {
                to_visit.extend(&loads[file as usize]);
            }
        }
    }

    fn lowest_above_both(&self, mut one: u32, mut other: u32) -> u32 {
        while one != other {
            while self.left_at[one as usize] < self.left_at[other as usize] {
                one = self.above[one as usize];
            }
            while self.left_at[other as usize] < self.left_at[one as usize] {
                other = self.above[other as usize];
            }
        }
        one
    }

    fn load_in(&self, file: u32) -> Behind {
        Behind {
            lowest: match self.left_at[file as usize] {
                NOT_LOADED => self.host(),
                _ => file,
            },
            is_amid_statements: self.runs_amid_statements[file as usize],
        }
    }

    /// Returns whether `load` changes `behind`.
    fn note(&self, load: Behind, behind: &mut Behind) -> bool {
        let noted = Behind {
            lowest: match behind.lowest {
                NOT_LOADED => load.lowest,
                known => self.lowest_above_both(known, load.lowest),
            },
            is_amid_statements: behind.is_amid_statements || load.is_amid_statements,
        };
        std::mem::replace(behind, noted) != noted
    }

    fn is_loaded_with(&self, file: u32, behind: Behind) -> bool {
        let mut is_above = vec![false; self.above.len()];
        let mut lower = behind.lowest;
        while !std::mem::replace(&mut is_above[lower as usize], true) {
            lower = self.above[lower as usize];
        }
        if is_above[file as usize] || behind.is_amid_statements {
            return is_above[file as usize];
        }
        let mut is_met = vec![false; self.above.len()];
        let mut to_visit = vec![file];
        while let Some(imported) = to_visit.pop() {
            for &importer in &self.importers[imported as usize] {
                if is_above[importer as usize] {
                    return true;
                }
                if !std::mem::replace(&mut is_met[importer as usize], true) {
                    to_visit.push(importer);
                }
            }
        }
        false
    }
}

/// Whether a site of `file` that `is_asked` holds of names a file of which the build knows nothing.
fn names_unknown_file(
    file: &WalkedFile<'_, '_>,
    is_asked: &dyn Fn(ImportSiteKind) -> bool,
) -> bool {
    let Some(parsed) = &file.parsed else {
        return false;
    };
    let sites = parsed.code.analyzed.analysis.import_sites;
    sites
        .iter()
        .zip(&parsed.code.resolutions)
        .any(|(site, resolution)| {
            matches!(
                resolution,
                SiteResolution::Computed(ComputedResolution::All { .. })
            ) && is_asked(site.kind)
        })
}

fn loads_under_unknown_name(file: &WalkedFile<'_, '_>) -> bool {
    names_unknown_file(file, &|site| loading_kind(site).is_some())
}

/// For each of `asked`: whether the loader behind `require` may be the first to load it, and whether it may be so while an ES module is being required.
fn find_files_that_require_may_load(
    context: &CodeLoadContext<'_, '_, '_>,
    state: &WalkState<'_, '_>,
    asked: &[(u32, ())],
) -> Vec<(bool, bool)> {
    let files = &state.files;
    let order = LoadOrder::new(context, state);
    let is_module = |file: u32| is_module(&files[file as usize]);
    // By file: the loads that name it, and those that require an ES module above it.
    let mut named_behind = vec![BEHIND_NO_LOAD; files.len()];
    let mut imported_behind = vec![BEHIND_NO_LOAD; files.len()];
    let mut to_visit: Vec<u32> = Vec::new();
    for entry_point in &context.entry_points() {
        // An entry point of a layer of a test run is loaded by the files above the layer, not by the host.
        if context.is_only_imported_from_above(entry_point.key) {
            continue;
        }
        let index = state.index_of[&context.canonical_key(entry_point.key)];
        named_behind[index as usize] = order.load_in(order.host());
        if context.is_required_from_above(entry_point.key) && is_module(index) {
            imported_behind[index as usize] = order.load_in(order.host());
            to_visit.push(index);
        }
    }
    for (index, file) in (0..).zip(files) {
        visit_loaded_files(file, &mut |target, kind| {
            if kind == Some(CodeImportKind::Import) {
                return;
            }
            order.note(order.load_in(index), &mut named_behind[target as usize]);
            let starts_synchronous_load =
                kind == Some(CodeImportKind::Require) && is_module(target);
            if starts_synchronous_load
                && order.note(order.load_in(index), &mut imported_behind[target as usize])
            {
                to_visit.push(target);
            }
        });
    }
    while let Some(file) = to_visit.pop() {
        let behind = imported_behind[file as usize];
        visit_loaded_files(&files[file as usize], &mut |target, kind| {
            // What a file of that graph requires, a `require` names: noted above. No statement imports it there.
            if kind != Some(CodeImportKind::Require)
                && order.note(behind, &mut imported_behind[target as usize])
            {
                to_visit.push(target);
            }
        });
    }
    let may_come_first = |file: u32, behind: Behind| {
        behind.lowest != NOT_LOADED && !order.is_loaded_with(file, behind)
    };
    (asked.iter())
        .map(|&(file, ())| {
            let runs_inside_require = may_come_first(file, imported_behind[file as usize]);
            let is_named_first = may_come_first(file, named_behind[file as usize]);
            (is_named_first || runs_inside_require, runs_inside_require)
        })
        .collect()
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
        LoadedBy::Require | LoadedBy::RequireAfterAll => {
            is_another_format_where_imported(context, file)
        }
        LoadedBy::ImportAlone => true,
    };
    let candidates = find_in_every_file(context.host, &state.files, &|file| {
        depends_on_loader(file).then_some(())
    });
    if candidates.is_empty() {
        return false;
    }
    let answers = find_files_that_require_may_load(context, state, &candidates);
    let mut has_changed = false;
    for ((index, ()), (may_be_required, runs_inside_require)) in candidates.into_iter().zip(answers)
    {
        let file = &mut state.files[index as usize];
        if let Some(parsed) = &mut file.parsed {
            parsed.code.analyzed.runs_inside_require = runs_inside_require;
        }
        file.loaded_by = match (file.loaded_by, may_be_required) {
            (LoadedBy::Require, false) => LoadedBy::ImportAlone,
            (LoadedBy::ImportAlone, true) => LoadedBy::RequireAfterAll,
            _ => continue,
        };
        forget_parsed_file(state, index);
        has_changed = true;
    }
    has_changed
}
