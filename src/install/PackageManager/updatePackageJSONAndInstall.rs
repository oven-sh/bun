use crate::lockfile::package::PackageColumns as _;
use bun_collections::VecExt;
use core::fmt;
use std::borrow::Cow;

use bstr::BStr;

use crate::Error;
use crate::ShellCompletions;
use crate::bun_fs::FileSystem;
use bun_core::{Global, Output};
use bun_core::{ZStr, strings};
use bun_js_printer as js_printer;

use super::add_catalog;
use super::add_remove_with_filter::{WorkspaceTarget, fetch_entry_root, store_entry};
use super::command_line_arguments::CommandLineArguments;
use super::package_json_editor as PackageJSONEditor;
use super::update_request::Array as UpdateRequestArray;
use super::workspace_selection;
use super::{
    Command, PackageManager, PatchCommitResult, Subcommand, UpdateRequest,
    attempt_to_create_package_json, install_with_manager, patch_package,
};

pub(crate) fn print_package_json_into_cache_entry(entry: &mut MapEntry, root: bun_ast::Expr) {
    let preserve_trailing_newline = entry.source.contents.last() == Some(&b'\n');
    let mut buffer_writer = js_printer::BufferWriter::init();
    buffer_writer
        .buffer
        .list
        .reserve((entry.source.contents.len() + 1).saturating_sub(buffer_writer.buffer.list.len()));
    buffer_writer.append_newline = preserve_trailing_newline;
    let mut writer = js_printer::BufferPrinter::init(buffer_writer);

    if let Err(e) = js_printer::print_json(
        &mut writer,
        root,
        &entry.source,
        js_printer::PrintJsonOptions {
            indent: entry.indentation,
            mangled_props: None,
            ..Default::default()
        },
    ) {
        bun_core::pretty_errorln!("package.json failed to write due to error {}", e.name(),);
        Global::crash();
    }
    let old = core::mem::replace(
        &mut entry.source.contents,
        Cow::Owned(writer.ctx.written_without_trailing_zero().to_vec()),
    );
    entry.stale_contents.push(old);
}

pub(super) fn remove_dependencies_from_package_json(
    package_json: &mut bun_ast::Expr,
    updates: &[UpdateRequest],
) -> bool {
    let mut any_changes = false;
    for request in updates.iter() {
        for list in DependencyGroup::FOUR {
            any_changes |= PackageJSONEditor::remove_entry(package_json, list.prop, request.name);
        }
    }
    any_changes
}

pub(super) fn package_json_entry_or_crash<'a>(
    manager: &'a mut PackageManager,
    path: &[u8],
) -> &'a mut MapEntry {
    let log = manager.log_mut();
    let (verb, err) = match manager.workspace_package_json_cache.get_with_path(
        &mut *log,
        path,
        GetJSONOptions {
            guess_indentation: true,
            ..Default::default()
        },
    ) {
        GetResult::Entry(entry) => return entry,
        GetResult::ParseErr(err) => {
            let _ = log.print(std::ptr::from_mut(Output::error_writer()));
            ("parse", err)
        }
        GetResult::ReadErr(err) => ("read", err),
    };
    Output::err_generic(
        "failed to {s} package.json \"{s}\": {s}",
        (verb, BStr::new(path), err.name()),
    );
    Global::crash();
}

pub fn update_package_json_and_install_with_manager(
    manager: &mut PackageManager,
    ctx: Command::Context,
    original_cwd: &[u8],
) -> Result<(), Error> {
    let subcommand = manager.subcommand;
    if manager.options.positionals.len() <= 1
        && matches!(subcommand, Subcommand::Add | Subcommand::Remove)
    {
        Output::err_generic(
            "no package specified to {s}",
            (<&'static str>::from(subcommand),),
        );
        Output::flush();
        CommandLineArguments::print_help(subcommand);

        Global::exit(0);
    }

    let mut update_requests = UpdateRequestArray::with_capacity(64);
    if subcommand != Subcommand::PatchCommit && subcommand != Subcommand::Patch {
        // `&'static`, so the sub-slice does not borrow `*manager`.
        let positionals: &'static [&'static [u8]] = &manager.options.positionals[1..];
        UpdateRequest::parse(
            // `dependency::parse_with_tag` is the only consumer of `pm`; it inserts
            // into `pm.known_npm_aliases` for `npm:`-aliased positionals.
            Some(manager),
            // SAFETY: `ctx.log` is set once during `Command::create()` (process-
            // lifetime singleton) and is never null afterward.
            unsafe { &mut *ctx.log },
            positionals,
            &mut update_requests,
            subcommand,
        );
    }
    update_package_json_and_install_with_manager_with_updates(
        manager,
        ctx,
        update_requests,
        subcommand,
        original_cwd,
    )?;

    // `bun patch` prepares the patch first, and its caller exits.
    if manager.any_failed_to_install
        && !matches!(manager.options.patch_features, PatchFeatures::Patch)
    {
        Global::exit(1);
    }
    Ok(())
}

fn update_package_json_and_install_with_manager_with_updates(
    manager: &mut PackageManager,
    ctx: Command::Context,
    // reshaped for borrowck — taking by
    // value lets us hand ownership to `manager.update_requests` (typed
    // `Box<[UpdateRequest]>`) and re-borrow afterwards without
    // aliasing `&mut manager`.
    mut updates: Vec<UpdateRequest>,
    subcommand: Subcommand,
    original_cwd: &[u8],
) -> Result<(), Error> {
    let log_level = manager.options.log_level;
    if manager.log_mut().errors > 0 {
        let _ = manager
            .log_mut()
            .print(std::ptr::from_mut(Output::error_writer()));
        Global::crash();
    }

    if (matches!(subcommand, Subcommand::Add | Subcommand::Remove)
        && !manager.options.filter_patterns.is_empty())
        || (subcommand == Subcommand::Update
            && !updates.is_empty()
            && (manager.options.do_.recursive() || !manager.options.filter_patterns.is_empty()))
    {
        return super::add_remove_with_filter::update_filtered_workspaces_and_install(
            manager,
            ctx,
            original_cwd,
            updates,
        );
    }

    if subcommand == Subcommand::Update
        && updates.is_empty()
        && (manager.options.do_.recursive() || !manager.options.filter_patterns.is_empty())
        && manager.options.do_.load_lockfile()
    {
        manager.load_lockfile_from_cwd_or_exit::<true>("nothing to update");
        let filter_patterns = manager.options.filter_patterns;
        let workspace_selection::LockfileSelection {
            ids: selected,
            unmatched_patterns,
        } = workspace_selection::select_lockfile_workspaces(
            &manager.lockfile,
            filter_patterns,
            original_cwd,
            workspace_selection::RootSelection::Implicit,
        );
        if selected.is_empty() && !filter_patterns.is_empty() {
            if log_level == LogLevel::Silent {
                Global::crash();
            }
            workspace_selection::error_unmatched(filter_patterns);
        }
        workspace_selection::warn_unmatched(filter_patterns, &unmatched_patterns);
        let name_hashes = manager.lockfile.packages.items_name_hash();
        let names = manager.lockfile.packages.items_name();
        let resolutions = manager.lockfile.packages.items_resolution();
        let sbuf = manager.lockfile.buffers.string_bytes.as_slice();
        manager.update_target_workspaces = Some(
            selected
                .iter()
                .map(|&id| super::UpdateTargetWorkspace {
                    is_root: resolutions[id as usize].tag == crate::resolution::Tag::Root,
                    name_hash: name_hashes[id as usize],
                    name: Box::from(names[id as usize].slice(sbuf)),
                })
                .collect(),
        );
        if !filter_patterns.is_empty() {
            manager.filtered_link_targets = Some(workspace_selection::LinkTargets::from_importers(
                selected.iter().map(|&id| {
                    (resolutions[id as usize].tag != crate::resolution::Tag::Root)
                        .then(|| name_hashes[id as usize])
                }),
            ));
        }
    }

    add_catalog::prepare(manager, &updates);

    // `bun update <path>` is excluded, because its error message suggests running `bun add <path>`
    // from the cwd.
    if subcommand == Subcommand::Add {
        updates =
            super::add_remove_with_filter::respell_local_paths(manager, original_cwd, updates);
    }

    // This has to come before the entry is read, because migrating a lockfile rewrites the cached
    // root package.json.
    let patch_commit: Option<PatchCommitResult> =
        if matches!(manager.options.patch_features, PatchFeatures::Commit { .. }) {
            patch_package::do_patch_commit(manager, log_level)?
        } else {
            None
        };

    // reshaped for borrowck — the `&mut MapEntry` is
    // borrowed from `manager.workspace_package_json_cache`, but we then need
    // `&mut *manager` for `PackageJSONEditor::edit` while still
    // holding the entry. Demote to `*mut MapEntry` and re-
    // borrow at point of use. The cache map is not mutated again until the
    // next `get_with_path` call below, so the pointer remains valid.
    let original_package_json_path: Box<[u8]> =
        manager.original_package_json_path.as_bytes().into();
    let current_package_json_ptr: *mut MapEntry =
        package_json_entry_or_crash(manager, &original_package_json_path);
    // SAFETY: see note above — pointer into `manager.workspace_package_json_cache`,
    // valid until the next `get_with_path`. No `&mut manager.workspace_package_json_cache`
    // is taken across this borrow; `PackageJSONEditor` touches only disjoint manager fields.
    let current_package_json: &mut MapEntry = unsafe { &mut *current_package_json_ptr };
    // `bun add` and `bun link` put their dependency into the empty file.
    if current_package_json.source.contents.is_empty()
        && !matches!(subcommand, Subcommand::Add | Subcommand::Link)
    {
        install_with_manager::exit_on_empty_package_json(
            manager.original_package_json_path.as_bytes(),
        );
    }
    let mut current_package_json_root: bun_ast::Expr = current_package_json.root;

    if subcommand == Subcommand::Remove {
        if !current_package_json_root.data.is_e_object() {
            Output::err_generic(
                "package.json is not an Object {{}}, so there's nothing to {s}!",
                (<&'static str>::from(subcommand),),
            );
            Global::crash();
        } else if current_package_json_root
            .data
            .as_e_object()
            .properties
            .len_u32()
            == 0
        {
            Output::err_generic(
                "package.json is empty {{}}, so there's nothing to {s}!",
                (<&'static str>::from(subcommand),),
            );
            Global::crash();
        } else if (DependencyGroup::FOUR.iter())
            .all(|list| current_package_json_root.as_property(list.prop).is_none())
        {
            bun_core::pretty_errorln!(
                "package.json doesn't have dependencies, there's nothing to {}!",
                <&'static str>::from(subcommand),
            );
            Global::exit(0);
        }
    }

    let dependency_list: &'static [u8] = manager.options.update.prop;
    let mut any_changes = false;

    let mut not_in_workspace_root: Option<&PatchCommitResult> = None;
    match subcommand {
        Subcommand::Remove => {
            any_changes =
                remove_dependencies_from_package_json(&mut current_package_json_root, &updates);
        }

        Subcommand::Link | Subcommand::Add | Subcommand::Update => {
            // `bun update <package>` is basically the same as `bun add <package>`, except
            // update will not exceed the current dependency range if it exists

            if !updates.is_empty() {
                let mut updates_slice: &mut [UpdateRequest] = &mut updates[..];
                add_catalog::edit_target(
                    manager,
                    &mut updates_slice,
                    &mut current_package_json_root,
                    dependency_list,
                    EditOptions {
                        exact_versions: manager.options.enable.exact_versions(),
                        before_install: true,
                        ..Default::default()
                    },
                )?;
                // `edit_target` may shrink the slice.
                let new_len = updates_slice.len();
                updates.truncate(new_len);
                if manager.options.add_catalog.is_some() && manager.workspace_name_hash.is_none() {
                    add_catalog::edit_root_before_install(manager, &current_package_json_root)?;
                }
            } else if subcommand == Subcommand::Update && manager.update_target_workspaces.is_none()
            {
                PackageJSONEditor::edit_update_no_args(
                    manager,
                    &mut current_package_json_root,
                    EditOptions {
                        exact_versions: true,
                        before_install: true,
                        ..Default::default()
                    },
                )?;
            }
        }
        _ => {
            if let Some(stuff) = &patch_commit {
                // Inside a workspace package the root package.json is edited below.
                if stuff.not_in_workspace_root {
                    not_in_workspace_root = Some(stuff);
                } else {
                    stuff.edit_package_json(manager, &mut current_package_json_root)?;
                    any_changes = true;
                }
            }
        }
    }

    manager.to_update = subcommand == Subcommand::Update;

    manager.set_update_requests(updates);

    // There are various tradeoffs with how we commit updates when you run `bun add` or `bun remove`
    // The one we chose here is to effectively pretend a human did:
    // 1. "bun add react@latest"
    // 2. open lockfile, find what react resolved to
    // 3. open package.json
    // 4. replace "react" : "latest" with "react" : "^16.2.0"
    // 5. save package.json
    // The Smarter™ approach is you resolve ahead of time and write to disk once!
    // But, turns out that's slower in any case where more than one package has to be resolved (most of the time!)
    // Concurrent network requests are faster than doing one and then waiting until the next batch
    print_package_json_into_cache_entry(current_package_json, current_package_json_root);
    // The edits above went into a promoted copy
    // (`current_package_json_root`), so re-parse the
    // printed source so the cached AST (consumed by `FolderResolver` for workspace
    // members during `install_with_manager`) reflects the new dependency list.
    if let Err(err) = current_package_json.reparse_root(manager.log_mut()) {
        bun_core::pretty_errorln!("package.json failed to parse due to error {}", err.name(),);
        Global::crash();
    }

    let received_requests = matches!(
        subcommand,
        Subcommand::Add | Subcommand::Update | Subcommand::Link
    );
    if (received_requests && manager.update_target_workspaces.is_none()) || any_changes {
        super::package_json_write_back::record(
            manager,
            WorkspaceTarget {
                name: Box::default(),
                name_hash: manager.workspace_name_hash,
                package_json_path: original_package_json_path,
            },
            received_requests,
        );
    }

    // may or may not be the package json we are editing
    let top_level_dir_without_trailing_slash =
        strings::without_trailing_slash(FileSystem::instance().top_level_dir());

    let mut root_package_json_path_buf = bun_paths::path_buffer_pool::get();
    let root_package_json_path: &ZStr = 'root_package_json_path: {
        root_package_json_path_buf[..top_level_dir_without_trailing_slash.len()]
            .copy_from_slice(top_level_dir_without_trailing_slash);
        root_package_json_path_buf[top_level_dir_without_trailing_slash.len()..]
            [..b"/package.json".len()]
            .copy_from_slice(b"/package.json");
        let root_package_json_path_len =
            top_level_dir_without_trailing_slash.len() + b"/package.json".len();
        root_package_json_path_buf[root_package_json_path_len] = 0;
        let root_package_json_path = &root_package_json_path_buf[..root_package_json_path_len];

        // The lifetime of this pointer is only valid until the next call to `getWithPath`, which can happen after this scope.
        // https://github.com/oven-sh/bun/issues/12288
        // reshaped for borrowck — see `current_package_json_ptr` above.
        let root_package_json_ptr: *mut MapEntry =
            package_json_entry_or_crash(manager, root_package_json_path);

        if let Some(stuff) = not_in_workspace_root {
            let root_target = WorkspaceTarget::root();
            let mut root_package_json_root = fetch_entry_root(manager, &root_target);
            stuff.edit_package_json(manager, &mut root_package_json_root)?;
            store_entry(manager, &root_target, root_package_json_root);
            super::package_json_write_back::record(manager, root_target, false);
        }

        // SAFETY: pointer into `manager.workspace_package_json_cache`, valid until the
        // next `get_with_path` of a new path (after this block).
        let root_package_json: &mut MapEntry = unsafe { &mut *root_package_json_ptr };

        let root_is_targeted = manager
            .update_target_workspaces
            .as_deref()
            .is_none_or(|t| t.iter().any(|w| w.is_root));

        if subcommand == Subcommand::Update
            && manager.update_requests.is_empty()
            && root_is_targeted
        {
            let root_package_json_root: bun_ast::Expr = root_package_json.root;
            PackageJSONEditor::record_catalog_entries(manager, &root_package_json_root)?;
        }

        if manager.options.add_catalog.is_some() && manager.workspace_name_hash.is_some() {
            add_catalog::edit_root_entry_before_install(manager, root_package_json)?;
        }

        // SAFETY: root_package_json_path_buf[root_package_json_path_len] == 0 written above
        break 'root_package_json_path ZStr::from_buf(
            &root_package_json_path_buf[..],
            root_package_json_path_len,
        );
    };

    install_with_manager::install_with_manager(manager, ctx, root_package_json_path, original_cwd)?;

    if received_requests && manager.update_requests.iter().any(|request| request.failed) {
        Global::exit(1);
    }
    super::package_json_write_back::flush(manager)?;
    if let Some(stuff) = &patch_commit {
        stuff.delete_removed_patch(manager);
    }

    if subcommand == Subcommand::Remove
        && manager.options.do_.contains(Do::WRITE_PACKAGE_JSON)
        && !any_changes
    {
        Global::exit(u32::from(manager.any_failed_to_install));
    }
    remove_leftover_node_modules(manager);

    Ok(())
}

/// Runs after the install. Removes what's left in the root `node_modules` of the packages that the
/// command removed.
pub(super) fn remove_leftover_node_modules(manager: &mut PackageManager) {
    if !manager.options.do_.contains(Do::WRITE_PACKAGE_JSON) {
        return;
    }
    let subcommand = manager.subcommand;
    let placed: Option<Vec<Box<[u8]>>> = match subcommand {
        Subcommand::Remove => None,
        // `-d` with `--production`: the install skips the group that the entry is in now.
        Subcommand::Add
            if manager.options.do_.contains(Do::INSTALL_PACKAGES)
                && !manager
                    .options
                    .update
                    .behavior
                    .is_enabled(manager.options.local_package_features) =>
        {
            let Some(placed) = crate::prune::top_level_names(manager) else {
                return;
            };
            Some(placed)
        }
        _ => return,
    };
    let Ok(node_modules) = bun_sys::Dir::open(b"node_modules") else {
        return;
    };
    let buffers = &manager.lockfile.buffers;
    for request in manager.update_requests.iter() {
        // A path or URL has no name here.
        if request.name.is_empty() {
            continue;
        }
        // Only top-level folders are removed. Nested copies are left alone.
        let left = match &placed {
            Some(placed) => placed
                .binary_search_by(|name| name.as_ref().cmp(request.name))
                .is_err(),
            // A folder has the name of a resolved dependency, which an alias gives to another package.
            None => {
                let hash = bun_semver::semver_string::Builder::string_hash(request.name);
                !(buffers.dependencies.iter().zip(buffers.resolutions.iter()))
                    .any(|(dep, &id)| dep.name_hash == hash && id != crate::invalid_package_id)
            }
        };
        if !left {
            continue;
        }
        // Don't go through a symlink at `@scope`.
        if let Some((scope, _)) = strings::split_once_char(request.name, b'/')
            && crate::prune::remove_planted_link(
                &bun_sys::Dir::cwd(),
                &bun_core::ZBox::from_bytes([b"node_modules/".as_slice(), scope].concat()),
            )
            .is_err()
        {
            continue;
        }
        let _ = node_modules.delete_tree(request.name);
    }

    crate::prune::prune_bins(&node_modules);
    if manager.options.global {
        let mut global_node_modules =
            strings::without_trailing_slash(FileSystem::instance().top_level_dir()).to_vec();
        global_node_modules.push(bun_paths::SEP);
        global_node_modules.extend_from_slice(b"node_modules");
        crate::prune::prune_global_bins(manager.options.bin_path.as_bytes(), &global_node_modules);
        // A removed package may have owned a bin name that a remaining package also provides.
        crate::bin_real::link_free_global_bins(&manager.lockfile, manager.options.bin_path);
    }
}

pub fn update_package_json_and_install_and_cli(
    ctx: Command::Context,
    subcommand: Subcommand,
    cli: &CommandLineArguments,
) -> Result<(), Error> {
    let update_groups = cli.update_groups;
    let (manager_ptr, original_cwd) = 'brk: {
        match super::init(ctx, cli, subcommand) {
            Ok(v) => v,
            Err(e) => {
                if e == crate::Error::MissingPackageJSON {
                    match subcommand {
                        Subcommand::Update => {
                            bun_core::pretty_errorln!("<r>No package.json, so nothing to update");
                            Global::crash();
                        }
                        Subcommand::Remove => {
                            bun_core::pretty_errorln!("<r>No package.json, so nothing to remove");
                            Global::crash();
                        }
                        Subcommand::Patch | Subcommand::PatchCommit => {
                            bun_core::pretty_errorln!("<r>No package.json, so nothing to patch");
                            Global::crash();
                        }
                        _ if cli.filters.is_empty() => {
                            attempt_to_create_package_json()?;
                            break 'brk super::init(ctx, cli, subcommand)?;
                        }
                        _ => {}
                    }
                }

                return Err(e);
            }
        }
    };
    let original_cwd: &[u8] = &original_cwd;
    // SAFETY: `super::init` returns a `*mut PackageManager` to the process-static
    // singleton. We are on the single CLI thread; no worker
    // threads deref `get()` until `install_with_manager` spawns the HTTP thread.
    let manager: &mut PackageManager = &mut *manager_ptr;

    if manager.options.should_print_command_name() {
        bun_core::prettyln!(
            "<r><b>bun {} <r><d>v{}<r>\n",
            <&'static str>::from(subcommand),
            bun_core::Global::package_json_version_with_sha,
        );
        Output::flush();
    }

    // When you run `bun add -g <pkg>` or `bun install -g <pkg>` and the global bin dir is not in $PATH
    // We should tell the user to add it to $PATH so they don't get confused.
    if subcommand.can_globally_install_packages() {
        if manager.options.global && manager.options.log_level != LogLevel::Silent {
            manager.track_installed_bin = TrackInstalledBin::Pending;
        }
    }

    if subcommand == Subcommand::Update {
        crate::update_scope::expand_positionals(manager, original_cwd, update_groups);
    }

    update_package_json_and_install_with_manager(manager, ctx, original_cwd)?;

    if matches!(manager.options.patch_features, PatchFeatures::Patch) {
        patch_package::prepare_patch(manager)?;
    }

    if manager.any_failed_to_install {
        Global::exit(1);
    }

    // Check if we need to print a warning like:
    //
    // > warn: To run "vite", add the global bin folder to $PATH:
    // >
    // > fish_add_path "/private/tmp/test"
    //
    if subcommand.can_globally_install_packages() {
        if manager.options.global {
            if !manager.options.bin_path.is_empty() {
                if let TrackInstalledBin::Basename(basename) = &manager.track_installed_bin {
                    let mut path_buf = bun_paths::path_buffer_pool::get();
                    let needs_to_print = if let Some(path_env) = bun_core::env_var::PATH.get() {
                        // This is not perfect
                        //
                        // If you already have a different binary of the same
                        // name, it will not detect that case.
                        //
                        // The problem is there are too many edgecases with filesystem paths.
                        //
                        // We want to veer towards false negative than false
                        // positive. It would be annoying if this message
                        // appears unnecessarily. It's kind of okay if it doesn't appear
                        // when it should.
                        //
                        // If you set BUN_INSTALL_BIN to "/tmp/woo" on macOS and
                        // we just checked for "/tmp/woo" in $PATH, it would
                        // incorrectly print a warning because /tmp/ on macOS is
                        // aliased to /private/tmp/
                        //
                        // Another scenario is case-insensitive filesystems. If you
                        // have a binary called "esbuild" in /tmp/TeST and you
                        // install esbuild, it will not detect that case if we naively
                        // just checked for "esbuild" in $PATH where "$PATH" is /tmp/test
                        bun_which::which(
                            &mut path_buf,
                            path_env,
                            FileSystem::instance().top_level_dir(),
                            basename,
                        )
                        .is_none()
                    } else {
                        true
                    };

                    if needs_to_print {
                        bun_core::pretty_error!("\n");

                        bun_core::warn!(
                            "To run {}, add the global bin folder to $PATH:\n\n<cyan>{}<r>\n",
                            bun_core::fmt::quote(basename),
                            MoreInstructions {
                                shell: ShellCompletions::Shell::from_env(
                                    bun_core::env_var::SHELL.platform_get().unwrap_or(b""),
                                ),
                                folder: manager.options.bin_path.as_bytes(),
                            },
                        );
                        Output::flush();
                    }
                }
            }
        }
    }

    Ok(())
}

// Formats the folder for use inside double quotes: a space is kept as it is, and a `\` is doubled
// for a POSIX shell.
struct ShellPathFormatter<'a> {
    folder: &'a [u8],
}

impl fmt::Display for ShellPathFormatter<'_> {
    fn fmt(&self, writer: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(
            writer,
            "{}",
            bun_core::fmt::fmt_path_u8(
                self.folder,
                bun_core::fmt::PathFormatOptions {
                    escape_backslashes: !cfg!(windows),
                    path_sep: if cfg!(windows) {
                        bun_core::fmt::PathSep::Windows
                    } else {
                        bun_core::fmt::PathSep::Posix
                    },
                },
            ),
        )
    }
}

struct MoreInstructions<'a> {
    shell: ShellCompletions::Shell,
    folder: &'a [u8],
}

impl fmt::Display for MoreInstructions<'_> {
    fn fmt(&self, writer: &mut fmt::Formatter<'_>) -> fmt::Result {
        let path = ShellPathFormatter {
            folder: self.folder,
        };
        match self.shell {
            ShellCompletions::Shell::Unknown => {
                // Unfortunately really difficult to do this in one line on PowerShell.
                write!(writer, "{}", path)
            }
            ShellCompletions::Shell::Bash | ShellCompletions::Shell::Zsh => {
                write!(writer, "export PATH=\"{}:$PATH\"", path)
            }
            ShellCompletions::Shell::Fish => {
                // Regular quotes will do here.
                write!(
                    writer,
                    "fish_add_path {}",
                    bun_core::fmt::quote(self.folder)
                )
            }
            ShellCompletions::Shell::Pwsh => {
                write!(writer, "$env:PATH += \";{}\"", path)
            }
        }
    }
}

use super::TrackInstalledBin;
use super::options::{Do, LogLevel, PatchFeatures};
use super::package_json_editor::EditOptions;
use super::workspace_package_json_cache::{GetJSONOptions, GetResult, MapEntry};
use bun_install_types::DependencyGroup;
