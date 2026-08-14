use core::cell::{Cell, RefCell};
use core::ops::Range;
use std::io::Write as _;

use bstr::BStr;
use bun_collections::DynamicBitSet;
use bun_core::time::nano_timestamp;
use bun_core::{Global, Output, ZStr, handle_oom, strings};
use bun_install_types::NodeLinker::NodeLinker;
use bun_paths::SEP;
use bun_sys::{self as sys, Dir, E, EntryKind, O};

use crate::lockfile::package::PackageColumns as _;
use crate::lockfile::tree::is_filtered_dependency_or_workspace;
use crate::lockfile::{LoadResult, Lockfile, reachable, tree};
use crate::lockfile_real::package::{Diff, Package};
use crate::package_manager::Options::{Enable, LogLevel};
use crate::package_manager::{ROOT_PACKAGE_JSON_PATH, WorkspaceFilter};
use crate::{Features, PackageID, PackageManager, ResolutionTag, invalid_package_id};

const STORE_DIR: &[u8] = b"node_modules/.bun";

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
    display: Box<[u8]>,
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
        let display = join(&self.folders[folder].path, name);
        self.removals.push(Removal {
            folder,
            name: name.into(),
            kind,
            display,
        });
        self.folders[folder].touched = true;
        if let FolderKind::Scope { parent } = self.folders[folder].kind {
            self.folders[parent].touched = true;
        }
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

fn zname(name: &[u8]) -> Vec<u8> {
    let mut z = Vec::with_capacity(name.len() + 1);
    z.extend_from_slice(name);
    z.push(0);
    z
}

fn contains(sorted: &[Box<[u8]>], name: &[u8]) -> bool {
    sorted
        .binary_search_by(|item| item.as_ref().cmp(name))
        .is_ok()
}

fn plural(n: usize) -> &'static str {
    if n == 1 { "" } else { "s" }
}

pub fn prune(manager: &mut PackageManager, original_cwd: &[u8]) -> crate::Result<()> {
    let start = nano_timestamp();
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

    refuse_unless_lockfile_matches_package_json(manager)?;

    let store_present = match Dir::open(b"node_modules") {
        Ok(node_modules) => lstat_kind(&node_modules, b".bun") == EntryKind::Directory,
        Err(err) if err.get_errno() == E::ENOENT => {
            if !quiet {
                bun_core::pretty!(
                    "<r><green>Done<r>! No node_modules folder <d>(nothing to prune)<r> "
                );
                Output::print_start_end_stdout(start, nano_timestamp());
                bun_core::pretty!("\n");
                Output::flush();
            }
            return Ok(());
        }
        Err(err) => {
            Output::err(err, "failed to open node_modules", ());
            Global::exit(1);
        }
    };

    let layout = match linker {
        NodeLinker::Isolated => Layout::Isolated,
        _ => Layout::Hoisted,
    };

    let workspace_names = collect_workspace_names(manager);
    let selection = select_importers(manager, original_cwd);

    let mut plan = Plan::default();
    match layout {
        Layout::Hoisted => plan_hoisted(manager, &workspace_names, selection.as_ref(), &mut plan),
        Layout::Isolated => plan_isolated(manager, &workspace_names, selection.as_ref(), &mut plan),
    }

    if layout_mismatch(&plan, layout, store_present) {
        if !quiet {
            let (configured, actual) = match layout {
                Layout::Hoisted => ("hoisted", "isolated"),
                Layout::Isolated => ("isolated", "hoisted"),
            };
            Output::err_generic(
                "node_modules was installed with the {s} linker, but bun prune would use the {s} linker",
                (actual, configured),
            );
            bun_core::note!(
                "run 'bun prune --linker {}' to prune it as-is, or 'bun install' to reinstall with the {} linker",
                actual,
                configured
            );
        }
        Global::exit(1);
    }

    plan.removals
        .sort_unstable_by(|a, b| a.display.cmp(&b.display));

    let n = plan.removals.len();
    let checked = plan.checked;
    let folders = plan
        .folders
        .iter()
        .filter(|folder| matches!(folder.kind, FolderKind::NodeModules | FolderKind::Store))
        .count();
    if n == 0 {
        if !quiet {
            bun_core::pretty!(
                "<r><green>Done<r>! Checked <b>{}<r> package{} across {} folder{} <d>(nothing to prune)<r> ",
                checked,
                plural(checked),
                folders,
                plural(folders)
            );
            Output::print_start_end_stdout(start, nano_timestamp());
            bun_core::pretty!("\n");
            Output::flush();
        }
        return Ok(());
    }

    if dry_run {
        if !quiet {
            for removal in &plan.removals {
                bun_core::prettyln!("<red>-<r> {}", BStr::new(&removal.display));
            }
            bun_core::pretty!(
                "Would remove <b>{}<r> package{} <d>(checked {})<r> ",
                n,
                plural(n),
                checked
            );
            Output::print_start_end_stdout(start, nano_timestamp());
            bun_core::pretty!("\n");
            Output::flush();
        }
        return Ok(());
    }

    let failed = execute(&plan, quiet);
    housekeeping(&plan, layout, manager);

    let removed = n - failed;
    if !quiet {
        bun_core::pretty!(
            "Removed <b>{}<r> package{} <d>(checked {})<r> ",
            removed,
            plural(removed),
            checked
        );
        Output::print_start_end_stdout(start, nano_timestamp());
        bun_core::pretty!("\n");
        Output::flush();
    }
    if failed > 0 {
        Global::exit(1);
    }
    Ok(())
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
    out.sort_unstable();
    out.dedup();
    out
}

fn refuse_unless_lockfile_matches_package_json(manager: &mut PackageManager) -> crate::Result<()> {
    let Some(root) = manager.lockfile.root_package() else {
        return Ok(());
    };
    let quiet = manager.options.log_level == LogLevel::Silent;
    manager.options.enable.set(Enable::FROZEN_LOCKFILE, true);

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
    // SAFETY: same split as `hoist_filtered`; neither call reaches `lockfile` through `pm`.
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

    if summary.changes_dependencies() {
        if !quiet {
            Output::err_generic("bun.lock does not match package.json", ());
            bun_core::note!("run 'bun install' first, then run 'bun prune' again");
        }
        Global::exit(1);
    }
    manager.summary = summary;
    Ok(())
}

fn print_log_errors(log: &bun_ast::Log) {
    if log.has_errors() {
        let _ = log.print(core::ptr::from_mut(Output::error_writer()));
    }
}

struct Selection {
    selected: DynamicBitSet,
    protected_packages: DynamicBitSet,
    protected_aliases: Vec<Box<[u8]>>,
}

fn select_importers(manager: &PackageManager, original_cwd: &[u8]) -> Option<Selection> {
    if manager.options.filter_patterns.is_empty() {
        return None;
    }
    let lockfile: &Lockfile = &manager.lockfile;
    let ids = WorkspaceFilter::select_workspaces_quietly(
        lockfile,
        manager.options.filter_patterns,
        original_cwd,
    );
    if ids.is_empty() {
        if manager.options.log_level != LogLevel::Silent {
            Output::err_generic("No packages matched the filter", ());
        }
        Global::exit(1);
    }

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

    let mut protected_packages = handle_oom(DynamicBitSet::init_empty(pkg_res.len()));
    let mut protected_aliases: Vec<Box<[u8]>> = Vec::new();
    let mut worklist: Vec<PackageID> = Vec::new();
    for importer in 0..pkg_res.len() {
        if selected.is_set(importer)
            || !is_importer(importer)
            || is_pruned_workspace(manager, importer)
        {
            continue;
        }
        protected_packages.set(importer);
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
                if protected_packages.is_set(target as usize) {
                    continue;
                }
                protected_packages.set(target as usize);
                if !is_importer(target as usize) {
                    worklist.push(target);
                }
            }
        }
    }
    protected_aliases.sort_unstable();
    protected_aliases.dedup();

    Some(Selection {
        selected,
        protected_packages,
        protected_aliases,
    })
}

fn hoist_filtered(manager: &mut PackageManager) {
    let pm: *mut PackageManager = manager;
    // SAFETY: same split as `PackageManager::load_lockfile_from_cwd` — `lockfile` is its own `Box` allocation and the Filter builder only reads `manager.options`/`subcommand`/`summary`.
    let result = unsafe {
        let lf: *mut Lockfile = &raw mut *(*pm).lockfile;
        let log: *mut bun_ast::Log = (*pm).log;
        (*lf).hoist::<{ tree::BuilderMethod::Filter }>(&mut *log, Some(&*pm), true, &[], None)
    };
    if result.is_err() {
        manager.crash();
    }
}

struct TreeFolder {
    path: Range<u32>,
    expected: Range<u32>,
}

struct HoistedTree<'a> {
    lockfile: &'a Lockfile,
    trees: &'a [tree::Tree],
    folders: Vec<TreeFolder>,
    paths: Vec<u8>,
    expected: Vec<(&'a [u8], PackageID)>,
    workspace_names: &'a [Box<[u8]>],
    quiet: bool,
    kept_mismatched: Cell<bool>,
    verified: RefCell<Vec<(tree::Id, &'a [u8], bool)>>,
}

impl<'a> HoistedTree<'a> {
    fn init(
        lockfile: &'a Lockfile,
        workspace_names: &'a [Box<[u8]>],
        quiet: bool,
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

        let mut it = tree::Iterator::<{ tree::IteratorPathStyle::NodeModules }>::init(lockfile);
        while let Some(folder) = it.next(None) {
            let path_start = paths.len();
            paths.extend_from_slice(folder.relative_path.as_bytes());

            let start = expected.len();
            expected.extend(folder.dependencies.iter().map(|&dep_id| {
                (
                    deps[dep_id as usize].name.slice(buf),
                    resolutions[dep_id as usize],
                )
            }));
            expected[start..].sort_unstable();
            let mut len = start;
            for i in start..expected.len() {
                if len == start || expected[len - 1].0 != expected[i].0 {
                    expected[len] = expected[i];
                    len += 1;
                }
            }
            expected.truncate(len);

            folders[folder.tree_id as usize] = TreeFolder {
                path: path_start as u32..paths.len() as u32,
                expected: start as u32..len as u32,
            };
        }

        HoistedTree {
            lockfile,
            trees,
            folders,
            paths,
            expected,
            workspace_names,
            quiet,
            kept_mismatched: Cell::new(false),
            verified: RefCell::new(Vec::new()),
        }
    }

    fn path(&self, tree_id: usize) -> &[u8] {
        let range = &self.folders[tree_id].path;
        &self.paths[range.start as usize..range.end as usize]
    }

    fn expected(&self, tree_id: usize) -> &[(&'a [u8], PackageID)] {
        let range = &self.folders[tree_id].expected;
        &self.expected[range.start as usize..range.end as usize]
    }

    fn expected_in(&self, tree_id: tree::Id, alias: &[u8]) -> Option<(&'a [u8], PackageID)> {
        if (tree_id as usize) >= self.folders.len() {
            return None;
        }
        let expected = self.expected(tree_id as usize);
        expected
            .binary_search_by(|(name, _)| (*name).cmp(alias))
            .ok()
            .map(|i| expected[i])
    }

    fn removable(&self, from: tree::Id, alias: &[u8], entry_folder: &[u8]) -> bool {
        let mut id = from;
        while (id as usize) < self.trees.len() {
            if let Some((alias, pkg_id)) = self.expected_in(id, alias) {
                if self.verified_installed(id, alias, pkg_id) {
                    return true;
                }
                self.kept_mismatched.set(true);
                if !self.quiet {
                    bun_core::warn!(
                        "{} is not the version bun.lock installs there; keeping {}",
                        BStr::new(&join(self.path(id as usize), alias)),
                        BStr::new(&join(entry_folder, alias))
                    );
                }
                return false;
            }
            id = self.trees[id as usize].parent;
        }
        true
    }

    fn verified_installed(&self, tree_id: tree::Id, alias: &'a [u8], pkg_id: PackageID) -> bool {
        if let Some(&(_, _, matches)) = self
            .verified
            .borrow()
            .iter()
            .find(|(id, name, _)| *id == tree_id && *name == alias)
        {
            return matches;
        }
        let matches = self.installed_matches(tree_id, alias, pkg_id);
        self.verified.borrow_mut().push((tree_id, alias, matches));
        matches
    }

    fn installed_matches(&self, tree_id: tree::Id, alias: &[u8], pkg_id: PackageID) -> bool {
        let buf = self.lockfile.buffers.string_bytes.as_slice();
        let deps = self.lockfile.buffers.dependencies.as_slice();
        let Some(res) = self
            .lockfile
            .packages
            .items_resolution()
            .get(pkg_id as usize)
        else {
            return false;
        };
        let Some(folder) = open_tree_folder(self.trees, deps, buf, tree_id, self.workspace_names)
        else {
            return false;
        };
        let Some(package) = descend(&folder, alias, false) else {
            return false;
        };
        match res.tag {
            ResolutionTag::Npm => {
                let Ok(bytes) = sys::File::read_from(package.fd(), b"package.json") else {
                    return false;
                };
                crate::initialize_store();
                let source = bun_ast::Source::init_path_string_owned(b"package.json", bytes);
                let mut log = bun_ast::Log::init();
                let mut checker =
                    crate::bun_json::PackageJSONVersionChecker::init(&source, &mut log);
                if checker.parse().is_err()
                    || checker.has_errors()
                    || !checker.has_found_name
                    || !checker.has_found_version
                {
                    return false;
                }
                let expected = res.npm().version.fmt(buf).to_string();
                without_build(checker.found_version()) == without_build(expected.as_bytes())
                    && checker.found_name()
                        == self.lockfile.packages.items_name()[pkg_id as usize].slice(buf)
            }
            ResolutionTag::Git | ResolutionTag::Github => {
                sys::File::read_from(package.fd(), b".bun-tag")
                    .is_ok_and(|tag| tag.as_slice() == res.repository().resolved.slice(buf))
            }
            _ => false,
        }
    }
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

    hoist_filtered(manager);

    let quiet = manager.options.log_level == LogLevel::Silent;
    let lockfile: &Lockfile = &manager.lockfile;
    let hoisted = HoistedTree::init(lockfile, workspace_names, quiet);
    let buf = lockfile.buffers.string_bytes.as_slice();
    let deps = lockfile.buffers.dependencies.as_slice();
    let resolutions = lockfile.buffers.resolutions.as_slice();
    let trees = lockfile.buffers.trees.as_slice();
    let pkg_res = lockfile.packages.items_resolution();
    let dep_slices = lockfile.packages.items_dependencies();

    let has_bundled_deps = |pkg_id: PackageID| {
        let slice = dep_slices[pkg_id as usize];
        (slice.begin() as usize..slice.end() as usize).any(|i| deps[i].behavior.is_bundled())
    };

    let mut nested_trees: Vec<(tree::Id, &[u8])> = trees
        .iter()
        .skip(1)
        .map(|t| (t.parent, t.folder_name(deps, buf)))
        .collect();
    nested_trees.sort_unstable();

    let tree_owner = |tree_idx: usize| -> PackageID {
        match trees[tree_idx].dependency_id {
            tree::ROOT_DEP_ID => 0,
            dep_id => resolutions[dep_id as usize],
        }
    };
    let mut tree_importer: Vec<PackageID> = Vec::new();
    if selection.is_some() {
        tree_importer.reserve_exact(trees.len());
        for tree_idx in 0..trees.len() {
            let owner = tree_owner(tree_idx);
            let importer = if tree_idx == 0 {
                0
            } else if (owner as usize) < pkg_res.len()
                && pkg_res[owner as usize].tag == ResolutionTag::Workspace
            {
                owner
            } else {
                tree_importer
                    .get(trees[tree_idx].parent as usize)
                    .copied()
                    .unwrap_or(0)
            };
            tree_importer.push(importer);
        }
    }

    let mut visited = handle_oom(DynamicBitSet::init_empty(pkg_res.len()));
    for tree_idx in 0..hoisted.folders.len() {
        let folder_path = hoisted.path(tree_idx);
        if folder_path.is_empty() {
            continue;
        }
        let importer = tree_importer.get(tree_idx).copied().unwrap_or(0);
        if selection.is_some_and(|sel| importer != 0 && !sel.selected.is_set(importer as usize)) {
            continue;
        }
        let protected: &[Box<[u8]>] = if importer == 0 { root_protected } else { &[] };
        let tree_id = tree_idx as tree::Id;
        let owner = tree_owner(tree_idx);
        if owner != invalid_package_id && (owner as usize) < pkg_res.len() {
            visited.set(owner as usize);
            let tag = pkg_res[owner as usize].tag;
            if tag != ResolutionTag::Root
                && tag != ResolutionTag::Workspace
                && has_bundled_deps(owner)
            {
                continue;
            }
        }

        let expected = hoisted.expected(tree_idx);

        let Some(dir) = open_tree_folder(trees, deps, buf, tree_id, workspace_names) else {
            continue;
        };

        for &(alias, pkg_id) in expected {
            if (pkg_id as usize) >= pkg_res.len()
                || nested_trees.binary_search(&(tree_id, alias)).is_ok()
            {
                continue;
            }
            let extracted = matches!(
                pkg_res[pkg_id as usize].tag,
                ResolutionTag::Npm
                    | ResolutionTag::LocalTarball
                    | ResolutionTag::RemoteTarball
                    | ResolutionTag::Git
                    | ResolutionTag::Github
            );
            if !extracted || has_bundled_deps(pkg_id) {
                continue;
            }
            let Some(nested) = descend(&dir, alias, false)
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

        let parent = trees[tree_idx].parent;
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
    for (pkg_id, res) in pkg_res.iter().enumerate() {
        if visited.is_set(pkg_id)
            || res.tag != ResolutionTag::Workspace
            || selection.is_some_and(|sel| !sel.selected.is_set(pkg_id))
            || is_pruned_workspace(&*manager, pkg_id)
        {
            continue;
        }
        let path = strings::without_trailing_slash(res.workspace().slice(buf));
        if path.is_empty() {
            continue;
        }
        let folder_path = join(path, b"node_modules");
        if let Ok(dir) = Dir::open(&folder_path) {
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
        bun_core::note!(
            "run 'bun install' with the same flags to install the versions bun.lock expects, then run 'bun prune' again"
        );
    }
}

fn open_tree_folder(
    trees: &[tree::Tree],
    deps: &[crate::Dependency],
    buf: &[u8],
    tree_id: tree::Id,
    workspace_names: &[Box<[u8]>],
) -> Option<Dir> {
    let mut chain: Vec<tree::Id> = Vec::new();
    let mut id = tree_id;
    while id != 0 && (id as usize) < trees.len() {
        chain.push(id);
        id = trees[id as usize].parent;
    }
    let mut dir = Dir::open(b"node_modules").ok()?;
    while let Some(id) = chain.pop() {
        let alias = trees[id as usize].folder_name(deps, buf);
        let package = descend(&dir, alias, contains(workspace_names, alias))?;
        dir = open_real_subdir(&package, b"node_modules")?;
    }
    Some(dir)
}

fn descend(dir: &Dir, alias: &[u8], follow: bool) -> Option<Dir> {
    let (scope, name) = match strings::split_once_char(alias, b'/') {
        Some(split) if alias.first() == Some(&b'@') => (Some(split.0), split.1),
        _ => (None, alias),
    };
    let scope_dir = match scope {
        Some(scope) => Some(open_real_subdir(dir, scope)?),
        None => None,
    };
    let parent = scope_dir.as_ref().unwrap_or(dir);
    if follow {
        parent.open_at(name).ok()
    } else {
        open_real_subdir(parent, name)
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

fn wanted_packages(manager: &PackageManager) -> DynamicBitSet {
    let lockfile: &Lockfile = &manager.lockfile;
    let resolutions = lockfile.buffers.resolutions.as_slice();
    let options = reachable::Options::install(manager);
    if manager.summary.pruned_workspaces.is_empty() {
        return reachable::packages(lockfile, resolutions, options);
    }
    let pkg_res = lockfile.packages.items_resolution();
    let roots: Vec<PackageID> = (0..pkg_res.len())
        .filter(|&id| {
            (id == 0 || pkg_res[id].tag == ResolutionTag::Workspace)
                && !is_pruned_workspace(manager, id)
        })
        .map(|id| id as PackageID)
        .collect();
    reachable::packages_from(lockfile, resolutions, &roots, false, options)
}

fn store_keys(lockfile: &Lockfile, wanted: &DynamicBitSet) -> Vec<Box<[u8]>> {
    let buf = lockfile.buffers.string_bytes.as_slice();
    let names = lockfile.packages.items_name();
    let pkg_res = lockfile.packages.items_resolution();
    let mut keys: Vec<Box<[u8]>> = Vec::with_capacity(wanted.count());
    let mut key: Vec<u8> = Vec::new();
    let mut set_bits = wanted.iterator::<true, true>();
    while let Some(pkg_id) = set_bits.next() {
        if pkg_res[pkg_id].tag == ResolutionTag::Workspace {
            continue;
        }
        let name = names[pkg_id];
        let res = &pkg_res[pkg_id];
        key.clear();
        let written = match res.tag {
            ResolutionTag::Root => {
                if name.is_empty() {
                    key.extend_from_slice(bun_paths::basename(
                        crate::bun_fs::FileSystem::instance().top_level_dir(),
                    ));
                    Ok(())
                } else {
                    write!(key, "{}@root", name.fmt_store_path(buf))
                }
            }
            ResolutionTag::Folder => write!(
                key,
                "{}@file+{}",
                name.fmt_store_path(buf),
                res.folder().fmt_store_path(buf)
            ),
            _ => write!(
                key,
                "{}@{}",
                name.fmt_store_path(buf),
                res.fmt_store_path(buf)
            ),
        };
        if written.is_ok() {
            keys.push(key.as_slice().into());
        }
    }
    keys.sort_unstable();
    keys.dedup();
    keys
}

fn strip_peer_hash(name: &[u8]) -> Option<&[u8]> {
    const SUFFIX_LEN: usize = 1 + 16;
    if name.len() <= SUFFIX_LEN {
        return None;
    }
    let (base, suffix) = name.split_at(name.len() - SUFFIX_LEN);
    (suffix[0] == b'+' && suffix[1..].iter().all(u8::is_ascii_hexdigit)).then_some(base)
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
    direct.sort_unstable();
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
    manager: &PackageManager,
    workspace_names: &[Box<[u8]>],
    selection: Option<&Selection>,
    plan: &mut Plan,
) {
    let mut wanted = wanted_packages(manager);
    if let Some(sel) = selection {
        wanted
            .unmanaged
            .set_union(&sel.protected_packages.unmanaged);
    }
    let keys = store_keys(&manager.lockfile, &wanted);
    let keep_store_entry = |name: &[u8]| {
        contains(&keys, name) || strip_peer_hash(name).is_some_and(|base| contains(&keys, base))
    };

    let mut removed_store: Vec<Box<[u8]>> = Vec::new();
    if let Ok(store) = Dir::open(STORE_DIR) {
        let store_idx = plan.push_folder(STORE_DIR, FolderKind::Store);
        for (name, kind) in read_entries(&store) {
            if &*name == b"node_modules" {
                continue;
            }
            plan.checked += 1;
            if keep_store_entry(&name) {
                continue;
            }
            plan.remove(store_idx, &name, kind);
            removed_store.push(name);
        }
        plan.retain(store_idx, store);
    }
    removed_store.sort_unstable();
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

fn layout_mismatch(plan: &Plan, layout: Layout, store_present: bool) -> bool {
    match layout {
        Layout::Isolated => {
            !store_present && plan.removals.iter().any(|r| r.kind == EntryKind::Directory)
        }
        Layout::Hoisted => plan.removals.iter().any(|r| {
            r.kind == EntryKind::SymLink && store_link_target(plan.dir(r.folder), &r.name).is_some()
        }),
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
    let mut removed_from = vec![false; plan.folders.len()];

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
                Output::err(err, "failed to remove {s}", (BStr::new(&removal.display),));
                failed += 1;
                continue;
            }
        }
        if !quiet {
            bun_core::prettyln!("<red>-<r> {}", BStr::new(&removal.display));
        }
        removed_from[removal.folder] = true;
    }

    for (idx, folder) in plan.folders.iter().enumerate() {
        let FolderKind::Scope { parent } = folder.kind else {
            continue;
        };
        if !removed_from[idx] {
            continue;
        }
        let scope_name = &folder.path[plan.folders[parent].path.len() + 1..];
        rmdir(plan.dir(parent), scope_name);
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
