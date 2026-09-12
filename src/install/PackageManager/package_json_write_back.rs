use bun_collections::DynamicBitSet;
use bun_collections::bit_set::Range as BitRange;
use bun_core::{Global, strings};
use bun_paths::path_buffer_pool;
use bun_paths::resolve_path::{join_abs_string_buf, platform};
use bun_sys::{Fd, File};

use crate::bun_fs::FileSystem;
use crate::dependency::DependencyExt as _;
use crate::lockfile::package::PackageColumns as _;
use crate::lockfile::{Lockfile, Package};
use crate::resolution::Tag as ResolutionTag;
use crate::{Dependency, PackageID, PackageNameHash, invalid_package_id};

use super::add_catalog;
use super::add_remove_with_filter::{
    WorkspaceTarget, fetch_entry, fetch_entry_root, root_package_json_path, store_entry,
    write_target,
};
use super::options::Do;
use super::package_json_editor::{self as PackageJSONEditor, EditOptions};
use super::update_package_json_and_install::print_package_json_into_cache_entry;
use super::{PackageManager, Subcommand, UpdateRequest};

/// A package.json whose cache entry was re-printed; `target.name_hash == None` is the root.
pub(crate) struct EditedPackageJson {
    pub(crate) target: WorkspaceTarget,
    /// The command's positionals were applied to this file's dependency lists.
    pub(crate) received_requests: bool,
}

fn push(edited: &mut Vec<EditedPackageJson>, target: WorkspaceTarget, received_requests: bool) {
    match edited
        .iter_mut()
        .find(|e| e.target.name_hash == target.name_hash)
    {
        Some(existing) => existing.received_requests |= received_requests,
        None => edited.push(EditedPackageJson {
            target,
            received_requests,
        }),
    }
}

pub(crate) fn record(
    manager: &mut PackageManager,
    target: WorkspaceTarget,
    received_requests: bool,
) {
    push(&mut manager.edited_package_jsons, target, received_requests);
}

fn root_target() -> WorkspaceTarget {
    WorkspaceTarget {
        name: Box::default(),
        name_hash: None,
        package_json_path: root_package_json_path(),
    }
}

/// Phase 1 (before bun.lock is saved): write the resolved versions into the edited package.json entries and re-derive bun.lock's declared columns from them.
#[inline]
pub(crate) fn edit_after_resolve(manager: &mut PackageManager) -> crate::Result<()> {
    if manager.pending_filtered_write.is_none()
        && manager.update_target_workspaces.is_none()
        && !manager
            .edited_package_jsons
            .iter()
            .any(|e| e.received_requests)
    {
        return Ok(());
    }
    edit_after_resolve_slow(manager)
}

#[inline(never)]
fn edit_after_resolve_slow(manager: &mut PackageManager) -> crate::Result<()> {
    let mut edited: Vec<EditedPackageJson> = core::mem::take(&mut manager.edited_package_jsons);
    let mut updates: Box<[UpdateRequest]> = core::mem::take(&mut manager.update_requests);
    let exact = manager.options.enable.exact_versions();
    let cwd = edited.iter().position(|e| e.received_requests);

    let result = if let Some(mut pending) = manager.pending_filtered_write.take() {
        let result = pending.edit_entries(manager, &mut updates);
        manager.pending_filtered_write = Some(pending);
        result
    } else if let Some(targets) = manager.update_target_workspaces.take() {
        let result = edit_update_targets(manager, &targets, &mut edited, exact);
        manager.update_target_workspaces = Some(targets);
        result
    } else if let Some(i) = cwd {
        edit_cwd(manager, &mut edited, i, &mut updates, exact)
    } else {
        Ok(())
    }
    .and_then(|()| sync_lockfile(manager, &edited));

    if result.is_ok() && !updates.is_empty() {
        manager.lockfile.bind_update_requests(
            manager.pending_filtered_write.as_deref(),
            manager.workspace_name_hash,
            &mut updates,
        );
    }
    manager.update_requests = updates;
    manager.edited_package_jsons = edited;
    result
}

/// Bare `bun update -r` / `bun update --filter`: every targeted root/workspace package.json (named requests take the `pending` branch instead).
fn edit_update_targets(
    manager: &mut PackageManager,
    targets: &[super::UpdateTargetWorkspace],
    edited: &mut Vec<EditedPackageJson>,
    exact: bool,
) -> crate::Result<()> {
    let top_level = strings::without_trailing_slash(FileSystem::instance().top_level_dir());
    let mut selected: Vec<WorkspaceTarget> = Vec::new();
    {
        let lockfile: &Lockfile = &manager.lockfile;
        let buf = lockfile.buffers.string_bytes.as_slice();
        let resolutions = lockfile.packages.items_resolution();
        let name_hashes = lockfile.packages.items_name_hash();
        let names = lockfile.packages.items_name();
        let mut path_buf = path_buffer_pool::get();
        for pkg_id in 0..resolutions.len() {
            let res = resolutions[pkg_id];
            let (name_hash, rel): (Option<PackageNameHash>, &[u8]) = match res.tag {
                ResolutionTag::Root => (None, b""),
                ResolutionTag::Workspace => (Some(name_hashes[pkg_id]), res.workspace().slice(buf)),
                _ => continue,
            };
            let name = names[pkg_id].slice(buf);
            if !targets
                .iter()
                .any(|t| t.matches(name_hash.is_none(), name_hashes[pkg_id], name))
            {
                continue;
            }
            selected.push(WorkspaceTarget {
                name: Box::from(name),
                name_hash,
                package_json_path: join_abs_string_buf::<platform::Auto>(
                    top_level,
                    &mut path_buf.0,
                    &[rel, b"package.json"],
                )
                .into(),
            });
        }
    }

    let update_to_latest = manager.options.do_.contains(Do::UPDATE_TO_LATEST);
    for target in selected {
        let mut ast = fetch_entry_root(manager, &target);
        let mut updating = bun_collections::StringArrayHashMap::default();
        for options in [
            EditOptions {
                exact_versions: true,
                before_install: true,
            },
            EditOptions {
                exact_versions: exact,
                ..Default::default()
            },
        ] {
            PackageJSONEditor::edit_update_no_args_in(
                &manager.lockfile,
                &manager.ast_arena,
                &mut updating,
                target.name_hash,
                update_to_latest,
                &mut ast,
                options,
            )?;
        }
        store_entry(manager, &target, ast);
        push(edited, target, false);
    }

    if !manager.updating_catalogs.is_empty() {
        let root = root_target();
        let root_ast = fetch_entry_root(manager, &root);
        if PackageJSONEditor::edit_catalogs_after_update(manager, &root_ast)? {
            store_entry(manager, &root, root_ast);
            push(edited, root, false);
        }
    }
    Ok(())
}

/// `bun add` / `bun update [names]` / `bun link` in the cwd's package.json, plus the root when its catalogs changed.
fn edit_cwd(
    manager: &mut PackageManager,
    edited: &mut Vec<EditedPackageJson>,
    cwd_index: usize,
    updates: &mut [UpdateRequest],
    exact: bool,
) -> crate::Result<()> {
    let cwd_target = edited[cwd_index].target.clone();
    let in_root = cwd_target.name_hash.is_none();
    let options = EditOptions {
        exact_versions: exact,
        ..Default::default()
    };
    let mut ast = fetch_entry_root(manager, &cwd_target);
    if updates.is_empty() {
        if manager.subcommand == Subcommand::Update {
            PackageJSONEditor::edit_update_no_args(manager, &mut ast, options)?;
        }
        if in_root && !manager.updating_catalogs.is_empty() {
            PackageJSONEditor::edit_catalogs_after_update(manager, &ast)?;
        }
    } else {
        let dependency_list: &'static [u8] = manager.options.update.prop;
        let mut slice: &mut [UpdateRequest] = &mut updates[..];
        add_catalog::edit_target(manager, &mut slice, &mut ast, dependency_list, options)?;
    }
    let catalog_mode = manager.options.add_catalog.is_some();
    if catalog_mode && in_root {
        add_catalog::edit_root_after_install(manager, &ast)?;
    }
    store_entry(manager, &cwd_target, ast);
    if in_root {
        return Ok(());
    }

    let root = root_target();
    let root_ast = fetch_entry_root(manager, &root);
    let mut changed = catalog_mode && !updates.is_empty();
    if !manager.updating_catalogs.is_empty() {
        changed |= PackageJSONEditor::edit_catalogs_after_update(manager, &root_ast)?;
    }
    if catalog_mode {
        add_catalog::edit_root_after_install(manager, &root_ast)?;
    }
    if changed {
        store_entry(manager, &root, root_ast);
        push(edited, root, false);
    }
    Ok(())
}

/// Package id of each edited file's row in `lockfile` (`invalid_package_id` when the workspace has none).
fn target_package_ids(lockfile: &Lockfile, edited: &[EditedPackageJson]) -> Vec<PackageID> {
    let mut ids = vec![invalid_package_id; edited.len()];
    for (i, e) in edited.iter().enumerate() {
        if e.target.name_hash.is_none() {
            ids[i] = 0;
        }
    }
    let resolutions = lockfile.packages.items_resolution();
    let name_hashes = lockfile.packages.items_name_hash();
    for pkg_id in 0..resolutions.len() {
        if resolutions[pkg_id].tag != ResolutionTag::Workspace {
            continue;
        }
        for (i, e) in edited.iter().enumerate() {
            if ids[i] == invalid_package_id && e.target.name_hash == Some(name_hashes[pkg_id]) {
                ids[i] = pkg_id as PackageID;
            }
        }
    }
    ids
}

/// Re-parses the edited files the way `bun install` would and copies every declared literal that differs (and, for the root, `overrides` + `catalogs`) into `manager.lockfile`, so the next install's differ sees no change.
fn sync_lockfile(manager: &mut PackageManager, edited: &[EditedPackageJson]) -> crate::Result<()> {
    let mut scratch = super::workspace_manifests::ScratchManifests::new();
    scratch.parse_root(manager)?;
    let mut root_pkg = Some(core::mem::take(&mut scratch.root));
    let mut parsed: Vec<(usize, Package)> = Vec::with_capacity(edited.len());
    for (i, e) in edited.iter().enumerate() {
        if e.target.name_hash.is_none() {
            parsed.extend(root_pkg.take().map(|pkg| (i, pkg)));
            continue;
        }
        parsed.push((i, scratch.parse_member(manager, &e.target)?));
    }
    let super::workspace_manifests::ScratchManifests {
        lockfile: scratch, ..
    } = scratch;

    let target_ids = target_package_ids(&manager.lockfile, edited);
    let sbuf = scratch.buffers.string_bytes.as_slice();
    for (i, pkg) in &parsed {
        let target_id = target_ids[*i];
        if target_id == invalid_package_id {
            continue;
        }
        let is_root = edited[*i].target.name_hash.is_none();
        let row = manager.lockfile.packages.items_dependencies()[target_id as usize];
        let scratch_deps = pkg
            .dependencies
            .get(scratch.buffers.dependencies.as_slice());

        let changed: Vec<(usize, usize)> = {
            let lbuf = manager.lockfile.buffers.string_bytes.as_slice();
            let row_deps = row.get(manager.lockfile.buffers.dependencies.as_slice());
            // Zero-length while every scratch dep so far matched the row at its own index.
            let mut claimed = DynamicBitSet::default();
            let mut changed = Vec::new();
            for (si, s) in scratch_deps.iter().enumerate() {
                let same_index = si < row_deps.len()
                    && !claimed.is_set_allow_out_of_bound(si, false)
                    && same_row(s, &row_deps[si]);
                let ti = if same_index {
                    if si < claimed.bit_length() {
                        claimed.set(si);
                    }
                    si
                } else {
                    if claimed.bit_length() == 0 && !row_deps.is_empty() {
                        claimed = DynamicBitSet::init_empty(row_deps.len())?;
                        claimed.set_range_value(
                            BitRange {
                                start: 0,
                                end: si.min(row_deps.len()),
                            },
                            true,
                        );
                    }
                    let Some(ti) = (0..row_deps.len())
                        .find(|&ti| !claimed.is_set(ti) && same_row(s, &row_deps[ti]))
                    else {
                        continue;
                    };
                    claimed.set(ti);
                    ti
                };
                if row_deps[ti].version.literal.slice(lbuf) != s.version.literal.slice(sbuf) {
                    changed.push((ti, si));
                }
            }
            changed
        };

        let sync_maps = is_root
            && (!scratch.overrides.is_empty()
                || scratch.catalogs.has_any()
                || !manager.lockfile.overrides.is_empty()
                || manager.lockfile.catalogs.has_any());
        if changed.is_empty() && !sync_maps {
            continue;
        }

        let known = &mut manager.known_npm_aliases;
        let (mut builder, lf) = manager.lockfile.string_builder_split();
        for &(_, si) in &changed {
            scratch_deps[si].count(sbuf, &mut builder);
        }
        if sync_maps {
            scratch.overrides.count(sbuf, &mut builder);
            scratch.catalogs.count(sbuf, &mut builder);
        }
        builder.allocate()?;
        let rows = row.mut_(lf.dependencies.as_mut_slice());
        for &(ti, si) in &changed {
            rows[ti] = scratch_deps[si].clone_in(known, sbuf, &mut builder)?;
        }
        if sync_maps {
            *lf.overrides = scratch.overrides.clone(known, sbuf, &mut builder)?;
            *lf.catalogs = scratch.catalogs.clone(known, sbuf, &mut builder)?;
        }
        builder.clamp();
    }
    Ok(())
}

fn same_row(scratch: &Dependency, row: &Dependency) -> bool {
    row.name_hash == scratch.name_hash && row.behavior == scratch.behavior
}

/// Compared against the file, not `stale_contents`: the before-install print in `update_package_json_and_install` replaces the cwd entry's contents without recording them.
fn unchanged_on_disk(manager: &mut PackageManager, target: &WorkspaceTarget) -> bool {
    let printed: &[u8] = &fetch_entry(manager, target).source.contents;
    File::read_from(Fd::cwd(), &target.package_json_path).is_ok_and(|on_disk| on_disk == printed)
}

/// Phase 2 (after bun.lock is saved): add `trustedDependencies` learned during the install and write every edited entry whose bytes differ from disk.
pub(crate) fn flush(manager: &mut PackageManager) -> Result<(), crate::Error> {
    if manager.edited_package_jsons.is_empty()
        || !manager.options.do_.contains(Do::WRITE_PACKAGE_JSON)
    {
        return Ok(());
    }
    let edited = core::mem::take(&mut manager.edited_package_jsons);
    let mut trusted: Vec<Box<[u8]>> = if manager
        .options
        .do_
        .contains(Do::TRUST_DEPENDENCIES_FROM_ARGS)
    {
        core::mem::take(&mut manager.trusted_deps_to_add_to_package_json)
    } else {
        Vec::new()
    };

    let mut any_failed = false;
    for e in &edited {
        if e.received_requests && !trusted.is_empty() {
            let entry = fetch_entry(manager, &e.target);
            let mut root = entry.root;
            PackageJSONEditor::edit_trusted_dependencies(&mut root, &mut trusted)?;
            print_package_json_into_cache_entry(entry, root);
        }
        if unchanged_on_disk(manager, &e.target) {
            continue;
        }
        if write_target(manager, &e.target) {
            manager.wrote_package_json = true;
        } else {
            any_failed = true;
        }
    }
    if any_failed {
        Global::exit(1);
    }
    Ok(())
}
