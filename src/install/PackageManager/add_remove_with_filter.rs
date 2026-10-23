use bstr::BStr;

use crate::bun_fs::FileSystem;
use crate::lockfile::package::PackageColumns as _;
use crate::lockfile_real::package::workspace_map::{MissingWorkspace, WorkspaceMap};
use crate::{Error, ResolutionTag};
use bun_collections::{StringArrayHashMap, index_sort};
use bun_core::time::nano_timestamp;
use bun_core::{Global, Output, strings};
use bun_install::dependency;
use bun_install::{Lockfile, PackageID, PackageNameHash};
use bun_paths::path_buffer_pool;
use bun_paths::resolve_path::{self, Platform, join_abs_string_buf, platform};
use bun_sys::{Fd, File};

use super::add_catalog;
use super::install_with_manager::install_with_manager;
use super::options::LogLevel;
use super::package_json_editor::EditOptions;
use super::package_json_write_back;
use super::update_package_json_and_install::{
    package_json_entry_or_crash, remove_dependencies_from_package_json,
    remove_leftover_node_modules, save_entry,
};
use super::workspace_package_json_cache::{GetJSONOptions, GetResult, MapEntry};
use super::workspace_selection::{self, Candidate, LinkTargets, RootSelection, WorkspaceGraph};
use super::{
    Command, PackageManager, PackageUpdateInfo, Subcommand, UpdateRequest, UpdateTargetWorkspace,
};

#[derive(Clone)]
pub(crate) struct WorkspaceTarget {
    pub(crate) name: Box<[u8]>,
    /// `None` = the workspace root.
    pub(crate) name_hash: Option<PackageNameHash>,
    pub(crate) package_json_path: Box<[u8]>,
}

impl WorkspaceTarget {
    pub(crate) fn root() -> WorkspaceTarget {
        WorkspaceTarget {
            name: Box::default(),
            name_hash: None,
            package_json_path: root_package_json_path(),
        }
    }

    /// `None` unless `pkg_id` is the root or a workspace member.
    pub(crate) fn of_lockfile_package(
        lockfile: &Lockfile,
        pkg_id: PackageID,
    ) -> Option<WorkspaceTarget> {
        let res = lockfile.packages.items_resolution()[pkg_id as usize];
        match res.tag {
            ResolutionTag::Root => Some(WorkspaceTarget::root()),
            ResolutionTag::Workspace => {
                let buf = lockfile.buffers.string_bytes.as_slice();
                let top_level = FileSystem::instance().top_level_dir();
                let mut path_buf = path_buffer_pool::get();
                Some(WorkspaceTarget {
                    name: Box::from(lockfile.packages.items_name()[pkg_id as usize].slice(buf)),
                    name_hash: Some(lockfile.packages.items_name_hash()[pkg_id as usize]),
                    package_json_path: resolve_path::join_abs_string_buf_checked::<platform::Auto>(
                        top_level,
                        &mut path_buf.0,
                        &[res.workspace().slice(buf), b"package.json"],
                    )?
                    .into(),
                })
            }
            _ => None,
        }
    }
}

pub(crate) fn root_package_json_path() -> Box<[u8]> {
    let top_level = FileSystem::instance().top_level_dir();
    let mut buf = path_buffer_pool::get();
    let path: Box<[u8]> =
        join_abs_string_buf::<platform::Auto>(top_level, &mut buf.0, &[b"package.json"]).into();
    path
}

pub(crate) struct WorkspaceMembers {
    pub(crate) root_path: Box<[u8]>,
    pub(crate) root_name: Box<[u8]>,
    pub(crate) members: WorkspaceMap,
}

pub(crate) fn load_workspace_members(manager: &mut PackageManager) -> WorkspaceMembers {
    let root_path = root_package_json_path();

    let entry = package_json_entry_or_crash(manager, &root_path);
    let (root_expr, root_source) = (entry.root, entry.source.clone());
    let name_expr = root_expr.get(b"name");
    let root_name: Box<[u8]> = name_expr
        .as_ref()
        .and_then(|e| e.as_utf8_string_literal())
        .unwrap_or(b"")
        .into();

    let mut members = WorkspaceMap::init();
    let log = manager.log_mut();
    if let Err(err) = members.process_manifest(
        &mut manager.workspace_package_json_cache,
        log,
        &root_expr,
        &root_source,
        MissingWorkspace::Error,
    ) {
        if log.has_errors() {
            let _ = log.print(std::ptr::from_mut(Output::error_writer()));
        } else {
            Output::err_generic(
                "failed to load workspaces from package.json \"{}\": {}",
                (BStr::new(&root_path), err.name()),
            );
        }
        Global::crash();
    }

    WorkspaceMembers {
        root_path,
        root_name,
        members,
    }
}

pub(crate) fn select_targets(
    manager: &mut PackageManager,
    original_cwd: &[u8],
) -> Result<Vec<WorkspaceTarget>, Error> {
    let top_level = FileSystem::instance().top_level_dir();
    let WorkspaceMembers {
        root_path,
        root_name,
        members,
    } = load_workspace_members(manager);

    let mut path_buf = path_buffer_pool::get();
    let patterns = manager.options.filter_patterns;

    let root_subject: Box<[u8]> =
        strings::without_trailing_slash(join_abs_string_buf::<platform::Posix>(
            top_level,
            &mut path_buf.0,
            &[b"."],
        ))
        .into();
    let mut candidates: Vec<(WorkspaceTarget, Box<[u8]>)> = Vec::with_capacity(members.count() + 1);
    candidates.push((
        WorkspaceTarget {
            name: root_name,
            name_hash: None,
            package_json_path: root_path,
        },
        root_subject,
    ));

    let mut package_json_buf = path_buffer_pool::get();
    for (rel, entry) in members.keys().iter().zip(members.values()) {
        let rel: &[u8] = rel;
        let subject: Box<[u8]> =
            strings::without_trailing_slash(join_abs_string_buf::<platform::Posix>(
                top_level,
                &mut path_buf.0,
                &[rel],
            ))
            .into();
        candidates.push((
            WorkspaceTarget {
                name: entry.name.clone(),
                name_hash: Some(bun_semver::string::Builder::string_hash(&entry.name)),
                package_json_path: join_abs_string_buf::<platform::Auto>(
                    top_level,
                    &mut package_json_buf.0,
                    &[rel, b"package.json"],
                )
                .into(),
            },
            subject,
        ));
    }

    let root_rule = if matches!(manager.subcommand, Subcommand::Add | Subcommand::Remove) {
        RootSelection::ExplicitOnly
    } else {
        RootSelection::Implicit
    };
    let graph: Option<WorkspaceGraph> =
        workspace_selection::first_relational(patterns).map(|pattern| {
            let targets: Vec<&WorkspaceTarget> =
                candidates.iter().map(|(target, _)| target).collect();
            super::workspace_manifests::relation_graph(manager, &targets, pattern)
        });
    let selection = {
        let subjects: Vec<Candidate<'_>> = candidates
            .iter()
            .map(|(target, subject)| Candidate {
                name: &target.name,
                abs_posix_dir: subject,
                is_root: target.name_hash.is_none(),
            })
            .collect();
        workspace_selection::select(patterns, original_cwd, &subjects, graph.as_ref(), root_rule)
    };
    let unmatched_patterns = selection.unmatched_patterns;

    let targets: Vec<WorkspaceTarget> = candidates
        .into_iter()
        .enumerate()
        .filter(|&(i, _)| selection.selected.is_set(i))
        .map(|(_, (target, _))| target)
        .collect();

    if targets.is_empty() {
        if manager.options.log_level == LogLevel::Silent {
            Global::crash();
        }
        workspace_selection::error_unmatched(patterns);
    }
    workspace_selection::warn_unmatched(patterns, &unmatched_patterns);

    Ok(targets)
}

pub(crate) fn fetch_entry<'a>(
    manager: &'a mut PackageManager,
    target: &WorkspaceTarget,
) -> &'a mut MapEntry {
    let log = manager.log_mut();
    match manager.workspace_package_json_cache.get_with_path(
        log,
        &target.package_json_path,
        GetJSONOptions {
            init_reset_store: false,
            guess_indentation: true,
        },
    ) {
        GetResult::Entry(entry) => entry,
        GetResult::ParseErr(err) | GetResult::ReadErr(err) => {
            Output::err_generic(
                "failed to read/parse package.json for workspace '{}': {}",
                (BStr::new(&target.name), err.name()),
            );
            Global::crash();
        }
    }
}

pub(crate) fn fetch_entry_root(
    manager: &mut PackageManager,
    target: &WorkspaceTarget,
) -> bun_ast::Expr {
    fetch_entry(manager, target).root
}

pub(crate) fn store_entry(
    manager: &mut PackageManager,
    target: &WorkspaceTarget,
    root: bun_ast::Expr,
) {
    let log = manager.log_mut();
    save_entry(fetch_entry(manager, target), root, log);
}

pub(crate) fn write_target(manager: &mut PackageManager, target: &WorkspaceTarget) -> bool {
    let entry = fetch_entry(manager, target);
    let mut zbuf = path_buffer_pool::get();
    let path = resolve_path::z(&target.package_json_path, &mut zbuf);
    match File::write_file(Fd::cwd(), path, &entry.source.contents) {
        Ok(()) => true,
        Err(err) => {
            if target.name.is_empty() {
                Output::err_generic("failed to write package.json: {}", (BStr::new(err.name()),));
            } else {
                Output::err_generic(
                    "failed to write package.json for workspace '{}': {}",
                    (BStr::new(&target.name), BStr::new(err.name())),
                );
            }
            false
        }
    }
}

pub(crate) fn reset_e_strings(updates: &mut [UpdateRequest]) {
    // `e_string` points into the previous target's AST; `edit` skips requests that already have one.
    for request in updates.iter_mut() {
        request.e_string = None;
    }
}

/// Moves the requests in `wanted` to the front, preserving order; returns how many there are.
fn move_to_front(updates: &mut [UpdateRequest], wanted: &[PackageNameHash]) -> usize {
    index_sort::stable_partition(updates, |request| wanted.contains(&request.name_hash))
}

/// Restores the order `updates` had before the `move_to_front` passes (`before[i]` is the i-th original name hash).
fn restore_order(updates: &mut [UpdateRequest], before: &[PackageNameHash]) {
    let key = |request: &UpdateRequest| before.iter().position(|&h| h == request.name_hash);
    let mut order = index_sort::identity(updates.len());
    index_sort::sort_indices(&mut order, &mut |a, b| {
        key(&updates[a as usize]).cmp(&key(&updates[b as usize]))
    });
    for i in 0..order.len() {
        let mut j = order[i] as usize;
        while j < i {
            j = order[j] as usize;
        }
        updates.swap(i, j);
    }
}

/// The `(prefix, path)` of a positional naming a local path, which is relative to the invoking cwd.
pub(crate) fn local_relative_path(request: &UpdateRequest) -> Option<(&'static [u8], &[u8])> {
    let buf = request.version_buf();
    let literal = request.version.literal.slice(buf);
    let file_prefix: &'static [u8] = if literal.starts_with(b"file:") {
        b"file:"
    } else {
        b""
    };
    // Use the parsed path, not the literal: `file:/../lib` and `file://../lib` both mean `../lib`.
    let (prefix, path): (&'static [u8], &[u8]) = match request.version.tag {
        dependency::Tag::Folder => (file_prefix, request.version.folder().slice(buf)),
        dependency::Tag::Tarball => match &request.version.tarball().uri {
            dependency::URI::Local(path) => (file_prefix, path.slice(buf)),
            dependency::URI::Remote(_) => return None,
        },
        dependency::Tag::Symlink => (b"link:", literal.strip_prefix(b"link:")?),
        _ => return None,
    };
    let is_path = if prefix == b"link:" {
        dependency::is_link_path(path)
    } else {
        path.starts_with(b".") || (!path.is_empty() && !strings::contains(path, b"://"))
    };
    (is_path && !path.starts_with(b"//") && !Platform::AUTO.is_absolute(path))
        .then_some((prefix, path))
}

#[cold]
fn local_path_too_long(request: &UpdateRequest) -> ! {
    Output::err_generic(
        "Dependency \"{}\" has an unsafe folder path",
        (BStr::new(
            request.version.literal.slice(request.version_buf()),
        ),),
    );
    Global::crash();
}

fn resolve_from_cwd<'a>(
    cwd: &'a [u8],
    buf: &'a mut bun_paths::PathBuffer,
    request: &UpdateRequest,
    path: &[u8],
) -> &'a [u8] {
    resolve_path::join_abs_string_buf_checked::<platform::Auto>(cwd, &mut buf.0, &[path])
        .unwrap_or_else(|| local_path_too_long(request))
}

/// `None` means the global package.json, which stores `abs` itself, like `-g /abs/path` does.
fn spell_relative_to(
    package_json_path: Option<&[u8]>,
    request: &UpdateRequest,
    prefix: &[u8],
    abs: &[u8],
) -> Vec<u8> {
    let mut buf = path_buffer_pool::get();
    let rel: &[u8] = match package_json_path {
        Some(package_json_path) => {
            let target_dir = resolve_path::dirname::<platform::Auto>(package_json_path);
            // `rel` is at most one `../` for each component of `target_dir`, then `abs`.
            let components = target_dir
                .iter()
                .filter(|&&c| Platform::AUTO.is_separator(c))
                .count()
                + 1;
            if abs.len() + components * b"../".len() >= buf.0.len() {
                local_path_too_long(request);
            }
            resolve_path::relative_platform_buf::<platform::Auto, true>(&mut buf.0, target_dir, abs)
        }
        None => abs,
    };
    let mut positional = Vec::with_capacity(request.name.len() + prefix.len() + rel.len() + 4);
    if request.is_aliased {
        positional.extend_from_slice(request.name);
        positional.push(b'@');
    }
    positional.extend_from_slice(prefix);
    let path_start = positional.len();
    let escapes =
        rel.starts_with(b"..") && rel.get(2).is_none_or(|&c| Platform::AUTO.is_separator(c));
    if !escapes && package_json_path.is_some() {
        positional.extend_from_slice(b"./");
    }
    positional.extend_from_slice(rel);
    resolve_path::platform_to_posix_in_place(&mut positional[path_start..]);
    // The trailing separator is what tells a directory named `lib.tgz/` from a tarball.
    let typed = request.version.literal.slice(request.version_buf());
    if typed.ends_with(b"/") && !positional.ends_with(b"/") {
        positional.push(b'/');
    }
    positional
}

/// Without `--filter`: a local path that was typed in a different directory is rewritten relative
/// to the one target.
pub(super) fn respell_local_paths(
    manager: &mut PackageManager,
    original_cwd: &[u8],
    updates: Vec<UpdateRequest>,
) -> Vec<UpdateRequest> {
    let package_json_path: Box<[u8]> = manager.original_package_json_path.as_bytes().into();
    let (cwd, target): (&[u8], Option<&[u8]>) = if manager.options.global {
        // `original_cwd` is the global directory here, because `init` changes to it first.
        (
            bun_paths::fs::FileSystem::instance().initial_top_level_dir(),
            None,
        )
    } else if resolve_path::dirname::<platform::Auto>(&package_json_path) == original_cwd {
        return updates;
    } else {
        (original_cwd, Some(&*package_json_path))
    };
    let mut buf = path_buffer_pool::get();
    let mut requests: Vec<UpdateRequest> = Vec::with_capacity(updates.len());
    for request in updates {
        let Some((prefix, path)) = local_relative_path(&request) else {
            requests.push(request);
            continue;
        };
        let abs = resolve_from_cwd(cwd, &mut buf, &request, path);
        let positional = spell_relative_to(target, &request, prefix, abs);
        let log = manager.log_mut();
        let subcommand = manager.subcommand;
        UpdateRequest::parse(
            Some(&mut *manager),
            log,
            &[positional.as_slice()],
            &mut requests,
            subcommand,
        );
    }
    requests
}

/// The requests to install and, per target, the ones it receives; a local path becomes one request per distinct spelling.
fn assign_requests(
    manager: &mut PackageManager,
    original_cwd: &[u8],
    updates: Vec<UpdateRequest>,
    targets: &[WorkspaceTarget],
) -> (Vec<UpdateRequest>, Vec<Vec<PackageNameHash>>) {
    enum Slot {
        Shared(PackageNameHash),
        PerTarget(Vec<Vec<u8>>),
    }
    let mut buf = path_buffer_pool::get();
    let mut requests: Vec<UpdateRequest> = Vec::with_capacity(updates.len());
    let mut slots: Vec<Slot> = Vec::with_capacity(updates.len());
    for request in updates {
        let Some((prefix, path)) = local_relative_path(&request) else {
            slots.push(Slot::Shared(request.name_hash));
            requests.push(request);
            continue;
        };
        let abs: Box<[u8]> = resolve_from_cwd(original_cwd, &mut buf, &request, path).into();
        slots.push(Slot::PerTarget(
            targets
                .iter()
                .map(|target| {
                    spell_relative_to(Some(&*target.package_json_path), &request, prefix, &abs)
                })
                .collect(),
        ));
    }

    let positionals: Vec<&[u8]> = slots
        .iter()
        .filter_map(|slot| match slot {
            Slot::PerTarget(spellings) => Some(spellings),
            Slot::Shared(_) => None,
        })
        .flatten()
        .map(Vec::as_slice)
        .collect();
    if !positionals.is_empty() {
        let log = manager.log_mut();
        let subcommand = manager.subcommand;
        UpdateRequest::parse(
            Some(&mut *manager),
            log,
            &positionals,
            &mut requests,
            subcommand,
        );
    }

    let assigned = (0..targets.len())
        .map(|i| {
            slots
                .iter()
                .map(|slot| match slot {
                    Slot::Shared(name_hash) => *name_hash,
                    Slot::PerTarget(spellings) => requests
                        .iter()
                        .find(|request| request.version_buf() == spellings[i].as_slice())
                        .unwrap_or_else(|| {
                            Output::err_generic(
                                "\"{}\" is spelled differently relative to each selected workspace; add it to one workspace at a time",
                                (BStr::new(&spellings[i]),),
                            );
                            Global::crash();
                        })
                        .name_hash,
                })
                .collect()
        })
        .collect();
    (requests, assigned)
}

fn join_names<'a>(names: impl Iterator<Item = &'a [u8]>) -> Vec<u8> {
    let mut out = Vec::new();
    for name in names {
        if !out.is_empty() {
            out.extend_from_slice(b", ");
        }
        out.extend_from_slice(if name.is_empty() {
            b"package.json".as_slice()
        } else {
            name
        });
    }
    out
}

#[cold]
fn print_nothing_to_remove(start_time: i128, updates: &[UpdateRequest], workspaces: &[Box<[u8]>]) {
    let names = join_names(updates.iter().map(|request| request.name));
    let workspaces = join_names(workspaces.iter().map(|name| &name[..]));
    bun_core::pretty!(
        "\n<r>{} {} of {} ",
        BStr::new(&names),
        if updates.len() == 1 {
            "is not a dependency"
        } else {
            "are not dependencies"
        },
        BStr::new(&workspaces),
    );
    Output::print_start_end_stdout(start_time, nano_timestamp());
    bun_core::pretty!("\n");
    Output::flush();
}

struct PendingTarget {
    target: WorkspaceTarget,
    received: Box<[PackageNameHash]>,
    updating: StringArrayHashMap<PackageUpdateInfo>,
}

/// The add/update --filter targets and the requests each one received; edited again once resolved.
pub(crate) struct PendingWrite {
    targets: Vec<PendingTarget>,
    catalog_mode: bool,
}

impl PendingWrite {
    /// Package ids of the targets that received `request`; `clean_with_logger` resolves it from these.
    pub(crate) fn workspace_ids_receiving(
        &self,
        lockfile: &Lockfile,
        request: PackageNameHash,
    ) -> Vec<PackageID> {
        self.targets
            .iter()
            .filter(|pending| pending.received.contains(&request))
            .filter_map(|pending| {
                let id = lockfile.get_workspace_package_id(pending.target.name_hash);
                (pending.target.name_hash.is_none() || id != 0).then_some(id)
            })
            .collect()
    }

    /// Writes the resolved versions into every target's cache entry; `flush` puts them on disk.
    pub(crate) fn edit_entries(
        &mut self,
        manager: &mut PackageManager,
        updates: &mut [UpdateRequest],
    ) -> Result<(), Error> {
        let dependency_list: &'static [u8] = manager.options.update.prop;
        let exact_versions = manager.options.enable.exact_versions();
        let summary_order: Vec<PackageNameHash> = updates.iter().map(|r| r.name_hash).collect();

        for pending in &mut self.targets {
            let kept = move_to_front(updates, &pending.received);
            manager.lockfile.bind_update_requests(
                None,
                pending.target.name_hash,
                &mut updates[..kept],
            );
            let outer = core::mem::replace(
                &mut manager.updating_packages,
                core::mem::take(&mut pending.updating),
            );
            let summary_workspace =
                core::mem::replace(&mut manager.workspace_name_hash, pending.target.name_hash);
            let mut root = fetch_entry_root(manager, &pending.target);
            let mut slice: &mut [UpdateRequest] = &mut updates[..kept];
            let result = add_catalog::edit_target(
                manager,
                &mut slice,
                &mut root,
                dependency_list,
                EditOptions {
                    exact_versions,
                    ..Default::default()
                },
            );
            manager.workspace_name_hash = summary_workspace;
            pending.updating = core::mem::replace(&mut manager.updating_packages, outer);
            result?;
            store_entry(manager, &pending.target, root);
        }
        restore_order(updates, &summary_order);

        if self.catalog_mode {
            let root_target = WorkspaceTarget::root();
            let root = fetch_entry_root(manager, &root_target);
            if add_catalog::edit_root_after_install(manager, &root)? {
                store_entry(manager, &root_target, root);
            }
        }
        Ok(())
    }
}

/// bun add/remove --filter and bun update <name> -r/--filter: edits every selected package.json, then runs one install that links only the selected workspaces.
pub(super) fn update_filtered_workspaces_and_install(
    manager: &mut PackageManager,
    ctx: Command::Context,
    original_cwd: &[u8],
    updates: Vec<UpdateRequest>,
) -> Result<(), Error> {
    if manager.options.global {
        let flag = if manager.options.filter_patterns.is_empty() {
            "--recursive"
        } else {
            "--filter"
        };
        Output::err_generic("{} cannot be used with --global", (flag,));
        Global::crash();
    }

    let targets = select_targets(manager, original_cwd)?;
    if !manager.options.filter_patterns.is_empty() {
        manager.filtered_link_targets = Some(LinkTargets::from_importers(
            targets.iter().map(|target| target.name_hash),
        ));
    }
    add_catalog::prepare(manager, &updates);
    let subcommand = manager.subcommand;
    let is_update = subcommand == Subcommand::Update;
    let update_targets: Option<Box<[UpdateTargetWorkspace]>> = is_update.then(|| {
        targets
            .iter()
            .map(|t| UpdateTargetWorkspace {
                is_root: t.name_hash.is_none(),
                name_hash: t.name_hash.unwrap_or(0),
                name: t.name.clone(),
            })
            .collect()
    });
    let dependency_list: &'static [u8] = manager.options.update.prop;
    let exact_versions = manager.options.enable.exact_versions();
    let catalog_mode = subcommand == Subcommand::Add && manager.options.add_catalog.is_some();
    debug_assert!(manager.root_package_id.id.is_none());

    let root_target = WorkspaceTarget::root();

    let (mut updates, assigned) = if subcommand == Subcommand::Remove {
        (updates, vec![Vec::new(); targets.len()])
    } else {
        assign_requests(manager, original_cwd, updates, &targets)
    };
    let selected_names: Vec<Box<[u8]>> = if subcommand == Subcommand::Remove {
        targets.iter().map(|target| target.name.clone()).collect()
    } else {
        Vec::new()
    };

    let mut changed: Vec<PendingTarget> = Vec::with_capacity(targets.len());
    for (target, wanted) in targets.into_iter().zip(assigned) {
        let mut root = fetch_entry_root(manager, &target);
        let (received, updating) = if subcommand == Subcommand::Remove {
            if !remove_dependencies_from_package_json(&mut root, &updates) {
                continue;
            }
            (Box::default(), StringArrayHashMap::default())
        } else {
            let wanted_len = move_to_front(&mut updates, &wanted);
            reset_e_strings(&mut updates);
            let outer = core::mem::take(&mut manager.updating_packages);
            let mut slice: &mut [UpdateRequest] = &mut updates[..wanted_len];
            let result = add_catalog::edit_target(
                manager,
                &mut slice,
                &mut root,
                dependency_list,
                EditOptions {
                    exact_versions,
                    before_install: true,
                    ..Default::default()
                },
            );
            let kept = slice.len();
            let mine = core::mem::replace(&mut manager.updating_packages, outer);
            result?;
            for (name, info) in mine.iter() {
                let entry = manager.updating_packages.get_or_put(name)?;
                if !entry.found_existing {
                    *entry.value_ptr = PackageUpdateInfo {
                        original_version_literal: info.original_version_literal.clone(),
                        ..Default::default()
                    };
                }
            }
            let received: Box<[PackageNameHash]> = updates[..kept]
                .iter()
                .filter(|r| r.e_string.is_some())
                .map(|r| r.name_hash)
                .collect();
            if received.is_empty() {
                continue;
            }
            (received, mine)
        };
        store_entry(manager, &target, root);
        changed.push(PendingTarget {
            target,
            received,
            updating,
        });
    }
    for pending in &changed {
        package_json_write_back::record(
            manager,
            pending.target.clone(),
            subcommand != Subcommand::Remove,
        );
    }
    if subcommand == Subcommand::Remove && changed.is_empty() {
        if manager.options.log_level != LogLevel::Silent {
            print_nothing_to_remove(ctx.start_time, &updates, &selected_names);
        }
        Global::exit(0);
    }

    if subcommand == Subcommand::Add {
        updates.retain(|r| {
            changed
                .iter()
                .any(|pending| pending.received.contains(&r.name_hash))
        });
    }
    if catalog_mode && !updates.is_empty() {
        let root = fetch_entry_root(manager, &root_target);
        add_catalog::edit_root_before_install(manager, &root)?;
        store_entry(manager, &root_target, root);
        package_json_write_back::record(manager, root_target.clone(), false);
    }

    // The install summary is printed from this workspace's point of view.
    let summary_target = changed
        .iter()
        .find(|pending| pending.received.len() == updates.len())
        .or_else(|| changed.first());
    manager.workspace_name_hash = summary_target.and_then(|pending| pending.target.name_hash);
    manager.to_update = is_update;
    manager.set_update_requests(updates);
    if let Some(update_targets) = update_targets {
        manager.update_target_workspaces = Some(update_targets);
    }
    if subcommand != Subcommand::Remove {
        manager.pending_filtered_write = Some(Box::new(PendingWrite {
            targets: changed,
            catalog_mode,
        }));
    }

    {
        let mut zbuf = path_buffer_pool::get();
        let root_package_json_path = resolve_path::z(&root_target.package_json_path, &mut zbuf);
        install_with_manager(manager, ctx, root_package_json_path, original_cwd)?;
    }
    package_json_write_back::flush(manager)?;
    remove_leftover_node_modules(manager);

    Ok(())
}
