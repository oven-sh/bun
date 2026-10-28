use bun_collections::bit_set::Range as BitRange;
use bun_collections::{DynamicBitSet, index_sort};
use bun_core::{Global, Output};
use bun_install_types::DependencyGroup;
use bun_paths::path_buffer_pool;
use bun_paths::resolve_path::{join_abs_string_buf, platform};

use crate::bun_fs::FileSystem;
use crate::dependency::DependencyExt as _;
use crate::lockfile::override_map::OverrideMap;
use crate::lockfile::package::PackageColumns as _;
use crate::lockfile::{Lockfile, Package};
use crate::resolution::Tag as ResolutionTag;
use crate::{DependencyID, Features, PackageID, PackageNameHash, invalid_package_id};

use super::add_catalog;
use super::add_remove_with_filter::{
    WorkspaceTarget, fetch_entry, fetch_entry_root, store_entry, write_target,
};
use super::options::Do;
use super::package_json_editor::{self as PackageJSONEditor, Declared, EditOptions};
use super::workspace_manifests::same_row;
use super::workspace_package_json_cache::{GetJSONOptions, GetResult, WorkspacePackageJSONCache};
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

/// A package.json whose cache entry a migration edited, and what to report once it's written.
pub(crate) struct MigratedPackageJson {
    target: WorkspaceTarget,
    edits: Vec<&'static str>,
}

/// Commands that load the lockfile twice (`bun update -r`, `bun audit fix`) record an edit twice.
pub(crate) fn record_migrated(
    manager: &mut PackageManager,
    target: WorkspaceTarget,
    edits: Vec<&'static str>,
) {
    let migrated = &mut manager.migrated_package_json_moves;
    let Some(existing) = migrated
        .iter_mut()
        .find(|m| m.target.name_hash == target.name_hash)
    else {
        migrated.push(MigratedPackageJson { target, edits });
        return;
    };
    for edit in edits {
        if !existing.edits.contains(&edit) {
            existing.edits.push(edit);
        }
    }
}

/// Just before the migrated lockfile that depends on them is saved.
pub fn write_migrated(manager: &mut PackageManager) {
    if manager.migrated_package_json_moves.is_empty() {
        return;
    }
    let migrated = core::mem::take(&mut manager.migrated_package_json_moves);
    for file in &migrated {
        if !write_target(manager, &file.target) {
            Global::exit(1);
        }
    }
    if manager.options.log_level.is_silent() {
        return;
    }
    for file in &migrated {
        bun_core::pretty_errorln!(
            "<d>{} in <r><green>{}<r>",
            file.edits.join(", "),
            bstr::BStr::new(FileSystem::instance().relative_to(&file.target.package_json_path)),
        );
    }
}

/// Phase 0, before the lockfile is cleaned. `bun add ./folder` knows the package's name now, and
/// only one dependency can have that name.
pub(crate) fn fold_resolved_positionals(manager: &mut PackageManager) {
    if manager.subcommand != Subcommand::Add
        || manager.options.add_catalog.is_some()
        || manager.update_requests.iter().all(|r| r.is_aliased)
    {
        return;
    }
    let target_list = manager.options.update.prop;
    let move_to_target = PackageJSONEditor::moves_to_target(manager);
    let targets: Vec<WorkspaceTarget> = manager
        .edited_package_jsons
        .iter()
        .filter(|e| e.received_requests)
        .map(|e| e.target.clone())
        .collect();
    let mut dropped: Vec<(PackageID, usize)> = Vec::new();

    for target in &targets {
        let Some(written) = fetch_entry_root(manager, target).as_property(target_list) else {
            continue;
        };
        let requests = &manager.update_requests;
        let lockfile: &mut Lockfile = &mut manager.lockfile;
        let workspace_id = lockfile.get_workspace_package_id(target.name_hash);
        let list = lockfile.packages.items_dependencies()[workspace_id as usize];
        let range = list.off as usize..(list.off + list.len) as usize;

        for (index, request) in requests.iter().enumerate() {
            // An entry that already had this literal took the request, so there is no second row.
            if request.is_aliased || written.expr.as_property(request.get_name()).is_none() {
                continue;
            }
            let buf = lockfile.buffers.string_bytes.as_slice();
            let rows = lockfile.buffers.dependencies.as_slice();
            let Some(positional) = range.clone().find(|&i| {
                request.matches_exactly(&rows[i], buf)
                    && DependencyGroup::prop_for_behavior(rows[i].behavior) == target_list
            }) else {
                continue;
            };
            let name = rows[positional].name.slice(buf);
            // It isn't resolved, or its package.json has no name, which two unrelated packages can
            // have in common.
            if name.is_empty() || name == request.get_name() {
                continue;
            }

            let mut takes_spec: Vec<usize> = Vec::new();
            let mut folded = false;
            for i in range.clone() {
                let declared = &rows[i];
                if i == positional
                    || declared.name_hash != rows[positional].name_hash
                    || declared.name.slice(buf) != name
                    || declared.behavior.is_optional_peer()
                    || declared.behavior.is_workspace()
                {
                    continue;
                }
                // The same command also asked for this package another way (`./a-v1 ./a-v2`).
                if let Some(other) = requests
                    .iter()
                    .enumerate()
                    .position(|(other, r)| other != index && r.matches_exactly(declared, buf))
                {
                    Output::flush();
                    let shown = |request: &UpdateRequest| {
                        bun_core::fmt::redacted(bstr::BStr::new(request.version_buf())).to_string()
                    };
                    Output::err_generic(
                        "{} and {} both resolve to {}",
                        (
                            bun_core::fmt::quote(shown(&requests[other.min(index)]).as_bytes()),
                            bun_core::fmt::quote(shown(&requests[other.max(index)]).as_bytes()),
                            bun_core::fmt::quote(name),
                        ),
                    );
                    bun_core::note!("add only one of them");
                    Global::crash();
                }
                let declared_list = DependencyGroup::prop_for_behavior(declared.behavior);
                match PackageJSONEditor::fate_of_declared(
                    declared_list,
                    target_list,
                    move_to_target,
                ) {
                    Declared::Stays => {}
                    Declared::Removed => dropped.push((workspace_id, i)),
                    Declared::TakesSpec => {
                        takes_spec.push(i);
                        folded |= !move_to_target || declared_list == target_list;
                    }
                }
            }

            for declared in takes_spec {
                let version = lockfile.buffers.dependencies[positional].version.clone();
                lockfile.buffers.dependencies[declared].version = version;
                lockfile.buffers.resolutions[declared] = lockfile.buffers.resolutions[positional];
            }
            if folded {
                dropped.push((workspace_id, positional));
            }
        }
    }

    // Highest index first, because a removal only shifts the dependencies after it.
    index_sort::sort_slice_unstable_by(&mut dropped, |a, b| b.1.cmp(&a.1));
    let lockfile: &mut Lockfile = &mut manager.lockfile;
    for (workspace_id, row) in dropped {
        let list = lockfile.packages.items_dependencies()[workspace_id as usize];
        let range = row..(list.off + list.len) as usize;
        lockfile.buffers.dependencies[range.clone()].rotate_left(1);
        lockfile.buffers.resolutions[range].rotate_left(1);
        lockfile.packages.items_dependencies_mut()[workspace_id as usize].len -= 1;
        lockfile.packages.items_resolutions_mut()[workspace_id as usize].len -= 1;
    }
}

/// How the version strings that `edit_after_resolve` wrote to package.json changed the lockfile.
#[derive(Default)]
pub(crate) struct Synced {
    /// A dependency that had resolved to a registry package now has a version range that matches a
    /// workspace, so it was resolved to that workspace instead.
    pub(crate) links: bool,
}

/// Phase 1, before bun.lock is saved: puts the resolved versions into the in-memory copies of the
/// edited package.json files, which `flush` writes later, and into the lockfile.
#[inline]
pub(crate) fn edit_after_resolve(manager: &mut PackageManager) -> crate::Result<Synced> {
    if manager.pending_filtered_write.is_none()
        && manager.update_target_workspaces.is_none()
        && !manager
            .edited_package_jsons
            .iter()
            .any(|e| e.received_requests)
    {
        return Ok(Synced::default());
    }
    edit_after_resolve_slow(manager)
}

#[inline(never)]
fn edit_after_resolve_slow(manager: &mut PackageManager) -> crate::Result<Synced> {
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
    let top_level = FileSystem::instance().top_level_dir();
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
            PackageJSONEditor::edit_update_entries(
                &manager.lockfile,
                &manager.ast_arena,
                &mut updating,
                target.name_hash,
                update_to_latest,
                &mut ast,
                options,
                &|_, _| true,
            )?;
        }
        store_entry(manager, &target, ast);
        push(edited, target, false);
    }

    if !manager.updating_catalogs.is_empty() {
        let root = WorkspaceTarget::root();
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

    let root = WorkspaceTarget::root();
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
    let resolutions = lockfile.packages.items_resolution();
    let name_hashes = lockfile.packages.items_name_hash();
    let id_of = |hash: PackageNameHash| {
        (0..resolutions.len())
            .find(|&id| resolutions[id].tag == ResolutionTag::Workspace && name_hashes[id] == hash)
            .map_or(invalid_package_id, |id| id as PackageID)
    };
    (edited.iter())
        .map(|e| e.target.name_hash.map_or(0, &id_of))
        .collect()
}

/// The root and every edited member, with its position in `edited`.
fn parse_edited(
    manager: &mut PackageManager,
    scratch: &mut super::workspace_manifests::ScratchManifests,
    edited: &[EditedPackageJson],
) -> crate::Result<Vec<(usize, Package)>> {
    scratch.parse_root(manager, Features::main())?;
    let mut root_pkg = Some(core::mem::take(&mut scratch.root));
    let mut parsed: Vec<(usize, Package)> = Vec::with_capacity(edited.len());
    for (i, e) in edited.iter().enumerate() {
        if e.target.name_hash.is_none() {
            parsed.extend(root_pkg.take().map(|pkg| (i, pkg)));
            continue;
        }
        parsed.push((i, scratch.parse_member(manager, &e.target)?));
    }
    Ok(parsed)
}

/// Copies the edited package.json files' dependency versions, overrides and catalogs into the
/// lockfile, so that the next install finds no difference between the two.
fn sync_lockfile(
    manager: &mut PackageManager,
    edited: &[EditedPackageJson],
) -> crate::Result<Synced> {
    let mut scratch = super::workspace_manifests::ScratchManifests::new();
    let parsed = match parse_edited(manager, &mut scratch, edited) {
        Ok(parsed) => parsed,
        Err(err) => {
            let _ = scratch
                .log
                .print(std::ptr::from_mut(Output::error_writer()));
            return Err(err);
        }
    };
    let super::workspace_manifests::ScratchManifests {
        lockfile: mut scratch,
        log,
        ..
    } = scratch;

    let target_ids = target_package_ids(&manager.lockfile, edited);
    let sbuf = scratch.buffers.string_bytes.as_slice();
    let overrides_changed = {
        let lockfile: &mut Lockfile = &mut manager.lockfile;
        OverrideMap::changed(
            &mut lockfile.overrides,
            lockfile.buffers.string_bytes.as_slice(),
            &mut scratch.overrides,
            sbuf,
        )
    };
    // Explains why an override is gone: the workspaces no longer agree on the literal that its
    // `$name` refers to.
    if overrides_changed && !manager.options.log_level.is_silent() {
        let _ = log.print(std::ptr::from_mut(Output::error_writer()));
    }
    let mut rewritten: Vec<DependencyID> = Vec::new();
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
        rewritten.extend(changed.iter().map(|&(ti, _)| row.off + ti as DependencyID));
    }
    // `steer_used_catalogs_to_latest` ran, also when the root is not edited.
    if manager.options.do_.contains(Do::UPDATE_TO_LATEST)
        && scratch.catalogs.has_any()
        && edited.iter().all(|e| e.target.name_hash.is_some())
    {
        let known = &mut manager.known_npm_aliases;
        let (mut builder, lf) = manager.lockfile.string_builder_split();
        scratch.catalogs.count(sbuf, &mut builder);
        builder.allocate()?;
        *lf.catalogs = scratch.catalogs.clone(known, sbuf, &mut builder)?;
        builder.clamp();
    }
    // A `$name` of the root can name a literal that only a member declares.
    if overrides_changed && edited.iter().all(|e| e.target.name_hash.is_some()) {
        let known = &mut manager.known_npm_aliases;
        let (mut builder, lf) = manager.lockfile.string_builder_split();
        scratch.overrides.count(sbuf, &mut builder);
        builder.allocate()?;
        *lf.overrides = scratch.overrides.clone(known, sbuf, &mut builder)?;
        builder.clamp();
    }
    // An override can decide a rewritten row, so the rows are bound once the overrides are synced.
    let link_workspace_packages = manager.options.link_workspace_packages;
    let mut links = false;
    for row in rewritten {
        links |= (manager.lockfile).bind_workspace_link(row, link_workspace_packages);
    }
    Ok(Synced { links })
}

fn unchanged_on_disk(manager: &mut PackageManager, target: &WorkspaceTarget) -> bool {
    let printed: &[u8] = &fetch_entry(manager, target).source.contents;
    let mut file = WorkspacePackageJSONCache::default();
    let GetResult::Entry(on_disk) = file.get_with_path(
        &mut bun_ast::Log::init(),
        &target.package_json_path,
        GetJSONOptions {
            init_reset_store: false,
            guess_indentation: true,
        },
    ) else {
        return false;
    };
    if *on_disk.source.contents == *printed {
        return true;
    }
    // Printing the file unchanged can already give different bytes. That alone isn't a reason to
    // write it.
    on_disk
        .print(on_disk.root)
        .is_ok_and(|reprinted| *reprinted == *printed)
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
            let mut root = fetch_entry_root(manager, &e.target);
            PackageJSONEditor::edit_trusted_dependencies(&mut root, &mut trusted)?;
            // The new nodes live in the AST store and their strings in `trusted`.
            store_entry(manager, &e.target, root);
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
