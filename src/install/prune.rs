use core::cell::{Cell, RefCell};
use core::ops::Range;
use std::io::Write as _;

use bstr::BStr;
use bun_collections::{DynamicBitSet, index_sort};
use bun_core::time::nano_timestamp;
use bun_core::{Global, Output, ZStr, handle_oom, strings};
use bun_install_types::NodeLinker::NodeLinker;
use bun_paths::SEP;
use bun_sys::{self as sys, Dir, E, EntryKind, O};

use crate::isolated_install::store::{EntryColumns as _, NodeColumns as _, entry as store_entry};
use crate::isolated_install::{Store, Timings, build_store};
use crate::lockfile::package::PackageColumns as _;
use crate::lockfile::tree::is_filtered_dependency_or_workspace;
use crate::lockfile::{LoadResult, Lockfile, reachable, tree};
use crate::lockfile_real::package::{Diff, DiffSummary, Package};
use crate::package_install;
use crate::package_manager::Options::{Enable, LogLevel};
use crate::package_manager::workspace_selection::{self, RootSelection};
use crate::package_manager::{ROOT_PACKAGE_JSON_PATH, WorkspaceFilter};
use crate::{DependencyID, Features, PackageID, PackageManager, ResolutionTag, invalid_package_id};

const STORE_DIR: &[u8] = b"node_modules/.bun";
const ROOT_DIR: &[u8] = b"node_modules";

#[derive(Clone, Copy, PartialEq, Eq)]
enum Layout {
    Hoisted,
    Isolated,
}

#[derive(Clone, Copy, PartialEq, Eq)]
enum FolderKind {
    NodeModules,
    Scope { parent: usize },
    Store,
}

struct Folder {
    path: Box<[u8]>,
    kind: FolderKind,
    dir: Option<Dir>,
    direct: Option<Vec<Box<[u8]>>>,
    touched: bool,
}

struct Entry<'a> {
    dir: &'a Dir,
    alias: &'a [u8],
    name: &'a [u8],
    kind: EntryKind,
}

struct Removal {
    folder: usize,
    name: Box<[u8]>,
    kind: EntryKind,
    alias: Box<[u8]>,
    version: Option<Box<[u8]>>,
}

#[derive(Default)]
struct Plan {
    folders: Vec<Folder>,
    removals: Vec<Removal>,
    checked: usize,
}

impl Plan {
    fn push_folder(&mut self, path: &[u8], kind: FolderKind) -> usize {
        self.folders.push(Folder {
            path: path.into(),
            kind,
            dir: None,
            direct: None,
            touched: false,
        });
        self.folders.len() - 1
    }

    fn remove(&mut self, folder: usize, name: &[u8], kind: EntryKind) {
        let (alias, version) = match self.folders[folder].kind {
            FolderKind::NodeModules => (name.into(), None),
            FolderKind::Scope { parent } => {
                (join_alias(self.scope_name(folder, parent), name), None)
            }
            FolderKind::Store => split_store_key(name),
        };
        self.removals.push(Removal {
            folder,
            name: name.into(),
            kind,
            alias,
            version,
        });
        self.folders[folder].touched = true;
        if let FolderKind::Scope { parent } = self.folders[folder].kind {
            self.folders[parent].touched = true;
        }
    }

    /// Plans the removal of the package `alias` from the folder `dir`, through its `@scope` folder when it has one.
    fn remove_alias(&mut self, folder: usize, dir: &Dir, alias: &[u8]) {
        let is_package =
            |kind: EntryKind| kind == EntryKind::Directory || kind == EntryKind::SymLink;
        match strings::split_once_char(alias, b'/') {
            Some((scope, name)) if alias.first() == Some(&b'@') => {
                let Some(scope_dir) = open_real_subdir(dir, scope) else {
                    return;
                };
                let kind = lstat_kind(&scope_dir, name);
                if !is_package(kind) {
                    return;
                }
                let scope_path = join(&self.folders[folder].path, scope);
                let scope_idx = self.push_folder(&scope_path, FolderKind::Scope { parent: folder });
                self.remove(scope_idx, name, kind);
                self.retain(scope_idx, scope_dir);
            }
            _ => {
                let kind = lstat_kind(dir, alias);
                if is_package(kind) {
                    self.remove(folder, alias, kind);
                }
            }
        }
    }

    fn scope_name(&self, scope: usize, parent: usize) -> &[u8] {
        &self.folders[scope].path[self.folders[parent].path.len() + 1..]
    }

    fn path(&self, removal: &Removal) -> Box<[u8]> {
        join(&self.folders[removal.folder].path, &removal.name)
    }

    // The node_modules folder a row lives in; empty for the root folder and the store.
    fn location(&self, removal: &Removal) -> &[u8] {
        let folder = &self.folders[removal.folder];
        let path: &[u8] = match folder.kind {
            FolderKind::NodeModules => &folder.path,
            FolderKind::Scope { parent } => &self.folders[parent].path,
            FolderKind::Store => return &[],
        };
        if path == ROOT_DIR { &[] } else { path }
    }

    fn resolve_versions(&mut self) {
        for i in 0..self.removals.len() {
            if self.removals[i].version.is_some() {
                continue;
            }
            let removal = &self.removals[i];
            let Ok(package) = self.dir(removal.folder).open_at(&removal.name) else {
                continue;
            };
            if let Some((_, Some(version))) = installed_package_json(&package) {
                self.removals[i].version = Some(version.into_boxed_slice());
            }
        }
    }

    fn sort_rows(&mut self) {
        let mut removals = core::mem::take(&mut self.removals);
        index_sort::sort_vec_unstable_by(&mut removals, |a, b| {
            (&a.alias, self.location(a), &a.version).cmp(&(&b.alias, self.location(b), &b.version))
        });
        self.removals = removals;
    }

    fn print_row(&self, removal: &Removal) {
        bun_core::pretty!("<r><red>-<r> {}", BStr::new(&removal.alias));
        if let Some(version) = &removal.version {
            bun_core::pretty!("<d>@{}<r>", BStr::new(version));
        }
        let location = self.location(removal);
        if !location.is_empty() {
            bun_core::pretty!(" <d>({})<r>", BStr::new(location));
        }
        bun_core::pretty!("\n");
    }

    fn retain(&mut self, folder: usize, dir: Dir) {
        if self.folders[folder].touched {
            self.folders[folder].dir = Some(dir);
        }
    }

    fn dir(&self, folder: usize) -> &Dir {
        self.folders[folder]
            .dir
            .as_ref()
            .expect("touched folders retain their Dir")
    }
}

fn join(dir: &[u8], name: &[u8]) -> Box<[u8]> {
    let mut out = Vec::with_capacity(dir.len() + 1 + name.len());
    out.extend_from_slice(dir);
    out.push(SEP);
    out.extend_from_slice(name);
    out.into_boxed_slice()
}

fn join_alias(scope: &[u8], name: &[u8]) -> Box<[u8]> {
    let mut out = Vec::with_capacity(scope.len() + 1 + name.len());
    out.extend_from_slice(scope);
    out.push(b'/');
    out.extend_from_slice(name);
    out.into_boxed_slice()
}

// Store folders are named `name@version[+peers]`, scoped as `@scope+name@version` (Store.rs fmt_store_key).
fn split_store_key(key: &[u8]) -> (Box<[u8]>, Option<Box<[u8]>>) {
    let Some(at) = strings::index_of_char_usize(&key[key.len().min(1)..], b'@').map(|i| i + 1)
    else {
        return (key.into(), None);
    };
    let (name, version) = (&key[..at], &key[at + 1..]);
    let alias = match strings::index_of_char_usize(name, b'+') {
        Some(plus) if name.first() == Some(&b'@') => join_alias(&name[..plus], &name[plus + 1..]),
        _ => name.into(),
    };
    (alias, Some(version.into()))
}

fn zname(name: &[u8]) -> Vec<u8> {
    let mut z = Vec::with_capacity(name.len() + 1);
    z.extend_from_slice(name);
    z.push(0);
    z
}

fn sort_names(names: &mut Vec<Box<[u8]>>) {
    index_sort::sort_vec_unstable_by(names, |a, b| a.cmp(b));
}

fn contains(sorted: &[Box<[u8]>], name: &[u8]) -> bool {
    sorted
        .binary_search_by(|item| item.as_ref().cmp(name))
        .is_ok()
}

fn plural(n: usize) -> &'static str {
    if n == 1 { "" } else { "s" }
}

fn print_elapsed() {
    Output::print_start_end_stdout(bun_core::start_time(), nano_timestamp());
    bun_core::pretty!("\n");
    Output::flush();
}

pub fn prune(manager: &mut PackageManager, original_cwd: &[u8]) -> crate::Result<()> {
    let quiet = manager.options.log_level == LogLevel::Silent;
    let dry_run = manager.options.dry_run;

    let configured_linker = manager.options.node_linker;
    let loaded = {
        let load = manager.load_lockfile_from_cwd::<false>();
        match &load {
            LoadResult::NotFound => Err(None),
            LoadResult::Err(cause) => Err(Some(cause.value.name())),
            LoadResult::Ok(_) => Ok(load.node_linker(configured_linker)),
        }
    };
    let linker = match loaded {
        Ok(linker) => linker,
        Err(None) => {
            if !quiet {
                Output::err_generic("missing lockfile, nothing to prune", ());
                bun_core::note!("run 'bun install' first");
            }
            Global::exit(1);
        }
        Err(Some(name)) => {
            if !quiet {
                Output::err_generic("failed to load lockfile: {s}", (name,));
                print_log_errors(manager.log_mut());
            }
            Global::exit(1);
        }
    };

    manager.options.enable.set(Enable::FROZEN_LOCKFILE, true);
    manager.summary = exit_unless_lockfile_matches_package_json(manager, "prune")?;

    let node_modules = match Dir::open(ROOT_DIR) {
        Ok(node_modules) => node_modules,
        Err(err) if err.get_errno() == E::ENOENT => {
            if !quiet {
                Output::flush();
                bun_core::pretty!(
                    "<r><green>Done<r>! No node_modules folder <d>(nothing to prune)<r> "
                );
                print_elapsed();
            }
            return Ok(());
        }
        Err(err) => {
            if !quiet {
                Output::err(err, "failed to open node_modules", ());
            }
            Global::exit(1);
        }
    };

    let configured = match linker {
        NodeLinker::Isolated => Layout::Isolated,
        _ => Layout::Hoisted,
    };
    let layout = detect_layout(manager, &node_modules, configured);
    drop(node_modules);

    let workspace_names = collect_workspace_names(manager);
    let selection = select_importers(manager, original_cwd);

    let mut plan = Plan::default();
    match layout {
        Layout::Hoisted => plan_hoisted(manager, &workspace_names, selection.as_ref(), &mut plan),
        Layout::Isolated => plan_isolated(manager, &workspace_names, selection.as_ref(), &mut plan),
    }
    Output::flush();

    let n = plan.removals.len();
    let checked = plan.checked;
    if n == 0 {
        if !quiet {
            let folders = plan
                .folders
                .iter()
                .filter(|f| matches!(f.kind, FolderKind::NodeModules | FolderKind::Store))
                .count();
            bun_core::pretty!(
                "<r><green>Done<r>! Checked <green>{} installed package{}<r> across {} folder{} <d>(nothing to prune)<r> ",
                checked,
                plural(checked),
                folders,
                plural(folders)
            );
            print_elapsed();
        }
        return Ok(());
    }

    if !quiet {
        plan.resolve_versions();
        plan.sort_rows();
    }

    if dry_run {
        if !quiet {
            for removal in &plan.removals {
                plan.print_row(removal);
            }
            bun_core::pretty!(
                "<r><b>{}<r> package{} can be removed <d>(checked {} installed package{})<r> ",
                n,
                plural(n),
                checked,
                plural(checked)
            );
            print_elapsed();
            print_apply_hint();
        }
        return Ok(());
    }

    let failed = execute(&plan, quiet);
    housekeeping(&plan, layout, manager);

    if !quiet {
        Output::flush();
        let removed = n - failed;
        bun_core::pretty!("<r><b>{}<r> package{} removed", removed, plural(removed));
        if failed > 0 {
            bun_core::pretty!(", <red>{} failed<r>", failed);
        }
        bun_core::pretty!(
            " <d>(checked {} installed package{})<r> ",
            checked,
            plural(checked)
        );
        print_elapsed();
    }
    if failed > 0 {
        Global::exit(1);
    }
    Ok(())
}

fn store_has_entries() -> bool {
    let Ok(store) = Dir::open(STORE_DIR) else {
        return false;
    };
    read_entries(&store)
        .iter()
        .any(|(name, _)| split_store_key(name).1.is_some())
}

fn extracted(tag: ResolutionTag) -> bool {
    matches!(
        tag,
        ResolutionTag::Npm
            | ResolutionTag::LocalTarball
            | ResolutionTag::RemoteTarball
            | ResolutionTag::Git
            | ResolutionTag::Github
    )
}

/// Which linkers the entries of the importer folders (root and workspace `node_modules`) come from.
struct LayoutEvidence<'a> {
    /// Sorted dependency names that resolve to an extracted package.
    extracted_aliases: Vec<&'a [u8]>,
    hoisted: bool,
    isolated: bool,
}

impl<'a> LayoutEvidence<'a> {
    fn init(lockfile: &'a Lockfile) -> LayoutEvidence<'a> {
        let buf = lockfile.buffers.string_bytes.as_slice();
        let deps = lockfile.buffers.dependencies.as_slice();
        let resolutions = lockfile.buffers.resolutions.as_slice();
        let pkg_res = lockfile.packages.items_resolution();
        let mut extracted_aliases: Vec<&[u8]> = deps
            .iter()
            .zip(resolutions)
            .filter(|(_, pkg_id)| {
                pkg_res
                    .get(**pkg_id as usize)
                    .is_some_and(|res| extracted(res.tag))
            })
            .map(|(dep, _)| dep.name.slice(buf))
            .collect();
        index_sort::sort_vec_unstable_by(&mut extracted_aliases, |a, b| a.cmp(b));
        extracted_aliases.dedup();
        LayoutEvidence {
            extracted_aliases,
            hoisted: false,
            isolated: false,
        }
    }

    fn mixed(&self) -> bool {
        self.hoisted && self.isolated
    }

    fn scan(&mut self, dir: &Dir) {
        let mut alias = Vec::new();
        for (name, kind) in read_entries(dir) {
            if self.mixed() {
                return;
            }
            if name.first() == Some(&b'@') && kind == EntryKind::Directory {
                let Ok(scope_dir) = dir.open_at(&name) else {
                    continue;
                };
                for (inner, inner_kind) in read_entries(&scope_dir) {
                    alias.clear();
                    alias.extend_from_slice(&name);
                    alias.push(b'/');
                    alias.extend_from_slice(&inner);
                    self.vote(&scope_dir, &alias, &inner, inner_kind);
                }
                continue;
            }
            self.vote(dir, &name, &name, kind);
        }
    }

    // A dangling store link is junk, not evidence.
    fn vote(&mut self, dir: &Dir, alias: &[u8], name: &[u8], kind: EntryKind) {
        match kind {
            EntryKind::Directory if self.extracted_aliases.binary_search(&alias).is_ok() => {
                self.hoisted = true;
            }
            EntryKind::SymLink
                if store_link_target(dir, name).is_some() && !is_dangling(dir, name) =>
            {
                self.isolated = true;
            }
            _ => {}
        }
    }
}

/// `configured` only decides when the folders hold both layouts.
fn detect_layout(manager: &PackageManager, node_modules: &Dir, configured: Layout) -> Layout {
    let lockfile: &Lockfile = &manager.lockfile;
    let mut evidence = LayoutEvidence::init(lockfile);
    evidence.scan(node_modules);
    for pkg_id in 0..lockfile.packages.len() {
        if evidence.mixed() {
            break;
        }
        if is_pruned_workspace(manager, pkg_id) {
            continue;
        }
        let Some(folder) = workspace_node_modules(lockfile, pkg_id as PackageID) else {
            continue;
        };
        if let Ok(dir) = Dir::open(&folder) {
            evidence.scan(&dir);
        }
    }
    match (evidence.isolated, evidence.hoisted) {
        (true, false) => Layout::Isolated,
        (false, true) => Layout::Hoisted,
        (true, true) => configured,
        (false, false) if store_has_entries() => Layout::Isolated,
        (false, false) => Layout::Hoisted,
    }
}

fn print_apply_hint() {
    bun_core::pretty!("  <cyan>bun prune");
    for arg in bun_core::argv()
        .into_iter()
        .skip_while(|arg| **arg != *b"prune")
        .skip(1)
    {
        if arg.starts_with(b"--dry-run") {
            continue;
        }
        bun_core::pretty!(" {}", BStr::new(arg));
    }
    bun_core::pretty!("<r>\n");
    Output::flush();
}

fn is_pruned_workspace(manager: &PackageManager, pkg_id: usize) -> bool {
    let pruned = &manager.summary.pruned_workspaces;
    !pruned.is_empty() && pruned.contains(&manager.lockfile.packages.items_name_hash()[pkg_id])
}

fn collect_workspace_names(manager: &PackageManager) -> Vec<Box<[u8]>> {
    let lockfile: &Lockfile = &manager.lockfile;
    let buf = lockfile.buffers.string_bytes.as_slice();
    let names = lockfile.packages.items_name();
    let pkg_res = lockfile.packages.items_resolution();
    let mut out: Vec<Box<[u8]>> = pkg_res
        .iter()
        .enumerate()
        .filter(|(pkg_id, res)| {
            res.tag == ResolutionTag::Workspace && !is_pruned_workspace(manager, *pkg_id)
        })
        .map(|(pkg_id, _)| names[pkg_id].slice(buf).into())
        .collect();
    sort_names(&mut out);
    out.dedup();
    out
}

pub(crate) fn exit_unless_lockfile_matches_package_json(
    manager: &mut PackageManager,
    nothing_to: &'static str,
) -> crate::Result<DiffSummary> {
    let Some(root) = manager.lockfile.root_package() else {
        return Ok(DiffSummary::default());
    };
    let quiet = manager.options.log_level == LogLevel::Silent;

    let log = manager.log_mut();
    // SAFETY: written once inside `PackageManager::init` on this thread; only read afterwards.
    let path: &[u8] = unsafe { ROOT_PACKAGE_JSON_PATH.read() }.as_bytes();
    let (source, json) = match manager
        .workspace_package_json_cache
        .get_with_path(log, path, Default::default())
        .unwrap()
    {
        Ok(entry) => (entry.source.clone(), entry.root),
        Err(err) => {
            if !quiet {
                print_log_errors(log);
                Output::err(err, "failed to read {s}", (BStr::new(path),));
            }
            Global::exit(1);
        }
    };

    let mut to_lockfile = Lockfile::default();
    let mut to_root = Package::default();
    let mut resolver: () = ();
    let pm: *mut PackageManager = manager;
    // SAFETY: same split as `hoist_install_tree`; neither call reaches `lockfile` through `pm`.
    let summary = unsafe {
        let parsed = to_root.parse_with_json::<()>(
            &mut to_lockfile,
            &mut *pm,
            log,
            &source,
            json,
            &mut resolver,
            Features::main(),
        );
        match parsed {
            Ok(()) => {
                let mut mapping = vec![invalid_package_id; to_root.dependencies.len as usize];
                let from_lockfile: *mut Lockfile = &raw mut *(*pm).lockfile;
                Diff::generate(
                    &mut *pm,
                    log,
                    &mut *from_lockfile,
                    &mut to_lockfile,
                    &root,
                    &to_root,
                    None,
                    Some(&mut mapping[..]),
                )
            }
            Err(err) => Err(err),
        }
    };
    let summary = match summary {
        Ok(summary) => summary,
        Err(err) => {
            if !quiet {
                print_log_errors(log);
            }
            return Err(err);
        }
    };

    // The lockfile does not store the set. Take it from the manifests, as an install does.
    manager
        .lockfile
        .self_contained_workspaces
        .clear_retaining_capacity();
    for key in to_lockfile.self_contained_workspaces.keys() {
        manager.lockfile.self_contained_workspaces.put(*key, ())?;
    }

    if summary.changes_dependencies() {
        if !quiet {
            Output::err_generic(
                "bun.lock does not match package.json, nothing to {s}",
                (nothing_to,),
            );
            bun_core::note!("run 'bun install' first");
        }
        Global::exit(1);
    }
    Ok(summary)
}

fn print_log_errors(log: &bun_ast::Log) {
    if log.has_errors() {
        let _ = log.print(core::ptr::from_mut(Output::error_writer()));
    }
}

struct Selection {
    selected: DynamicBitSet,
    protected_aliases: Vec<Box<[u8]>>,
}

fn select_importers(manager: &PackageManager, original_cwd: &[u8]) -> Option<Selection> {
    if manager.options.filter_patterns.is_empty() {
        return None;
    }
    let lockfile: &Lockfile = &manager.lockfile;
    let patterns = manager.options.filter_patterns;
    let quiet = manager.options.log_level == LogLevel::Silent;
    let workspaces = workspace_selection::select_lockfile_workspaces(
        lockfile,
        patterns,
        original_cwd,
        RootSelection::Implicit,
    );
    if workspaces.ids.is_empty() {
        if !quiet {
            Output::err_generic(
                "{}",
                (BStr::new(&workspace_selection::unmatched_message(patterns)),),
            );
        }
        Global::exit(1);
    }
    if !quiet {
        workspace_selection::warn_unmatched(patterns, &workspaces.unmatched_patterns);
    }
    let ids = workspaces.ids;

    let buf = lockfile.buffers.string_bytes.as_slice();
    let deps = lockfile.buffers.dependencies.as_slice();
    let resolutions = lockfile.buffers.resolutions.as_slice();
    let pkg_res = lockfile.packages.items_resolution();
    let dep_slices = lockfile.packages.items_dependencies();
    let is_importer = |pkg_id: usize| {
        matches!(
            pkg_res[pkg_id].tag,
            ResolutionTag::Root | ResolutionTag::Workspace
        )
    };

    let mut selected = handle_oom(DynamicBitSet::init_empty(pkg_res.len()));
    for id in ids {
        if (id as usize) < pkg_res.len() {
            selected.set(id as usize);
        }
    }

    let mut visited = handle_oom(DynamicBitSet::init_empty(pkg_res.len()));
    let mut protected_aliases: Vec<Box<[u8]>> = Vec::new();
    let mut worklist: Vec<PackageID> = Vec::new();
    for importer in 0..pkg_res.len() {
        if selected.is_set(importer)
            || !is_importer(importer)
            || is_pruned_workspace(manager, importer)
        {
            continue;
        }
        visited.set(importer);
        worklist.push(importer as PackageID);
        while let Some(pkg_id) = worklist.pop() {
            let slice = dep_slices[pkg_id as usize];
            for dep_id in slice.begin() as usize..slice.end() as usize {
                let target = resolutions[dep_id];
                let valid = target != invalid_package_id && (target as usize) < pkg_res.len();
                if valid
                    && is_importer(target as usize)
                    && is_pruned_workspace(manager, target as usize)
                {
                    continue;
                }
                protected_aliases.push(deps[dep_id].name.slice(buf).into());
                if !valid {
                    continue;
                }
                if visited.is_set(target as usize) {
                    continue;
                }
                visited.set(target as usize);
                if !is_importer(target as usize) {
                    worklist.push(target);
                }
            }
        }
    }
    sort_names(&mut protected_aliases);
    protected_aliases.dedup();

    Some(Selection {
        selected,
        protected_aliases,
    })
}

/// The dependency types an install lays out for local and for remote packages; `--production` / `--omit` narrow them.
type InstallFeatures = (Features, Features);

fn install_features(manager: &PackageManager) -> InstallFeatures {
    (
        manager.options.local_package_features,
        manager.options.remote_package_features,
    )
}

/// Every dependency type an install can lay out, whatever `--production` / `--omit` say for this run.
fn full_install_features((mut local, mut remote): InstallFeatures) -> InstallFeatures {
    local.dev_dependencies = true;
    for features in [&mut local, &mut remote] {
        features.optional_dependencies = true;
        features.peer_dependencies = true;
    }
    (local, remote)
}

fn with_install_features<T>(
    manager: &mut PackageManager,
    (local, remote): InstallFeatures,
    f: impl FnOnce(&mut PackageManager) -> T,
) -> T {
    let saved = install_features(manager);
    manager.options.local_package_features = local;
    manager.options.remote_package_features = remote;
    let result = f(manager);
    (
        manager.options.local_package_features,
        manager.options.remote_package_features,
    ) = saved;
    result
}

/// The tree the lockfile saves (`Lockfile::resolve`), held while `manager.lockfile` carries the install tree.
struct SavedTree {
    trees: tree::List,
    hoisted_dependencies: Vec<DependencyID>,
}

/// Hoists `manager.lockfile` into the tree an install of `features` lays out for every workspace
/// (`Lockfile::filter`): the self-contained barrier applied, disabled and bundled dependencies left out.
/// Returns the tree it replaced.
fn hoist_install_tree(
    manager: &mut PackageManager,
    features: InstallFeatures,
) -> Result<SavedTree, tree::SubtreeError> {
    let saved = SavedTree {
        trees: core::mem::take(&mut manager.lockfile.buffers.trees),
        hoisted_dependencies: core::mem::take(&mut manager.lockfile.buffers.hoisted_dependencies),
    };
    let result = with_install_features(manager, features, |manager| {
        let pm: *mut PackageManager = manager;
        // SAFETY: same split as `PackageManager::load_lockfile_from_cwd` — `lockfile` is its own `Box` allocation and the Filter builder only reads `manager.options`/`subcommand`/`summary`.
        unsafe {
            let lf: *mut Lockfile = &raw mut *(*pm).lockfile;
            let log: *mut bun_ast::Log = (*pm).log;
            (*lf).hoist::<{ tree::BuilderMethod::Filter }>(&mut *log, Some(&*pm), true, &[], None)
        }
    });
    match result {
        Ok(_) => Ok(saved),
        Err(err) => {
            restore_tree(&mut manager.lockfile, saved);
            Err(err)
        }
    }
}

fn restore_tree(lockfile: &mut Lockfile, saved: SavedTree) {
    lockfile.buffers.trees = saved.trees;
    lockfile.buffers.hoisted_dependencies = saved.hoisted_dependencies;
}

struct TreeFolder {
    path: Range<u32>,
    /// Where the folder is on disk: `path`, except in and below a workspace's tree, which opens `<workspace>/node_modules`.
    disk: Range<u32>,
    /// The rows of every tree that opens `disk`.
    expected: Range<u32>,
}

struct HoistedTree<'a> {
    lockfile: &'a Lockfile,
    trees: &'a [tree::Tree],
    folders: Vec<TreeFolder>,
    /// Per tree, the first tree that opens the same folder on disk. A workspace that a self-contained workspace depends on has a tree below it and can have one below the root.
    first: Vec<tree::Id>,
    paths: Vec<u8>,
    expected: Vec<(&'a [u8], PackageID)>,
    quiet: bool,
    /// The expected tree excludes dev/optional/peer dependencies.
    filtered: bool,
    kept_mismatched: Cell<bool>,
    checked: RefCell<DynamicBitSet>,
    matched: RefCell<DynamicBitSet>,
    missing: RefCell<DynamicBitSet>,
    other_version: RefCell<DynamicBitSet>,
}

#[derive(Clone, Copy, PartialEq, Eq)]
enum Installed {
    Matches,
    Missing,
    Mismatch,
    /// A version the lockfile installs elsewhere; the filter just favors a
    /// different copy at this position, so it is kept without warning.
    /// Only produced when `filtered` is set.
    OtherVersion,
}

#[derive(Clone, Copy)]
struct HoistedTreeInit {
    /// suppress per-package progress output
    quiet: bool,
    /// the expected tree excludes dev/optional/peer dependencies (`--production` / `--omit`)
    filtered: bool,
}

impl<'a> HoistedTree<'a> {
    fn init(lockfile: &'a Lockfile, opts: HoistedTreeInit) -> HoistedTree<'a> {
        let HoistedTreeInit { quiet, filtered } = opts;
        let trees = lockfile.buffers.trees.as_slice();
        let deps = lockfile.buffers.dependencies.as_slice();
        let resolutions = lockfile.buffers.resolutions.as_slice();
        let buf = lockfile.buffers.string_bytes.as_slice();

        let mut folders: Vec<TreeFolder> = Vec::with_capacity(trees.len());
        folders.resize_with(trees.len(), || TreeFolder {
            path: 0..0,
            disk: 0..0,
            expected: 0..0,
        });
        let mut paths: Vec<u8> = Vec::new();
        let mut expected: Vec<(&'a [u8], PackageID)> =
            Vec::with_capacity(lockfile.buffers.hoisted_dependencies.len());

        let mut scratch: Vec<(&'a [u8], PackageID)> = Vec::new();
        let mut it = tree::Iterator::<{ tree::IteratorPathStyle::NodeModules }>::init(lockfile);
        while let Some(folder) = it.next(None) {
            let path_start = paths.len();
            paths.extend_from_slice(folder.relative_path.as_bytes());
            let path = path_start as u32..paths.len() as u32;

            scratch.clear();
            scratch.extend(folder.dependencies.iter().map(|&dep_id| {
                (
                    deps[dep_id as usize].name.slice(buf),
                    resolutions[dep_id as usize],
                )
            }));
            let rows = push_rows(&mut expected, &mut scratch);

            folders[folder.tree_id as usize] = TreeFolder {
                path: path.clone(),
                disk: path,
                expected: rows,
            };
        }

        let mut first: Vec<tree::Id> = (0..trees.len() as tree::Id).collect();
        let mut below_workspace: Vec<usize> = Vec::new();
        let mut chain: Vec<tree::Id> = Vec::new();
        for tree_idx in 1..trees.len() {
            if folders[tree_idx].path.is_empty() {
                continue;
            }
            let Some(workspace) = chain_to_workspace(lockfile, tree_idx as tree::Id, &mut chain)
            else {
                continue;
            };
            let disk_start = paths.len();
            push_folder_path(lockfile, Some(workspace), &mut chain, &mut paths);
            folders[tree_idx].disk = disk_start as u32..paths.len() as u32;
            below_workspace.push(tree_idx);
        }

        let disk_of = |folders: &[TreeFolder], tree_idx: usize| -> Range<usize> {
            folders[tree_idx].disk.start as usize..folders[tree_idx].disk.end as usize
        };
        index_sort::sort_vec_unstable_by(&mut below_workspace, |a, b| {
            paths[disk_of(&folders, *a)]
                .cmp(&paths[disk_of(&folders, *b)])
                .then(a.cmp(b))
        });
        let mut run_start = 0;
        while run_start < below_workspace.len() {
            let disk = disk_of(&folders, below_workspace[run_start]);
            let mut run_end = run_start + 1;
            while run_end < below_workspace.len()
                && paths[disk_of(&folders, below_workspace[run_end])] == paths[disk.clone()]
            {
                run_end += 1;
            }
            let members = &below_workspace[run_start..run_end];
            if members.len() > 1 {
                scratch.clear();
                for &member in members {
                    let rows = folders[member].expected.clone();
                    scratch.extend_from_slice(&expected[rows.start as usize..rows.end as usize]);
                }
                let rows = push_rows(&mut expected, &mut scratch);
                for &member in members {
                    folders[member].expected = rows.clone();
                    first[member] = members[0] as tree::Id;
                }
            }
            run_start = run_end;
        }

        let checked = handle_oom(DynamicBitSet::init_empty(expected.len()));
        let matched = handle_oom(DynamicBitSet::init_empty(expected.len()));
        let missing = handle_oom(DynamicBitSet::init_empty(expected.len()));
        let other_version = handle_oom(DynamicBitSet::init_empty(expected.len()));
        HoistedTree {
            lockfile,
            trees,
            folders,
            first,
            paths,
            expected,
            quiet,
            filtered,
            kept_mismatched: Cell::new(false),
            checked: RefCell::new(checked),
            matched: RefCell::new(matched),
            missing: RefCell::new(missing),
            other_version: RefCell::new(other_version),
        }
    }

    fn path(&self, tree_id: usize) -> &[u8] {
        let range = &self.folders[tree_id].path;
        &self.paths[range.start as usize..range.end as usize]
    }

    fn disk(&self, tree_id: usize) -> &[u8] {
        let range = &self.folders[tree_id].disk;
        &self.paths[range.start as usize..range.end as usize]
    }

    /// Whether this tree stands for its folder: it has rows and no earlier tree opens the same folder.
    fn is_folder(&self, tree_id: usize) -> bool {
        !self.folders[tree_id].path.is_empty() && self.first[tree_id] as usize == tree_id
    }

    /// The tree of the folder Node looks in next: the root's for a workspace's tree, whatever it hangs below.
    fn above(&self, tree_id: tree::Id) -> tree::Id {
        if workspace_path(self.lockfile, tree_owner(self.lockfile, tree_id as usize)).is_some() {
            return 0;
        }
        self.trees[tree_id as usize].parent
    }

    /// `(folder, name, tree)` for each tree of a package placed in `folder`, sorted. A folder is named by its first tree.
    fn nested(&self) -> Vec<(tree::Id, &'a [u8], tree::Id)> {
        let deps = self.lockfile.buffers.dependencies.as_slice();
        let buf = self.lockfile.buffers.string_bytes.as_slice();
        let mut nested: Vec<(tree::Id, &'a [u8], tree::Id)> = self
            .trees
            .iter()
            .enumerate()
            .skip(1)
            .filter(|(_, t)| (t.parent as usize) < self.trees.len())
            .map(|(id, t)| {
                (
                    self.first[t.parent as usize],
                    t.folder_name(deps, buf),
                    self.first[id],
                )
            })
            .collect();
        index_sort::sort_vec_unstable_by(&mut nested, |a, b| a.cmp(b));
        nested
    }

    fn expected(&self, tree_id: usize) -> &[(&'a [u8], PackageID)] {
        let range = &self.folders[tree_id].expected;
        &self.expected[range.start as usize..range.end as usize]
    }

    fn expected_in(&self, tree_id: tree::Id, alias: &[u8]) -> Option<usize> {
        let range = self.folders.get(tree_id as usize)?.expected.clone();
        let expected = &self.expected[range.start as usize..range.end as usize];
        expected
            .binary_search_by(|(name, _)| (*name).cmp(alias))
            .ok()
            .map(|i| range.start as usize + i)
    }

    fn expected_from(&self, from: tree::Id, alias: &[u8]) -> Option<(tree::Id, usize)> {
        let mut id = from;
        while (id as usize) < self.trees.len() {
            if let Some(idx) = self.expected_in(id, alias) {
                return Some((id, idx));
            }
            id = self.above(id);
        }
        None
    }

    fn removable(&self, from: tree::Id, alias: &[u8], entry_folder: &[u8]) -> bool {
        let Some((id, idx)) = self.expected_from(from, alias) else {
            return true;
        };
        let (alias, pkg_id) = self.expected[idx];
        let installed = self.verified_installed(id, idx, alias, pkg_id);
        match installed {
            Installed::Matches => return true,
            Installed::OtherVersion => return false,
            Installed::Missing | Installed::Mismatch => {}
        }
        self.kept_mismatched.set(true);
        if !self.quiet {
            let why = match installed {
                Installed::Missing => "is missing",
                _ => "is not the version bun.lock expects",
            };
            bun_core::warn!(
                "{} {}; keeping {}",
                BStr::new(&join(self.path(id as usize), alias)),
                why,
                BStr::new(&join(entry_folder, alias))
            );
        }
        false
    }

    // Unlike `removable`, an alias no ancestor installs is left alone.
    fn collapsed_into_ancestor(&self, from: tree::Id, alias: &[u8]) -> bool {
        self.expected_from(from, alias).is_some_and(|(id, idx)| {
            let (alias, pkg_id) = self.expected[idx];
            self.verified_installed(id, idx, alias, pkg_id) == Installed::Matches
        })
    }

    fn verified_installed(
        &self,
        tree_id: tree::Id,
        idx: usize,
        alias: &[u8],
        pkg_id: PackageID,
    ) -> Installed {
        if self.checked.borrow().is_set(idx) {
            return if self.matched.borrow().is_set(idx) {
                Installed::Matches
            } else if self.missing.borrow().is_set(idx) {
                Installed::Missing
            } else if self.other_version.borrow().is_set(idx) {
                Installed::OtherVersion
            } else {
                Installed::Mismatch
            };
        }
        let installed = self.installed(tree_id, alias, pkg_id);
        self.checked.borrow_mut().set(idx);
        match installed {
            Installed::Matches => self.matched.borrow_mut().set(idx),
            Installed::Missing => self.missing.borrow_mut().set(idx),
            Installed::OtherVersion => self.other_version.borrow_mut().set(idx),
            Installed::Mismatch => {}
        }
        installed
    }

    fn installed(&self, tree_id: tree::Id, alias: &[u8], pkg_id: PackageID) -> Installed {
        let buf = self.lockfile.buffers.string_bytes.as_slice();
        let Some(res) = self
            .lockfile
            .packages
            .items_resolution()
            .get(pkg_id as usize)
        else {
            return Installed::Mismatch;
        };
        let Some(folder) = open_tree_folder(self.lockfile, tree_id) else {
            return Installed::Missing;
        };
        let kind = entry_kind_of(&folder, alias);
        if kind == EntryKind::Unknown {
            return Installed::Missing;
        }
        match res.tag {
            ResolutionTag::Symlink => {
                return if kind == EntryKind::SymLink {
                    Installed::Matches
                } else {
                    Installed::Mismatch
                };
            }
            ResolutionTag::Folder if kind == EntryKind::SymLink => return Installed::Matches,
            _ => {}
        }
        // A link counts as what it points at, as in `PackageInstall::verify`.
        let package = match kind {
            EntryKind::SymLink if is_dangling(&folder, alias) => return Installed::Missing,
            EntryKind::SymLink => folder.open_at(alias).ok(),
            _ => descend(&folder, alias),
        };
        let Some(package) = package else {
            return Installed::Mismatch;
        };
        let expected_name = self.lockfile.packages.items_name()[pkg_id as usize].slice(buf);
        let matches = match res.tag {
            ResolutionTag::Npm => {
                let Some((name, Some(version))) = installed_package_json(&package) else {
                    return Installed::Mismatch;
                };
                if name != expected_name {
                    return Installed::Mismatch;
                }
                let expected = res.npm().version.fmt(buf).to_string();
                if without_build(&version) == without_build(expected.as_bytes()) {
                    return Installed::Matches;
                }
                if self.filtered && self.version_in_lockfile(pkg_id, &version) {
                    return Installed::OtherVersion;
                }
                return Installed::Mismatch;
            }
            ResolutionTag::Git | ResolutionTag::Github => {
                sys::File::read_from(package.fd(), b".bun-tag")
                    .is_ok_and(|tag| tag.as_slice() == res.repository().resolved.slice(buf))
            }
            ResolutionTag::Folder | ResolutionTag::LocalTarball | ResolutionTag::RemoteTarball => {
                installed_package_json(&package).is_some_and(|(name, _)| name == expected_name)
            }
            _ => false,
        };
        if matches {
            Installed::Matches
        } else {
            Installed::Mismatch
        }
    }

    /// Whether some npm package with the same name in the lockfile resolves
    /// to `version`.
    fn version_in_lockfile(&self, pkg_id: PackageID, version: &[u8]) -> bool {
        let lockfile = self.lockfile;
        let buf = lockfile.buffers.string_bytes.as_slice();
        let name_hash = lockfile.packages.items_name_hash()[pkg_id as usize];
        let Some(entry) = lockfile.package_index.get(&name_hash) else {
            return false;
        };
        let pkg_res = lockfile.packages.items_resolution();
        entry.as_slice().iter().any(|&id| {
            pkg_res.get(id as usize).is_some_and(|res| {
                res.tag == ResolutionTag::Npm
                    && without_build(version)
                        == without_build(res.npm().version.fmt(buf).to_string().as_bytes())
            })
        })
    }
}

/// Appends `rows` to `expected` sorted, one row per name.
fn push_rows<'a>(
    expected: &mut Vec<(&'a [u8], PackageID)>,
    rows: &mut Vec<(&'a [u8], PackageID)>,
) -> Range<u32> {
    index_sort::sort_vec_unstable_by(rows, |a, b| a.cmp(b));
    let start = expected.len();
    for &row in rows.iter() {
        if expected.len() == start || expected[expected.len() - 1].0 != row.0 {
            expected.push(row);
        }
    }
    start as u32..expected.len() as u32
}

fn installed_package_json(package: &Dir) -> Option<(Vec<u8>, Option<Vec<u8>>)> {
    let bytes = sys::File::read_from(package.fd(), b"package.json").ok()?;
    crate::initialize_store();
    let source = bun_ast::Source::init_path_string_owned(b"package.json", bytes);
    let mut log = bun_ast::Log::init();
    let mut checker = crate::bun_json::PackageJSONVersionChecker::init(&source, &mut log);
    if checker.parse().is_err() || checker.has_errors() || !checker.has_found_name {
        return None;
    }
    let version = checker
        .has_found_version
        .then(|| checker.found_version().to_vec());
    Some((checker.found_name().to_vec(), version))
}

// https://github.com/oven-sh/bun/issues/13563
fn without_build(version: &[u8]) -> &[u8] {
    &version[..strings::last_index_of_char(version, b'+').unwrap_or(version.len())]
}

fn plan_hoisted(
    manager: &mut PackageManager,
    workspace_names: &[Box<[u8]>],
    selection: Option<&Selection>,
    plan: &mut Plan,
) {
    let root_protected: &[Box<[u8]>] = match selection {
        Some(sel) => &sel.protected_aliases,
        None => &[],
    };
    let keep_workspaces = |entry: &Entry| {
        contains(workspace_names, entry.alias) || contains(root_protected, entry.alias)
    };
    if manager.lockfile.packages.len() == 0 {
        if let Ok(dir) = Dir::open(b"node_modules") {
            scan_folder(dir, b"node_modules", false, &keep_workspaces, plan);
        }
        return;
    }

    if hoist_install_tree(manager, install_features(manager)).is_err() {
        manager.crash();
    }

    let quiet = manager.options.log_level == LogLevel::Silent;
    let features = manager.options.local_package_features;
    let filtered = !features.dev_dependencies
        || !features.optional_dependencies
        || !features.peer_dependencies;
    let lockfile: &Lockfile = &manager.lockfile;
    let hoisted = HoistedTree::init(lockfile, HoistedTreeInit { quiet, filtered });
    let pkg_res = lockfile.packages.items_resolution();
    let nested_trees = hoisted.nested();

    let tree_importer: Vec<PackageID> = match selection {
        Some(_) => tree_importers(lockfile),
        None => Vec::new(),
    };

    let mut visited = handle_oom(DynamicBitSet::init_empty(pkg_res.len()));
    for tree_idx in 0..hoisted.folders.len() {
        if !hoisted.is_folder(tree_idx) {
            continue;
        }
        let folder_path = hoisted.path(tree_idx);
        let importer = tree_importer.get(tree_idx).copied().unwrap_or(0);
        if selection.is_some_and(|sel| importer != 0 && !sel.selected.is_set(importer as usize)) {
            continue;
        }
        let protected: &[Box<[u8]>] = if importer == 0 { root_protected } else { &[] };
        let tree_id = tree_idx as tree::Id;
        let owner = tree_owner(lockfile, tree_idx);
        if owner != invalid_package_id && (owner as usize) < pkg_res.len() {
            visited.set(owner as usize);
            let tag = pkg_res[owner as usize].tag;
            if tag != ResolutionTag::Root
                && tag != ResolutionTag::Workspace
                && has_bundled_deps(lockfile, owner)
            {
                continue;
            }
        }

        let expected = hoisted.expected(tree_idx);

        let Some(dir) = open_tree_folder(lockfile, tree_id) else {
            continue;
        };

        for &(alias, pkg_id) in expected {
            if (pkg_id as usize) >= pkg_res.len()
                || tree_of(&nested_trees, tree_id, alias).is_some()
            {
                continue;
            }
            if !extracted(pkg_res[pkg_id as usize].tag) || has_bundled_deps(lockfile, pkg_id) {
                continue;
            }
            let Some(nested) = descend(&dir, alias)
                .and_then(|package| open_real_subdir(&package, b"node_modules"))
            else {
                continue;
            };
            let nested_path = join(&join(folder_path, alias), b"node_modules");
            scan_folder(
                nested,
                &nested_path,
                false,
                &|entry: &Entry| {
                    contains(workspace_names, entry.alias)
                        || contains(protected, entry.alias)
                        || !hoisted.removable(tree_id, entry.alias, &nested_path)
                },
                plan,
            );
        }

        let parent = hoisted.above(tree_id);
        scan_folder(
            dir,
            folder_path,
            false,
            &|entry| {
                expected
                    .binary_search_by(|(name, _)| (*name).cmp(entry.alias))
                    .is_ok()
                    || contains(workspace_names, entry.alias)
                    || contains(protected, entry.alias)
                    || !hoisted.removable(parent, entry.alias, folder_path)
            },
            plan,
        );
    }

    if !visited.is_set(0) {
        if let Ok(dir) = Dir::open(b"node_modules") {
            scan_folder(dir, b"node_modules", false, &keep_workspaces, plan);
        }
    }
    for pkg_id in 0..pkg_res.len() {
        let Some(folder_path) = workspace_node_modules(lockfile, pkg_id as PackageID) else {
            continue;
        };
        if visited.is_set(pkg_id)
            || selection.is_some_and(|sel| !sel.selected.is_set(pkg_id))
            || is_pruned_workspace(&*manager, pkg_id)
        {
            continue;
        }
        if let Some(dir) = open_workspace_folder(&folder_path) {
            scan_folder(
                dir,
                &folder_path,
                false,
                &|entry: &Entry| {
                    contains(workspace_names, entry.alias)
                        || !hoisted.removable(0, entry.alias, &folder_path)
                },
                plan,
            );
        }
    }

    if hoisted.kept_mismatched.get() && !quiet {
        bun_core::note!("run 'bun install' first");
    }
}

fn tree_owner(lockfile: &Lockfile, tree_idx: usize) -> PackageID {
    match lockfile.buffers.trees.as_slice()[tree_idx].dependency_id {
        tree::ROOT_DEP_ID => 0,
        dep_id => lockfile.buffers.resolutions.as_slice()[dep_id as usize],
    }
}

fn tree_importers(lockfile: &Lockfile) -> Vec<PackageID> {
    let trees = lockfile.buffers.trees.as_slice();
    let pkg_res = lockfile.packages.items_resolution();
    let mut importers: Vec<PackageID> = Vec::with_capacity(trees.len());
    for tree_idx in 0..trees.len() {
        let owner = tree_owner(lockfile, tree_idx);
        let importer = if tree_idx == 0 {
            0
        } else if (owner as usize) < pkg_res.len()
            && pkg_res[owner as usize].tag == ResolutionTag::Workspace
        {
            owner
        } else {
            importers
                .get(trees[tree_idx].parent as usize)
                .copied()
                .unwrap_or(0)
        };
        importers.push(importer);
    }
    importers
}

fn has_bundled_deps(lockfile: &Lockfile, pkg_id: PackageID) -> bool {
    if pkg_id as usize >= lockfile.packages.len() {
        return false;
    }
    let deps = lockfile.buffers.dependencies.as_slice();
    let slice = lockfile.packages.items_dependencies()[pkg_id as usize];
    (slice.begin() as usize..slice.end() as usize).any(|i| deps[i].behavior.is_bundled())
}

/// A `node_modules` folder with entries the saved tree of `bun.lock` does not place there.
struct UnplacedFolder {
    /// Where the folder is on disk, then the folders Node looks in after it.
    lineage: Vec<Box<[u8]>>,
    dir: Dir,
    entries: Vec<UnplacedEntry>,
}

struct UnplacedEntry {
    alias: Box<[u8]>,
    /// The lockfile this run loaded placed the entry: `removable` decides. Else `collapsed_into_ancestor` does.
    was_placed: bool,
    kind: EntryKind,
}

impl UnplacedEntry {
    /// A link that no lockfile placed stays: `bun link` without `--save` makes one on purpose.
    fn is_candidate(&self) -> bool {
        match self.kind {
            EntryKind::Directory => true,
            EntryKind::SymLink => self.was_placed,
            _ => false,
        }
    }
}

/// Hoisted post-install pass (install_with_manager.rs). Returns how many entries it removed and how many it could not.
#[cold]
#[inline(never)]
pub(crate) fn remove_collapsed_copies(
    manager: &mut PackageManager,
    before: &Lockfile,
    summary: &package_install::Summary,
    workspace_filters: &[WorkspaceFilter],
) -> (u32, u32) {
    let unplaced = find_unplaced(manager, before, summary, workspace_filters);
    if unplaced.is_empty() {
        return (0, 0);
    }
    // Only the install tree applies the self-contained barrier. It carries every dependency type, so a copy under
    // a dependency that `--production` / `--omit` skipped stays.
    let Ok(saved) = hoist_install_tree(manager, full_install_features(install_features(manager)))
    else {
        return (0, 0);
    };
    let counts = plan_and_remove_unplaced(manager, unplaced);
    restore_tree(&mut manager.lockfile, saved);
    counts
}

/// Nested and workspace entries the saved tree of `manager.lockfile` does not place. It never looks in the root folder.
fn find_unplaced(
    manager: &PackageManager,
    before: &Lockfile,
    summary: &package_install::Summary,
    workspace_filters: &[WorkspaceFilter],
) -> Vec<UnplacedFolder> {
    let after: &Lockfile = &manager.lockfile;
    let pkg_res = after.packages.items_resolution();
    let is_selected = |pkg_id: PackageID| WorkspaceFilter::is_selected(workspace_filters, pkg_id);
    // Nothing to compare when `before` placed every row in the root folder.
    let replaced = before.buffers.trees.len() > 1;

    let mut workspace_folders: Vec<Box<[u8]>> = Vec::new();
    let mut listings: Vec<(Box<[u8]>, Dir, Vec<(Box<[u8]>, EntryKind)>)> = Vec::new();
    for pkg_id in 0..pkg_res.len() {
        let Some(folder) = workspace_node_modules(after, pkg_id as PackageID) else {
            continue;
        };
        if replaced {
            workspace_folders.push(folder.clone());
        }
        if is_pruned_workspace(manager, pkg_id)
            || !is_selected(pkg_id as PackageID)
            || has_bundled_deps(after, pkg_id as PackageID)
        {
            continue;
        }
        let Some(dir) = open_workspace_folder(&folder) else {
            continue;
        };
        let aliases = read_aliases(&dir);
        if !aliases.is_empty() {
            listings.push((folder, dir, aliases));
        }
    }

    let installed = summary
        .successfully_installed
        .as_ref()
        .filter(|_| summary.success > 0 && summary.skipped > 0);
    let mut unplaced: Vec<UnplacedFolder> = Vec::new();
    if listings.is_empty() && installed.is_none() && !replaced {
        return unplaced;
    }

    let init = HoistedTreeInit {
        quiet: true,
        filtered: false,
    };
    let placed = HoistedTree::init(after, init);
    let placed_at = folders_on_disk(&placed);
    let workspace_names = collect_workspace_names(manager);

    let old = replaced.then(|| HoistedTree::init(before, init));
    let old_at = old.as_ref().map(folders_on_disk);
    if let Some(old) = &old {
        sort_names(&mut workspace_folders);
        let old_importers: Vec<PackageID> = if workspace_filters.is_empty() {
            Vec::new()
        } else {
            tree_importers(before)
        };
        let is_old_selected = |old_idx: usize| {
            let Some(&importer) = old_importers.get(old_idx) else {
                return true;
            };
            if importer == 0 {
                return is_selected(0);
            }
            let name_hash = before.packages.items_name_hash()[importer as usize];
            let after_name_hashes = after.packages.items_name_hash();
            (0..pkg_res.len()).any(|pkg_id| {
                pkg_res[pkg_id].tag == ResolutionTag::Workspace
                    && after_name_hashes[pkg_id] == name_hash
                    && is_selected(pkg_id as PackageID)
            })
        };
        for old_idx in 1..old.folders.len() {
            if !old.is_folder(old_idx) {
                continue;
            }
            let disk = old.disk(old_idx);
            // A workspace's own folder is listed instead.
            if contains(&workspace_folders, disk) || !is_old_selected(old_idx) {
                continue;
            }
            let now = tree_at(&placed_at, disk);
            let still_placed = |alias: &[u8]| {
                now.is_some_and(|id| placed.expected_in(id, alias).is_some())
                    || contains(&workspace_names, alias)
            };
            if old
                .expected(old_idx)
                .iter()
                .all(|&(alias, _)| still_placed(alias))
                || has_bundled_deps(before, tree_owner(before, old_idx))
                || now.is_some_and(|id| has_bundled_deps(after, tree_owner(after, id as usize)))
            {
                continue;
            }
            let Some(dir) = open_tree_folder(before, old_idx as tree::Id) else {
                continue;
            };
            let entries: Vec<UnplacedEntry> = old
                .expected(old_idx)
                .iter()
                .filter(|&&(alias, _)| !still_placed(alias))
                .map(|&(alias, _)| UnplacedEntry {
                    alias: alias.into(),
                    was_placed: true,
                    kind: entry_kind_of(&dir, alias),
                })
                .filter(UnplacedEntry::is_candidate)
                .collect();
            if !entries.is_empty() {
                unplaced.push(UnplacedFolder {
                    lineage: lineage(old, old_idx as tree::Id),
                    dir,
                    entries,
                });
            }
        }
    }

    for (folder, dir, aliases) in listings {
        let now = tree_at(&placed_at, &folder);
        let was = old_at.as_ref().and_then(|old_at| tree_at(old_at, &folder));
        let entries: Vec<UnplacedEntry> = aliases
            .into_iter()
            .filter(|(alias, _)| {
                !contains(&workspace_names, alias)
                    && !now.is_some_and(|id| placed.expected_in(id, alias).is_some())
            })
            .map(|(alias, kind)| UnplacedEntry {
                was_placed: match (&old, was) {
                    (Some(old), Some(id)) => old.expected_in(id, &alias).is_some(),
                    _ => false,
                },
                alias,
                kind,
            })
            .filter(UnplacedEntry::is_candidate)
            .collect();
        if !entries.is_empty() {
            unplaced.push(UnplacedFolder {
                lineage: vec![folder],
                dir,
                entries,
            });
        }
    }

    if let Some(installed) = installed {
        find_copies_above_installed(after, &placed, installed, workspace_filters, &mut unplaced);
    }
    unplaced
}

/// One `lstat` per place where a leftover copy would hide a package this run installed from a dependent that stayed.
fn find_copies_above_installed(
    after: &Lockfile,
    placed: &HoistedTree<'_>,
    installed: &DynamicBitSet,
    workspace_filters: &[WorkspaceFilter],
    unplaced: &mut Vec<UnplacedFolder>,
) {
    let buf = after.buffers.string_bytes.as_slice();
    let deps = after.buffers.dependencies.as_slice();
    let resolutions = after.buffers.resolutions.as_slice();
    let pkg_res = after.packages.items_resolution();
    let dep_slices = after.packages.items_dependencies();
    let was_installed = |pkg_id: usize| installed.is_set_allow_out_of_bound(pkg_id, false);
    let ships_folder = |tree_id: tree::Id| {
        let owner = tree_owner(after, tree_id as usize);
        workspace_path(after, owner).is_none() && has_bundled_deps(after, owner)
    };
    let nested = placed.nested();
    let importers: Vec<PackageID> = if workspace_filters.is_empty() {
        Vec::new()
    } else {
        tree_importers(after)
    };

    // `(folder, package placed in it or empty, name)`: `<folder>/<package>/node_modules/<name>`, or `<folder>/<name>`.
    let mut probes: Vec<(tree::Id, &[u8], &[u8])> = Vec::new();
    for tree_idx in 0..placed.folders.len() {
        if !placed.is_folder(tree_idx)
            || importers
                .get(tree_idx)
                .is_some_and(|&id| !WorkspaceFilter::is_selected(workspace_filters, id))
        {
            continue;
        }
        let tree_id = tree_idx as tree::Id;
        for &(package, pkg_id) in placed.expected(tree_idx) {
            let pkg = pkg_id as usize;
            // What this run extracted holds only what its tarball ships. A bundle ships its own `node_modules`.
            if pkg >= pkg_res.len()
                || was_installed(pkg)
                || !extracted(pkg_res[pkg].tag)
                || has_bundled_deps(after, pkg_id)
            {
                continue;
            }
            let own = tree_of(&nested, tree_id, package);
            let slice = dep_slices[pkg];
            for dep_id in slice.begin() as usize..slice.end() as usize {
                let target = resolutions[dep_id] as usize;
                if target >= pkg_res.len() || !was_installed(target) {
                    continue;
                }
                let name = deps[dep_id].name.slice(buf);
                let Some((provider, _)) = placed.expected_from(own.unwrap_or(tree_id), name) else {
                    continue;
                };
                let provider = placed.first[provider as usize];
                if own == Some(provider) {
                    continue;
                }
                probes.push((tree_id, package, name));
                let mut between = tree_id;
                while between != provider && (between as usize) < placed.trees.len() {
                    // A workspace's own folder is listed instead.
                    if workspace_path(after, tree_owner(after, between as usize)).is_none()
                        && !ships_folder(between)
                    {
                        probes.push((between, b"", name));
                    }
                    between = placed.above(between);
                    if (between as usize) < placed.trees.len() {
                        between = placed.first[between as usize];
                    }
                }
            }
        }
    }
    index_sort::sort_vec_unstable_by(&mut probes, |a, b| a.cmp(b));
    probes.dedup();

    let mut path: Vec<u8> = Vec::new();
    let mut at = 0;
    while at < probes.len() {
        let tree_id = probes[at].0;
        let mut end = at;
        while end < probes.len() && probes[end].0 == tree_id {
            end += 1;
        }
        let folder_probes = &probes[at..end];
        at = end;
        let Some(dir) = open_tree_folder(after, tree_id) else {
            continue;
        };

        let mut i = 0;
        let mut direct: Vec<UnplacedEntry> = Vec::new();
        while i < folder_probes.len() && folder_probes[i].1.is_empty() {
            let name = folder_probes[i].2;
            let entry = UnplacedEntry {
                alias: name.into(),
                was_placed: false,
                kind: entry_kind_of(&dir, name),
            };
            if entry.is_candidate() {
                direct.push(entry);
            }
            i += 1;
        }
        while i < folder_probes.len() {
            let package = folder_probes[i].1;
            let mut found: Vec<UnplacedEntry> = Vec::new();
            while i < folder_probes.len() && folder_probes[i].1 == package {
                let name = folder_probes[i].2;
                path.clear();
                path.extend_from_slice(package);
                path.push(SEP);
                path.extend_from_slice(ROOT_DIR);
                path.push(SEP);
                path.extend_from_slice(name);
                let entry = UnplacedEntry {
                    alias: name.into(),
                    was_placed: false,
                    kind: lstat_kind(&dir, &path),
                };
                if entry.is_candidate() {
                    found.push(entry);
                }
                i += 1;
            }
            if found.is_empty() {
                continue;
            }
            // `lstat` follows a link at `package`. A linked package's folder is not this project's to clean.
            let Some(inner) =
                descend(&dir, package).and_then(|package| open_real_subdir(&package, ROOT_DIR))
            else {
                continue;
            };
            let mut lineage_below = lineage(placed, tree_id);
            lineage_below.insert(0, join(&join(&lineage_below[0], package), ROOT_DIR));
            unplaced.push(UnplacedFolder {
                lineage: lineage_below,
                dir: inner,
                entries: found,
            });
        }
        if !direct.is_empty() {
            unplaced.push(UnplacedFolder {
                lineage: lineage(placed, tree_id),
                dir,
                entries: direct,
            });
        }
    }
}

/// `manager.lockfile` carries the install tree here.
fn plan_and_remove_unplaced(manager: &PackageManager, unplaced: Vec<UnplacedFolder>) -> (u32, u32) {
    let after: &Lockfile = &manager.lockfile;
    let quiet = manager.options.log_level == LogLevel::Silent;
    let new = HoistedTree::init(
        after,
        HoistedTreeInit {
            quiet,
            filtered: false,
        },
    );
    let new_at = folders_on_disk(&new);

    let mut plan = Plan::default();
    let mut decided: Vec<Box<[u8]>> = Vec::new();
    for UnplacedFolder {
        lineage,
        dir,
        entries,
    } in unplaced
    {
        let disk = &lineage[0];
        let now = tree_at(&new_at, disk);
        if now.is_some_and(|id| {
            let owner = tree_owner(after, id as usize);
            workspace_path(after, owner).is_none() && has_bundled_deps(after, owner)
        }) {
            continue;
        }
        let from = lineage
            .iter()
            .find_map(|folder| tree_at(&new_at, folder))
            .unwrap_or(0);
        let folder_idx = plan.push_folder(disk, FolderKind::NodeModules);
        for entry in &entries {
            let alias: &[u8] = &entry.alias;
            let path = join(disk, alias);
            if now.is_some_and(|id| new.expected_in(id, alias).is_some())
                || decided.iter().any(|seen| **seen == *path)
            {
                continue;
            }
            decided.push(path);
            let goes = if entry.was_placed {
                new.removable(from, alias, disk)
            } else {
                new.collapsed_into_ancestor(from, alias)
            };
            if goes {
                plan.remove_alias(folder_idx, &dir, alias);
            }
        }
        plan.retain(folder_idx, dir);
    }

    if plan.removals.is_empty() {
        return (0, 0);
    }
    let failed = execute(&plan, true);
    housekeeping(&plan, Layout::Hoisted, manager);
    ((plan.removals.len() - failed) as u32, failed as u32)
}

/// The folder of `tree_id` on disk, then the folders Node looks in after it.
fn lineage(hoisted: &HoistedTree<'_>, tree_id: tree::Id) -> Vec<Box<[u8]>> {
    let mut out: Vec<Box<[u8]>> = Vec::new();
    let mut id = tree_id;
    while (id as usize) < hoisted.trees.len() {
        out.push(disk_folder(hoisted.lockfile, id));
        id = hoisted.above(id);
    }
    out
}

/// `(folder on disk, tree)` for each folder with rows, sorted.
fn folders_on_disk<'a>(hoisted: &'a HoistedTree<'_>) -> Vec<(&'a [u8], tree::Id)> {
    let mut folders: Vec<(&[u8], tree::Id)> = (0..hoisted.folders.len())
        .filter(|&i| hoisted.is_folder(i))
        .map(|i| (hoisted.disk(i), i as tree::Id))
        .collect();
    index_sort::sort_vec_unstable_by(&mut folders, |a, b| a.0.cmp(b.0));
    folders
}

fn tree_at(folders: &[(&[u8], tree::Id)], disk: &[u8]) -> Option<tree::Id> {
    folders
        .binary_search_by(|(folder, _)| (*folder).cmp(disk))
        .ok()
        .map(|i| folders[i].1)
}

/// The tree of the package `name` placed in `folder`, from `HoistedTree::nested`.
fn tree_of(
    nested: &[(tree::Id, &[u8], tree::Id)],
    folder: tree::Id,
    name: &[u8],
) -> Option<tree::Id> {
    let at = nested.partition_point(|&(in_folder, of, _)| (in_folder, of) < (folder, name));
    nested
        .get(at)
        .filter(|&&(in_folder, of, _)| in_folder == folder && of == name)
        .map(|row| row.2)
}

fn open_tree_folder(lockfile: &Lockfile, tree_id: tree::Id) -> Option<Dir> {
    let trees = lockfile.buffers.trees.as_slice();
    let deps = lockfile.buffers.dependencies.as_slice();
    let buf = lockfile.buffers.string_bytes.as_slice();
    let mut chain: Vec<tree::Id> = Vec::new();
    let mut id = tree_id;
    while id != 0 && (id as usize) < trees.len() {
        chain.push(id);
        id = trees[id as usize].parent;
    }
    let mut dir = Dir::open(b"node_modules").ok()?;
    while let Some(id) = chain.pop() {
        // `node_modules/<workspace>` is a link `bun link` may point anywhere; the tree lives in the workspace folder.
        if let Some(folder) = workspace_node_modules(lockfile, tree_owner(lockfile, id as usize)) {
            dir = open_workspace_folder(&folder)?;
            continue;
        }
        let package = descend(&dir, trees[id as usize].folder_name(deps, buf))?;
        dir = open_real_subdir(&package, b"node_modules")?;
    }
    Some(dir)
}

/// Walks up from `tree_id` to a workspace's tree or to the root. `chain` gets the trees passed on the way, nearest first. Returns the workspace's path.
fn chain_to_workspace<'a>(
    lockfile: &'a Lockfile,
    tree_id: tree::Id,
    chain: &mut Vec<tree::Id>,
) -> Option<&'a [u8]> {
    let trees = lockfile.buffers.trees.as_slice();
    chain.clear();
    let mut id = tree_id;
    while id != 0 && (id as usize) < trees.len() {
        if let Some(path) = workspace_path(lockfile, tree_owner(lockfile, id as usize)) {
            return Some(path);
        }
        chain.push(id);
        id = trees[id as usize].parent;
    }
    None
}

/// Appends `[<base>/]node_modules`, then `/<name>/node_modules` per tree of `chain`, farthest first.
fn push_folder_path(
    lockfile: &Lockfile,
    base: Option<&[u8]>,
    chain: &mut Vec<tree::Id>,
    out: &mut Vec<u8>,
) {
    let trees = lockfile.buffers.trees.as_slice();
    let deps = lockfile.buffers.dependencies.as_slice();
    let buf = lockfile.buffers.string_bytes.as_slice();
    if let Some(base) = base {
        out.extend_from_slice(base);
        out.push(SEP);
    }
    out.extend_from_slice(ROOT_DIR);
    while let Some(id) = chain.pop() {
        out.push(SEP);
        out.extend_from_slice(trees[id as usize].folder_name(deps, buf));
        out.push(SEP);
        out.extend_from_slice(ROOT_DIR);
    }
}

/// Where the folder of `tree_id` is on disk, for a tree with or without rows.
fn disk_folder(lockfile: &Lockfile, tree_id: tree::Id) -> Box<[u8]> {
    let mut chain: Vec<tree::Id> = Vec::new();
    let mut out: Vec<u8> = Vec::new();
    let workspace = chain_to_workspace(lockfile, tree_id, &mut chain);
    push_folder_path(lockfile, workspace, &mut chain, &mut out);
    out.into_boxed_slice()
}

fn workspace_path(lockfile: &Lockfile, pkg_id: PackageID) -> Option<&[u8]> {
    let res = lockfile.packages.items_resolution().get(pkg_id as usize)?;
    if res.tag != ResolutionTag::Workspace {
        return None;
    }
    let buf = lockfile.buffers.string_bytes.as_slice();
    let path = strings::without_trailing_slash(res.workspace().slice(buf));
    (!path.is_empty()).then_some(path)
}

fn workspace_node_modules(lockfile: &Lockfile, pkg_id: PackageID) -> Option<Box<[u8]>> {
    Some(join(workspace_path(lockfile, pkg_id)?, ROOT_DIR))
}

/// A workspace's `node_modules` that is a link leads into a folder this workspace does not own, the root's for one.
fn open_workspace_folder(folder: &[u8]) -> Option<Dir> {
    open_real_subdir(&Dir::cwd(), folder)
}

fn descend(dir: &Dir, alias: &[u8]) -> Option<Dir> {
    let (scope, name) = match strings::split_once_char(alias, b'/') {
        Some(split) if alias.first() == Some(&b'@') => (Some(split.0), split.1),
        _ => (None, alias),
    };
    let scope_dir = match scope {
        Some(scope) => Some(open_real_subdir(dir, scope)?),
        None => None,
    };
    open_real_subdir(scope_dir.as_ref().unwrap_or(dir), name)
}

fn entry_kind_of(dir: &Dir, alias: &[u8]) -> EntryKind {
    match strings::split_once_char(alias, b'/') {
        Some((scope, name)) if alias.first() == Some(&b'@') => match open_real_subdir(dir, scope) {
            Some(scope_dir) => lstat_kind(&scope_dir, name),
            None => EntryKind::Unknown,
        },
        _ => lstat_kind(dir, alias),
    }
}

fn open_real_subdir(dir: &Dir, name: &[u8]) -> Option<Dir> {
    if lstat_kind(dir, name) != EntryKind::Directory {
        return None;
    }
    dir.open_at_with(name, O::RDONLY | O::CLOEXEC | O::NOFOLLOW)
        .ok()
}

#[cfg(not(windows))]
fn lstat_kind(dir: &Dir, name: &[u8]) -> EntryKind {
    match sys::lstatat(dir.fd(), ZStr::from_slice_with_nul(&zname(name))) {
        Ok(st) => sys::kind_from_mode(st.st_mode as sys::Mode),
        Err(_) => EntryKind::Unknown,
    }
}

// `sys::lstatat` fstats the opened reparse point, which reports junctions as directories.
#[cfg(windows)]
fn lstat_kind(dir: &Dir, name: &[u8]) -> EntryKind {
    let mut dir_buf = bun_paths::path_buffer_pool::get();
    let Ok(dir_path) = dir.get_fd_path(&mut dir_buf) else {
        return EntryKind::Unknown;
    };
    let mut path_buf = bun_paths::path_buffer_pool::get();
    let path = bun_paths::resolve_path::join_string_buf_z::<bun_paths::platform::Auto>(
        &mut path_buf[..],
        &[&*dir_path, name],
    );
    match sys::lstat(path) {
        Ok(st) => sys::kind_from_mode(st.st_mode as sys::Mode),
        Err(_) => EntryKind::Unknown,
    }
}

fn entry_kind(dir: &Dir, name: &[u8], kind: EntryKind) -> EntryKind {
    if kind != EntryKind::Unknown {
        return kind;
    }
    lstat_kind(dir, name)
}

fn read_entries(dir: &Dir) -> Vec<(Box<[u8]>, EntryKind)> {
    let mut out = Vec::new();
    let mut iter = sys::iterate_dir(dir.fd());
    while let Ok(Some(entry)) = iter.next() {
        let name = entry.name.slice_u8();
        if name.first() == Some(&b'.') {
            continue;
        }
        let kind = entry_kind(dir, name, entry.kind);
        if kind == EntryKind::Directory || kind == EntryKind::SymLink {
            out.push((name.into(), kind));
        }
    }
    out
}

/// The packages in a `node_modules` folder by name: `@scope/name` for one in a scope folder.
fn read_aliases(dir: &Dir) -> Vec<(Box<[u8]>, EntryKind)> {
    let mut out: Vec<(Box<[u8]>, EntryKind)> = Vec::new();
    for (name, kind) in read_entries(dir) {
        if name.first() == Some(&b'@') && kind == EntryKind::Directory {
            let Ok(scope_dir) = dir.open_at(&name) else {
                continue;
            };
            for (inner, inner_kind) in read_entries(&scope_dir) {
                out.push((join_alias(&name, &inner), inner_kind));
            }
            continue;
        }
        out.push((name, kind));
    }
    out
}

fn scan_folder(
    dir: Dir,
    folder_path: &[u8],
    touched: bool,
    keep: &dyn Fn(&Entry) -> bool,
    plan: &mut Plan,
) -> usize {
    let folder_idx = plan.push_folder(folder_path, FolderKind::NodeModules);
    plan.folders[folder_idx].touched = touched;
    let mut alias = Vec::new();
    for (name, kind) in read_entries(&dir) {
        if name.first() == Some(&b'@') && kind == EntryKind::Directory {
            let Ok(scope_dir) = dir.open_at(&name) else {
                continue;
            };
            let scope_path = join(folder_path, &name);
            let scope_idx = plan.push_folder(&scope_path, FolderKind::Scope { parent: folder_idx });
            for (inner, inner_kind) in read_entries(&scope_dir) {
                alias.clear();
                alias.extend_from_slice(&name);
                alias.push(b'/');
                alias.extend_from_slice(&inner);
                let entry = Entry {
                    dir: &scope_dir,
                    alias: &alias,
                    name: &inner,
                    kind: inner_kind,
                };
                plan.checked += 1;
                if !keep(&entry) {
                    plan.remove(scope_idx, &inner, inner_kind);
                }
            }
            plan.retain(scope_idx, scope_dir);
            continue;
        }
        let entry = Entry {
            dir: &dir,
            alias: &name,
            name: &name,
            kind,
        };
        plan.checked += 1;
        if !keep(&entry) {
            plan.remove(folder_idx, &name, kind);
        }
    }
    plan.retain(folder_idx, dir);
    folder_idx
}

fn importer_roots(manager: &PackageManager, keep: &dyn Fn(usize) -> bool) -> Vec<PackageID> {
    let pkg_res = manager.lockfile.packages.items_resolution();
    (0..pkg_res.len())
        .filter(|&id| {
            (id == 0 || pkg_res[id].tag == ResolutionTag::Workspace)
                && !is_pruned_workspace(manager, id)
                && keep(id)
        })
        .map(|id| id as PackageID)
        .collect()
}

fn wanted_packages(manager: &PackageManager, selection: Option<&Selection>) -> DynamicBitSet {
    let lockfile: &Lockfile = &manager.lockfile;
    let resolutions = lockfile.buffers.resolutions.as_slice();
    let options = reachable::Options::install(manager);
    let mut wanted = if manager.summary.pruned_workspaces.is_empty() {
        reachable::packages(lockfile, resolutions, options)
    } else {
        let roots = importer_roots(manager, &|_| true);
        reachable::packages_from(lockfile, resolutions, &roots, false, options)
    };
    if let Some(sel) = selection {
        let unselected = importer_roots(manager, &|id| !sel.selected.is_set(id));
        if !unselected.is_empty() {
            let full = reachable::Options {
                dev: true,
                optional: true,
                peer: true,
                optional_peer: true,
                ..options
            };
            let protected =
                reachable::packages_from(lockfile, resolutions, &unselected, false, full);
            wanted.unmanaged.set_union(&protected.unmanaged);
        }
    }
    wanted
}

fn build_store_with(manager: &mut PackageManager, features: InstallFeatures) -> Store {
    with_install_features(manager, features, |manager| {
        handle_oom(build_store(
            &*manager,
            &manager.lockfile,
            true,
            &[],
            None,
            Timings::Quiet,
        ))
    })
}

fn push_store_entry_names(
    lockfile: &Lockfile,
    store: &Store,
    wanted: &DynamicBitSet,
    names: &mut Vec<Box<[u8]>>,
) {
    let pkg_res = lockfile.packages.items_resolution();
    let node_pkg_ids = store.nodes.items_pkg_id();
    names.reserve(store.entries.len());
    let mut name: Vec<u8> = Vec::new();
    for (entry_idx, node_id) in store.entries.items_node_id().iter().enumerate() {
        let pkg_id = node_pkg_ids[node_id.get() as usize] as usize;
        if pkg_res[pkg_id].tag == ResolutionTag::Workspace || !wanted.is_set(pkg_id) {
            continue;
        }
        name.clear();
        write!(
            name,
            "{}",
            store_entry::fmt_store_path(store_entry::Id::from(entry_idx as u32), store, lockfile)
        )
        .expect("Vec<u8> write is infallible");
        names.push(name.as_slice().into());
    }
}

// Peer hashes differ between a full install and one narrowed by `--production`/`--omit`; entries laid out by either stay.
fn store_entry_names(manager: &mut PackageManager, wanted: &DynamicBitSet) -> Vec<Box<[u8]>> {
    if manager.lockfile.packages.len() == 0 {
        return Vec::new();
    }
    let own = install_features(manager);
    let full = full_install_features(own);
    let mut names: Vec<Box<[u8]>> = Vec::new();
    for features in [Some(full), (own != full).then_some(own)]
        .into_iter()
        .flatten()
    {
        let store = build_store_with(manager, features);
        push_store_entry_names(&manager.lockfile, &store, wanted, &mut names);
    }
    sort_names(&mut names);
    names.dedup();
    names
}

fn direct_aliases(manager: &PackageManager, pkg_id: PackageID) -> Vec<Box<[u8]>> {
    let lockfile: &Lockfile = &manager.lockfile;
    let buf = lockfile.buffers.string_bytes.as_slice();
    let deps = lockfile.buffers.dependencies.as_slice();
    let resolutions = lockfile.buffers.resolutions.as_slice();
    let slice = lockfile.packages.items_dependencies()[pkg_id as usize];
    let mut direct: Vec<Box<[u8]>> = Vec::new();
    for dep_id in slice.begin()..slice.end() {
        if is_filtered_dependency_or_workspace(
            dep_id,
            pkg_id,
            &[],
            true,
            manager,
            lockfile,
            resolutions,
        ) {
            continue;
        }
        let target = resolutions[dep_id as usize];
        if target == invalid_package_id || (target as usize) >= lockfile.packages.len() {
            continue;
        }
        direct.push(deps[dep_id as usize].name.slice(buf).into());
    }
    sort_names(&mut direct);
    direct.dedup();
    direct
}

fn public_hoist_matches(manager: &PackageManager, alias: &[u8]) -> bool {
    manager
        .options
        .public_hoist_pattern
        .as_ref()
        .is_some_and(|pattern| pattern.is_match(alias))
}

fn plan_isolated(
    manager: &mut PackageManager,
    workspace_names: &[Box<[u8]>],
    selection: Option<&Selection>,
    plan: &mut Plan,
) {
    let wanted = wanted_packages(manager, selection);
    let names = store_entry_names(manager, &wanted);
    let manager: &PackageManager = manager;

    let mut removed_store: Vec<Box<[u8]>> = Vec::new();
    if let Ok(store) = Dir::open(STORE_DIR) {
        let store_idx = plan.push_folder(STORE_DIR, FolderKind::Store);
        for (name, kind) in read_entries(&store) {
            if &*name == b"node_modules" {
                continue;
            }
            plan.checked += 1;
            if contains(&names, &name) {
                continue;
            }
            plan.remove(store_idx, &name, kind);
            removed_store.push(name);
        }
        plan.retain(store_idx, store);
    }
    sort_names(&mut removed_store);
    let store_touched = !removed_store.is_empty();

    let lockfile: &Lockfile = &manager.lockfile;
    let buf = lockfile.buffers.string_bytes.as_slice();
    let pkg_res = lockfile.packages.items_resolution();
    for pkg_id in 0..lockfile.packages.len() {
        let res = &pkg_res[pkg_id];
        let folder_path: Box<[u8]> = match res.tag {
            ResolutionTag::Root if pkg_id == 0 => b"node_modules".as_slice().into(),
            ResolutionTag::Workspace => {
                let path = strings::without_trailing_slash(res.workspace().slice(buf));
                if path.is_empty() {
                    continue;
                }
                join(path, b"node_modules")
            }
            _ => continue,
        };
        if selection.is_some_and(|sel| !sel.selected.is_set(pkg_id)) {
            continue;
        }
        if is_pruned_workspace(manager, pkg_id) {
            continue;
        }
        let Ok(dir) = Dir::open(&folder_path) else {
            continue;
        };
        let direct = direct_aliases(manager, pkg_id as PackageID);
        let folder_idx = scan_folder(
            dir,
            &folder_path,
            store_touched,
            &|entry| {
                contains(&direct, entry.alias)
                    || (entry.kind != EntryKind::SymLink && contains(workspace_names, entry.alias))
                    || public_hoist_matches(manager, entry.alias)
                    || (entry.kind == EntryKind::SymLink
                        && store_link_target(entry.dir, entry.name)
                            .is_some_and(|target| contains(&removed_store, &target)))
            },
            plan,
        );
        plan.folders[folder_idx].direct = Some(direct);
    }
}

fn store_link_target(dir: &Dir, name: &[u8]) -> Option<Box<[u8]>> {
    let z = zname(name);
    let mut buf = bun_paths::path_buffer_pool::get();
    let len = sys::readlinkat(dir.fd(), ZStr::from_slice_with_nul(&z), buf.as_mut_slice()).ok()?;
    let mut components = strings::tokenize_any(&buf.as_slice()[..len], b"/\\");
    while let Some(component) = components.next() {
        if component == b".bun" {
            return components
                .next()
                .filter(|entry| strings::contains_char(entry, b'@'))
                .map(Into::into);
        }
    }
    None
}

fn remove_link(dir: &Dir, name: &[u8]) -> sys::Maybe<()> {
    let z = zname(name);
    let z = ZStr::from_slice_with_nul(&z);
    let result = sys::unlinkat(dir.fd(), z);
    #[cfg(windows)]
    let result = result.or_else(|_| sys::rmdirat(dir.fd(), z));
    result
}

fn execute(plan: &Plan, quiet: bool) -> usize {
    let mut failed = 0usize;
    let mut removed_from = handle_oom(DynamicBitSet::init_empty(plan.folders.len()));

    for removal in &plan.removals {
        let dir = plan.dir(removal.folder);
        let result = match removal.kind {
            EntryKind::SymLink => remove_link(dir, &removal.name),
            _ => dir.delete_tree(&removal.name),
        };
        match result {
            Ok(()) => {}
            Err(err) if err.get_errno() == E::ENOENT => {}
            Err(err) => {
                Output::err_generic(
                    "failed to remove {}: {} <d>({})<r>",
                    (
                        BStr::new(&plan.path(removal)),
                        BStr::new(err.name()),
                        BStr::new(err.msg().unwrap_or(b"unknown error")),
                    ),
                );
                failed += 1;
                continue;
            }
        }
        if !quiet {
            plan.print_row(removal);
        }
        removed_from.set(removal.folder);
    }

    for (idx, folder) in plan.folders.iter().enumerate() {
        let FolderKind::Scope { parent } = folder.kind else {
            continue;
        };
        if !removed_from.is_set(idx) {
            continue;
        }
        rmdir(plan.dir(parent), plan.scope_name(idx, parent));
    }

    failed
}

fn rmdir(dir: &Dir, name: &[u8]) {
    let z = zname(name);
    let _ = sys::rmdirat(dir.fd(), ZStr::from_slice_with_nul(&z));
}

fn is_dangling(dir: &Dir, name: &[u8]) -> bool {
    let z = zname(name);
    match sys::fstatat(dir.fd(), ZStr::from_slice_with_nul(&z)) {
        Ok(_) => false,
        Err(err) => matches!(err.get_errno(), E::ENOENT | E::ENOTDIR),
    }
}

fn unlink_links(dir: &Dir, should_unlink: &dyn Fn(&Dir, &[u8], &[u8]) -> bool) {
    let mut alias = Vec::new();
    for (name, kind) in read_entries(dir) {
        match kind {
            EntryKind::SymLink => {
                if should_unlink(dir, &name, &name) {
                    let _ = remove_link(dir, &name);
                }
            }
            EntryKind::Directory if name.first() == Some(&b'@') => {
                let Ok(scope_dir) = dir.open_at(&name) else {
                    continue;
                };
                let mut unlinked = false;
                for (inner, inner_kind) in read_entries(&scope_dir) {
                    if inner_kind != EntryKind::SymLink {
                        continue;
                    }
                    alias.clear();
                    alias.extend_from_slice(&name);
                    alias.push(b'/');
                    alias.extend_from_slice(&inner);
                    if should_unlink(&scope_dir, &alias, &inner) {
                        unlinked |= remove_link(&scope_dir, &inner).is_ok();
                    }
                }
                drop(scope_dir);
                if unlinked {
                    rmdir(dir, &name);
                }
            }
            _ => {}
        }
    }
}

#[cfg(not(windows))]
fn prune_bins(dir: &Dir) {
    let Some(bin) = open_real_subdir(dir, b".bin") else {
        return;
    };
    let mut dangling: Vec<Box<[u8]>> = Vec::new();
    let mut iter = sys::iterate_dir(bin.fd());
    while let Ok(Some(entry)) = iter.next() {
        let name = entry.name.slice_u8();
        if entry_kind(&bin, name, entry.kind) == EntryKind::SymLink && is_dangling(&bin, name) {
            dangling.push(name.into());
        }
    }
    drop(iter);
    for name in &dangling {
        let _ = remove_link(&bin, name);
    }
}

// `.bunx` layout: windows-shim/BinLinkingShim.rs (target path is relative to this node_modules folder).
#[cfg(windows)]
fn prune_bins(dir: &Dir) {
    let Some(bin) = open_real_subdir(dir, b".bin") else {
        return;
    };
    let mut shims: Vec<Box<[u8]>> = Vec::new();
    let mut iter = sys::iterate_dir(bin.fd());
    while let Ok(Some(entry)) = iter.next() {
        let name = entry.name.slice_u8();
        if let Some(stem) = name.strip_suffix(b".bunx") {
            shims.push(stem.into());
        }
    }
    drop(iter);
    let mut file_name: Vec<u8> = Vec::new();
    for stem in &shims {
        file_name.clear();
        file_name.extend_from_slice(stem);
        file_name.extend_from_slice(b".bunx");
        let Ok(shim) = sys::File::read_from(bin.fd(), &file_name) else {
            continue;
        };
        let Some(target_len) = shim.chunks_exact(2).position(|unit| unit == [b'"', 0]) else {
            continue;
        };
        let target = strings::to_utf8_alloc_from_le_bytes(&shim[..target_len * 2]);
        if !is_dangling(dir, &target) {
            continue;
        }
        let _ = remove_link(&bin, &file_name);
        file_name.truncate(stem.len());
        file_name.extend_from_slice(b".exe");
        let _ = remove_link(&bin, &file_name);
    }
}

fn housekeeping(plan: &Plan, layout: Layout, manager: &PackageManager) {
    for (idx, folder) in plan.folders.iter().enumerate() {
        if !folder.touched {
            continue;
        }
        match folder.kind {
            FolderKind::Scope { .. } => {}
            FolderKind::Store => {
                if layout != Layout::Isolated {
                    continue;
                }
                let Some(hidden) = open_real_subdir(plan.dir(idx), b"node_modules") else {
                    continue;
                };
                unlink_links(&hidden, &|dir, _, name| is_dangling(dir, name));
            }
            FolderKind::NodeModules => {
                if let (Layout::Isolated, Some(direct)) = (layout, &folder.direct) {
                    if let Ok(dir) = Dir::open(&folder.path) {
                        unlink_links(&dir, &|dir, alias, name| {
                            if contains(direct, alias) {
                                return false;
                            }
                            if public_hoist_matches(manager, alias) {
                                return is_dangling(dir, name);
                            }
                            true
                        });
                    }
                }
                prune_bins(plan.dir(idx));
            }
        }
    }
}
