use core::fmt;
use core::ptr::null_mut;
use core::sync::atomic::{AtomicPtr, Ordering};

use bstr::BStr;

use bun_core::{err, Error, Global, Output};
// TODO(b0): ShellCompletions arrives from move-in (bun_cli::ShellCompletions → install).
use crate::ShellCompletions;

/// Hook (GENUINE b0): bun_cli::BuildCommand::exec — runs the bundler's
/// dependencies-scanner pass for `bun install --analyze`. Registered by
/// bun_runtime::init(). Signature:
/// `unsafe fn(ctx: *mut (), fetcher: *mut ()) -> Result<(), Error>`
/// where `ctx` is `Command::Context` and `fetcher` is
/// `*mut bun_bundler::bundle_v2::BundleV2::DependenciesScanner`.
pub static BUILD_COMMAND_EXEC_HOOK: AtomicPtr<()> = AtomicPtr::new(null_mut());

/// Hook (GENUINE b0): bun_cli::Cli::log_mut — global CLI log accessor used to
/// flush parser errors on InstallFailed. Registered by bun_runtime::init().
/// Signature: `unsafe fn() -> *mut bun_logger::Log`.
pub static CLI_LOG_HOOK: AtomicPtr<()> = AtomicPtr::new(null_mut());
use bun_fs::FileSystem;
use bun_install::PackageNameHash;
use bun_js_parser::js_printer as js_printer;
use bun_json as json;
use bun_logger as logger;
use bun_paths::{self, PathBuffer, SEP_STR};
use bun_semver::String as SemverString;
use bun_str::strings;
use bun_sys::{self, Fd, File};

use super::{
    attempt_to_create_package_json, CommandLineArguments, PackageJSONEditor, PackageManager,
    PatchCommitResult, Subcommand, UpdateRequest,
};
// TODO(port): `update_request::Array` is a type alias in Zig (likely `ArrayListUnmanaged(UpdateRequest)`).
use super::update_request::Array as UpdateRequestArray;

pub fn update_package_json_and_install_with_manager(
    manager: &mut PackageManager,
    ctx: Command::Context,
    original_cwd: &[u8],
) -> Result<(), Error> {
    // TODO(port): narrow error set
    let mut update_requests = UpdateRequestArray::with_capacity(64);
    // `defer update_requests.deinit(manager.allocator)` — handled by Drop.

    if manager.options.positionals.len() <= 1 {
        match manager.subcommand {
            Subcommand::Add => {
                Output::err_generic(format_args!("no package specified to add"));
                Output::flush();
                CommandLineArguments::print_help(Subcommand::Add);

                Global::exit(0);
            }
            Subcommand::Remove => {
                Output::err_generic(format_args!("no package specified to remove"));
                Output::flush();
                CommandLineArguments::print_help(Subcommand::Remove);

                Global::exit(0);
            }
            Subcommand::Update => {}
            _ => {}
        }
    }

    // PORT NOTE: reshaped for borrowck — capture positionals slice before passing &mut manager.
    let positionals = &manager.options.positionals[1..];
    // TODO(port): borrowck — `positionals` borrows `manager` while `manager` is also `&mut`; may
    // need to clone the slice header or restructure ownership in Phase B.
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
    let mut updates: &mut [UpdateRequest] =
        if manager.subcommand == Subcommand::PatchCommit || manager.subcommand == Subcommand::Patch {
            &mut []
        } else {
            UpdateRequest::parse(
                manager,
                &mut ctx.log,
                positionals,
                update_requests,
                manager.subcommand,
            )
        };
    update_package_json_and_install_with_manager_with_updates(
        manager,
        ctx,
        &mut updates,
        manager.subcommand,
        original_cwd,
    )
}

fn update_package_json_and_install_with_manager_with_updates(
    manager: &mut PackageManager,
    ctx: Command::Context,
    updates: &mut &mut [UpdateRequest],
    subcommand: Subcommand,
    original_cwd: &[u8],
) -> Result<(), Error> {
    // TODO(port): narrow error set
    let log_level = manager.options.log_level;
    if manager.log.errors > 0 {
        if log_level != LogLevel::Silent {
            let _ = manager.log.print(Output::error_writer());
        }
        Global::crash();
    }

    let current_package_json = match manager.workspace_package_json_cache.get_with_path(
        &mut manager.log,
        &manager.original_package_json_path,
        GetWithPathOptions {
            guess_indentation: true,
            ..Default::default()
        },
    ) {
        GetResult::ParseErr(err) => {
            let _ = manager.log.print(Output::error_writer());
            Output::err_generic(format_args!(
                "failed to parse package.json \"{}\": {}",
                BStr::new(&manager.original_package_json_path),
                err.name(),
            ));
            Global::crash();
        }
        GetResult::ReadErr(err) => {
            Output::err_generic(format_args!(
                "failed to read package.json \"{}\": {}",
                BStr::new(&manager.original_package_json_path),
                err.name(),
            ));
            Global::crash();
        }
        GetResult::Entry(entry) => entry,
    };
    let current_package_json_indent = current_package_json.indentation;

    // If there originally was a newline at the end of their package.json, preserve it
    // so that we don't cause unnecessary diffs in their git history.
    // https://github.com/oven-sh/bun/issues/1375
    let preserve_trailing_newline_at_eof_for_package_json = !current_package_json
        .source
        .contents
        .is_empty()
        && current_package_json.source.contents
            [current_package_json.source.contents.len() - 1]
            == b'\n';

    if subcommand == Subcommand::Remove {
        // TODO(port): `Expr.data` tag/payload accessors — using placeholder methods on the AST type.
        if !current_package_json.root.data.is_e_object() {
            Output::err_generic(format_args!(
                "package.json is not an Object {{}}, so there's nothing to {}!",
                <&'static str>::from(subcommand),
            ));
            Global::crash();
        } else if current_package_json.root.data.as_e_object().properties.len() == 0 {
            Output::err_generic(format_args!(
                "package.json is empty {{}}, so there's nothing to {}!",
                <&'static str>::from(subcommand),
            ));
            Global::crash();
        } else if current_package_json.root.as_property(b"devDependencies").is_none()
            && current_package_json.root.as_property(b"dependencies").is_none()
            && current_package_json.root.as_property(b"optionalDependencies").is_none()
            && current_package_json.root.as_property(b"peerDependencies").is_none()
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
                    if let Some(query) = current_package_json.root.as_property(list) {
                        if query.expr.data.is_e_object() {
                            let dependencies = query.expr.data.as_e_object_mut().properties.slice_mut();
                            let mut i: usize = 0;
                            let mut new_len = dependencies.len();
                            while i < dependencies.len() {
                                if dependencies[i].key.as_ref().unwrap().data.is_e_string() {
                                    if dependencies[i]
                                        .key
                                        .as_ref()
                                        .unwrap()
                                        .data
                                        .as_e_string()
                                        .eql_bytes(request.name)
                                    {
                                        if new_len > 1 {
                                            dependencies[i] = dependencies[new_len - 1].clone();
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
                                query.expr.data.as_e_object_mut().properties.len = new_len as u32;

                                // If the dependencies list is now empty, remove it from the package.json
                                // since we're swapRemove, we have to re-sort it
                                if query.expr.data.as_e_object().properties.len == 0 {
                                    // TODO: Theoretically we could change these two lines to
                                    // `.orderedRemove(query.i)`, but would that change user-facing
                                    // behavior?
                                    let _ = current_package_json
                                        .root
                                        .data
                                        .as_e_object_mut()
                                        .properties
                                        .swap_remove(query.i);
                                    current_package_json
                                        .root
                                        .data
                                        .as_e_object_mut()
                                        .package_json_sort();
                                } else {
                                    let obj = query.expr.data.as_e_object_mut();
                                    obj.alphabetize_properties();
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
                PackageJSONEditor::edit(
                    manager,
                    updates,
                    &mut current_package_json.root,
                    dependency_list,
                    EditOptions {
                        exact_versions: manager.options.enable.exact_versions,
                        before_install: true,
                        ..Default::default()
                    },
                )?;
            } else if subcommand == Subcommand::Update {
                PackageJSONEditor::edit_update_no_args(
                    manager,
                    &mut current_package_json.root,
                    EditOptions {
                        exact_versions: true,
                        before_install: true,
                        ..Default::default()
                    },
                )?;
            }
        }
        _ => {
            if manager.options.patch_features == PatchFeatures::Commit {
                let mut pathbuf = PathBuffer::uninit();
                if let Some(stuff) = manager.do_patch_commit(&mut pathbuf, log_level)? {
                    // we're inside a workspace package, we need to edit the
                    // root json, not the `current_package_json`
                    if stuff.not_in_workspace_root {
                        not_in_workspace_root = Some(stuff);
                    } else {
                        PackageJSONEditor::edit_patched_dependencies(
                            manager,
                            &mut current_package_json.root,
                            &stuff.patch_key,
                            &stuff.patchfile_path,
                        )?;
                    }
                }
            }
        }
    }

    manager.to_update = subcommand == Subcommand::Update;

    {
        // Incase it's a pointer to self. Avoid RLS.
        let cloned = *updates;
        // TODO(port): `update_requests` field stores a slice header; in Rust this likely becomes a
        // raw `*mut [UpdateRequest]` or an owned Vec — revisit lifetime in Phase B.
        manager.update_requests = cloned;
    }

    let mut buffer_writer = js_printer::BufferWriter::init();
    buffer_writer
        .buffer
        .list
        .reserve((current_package_json.source.contents.len() + 1).saturating_sub(buffer_writer.buffer.list.len()));
    buffer_writer.append_newline = preserve_trailing_newline_at_eof_for_package_json;
    let mut package_json_writer = js_printer::BufferPrinter::init(buffer_writer);

    let mut written = match js_printer::print_json(
        &mut package_json_writer,
        current_package_json.root,
        &current_package_json.source,
        js_printer::PrintJsonOptions {
            indent: current_package_json_indent,
            mangled_props: None,
            ..Default::default()
        },
    ) {
        Ok(n) => n,
        Err(err) => {
            Output::pretty_errorln(format_args!(
                "package.json failed to write due to error {}",
                err.name(),
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
    let mut new_package_json_source: Box<[u8]> =
        Box::from(package_json_writer.ctx.written_without_trailing_zero());
    // TODO(port): `current_package_json.source.contents` ownership — Zig assigned a duped slice;
    // Rust field type may need to be `Box<[u8]>` or arena-backed. Phase B.
    current_package_json.source.contents = &new_package_json_source[..];

    // may or may not be the package json we are editing
    let top_level_dir_without_trailing_slash =
        strings::without_trailing_slash(FileSystem::instance().top_level_dir);

    let mut root_package_json_path_buf = PathBuffer::uninit();
    let root_package_json_path: &bun_str::ZStr = 'root_package_json_path: {
        root_package_json_path_buf[..top_level_dir_without_trailing_slash.len()]
            .copy_from_slice(top_level_dir_without_trailing_slash);
        root_package_json_path_buf
            [top_level_dir_without_trailing_slash.len()..][..b"/package.json".len()]
            .copy_from_slice(b"/package.json");
        let root_package_json_path_len =
            top_level_dir_without_trailing_slash.len() + b"/package.json".len();
        root_package_json_path_buf[root_package_json_path_len] = 0;
        let root_package_json_path =
            &root_package_json_path_buf[..root_package_json_path_len];

        // The lifetime of this pointer is only valid until the next call to `getWithPath`, which can happen after this scope.
        // https://github.com/oven-sh/bun/issues/12288
        let root_package_json = match manager.workspace_package_json_cache.get_with_path(
            &mut manager.log,
            root_package_json_path,
            GetWithPathOptions {
                guess_indentation: true,
                ..Default::default()
            },
        ) {
            GetResult::ParseErr(err) => {
                let _ = manager.log.print(Output::error_writer());
                Output::err_generic(format_args!(
                    "failed to parse package.json \"{}\": {}",
                    BStr::new(root_package_json_path),
                    err.name(),
                ));
                Global::crash();
            }
            GetResult::ReadErr(err) => {
                Output::err_generic(format_args!(
                    "failed to read package.json \"{}\": {}",
                    BStr::new(&manager.original_package_json_path),
                    err.name(),
                ));
                Global::crash();
            }
            GetResult::Entry(entry) => entry,
        };

        if let Some(stuff) = &not_in_workspace_root {
            PackageJSONEditor::edit_patched_dependencies(
                manager,
                &mut root_package_json.root,
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
                root_package_json.root,
                &root_package_json.source,
                js_printer::PrintJsonOptions {
                    indent: root_package_json.indentation,
                    mangled_props: None,
                    ..Default::default()
                },
            ) {
                Ok(n) => n,
                Err(err) => {
                    Output::pretty_errorln(format_args!(
                        "package.json failed to write due to error {}",
                        err.name(),
                    ));
                    Global::crash();
                }
            };
            root_package_json.source.contents =
                Box::from(package_json_writer2.ctx.written_without_trailing_zero());
        }

        // SAFETY: root_package_json_path_buf[root_package_json_path_len] == 0 written above
        break 'root_package_json_path unsafe {
            bun_str::ZStr::from_raw(
                root_package_json_path_buf.as_ptr(),
                root_package_json_path_len,
            )
        };
    };

    manager.install_with_manager(ctx, root_package_json_path, original_cwd)?;

    if subcommand == Subcommand::Update
        || subcommand == Subcommand::Add
        || subcommand == Subcommand::Link
    {
        for request in updates.iter() {
            if request.failed {
                Global::exit(1);
                return Ok(());
            }
        }

        let source = logger::Source::init_path_string(b"package.json", &new_package_json_source);

        // Now, we _re_ parse our in-memory edited package.json
        // so we can commit the version we changed from the lockfile
        let mut new_package_json = match json::parse_package_json_utf8(&source, &mut manager.log) {
            Ok(v) => v,
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
                    exact_versions: manager.options.enable.exact_versions,
                    ..Default::default()
                },
            )?;
        } else {
            PackageJSONEditor::edit(
                manager,
                updates,
                &mut new_package_json,
                dependency_list,
                EditOptions {
                    exact_versions: manager.options.enable.exact_versions,
                    add_trusted_dependencies: manager.options.do_.trust_dependencies_from_args,
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
            Err(err) => {
                Output::pretty_errorln(format_args!(
                    "package.json failed to write due to error {}",
                    err.name(),
                ));
                Global::crash();
            }
        };

        new_package_json_source =
            Box::from(package_json_writer_two.ctx.written_without_trailing_zero());
    }

    let _ = written;

    if manager.options.do_.write_package_json {
        let (source, path): (&[u8], &bun_str::ZStr) =
            if manager.options.patch_features == PatchFeatures::Commit {
                'source_and_path: {
                    let root_package_json_entry = match manager
                        .workspace_package_json_cache
                        .get_with_path(
                            &mut manager.log,
                            root_package_json_path.as_bytes(),
                            GetWithPathOptions::default(),
                        )
                        .unwrap()
                    {
                        Ok(e) => e,
                        Err(err) => {
                            Output::err(
                                err,
                                format_args!(
                                    "failed to read/parse package.json at '{}'",
                                    BStr::new(root_package_json_path.as_bytes()),
                                ),
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
                (&new_package_json_source, &manager.original_package_json_path)
            };

        // Now that we've run the install step
        // We can save our in-memory package.json to disk
        // TODO(port): Zig used `.handle.stdFile()` to get a `std.fs.File` then `pwriteAll` /
        // `std.posix.ftruncate` / `.close()`. Route through `bun_sys::File` in Phase B.
        let workspace_package_json_file = File::openat(
            Fd::cwd(),
            path,
            bun_sys::O::RDWR,
            0,
        )
        .unwrap()?;

        workspace_package_json_file.pwrite_all(source, 0)?;
        let _ = bun_sys::ftruncate(workspace_package_json_file.handle, source.len() as u64);
        workspace_package_json_file.close();

        if subcommand == Subcommand::Remove {
            if !any_changes {
                Global::exit(0);
                return Ok(());
            }

            // TODO(port): Zig used `std.fs.cwd()` / `cwd.deleteTree` / `Dir.iterate` /
            // `openFileZ` / `deleteFileZ`. PORTING.md forbids `std::fs`; these need
            // `bun_sys::Dir` equivalents in Phase B. Preserving control flow with placeholders.
            let cwd = bun_sys::Dir::cwd();
            // This is not exactly correct
            let mut node_modules_buf = PathBuffer::uninit();
            let prefix = {
                // "node_modules" ++ sep
                let mut p = [0u8; b"node_modules/".len()];
                p[..b"node_modules".len()].copy_from_slice(b"node_modules");
                p[b"node_modules".len()] = bun_paths::SEP;
                p
            };
            node_modules_buf[..prefix.len()].copy_from_slice(&prefix);
            let offset_buf = &mut node_modules_buf[b"node_modules/".len()..];
            let name_hashes = manager.lockfile.packages.items_name_hash();
            for request in updates.iter() {
                // If the package no longer exists in the updated lockfile, delete the directory
                // This is not thorough.
                // It does not handle nested dependencies
                // This is a quick & dirty cleanup intended for when deleting top-level dependencies
                if !name_hashes
                    .iter()
                    .any(|h| *h == SemverString::Builder::string_hash(request.name))
                {
                    offset_buf[..request.name.len()].copy_from_slice(request.name);
                    let _ = cwd.delete_tree(
                        &node_modules_buf[..b"node_modules/".len() + request.name.len()],
                    );
                }
            }

            // This is where we clean dangling symlinks
            // This could be slow if there are a lot of symlinks
            match bun_sys::open_dir(cwd, &manager.options.bin_path) {
                Ok(node_modules_bin_handle) => {
                    let mut node_modules_bin = node_modules_bin_handle;
                    // `defer node_modules_bin.close()` — handled by Drop on `bun_sys::Dir`.
                    let mut iter = node_modules_bin.iterate();
                    'iterator: while let Some(entry) = iter.next().ok().flatten() {
                        match entry.kind {
                            bun_sys::DirEntryKind::SymLink => {
                                // any symlinks which we are unable to open are assumed to be dangling
                                // note that using access won't work here, because access doesn't resolve symlinks
                                node_modules_buf[..entry.name.len()]
                                    .copy_from_slice(entry.name);
                                node_modules_buf[entry.name.len()] = 0;
                                // SAFETY: node_modules_buf[entry.name.len()] == 0 written above
                                let buf: &bun_str::ZStr = unsafe {
                                    bun_str::ZStr::from_raw(
                                        node_modules_buf.as_ptr(),
                                        entry.name.len(),
                                    )
                                };

                                let file = match node_modules_bin.open_file_z(
                                    buf,
                                    bun_sys::OpenOptions::read_only(),
                                ) {
                                    Ok(f) => f,
                                    Err(_) => {
                                        let _ = node_modules_bin.delete_file_z(buf);
                                        continue 'iterator;
                                    }
                                };

                                file.close();
                            }
                            _ => {}
                        }
                    }
                }
                Err(err) => {
                    if err != err!("ENOENT") {
                        Output::err(err, format_args!("while reading node_modules/.bin"));
                        Global::crash();
                    }
                }
            }
        }
    }

    Ok(())
}

pub fn update_package_json_and_install_catch_error(
    ctx: Command::Context,
    subcommand: Subcommand,
) -> Result<(), Error> {
    // TODO(port): narrow error set
    match update_package_json_and_install(ctx, subcommand) {
        Ok(()) => Ok(()),
        Err(e) if e == err!("InstallFailed") || e == err!("InvalidPackageJSON") => {
            // PERF(port): was inline switch — bun_cli::Cli::log_mut() via hook.
            let hook = CLI_LOG_HOOK.load(Ordering::Acquire);
            if !hook.is_null() {
                // SAFETY: CLI_LOG_HOOK is set once at startup to fn() -> *mut Log.
                let f: unsafe fn() -> *mut bun_logger::Log = unsafe { core::mem::transmute(hook) };
                let log = unsafe { &mut *f() };
                let _ = log.print(Output::error_writer());
            }
            Global::exit(1);
        }
        Err(e) => Err(e),
    }
}

fn update_package_json_and_install_and_cli(
    ctx: Command::Context,
    subcommand: Subcommand,
    cli: CommandLineArguments,
) -> Result<(), Error> {
    // TODO(port): narrow error set
    let (manager, original_cwd) = 'brk: {
        match PackageManager::init(ctx, cli.clone(), subcommand) {
            Ok(v) => v,
            Err(err) => {
                if err == bun_core::err!("MissingPackageJSON") {
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
                            break 'brk PackageManager::init(ctx, cli, subcommand)?;
                        }
                    }
                }

                return Err(err);
            }
        }
    };
    // `defer ctx.allocator.free(original_cwd)` — `original_cwd: Box<[u8]>` drops at scope exit.
    let _original_cwd_owner: Box<[u8]> = original_cwd;
    let original_cwd: &[u8] = &_original_cwd_owner;

    if manager.options.should_print_command_name() {
        // Zig: `"..." ++ Global.package_json_version_with_sha ++ "..."` (comptime concat).
        // `concat!` only takes literals; `concatcp!` accepts `const &str` items and yields `&'static str`.
        Output::prettyln(format_args!(
            const_format::concatcp!(
                "<r><b>bun {} <r><d>v",
                bun_core::Global::PACKAGE_JSON_VERSION_WITH_SHA,
                "<r>\n"
            ),
            <&'static str>::from(subcommand),
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

    if manager.options.patch_features == PatchFeatures::Patch {
        manager.prepare_patch()?;
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
            if !manager.options.bin_path.is_empty()
                && matches!(manager.track_installed_bin, TrackInstalledBin::Basename(_))
            {
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
                    bun_core::which(
                        &mut path_buf,
                        path_env,
                        FileSystem::instance().top_level_dir,
                        manager.track_installed_bin.basename(),
                    )
                    .is_none()
                } else {
                    true
                };

                if needs_to_print {
                    Output::pretty_error(format_args!("\n"));

                    Output::warn(format_args!(
                        "To run {}, add the global bin folder to $PATH:\n\n<cyan>{}<r>\n",
                        bun_core::fmt::quote(manager.track_installed_bin.basename()),
                        MoreInstructions {
                            shell: ShellCompletions::Shell::from_env(
                                bun_core::env_var::SHELL.platform_get().unwrap_or(b""),
                            ),
                            folder: &manager.options.bin_path,
                        },
                    ));
                    Output::flush();
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
                bun_core::fmt::fmt_path(
                    &remaining[..space as usize],
                    bun_core::fmt::PathOptions {
                        escape_backslashes: true,
                        path_sep: if cfg!(windows) {
                            bun_core::fmt::PathSep::Windows
                        } else {
                            bun_core::fmt::PathSep::Posix
                        },
                        ..Default::default()
                    },
                ),
            )?;
            writer.write_str("\\ ")?;
            remaining = &remaining[(space as usize + 1).min(remaining.len())..];
        }

        write!(
            writer,
            "{}",
            bun_core::fmt::fmt_path(
                remaining,
                bun_core::fmt::PathOptions {
                    escape_backslashes: true,
                    path_sep: if cfg!(windows) {
                        bun_core::fmt::PathSep::Windows
                    } else {
                        bun_core::fmt::PathSep::Posix
                    },
                    ..Default::default()
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
        let path = ShellPathFormatter { folder: self.folder };
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
                write!(writer, "fish_add_path {}", bun_core::fmt::quote(self.folder))
            }
            ShellCompletions::Shell::Pwsh => {
                write!(writer, "$env:PATH += \";{}\"", path)
            }
        }
    }
}

pub fn update_package_json_and_install(
    ctx: Command::Context,
    subcommand: Subcommand,
) -> Result<(), Error> {
    // TODO(port): narrow error set
    // PERF(port): Zig used `switch (subcommand) { inline else => |cmd| ... }` to monomorphize
    // `CommandLineArguments.parse` per subcommand. Calling with runtime `subcommand` here; if
    // `parse` requires `<const CMD: Subcommand>`, expand to a `match` in Phase B.
    let mut cli = CommandLineArguments::parse(subcommand)?;

    // The way this works:
    // 1. Run the bundler on source files
    // 2. Rewrite positional arguments to act identically to the developer
    //    typing in the dependency names
    // 3. Run the install command
    if cli.analyze {
        let mut analyzer = Analyzer {
            ctx,
            cli: &mut cli,
            subcommand,
        };
        let mut fetcher = bun_bundler::bundle_v2::BundleV2::DependenciesScanner {
            ctx: &mut analyzer as *mut Analyzer as *mut core::ffi::c_void,
            entry_points: &cli.positionals[1..],
            // TODO(port): Zig used `@ptrCast(&Analyzer.onAnalyze)` to erase the `*@This()` param to
            // `*anyopaque`. Provide an `extern "C"` thunk or match `DependenciesScanner.onFetch`'s
            // exact fn-pointer type in Phase B.
            on_fetch: Analyzer::on_analyze_erased,
        };

        // This runs the bundler.
        // PERF(port): was inline switch — bun_cli::BuildCommand::exec via hook (GENUINE b0).
        let hook = BUILD_COMMAND_EXEC_HOOK.load(Ordering::Acquire);
        debug_assert!(!hook.is_null(), "BUILD_COMMAND_EXEC_HOOK unset (bun_runtime::init not called)");
        // SAFETY: hook signature documented on BUILD_COMMAND_EXEC_HOOK; set once at startup.
        let f: unsafe fn(*mut (), *mut ()) -> Result<(), Error> = unsafe { core::mem::transmute(hook) };
        unsafe {
            f(
                Command::get() as *mut _ as *mut (),
                &mut fetcher as *mut _ as *mut (),
            )?;
        }
        return Ok(());
    }

    update_package_json_and_install_and_cli(ctx, subcommand, cli)
}

struct Analyzer<'a> {
    ctx: Command::Context,
    cli: &'a mut CommandLineArguments,
    subcommand: Subcommand,
}

impl Analyzer<'_> {
    pub fn on_analyze(
        &mut self,
        result: &mut bun_bundler::bundle_v2::BundleV2::DependenciesScanner::Result,
    ) -> Result<(), Error> {
        // TODO: add separate argument that makes it so positionals[1..] is not done and instead the positionals are passed
        let keys = result.dependencies.keys();
        let mut positionals: Box<[&[u8]]> =
            vec![&b""[..]; keys.len() + 1].into_boxed_slice();
        positionals[0] = b"add";
        debug_assert_eq!(positionals[1..].len(), keys.len());
        for (dst, src) in positionals[1..].iter_mut().zip(keys.iter()) {
            *dst = *src;
        }
        // TODO(port): `cli.positionals` field type — Zig stored a heap slice of slices; revisit
        // ownership (Box<[&[u8]]> vs Vec) in Phase B.
        self.cli.positionals = positionals;

        update_package_json_and_install_and_cli(self.ctx, self.subcommand, self.cli.clone())?;

        Global::exit(0);
    }

    // TODO(port): type-erased thunk for `DependenciesScanner.onFetch` — exact signature TBD.
    // Zig `anyerror!void` over FFI: `bun_core::Error` is `NonZeroU16`, so `Option<Error>` niche-packs
    // to a plain `u16` where `0` == `None` == success — matching Zig's error-union ABI for `!void`.
    extern "C" fn on_analyze_erased(
        ctx: *mut core::ffi::c_void,
        result: *mut bun_bundler::bundle_v2::BundleV2::DependenciesScanner::Result,
    ) -> Option<Error> {
        // SAFETY: `ctx` was created from `&mut Analyzer` above and outlives this call.
        let this = unsafe { &mut *(ctx as *mut Analyzer) };
        // SAFETY: `result` is a valid `&mut` for the duration of this callback.
        let result = unsafe { &mut *result };
        this.on_analyze(result).err()
    }
}

// TODO(port): these are placeholder names for cross-module enums/structs referenced from Zig.
// Resolve to their real Rust paths in Phase B.
use super::options::{LogLevel, PatchFeatures, TrackInstalledBin};
use super::package_json_editor::EditOptions;
use super::workspace_package_json_cache::{GetResult, GetWithPathOptions};

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/install/PackageManager/updatePackageJSONAndInstall.zig (761 lines)
//   confidence: medium
//   todos:      17
//   notes:      heavy std.fs usage (deleteTree/Dir.iterate) needs bun_sys::Dir; AST e_object accessors and DependenciesScanner callback signature are placeholders; several &mut manager borrows overlap field borrows and will need reshaping
// ──────────────────────────────────────────────────────────────────────────
