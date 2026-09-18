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
use bun_sys::{self, Fd, File};

use super::add_catalog;
use super::add_remove_with_filter::WorkspaceTarget;
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
    const LISTS: [&[u8]; 4] = [
        b"dependencies",
        b"devDependencies",
        b"optionalDependencies",
        b"peerDependencies",
    ];
    let mut any_changes = false;
    for request in updates.iter() {
        for list in LISTS {
            let Some(query) = package_json.as_property(list) else {
                continue;
            };
            let Some(mut e_object) = query.expr.data.e_object() else {
                continue;
            };
            let before = e_object.properties.len();
            e_object.properties.retain(|property| {
                !property
                    .key
                    .and_then(|key| key.data.e_string())
                    .is_some_and(|key| key.eql_bytes(request.name))
            });
            if e_object.properties.len() == before {
                continue;
            }
            any_changes = true;
            if e_object.properties.is_empty() {
                let root = package_json.data.as_e_object_mut();
                let _ = root.properties.swap_remove(query.i as usize);
                root.package_json_sort();
            } else {
                e_object.alphabetize_properties();
            }
        }
    }
    any_changes
}

pub fn update_package_json_and_install_with_manager(
    manager: &mut PackageManager,
    ctx: Command::Context,
    original_cwd: &[u8],
) -> Result<(), Error> {
    let mut update_requests = UpdateRequestArray::with_capacity(64);
    // `defer update_requests.deinit(manager.allocator)` — handled by Drop.

    if manager.options.positionals.len() <= 1 {
        match manager.subcommand {
            Subcommand::Add => {
                Output::err_generic("no package specified to add", ());
                Output::flush();
                CommandLineArguments::print_help(Subcommand::Add);

                Global::exit(0);
            }
            Subcommand::Remove => {
                Output::err_generic("no package specified to remove", ());
                Output::flush();
                CommandLineArguments::print_help(Subcommand::Remove);

                Global::exit(0);
            }
            Subcommand::Update => {}
            _ => {}
        }
    }

    // `manager.options.positionals` is `&'static [&'static [u8]]` so the
    // sub-slice does not borrow `*manager` and can flow alongside `&mut manager`.
    let positionals: &'static [&'static [u8]] = &manager.options.positionals[1..];
    update_package_json_and_install_with_manager_with_updates_and_update_requests(
        manager,
        ctx,
        original_cwd,
        positionals,
        &mut update_requests,
    )
}

fn update_package_json_and_install_with_manager_with_updates_and_update_requests(
    manager: &mut PackageManager,
    ctx: Command::Context,
    original_cwd: &[u8],
    positionals: &[&[u8]],
    update_requests: &mut UpdateRequestArray,
) -> Result<(), Error> {
    let subcommand = manager.subcommand;
    if subcommand != Subcommand::PatchCommit && subcommand != Subcommand::Patch {
        // reshaped for borrowck — `parse` returns a `&mut [UpdateRequest]`
        // sub-slice of `update_requests`; we take its length and truncate the Vec so
        // the next call can take the Vec by value.
        let len = UpdateRequest::parse(
            // `dependency::parse_with_tag` is the only consumer of `pm`; it inserts
            // into `pm.known_npm_aliases` for `npm:`-aliased positionals.
            Some(manager),
            // SAFETY: `ctx.log` is set once during `Command::create()` (process-
            // lifetime singleton) and is never null afterward.
            unsafe { &mut *ctx.log },
            positionals,
            update_requests,
            subcommand,
        )
        .len();
        update_requests.truncate(len);
    } else {
        update_requests.clear();
    }
    update_package_json_and_install_with_manager_with_updates(
        manager,
        ctx,
        core::mem::take(update_requests),
        manager.subcommand,
        original_cwd,
    )
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
        if log_level != LogLevel::Silent {
            let _ = manager
                .log_mut()
                .print(std::ptr::from_mut(Output::error_writer()));
        }
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
        match manager.load_lockfile_from_cwd::<true>() {
            crate::lockfile::LoadResult::Ok(_) => {}
            crate::lockfile::LoadResult::NotFound => {
                if log_level != LogLevel::Silent {
                    Output::err_generic("missing lockfile, nothing to update", ());
                    bun_core::note!("run 'bun install' first");
                }
                Global::crash();
            }
            crate::lockfile::LoadResult::Err(cause) => {
                if log_level != LogLevel::Silent
                    && !crate::migration::reported_unsupported_lockfile_version(&cause)
                {
                    Output::err_generic(
                        "failed to {s} lockfile: {s}",
                        (cause.step.verb(), cause.value.name()),
                    );
                    if manager.log_mut().has_errors() {
                        let _ = manager
                            .log_mut()
                            .print(std::ptr::from_mut(Output::error_writer()));
                    }
                }
                Global::crash();
            }
        }
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

    // reshaped for borrowck — `get_with_path` returns `&mut MapEntry`
    // borrowed from `manager.workspace_package_json_cache`, but we then need
    // `&mut *manager` for `PackageJSONEditor::edit` / `do_patch_commit` while still
    // holding the entry. Demote to `*mut MapEntry` and re-
    // borrow at point of use. The cache map is not mutated again until the
    // next `get_with_path` call below, so the pointer remains valid.
    let current_package_json_ptr: *mut MapEntry =
        match manager.workspace_package_json_cache.get_with_path(
            manager.log_mut(),
            manager.original_package_json_path.as_bytes(),
            GetJSONOptions {
                guess_indentation: true,
                ..Default::default()
            },
        ) {
            GetResult::ParseErr(err) => {
                let _ = manager
                    .log_mut()
                    .print(std::ptr::from_mut(Output::error_writer()));
                Output::err_generic(
                    "failed to parse package.json \"{s}\": {s}",
                    (
                        BStr::new(manager.original_package_json_path.as_bytes()),
                        err.name(),
                    ),
                );
                Global::crash();
            }
            GetResult::ReadErr(err) => {
                Output::err_generic(
                    "failed to read package.json \"{s}\": {s}",
                    (
                        BStr::new(manager.original_package_json_path.as_bytes()),
                        err.name(),
                    ),
                );
                Global::crash();
            }
            GetResult::Entry(entry) => core::ptr::from_mut(entry),
        };
    // SAFETY: see note above — pointer into `manager.workspace_package_json_cache`,
    // valid until the next `get_with_path`. No `&mut manager.workspace_package_json_cache`
    // is taken across this borrow; `PackageJSONEditor` and `do_patch_commit` touch only
    // disjoint manager fields.
    let current_package_json: &mut MapEntry = unsafe { &mut *current_package_json_ptr };
    let mut current_package_json_root: bun_ast::Expr = current_package_json.root;
    let current_package_json_indent = current_package_json.indentation;

    // If there originally was a newline at the end of their package.json, preserve it
    // so that we don't cause unnecessary diffs in their git history.
    // https://github.com/oven-sh/bun/issues/1375
    let preserve_trailing_newline_at_eof_for_package_json =
        current_package_json.source.contents.last() == Some(&b'\n');

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
        } else if current_package_json_root
            .as_property(b"devDependencies")
            .is_none()
            && current_package_json_root
                .as_property(b"dependencies")
                .is_none()
            && current_package_json_root
                .as_property(b"optionalDependencies")
                .is_none()
            && current_package_json_root
                .as_property(b"peerDependencies")
                .is_none()
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

    let mut not_in_workspace_root: Option<PatchCommitResult> = None;
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
            if matches!(manager.options.patch_features, PatchFeatures::Commit { .. }) {
                let mut pathbuf = bun_paths::path_buffer_pool::get();
                if let Some(stuff) =
                    patch_package::do_patch_commit(manager, &mut pathbuf, log_level)?
                {
                    // we're inside a workspace package, we need to edit the
                    // root json, not the `current_package_json`
                    if stuff.not_in_workspace_root {
                        not_in_workspace_root = Some(stuff);
                    } else {
                        PackageJSONEditor::edit_patched_dependencies(
                            manager,
                            &mut current_package_json_root,
                            &stuff.patch_key,
                            &stuff.patchfile_path,
                        )?;
                    }
                }
            }
        }
    }

    manager.to_update = subcommand == Subcommand::Update;

    manager.set_update_requests(updates);

    let mut buffer_writer = js_printer::BufferWriter::init();
    buffer_writer.buffer.list.reserve(
        (current_package_json.source.contents.len() + 1)
            .saturating_sub(buffer_writer.buffer.list.len()),
    );
    buffer_writer.append_newline = preserve_trailing_newline_at_eof_for_package_json;
    let mut package_json_writer = js_printer::BufferPrinter::init(buffer_writer);

    if let Err(e) = js_printer::print_json(
        &mut package_json_writer,
        current_package_json_root,
        &current_package_json.source,
        js_printer::PrintJsonOptions {
            indent: current_package_json_indent,
            mangled_props: None,
            ..Default::default()
        },
    ) {
        bun_core::pretty_errorln!("package.json failed to write due to error {}", e.name(),);
        Global::crash();
    }

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
    let new_package_json_source: Vec<u8> = package_json_writer
        .ctx
        .written_without_trailing_zero()
        .to_vec();
    // The cache entry (`Cow<'static, [u8]>`) outlives this stack frame, so it needs its own copy.
    current_package_json.source.contents = Cow::Owned(new_package_json_source.clone());
    // The edits above went into a promoted copy
    // (`current_package_json_root`), so re-parse the
    // printed source so the cached AST (consumed by `FolderResolver` for workspace
    // members during `install_with_manager`) reflects the new dependency list.
    if let Err(err) = current_package_json.reparse_root(manager.log_mut()) {
        bun_core::pretty_errorln!("package.json failed to parse due to error {}", err.name(),);
        Global::crash();
    }

    if matches!(
        subcommand,
        Subcommand::Add | Subcommand::Update | Subcommand::Link
    ) && manager.update_target_workspaces.is_none()
    {
        super::package_json_write_back::record(
            manager,
            WorkspaceTarget {
                name: Box::default(),
                name_hash: manager.workspace_name_hash,
                package_json_path: manager.original_package_json_path.as_bytes().into(),
            },
            true,
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
            match manager.workspace_package_json_cache.get_with_path(
                manager.log_mut(),
                root_package_json_path,
                GetJSONOptions {
                    guess_indentation: true,
                    ..Default::default()
                },
            ) {
                GetResult::ParseErr(err) => {
                    let _ = manager
                        .log_mut()
                        .print(std::ptr::from_mut(Output::error_writer()));
                    Output::err_generic(
                        "failed to parse package.json \"{s}\": {s}",
                        (BStr::new(root_package_json_path), err.name()),
                    );
                    Global::crash();
                }
                GetResult::ReadErr(err) => {
                    Output::err_generic(
                        "failed to read package.json \"{s}\": {s}",
                        (
                            BStr::new(manager.original_package_json_path.as_bytes()),
                            err.name(),
                        ),
                    );
                    Global::crash();
                }
                GetResult::Entry(entry) => core::ptr::from_mut(entry),
            };
        // SAFETY: pointer into `manager.workspace_package_json_cache`, valid until the
        // next `get_with_path` (after this block). `edit_patched_dependencies` touches
        // only disjoint manager fields.
        let root_package_json: &mut MapEntry = unsafe { &mut *root_package_json_ptr };

        if let Some(stuff) = &not_in_workspace_root {
            let mut root_package_json_root: bun_ast::Expr = root_package_json.root;
            PackageJSONEditor::edit_patched_dependencies(
                manager,
                &mut root_package_json_root,
                &stuff.patch_key,
                &stuff.patchfile_path,
            )?;
            let mut buffer_writer2 = js_printer::BufferWriter::init();
            buffer_writer2.buffer.list.reserve(
                (root_package_json.source.contents.len() + 1)
                    .saturating_sub(buffer_writer2.buffer.list.len()),
            );
            buffer_writer2.append_newline = preserve_trailing_newline_at_eof_for_package_json;
            let mut package_json_writer2 = js_printer::BufferPrinter::init(buffer_writer2);

            let _ = match js_printer::print_json(
                &mut package_json_writer2,
                root_package_json_root,
                &root_package_json.source,
                js_printer::PrintJsonOptions {
                    indent: root_package_json.indentation,
                    mangled_props: None,
                    ..Default::default()
                },
            ) {
                Ok(n) => n,
                Err(e) => {
                    bun_core::pretty_errorln!(
                        "package.json failed to write due to error {}",
                        e.name(),
                    );
                    Global::crash();
                }
            };
            root_package_json.source.contents = Cow::Owned(
                package_json_writer2
                    .ctx
                    .written_without_trailing_zero()
                    .to_vec(),
            );
        }

        let root_is_targeted = manager
            .update_target_workspaces
            .as_deref()
            .is_none_or(|t| t.iter().any(|w| w.is_root));

        if subcommand == Subcommand::Update
            && manager.update_requests.is_empty()
            && root_is_targeted
        {
            let root_package_json_root: bun_ast::Expr = root_package_json.root;
            if PackageJSONEditor::edit_catalogs_before_update(manager, &root_package_json_root)?
                && manager.options.do_.contains(Do::UPDATE_TO_LATEST)
            {
                // entries now hold a temporary `latest`; refresh the cache so install resolves those.
                print_package_json_into_cache_entry(root_package_json, root_package_json_root);
                if let Err(err) = root_package_json.reparse_root(manager.log_mut()) {
                    bun_core::pretty_errorln!(
                        "package.json failed to parse due to error {}",
                        err.name(),
                    );
                    Global::crash();
                }
            }
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

    if matches!(
        subcommand,
        Subcommand::Update | Subcommand::Add | Subcommand::Link
    ) {
        if manager.update_requests.iter().any(|request| request.failed) {
            Global::exit(1);
        }
        return super::package_json_write_back::flush(manager);
    }

    if manager.options.do_.contains(Do::WRITE_PACKAGE_JSON) {
        let (source, path): (&[u8], &ZStr) =
            if matches!(manager.options.patch_features, PatchFeatures::Commit { .. }) {
                'source_and_path: {
                    let root_package_json_entry = match manager
                        .workspace_package_json_cache
                        .get_with_path(
                            manager.log_mut(),
                            root_package_json_path.as_bytes(),
                            GetJSONOptions::default(),
                        )
                        .unwrap()
                    {
                        Ok(e) => e,
                        Err(err) => {
                            Output::err(
                                err,
                                "failed to read/parse package.json at '{s}'",
                                (BStr::new(root_package_json_path.as_bytes()),),
                            );
                            Global::exit(1);
                        }
                    };

                    break 'source_and_path (
                        &root_package_json_entry.source.contents,
                        root_package_json_path,
                    );
                }
            } else {
                (
                    &new_package_json_source,
                    manager.original_package_json_path.as_zstr(),
                )
            };

        // Now that we've run the install step
        // We can save our in-memory package.json to disk
        let workspace_package_json_file =
            File::openat(Fd::cwd(), path, bun_sys::O::RDWR, 0).map_err(Error::from)?;

        workspace_package_json_file
            .pwrite_all(source, 0)
            .map_err(Error::from)?;
        let _ = bun_sys::ftruncate(workspace_package_json_file.handle, source.len() as i64);
        let _ = workspace_package_json_file.close(); // close error is non-actionable

        if subcommand == Subcommand::Remove {
            if !any_changes {
                Global::exit(0);
            }
            let updates: Box<[UpdateRequest]> = core::mem::take(&mut manager.update_requests);
            remove_leftover_node_modules(manager, &updates);
        }
    }

    Ok(())
}

pub(super) fn remove_leftover_node_modules(
    manager: &mut PackageManager,
    updates: &[UpdateRequest],
) {
    let cwd = bun_sys::Dir::cwd();
    let mut node_modules_buf = bun_paths::path_buffer_pool::get();
    node_modules_buf[..b"node_modules".len()].copy_from_slice(b"node_modules");
    node_modules_buf[b"node_modules".len()] = bun_paths::SEP;
    let name_hashes = manager.lockfile.packages.items_name_hash();
    for request in updates.iter() {
        // Only top-level folders are removed; nested copies are left alone.
        let name_hash = bun_semver::semver_string::Builder::string_hash(request.name);
        if !name_hashes.contains(&name_hash) {
            let offset_buf = &mut node_modules_buf[b"node_modules/".len()..];
            offset_buf[..request.name.len()].copy_from_slice(request.name);
            let _ =
                cwd.delete_tree(&node_modules_buf[..b"node_modules/".len() + request.name.len()]);
        }
    }

    match bun_sys::open_dir_for_iteration(cwd.fd(), manager.options.bin_path.as_bytes()) {
        Ok(node_modules_bin) => {
            let mut iter = bun_sys::iterate_dir(node_modules_bin);
            'iterator: loop {
                let Ok(Some(entry)) = iter.next() else { break };
                match entry.kind {
                    bun_sys::EntryKind::SymLink => {
                        // access(2) does not follow symlinks, so open() is the dangling check.
                        let name = entry.name.slice_u8();
                        node_modules_buf[..name.len()].copy_from_slice(name);
                        node_modules_buf[name.len()] = 0;
                        let buf: &ZStr = ZStr::from_buf(&node_modules_buf, name.len());

                        match bun_sys::File::openat(node_modules_bin, buf, bun_sys::O::RDONLY, 0) {
                            Ok(file) => {
                                let _ = file.close();
                            }
                            Err(_) => {
                                let _ = bun_sys::unlinkat(node_modules_bin, buf);
                                continue 'iterator;
                            }
                        }
                    }
                    _ => {}
                }
            }
            let _ = bun_sys::close(node_modules_bin);
        }
        Err(err) => {
            if err.get_errno() != bun_sys::E::ENOENT {
                Output::err(
                    crate::Error::from(err),
                    "while reading node_modules/.bin",
                    (),
                );
                Global::crash();
            }
        }
    }
}

pub fn update_package_json_and_install_and_cli(
    ctx: Command::Context,
    subcommand: Subcommand,
    cli: CommandLineArguments,
) -> Result<(), Error> {
    let update_groups = cli.update_groups;
    let (manager_ptr, original_cwd) = 'brk: {
        match super::init(ctx, cli.clone(), subcommand) {
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
    // `defer ctx.allocator.free(original_cwd)` — `original_cwd: Box<[u8]>` drops at scope exit.
    let _original_cwd_owner: Box<[u8]> = original_cwd;
    let original_cwd: &[u8] = &_original_cwd_owner;
    // SAFETY: `super::init` returns a `*mut PackageManager` to the process-static
    // singleton. We are on the single CLI thread; no worker
    // threads deref `get()` until `install_with_manager` spawns the HTTP thread.
    let manager: &mut PackageManager = &mut *manager_ptr;

    if manager.options.should_print_command_name() {
        // `concatcp!` yields `&'static str`, but `format_args!` requires a string *literal*
        // for its template. Splice the version as a runtime arg instead — this matches the
        // approach taken by every other CLI subcommand banner (see e.g. `outdated_command.rs`,
        // `update_interactive_command.rs`).
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

// Convert "/Users/Jarred Sumner" => "/Users/Jarred\ Sumner"
struct ShellPathFormatter<'a> {
    folder: &'a [u8],
}

impl fmt::Display for ShellPathFormatter<'_> {
    fn fmt(&self, writer: &mut fmt::Formatter<'_>) -> fmt::Result {
        let mut remaining = self.folder;
        while let Some(space) = strings::index_of_char(remaining, b' ') {
            write!(
                writer,
                "{}",
                bun_core::fmt::fmt_path_u8(
                    &remaining[..space as usize],
                    bun_core::fmt::PathFormatOptions {
                        escape_backslashes: true,
                        path_sep: if cfg!(windows) {
                            bun_core::fmt::PathSep::Windows
                        } else {
                            bun_core::fmt::PathSep::Posix
                        },
                    },
                ),
            )?;
            writer.write_str("\\ ")?;
            remaining = &remaining[(space as usize + 1).min(remaining.len())..];
        }

        write!(
            writer,
            "{}",
            bun_core::fmt::fmt_path_u8(
                remaining,
                bun_core::fmt::PathFormatOptions {
                    escape_backslashes: true,
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
            ShellCompletions::Shell::Bash => {
                write!(writer, "export PATH=\"{}:$PATH\"", path)
            }
            ShellCompletions::Shell::Zsh => {
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
