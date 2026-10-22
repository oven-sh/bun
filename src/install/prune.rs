use core::cell::{Cell, OnceCell, RefCell};
use core::ops::Range;
use std::io::Write as _;
use std::sync::Arc;

use bstr::BStr;
use bun_collections::{DynamicBitSet, index_sort};
use bun_core::time::nano_timestamp;
use bun_core::{Global, Output, ZStr, handle_oom, strings};
use bun_install_types::NodeLinker::NodeLinker;
use bun_paths::SEP;
use bun_paths::path_options::AssumeOk as _;
use bun_sys::{self as sys, Dir, E, EntryKind, O};
use bun_threading::{WaitGroup, WorkPool};

use crate::isolated_install::installer::Installer;
use crate::isolated_install::store::{EntryColumns as _, NodeColumns as _, entry as store_entry};
use crate::isolated_install::{Store, build_whole_store};
use crate::lockfile::package::PackageColumns as _;
use crate::lockfile::tree::is_filtered_dependency_or_workspace;
use crate::lockfile::{LoadResult, Lockfile, print_log_errors, reachable, tree};
use crate::lockfile_real::LinkedMembers;
use crate::lockfile_real::package::{Diff, DiffSummary, DroppedRow, Package};
use crate::package_install::{StagingLock, StagingPath};
use crate::package_manager::Options::{Enable, LogLevel};
use crate::package_manager::patch_package::{isolated_store_folders, package_for_folder};
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
    /// True if no install is running, so any `StagingPath` or `OldModules` folder was left behind
    /// by an install that was killed.
    leftovers: bool,
    /// The folders that `open_workspace_folder` refused to open. If there are any, the plan isn't
    /// executed.
    linked_folders: Vec<Box<[u8]>>,
    /// bun.lock used to place a package in one of `linked_folders` and no longer does, so a stale
    /// copy may still be there.
    left_linked_folder: bool,
    /// The store that an isolated install with this run's options would create.
    store: Option<Store>,
}

impl Plan {
    fn sorted_linked_folders(&mut self) -> &[Box<[u8]>] {
        sort_names(&mut self.linked_folders);
        self.linked_folders.dedup();
        &self.linked_folders
    }

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
        use bun_core::fmt::escape_control_chars;
        bun_core::pretty!("<r><red>-<r> {}", escape_control_chars(&removal.alias));
        if let Some(version) = &removal.version {
            bun_core::pretty!("<d>@{}<r>", escape_control_chars(version));
        }
        let location = self.location(removal);
        if !location.is_empty() {
            bun_core::pretty!(" <d>({})<r>", escape_control_chars(location));
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

/// Formats `path` for a message. On Windows a path can mix separators, because bun.lock stores a
/// workspace's path with `/` and `join` adds the platform's separator.
fn native_path(path: &[u8]) -> impl core::fmt::Display + '_ {
    use bun_core::fmt::{EscapeControlChars, PathFormatOptions, PathSep, fmt_path};
    // On other platforms `\` is an ordinary character in a file name, so it is not converted.
    let path_sep = if cfg!(windows) {
        PathSep::Windows
    } else {
        PathSep::Any
    };
    EscapeControlChars(fmt_path(
        path,
        PathFormatOptions {
            path_sep,
            ..Default::default()
        },
    ))
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

pub(crate) fn sort_names(names: &mut Vec<Box<[u8]>>) {
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

    let staging_lock = StagingLock::acquire();
    let mut plan = Plan {
        leftovers: !staging_lock.is_busy,
        ..Default::default()
    };
    // The root `node_modules` is checked even if `--filter` excludes the root package, because the
    // store is inside it.
    drop(open_workspace_folder(ROOT_DIR, &mut plan.linked_folders));
    match layout {
        Layout::Hoisted => plan_hoisted(manager, &workspace_names, selection.as_ref(), &mut plan),
        Layout::Isolated => plan_isolated(manager, &workspace_names, selection.as_ref(), &mut plan),
    }
    if !plan.linked_folders.is_empty() {
        if !quiet {
            for folder in plan.sorted_linked_folders() {
                Output::err_generic("cannot prune symlink {}", (native_path(folder),));
            }
            bun_core::note!("to prune this project, remove the link and run 'bun install'");
        }
        Global::exit(1);
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
        Global::exit(manager.options.check as u32);
    }

    let failed = execute(&plan, quiet);
    let lost_bins = housekeeping(&plan, layout, manager);
    hand_over_names(&plan, &lost_bins, layout, manager);

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
        if let Some(dir) = open_workspace_folder(&folder, &mut Vec::new()) {
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
        if arg.starts_with(b"--dry-run") || arg.starts_with(b"--check") {
            continue;
        }
        bun_core::pretty!(" {}", BStr::new(arg));
    }
    bun_core::pretty!("<r>\n");
    Output::flush();
}

fn is_pruned_workspace(manager: &PackageManager, pkg_id: usize) -> bool {
    let pruned = &manager.summary.pruned_workspaces;
    // A registry package can share the name of a pruned workspace.
    !pruned.is_empty()
        && manager.lockfile.packages.items_resolution()[pkg_id].tag == ResolutionTag::Workspace
        && pruned.contains(&manager.lockfile.packages.items_name_hash()[pkg_id])
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
        let parsed = to_root.parse_with_json(
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
    manager.lockfile.linked_members = core::mem::take(&mut to_lockfile.linked_members);

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

/// A tree that `manager.lockfile` does not hold now: the one it saves, or the one an install wrote.
pub(crate) struct SavedTree {
    pub(crate) trees: tree::List,
    pub(crate) hoisted_dependencies: Vec<DependencyID>,
}

/// Replaces the tree in `manager.lockfile` with the one that an install of every workspace uses
/// (see `Lockfile::filter`), and returns the old tree. `all_rows` also keeps what this run skips.
fn hoist_install_tree(
    manager: &mut PackageManager,
    all_rows: bool,
) -> Result<SavedTree, tree::SubtreeError> {
    hoist_tree(manager, all_rows, true, &[], tree::Layout::Locked)
}

fn hoist_tree(
    manager: &mut PackageManager,
    all_rows: bool,
    install_root_dependencies: bool,
    workspace_filters: &[WorkspaceFilter],
    layout: tree::Layout,
) -> Result<SavedTree, tree::SubtreeError> {
    let saved = SavedTree {
        trees: core::mem::take(&mut manager.lockfile.buffers.trees),
        hoisted_dependencies: core::mem::take(&mut manager.lockfile.buffers.hoisted_dependencies),
    };
    let pm: *mut PackageManager = manager;
    // SAFETY: same split as `PackageManager::load_lockfile_from_cwd` — `lockfile` is its own `Box`
    // allocation and the Filter builder only reads `manager.options`/`subcommand`/`summary`.
    let result = unsafe {
        let lf: *mut Lockfile = &raw mut *(*pm).lockfile;
        let log: *mut bun_ast::Log = (*pm).log;
        let options = (!all_rows).then_some(&*pm);
        (*lf).hoist::<{ tree::BuilderMethod::Filter }>(
            &mut *log,
            options,
            install_root_dependencies,
            workspace_filters,
            None,
            layout,
        )
    };
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

/// Runs `f` while `manager.lockfile` holds the install tree with every row (see
/// `hoist_install_tree`), then puts the saved tree back.
pub fn with_install_tree<T>(
    manager: &mut PackageManager,
    f: impl FnOnce(&PackageManager) -> T,
) -> Result<T, crate::Error> {
    let saved = hoist_install_tree(manager, true)?;
    let result = f(manager);
    restore_tree(&mut manager.lockfile, saved);
    Ok(result)
}

/// Sorted. Only what this install places: the lockfile also has the dependency types it skips.
pub(crate) fn top_level_names(manager: &mut PackageManager) -> Option<Vec<Box<[u8]>>> {
    let saved = hoist_install_tree(manager, false).ok()?;
    let buffers = &manager.lockfile.buffers;
    let deps = buffers.dependencies.as_slice();
    let buf = buffers.string_bytes.as_slice();
    let mut names: Vec<Box<[u8]>> = (buffers.trees.first().into_iter())
        .flat_map(|root| {
            root.dependencies
                .get(buffers.hoisted_dependencies.as_slice())
        })
        .map(|&id| deps[id as usize].name.slice(buf).into())
        .collect();
    sort_names(&mut names);
    restore_tree(&mut manager.lockfile, saved);
    Some(names)
}

struct TreeFolder {
    path: Range<u32>,
    expected: Range<u32>,
}

const _: () = assert!(core::mem::size_of::<TreeFolder>() == 16);

/// A `node_modules` directory, named by the first tree that is that directory on disk.
#[derive(Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
struct FolderId(tree::Id);

#[derive(Clone, Copy)]
enum LookFrom<'a> {
    At(FolderId),
    Above(FolderId),
    /// Above the `node_modules` of the workspace in this folder, with or without a `FolderId`.
    AboveMember(&'a [u8]),
}

type Found<'f> = &'f mut dyn FnMut(Option<(FolderId, usize)>) -> bool;

struct HoistedTree<'a> {
    lockfile: &'a Lockfile,
    trees: &'a [tree::Tree],
    folders: Vec<TreeFolder>,
    /// The folder of each tree. Empty if every tree has a folder of its own.
    folder_of: Vec<FolderId>,
    /// `(folder, package)` for each workspace inside the project, sorted. Two can share a folder.
    workspaces: OnceCell<Vec<(&'a [u8], PackageID)>>,
    /// `(workspace folder, its node_modules)` for each workspace that has a tree, sorted.
    members: OnceCell<Vec<(&'a [u8], FolderId)>>,
    /// Set with `members`. A workspace has a tree below a link that is not the root's.
    linker_tree: Cell<bool>,
    /// `(folder, name, folder inside the package that the folder has under that name)`, sorted.
    nested: OnceCell<Vec<(FolderId, &'a [u8], FolderId)>>,
    /// `(workspace folder, folder with a row that links the workspace)`, sorted.
    links: OnceCell<Vec<(&'a [u8], FolderId)>>,
    /// The packages that `--filter` selects, sorted. Such a run only installs for them.
    selected: Option<Vec<PackageID>>,
    /// The tree that the install of this run wrote. Its tree ids are those of `trees`.
    wrote: Option<&'a SavedTree>,
    /// `(folder, tree that is that directory)` for each folder of two or more trees, sorted.
    shared: Vec<(FolderId, tree::Id)>,
    paths: Vec<u8>,
    expected: Vec<(&'a [u8], PackageID)>,
    /// Sorted indexes into `expected`. Two trees of one package place different packages there.
    contested: Vec<u32>,
    quiet: bool,
    kept_mismatched: Cell<bool>,
    kept_contested: Cell<bool>,
    /// The symlinked `node_modules` folders that made `removable` keep an entry.
    linked: RefCell<Vec<Box<[u8]>>>,
    checked: RefCell<DynamicBitSet>,
    matched: RefCell<DynamicBitSet>,
    missing: RefCell<DynamicBitSet>,
}

#[derive(Clone, Copy, PartialEq, Eq)]
enum Installed {
    Matches,
    Missing,
    Mismatch,
    /// See `HoistedTree::contested`.
    Contested,
    /// See `HoistedTree::linked`.
    Linked,
}

impl<'a> HoistedTree<'a> {
    /// With `quiet`, `removable` prints no warning when it keeps an entry.
    fn init(
        lockfile: &'a Lockfile,
        quiet: bool,
        mut selected: Option<Vec<PackageID>>,
        wrote: Option<&'a SavedTree>,
    ) -> HoistedTree<'a> {
        let trees = lockfile.buffers.trees.as_slice();
        let deps = lockfile.buffers.dependencies.as_slice();
        let resolutions = lockfile.buffers.resolutions.as_slice();
        let buf = lockfile.buffers.string_bytes.as_slice();

        let mut folders: Vec<TreeFolder> = Vec::with_capacity(trees.len());
        folders.resize_with(trees.len(), || TreeFolder {
            path: 0..0,
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

            scratch.clear();
            scratch.extend(folder.dependencies.iter().map(|&dep_id| {
                (
                    deps[dep_id as usize].name.slice(buf),
                    resolutions[dep_id as usize],
                )
            }));
            index_sort::sort_vec_unstable_by(&mut scratch, |a, b| a.cmp(b));
            let start = expected.len();
            for &item in &scratch {
                if expected.len() == start || expected[expected.len() - 1].0 != item.0 {
                    expected.push(item);
                }
            }

            folders[folder.tree_id as usize] = TreeFolder {
                path: path_start as u32..paths.len() as u32,
                expected: start as u32..expected.len() as u32,
            };
        }

        let mut folder_of: Vec<FolderId> = Vec::new();
        let mut shared: Vec<(FolderId, tree::Id)> = Vec::new();
        let mut contested: Vec<u32> = Vec::new();
        // Only the trees of workspaces, and the trees below them, can share a directory.
        let mut of_members = (trees.iter()).filter(|tree| tree_workspace(lockfile, tree).is_some());
        let keys = if of_members.nth(1).is_some() {
            directory_keys(lockfile)
        } else {
            Vec::new()
        };
        let mut by_key: Vec<tree::Id> = (0..keys.len() as tree::Id).collect();
        index_sort::sort_slice_unstable_by_key(&mut by_key, |&id| (keys[id as usize], id));
        let same_folder = |a: &tree::Id, b: &tree::Id| keys[*a as usize] == keys[*b as usize];
        if by_key.chunk_by(same_folder).any(|group| group.len() > 1) {
            folder_of.extend((0..trees.len() as tree::Id).map(FolderId));
            let mut rows: Vec<(&'a [u8], PackageID, PackageID)> = Vec::new();
            for group in by_key.chunk_by(same_folder) {
                let folder = group[0] as usize;
                for &id in group {
                    folder_of[id as usize] = FolderId(group[0]);
                }
                if group.len() > 1 {
                    shared.extend(group.iter().map(|&id| (FolderId(group[0]), id)));
                }
                let mut with_rows = (group.iter().map(|&id| id as usize))
                    .filter(|&id| !folders[id].path.is_empty());
                let Some(first) = with_rows.next() else {
                    continue;
                };
                let path = folders[first].path.clone();
                if with_rows.next().is_none() {
                    folders[folder] = TreeFolder {
                        path,
                        expected: folders[first].expected.clone(),
                    };
                    continue;
                }
                // A workspace's folder has one owner, whatever packages bun.lock lists it under.
                let of_member = tree_workspace(lockfile, &trees[folder]).is_some();
                rows.clear();
                for &id in group {
                    let owner = if of_member {
                        0
                    } else {
                        tree_owner(lockfile, id as usize)
                    };
                    let range = folders[id as usize].expected.clone();
                    let own = &expected[range.start as usize..range.end as usize];
                    rows.extend(own.iter().map(|&(alias, pkg_id)| (alias, pkg_id, owner)));
                    folders[id as usize] = TreeFolder {
                        path: 0..0,
                        expected: 0..0,
                    };
                }
                index_sort::sort_vec_unstable_by(&mut rows, |a, b| a.cmp(b));
                let start = expected.len();
                for named in rows.chunk_by(|a, b| a.0 == b.0) {
                    // Rows of two owners do not disagree: only one owner is installed.
                    let disagree = |a: &(&[u8], PackageID, PackageID)| {
                        named.iter().any(|b| a.2 == b.2 && a.1 != b.1)
                    };
                    if named.iter().any(disagree) {
                        contested.push(expected.len() as u32);
                    }
                    expected.push((named[0].0, named[0].1));
                }
                folders[folder] = TreeFolder {
                    path,
                    expected: start as u32..expected.len() as u32,
                };
            }
        }

        index_sort::sort_vec_unstable_by(&mut shared, |a, b| a.cmp(b));
        if let Some(selected) = &mut selected {
            index_sort::sort_slice_unstable(selected);
        }
        let checked = handle_oom(DynamicBitSet::init_empty(expected.len()));
        let matched = handle_oom(DynamicBitSet::init_empty(expected.len()));
        let missing = handle_oom(DynamicBitSet::init_empty(expected.len()));
        HoistedTree {
            lockfile,
            trees,
            folders,
            folder_of,
            workspaces: OnceCell::new(),
            members: OnceCell::new(),
            linker_tree: Cell::new(false),
            nested: OnceCell::new(),
            links: OnceCell::new(),
            selected,
            wrote: wrote.filter(|wrote| wrote.trees.len() == trees.len()),
            shared,
            paths,
            expected,
            contested,
            quiet,
            kept_mismatched: Cell::new(false),
            kept_contested: Cell::new(false),
            linked: RefCell::new(Vec::new()),
            checked: RefCell::new(checked),
            matched: RefCell::new(matched),
            missing: RefCell::new(missing),
        }
    }

    fn folder(&self, tree_id: tree::Id) -> FolderId {
        (self.folder_of.get(tree_id as usize).copied()).unwrap_or(FolderId(tree_id))
    }

    fn root(&self) -> Option<FolderId> {
        (!self.trees.is_empty()).then_some(FolderId(0))
    }

    /// Every folder that has rows, in tree order. A folder comes after the folder it is in.
    fn folders_with_rows(&self) -> impl Iterator<Item = FolderId> + '_ {
        (0..self.folders.len() as tree::Id)
            .map(FolderId)
            .filter(|&folder| self.folder(folder.0) == folder && !self.path(folder).is_empty())
    }

    /// The folder of the workspace whose own `node_modules` `folder` is.
    fn member_of(&self, folder: FolderId) -> Option<&'a [u8]> {
        tree_member_folder(self.lockfile, self.trees.get(folder.0 as usize)?)
    }

    fn workspaces(&self) -> &[(&'a [u8], PackageID)] {
        self.workspaces.get_or_init(|| {
            let lockfile = self.lockfile;
            let mut workspaces: Vec<(&'a [u8], PackageID)> = (0..lockfile.packages.len())
                .filter_map(|id| Some((member_folder(lockfile, id as PackageID)?, id as PackageID)))
                .collect();
            index_sort::sort_vec_unstable_by(&mut workspaces, |a, b| a.cmp(b));
            workspaces
        })
    }

    /// The packages that bun.lock lists the workspace in the folder `member` under.
    fn ids_at(&self, member: &[u8]) -> &[(&'a [u8], PackageID)] {
        let workspaces = self.workspaces();
        let start = workspaces.partition_point(|&(folder, _)| folder < member);
        let rest = &workspaces[start..];
        &rest[..rest.partition_point(|&(folder, _)| folder == member)]
    }

    /// Returns false if a `--filter` selects neither `pkg_id` nor another package with its folder.
    fn selects(&self, pkg_id: PackageID) -> bool {
        let Some(selected) = &self.selected else {
            return true;
        };
        let is_selected = |id: PackageID| selected.binary_search(&id).is_ok();
        is_selected(pkg_id)
            || member_folder(self.lockfile, pkg_id)
                .is_some_and(|member| self.ids_at(member).iter().any(|&(_, id)| is_selected(id)))
    }

    /// Returns false if the run has a `--filter` and does not install `folder`.
    fn installs(&self, mut folder: FolderId) -> bool {
        if self.selected.is_none() {
            return true;
        }
        while folder.0 != 0 {
            let tree = &self.trees[folder.0 as usize];
            if let Some(owner) = tree_workspace(self.lockfile, tree) {
                return self.selects(owner);
            }
            // Inside a package of the root, which the run installs if it selects the root.
            if tree.parent == 0 {
                return self.selects(0);
            }
            folder = self.folder(tree.parent);
        }
        true
    }

    fn members(&self) -> &[(&'a [u8], FolderId)] {
        self.members.get_or_init(|| {
            let mut members: Vec<(&'a [u8], FolderId)> = (self.trees.iter().enumerate())
                .filter_map(|(id, tree)| {
                    let member = tree_member_folder(self.lockfile, tree)?;
                    if tree.parent != 0 {
                        self.linker_tree.set(true);
                    }
                    Some((member, self.folder(id as tree::Id)))
                })
                .collect();
            index_sort::sort_vec_unstable_by(&mut members, |a, b| a.cmp(b));
            members.dedup();
            members
        })
    }

    /// The `node_modules` of the workspace in the folder `member`, if the workspace has a tree.
    fn member_folder(&self, member: &[u8]) -> Option<FolderId> {
        let members = self.members();
        let at = members.binary_search_by(|&(folder, _)| folder.cmp(member));
        at.ok().map(|i| members[i].1)
    }

    fn nested(&self) -> &[(FolderId, &'a [u8], FolderId)] {
        self.nested.get_or_init(|| {
            let lockfile = self.lockfile;
            let deps = lockfile.buffers.dependencies.as_slice();
            let buf = lockfile.buffers.string_bytes.as_slice();
            // A workspace's tree is in the workspace's folder, not inside a package.
            let mut nested: Vec<(FolderId, &'a [u8], FolderId)> = (self.trees.iter().enumerate())
                .skip(1)
                .filter(|(_, tree)| {
                    tree.dependencies.len > 0 && tree_workspace(lockfile, tree).is_none()
                })
                .map(|(id, tree)| {
                    let name = tree.folder_name(deps, buf);
                    (self.folder(tree.parent), name, self.folder(id as tree::Id))
                })
                .collect();
            index_sort::sort_vec_unstable_by(&mut nested, |a, b| a.cmp(b));
            nested.dedup();
            nested
        })
    }

    /// The folder inside the package that `folder` has under `name`, if that package has one.
    fn child(&self, folder: FolderId, name: &[u8]) -> Option<FolderId> {
        let nested = self.nested();
        let at = nested.partition_point(|&(parent, child, _)| (parent, child) < (folder, name));
        (nested.get(at))
            .filter(|&&(parent, child, _)| parent == folder && child == name)
            .map(|&(_, _, id)| id)
    }

    /// The folders that link the workspace in the folder `member`.
    fn links_to<'s>(&'s self, member: &'s [u8]) -> impl Iterator<Item = FolderId> + 's {
        let links = self.links.get_or_init(|| {
            let lockfile = self.lockfile;
            let rows = lockfile.buffers.hoisted_dependencies.as_slice();
            let resolutions = lockfile.buffers.resolutions.as_slice();
            let mut links: Vec<(&'a [u8], FolderId)> = Vec::new();
            for (id, tree) in self.trees.iter().enumerate() {
                // Nothing in a workspace outside the project is opened, so it keeps no entry.
                if is_outside_project(lockfile, id as tree::Id) {
                    continue;
                }
                for &row in tree.dependencies.get(rows) {
                    if let Some(linked) = member_folder(lockfile, resolutions[row as usize]) {
                        links.push((linked, self.folder(id as tree::Id)));
                    }
                }
            }
            index_sort::sort_vec_unstable_by(&mut links, |a, b| a.cmp(b));
            links.dedup();
            links
        });
        let start = links.partition_point(|&(linked, _)| linked < member);
        (links[start..].iter())
            .take_while(move |&&(linked, _)| linked == member)
            .map(|&(_, folder)| folder)
    }

    /// The trees that are the directory `folder`, if there are two or more.
    fn trees_of(&self, folder: FolderId) -> &[(FolderId, tree::Id)] {
        let start = self.shared.partition_point(|&(of, _)| of < folder);
        let rest = &self.shared[start..];
        &rest[..rest.partition_point(|&(of, _)| of == folder)]
    }

    fn has_row(&self, tree: &tree::Tree, rows: &[DependencyID], alias: &[u8]) -> bool {
        let deps = self.lockfile.buffers.dependencies.as_slice();
        let buf = self.lockfile.buffers.string_bytes.as_slice();
        (tree.dependencies.get(rows).iter()).any(|&row| deps[row as usize].name.slice(buf) == alias)
    }

    /// Returns true if each workspace from the tree up to the root is below the root's link.
    fn is_own(&self, mut tree_id: tree::Id) -> bool {
        while tree_id != 0 {
            let tree = &self.trees[tree_id as usize];
            if tree.parent != 0 && tree_workspace(self.lockfile, tree).is_some() {
                return false;
            }
            tree_id = tree.parent;
        }
        true
    }

    /// Returns true if the row for `alias` in `folder` is a row of a tree for which `is_own` holds.
    fn own_tree_places(&self, folder: FolderId, alias: &[u8]) -> bool {
        if self.lockfile.workspace_paths.len() == 0 {
            return true;
        }
        self.members();
        if !self.linker_tree.get() {
            return true;
        }
        let rows = self.lockfile.buffers.hoisted_dependencies.as_slice();
        match self.trees_of(folder) {
            [] => self.is_own(folder.0),
            trees => (trees.iter()).any(|&(_, id)| {
                self.is_own(id) && self.has_row(&self.trees[id as usize], rows, alias)
            }),
        }
    }

    /// Returns true if the run wrote a row for `alias` in a tree of `folder`.
    fn wrote_row(&self, folder: FolderId, alias: &[u8]) -> bool {
        let Some(wrote) = self.wrote else {
            return true;
        };
        let rows = wrote.hoisted_dependencies.as_slice();
        let has = |id: tree::Id| self.has_row(&wrote.trees[id as usize], rows, alias);
        match self.trees_of(folder) {
            [] => has(folder.0),
            trees => trees.iter().any(|&(_, id)| has(id)),
        }
    }

    /// A lookup stops at a row that the run wrote and, if `own`, at a row of an `is_own` tree.
    fn stops(&self, folder: FolderId, alias: &[u8], own: bool) -> bool {
        (own && self.own_tree_places(folder, alias)) || self.wrote_row(folder, alias)
    }

    fn path(&self, folder: FolderId) -> &[u8] {
        let range = &self.folders[folder.0 as usize].path;
        &self.paths[range.start as usize..range.end as usize]
    }

    fn expected(&self, folder: FolderId) -> &[(&'a [u8], PackageID)] {
        let range = &self.folders[folder.0 as usize].expected;
        &self.expected[range.start as usize..range.end as usize]
    }

    fn expected_in(&self, folder: FolderId, alias: &[u8]) -> Option<usize> {
        let range = self.folders.get(folder.0 as usize)?.expected.clone();
        let expected = &self.expected[range.start as usize..range.end as usize];
        expected
            .binary_search_by(|(name, _)| (*name).cmp(alias))
            .ok()
            .map(|i| range.start as usize + i)
    }

    fn is_contested(&self, row: usize) -> bool {
        self.contested.binary_search(&(row as u32)).is_ok()
    }

    /// No install settles which of the two packages `folder` has as `alias`, so its copies stay.
    fn warn_contested(&self, folder: FolderId, alias: &[u8], kept_below: Option<&[u8]>) {
        self.kept_contested.set(true);
        if self.quiet {
            return;
        }
        use bun_core::fmt::escape_control_chars;
        let place = join(self.path(folder), alias);
        match kept_below {
            Some(kept) => bun_core::warn!(
                "the lockfile places two packages at {}; keeping {}",
                escape_control_chars(&place),
                escape_control_chars(kept)
            ),
            None => bun_core::warn!(
                "the lockfile places two packages at {}; keeping it",
                escape_control_chars(&place)
            ),
        }
    }

    /// Says what to do about the entries that `removable` kept with a warning.
    fn print_notes(&self) {
        if self.quiet {
            return;
        }
        if self.kept_mismatched.get() {
            bun_core::note!("run 'bun install' first");
        }
        if self.kept_contested.get() {
            bun_core::note!(
                "a package.json has that name in two dependency groups with different versions"
            );
        }
    }

    fn open(&self, folder: FolderId, linked_folders: &mut Vec<Box<[u8]>>) -> Option<Dir> {
        open_tree_folder(self.lockfile, folder.0, linked_folders)
    }

    /// Calls `found` with the nearest row for `alias`, or `None`, on each way up. Stops on false.
    fn each_way_up(&self, from: LookFrom<'_>, alias: &[u8], found: Found<'_>) -> bool {
        // Workspaces can link each other, so the ways above a workspace are followed once.
        let mut passed: Vec<&[u8]> = Vec::new();
        match from {
            LookFrom::At(folder) => self.way_up(folder, alias, found, &mut passed, true),
            LookFrom::Above(folder) => self.way_above(folder, alias, found, &mut passed, true),
            LookFrom::AboveMember(member) => {
                self.ways_above_member(member, alias, found, &mut passed, true)
            }
        }
    }

    /// `own` is false on a way through a folder that links a workspace.
    fn way_up<'s>(
        &'s self,
        folder: FolderId,
        alias: &[u8],
        found: Found<'_>,
        passed: &mut Vec<&'s [u8]>,
        own: bool,
    ) -> bool {
        match self.expected_in(folder, alias) {
            Some(row) if self.stops(folder, alias, own) => found(Some((folder, row))),
            _ => self.way_above(folder, alias, found, passed, own),
        }
    }

    fn way_above<'s>(
        &'s self,
        folder: FolderId,
        alias: &[u8],
        found: Found<'_>,
        passed: &mut Vec<&'s [u8]>,
        own: bool,
    ) -> bool {
        if folder.0 == 0 {
            return found(None);
        }
        if let Some(member) = self.member_of(folder) {
            return self.ways_above_member(member, alias, found, passed, own);
        }
        let parent = self.folder(self.trees[folder.0 as usize].parent);
        self.way_up(parent, alias, found, passed, own)
    }

    /// The hoister places a workspace's packages once from each folder that links the workspace.
    fn ways_above_member<'s>(
        &'s self,
        member: &'s [u8],
        alias: &[u8],
        found: Found<'_>,
        passed: &mut Vec<&'s [u8]>,
        own: bool,
    ) -> bool {
        if passed.contains(&member) {
            return true;
        }
        passed.push(member);
        self.way_up(FolderId(0), alias, found, passed, own)
            && (self.links_to(member)).all(|folder| {
                !self.installs(folder) || self.way_up(folder, alias, found, passed, false)
            })
    }

    /// Returns true if, on each way up, the nearest folder with `alias` has that package installed.
    fn removable(&self, from: LookFrom<'_>, alias: &[u8], entry_folder: &[u8]) -> bool {
        self.each_way_up(from, alias, &mut |nearest| {
            let Some((folder, row)) = nearest else {
                return true;
            };
            let why = match self.verified_installed(folder, row) {
                Installed::Matches => return true,
                Installed::Contested => {
                    self.warn_contested(folder, alias, Some(&join(entry_folder, alias)));
                    return false;
                }
                // The caller refuses for `linked`, as it does for a folder it cannot prune.
                Installed::Linked => {
                    drop(self.open(folder, &mut self.linked.borrow_mut()));
                    return false;
                }
                Installed::Missing => "is missing",
                Installed::Mismatch => "is not the version bun.lock expects",
            };
            self.kept_mismatched.set(true);
            if !self.quiet {
                bun_core::warn!(
                    "{} {}; keeping {}",
                    bun_core::fmt::escape_control_chars(&join(self.path(folder), alias)),
                    why,
                    bun_core::fmt::escape_control_chars(&join(entry_folder, alias))
                );
            }
            false
        })
    }

    // Unlike `removable`, an alias that a way up does not install is left alone.
    fn collapsed_into_ancestor(&self, from: LookFrom<'_>, alias: &[u8]) -> bool {
        self.each_way_up(from, alias, &mut |nearest| {
            nearest.is_some_and(|(folder, row)| {
                self.verified_installed(folder, row) == Installed::Matches
            })
        })
    }

    /// A row that no `is_own` tree has and the run did not write keeps only a copy of its package.
    fn still_places(&self, folder: FolderId, alias: &[u8]) -> bool {
        let Some(row) = self.expected_in(folder, alias) else {
            return false;
        };
        self.own_tree_places(folder, alias)
            || self.wrote_row(folder, alias)
            || self.verified_installed(folder, row) != Installed::Mismatch
    }

    fn is_installed(&self, folder: FolderId, alias: &[u8]) -> bool {
        (self.expected_in(folder, alias))
            .is_some_and(|row| self.verified_installed(folder, row) == Installed::Matches)
    }

    /// Returns false if a package that contains `folder` isn't the version bun.lock expects there.
    fn owners_installed(&self, mut folder: FolderId) -> bool {
        let lockfile = self.lockfile;
        let deps = lockfile.buffers.dependencies.as_slice();
        let buf = lockfile.buffers.string_bytes.as_slice();
        while folder.0 != 0 && self.member_of(folder).is_none() {
            let tree = &self.trees[folder.0 as usize];
            let parent = self.folder(tree.parent);
            if !self.is_installed(parent, tree.folder_name(deps, buf)) {
                return false;
            }
            folder = parent;
        }
        true
    }

    fn verified_installed(&self, folder: FolderId, row: usize) -> Installed {
        if self.is_contested(row) {
            return Installed::Contested;
        }
        if self.checked.borrow().is_set(row) {
            return if self.matched.borrow().is_set(row) {
                Installed::Matches
            } else if self.missing.borrow().is_set(row) {
                Installed::Missing
            } else {
                Installed::Mismatch
            };
        }
        let (alias, pkg_id) = self.expected[row];
        let installed = self.installed(folder, alias, pkg_id);
        match installed {
            Installed::Matches => self.matched.borrow_mut().set(row),
            Installed::Missing => self.missing.borrow_mut().set(row),
            Installed::Mismatch | Installed::Contested => {}
            // Not kept: `removable` opens the folder again to name the link.
            Installed::Linked => return installed,
        }
        self.checked.borrow_mut().set(row);
        installed
    }

    fn installed(&self, folder: FolderId, alias: &[u8], pkg_id: PackageID) -> Installed {
        let buf = self.lockfile.buffers.string_bytes.as_slice();
        let Some(res) = self
            .lockfile
            .packages
            .items_resolution()
            .get(pkg_id as usize)
        else {
            return Installed::Mismatch;
        };
        let mut linked: Vec<Box<[u8]>> = Vec::new();
        let Some(folder) = self.open(folder, &mut linked) else {
            return if linked.is_empty() {
                Installed::Missing
            } else {
                Installed::Linked
            };
        };
        let kind = entry_kind_of(&folder, alias);
        if kind == EntryKind::Unknown {
            return Installed::Missing;
        }
        match res.tag {
            ResolutionTag::Symlink | ResolutionTag::Workspace => {
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
                let expected = res.npm().version.fmt(buf).to_string();
                name == expected_name
                    && without_build(&version) == without_build(expected.as_bytes())
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
}

/// The folder of the workspace `pkg_id`, if it is inside the project and is not the root.
fn member_folder(lockfile: &Lockfile, pkg_id: PackageID) -> Option<&[u8]> {
    let res = lockfile.packages.items_resolution().get(pkg_id as usize)?;
    if res.tag != ResolutionTag::Workspace {
        return None;
    }
    let buf = lockfile.buffers.string_bytes.as_slice();
    let path = strings::without_trailing_slash(res.workspace().slice(buf));
    (!path.is_empty() && !lockfile.is_member_outside(pkg_id)).then_some(path)
}

/// The workspace whose own `node_modules` `tree` is, whichever folder has the link to it.
fn tree_workspace(lockfile: &Lockfile, tree: &tree::Tree) -> Option<PackageID> {
    let resolutions = lockfile.buffers.resolutions.as_slice();
    let owner = *resolutions.get(tree.dependency_id as usize)?;
    let res = lockfile.packages.items_resolution().get(owner as usize)?;
    (res.tag == ResolutionTag::Workspace).then_some(owner)
}

fn tree_member_folder<'a>(lockfile: &'a Lockfile, tree: &tree::Tree) -> Option<&'a [u8]> {
    member_folder(lockfile, tree_workspace(lockfile, tree)?)
}

fn is_outside_project(lockfile: &Lockfile, mut tree_id: tree::Id) -> bool {
    let trees = lockfile.buffers.trees.as_slice();
    while tree_id != 0 && (tree_id as usize) < trees.len() {
        let tree = &trees[tree_id as usize];
        if let Some(owner) = tree_workspace(lockfile, tree) {
            return member_folder(lockfile, owner).is_none();
        }
        tree_id = tree.parent;
    }
    false
}

/// Returns a key for each tree. Two trees have the same key if they are one directory on disk.
fn directory_keys(lockfile: &Lockfile) -> Vec<u64> {
    // No tree has this key, so a workspace's path and a package of that name get different keys.
    const WORKSPACE_PATHS: u64 = u64::MAX;

    let trees = lockfile.buffers.trees.as_slice();
    let deps = lockfile.buffers.dependencies.as_slice();
    let buf = lockfile.buffers.string_bytes.as_slice();
    let pkg_res = lockfile.packages.items_resolution();
    let mut keys: Vec<u64> = Vec::with_capacity(trees.len());
    for tree in trees {
        let key = match tree_workspace(lockfile, tree) {
            Some(owner) => {
                let path = pkg_res[owner as usize].workspace().slice(buf);
                let path = strings::without_trailing_slash(path);
                let hash = bun_semver::semver_string::Builder::string_hash(path);
                tree::place_key(WORKSPACE_PATHS, hash)
            }
            // A tree always comes after its parent, so the parent's key is already in `keys`.
            None => match (
                keys.get(tree.parent as usize),
                deps.get(tree.dependency_id as usize),
            ) {
                (Some(&parent), Some(named)) => tree::place_key(parent, named.name_hash),
                _ => 0,
            },
        };
        keys.push(key);
    }
    keys
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

    if hoist_install_tree(manager, false).is_err() {
        manager.crash();
    }

    let quiet = manager.options.log_level == LogLevel::Silent;
    let lockfile: &Lockfile = &manager.lockfile;
    let pkg_res = lockfile.packages.items_resolution();
    let selected: Option<Vec<PackageID>> = selection.map(|sel| {
        (0..pkg_res.len())
            .filter(|&id| sel.selected.is_set(id))
            .map(|id| id as PackageID)
            .collect()
    });
    let hoisted = HoistedTree::init(lockfile, quiet, selected, None);
    let buf = lockfile.buffers.string_bytes.as_slice();
    let deps = lockfile.buffers.dependencies.as_slice();
    let trees = lockfile.buffers.trees.as_slice();

    let tree_importer: Vec<PackageID> = match selection {
        Some(_) => tree_importers(lockfile),
        None => Vec::new(),
    };

    // bun.lock doesn't always mark bundled dependencies, so also check the installed package.json.
    let declares_bundled_deps = |package: &Dir| {
        crate::initialize_store();
        crate::git_runner::bundles_dependencies(package)
    };
    // Packages that bundle dependencies and have their own folder, as (folder they are in, name).
    let mut bundling_packages: Vec<(FolderId, &[u8])> = Vec::new();
    // Those packages' folders, and every folder nested under them.
    let mut skipped_folders: Vec<FolderId> = Vec::new();

    let mut root_visited = false;
    for folder in hoisted.folders_with_rows() {
        let tree_idx = folder.0 as usize;
        let folder_path = hoisted.path(folder);
        // A workspace's folder isn't inside a package, whatever package has the workspace's name.
        if tree_idx != 0 && hoisted.member_of(folder).is_none() {
            let tree = &trees[tree_idx];
            let parent = hoisted.folder(tree.parent);
            if skipped_folders.contains(&parent)
                || bundling_packages.contains(&(parent, tree.folder_name(deps, buf)))
            {
                skipped_folders.push(folder);
                continue;
            }
        }
        let importer = tree_importer.get(tree_idx).copied().unwrap_or(0);
        if importer != 0 && !hoisted.selects(importer) {
            continue;
        }
        let protected: &[Box<[u8]>] = if importer == 0 { root_protected } else { &[] };
        let owner = tree_owner(lockfile, tree_idx);
        if owner != invalid_package_id && (owner as usize) < pkg_res.len() {
            root_visited |= owner == 0;
            let tag = pkg_res[owner as usize].tag;
            if tag != ResolutionTag::Root
                && tag != ResolutionTag::Workspace
                && has_bundled_deps(lockfile, owner)
            {
                continue;
            }
        }

        let expected = hoisted.expected(folder);

        let Some(dir) = hoisted.open(folder, &mut plan.linked_folders) else {
            continue;
        };

        for &(alias, pkg_id) in expected {
            if (pkg_id as usize) >= pkg_res.len()
                || !extracted(pkg_res[pkg_id as usize].tag)
                || has_bundled_deps(lockfile, pkg_id)
            {
                continue;
            }
            let Some(package) = descend(&dir, alias) else {
                continue;
            };
            if hoisted.child(folder, alias).is_some() {
                if declares_bundled_deps(&package) {
                    bundling_packages.push((folder, alias));
                }
                continue;
            }
            let Some(nested) = open_real_subdir(&package, b"node_modules") else {
                continue;
            };
            if declares_bundled_deps(&package) {
                continue;
            }
            let nested_path = join(&join(folder_path, alias), b"node_modules");
            scan_folder(
                nested,
                &nested_path,
                false,
                &|entry: &Entry| {
                    contains(protected, entry.alias)
                        || !hoisted.is_installed(folder, alias)
                        || !hoisted.owners_installed(folder)
                        || !hoisted.removable(LookFrom::At(folder), entry.alias, &nested_path)
                },
                plan,
            );
        }

        scan_folder(
            dir,
            folder_path,
            false,
            &|entry| {
                if let Some(row) = hoisted.expected_in(folder, entry.alias) {
                    if hoisted.is_contested(row) {
                        hoisted.warn_contested(folder, entry.alias, None);
                    }
                    return true;
                }
                // A nested `node_modules` can have a registry package with a workspace's name.
                (tree_idx == 0 && contains(workspace_names, entry.alias))
                    || contains(protected, entry.alias)
                    || !hoisted.owners_installed(folder)
                    || !hoisted.removable(LookFrom::Above(folder), entry.alias, folder_path)
            },
            plan,
        );
    }

    if !root_visited {
        if let Ok(dir) = Dir::open(b"node_modules") {
            scan_folder(dir, b"node_modules", false, &keep_workspaces, plan);
        }
    }
    for ids in hoisted.workspaces().chunk_by(|a, b| a.0 == b.0) {
        let member = ids[0].0;
        // The loop above is done with a workspace that has a tree with rows.
        if (hoisted.member_folder(member)).is_some_and(|folder| !hoisted.path(folder).is_empty())
            || !ids.iter().any(|&(_, id)| hoisted.selects(id))
            || (ids.iter()).any(|&(_, id)| is_pruned_workspace(&*manager, id as usize))
        {
            continue;
        }
        let folder_path = join(member, ROOT_DIR);
        if let Some(dir) = open_workspace_folder(&folder_path, &mut plan.linked_folders) {
            let above = LookFrom::AboveMember(member);
            scan_folder(
                dir,
                &folder_path,
                false,
                &|entry: &Entry| !hoisted.removable(above, entry.alias, &folder_path),
                plan,
            );
        }
    }

    plan.linked_folders.append(&mut hoisted.linked.borrow_mut());
    hoisted.print_notes();
}

fn tree_owner(lockfile: &Lockfile, tree_idx: usize) -> PackageID {
    match lockfile.buffers.trees.as_slice()[tree_idx].dependency_id {
        tree::ROOT_DEP_ID => 0,
        dep_id => lockfile.buffers.resolutions.as_slice()[dep_id as usize],
    }
}

fn is_member_tree(lockfile: &Lockfile, tree_idx: usize) -> bool {
    (lockfile.packages.items_resolution())
        .get(tree_owner(lockfile, tree_idx) as usize)
        .is_some_and(|res| res.tag == ResolutionTag::Workspace)
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

/// Removes the packages that `before` placed and that aren't in the install tree for any dependency
/// type or platform.
pub(crate) fn remove_collapsed_copies(
    manager: &mut PackageManager,
    before: &Lockfile,
    wrote: Option<&SavedTree>,
) {
    let Ok(saved) = hoist_install_tree(manager, true) else {
        return;
    };
    plan_and_remove_collapsed_copies(manager, before, wrote);
    restore_tree(&mut manager.lockfile, saved);
}

/// Returns `(folder in old, folder in new)` for each workspace with a tree that has another folder.
fn pair_moved_members<'o, 'n>(
    old: &HoistedTree<'o>,
    new: &HoistedTree<'n>,
) -> Vec<(&'o [u8], &'n [u8])> {
    let old_names = old.lockfile.packages.items_name_hash();
    let new_names = new.lockfile.packages.items_name_hash();
    // `old` also lists the workspaces that this run found, after the ones that bun.lock had.
    let in_lockfile = |id: PackageID| id < old.lockfile.loaded_package_count;
    let stat = |folder: &[u8]| {
        let path = zname(&join(folder, ROOT_DIR));
        sys::stat(ZStr::from_slice_with_nul(&path)).ok()
    };
    let mut stats: Option<Vec<(&'n [u8], sys::Stat)>> = None;
    let mut moved: Vec<(&'o [u8], &'n [u8])> = Vec::new();
    for &(folder, _) in old.members() {
        if !new.ids_at(folder).is_empty() {
            continue;
        }
        let names = old.ids_at(folder);
        let has_name = |id: PackageID| {
            (names.iter()).any(|&(_, was)| old_names[was as usize] == new_names[id as usize])
        };
        let is_free = |now: &[u8]| {
            !old.ids_at(now).iter().any(|&(_, id)| in_lockfile(id))
                && !moved.iter().any(|pair| pair.1 == now)
        };
        let by_name = (new.workspaces().iter())
            .find(|&&(now, id)| has_name(id) && is_free(now))
            .map(|&(now, _)| now);
        // Free or not: what is behind the old path is that workspace's folder now.
        let by_directory = || {
            let here = stat(folder)?;
            let stats = stats.get_or_insert_with(|| {
                (new.workspaces().iter())
                    .filter_map(|&(now, _)| Some((now, stat(now)?)))
                    .collect()
            });
            (stats.iter())
                .find(|(_, there)| there.st_dev == here.st_dev && there.st_ino == here.st_ino)
                .map(|&(now, _)| now)
        };
        if let Some(now) = by_name.or_else(by_directory) {
            moved.push((folder, now));
        }
    }
    moved
}

fn plan_and_remove_collapsed_copies(
    manager: &PackageManager,
    before: &Lockfile,
    wrote: Option<&SavedTree>,
) {
    let after: &Lockfile = &manager.lockfile;
    let workspace_names = collect_workspace_names(manager);
    if before.buffers.trees.is_empty() && workspace_names.is_empty() {
        return;
    }
    let quiet = manager.options.log_level == LogLevel::Silent;
    let targets = manager.filtered_link_targets.as_ref();
    let selected: Option<Vec<PackageID>> = targets.map(|targets| targets.package_ids(before));
    let importers = selected.as_ref().map(|_| tree_importers(before));
    let old = HoistedTree::init(before, true, None, None);
    let selected_after = targets.map(|targets| targets.package_ids(after));
    let new = HoistedTree::init(after, quiet, selected_after, wrote);

    let old_deps = before.buffers.dependencies.as_slice();
    let old_buf = before.buffers.string_bytes.as_slice();
    // Match workspaces by folder, because a workspace can be renamed.
    let moved = pair_moved_members(&old, &new);
    let member_now = |was: &[u8]| match new.ids_at(was).first() {
        Some(&(now, _)) => Some(now),
        None => (moved.iter().find(|pair| pair.0 == was)).map(|pair| pair.1),
    };
    // `before` can list a workspace twice, as it was and as it is. The one with the trees counts.
    let folder_before = |now: &[u8]| {
        old.member_folder(now).or_else(|| {
            let was = moved.iter().find(|pair| pair.1 == now)?.0;
            old.member_folder(was)
        })
    };
    // For each tree of `old`, the folder of `new` that is the same directory, if `new` has it.
    let mut now: Vec<Option<FolderId>> = Vec::with_capacity(old.trees.len());
    for (id, tree) in old.trees.iter().enumerate() {
        let folder = old.folder(id as tree::Id);
        now.push(if folder.0 as usize != id {
            now[folder.0 as usize]
        } else if id == 0 {
            new.root()
        } else if let Some(member) = old.member_of(folder) {
            member_now(member).and_then(|member| new.member_folder(member))
        } else {
            let parent = now[old.folder(tree.parent).0 as usize];
            parent.and_then(|parent| new.child(parent, tree.folder_name(old_deps, old_buf)))
        });
    }

    let mut plan = Plan::default();
    for old_folder in old.folders_with_rows() {
        let old_idx = old_folder.0 as usize;
        let old_path = old.path(old_folder);
        let old_tree = &old.trees[old_idx];
        // The loop below handles each workspace's own `node_modules`.
        if match old.member_of(old_folder) {
            Some(member) => member_now(member).is_some(),
            // A workspace outside the project. Nothing is removed there.
            None => is_member_tree(before, old_idx),
        } {
            continue;
        }
        if let (Some(selected), Some(importers)) = (&selected, &importers) {
            if selected.binary_search(&importers[old_idx]).is_err() {
                continue;
            }
        }
        let old_expected = old.expected(old_folder);
        let surviving = now[old_idx];
        // A workspace's name is only kept in the root `node_modules`. In a nested one, a package
        // from the registry can have the same name.
        let still_placed = |alias: &[u8]| {
            surviving.is_some_and(|folder| new.still_places(folder, alias))
                || (old_idx == 0 && contains(&workspace_names, alias))
        };
        if old_expected.iter().all(|&(alias, _)| still_placed(alias)) {
            continue;
        }
        let resolve_from = match surviving {
            Some(folder) => LookFrom::Above(folder),
            // The root has no dependencies left, so `new` has no tree for it.
            None if old_idx == 0 => LookFrom::Above(FolderId(0)),
            None => match now[old.folder(old_tree.parent).0 as usize] {
                Some(parent) => LookFrom::At(parent),
                None => continue,
            },
        };
        let owner: Option<PackageID> = match (surviving, resolve_from) {
            (Some(folder), _) => Some(tree_owner(after, folder.0 as usize)),
            // `new` leaves out bundled dependencies, so a folder with nothing else has no tree.
            (None, LookFrom::At(parent)) => new
                .expected_in(parent, old_tree.folder_name(old_deps, old_buf))
                .map(|row| new.expected[row].1),
            (None, _) => Some(0),
        };
        // If the owning package changed, the install replaced its folder, including what `before`
        // placed inside it. Whatever is in there now came with the new tarball.
        let old_owner = tree_owner(before, old_idx) as usize;
        if old_idx != 0
            && old_owner < before.packages.len()
            && owner.is_some_and(|owner| {
                let owner = owner as usize;
                before.packages.items_name_hash()[old_owner]
                    != after.packages.items_name_hash()[owner]
                    || !before.packages.items_resolution()[old_owner].eql(
                        &after.packages.items_resolution()[owner],
                        old_buf,
                        after.buffers.string_bytes.as_slice(),
                    )
            })
        {
            continue;
        }
        // A tarball ships folders at any depth below the package that bundles.
        let mut ships = owner.is_some_and(|owner| has_bundled_deps(after, owner));
        let new_ancestor = match resolve_from {
            LookFrom::At(folder) => folder.0,
            LookFrom::Above(folder) => (new.trees.get(folder.0 as usize)).map_or(0, |t| t.parent),
            LookFrom::AboveMember(_) => 0,
        };
        let chains = [
            (after, new.trees, new_ancestor as usize),
            (before, old.trees, old_idx),
        ];
        for (lockfile, trees, mut ancestor) in chains {
            while !ships && ancestor != 0 && ancestor < trees.len() {
                ships = has_bundled_deps(lockfile, tree_owner(lockfile, ancestor));
                ancestor = trees[ancestor].parent as usize;
            }
        }
        if ships {
            continue;
        }
        let links = plan.linked_folders.len();
        // A workspace that has another folder now took the folders below it along.
        let at = tree_location(before, old_folder.0).map(|mut at| {
            at.member = at.member.map(|was| member_now(was).unwrap_or(was));
            at
        });
        let Some(dir) = at.and_then(|at| open_location(at, &mut plan.linked_folders)) else {
            plan.left_linked_folder |= plan.linked_folders.len() > links;
            continue;
        };
        let folder_idx = plan.push_folder(old_path, FolderKind::NodeModules);
        for &(alias, _) in old_expected {
            if still_placed(alias) {
                continue;
            }
            let scoped = match strings::split_once_char(alias, b'/') {
                Some((scope, name)) if alias.first() == Some(&b'@') => {
                    let Some(scope_dir) = open_real_subdir(&dir, scope) else {
                        continue;
                    };
                    let scope_path = join(old_path, scope);
                    let scope_idx =
                        plan.push_folder(&scope_path, FolderKind::Scope { parent: folder_idx });
                    Some((scope_dir, scope_idx, name))
                }
                _ => None,
            };
            let (parent_dir, target_idx, name) = match &scoped {
                Some((scope_dir, scope_idx, name)) => (scope_dir, *scope_idx, *name),
                None => (&dir, folder_idx, alias),
            };
            let kind = lstat_kind(parent_dir, name);
            if kind != EntryKind::Directory && kind != EntryKind::SymLink {
                continue;
            }
            plan.checked += 1;
            if new.removable(resolve_from, alias, old_path) {
                plan.remove(target_idx, name, kind);
            }
            if let Some((scope_dir, scope_idx, _)) = scoped {
                plan.retain(scope_idx, scope_dir);
            }
        }
        plan.retain(folder_idx, dir);
    }

    // No bun.lock records whether Bun installed the other entries in a workspace's `node_modules`.
    let removes_other_entries = matches!(
        manager.subcommand,
        crate::Subcommand::Dedupe | crate::Subcommand::Audit | crate::Subcommand::Update
    );
    let self_contained = after.self_contained_workspace_ids();
    for ids in new.workspaces().chunk_by(|a, b| a.0 == b.0) {
        let member = ids[0].0;
        if (ids.iter()).any(|&(_, id)| is_pruned_workspace(manager, id as usize))
            || !ids.iter().any(|&(_, id)| new.selects(id))
            || ids.iter().any(|&(_, id)| has_bundled_deps(after, id))
        {
            continue;
        }
        let folder_path = join(member, ROOT_DIR);
        // Every tree of the workspace is this folder, whichever folder has the link to it.
        let old_rows: &[(&[u8], PackageID)] = match folder_before(member) {
            Some(folder) => old.expected(folder),
            None => &[],
        };
        let surviving = new.member_folder(member);
        let still_placed =
            |alias: &[u8]| surviving.is_some_and(|folder| new.still_places(folder, alias));
        let all_stay = old_rows.iter().all(|&(alias, _)| still_placed(alias));
        // The tree saved in bun.lock has no hoisting barriers. So `old` has most dependencies of a
        // self-contained workspace at the root, but they were installed in its own `node_modules`.
        let reached: Option<DynamicBitSet> = (ids.iter())
            .find(|&&(_, id)| self_contained.contains(&id))
            .and_then(|&(_, id)| {
                let name_hash = after.packages.items_name_hash()[id as usize];
                (before.packages.items_name_hash().iter())
                    .zip(before.packages.items_resolution())
                    .position(|(&hash, res)| {
                        hash == name_hash && res.tag == ResolutionTag::Workspace
                    })
            })
            .map(|id| {
                // `before` already has the dependencies of the workspace's new package.json, so the
                // ones that were dropped from it are added here.
                let mut roots: Vec<PackageID> = vec![id as PackageID];
                roots.extend(
                    (manager.summary.dropped_rows.iter())
                        .filter(|row| row.owner as usize == id)
                        .map(|row| row.package),
                );
                let options = reachable::Options::all(id as PackageID);
                let resolutions = before.buffers.resolutions.as_slice();
                reachable::packages_from(before, resolutions, &roots, true, options)
            });
        if !removes_other_entries && all_stay && reached.is_none() {
            continue;
        }
        let links = plan.linked_folders.len();
        let Some(dir) = open_workspace_folder(&folder_path, &mut plan.linked_folders) else {
            plan.left_linked_folder |= !all_stay && plan.linked_folders.len() > links;
            continue;
        };
        let above = LookFrom::AboveMember(member);
        scan_folder(
            dir,
            &folder_path,
            false,
            &|entry: &Entry| {
                if still_placed(entry.alias) {
                    return true;
                }
                let was_row = old_rows
                    .binary_search_by(|(name, _)| (*name).cmp(entry.alias))
                    .is_ok()
                    || reached.as_ref().is_some_and(|reached| {
                        old.expected_in(FolderId(0), entry.alias)
                            .is_some_and(|row| {
                                let id = old.expected[row].1 as usize;
                                reached.is_set_allow_out_of_bound(id, false)
                            })
                    });
                if was_row {
                    !new.removable(above, entry.alias, &folder_path)
                } else {
                    // Other package managers link sibling workspaces into this folder, so an entry
                    // with the name of a workspace is kept.
                    !removes_other_entries
                        || contains(&workspace_names, entry.alias)
                        || !new.collapsed_into_ancestor(above, entry.alias)
                }
            },
            &mut plan,
        );
    }

    // A lookup needed a folder that is behind a symlinked `node_modules`, and kept an entry.
    let mut linked = new.linked.borrow_mut();
    plan.left_linked_folder |= !linked.is_empty();
    plan.linked_folders.append(&mut linked);
    drop(linked);
    remove_planned(plan, Layout::Hoisted, manager);
}

/// When a run skipped dependencies, Bun 1.4.3 and earlier installed nested copies in folders that
/// have no key in bun.lock. This removes them, because they hide the package further up the tree.
/// Keeps any folder that may have come from the owning package's tarball.
pub(crate) fn remove_copies_of_the_older_layout(
    manager: &mut PackageManager,
    install_root_dependencies: bool,
    workspace_filters: &[WorkspaceFilter],
    mut places: Vec<(u64, PackageID)>,
) {
    let Ok(cache) = crate::package_manager::directories::try_get_cache_directory(manager) else {
        return;
    };
    places.sort_unstable_by_key(|&(key, _)| key);
    // Hoisting can change what a peer resolves to, so the resolutions are restored afterwards.
    let resolutions = manager.lockfile.buffers.resolutions.clone();
    if let Ok(saved) = hoist_tree(
        manager,
        false,
        install_root_dependencies,
        workspace_filters,
        tree::Layout::Older,
    ) {
        remove_from_older_places(manager, &places, cache);
        restore_tree(&mut manager.lockfile, saved);
    }
    manager.lockfile.buffers.resolutions = resolutions;
}

/// Returns true if `node_modules/<alias>` may have shipped inside the package's own tarball, so it
/// must not be deleted. The caller handles bundled dependencies.
fn tarball_may_contain(
    manager: &PackageManager,
    cache: sys::Fd,
    pkg_id: PackageID,
    alias: &[u8],
) -> bool {
    let lockfile: &Lockfile = &manager.lockfile;
    let res = &lockfile.packages.items_resolution()[pkg_id as usize];
    let entry: Box<[u8]> = match res.tag {
        // Apart from bundled dependencies, Bun doesn't install the `node_modules` folder of a
        // workspace, a `file:` folder or a git checkout.
        ResolutionTag::Workspace | ResolutionTag::Folder | ResolutionTag::Git => return false,
        ResolutionTag::Npm => {
            let name = lockfile.packages.items_name()[pkg_id as usize];
            crate::package_manager::cached_npm_package_folder_name(
                manager,
                name.slice(&lockfile.buffers.string_bytes),
                res.npm().version,
                None,
            )
        }
        ResolutionTag::Github => {
            crate::package_manager::cached_github_folder_name(manager, res.github(), None)
        }
        // A tarball dependency can contain anything.
        _ => return true,
    }
    .as_bytes()
    .into();
    // An installed package is never downloaded again, so a missing cache entry won't come back.
    // Treat it as not having the folder.
    let folder = zname(&join(&join(&entry, b"node_modules"), alias));
    sys::directory_exists_at(cache, ZStr::from_slice_with_nul(&folder)).unwrap_or(true)
}

/// Where an install writes a tree. Unlike the path from `tree::Iterator`, it passes no link.
struct TreeLocation<'a> {
    /// The folder of the workspace whose `node_modules` the tree is in. `None` for the root's.
    member: Option<&'a [u8]>,
    /// The packages from that `node_modules` down to the tree's own.
    below: Vec<&'a [u8]>,
}

/// Returns `None` for a tree in a workspace outside the project.
fn tree_location(lockfile: &Lockfile, mut tree_id: tree::Id) -> Option<TreeLocation<'_>> {
    let trees = lockfile.buffers.trees.as_slice();
    let deps = lockfile.buffers.dependencies.as_slice();
    let buf = lockfile.buffers.string_bytes.as_slice();
    let mut below: Vec<&[u8]> = Vec::new();
    let mut member = None;
    while tree_id != 0 && (tree_id as usize) < trees.len() {
        let tree = &trees[tree_id as usize];
        if let Some(owner) = tree_workspace(lockfile, tree) {
            member = Some(member_folder(lockfile, owner)?);
            break;
        }
        below.push(tree.folder_name(deps, buf));
        tree_id = tree.parent;
    }
    below.reverse();
    Some(TreeLocation { member, below })
}

/// The path of a tree's `node_modules`, relative to the project root.
fn tree_path(lockfile: &Lockfile, tree_id: tree::Id) -> Option<Box<[u8]>> {
    let TreeLocation { member, below } = tree_location(lockfile, tree_id)?;
    let mut path = match member {
        Some(folder) => join(folder, ROOT_DIR).into_vec(),
        None => ROOT_DIR.to_vec(),
    };
    for name in below {
        path.push(SEP);
        path.extend_from_slice(name);
        path.push(SEP);
        path.extend_from_slice(ROOT_DIR);
    }
    Some(path.into_boxed_slice())
}

/// `manager.lockfile` must hold the tree of the older layout. `places` is the
/// `tree::Builder::places` of the current layout, sorted by key.
fn remove_from_older_places(manager: &PackageManager, places: &[(u64, PackageID)], cache: sys::Fd) {
    let lockfile: &Lockfile = &manager.lockfile;
    let trees = lockfile.buffers.trees.as_slice();
    let rows = lockfile.buffers.hoisted_dependencies.as_slice();
    let deps = lockfile.buffers.dependencies.as_slice();
    let folders = tree::folder_keys(trees, deps);
    let today = |place: u64| {
        let found = places.binary_search_by_key(&place, |&(key, _)| key);
        found.ok().map(|i| places[i].1)
    };
    let mut plan = Plan::default();
    for (id, older) in trees.iter().enumerate().skip(1) {
        let only_older: Vec<u64> = (older.dependencies.get(rows).iter())
            .map(|&row| deps[row as usize].name_hash)
            .filter(|&name_hash| today(tree::place_key(folders[id], name_hash)).is_none())
            .collect();
        if only_older.is_empty() {
            continue;
        }
        // If the current layout has another package or nothing where this tree's owner is, the
        // owner is a leftover too. Only other leftovers load it, so its dependencies stay.
        let owner = tree_owner(lockfile, id);
        if !is_member_tree(lockfile, id) && today(folders[id]) != Some(owner) {
            continue;
        }
        // A package with bundled dependencies can ship folders at any depth, so skip every tree
        // inside one.
        let mut above = id;
        while above != 0 && !has_bundled_deps(lockfile, tree_owner(lockfile, above)) {
            above = trees[above].parent as usize;
        }
        if above != 0 {
            continue;
        }
        let Some(path) = tree_path(lockfile, older.id) else {
            continue;
        };
        let Some(dir) = open_tree_folder(lockfile, older.id, &mut plan.linked_folders) else {
            continue;
        };
        scan_folder(
            dir,
            &path,
            false,
            &|entry: &Entry| {
                let name_hash = bun_semver::semver_string::Builder::string_hash(entry.alias);
                entry.kind != EntryKind::Directory
                    || !only_older.contains(&name_hash)
                    || tarball_may_contain(manager, cache, owner, entry.alias)
            },
            &mut plan,
        );
    }
    remove_planned(plan, Layout::Hoisted, manager);
}

fn remove_planned(mut plan: Plan, layout: Layout, manager: &PackageManager) {
    if !plan.linked_folders.is_empty() {
        if (!plan.removals.is_empty() || plan.left_linked_folder)
            && manager.options.log_level != LogLevel::Silent
        {
            for folder in plan.sorted_linked_folders() {
                bun_core::warn!("cannot prune symlink {}", native_path(folder));
            }
            bun_core::note!("remove the link and run 'bun install', then 'bun prune'");
        }
        return;
    }
    execute(&plan, true);
    housekeeping(&plan, layout, manager);
}

/// Returns true if the symlink `entry` points to where the isolated linker links the package
/// `pkg_id`.
fn links_package(
    manager: &PackageManager,
    lockfile: &Lockfile,
    pkg_id: PackageID,
    entry: &Entry,
) -> bool {
    let Some(res) = lockfile.packages.items_resolution().get(pkg_id as usize) else {
        return false;
    };
    let buf = lockfile.buffers.string_bytes.as_slice();
    let target: Box<[u8]> = match res.tag {
        ResolutionTag::Root => b".".as_slice().into(),
        ResolutionTag::Workspace => res.workspace().slice(buf).into(),
        ResolutionTag::Symlink => match res.symlink().slice(buf) {
            path if crate::dependency::is_link_path(path) => path.into(),
            name => join(&manager.global_link_dir_path, name),
        },
        _ => {
            let Some(found) = store_link_target(entry.dir, entry.name) else {
                return false;
            };
            let name = lockfile.packages.items_name()[pkg_id as usize];
            let key = store_entry::fmt_store_key(name, res, buf).to_string();
            // An entry's name can end in `+<hash>`, for its peers or for a tarball's integrity.
            if &*found != key.as_bytes() && without_build(&found) != key.as_bytes() {
                return false;
            }
            join(
                &join(&join(STORE_DIR, &found), b"node_modules"),
                name.slice(buf),
            )
        }
    };
    let stat = |dir: &Dir, path: &[u8]| {
        sys::fstatat(dir.fd(), ZStr::from_slice_with_nul(&zname(path))).ok()
    };
    let (Some(link), Some(target)) = (stat(entry.dir, entry.name), stat(&Dir::cwd(), &target))
    else {
        return false;
    };
    link.st_ino == target.st_ino && link.st_dev == target.st_dev
}

/// The isolated linker only visits the names in the new lockfile, so this removes the symlink of
/// each dependency that was dropped from a `package.json` or from `packageExtensions`.
pub(crate) fn unlink_dropped_dependencies(manager: &mut PackageManager, before: &Lockfile) {
    if manager.summary.remove == 0 && manager.summary.removed_extension_rows.is_empty() {
        return;
    }
    let old_resolutions = before.packages.items_resolution();
    // Sets `global_link_dir_path`, the folder that a `link:<name>` dependency points into.
    if manager.summary.dropped_rows.iter().any(|row| {
        (old_resolutions.get(row.package as usize))
            .is_some_and(|res| res.tag == ResolutionTag::Symlink)
    }) {
        let _ = crate::package_manager_real::directories::try_global_link_dir(manager);
    }
    let manager: &PackageManager = manager;
    let dropped = &manager.summary.dropped_rows;
    let removed_rows = &manager.summary.removed_extension_rows;
    let after: &Lockfile = &manager.lockfile;
    let deps = after.buffers.dependencies.as_slice();
    let pkg_rows = after.packages.items_dependencies();
    let old_buf = before.buffers.string_bytes.as_slice();
    let mut plan = Plan::default();
    // The root `node_modules` is checked even if only workspaces dropped a dependency, because the
    // store is inside it.
    drop(open_workspace_folder(ROOT_DIR, &mut plan.linked_folders));
    for (i, &DroppedRow { owner, .. }) in dropped.iter().enumerate() {
        if dropped[..i].iter().any(|row| row.owner == owner) {
            continue;
        }
        let folder_path = workspace_node_modules(before, owner).unwrap_or_else(|| ROOT_DIR.into());
        let Some(dir) = open_workspace_folder(&folder_path, &mut plan.linked_folders) else {
            continue;
        };
        scan_folder(
            dir,
            &folder_path,
            false,
            &|entry: &Entry| {
                let hash = bun_semver::semver_string::Builder::string_hash(entry.alias);
                entry.kind != EntryKind::SymLink
                    || (public_hoist_matches(manager, entry.alias)
                        && deps.iter().any(|dep| dep.name_hash == hash))
                    || !dropped.iter().any(|row| {
                        row.owner == owner
                            && row.name.slice(old_buf) == entry.alias
                            && links_package(manager, before, row.package, entry)
                    })
            },
            &mut plan,
        );
    }
    if let Some(store_dir) = open_workspace_folder(STORE_DIR, &mut plan.linked_folders) {
        // Every package in the store can load what is linked in this folder. A link whose name is
        // not the name of any dependency in the lockfile is stale.
        if let Some(hidden) = open_real_subdir(&store_dir, b"node_modules") {
            let mut names: Vec<_> = deps.iter().map(|dep| dep.name_hash).collect();
            names.sort_unstable();
            scan_folder(
                hidden,
                &join(STORE_DIR, b"node_modules"),
                false,
                &|entry: &Entry| {
                    let hash = bun_semver::semver_string::Builder::string_hash(entry.alias);
                    entry.kind != EntryKind::SymLink || names.binary_search(&hash).is_ok()
                },
                &mut plan,
            );
        }
        if !removed_rows.is_empty() {
            let store = handle_oom(build_whole_store(manager, after));
            let node_pkg_ids = store.nodes.items_pkg_id();
            let mut name: Vec<u8> = Vec::new();
            for (entry_idx, node_id) in store.entries.items_node_id().iter().enumerate() {
                let pkg_id = node_pkg_ids[node_id.get() as usize];
                if after.packages.items_resolution()[pkg_id as usize].tag != ResolutionTag::Npm {
                    continue;
                }
                let package = after.package_extension_key(pkg_id);
                if !removed_rows.iter().any(|row| row.0 == package) {
                    continue;
                }
                let entry_id = store_entry::Id::from(entry_idx as u32);
                name.clear();
                write!(
                    name,
                    "{}",
                    store_entry::fmt_store_path(entry_id, &store, after)
                )
                .expect("Vec<u8> write is infallible");
                // Skip entries that are symlinks into the global store. In the global store, a
                // package with different dependencies gets a different entry.
                let Some(dir) = open_real_subdir(&store_dir, &name)
                    .and_then(|entry| open_real_subdir(&entry, b"node_modules"))
                else {
                    continue;
                };
                let folder_path = join(&join(STORE_DIR, &name), b"node_modules");
                let rows = pkg_rows[pkg_id as usize].get(deps);
                scan_folder(
                    dir,
                    &folder_path,
                    false,
                    &|entry: &Entry| {
                        let hash = bun_semver::semver_string::Builder::string_hash(entry.alias);
                        entry.kind != EntryKind::SymLink
                            || !removed_rows.contains(&(package, hash))
                            || rows.iter().any(|dep| dep.name_hash == hash)
                    },
                    &mut plan,
                );
            }
        }
    }
    remove_planned(plan, Layout::Isolated, manager);
}

fn open_tree_folder(
    lockfile: &Lockfile,
    tree_id: tree::Id,
    linked_folders: &mut Vec<Box<[u8]>>,
) -> Option<Dir> {
    open_location(tree_location(lockfile, tree_id)?, linked_folders)
}

fn open_location(
    TreeLocation { member, below }: TreeLocation<'_>,
    linked_folders: &mut Vec<Box<[u8]>>,
) -> Option<Dir> {
    let mut dir = match member {
        None => open_workspace_folder(ROOT_DIR, linked_folders)?,
        Some(folder) => {
            // Nothing is removed below a workspace while the root's `node_modules` is a link.
            if LinkedNodeModules::is_at(bun_paths::path_literal!("node_modules")) == Some(true) {
                linked_folders.push(ROOT_DIR.into());
                return None;
            }
            open_workspace_folder(&join(folder, ROOT_DIR), linked_folders)?
        }
    };
    for name in below {
        let package = descend(&dir, name)?;
        dir = open_real_subdir(&package, b"node_modules")?;
    }
    Some(dir)
}

fn workspace_node_modules(lockfile: &Lockfile, pkg_id: PackageID) -> Option<Box<[u8]>> {
    Some(join(member_folder(lockfile, pkg_id)?, ROOT_DIR))
}

/// Anything that removes entries from the store or from a `node_modules` must open the folder with
/// this function. It never follows a symlink, and adds it to `linked_folders` instead.
fn open_workspace_folder(folder: &[u8], linked_folders: &mut Vec<Box<[u8]>>) -> Option<Dir> {
    let st = sys::lstat(ZStr::from_slice_with_nul(&zname(folder))).ok()?;
    match sys::kind_from_mode(st.st_mode as sys::Mode) {
        EntryKind::Directory => Dir::cwd()
            .open_at_with(folder, O::RDONLY | O::CLOEXEC | O::NOFOLLOW)
            .ok(),
        EntryKind::SymLink => {
            linked_folders.push(folder.into());
            None
        }
        _ => None,
    }
}

/// A `node_modules` of the project or of a workspace that is itself a symlink. The linkers install
/// through it but never clear the folder behind it, which may hold things that Bun did not create.
///
/// A workspace's `node_modules` is only checked right before something is written to or removed
/// from it.
pub(crate) struct LinkedNodeModules {
    abs_path: Box<[u8]>,
    /// Empty if the symlink is dangling, and always empty on Windows.
    real_path: Box<[u8]>,
}

impl LinkedNodeModules {
    /// Returns whether `node_modules` is a symlink, or `None` if nothing exists at that path.
    pub(crate) fn is_at(node_modules: &ZStr) -> Option<bool> {
        let st = sys::lstat(node_modules).ok()?;
        Some(sys::kind_from_mode(st.st_mode as sys::Mode) == EntryKind::SymLink)
    }

    /// `node_modules` must be an absolute path.
    pub(crate) fn at(node_modules: &ZStr) -> Option<LinkedNodeModules> {
        if Self::is_at(node_modules) != Some(true) {
            return None;
        }
        Some(LinkedNodeModules {
            real_path: if cfg!(windows) {
                Box::default()
            } else {
                LinkedMembers::real_path_of(node_modules.as_bytes())
            },
            abs_path: node_modules.as_bytes().into(),
        })
    }

    /// Returns true if the absolute `path` is at or inside this `node_modules`, and then rewrites
    /// it to start with the real target, which is where a relative symlink is resolved from.
    ///
    /// On Windows `path` is not rewritten, because a relative link resolves differently behind a
    /// junction than behind a symlink. A link out of this `node_modules` gets an absolute target.
    pub(crate) fn resolve<const KIND: u8, const SEP: u8>(
        &self,
        path: &mut bun_paths::Path<u8, KIND, SEP>,
    ) -> bool {
        let below = match path.slice().strip_prefix(&*self.abs_path) {
            Some([]) => Vec::new(),
            Some([sep, below @ ..]) if bun_paths::is_sep_any(*sep) => below.to_vec(),
            _ => return false,
        };
        if !self.real_path.is_empty() {
            *path = bun_paths::Path::from(&*self.real_path).assume_ok();
            path.append(&below).assume_ok();
        }
        true
    }

    /// `folders` are the symlinked `node_modules` folders, relative to the project root, that a
    /// switch to the other linker would have cleared if they were real directories.
    pub(crate) fn warn_not_cleared(log_level: LogLevel, folders: &[Box<[u8]>]) {
        if log_level == LogLevel::Silent || folders.is_empty() {
            return;
        }
        for folder in folders {
            bun_core::warn!(
                "cannot clear symlink {}, packages from another linker remain",
                native_path(folder)
            );
        }
        bun_core::note!("remove the link and run 'bun install'");
    }
}

pub(crate) fn descend(dir: &Dir, alias: &[u8]) -> Option<Dir> {
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

pub(crate) fn entry_kind(dir: &Dir, name: &[u8], kind: EntryKind) -> EntryKind {
    if kind != EntryKind::Unknown {
        return kind;
    }
    lstat_kind(dir, name)
}

fn read_entries(dir: &Dir) -> Vec<(Box<[u8]>, EntryKind)> {
    read_entries_and_leftovers(dir, false)
}

/// Returns true if `name` is a temporary name that an interrupted install can leave behind: a
/// `StagingPath`, an `OldModules`, or something that `move_aside` renamed.
pub(crate) fn is_leftover(name: &[u8]) -> bool {
    name.starts_with(StagingPath::PREFIX.as_bytes())
        || name.starts_with(OldModules::PREFIX.as_bytes())
        || name.starts_with(crate::package_install::MOVED_ASIDE_PREFIX.as_bytes())
}

/// Skips names that start with a dot. `leftovers` keeps the ones that `is_leftover` matches.
fn read_entries_and_leftovers(dir: &Dir, leftovers: bool) -> Vec<(Box<[u8]>, EntryKind)> {
    let mut out = Vec::new();
    let mut iter = sys::iterate_dir(dir.fd());
    while let Ok(Some(entry)) = iter.next() {
        let name = entry.name.slice_u8();
        if name.first() == Some(&b'.') && !(leftovers && is_leftover(name)) {
            continue;
        }
        let kind = entry_kind(dir, name, entry.kind);
        if kind == EntryKind::Directory || kind == EntryKind::SymLink {
            out.push((name.into(), kind));
        }
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
    for (name, kind) in read_entries_and_leftovers(&dir, plan.leftovers) {
        if name.first() == Some(&b'.') {
            plan.remove(folder_idx, &name, kind);
            continue;
        }
        if name.first() == Some(&b'@') && kind == EntryKind::Directory {
            let Ok(scope_dir) = dir.open_at(&name) else {
                continue;
            };
            let scope_path = join(folder_path, &name);
            let scope_idx = plan.push_folder(&scope_path, FolderKind::Scope { parent: folder_idx });
            for (inner, inner_kind) in read_entries_and_leftovers(&scope_dir, plan.leftovers) {
                if inner.first() == Some(&b'.') {
                    plan.remove(scope_idx, &inner, inner_kind);
                    continue;
                }
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
        handle_oom(build_whole_store(&*manager, &manager.lockfile))
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
    let entry_nested_folder = store.entries.items_nested_folder();
    names.reserve(store.entries.len());
    let mut name: Vec<u8> = Vec::new();
    for (entry_idx, node_id) in store.entries.items_node_id().iter().enumerate() {
        let pkg_id = node_pkg_ids[node_id.get() as usize] as usize;
        if matches!(
            pkg_res[pkg_id].tag,
            ResolutionTag::Root | ResolutionTag::Workspace
        ) || entry_nested_folder[entry_idx]
            || !wanted.is_set(pkg_id)
        {
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
// Also returns the store built with this run's options, which is always the last one built.
fn store_entry_names(
    manager: &mut PackageManager,
    wanted: &DynamicBitSet,
) -> (Vec<Box<[u8]>>, Option<Store>) {
    if manager.lockfile.packages.len() == 0 {
        return (Vec::new(), None);
    }
    let own = install_features(manager);
    let full = full_install_features(own);
    let mut names: Vec<Box<[u8]>> = Vec::new();
    let mut own_store = None;
    for features in [Some(full), (own != full).then_some(own)]
        .into_iter()
        .flatten()
    {
        let store = build_store_with(manager, features);
        push_store_entry_names(&manager.lockfile, &store, wanted, &mut names);
        own_store = Some(store);
    }
    sort_names(&mut names);
    names.dedup();
    (names, own_store)
}

fn direct_aliases(
    manager: &PackageManager,
    pkg_id: PackageID,
    linked: &mut reachable::Linked,
) -> Vec<Box<[u8]>> {
    let lockfile: &Lockfile = &manager.lockfile;
    let buf = lockfile.buffers.string_bytes.as_slice();
    let deps = lockfile.buffers.dependencies.as_slice();
    let resolutions = lockfile.buffers.resolutions.as_slice();
    let dependency_lists = lockfile.packages.items_dependencies();
    let slice = dependency_lists[pkg_id as usize];
    let mut is_filtered = |dep_id: DependencyID, declarer: PackageID| {
        is_filtered_dependency_or_workspace(
            dep_id,
            declarer,
            &[],
            true,
            manager,
            lockfile,
            resolutions,
            linked,
        )
    };
    let mut direct: Vec<Box<[u8]>> = Vec::new();
    for dep_id in slice.begin()..slice.end() {
        // `build_store` links a peer that `--omit=peer` leaves out when an ancestor provides it.
        let dep = &deps[dep_id as usize];
        let is_omitted_peer = dep.behavior.is_peer()
            && !(dep.behavior).is_placed(manager.options.local_package_features);
        let is_linked = if is_omitted_peer {
            [pkg_id, 0].into_iter().any(|ancestor| {
                let rows = dependency_lists[ancestor as usize];
                (rows.begin()..rows.end()).any(|row| {
                    deps[row as usize].name_hash == dep.name_hash
                        && !deps[row as usize].behavior.is_peer()
                        && !is_filtered(row, ancestor)
                })
            })
        } else {
            !is_filtered(dep_id, pkg_id)
        };
        if !is_linked {
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
    let (names, store) = store_entry_names(manager, &wanted);
    plan.store = store;
    let manager: &PackageManager = manager;

    let mut removed_store: Vec<Box<[u8]>> = Vec::new();
    if let Some(store) = open_workspace_folder(STORE_DIR, &mut plan.linked_folders) {
        let store_idx = plan.push_folder(STORE_DIR, FolderKind::Store);
        for (name, kind) in read_entries(&store) {
            if &*name == b"node_modules" {
                continue;
            }
            plan.checked += 1;
            if contains(&names, &name) {
                plan_store_entry_leftovers(&store, &name, plan);
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
    let pkg_res = lockfile.packages.items_resolution();
    let mut linked = reachable::Linked::default();
    for pkg_id in 0..lockfile.packages.len() {
        let folder_path: Box<[u8]> = match pkg_res[pkg_id].tag {
            ResolutionTag::Root if pkg_id == 0 => b"node_modules".as_slice().into(),
            _ => match workspace_node_modules(lockfile, pkg_id as PackageID) {
                Some(folder_path) => folder_path,
                None => continue,
            },
        };
        if selection.is_some_and(|sel| !sel.selected.is_set(pkg_id)) {
            continue;
        }
        if is_pruned_workspace(manager, pkg_id) {
            continue;
        }
        let dir = if pkg_id == 0 {
            Dir::open(&folder_path).ok()
        } else {
            open_workspace_folder(&folder_path, &mut plan.linked_folders)
        };
        let Some(dir) = dir else {
            continue;
        };
        let direct = direct_aliases(manager, pkg_id as PackageID, &mut linked);
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
                    || is_patch_copy(manager, entry)
            },
            plan,
        );
        plan.folders[folder_idx].direct = Some(direct);
    }
}

/// Returns true if `entry` is a copy that `bun patch` made for editing, which `bun patch --commit`
/// removes. Such a copy only exists for a package whose store entry is a symlink into the global
/// store.
fn is_patch_copy(manager: &PackageManager, entry: &Entry) -> bool {
    if entry.kind != EntryKind::Directory {
        return false;
    }
    let Some((name, Some(version))) =
        (entry.dir.open_at(entry.name).ok()).and_then(|package| installed_package_json(&package))
    else {
        return false;
    };
    let lockfile: &Lockfile = &manager.lockfile;
    let name_hash = bun_semver::semver_string::Builder::string_hash(&name);
    package_for_folder(lockfile, name_hash, &version)
        .is_ok_and(|pkg| isolated_store_folders(manager, lockfile, pkg.meta.id, 0).is_empty())
}

fn has_leftovers(dir: &Dir) -> bool {
    read_entries_and_leftovers(dir, true)
        .iter()
        .any(|(name, kind)| match name.first() {
            Some(b'.') => true,
            Some(b'@') if *kind == EntryKind::Directory => dir.open_at(name).is_ok_and(|scope| {
                read_entries_and_leftovers(&scope, true)
                    .iter()
                    .any(|(inner, _)| inner.first() == Some(&b'.'))
            }),
            _ => false,
        })
}

/// Removes staging paths that a killed install left next to the package of a store entry we keep.
fn plan_store_entry_leftovers(store: &Dir, entry: &[u8], plan: &mut Plan) {
    if !plan.leftovers {
        return;
    }
    let node_modules = join(entry, b"node_modules");
    // `scan_folder` keeps every folder open until the plan runs, so only scan entries that need it.
    if !(store.open_at(&node_modules)).is_ok_and(|dir| has_leftovers(&dir)) {
        return;
    }
    // A second handle, because the first one has been read to the end.
    if let Ok(dir) = store.open_at(&node_modules) {
        let checked = plan.checked;
        scan_folder(dir, &join(STORE_DIR, &node_modules), false, &|_| true, plan);
        plan.checked = checked;
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

/// `path` is a directory that the installer creates itself, so a symlink at that path came with the
/// project.
pub(crate) fn remove_planted_link(dir: &Dir, path: &ZStr) -> sys::Maybe<()> {
    #[cfg(not(windows))]
    let (stat, remove) = (sys::lstatat(dir, path), || sys::unlinkat(dir, path));
    // `lstatat` reports a junction as a directory. On Windows, every caller passes a `path` that's
    // relative to the cwd.
    #[cfg(windows)]
    let (stat, remove) = (sys::lstat(path), || {
        let _ = dir;
        sys::unlink(path).or_else(|_| sys::rmdir(path))
    });
    match stat {
        Ok(st) if sys::kind_from_mode(st.st_mode as sys::Mode) == EntryKind::SymLink => remove(),
        // Below a plain file there is no link either.
        Err(err) if !matches!(err.get_errno(), E::ENOENT | E::ENOTDIR) => Err(err),
        _ => Ok(()),
    }
}

/// For each component of `path` (absolute, or from the cwd) after `path[..real_len]`.
pub(crate) fn remove_planted_links(path: &[u8], mut real_len: usize) -> sys::Maybe<()> {
    let separators: &[u8] = if cfg!(windows) { b"/\\" } else { b"/" };
    let mut buf = bun_paths::path_buffer_pool::get();
    while real_len < path.len() {
        let rest = &path[real_len + 1..];
        real_len += 1 + strings::index_of_any(rest, separators).unwrap_or(rest.len());
        let component = bun_paths::resolve_path::z(&path[..real_len], &mut buf);
        remove_planted_link(&Dir::cwd(), component)?;
    }
    Ok(())
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
                        bun_core::fmt::escape_control_chars(&plan.path(removal)),
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

/// Returns whether a link was removed.
fn unlink_links(dir: &Dir, should_unlink: &dyn Fn(&Dir, &[u8], &[u8]) -> bool) -> bool {
    let mut alias = Vec::new();
    let mut unlinked = false;
    for (name, kind) in read_entries(dir) {
        match kind {
            EntryKind::SymLink => {
                if should_unlink(dir, &name, &name) {
                    unlinked |= remove_link(dir, &name).is_ok();
                }
            }
            EntryKind::Directory if name.first() == Some(&b'@') => {
                let Ok(scope_dir) = dir.open_at(&name) else {
                    continue;
                };
                let mut unlinked_from_scope = false;
                for (inner, inner_kind) in read_entries(&scope_dir) {
                    if inner_kind != EntryKind::SymLink {
                        continue;
                    }
                    alias.clear();
                    alias.extend_from_slice(&name);
                    alias.push(b'/');
                    alias.extend_from_slice(&inner);
                    if should_unlink(&scope_dir, &alias, &inner) {
                        unlinked_from_scope |= remove_link(&scope_dir, &inner).is_ok();
                    }
                }
                drop(scope_dir);
                if unlinked_from_scope {
                    rmdir(dir, &name);
                }
                unlinked |= unlinked_from_scope;
            }
            _ => {}
        }
    }
    unlinked
}

/// Removes the links in `node_modules/.bun/node_modules` that an earlier install created for names
/// that `hoistPattern` no longer matches.
pub(crate) fn unlink_unhoisted(manager: &PackageManager) {
    let Some(pattern) = &manager.options.hoist_pattern else {
        return;
    };
    if let Ok(hidden) = Dir::open(&join(STORE_DIR, b"node_modules")) {
        unlink_links(&hidden, &|_, alias, _| !pattern.is_match(alias));
    }
}

// An install that skips a dependency (`--omit`, `--os`, `--cpu`) still installs its dependent.
fn unlink_removed_dependencies(store: &Dir) {
    for (entry, kind) in read_entries(store) {
        if kind != EntryKind::Directory || &*entry == b"node_modules" {
            continue;
        }
        let Some(node_modules) = open_real_subdir(store, &entry)
            .and_then(|entry_dir| open_real_subdir(&entry_dir, b"node_modules"))
        else {
            continue;
        };
        unlink_links(&node_modules, &|dir, _, name| is_dangling(dir, name));

        // A dependency with the package's own name is linked inside the package.
        let (package, _) = split_store_key(&entry);
        let Some(package_dir) = descend(&node_modules, &package) else {
            continue;
        };
        let Some(nested) = open_real_subdir(&package_dir, b"node_modules") else {
            continue;
        };
        let unlinked = unlink_links(&nested, &|dir, alias, name| {
            alias == &*package && is_dangling(dir, name)
        });
        drop(nested);
        if unlinked {
            rmdir(&package_dir, b"node_modules");
        }
    }
}

/// Removes the links in `node_modules/.bin` (on Windows the shim pairs) whose target is gone.
/// A dangling link is kept while its package is still installed, because the package's build step
/// creates the file. Returns true if a link was removed.
pub(crate) fn prune_bins(node_modules: &Dir) -> bool {
    open_real_subdir(node_modules, b".bin")
        .is_some_and(|bin| remove_dangling_bins(&bin, node_modules, None))
}

/// Returns true if the package that should contain `path` exists. `path` is relative to
/// `node_modules`. The package's folder comes after the last `node_modules` component of `path`,
/// because it can be in a store entry.
fn leads_into_package(node_modules: &Dir, path: &[u8]) -> bool {
    let (mut package, mut at) = (0, 0);
    while let Some(end) = strings::index_of_any_pos(path, b"/\\", at) {
        if &path[at..end] == b"node_modules" {
            package = end + 1;
        }
        at = end + 1;
    }
    let Some(mut end) = strings::index_of_any_pos(path, b"/\\", package) else {
        return false;
    };
    if path[package] == b'@' {
        let Some(name) = strings::index_of_any_pos(path, b"/\\", end + 1) else {
            return false;
        };
        end = name;
    }
    !is_dangling(node_modules, &path[..end])
}

/// The folder also has files that Bun didn't create, so only links into `global_node_modules` are
/// removed.
pub(crate) fn prune_global_bins(bin_path: &[u8], global_node_modules: &[u8]) {
    let Some(parent) = bun_paths::dirname(bin_path).and_then(|parent| Dir::open(parent).ok())
    else {
        return;
    };
    if let Ok(bin) = parent.open_at(bun_paths::basename(bin_path)) {
        remove_dangling_bins(&bin, &parent, Some((bin_path, global_node_modules)));
    }
}

#[cfg(not(windows))]
fn remove_dangling_bins(bin: &Dir, parent: &Dir, global: Option<(&[u8], &[u8])>) -> bool {
    let mut link = bun_paths::path_buffer_pool::get();
    let mut dangling: Vec<Box<[u8]>> = Vec::new();
    let mut iter = sys::iterate_dir(bin.fd());
    while let Ok(Some(entry)) = iter.next() {
        let name = entry.name.slice_u8();
        if entry_kind(bin, name, entry.kind) != EntryKind::SymLink || !is_dangling(bin, name) {
            continue;
        }
        if let Some((bin_path, global_node_modules)) = global {
            let dest = zname(&join(bin_path, name));
            let dest = ZStr::from_slice_with_nul(&dest);
            match sys::readlink(dest, link.as_mut_slice()) {
                Ok(len)
                    if crate::bin_real::Linker::link_leads_into(
                        dest,
                        &link[..len],
                        global_node_modules,
                    ) => {}
                _ => continue,
            }
        } else {
            let z = zname(name);
            let z = ZStr::from_slice_with_nul(&z);
            if let Ok(len) = sys::readlinkat(bin.fd(), z, link.as_mut_slice())
                && (link[..len].strip_prefix(b"../"))
                    .is_some_and(|path| leads_into_package(parent, path))
            {
                continue;
            }
        }
        dangling.push(name.into());
    }
    drop(iter);
    let mut removed = false;
    for name in &dangling {
        removed |= remove_link(bin, name).is_ok();
    }
    removed
}

// For the `.bunx` layout, see windows-shim/BinLinkingShim.rs. Only Bun writes these files,
// including in the global folder.
#[cfg(windows)]
fn remove_dangling_bins(bin: &Dir, parent: &Dir, global: Option<(&[u8], &[u8])>) -> bool {
    let mut shims: Vec<Box<[u8]>> = Vec::new();
    let mut iter = sys::iterate_dir(bin.fd());
    while let Ok(Some(entry)) = iter.next() {
        let name = entry.name.slice_u8();
        if let Some(stem) = name.strip_suffix(b".bunx") {
            shims.push(stem.into());
        }
    }
    drop(iter);
    let mut removed = false;
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
        if !is_dangling(parent, &target)
            || (global.is_none() && leads_into_package(parent, &target))
        {
            continue;
        }
        removed |= remove_link(bin, &file_name).is_ok();
        file_name.truncate(stem.len());
        file_name.extend_from_slice(b".exe");
        removed |= remove_link(bin, &file_name).is_ok();
    }
    removed
}

/// `dest` is a copy of the folder `src` without its `node_modules`. Entries in a folder that can't
/// be listed are kept.
pub(crate) fn remove_entries_missing_from(src: &Dir, dest: &Dir) {
    fn list(dir: &Dir) -> Option<Vec<(Box<[u8]>, EntryKind)>> {
        let mut entries = Vec::new();
        let mut iter = sys::iterate_dir(dir.fd());
        while let Some(entry) = iter.next().ok()? {
            entries.push((entry.name.slice_u8().into(), entry.kind));
        }
        Some(entries)
    }
    let Some(src_entries) = list(src) else {
        return;
    };
    let Some(dest_entries) = list(dest) else {
        return;
    };
    let mut names: Vec<Box<[u8]>> = src_entries.into_iter().map(|(name, _)| name).collect();
    sort_names(&mut names);

    let flags = O::RDONLY | O::CLOEXEC | O::NOFOLLOW;
    for (name, kind) in &dest_entries {
        if &**name == b"node_modules" {
            continue;
        }
        let kind = entry_kind(dest, name, *kind);
        // Every symlink is removed, because `lay_folder_links` recreates them.
        if kind == EntryKind::SymLink || !contains(&names, name) {
            let _ = dest.delete_tree(name);
        } else if kind == EntryKind::Directory
            && let (Ok(src), Ok(dest)) = (
                src.open_at_with(name, flags),
                dest.open_at_with(name, flags),
            )
        {
            remove_entries_missing_from(&src, &dest);
        }
    }
}

/// Returns the indexes in `Plan::folders` of the folders that had a link removed from their `.bin`.
fn housekeeping(plan: &Plan, layout: Layout, manager: &PackageManager) -> Vec<usize> {
    let mut lost_bins = Vec::new();
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
                if let Some(hidden) = open_real_subdir(plan.dir(idx), b"node_modules") {
                    unlink_links(&hidden, &|dir, _, name| is_dangling(dir, name));
                }
                // The planner already read `plan.dir(idx)` to its end.
                if let Ok(store) = Dir::open(&folder.path) {
                    unlink_removed_dependencies(&store);
                }
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
                if prune_bins(plan.dir(idx)) {
                    lost_bins.push(idx);
                }
            }
        }
    }
    lost_bins
}

/// A removed package may have owned names in `.bin` and in `node_modules/.bun/node_modules`.
/// Relinks those names to the packages that an install with this run's options would link them to.
fn hand_over_names(plan: &Plan, lost_bins: &[usize], layout: Layout, manager: &PackageManager) {
    use crate::bin_real::{LinkOrder, link_free_bins};
    let lockfile: &Lockfile = &manager.lockfile;
    let buf = lockfile.buffers.string_bytes.as_slice();
    let deps = lockfile.buffers.dependencies.as_slice();
    let pkg_res = lockfile.packages.items_resolution();
    let lost_a_bin = |path: &[u8]| (lost_bins.iter()).any(|&idx| &*plan.folders[idx].path == path);
    let link_bins = |path: &[u8], mut placed: Vec<(LinkOrder<'_>, PackageID)>| {
        index_sort::sort_vec_unstable_by(&mut placed, |a, b| a.cmp(b));
        let placed: Vec<(&[u8], PackageID)> = (placed.iter())
            .map(|(order, pkg_id)| (order.dependency_name, *pkg_id))
            .collect();
        link_free_bins(lockfile, path, None, &placed);
    };

    if layout == Layout::Hoisted {
        if lost_bins.is_empty() {
            return;
        }
        let hoisted = HoistedTree::init(lockfile, true, None, None);
        let direct = handle_oom(LinkOrder::direct_packages(lockfile));
        for folder in hoisted.folders_with_rows() {
            if !lost_a_bin(hoisted.path(folder)) {
                continue;
            }
            let placed = (hoisted.expected(folder).iter())
                .filter(|(_, pkg_id)| (*pkg_id as usize) < pkg_res.len())
                .map(|&(alias, pkg_id)| {
                    let tag = pkg_res[pkg_id as usize].tag;
                    (
                        LinkOrder::new(direct.is_set(pkg_id as usize), tag, alias),
                        pkg_id,
                    )
                })
                .collect();
            if let Some(path) = tree_path(lockfile, folder.0) {
                link_bins(&path, placed);
            }
        }
        return;
    }

    let Some(store) = &plan.store else {
        return;
    };
    for (index, entry_deps) in store.entries.items_dependencies().iter().enumerate() {
        if lost_bins.is_empty() {
            break;
        }
        // A workspace can have several store entries, but only one of them has its dependencies.
        if entry_deps.slice().is_empty() {
            continue;
        }
        let importer = store.ids(store_entry::Id::from(index as u32)).pkg_id;
        let path: Box<[u8]> = match workspace_node_modules(lockfile, importer) {
            Some(path) => path,
            None if index == 0 => ROOT_DIR.into(),
            None => continue,
        };
        if !lost_a_bin(&path) {
            continue;
        }
        let rows = lockfile.packages.items_dependencies()[importer as usize];
        let placed = (entry_deps.slice().iter())
            .map(|dep| {
                let row = &deps[dep.dep_id as usize];
                let pkg_id = store.ids(dep.entry_id).pkg_id;
                let is_direct = rows.contains(dep.dep_id) && LinkOrder::declares(row.behavior);
                let tag = pkg_res[pkg_id as usize].tag;
                (LinkOrder::new(is_direct, tag, row.name.slice(buf)), pkg_id)
            })
            .collect();
        link_bins(&path, placed);
    }

    if !(plan.folders.iter()).any(|folder| folder.touched && folder.kind == FolderKind::Store) {
        return;
    }
    let Some(store_dir) = open_workspace_folder(STORE_DIR, &mut Vec::new()) else {
        return;
    };
    let Some(hidden) = open_real_subdir(&store_dir, b"node_modules") else {
        return;
    };
    let mut taken: Vec<Box<[u8]>> = Vec::new();
    for (entry, kind) in read_entries(&hidden) {
        if kind != EntryKind::Directory || entry.first() != Some(&b'@') {
            taken.push(entry);
        } else if let Ok(scope_dir) = hidden.open_at(&entry) {
            let names = read_entries(&scope_dir);
            taken.extend(names.iter().map(|(name, _)| join_alias(&entry, name)));
        }
    }
    sort_names(&mut taken);
    let own_names = (store.entries.items_hoisted().iter().enumerate())
        .filter(|(_, hoisted)| **hoisted)
        .map(|(index, _)| store_entry::Id::from(index as u32))
        .map(|entry_id| (entry_id, store.ids(entry_id).dep_id));
    let other_names = (store.hidden_hoist_keys.iter()).map(|key| (key.entry_id, key.dep_id));
    let mut package: Vec<u8> = Vec::new();
    for (entry_id, dep_id) in own_names.chain(other_names) {
        let pkg_id = store.ids(entry_id).pkg_id as usize;
        let name = deps[dep_id as usize].name.slice(buf);
        if !extracted(pkg_res[pkg_id].tag) || contains(&taken, name) {
            continue;
        }
        package.clear();
        write!(
            package,
            "{}/node_modules/{}",
            store_entry::fmt_store_path(entry_id, store, lockfile),
            BStr::new(lockfile.packages.items_name()[pkg_id].slice(buf))
        )
        .expect("Vec<u8> write is infallible");
        // An entry's folder name depends on its peers, which depend on the options of the install
        // that created it, so this run's name for the entry may not exist on disk.
        if !is_dangling(&store_dir, &package) {
            Installer::link_hidden_name(store, lockfile, entry_id, name, false);
        }
    }
}

/// The `node_modules/.old_modules-<hex>` folder, which contains the tree that the other linker
/// installed.
pub(crate) struct OldModules(pub(crate) Box<[u8]>);

/// Dropping it waits for the deletion to end.
pub(crate) struct OldModulesRemoval(Arc<WaitGroup>);

impl OldModules {
    pub(crate) const PREFIX: &'static str = ".old_modules-";

    /// Deletes it on another thread. Anything that can't be deleted stays until the next `bun
    /// prune`.
    pub(crate) fn remove(&self) -> OldModulesRemoval {
        let done = Arc::new(WaitGroup::init_with_count(1));
        handle_oom(WorkPool::go(
            (self.0.clone(), Arc::clone(&done)),
            |(name, done): (Box<[u8]>, Arc<WaitGroup>)| {
                if let Ok(node_modules) = Dir::open(ROOT_DIR) {
                    let _ = node_modules.delete_tree(&name);
                }
                done.finish();
            },
        ));
        OldModulesRemoval(done)
    }
}

impl Drop for OldModulesRemoval {
    fn drop(&mut self) {
        self.0.wait();
    }
}
