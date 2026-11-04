//! `bun run` has two loaders. The one behind `require`, which also loads an entry point and everything that is imported while an ES module is being
//! required, takes `.cjs` for CommonJS and `.mjs` for an ES module. The one behind `import` asks only for the "type" of the package. Most texts say
//! what they are. A file whose text does not is loaded again here once the walk knows that `import` alone reaches it.
//!
//! Whichever loader comes to a file first reads it, and the other takes what it finds. A `require` runs once its own file is loaded, and with that
//! file everything without which no way of loads leads to it. So it reads none of those, whether it names one or requires an ES module above one.

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

/// What is loaded by the time the code of a file runs.
struct LoadOrder {
    /// By file: the lowest file that every way of loads from the host to it passes. Behind the files come `any_file()` and `host()`.
    above: Vec<u32>,
    /// By file: its place in the order in which a walk along the loads leaves the files, each behind what it loads. What is above a file has a higher one.
    /// `NOT_LOADED`: no way leads to it.
    left_at: Vec<u32>,
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
                let first = loaders.next().expect("a walk comes to a file from a file that it has come to");
                let lowest = loaders.fold(first, |lowest, loader| order.lowest_above_both(lowest, loader));
                has_changed |= std::mem::replace(&mut order.above[file as usize], lowest) != lowest;
            }
        }
        order
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

    /// `behind`: the lowest of what is loaded when any of the loads noted so far runs, or `NOT_LOADED`. Returns whether a load in `file` changes it.
    fn note_load_in(&self, file: u32, behind: &mut u32) -> bool {
        let file = match self.left_at[file as usize] {
            NOT_LOADED => self.host(),
            _ => file,
        };
        let lowest = match *behind {
            NOT_LOADED => file,
            known => self.lowest_above_both(known, file),
        };
        std::mem::replace(behind, lowest) != lowest
    }

    fn is_loaded_with(&self, file: u32, mut lower: u32) -> bool {
        while self.left_at[lower as usize] < self.left_at[file as usize] {
            lower = self.above[lower as usize];
        }
        lower == file
    }
}

fn loads_under_unknown_name(file: &WalkedFile<'_, '_>) -> bool {
    let Some(parsed) = &file.parsed else {
        return false;
    };
    let sites = parsed.code.analyzed.analysis.import_sites;
    sites.iter().zip(&parsed.code.resolutions).any(|(site, resolution)| {
        matches!(resolution, SiteResolution::Computed(ComputedResolution::All { .. }))
            && loading_kind(site.kind).is_some()
    })
}

/// By file: whether the loader behind `require` may be the first to load it, and whether it may be so while an ES module is being required.
fn find_files_that_require_may_load(
    context: &CodeLoadContext<'_, '_, '_>,
    state: &WalkState<'_, '_>,
) -> (Vec<bool>, Vec<bool>) {
    let files = &state.files;
    let order = LoadOrder::new(context, state);
    let is_module = |file: u32| {
        let parsed = files[file as usize].parsed.as_ref();
        parsed.is_some_and(|it| it.code.analyzed.analysis.module_format == ModuleFormat::Esm)
    };
    // `LoadOrder::note_load_in`, by file: of the loads that name it, and of those that require an ES module above it.
    let mut named_behind = vec![NOT_LOADED; files.len()];
    let mut imported_behind = vec![NOT_LOADED; files.len()];
    let mut to_visit: Vec<u32> = Vec::new();
    for entry_point in &context.entry_points() {
        // An entry point of a layer of a test run is loaded by the files above the layer, not by the host.
        if context.is_only_imported_from_above(entry_point.key) {
            continue;
        }
        let index = state.index_of[&context.canonical_key(entry_point.key)];
        named_behind[index as usize] = order.host();
        if context.is_required_from_above(entry_point.key) && is_module(index) {
            imported_behind[index as usize] = order.host();
            to_visit.push(index);
        }
    }
    for (index, file) in (0..).zip(files) {
        visit_loaded_files(file, &mut |target, kind| {
            if kind == Some(CodeImportKind::Import) {
                return;
            }
            order.note_load_in(index, &mut named_behind[target as usize]);
            let starts_synchronous_load =
                kind == Some(CodeImportKind::Require) && is_module(target);
            if starts_synchronous_load
                && order.note_load_in(index, &mut imported_behind[target as usize])
            {
                to_visit.push(target);
            }
        });
    }
    while let Some(file) = to_visit.pop() {
        let behind = imported_behind[file as usize];
        visit_loaded_files(&files[file as usize], &mut |target, _| {
            if order.note_load_in(behind, &mut imported_behind[target as usize]) {
                to_visit.push(target);
            }
        });
    }
    let may_come_first = |(file, &behind): (u32, &u32)| {
        behind != NOT_LOADED && !order.is_loaded_with(file, behind)
    };
    let runs_inside_require: Vec<bool> = (0..).zip(&imported_behind).map(may_come_first).collect();
    let is_named_first = (0..).zip(&named_behind).map(may_come_first);
    let may_be_required = is_named_first
        .zip(&runs_inside_require)
        .map(|(is_named_first, &runs_inside_require)| is_named_first || runs_inside_require)
        .collect();
    (may_be_required, runs_inside_require)
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
    let (may_be_required, runs_inside_require) = find_files_that_require_may_load(context, state);
    let mut has_changed = false;
    for (index, ()) in candidates {
        let file = &mut state.files[index as usize];
        if let Some(parsed) = &mut file.parsed {
            parsed.code.analyzed.runs_inside_require = runs_inside_require[index as usize];
        }
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
