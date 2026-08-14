use bstr::BStr;

use crate::Error;
use crate::bun_fs::FileSystem;
use crate::lockfile_real::package::value_loc_of;
use crate::lockfile_real::package::workspace_map::{NamesArray, WorkspaceMap};
use bun_core::{Global, Output, strings};
use bun_install::dependency;
use bun_install::{Lockfile, PackageID, PackageNameHash};
use bun_paths::path_buffer_pool;
use bun_paths::resolve_path::{self, Platform, join_abs_string_buf, platform};
use bun_sys::{Fd, File};

use super::add_catalog;
use super::install_with_manager::install_with_manager;
use super::options::Do;
use super::package_json_editor::{self as PackageJSONEditor, EditOptions};
use super::update_package_json_and_install::{
    print_package_json_into_cache_entry, remove_dependencies_from_package_json,
    remove_leftover_node_modules,
};
use super::workspace_package_json_cache::{GetJSONOptions, GetResult, MapEntry};
use super::{Command, PackageManager, Subcommand, UpdateRequest, WorkspaceFilter};

pub(crate) struct WorkspaceTarget {
    pub(crate) name: Box<[u8]>,
    /// `None` = the workspace root.
    pub(crate) name_hash: Option<PackageNameHash>,
    pub(crate) package_json_path: Box<[u8]>,
}

fn root_package_json_path() -> Box<[u8]> {
    let top_level = strings::without_trailing_slash(FileSystem::instance().top_level_dir());
    let mut buf = path_buffer_pool::get();
    let path: Box<[u8]> =
        join_abs_string_buf::<platform::Auto>(top_level, &mut buf.0, &[b"package.json"]).into();
    path
}

fn print_log_and_crash(
    manager: &PackageManager,
    fmt: &str,
    args: impl bun_core::output::FmtTuple,
) -> ! {
    let _ = manager
        .log_mut()
        .print(std::ptr::from_mut(Output::error_writer()));
    Output::err_generic(fmt, args);
    Global::crash();
}

pub(crate) fn select_targets(
    manager: &mut PackageManager,
    original_cwd: &[u8],
) -> Result<Vec<WorkspaceTarget>, Error> {
    debug_assert!(!manager.options.filter_patterns.is_empty());
    let top_level = strings::without_trailing_slash(FileSystem::instance().top_level_dir());
    let root_path = root_package_json_path();

    let (root_expr, root_source, root_name): (bun_ast::Expr, bun_ast::Source, Box<[u8]>) = {
        let log = manager.log_mut();
        match manager.workspace_package_json_cache.get_with_path(
            log,
            &root_path,
            GetJSONOptions {
                guess_indentation: true,
                ..Default::default()
            },
        ) {
            GetResult::Entry(entry) => {
                let name_expr = entry.root.get(b"name");
                let name: Box<[u8]> = name_expr
                    .as_ref()
                    .and_then(|e| e.as_utf8_string_literal())
                    .unwrap_or(b"")
                    .into();
                (entry.root, entry.source.clone(), name)
            }
            GetResult::ParseErr(err) => print_log_and_crash(
                manager,
                "failed to parse package.json \"{}\": {}",
                (BStr::new(&root_path), err.name()),
            ),
            GetResult::ReadErr(err) => {
                Output::err_generic(
                    "failed to read package.json \"{}\": {}",
                    (BStr::new(&root_path), err.name()),
                );
                Global::crash();
            }
        }
    };

    let mut members = WorkspaceMap::init();
    let workspaces = root_expr.as_property(b"workspaces");
    let packages = workspaces
        .as_ref()
        .filter(|q| !q.expr.is_array())
        .and_then(|q| q.expr.as_property(b"packages"));
    let names: Option<(NamesArray<'_>, bun_ast::Loc)> = match (&workspaces, &packages) {
        (Some(q), _) if q.expr.is_array() => Some((
            NamesArray::from_expr(&q.expr, value_loc_of(&root_source, q.loc))
                .expect("is_array was checked above"),
            q.loc,
        )),
        (Some(_), Some(p)) if p.expr.is_array() => Some((
            NamesArray::from_expr(&p.expr, value_loc_of(&root_source, p.loc))
                .expect("is_array was checked above"),
            p.loc,
        )),
        _ => None,
    };
    if let Some((arr, loc)) = names {
        let log = manager.log_mut();
        if let Err(err) = members.process_names_array(
            &mut manager.workspace_package_json_cache,
            log,
            arr,
            &root_source,
            loc,
            None,
            false,
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
    }

    let mut path_buf = path_buffer_pool::get();
    let patterns = manager.options.filter_patterns;
    let filters: Vec<WorkspaceFilter> = patterns
        .iter()
        .map(|pattern| {
            bun_core::handle_oom(WorkspaceFilter::init(
                pattern,
                original_cwd,
                &mut path_buf.0,
            ))
        })
        .collect();

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

    let unmatched: Vec<&[u8]> = filters
        .iter()
        .zip(patterns)
        .filter(|(filter, _)| {
            let negated = match filter {
                WorkspaceFilter::All => return false,
                WorkspaceFilter::Name(p) | WorkspaceFilter::Path(p) => p.first() == Some(&b'!'),
            };
            !negated
                && !candidates.iter().any(|(target, subject)| {
                    WorkspaceFilter::matches_any(
                        core::slice::from_ref(filter),
                        &target.name,
                        subject,
                    )
                })
        })
        .map(|(_, pattern)| *pattern)
        .collect();

    let targets: Vec<WorkspaceTarget> = candidates
        .into_iter()
        .filter(|(target, subject)| WorkspaceFilter::matches_any(&filters, &target.name, subject))
        .map(|(target, _)| target)
        .collect();

    if targets.is_empty() {
        Output::err_generic(
            "No workspace packages matched the filter {}",
            (BStr::new(&quote_patterns(patterns)),),
        );
        Global::crash();
    }
    if !unmatched.is_empty() {
        bun_core::pretty_errorln!(
            "<r><yellow>warn<r><d>:<r> No workspace packages matched the filter {}",
            BStr::new(&quote_patterns(&unmatched)),
        );
    }

    Ok(targets)
}

fn quote_patterns(patterns: &[&[u8]]) -> Vec<u8> {
    let mut out = Vec::new();
    for (i, pattern) in patterns.iter().enumerate() {
        if i > 0 {
            out.extend_from_slice(b", ");
        }
        out.push(b'"');
        out.extend_from_slice(pattern);
        out.push(b'"');
    }
    out
}

fn fetch_entry<'a>(manager: &'a mut PackageManager, target: &WorkspaceTarget) -> &'a mut MapEntry {
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

fn fetch_entry_root(manager: &mut PackageManager, target: &WorkspaceTarget) -> bun_ast::Expr {
    fetch_entry(manager, target).root
}

fn store_entry(
    manager: &mut PackageManager,
    target: &WorkspaceTarget,
    root: bun_ast::Expr,
    reparse: bool,
) {
    let log = manager.log_mut();
    let entry = fetch_entry(manager, target);
    print_package_json_into_cache_entry(entry, root);
    if reparse {
        if let Err(err) = entry.reparse_root(log) {
            bun_core::pretty_errorln!("package.json failed to parse due to error {}", err.name());
            Global::crash();
        }
    }
}

fn write_target(manager: &mut PackageManager, target: &WorkspaceTarget) -> bool {
    let entry = fetch_entry(manager, target);
    let mut zbuf = path_buffer_pool::get();
    let path = resolve_path::z(&target.package_json_path, &mut zbuf);
    match File::write_file(Fd::cwd(), path, &entry.source.contents) {
        Ok(()) => true,
        Err(err) => {
            Output::err_generic(
                "failed to write package.json for workspace '{}': {}",
                (BStr::new(&target.name), BStr::new(err.name())),
            );
            false
        }
    }
}

fn reset_e_strings(updates: &mut [UpdateRequest]) {
    // `e_string` points into the previous target's AST; `edit` skips requests that already have one.
    for request in updates.iter_mut() {
        request.e_string = None;
    }
}

/// Moves the requests in `wanted` to the front, preserving order; returns how many there are.
fn move_to_front(updates: &mut [UpdateRequest], wanted: &[PackageNameHash]) -> usize {
    updates.sort_by_key(|request| !wanted.contains(&request.name_hash));
    updates
        .iter()
        .take_while(|request| wanted.contains(&request.name_hash))
        .count()
}

/// The `(prefix, path)` of a positional naming a local path, which is relative to the invoking cwd.
fn local_relative_path(request: &UpdateRequest) -> Option<(&'static [u8], &[u8])> {
    let literal = request.version.literal.slice(request.version_buf());
    let (prefix, path): (&'static [u8], &[u8]) = match request.version.tag {
        dependency::Tag::Folder | dependency::Tag::Tarball => {
            match literal.strip_prefix(b"file:") {
                Some(path) => (b"file:", path),
                None => (b"", literal),
            }
        }
        dependency::Tag::Symlink => (b"link:", literal.strip_prefix(b"link:")?),
        _ => return None,
    };
    let is_path = path.starts_with(b".")
        || (prefix != b"link:" && !path.is_empty() && !strings::contains(path, b"://"));
    (is_path && !path.starts_with(b"//") && !Platform::AUTO.is_absolute(path))
        .then_some((prefix, path))
}

fn spell_relative_to(
    target: &WorkspaceTarget,
    request: &UpdateRequest,
    prefix: &[u8],
    abs: &[u8],
) -> Vec<u8> {
    let mut buf = path_buffer_pool::get();
    let target_dir = resolve_path::dirname::<platform::Auto>(&target.package_json_path);
    let rel =
        resolve_path::relative_platform_buf::<platform::Auto, true>(&mut buf.0, target_dir, abs);
    let mut positional = Vec::with_capacity(request.name.len() + prefix.len() + rel.len() + 3);
    if request.is_aliased {
        positional.extend_from_slice(request.name);
        positional.push(b'@');
    }
    positional.extend_from_slice(prefix);
    let path_start = positional.len();
    let escapes =
        rel.starts_with(b"..") && rel.get(2).is_none_or(|&c| Platform::AUTO.is_separator(c));
    if !escapes {
        positional.extend_from_slice(b"./");
    }
    positional.extend_from_slice(rel);
    resolve_path::platform_to_posix_in_place(&mut positional[path_start..]);
    positional
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
        let abs: Box<[u8]> =
            join_abs_string_buf::<platform::Auto>(original_cwd, &mut buf.0, &[path]).into();
        slots.push(Slot::PerTarget(
            targets
                .iter()
                .map(|target| spell_relative_to(target, &request, prefix, &abs))
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

/// The targets whose package.json changed and, for `add`, the requests each one received.
pub(crate) struct PendingWrite {
    targets: Vec<(WorkspaceTarget, Box<[PackageNameHash]>)>,
    subcommand: Subcommand,
    catalog_mode: bool,
    root_target: WorkspaceTarget,
}

/// Runs once: from `install_with_manager` right after the lockfile is saved, else after it returns.
pub(crate) fn flush_pending_write(manager: &mut PackageManager) -> Result<(), Error> {
    let Some(pending) = manager.pending_filtered_write.take() else {
        return Ok(());
    };
    if !manager.options.do_.contains(Do::WRITE_PACKAGE_JSON) {
        return Ok(());
    }
    let mut updates: Box<[UpdateRequest]> = core::mem::take(&mut manager.update_requests);
    let result = pending.write(manager, &mut updates);
    manager.update_requests = updates;
    result
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
            .filter(|(_, received)| received.contains(&request))
            .filter_map(|(target, _)| {
                let id = lockfile.get_workspace_package_id(target.name_hash);
                (target.name_hash.is_none() || id != 0).then_some(id)
            })
            .collect()
    }

    fn write(
        &self,
        manager: &mut PackageManager,
        updates: &mut [UpdateRequest],
    ) -> Result<(), Error> {
        let mut any_failed = false;
        if self.subcommand == Subcommand::Remove {
            for (target, _) in &self.targets {
                any_failed |= !write_target(manager, target);
            }
            if any_failed {
                Global::exit(1);
            }
            return Ok(());
        }

        let dependency_list: &'static [u8] = manager.options.update.prop;
        let exact_versions = manager.options.enable.exact_versions();
        let add_trusted_dependencies = manager
            .options
            .do_
            .contains(Do::TRUST_DEPENDENCIES_FROM_ARGS);
        let trusted_snapshot = manager.trusted_deps_to_add_to_package_json.clone();
        let summary_order: Vec<PackageNameHash> = updates.iter().map(|r| r.name_hash).collect();

        for (target, received) in &self.targets {
            let kept = move_to_front(updates, received);
            manager.trusted_deps_to_add_to_package_json = trusted_snapshot.clone();
            let mut root = fetch_entry_root(manager, target);
            reset_e_strings(updates);
            let mut slice: &mut [UpdateRequest] = &mut updates[..kept];
            PackageJSONEditor::edit(
                manager,
                &mut slice,
                &mut root,
                dependency_list,
                EditOptions {
                    exact_versions,
                    add_trusted_dependencies,
                    ..Default::default()
                },
            )?;
            if self.catalog_mode {
                add_catalog::rewrite_references(manager, &updates[..kept]);
            }
            let is_catalog_root = self.catalog_mode && target.name_hash.is_none();
            store_entry(manager, target, root, is_catalog_root);
            if !is_catalog_root {
                any_failed |= !write_target(manager, target);
            }
        }
        updates.sort_by_key(|r| summary_order.iter().position(|&h| h == r.name_hash));
        if any_failed {
            Global::exit(1);
        }
        if self.catalog_mode {
            let mut zbuf = path_buffer_pool::get();
            let root_package_json_path =
                resolve_path::z(&self.root_target.package_json_path, &mut zbuf);
            add_catalog::write_root_after_install(manager, root_package_json_path, updates)?;
        }
        Ok(())
    }
}

pub(super) fn update_filtered_workspaces_and_install(
    manager: &mut PackageManager,
    ctx: Command::Context,
    original_cwd: &[u8],
    updates: Vec<UpdateRequest>,
) -> Result<(), Error> {
    if manager.options.global {
        Output::err_generic("--filter cannot be used with --global", ());
        Global::crash();
    }

    let targets = select_targets(manager, original_cwd)?;
    let subcommand = manager.subcommand;
    let dependency_list: &'static [u8] = manager.options.update.prop;
    let exact_versions = manager.options.enable.exact_versions();
    let catalog_mode = subcommand == Subcommand::Add && manager.options.add_catalog.is_some();
    debug_assert!(manager.root_package_id.id.is_none());

    let root_package_json_path = root_package_json_path();
    let root_target = WorkspaceTarget {
        name: Box::default(),
        name_hash: None,
        package_json_path: root_package_json_path.clone(),
    };

    let (mut updates, assigned) = if subcommand == Subcommand::Remove {
        (updates, vec![Vec::new(); targets.len()])
    } else {
        assign_requests(manager, original_cwd, updates, &targets)
    };

    let mut changed: Vec<(WorkspaceTarget, Box<[PackageNameHash]>)> =
        Vec::with_capacity(targets.len());
    for (target, wanted) in targets.into_iter().zip(assigned) {
        let mut root = fetch_entry_root(manager, &target);
        let received: Box<[PackageNameHash]> = if subcommand == Subcommand::Remove {
            if !remove_dependencies_from_package_json(&mut root, &updates) {
                continue;
            }
            Box::default()
        } else {
            let wanted_len = move_to_front(&mut updates, &wanted);
            reset_e_strings(&mut updates);
            let mut slice: &mut [UpdateRequest] = &mut updates[..wanted_len];
            PackageJSONEditor::edit(
                manager,
                &mut slice,
                &mut root,
                dependency_list,
                EditOptions {
                    exact_versions,
                    before_install: true,
                    ..Default::default()
                },
            )?;
            let kept = slice.len();
            if kept == 0 {
                continue;
            }
            if catalog_mode {
                add_catalog::rewrite_references(manager, &updates[..kept]);
            }
            updates[..kept].iter().map(|r| r.name_hash).collect()
        };
        store_entry(manager, &target, root, true);
        changed.push((target, received));
    }
    let any_changed = !changed.is_empty();

    if subcommand != Subcommand::Remove {
        updates.retain(|r| {
            changed
                .iter()
                .any(|(_, received)| received.contains(&r.name_hash))
        });
    }
    if catalog_mode {
        let root = fetch_entry_root(manager, &root_target);
        add_catalog::edit_root_before_install(manager, &root, &updates)?;
        store_entry(manager, &root_target, root, true);
    }

    // The install summary is printed from this workspace's point of view.
    let summary_target = changed
        .iter()
        .find(|(_, received)| received.len() == updates.len())
        .or(changed.first());
    manager.workspace_name_hash = summary_target.and_then(|(target, _)| target.name_hash);
    manager.to_update = false;
    manager.update_requests = updates.into_boxed_slice();
    manager.pending_filtered_write = Some(Box::new(PendingWrite {
        targets: changed,
        subcommand,
        catalog_mode,
        root_target,
    }));

    {
        let mut zbuf = path_buffer_pool::get();
        let root_package_json_path = resolve_path::z(&root_package_json_path, &mut zbuf);
        install_with_manager(manager, ctx, root_package_json_path, original_cwd)?;
    }
    flush_pending_write(manager)?;

    if subcommand == Subcommand::Remove && manager.options.do_.contains(Do::WRITE_PACKAGE_JSON) {
        if !any_changed {
            Global::exit(0);
        }
        let updates: Box<[UpdateRequest]> = core::mem::take(&mut manager.update_requests);
        remove_leftover_node_modules(manager, &updates);
    }

    Ok(())
}
