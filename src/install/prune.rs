use std::io::Write as _;

use bstr::BStr;
use bun_core::{Global, Output, ZStr, strings};
use bun_install_types::NodeLinker::NodeLinker;
use bun_paths::SEP;
use bun_sys::{self as sys, Dir, E, EntryKind};

use crate::config_version::ConfigVersion;
use crate::lockfile::package::PackageColumns as _;
use crate::lockfile::tree::is_filtered_dependency_or_workspace;
use crate::lockfile::{LoadResult, Lockfile, tree};
use crate::package_manager::Options::LogLevel;
use crate::{PackageID, PackageManager, ResolutionTag, invalid_package_id};

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

pub fn prune(manager: &mut PackageManager) -> crate::Result<()> {
    let quiet = manager.options.log_level == LogLevel::Silent;
    let dry_run = manager.options.dry_run;

    let load = manager.load_lockfile_from_cwd::<false>();
    let loaded = match &load {
        LoadResult::NotFound => Err(None),
        LoadResult::Err(cause) => Err(Some(cause.value.name())),
        LoadResult::Ok(_) => Ok(load.choose_config_version().0),
    };
    drop(load);
    let config_version = match loaded {
        Ok(config_version) => config_version,
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
                if manager.log_mut().has_errors() {
                    let _ = manager
                        .log_mut()
                        .print(core::ptr::from_mut(Output::error_writer()));
                }
            }
            Global::exit(1);
        }
    };

    let store_present = match Dir::open(b"node_modules") {
        Ok(node_modules) => lstat_kind(&node_modules, b".bun") == EntryKind::Directory,
        Err(err) if err.get_errno() == E::ENOENT => {
            if !quiet {
                bun_core::prettyln!("Nothing to prune.");
                Output::flush();
            }
            return Ok(());
        }
        Err(err) => {
            Output::err(err, "failed to open node_modules", ());
            Global::exit(1);
        }
    };

    let layout = match manager.options.node_linker {
        NodeLinker::Hoisted => Layout::Hoisted,
        NodeLinker::Isolated => Layout::Isolated,
        NodeLinker::Auto => match config_version {
            ConfigVersion::V0 => Layout::Hoisted,
            ConfigVersion::V1 => {
                if manager.lockfile.workspace_paths.len() > 0 {
                    Layout::Isolated
                } else {
                    Layout::Hoisted
                }
            }
        },
    };

    let workspace_names = collect_workspace_names(&manager.lockfile);

    let mut plan = Plan::default();
    match layout {
        Layout::Hoisted => plan_hoisted(manager, &workspace_names, &mut plan),
        Layout::Isolated => plan_isolated(manager, &workspace_names, &mut plan),
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
    if n == 0 {
        if !quiet {
            bun_core::prettyln!("Nothing to prune.");
            Output::flush();
        }
        return Ok(());
    }

    if dry_run {
        if !quiet {
            for removal in &plan.removals {
                bun_core::prettyln!("<red>-<r> {}", BStr::new(&removal.display));
            }
            bun_core::prettyln!("Would remove <b>{}<r> package{}", n, plural(n));
            Output::flush();
        }
        return Ok(());
    }

    let failed = execute(&plan, quiet);
    housekeeping(&plan, layout, manager);

    let removed = n - failed;
    if !quiet {
        bun_core::prettyln!("Removed <b>{}<r> package{}", removed, plural(removed));
        Output::flush();
    }
    if failed > 0 {
        Global::exit(1);
    }
    Ok(())
}

fn collect_workspace_names(lockfile: &Lockfile) -> Vec<Box<[u8]>> {
    let buf = lockfile.buffers.string_bytes.as_slice();
    let names = lockfile.packages.items_name();
    let pkg_res = lockfile.packages.items_resolution();
    let mut out: Vec<Box<[u8]>> = pkg_res
        .iter()
        .zip(names)
        .filter(|(res, _)| res.tag == ResolutionTag::Workspace)
        .map(|(_, name)| name.slice(buf).into())
        .collect();
    out.sort_unstable();
    out.dedup();
    out
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

fn plan_hoisted(manager: &mut PackageManager, workspace_names: &[Box<[u8]>], plan: &mut Plan) {
    let keep_workspaces = |entry: &Entry| contains(workspace_names, entry.alias);
    if manager.lockfile.packages.len() == 0 {
        if let Ok(dir) = Dir::open(b"node_modules") {
            scan_folder(dir, b"node_modules", false, &keep_workspaces, plan);
        }
        return;
    }

    hoist_filtered(manager);

    let lockfile: &Lockfile = &manager.lockfile;
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

    let mut visited = vec![false; pkg_res.len()];
    let mut expected: Vec<(&[u8], PackageID)> = Vec::new();
    let mut it = tree::Iterator::<{ tree::IteratorPathStyle::NodeModules }>::init(lockfile);
    while let Some(folder) = it.next(None) {
        let owner: PackageID = match trees[folder.tree_id as usize].dependency_id {
            tree::ROOT_DEP_ID => 0,
            dep_id => resolutions[dep_id as usize],
        };
        if owner != invalid_package_id && (owner as usize) < pkg_res.len() {
            visited[owner as usize] = true;
            let tag = pkg_res[owner as usize].tag;
            if tag != ResolutionTag::Root
                && tag != ResolutionTag::Workspace
                && has_bundled_deps(owner)
            {
                continue;
            }
        }

        expected.clear();
        expected.extend(folder.dependencies.iter().map(|&dep_id| {
            (
                deps[dep_id as usize].name.slice(buf),
                resolutions[dep_id as usize],
            )
        }));
        expected.sort_unstable();
        expected.dedup_by_key(|(alias, _)| *alias);

        let Some(dir) = open_tree_folder(trees, deps, buf, folder.tree_id, workspace_names) else {
            continue;
        };
        let folder_path = folder.relative_path.as_bytes();

        for &(alias, pkg_id) in &expected {
            if (pkg_id as usize) >= pkg_res.len()
                || nested_trees.binary_search(&(folder.tree_id, alias)).is_ok()
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
            scan_folder(nested, &nested_path, false, &keep_workspaces, plan);
        }

        scan_folder(
            dir,
            folder_path,
            false,
            &|entry| {
                expected
                    .binary_search_by(|(name, _)| (*name).cmp(entry.alias))
                    .is_ok()
                    || contains(workspace_names, entry.alias)
            },
            plan,
        );
    }

    if !visited[0] {
        if let Ok(dir) = Dir::open(b"node_modules") {
            scan_folder(dir, b"node_modules", false, &keep_workspaces, plan);
        }
    }
    for (pkg_id, res) in pkg_res.iter().enumerate() {
        if visited[pkg_id] || res.tag != ResolutionTag::Workspace {
            continue;
        }
        let path = strings::without_trailing_slash(res.workspace().slice(buf));
        if path.is_empty() {
            continue;
        }
        let folder_path = join(path, b"node_modules");
        if let Ok(dir) = Dir::open(&folder_path) {
            scan_folder(dir, &folder_path, false, &keep_workspaces, plan);
        }
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
    dir.open_at(name).ok()
}

fn lstat_kind(dir: &Dir, name: &[u8]) -> EntryKind {
    match sys::lstatat(dir.fd(), ZStr::from_slice_with_nul(&zname(name))) {
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
        if !keep(&entry) {
            plan.remove(folder_idx, &name, kind);
        }
    }
    plan.retain(folder_idx, dir);
    folder_idx
}

fn wanted_packages(manager: &PackageManager) -> Vec<bool> {
    let lockfile: &Lockfile = &manager.lockfile;
    let resolutions = lockfile.buffers.resolutions.as_slice();
    let dep_slices = lockfile.packages.items_dependencies();
    let mut wanted = vec![false; dep_slices.len()];
    if wanted.is_empty() {
        return wanted;
    }
    wanted[0] = true;
    let mut worklist: Vec<PackageID> = vec![0];
    while let Some(parent) = worklist.pop() {
        let slice = dep_slices[parent as usize];
        for dep_id in slice.begin()..slice.end() {
            if is_filtered_dependency_or_workspace(
                dep_id,
                parent,
                &[],
                true,
                manager,
                lockfile,
                resolutions,
            ) {
                continue;
            }
            let target = resolutions[dep_id as usize];
            if target == invalid_package_id
                || (target as usize) >= wanted.len()
                || wanted[target as usize]
            {
                continue;
            }
            wanted[target as usize] = true;
            worklist.push(target);
        }
    }
    wanted
}

fn store_keys(lockfile: &Lockfile, wanted: &[bool]) -> Vec<Box<[u8]>> {
    let buf = lockfile.buffers.string_bytes.as_slice();
    let names = lockfile.packages.items_name();
    let pkg_res = lockfile.packages.items_resolution();
    let mut keys: Vec<Box<[u8]>> = Vec::new();
    let mut key: Vec<u8> = Vec::new();
    for pkg_id in 0..wanted.len() {
        if !wanted[pkg_id] || pkg_res[pkg_id].tag == ResolutionTag::Workspace {
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

fn direct_aliases(manager: &PackageManager, pkg_id: PackageID, filtered: bool) -> Vec<Box<[u8]>> {
    let lockfile: &Lockfile = &manager.lockfile;
    let buf = lockfile.buffers.string_bytes.as_slice();
    let deps = lockfile.buffers.dependencies.as_slice();
    let resolutions = lockfile.buffers.resolutions.as_slice();
    let slice = lockfile.packages.items_dependencies()[pkg_id as usize];
    let mut direct: Vec<Box<[u8]>> = Vec::new();
    for dep_id in slice.begin()..slice.end() {
        if filtered {
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

fn plan_isolated(manager: &PackageManager, workspace_names: &[Box<[u8]>], plan: &mut Plan) {
    let wanted = wanted_packages(manager);
    let keys = store_keys(&manager.lockfile, &wanted);
    let keep_store_entry = |name: &[u8]| {
        contains(&keys, name) || strip_peer_hash(name).is_some_and(|base| contains(&keys, base))
    };

    let mut removed_store: Vec<Box<[u8]>> = Vec::new();
    if let Ok(store) = Dir::open(STORE_DIR) {
        let store_idx = plan.push_folder(STORE_DIR, FolderKind::Store);
        for (name, kind) in read_entries(&store) {
            if &*name == b"node_modules" || keep_store_entry(&name) {
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
        let Ok(dir) = Dir::open(&folder_path) else {
            continue;
        };
        let direct = direct_aliases(manager, pkg_id as PackageID, true);
        let declared = direct_aliases(manager, pkg_id as PackageID, false);
        let folder_idx = scan_folder(
            dir,
            &folder_path,
            store_touched,
            &|entry| {
                let known = match entry.kind {
                    EntryKind::SymLink => {
                        contains(&declared, entry.alias)
                            || store_link_target(entry.dir, entry.name)
                                .is_some_and(|target| contains(&removed_store, &target))
                    }
                    _ => contains(&direct, entry.alias),
                };
                known
                    || contains(workspace_names, entry.alias)
                    || public_hoist_matches(manager, entry.alias)
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
    match sys::exists_at_type(dir.fd(), ZStr::from_slice_with_nul(&z)) {
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
    let workspace_names = collect_workspace_names(&manager.lockfile);
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
                            if contains(direct, alias) || contains(&workspace_names, alias) {
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
