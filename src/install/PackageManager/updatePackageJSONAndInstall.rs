use crate::lockfile::package::PackageColumns as _;
use bun_collections::VecExt;
use core::fmt;
use std::borrow::Cow;

use bstr::BStr;

use crate::ShellCompletions;
use crate::bun_fs::FileSystem;
use crate::bun_json as json;
use bun_core::{Error, Global, Output, err};
use bun_core::{ZStr, strings};
use bun_install::PackageNameHash;
use bun_js_printer as js_printer;
use bun_paths::{self, PathBuffer, SEP_STR};
use bun_sys::{self, Fd, File};

use super::{
    Command, PackageManager, PatchCommitResult, Subcommand, UpdateRequest,
    attempt_to_create_package_json, install_with_manager, patch_package,
};
// Zig's `PackageJSONEditor` is a file-namespace struct; the Rust port exposes
// its functions directly on the `package_json_editor` module.
use super::command_line_arguments::CommandLineArguments;
use super::package_json_editor as PackageJSONEditor;
use super::patch_package::{do_patch_commit, prepare_patch};
use super::update_request::Array as UpdateRequestArray;

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

    // PORT NOTE: `manager.options.positionals` is `&'static [&'static [u8]]` so the
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
    // TODO(port): narrow error set
    let subcommand = manager.subcommand;
    if subcommand != Subcommand::PatchCommit && subcommand != Subcommand::Patch {
        // PORT NOTE: reshaped for borrowck — `parse` returns a `&mut [UpdateRequest]`
        // sub-slice of `update_requests`; we take its length and truncate the Vec so
        // the next call can take the Vec by value (Zig threaded `*[]UpdateRequest`).
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
    // PORT NOTE: reshaped for borrowck — Zig was `*[]UpdateRequest`. Taking by
    // value lets us hand ownership to `manager.update_requests` (which the Rust
    // port types as `Box<[UpdateRequest]>`) and re-borrow afterwards without
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

    // PORT NOTE: reshaped for borrowck — `get_with_path` returns `&mut MapEntry`
    // borrowed from `manager.workspace_package_json_cache`, but we then need
    // `&mut *manager` for `PackageJSONEditor::edit` / `do_patch_commit` while still
    // holding the entry. Zig held `*MapEntry` and `*PackageManager` simultaneously
    // (no aliasing rules); mirror that by demoting to `*mut MapEntry` and re-
    // borrowing at point of use. The cache map is not mutated again until the
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
    // SAFETY: see PORT NOTE above — pointer into `manager.workspace_package_json_cache`,
    // valid until the next `get_with_path`. No `&mut manager.workspace_package_json_cache`
    // is taken across this borrow; `PackageJSONEditor` and `do_patch_commit` touch only
    // disjoint manager fields.
    let current_package_json: &mut MapEntry = unsafe { &mut *current_package_json_ptr };
    let mut current_package_json_root: bun_ast::Expr = current_package_json.root.into();
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
            Output::pretty_errorln(format_args!(
                "package.json doesn't have dependencies, there's nothing to {}!",
                <&'static str>::from(subcommand),
            ));
            Global::exit(0);
        }
    }

    let dependency_list: &'static [u8] = if manager.options.update.development {
        b"devDependencies"
    } else if manager.options.update.optional {
        b"optionalDependencies"
    } else if manager.options.update.peer {
        b"peerDependencies"
    } else {
        b"dependencies"
    };
    let mut any_changes = false;

    let mut not_in_workspace_root: Option<PatchCommitResult> = None;
    match subcommand {
        Subcommand::Remove => {
            // if we're removing, they don't have to specify where it is installed in the dependencies list
            // they can even put it multiple times and we will just remove all of them
            for request in updates.iter() {
                // PERF(port): was `inline for` — profile in Phase B
                const LISTS: [&[u8]; 4] = [
                    b"dependencies",
                    b"devDependencies",
                    b"optionalDependencies",
                    b"peerDependencies",
                ];
                for list in LISTS {
                    if let Some(query) = current_package_json_root.as_property(list) {
                        if query.expr.data.is_e_object() {
                            // PORT NOTE: reshaped for borrowck — Zig held `data.e_object` (a
                            // `*E.Object`) across writes to both the inner list and the parent
                            // object. `StoreRef<E::Object>` is `Copy` and derefs to a raw arena
                            // pointer, so taking it once mirrors that exactly.
                            let mut e_object = query.expr.data.as_e_object();
                            let dependencies = e_object.properties.slice_mut();
                            let mut i: usize = 0;
                            let mut new_len = dependencies.len();
                            // PORT NOTE: Zig copies `dependencies[i] = dependencies[new_len - 1]`
                            // and iterates to the original length. `G::Property` is not `Copy` in
                            // Rust, so we `swap` instead — but the swapped-out matched element
                            // lands in the truncated tail and MUST NOT be revisited (it would
                            // match again and over-truncate). Bounding by `new_len` yields the
                            // same result as Zig for the unique-key case package.json guarantees.
                            while i < new_len {
                                let key = dependencies[i].key.unwrap();
                                if key.data.is_e_string() {
                                    if key.data.as_e_string().unwrap().eql_bytes(request.name) {
                                        if new_len > 1 {
                                            dependencies.swap(i, new_len - 1);
                                            new_len -= 1;
                                        } else {
                                            new_len = 0;
                                        }

                                        any_changes = true;
                                    }
                                }
                                i += 1;
                            }

                            let changed = new_len != dependencies.len();
                            if changed {
                                e_object.properties.truncate((new_len) as usize);

                                // If the dependencies list is now empty, remove it from the package.json
                                // since we're swapRemove, we have to re-sort it
                                if e_object.properties.len_u32() == 0 {
                                    // TODO: Theoretically we could change these two lines to
                                    // `.orderedRemove(query.i)`, but would that change user-facing
                                    // behavior?
                                    let _ = current_package_json_root
                                        .data
                                        .as_e_object_mut()
                                        .properties
                                        .swap_remove(query.i as usize);
                                    current_package_json_root
                                        .data
                                        .as_e_object_mut()
                                        .package_json_sort();
                                } else {
                                    e_object.alphabetize_properties();
                                }
                            }
                        }
                    }
                }
            }
        }

        Subcommand::Link | Subcommand::Add | Subcommand::Update => {
            // `bun update <package>` is basically the same as `bun add <package>`, except
            // update will not exceed the current dependency range if it exists

            if !updates.is_empty() {
                let mut updates_slice: &mut [UpdateRequest] = &mut updates[..];
                PackageJSONEditor::edit(
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
                // `edit` may shrink the slice (Zig `updates.* = updates.*[0..n]`).
                let new_len = updates_slice.len();
                updates.truncate(new_len);
            } else if subcommand == Subcommand::Update {
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
                let mut pathbuf = PathBuffer::uninit();
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

    // PORT NOTE: reshaped for borrowck — Zig stored a slice header (`manager.update_requests
    // = updates.*`) so both names alias the same backing array; the Rust field is owning
    // (`Box<[UpdateRequest]>`), so we transfer ownership here and re-borrow from
    // `manager.update_requests` after `install_with_manager` (which is the only writer).
    manager.update_requests = updates.into_boxed_slice();

    let mut buffer_writer = js_printer::BufferWriter::init();
    buffer_writer.buffer.list.reserve(
        (current_package_json.source.contents.len() + 1)
            .saturating_sub(buffer_writer.buffer.list.len()),
    );
    buffer_writer.append_newline = preserve_trailing_newline_at_eof_for_package_json;
    let mut package_json_writer = js_printer::BufferPrinter::init(buffer_writer);

    let mut written = match js_printer::print_json(
        &mut package_json_writer,
        current_package_json_root,
        &current_package_json.source,
        js_printer::PrintJsonOptions {
            indent: current_package_json_indent,
            mangled_props: None,
            ..Default::default()
        },
    ) {
        Ok(n) => n,
        Err(e) => {
            Output::pretty_errorln(format_args!(
                "package.json failed to write due to error {}",
                e.name(),
            ));
            Global::crash();
        }
    };

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
    let mut new_package_json_source: Vec<u8> = package_json_writer
        .ctx
        .written_without_trailing_zero()
        .to_vec();
    // Zig: `manager.allocator.dupe(u8, …)` — heap-owned, never freed (process-lifetime).
    // The cache entry (`Cow<'static, [u8]>`) outlives this stack frame, and
    // `new_package_json_source` is reassigned below on the add/update/link path, so we
    // must store an *owning* copy to avoid a dangling borrow. PERF(port): one extra
    // alloc+copy vs Zig's single dupe — profile in Phase B.
    current_package_json.source.contents = Cow::Owned(new_package_json_source.clone());
    // PORT NOTE: Zig edited `current_package_json.root` in place above; we edited a
    // promoted T4 copy (`current_package_json_root`). Re-parse the printed source so
    // the cached T2 AST (consumed by `FolderResolver` for workspace members during
    // `install_with_manager`) reflects the new dependency list.
    if let Err(err) = current_package_json.reparse_root(manager.log_mut()) {
        Output::pretty_errorln(format_args!(
            "package.json failed to parse due to error {}",
            err.name(),
        ));
        Global::crash();
    }

    // may or may not be the package json we are editing
    let top_level_dir_without_trailing_slash =
        strings::without_trailing_slash(FileSystem::instance().top_level_dir());

    let mut root_package_json_path_buf = PathBuffer::uninit();
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
        // PORT NOTE: reshaped for borrowck — see `current_package_json_ptr` above.
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
            // PORT NOTE (layering): see `current_package_json_root` above — promote
            // T2 → T4 for `PackageJSONEditor` / `print_json`.
            let mut root_package_json_root: bun_ast::Expr = root_package_json.root.into();
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
                    Output::pretty_errorln(format_args!(
                        "package.json failed to write due to error {}",
                        e.name(),
                    ));
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

        // SAFETY: root_package_json_path_buf[root_package_json_path_len] == 0 written above
        break 'root_package_json_path ZStr::from_buf(
            &root_package_json_path_buf[..],
            root_package_json_path_len,
        );
    };

    install_with_manager::install_with_manager(manager, ctx, root_package_json_path, original_cwd)?;

    // PORT NOTE: reshaped for borrowck — see assignment above. `install_with_manager`
    // is the only writer to `manager.update_requests` between the assignment and
    // here, so taking it back yields exactly the slice Zig observed via `updates.*`.
    let mut updates: Box<[UpdateRequest]> = core::mem::take(&mut manager.update_requests);

    if subcommand == Subcommand::Update
        || subcommand == Subcommand::Add
        || subcommand == Subcommand::Link
    {
        for request in updates.iter() {
            if request.failed {
                Global::exit(1);
            }
        }

        let source =
            bun_ast::Source::init_path_string(&b"package.json"[..], &new_package_json_source[..]);

        // Now, we _re_ parse our in-memory edited package.json
        // so we can commit the version we changed from the lockfile
        let json_arena = bun_alloc::Arena::new();
        let mut new_package_json: bun_ast::Expr =
            match json::parse_package_json_utf8(&source, manager.log_mut(), &json_arena) {
                Ok(v) => v.into(),
                Err(err) => {
                    Output::pretty_errorln(format_args!(
                        "package.json failed to parse due to error {}",
                        err.name(),
                    ));
                    Global::crash();
                }
            };

        if updates.is_empty() {
            PackageJSONEditor::edit_update_no_args(
                manager,
                &mut new_package_json,
                EditOptions {
                    exact_versions: manager.options.enable.exact_versions(),
                    ..Default::default()
                },
            )?;
        } else {
            let mut updates_slice: &mut [UpdateRequest] = &mut updates[..];
            PackageJSONEditor::edit(
                manager,
                &mut updates_slice,
                &mut new_package_json,
                dependency_list,
                EditOptions {
                    exact_versions: manager.options.enable.exact_versions(),
                    add_trusted_dependencies: manager
                        .options
                        .do_
                        .contains(Do::TRUST_DEPENDENCIES_FROM_ARGS),
                    ..Default::default()
                },
            )?;
        }
        let mut buffer_writer_two = js_printer::BufferWriter::init();
        buffer_writer_two.buffer.list.reserve(
            (source.contents.len() + 1).saturating_sub(buffer_writer_two.buffer.list.len()),
        );
        buffer_writer_two.append_newline = preserve_trailing_newline_at_eof_for_package_json;
        let mut package_json_writer_two = js_printer::BufferPrinter::init(buffer_writer_two);

        written = match js_printer::print_json(
            &mut package_json_writer_two,
            new_package_json,
            &source,
            js_printer::PrintJsonOptions {
                indent: current_package_json_indent,
                mangled_props: None,
                ..Default::default()
            },
        ) {
            Ok(n) => n,
            Err(e) => {
                Output::pretty_errorln(format_args!(
                    "package.json failed to write due to error {}",
                    e.name(),
                ));
                Global::crash();
            }
        };

        new_package_json_source = package_json_writer_two
            .ctx
            .written_without_trailing_zero()
            .to_vec();
    }

    let _ = written;

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
        let _ = workspace_package_json_file.close(); // close error is non-actionable (Zig parity: discarded)

        if subcommand == Subcommand::Remove {
            if !any_changes {
                Global::exit(0);
            }

            let cwd = bun_sys::Dir::cwd();
            // This is not exactly correct
            let mut node_modules_buf = PathBuffer::uninit();
            node_modules_buf[..b"node_modules".len()].copy_from_slice(b"node_modules");
            node_modules_buf[b"node_modules".len()] = bun_paths::SEP;
            let name_hashes = manager.lockfile.packages.items_name_hash();
            for request in updates.iter() {
                // If the package no longer exists in the updated lockfile, delete the directory
                // This is not thorough.
                // It does not handle nested dependencies
                // This is a quick & dirty cleanup intended for when deleting top-level dependencies
                if !name_hashes
                    .iter()
                    .any(|h| *h == bun_semver::semver_string::Builder::string_hash(request.name))
                {
                    let offset_buf = &mut node_modules_buf[b"node_modules/".len()..];
                    offset_buf[..request.name.len()].copy_from_slice(request.name);
                    let _ = cwd.delete_tree(
                        &node_modules_buf[..b"node_modules/".len() + request.name.len()],
                    );
                }
            }

            // This is where we clean dangling symlinks
            // This could be slow if there are a lot of symlinks
            match bun_sys::open_dir_for_iteration(cwd.fd(), manager.options.bin_path.as_bytes()) {
                Ok(node_modules_bin) => {
                    // `defer node_modules_bin.close()` — explicit close below (Fd is Copy, no Drop).
                    let mut iter = bun_sys::iterate_dir(node_modules_bin);
                    'iterator: loop {
                        let Ok(Some(entry)) = iter.next() else { break };
                        match entry.kind {
                            bun_sys::EntryKind::SymLink => {
                                // any symlinks which we are unable to open are assumed to be dangling
                                // note that using access won't work here, because access doesn't resolve symlinks
                                let name = entry.name.slice_u8();
                                node_modules_buf[..name.len()].copy_from_slice(name);
                                node_modules_buf[name.len()] = 0;
                                let buf: &ZStr = ZStr::from_buf(&node_modules_buf, name.len());

                                match bun_sys::File::openat(
                                    node_modules_bin,
                                    buf,
                                    bun_sys::O::RDONLY,
                                    0,
                                ) {
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
                            bun_core::Error::from(err),
                            "while reading node_modules/.bin",
                            (),
                        );
                        Global::crash();
                    }
                }
            }
        }
    }

    Ok(())
}

pub fn update_package_json_and_install_and_cli(
    ctx: Command::Context,
    subcommand: Subcommand,
    cli: CommandLineArguments,
) -> Result<(), Error> {
    // TODO(port): narrow error set
    let (manager_ptr, original_cwd) = 'brk: {
        match super::init(ctx, cli.clone(), subcommand) {
            Ok(v) => v,
            Err(e) => {
                if e == bun_core::err!("MissingPackageJSON") {
                    match subcommand {
                        Subcommand::Update => {
                            Output::pretty_errorln(format_args!(
                                "<r>No package.json, so nothing to update"
                            ));
                            Global::crash();
                        }
                        Subcommand::Remove => {
                            Output::pretty_errorln(format_args!(
                                "<r>No package.json, so nothing to remove"
                            ));
                            Global::crash();
                        }
                        Subcommand::Patch | Subcommand::PatchCommit => {
                            Output::pretty_errorln(format_args!(
                                "<r>No package.json, so nothing to patch"
                            ));
                            Global::crash();
                        }
                        _ => {
                            attempt_to_create_package_json()?;
                            break 'brk super::init(ctx, cli, subcommand)?;
                        }
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
    // singleton (Zig `*PackageManager`). We are on the single CLI thread; no worker
    // threads deref `get()` until `install_with_manager` spawns the HTTP thread.
    let manager: &mut PackageManager = unsafe { &mut *manager_ptr };

    if manager.options.should_print_command_name() {
        // Zig: `"..." ++ Global.package_json_version_with_sha ++ "..."` (comptime concat).
        // `concatcp!` yields `&'static str`, but `format_args!` requires a string *literal*
        // for its template. Splice the version as a runtime arg instead — this matches the
        // approach taken by every other CLI subcommand banner (see e.g. `outdated_command.rs`,
        // `update_interactive_command.rs`).
        Output::prettyln(format_args!(
            "<r><b>bun {} <r><d>v{}<r>\n",
            <&'static str>::from(subcommand),
            bun_core::Global::package_json_version_with_sha,
        ));
        Output::flush();
    }

    // When you run `bun add -g <pkg>` or `bun install -g <pkg>` and the global bin dir is not in $PATH
    // We should tell the user to add it to $PATH so they don't get confused.
    if subcommand.can_globally_install_packages() {
        if manager.options.global && manager.options.log_level != LogLevel::Silent {
            manager.track_installed_bin = TrackInstalledBin::Pending;
        }
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
                    let mut path_buf = PathBuffer::uninit();
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
                        Output::pretty_error(format_args!("\n"));

                        Output::warn(format_args!(
                            "To run {}, add the global bin folder to $PATH:\n\n<cyan>{}<r>\n",
                            bun_core::fmt::quote(basename),
                            MoreInstructions {
                                shell: ShellCompletions::Shell::from_env(
                                    bun_core::env_var::SHELL.platform_get().unwrap_or(b""),
                                ),
                                folder: manager.options.bin_path.as_bytes(),
                            },
                        ));
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

impl Default for MoreInstructions<'_> {
    fn default() -> Self {
        Self {
            shell: ShellCompletions::Shell::Unknown,
            folder: b"",
        }
    }
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

// ported from: src/install/PackageManager/updatePackageJSONAndInstall.zig
