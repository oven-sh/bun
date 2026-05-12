use core::fmt;
use std::io::Write as _;

use bun_core::fmt::PathSep;
use bun_core::output::ErrName as _;
use bun_core::{Global, Output, fmt as bun_fmt};
use bun_core::{ZStr, strings};
use bun_paths::platform;
use bun_paths::resolve_path;
use bun_paths::{PathBuffer, Platform, SEP};
use bun_sys::{self as sys, Dir, Fd, FdDirExt as _, FdExt as _};

use crate::bun_fs::FileSystem;
use crate::bun_json as JSON;
use crate::dependency::{Dependency, DependencyExt as _};
use crate::isolated_install::FileCopier;
use crate::lockfile_real::package::{Package, PackageColumns as _};
use crate::lockfile_real::tree;
use crate::lockfile_real::{self as lockfile, Lockfile, PackageIndexEntry};
use crate::package_manager_real::PackageManager;
use crate::package_manager_real::options::{LogLevel, PatchFeatures};
use crate::package_manager_real::package_manager_directories::{
    compute_cache_dir_and_subpath, get_temporary_directory,
};
use crate::{
    BuntagHashBuf, DependencyID, Features, PackageID, buntaghashbuf_make, initialize_store,
    invalid_package_id,
};

#[inline]
fn string_hash(s: &[u8]) -> u64 {
    bun_semver::semver_string::Builder::string_hash(s)
}

pub struct PatchCommitResult {
    pub patch_key: Box<[u8]>,
    pub patchfile_path: Box<[u8]>,
    pub not_in_workspace_root: bool,
}

impl Default for PatchCommitResult {
    fn default() -> Self {
        Self {
            patch_key: Box::default(),
            patchfile_path: Box::default(),
            not_in_workspace_root: false,
        }
    }
}

/// - Arg is the dir containing the package with changes OR name and version
/// - Get the patch file contents by running git diff on the temp dir and the original package dir
/// - Write the patch file to $PATCHES_DIR/$PKG_NAME_AND_VERSION.patch
/// - Update "patchedDependencies" in package.json
/// - Run install to install newly patched pkg
pub fn do_patch_commit(
    manager: &mut PackageManager,
    pathbuf: &mut PathBuffer,
    log_level: LogLevel,
) -> Result<Option<PatchCommitResult>, bun_core::Error> {
    let mut folder_path_buf = PathBuffer::uninit();
    let mut lockfile: Box<Lockfile> = Box::new(Lockfile::default());
    let log = manager.log_mut();
    // TODO(port): narrow error set
    match lockfile.load_from_cwd::<true>(Some(manager), log) {
        lockfile::LoadResult::NotFound => {
            Output::err_generic(
                "Cannot find lockfile. Install packages with `<cyan>bun install<r>` before patching them.",
                (),
            );
            Global::crash();
        }
        lockfile::LoadResult::Err(cause) => {
            if log_level != LogLevel::Silent {
                match cause.step {
                    lockfile::LoadStep::OpenFile => Output::pretty_error(format_args!(
                        "<r><red>error<r> opening lockfile:<r> {}\n<r>",
                        cause.value.name(),
                    )),
                    lockfile::LoadStep::ParseFile => Output::pretty_error(format_args!(
                        "<r><red>error<r> parsing lockfile:<r> {}\n<r>",
                        cause.value.name(),
                    )),
                    lockfile::LoadStep::ReadFile => Output::pretty_error(format_args!(
                        "<r><red>error<r> reading lockfile:<r> {}\n<r>",
                        cause.value.name(),
                    )),
                    lockfile::LoadStep::Migrating => Output::pretty_error(format_args!(
                        "<r><red>error<r> migrating lockfile:<r> {}\n<r>",
                        cause.value.name(),
                    )),
                }

                if manager.options.enable.fail_early() {
                    Output::pretty_error("<b><red>failed to load lockfile<r>\n");
                } else {
                    Output::pretty_error("<b><red>ignoring lockfile<r>\n");
                }

                Output::flush();
            }
            Global::crash();
        }
        lockfile::LoadResult::Ok(_) => {}
    }

    let argument: &'static [u8] = manager.options.positionals[1];
    let arg_kind: PatchArgKind = PatchArgKind::from_arg(argument);

    let workspace_package_id = manager
        .root_package_id
        .get(&lockfile, manager.workspace_name_hash);
    let not_in_workspace_root = workspace_package_id != 0;
    // PORT NOTE: reshaped for borrowck — owned buffer kept separately so `argument` can borrow it
    let argument_owned: Option<Box<[u8]>>;
    let argument: &[u8] = if arg_kind == PatchArgKind::Path
        && not_in_workspace_root
        && (!Platform::Posix.is_absolute(argument)
            || (cfg!(windows) && !Platform::Windows.is_absolute(argument)))
    {
        if let Some(rel_path) = path_argument_relative_to_root_workspace_package(
            &lockfile,
            workspace_package_id,
            argument,
        ) {
            argument_owned = Some(rel_path);
            argument_owned.as_deref().unwrap()
        } else {
            argument
        }
    } else {
        argument
    };
    // `defer if (free_argument) manager.allocator.free(argument);` — handled by Drop of `argument_owned`

    // Attempt to open the existing node_modules folder
    let root_node_modules: Dir = match sys::openat_os_path(
        Fd::cwd(),
        bun_paths::os_path_literal!("node_modules"),
        sys::O::DIRECTORY | sys::O::RDONLY,
        0o755,
    ) {
        Ok(fd) => Dir::from_fd(fd),
        Err(e) => {
            Output::pretty_error(format_args!(
                "<r><red>error<r>: failed to open root <b>node_modules<r> folder: {}<r>\n",
                e
            ));
            Global::crash();
        }
    };
    let _root_node_modules_close = sys::CloseOnDrop::dir(root_node_modules);

    let mut iterator = tree::Iterator::<{ tree::IteratorPathStyle::NodeModules }>::init(&lockfile);
    let mut resolution_buf = [0u8; 1024];
    // PORT NOTE: reshaped for borrowck — `compute_cache_dir_and_subpath` borrows
    // `manager` mutably while the package name/resolution borrow `lockfile`
    // (which itself sometimes aliases `manager.lockfile`). Clone the slice/
    // resolution out first, then compute, then assemble the result tuple.
    let (cache_dir, cache_dir_subpath, changes_dir, pkg): (Dir, &ZStr, Vec<u8>, Package) =
        match arg_kind {
            PatchArgKind::Path => 'result: {
                let package_json_path =
                    resolve_path::join_z::<platform::Auto>(&[argument, b"package.json"]);
                let package_json_source: bun_ast::Source =
                    match bun_ast::to_source(package_json_path, Default::default()) {
                        Ok(s) => s,
                        Err(e) => {
                            Output::err(
                                e,
                                "failed to read {f}",
                                (bun_fmt::quote(package_json_path.as_bytes()),),
                            );
                            Global::crash();
                        }
                    };
                // `defer manager.allocator.free(package_json_source.contents);` — Drop of Source frees contents

                initialize_store();
                let log = manager.log_mut();
                let bump = bun_alloc::Arena::new();
                let json = match JSON::parse_package_json_utf8(&package_json_source, log, &bump) {
                    Ok(j) => j,
                    Err(err) => {
                        let _ = log.print(std::ptr::from_mut(Output::error_writer()));
                        Output::pretty_errorln(format_args!(
                            "<r><red>{}<r> parsing package.json in <b>\"{}\"<r>",
                            err.name(),
                            bstr::BStr::new(package_json_source.path.pretty_dir()),
                        ));
                        Global::crash();
                    }
                };

                let version: &[u8] = 'version: {
                    if let Some(v) = json.get(b"version") {
                        if let bun_ast::ExprData::EString(s) = &v.data {
                            let s = s.data.slice();
                            break 'version s;
                        }
                    }
                    Output::pretty_error(format_args!(
                        "<r><red>error<r>: invalid package.json, missing or invalid property \"version\": {}<r>\n",
                        bstr::BStr::new(package_json_source.path.text()),
                    ));
                    Global::crash();
                };

                let mut resolver: () = ();
                let mut package = Package::default();
                let log = manager.log_mut();
                package.parse_with_json::<()>(
                    &mut lockfile,
                    manager,
                    log,
                    &package_json_source,
                    json,
                    &mut resolver,
                    Features::FOLDER,
                )?;

                let actual_package = match lockfile.package_index.get(&package.name_hash) {
                    None => {
                        Output::pretty_error(
                            "<r><red>error<r>: failed to find package in lockfile package index, this is a bug in Bun. Please file a GitHub issue.<r>\n",
                        );
                        Global::crash();
                    }
                    Some(PackageIndexEntry::Id(id)) => *lockfile.packages.get(*id as usize),
                    Some(PackageIndexEntry::Ids(ids)) => 'brk: {
                        for &id in ids.as_slice() {
                            let pkg = *lockfile.packages.get(id as usize);
                            let total = resolution_buf.len();
                            let mut cursor: &mut [u8] = &mut resolution_buf[..];
                            write!(
                                &mut cursor,
                                "{}",
                                pkg.resolution
                                    .fmt(lockfile.buffers.string_bytes.as_slice(), PathSep::Posix)
                            )
                            .expect("unreachable");
                            let written = total - cursor.len();
                            let resolution_label = &resolution_buf[..written];
                            if resolution_label == version {
                                break 'brk pkg;
                            }
                        }
                        Output::pretty_error(format_args!(
                            "<r><red>error<r>: could not find package with name:<r> {}\n<r>",
                            bstr::BStr::new(
                                package.name.slice(lockfile.buffers.string_bytes.as_slice())
                            ),
                        ));
                        Global::crash();
                    }
                };

                let name = lockfile.str(&package.name).to_vec();
                let resolution_clone = actual_package.resolution;
                let cache_result = compute_cache_dir_and_subpath(
                    manager,
                    &name,
                    &resolution_clone,
                    &mut folder_path_buf,
                    None,
                );
                let cache_dir = cache_result.cache_dir;
                let cache_dir_subpath = cache_result.cache_dir_subpath;

                let changes_dir = argument.to_vec();

                break 'result (cache_dir, cache_dir_subpath, changes_dir, actual_package);
            }
            PatchArgKind::NameAndVersion => 'brk: {
                let (name, version) = Dependency::split_name_and_maybe_version(argument);
                let (pkg_id, node_modules_relative_path) = pkg_info_for_name_and_version(
                    &lockfile,
                    &mut iterator,
                    argument,
                    name,
                    version,
                );

                let changes_dir = resolve_path::join_z_buf::<platform::Auto>(
                    &mut pathbuf[..],
                    &[&node_modules_relative_path, name],
                )
                .as_bytes()
                .to_vec();
                let pkg = *lockfile.packages.get(pkg_id as usize);

                let pkg_name_slice = pkg
                    .name
                    .slice(lockfile.buffers.string_bytes.as_slice())
                    .to_vec();
                let resolution_clone = pkg.resolution;
                let cache_result = compute_cache_dir_and_subpath(
                    manager,
                    &pkg_name_slice,
                    &resolution_clone,
                    &mut folder_path_buf,
                    None,
                );
                let cache_dir = cache_result.cache_dir;
                let cache_dir_subpath = cache_result.cache_dir_subpath;
                break 'brk (cache_dir, cache_dir_subpath, changes_dir, pkg);
            }
        };

    // zls
    let cache_dir: Dir = cache_dir;
    let cache_dir_subpath: &ZStr = cache_dir_subpath;
    let changes_dir: &[u8] = &changes_dir;
    let pkg: Package = pkg;

    let name = pkg.name.slice(lockfile.buffers.string_bytes.as_slice());
    let resolution_label_len = {
        let total = resolution_buf.len();
        let mut cursor: &mut [u8] = &mut resolution_buf[..];
        write!(
            &mut cursor,
            "{}@{}",
            bstr::BStr::new(name),
            pkg.resolution
                .fmt(lockfile.buffers.string_bytes.as_slice(), PathSep::Posix)
        )
        .expect("unreachable");
        total - cursor.len()
    };
    let resolution_label = &resolution_buf[..resolution_label_len];

    let patchfile_contents: Vec<u8> = 'brk: {
        let new_folder = changes_dir;
        let mut buf2 = PathBuffer::uninit();
        let mut buf3 = PathBuffer::uninit();
        let old_folder: &[u8] = 'old_folder: {
            let cache_dir_path = match sys::get_fd_path(cache_dir.fd, &mut buf2) {
                Ok(s) => s,
                Err(e) => {
                    Output::err(e, "failed to read from cache", ());
                    Global::crash();
                }
            };
            break 'old_folder resolve_path::join::<platform::Posix>(&[
                cache_dir_path,
                cache_dir_subpath.as_bytes(),
            ]);
        };

        let random_tempdir = match bun_paths::fs::FileSystem::tmpname(
            b"node_modules_tmp",
            &mut buf2[..],
            bun_core::fast_random(),
        ) {
            Ok(s) => s,
            Err(e) => {
                Output::err(e, "failed to make tempdir", ());
                Global::crash();
            }
        };

        // If the package has nested a node_modules folder, we don't want this to
        // appear in the patch file when we run git diff.
        //
        // There isn't an option to exclude it with `git diff --no-index`, so we
        // will `rename()` it out and back again.
        let has_nested_node_modules: bool = 'has_nested_node_modules: {
            let new_folder_handle =
                match Dir::cwd().open_dir(new_folder, sys::OpenDirOptions::default()) {
                    Ok(h) => h,
                    Err(e) => {
                        Output::err(
                            e,
                            "failed to open directory <b>{s}<r>",
                            (bstr::BStr::new(new_folder),),
                        );
                        Global::crash();
                    }
                };
            let _close = sys::CloseOnDrop::dir(new_folder_handle);

            if sys::renameat_concurrently_a(
                new_folder_handle.fd,
                b"node_modules",
                root_node_modules.fd,
                random_tempdir.as_bytes(),
                sys::RenameOptions {
                    move_fallback: true,
                },
            )
            .is_err()
            {
                break 'has_nested_node_modules false;
            }

            break 'has_nested_node_modules true;
        };

        let patch_tag_tmpname = match bun_paths::fs::FileSystem::tmpname(
            b"patch_tmp",
            &mut buf3[..],
            bun_core::fast_random(),
        ) {
            Ok(s) => s,
            Err(e) => {
                Output::err(e, "failed to make tempdir", ());
                Global::crash();
            }
        };

        let mut bunpatchtagbuf: BuntagHashBuf = BuntagHashBuf::default();
        // If the package was already patched then it might have a ".bun-tag-XXXXXXXX"
        // we need to rename this out and back too.
        let bun_patch_tag: Option<&[u8]> = 'has_bun_patch_tag: {
            let name_and_version_hash = string_hash(resolution_label);
            let patch_tag: &[u8] = 'patch_tag: {
                if let Some(patchdep) = lockfile.patched_dependencies.get(&name_and_version_hash) {
                    if let Some(hash) = patchdep.patchfile_hash() {
                        break 'patch_tag &*buntaghashbuf_make(&mut bunpatchtagbuf, hash);
                    }
                }
                break 'has_bun_patch_tag None;
            };
            let new_folder_handle =
                match Dir::cwd().open_dir(new_folder, sys::OpenDirOptions::default()) {
                    Ok(h) => h,
                    Err(e) => {
                        Output::err(
                            e,
                            "failed to open directory <b>{s}<r>",
                            (bstr::BStr::new(new_folder),),
                        );
                        Global::crash();
                    }
                };
            let _close = sys::CloseOnDrop::dir(new_folder_handle);

            if let Err(e) = sys::renameat_concurrently_a(
                new_folder_handle.fd,
                patch_tag,
                root_node_modules.fd,
                patch_tag_tmpname.as_bytes(),
                sys::RenameOptions {
                    move_fallback: true,
                },
            ) {
                Output::warn(format_args!(
                    "failed renaming the bun patch tag, this may cause issues: {}",
                    e
                ));
                break 'has_bun_patch_tag None;
            }
            break 'has_bun_patch_tag Some(patch_tag);
        };
        // PORT NOTE: deferred restore — one-off rename-back logic on every exit
        // path of `'brk`. Captures borrow into stack buffers.
        scopeguard::defer! {
            if has_nested_node_modules || bun_patch_tag.is_some() {
                let new_folder_handle = match Dir::cwd().open_dir(new_folder, sys::OpenDirOptions::default()) {
                    Ok(h) => h,
                    Err(e) => {
                        Output::pretty_error(format_args!(
                            "<r><red>error<r>: failed to open directory <b>{}<r> {}<r>\n",
                            bstr::BStr::new(new_folder),
                            e,
                        ));
                        Global::crash();
                    }
                };
                let _close = sys::CloseOnDrop::dir(new_folder_handle);

                if has_nested_node_modules {
                    if let Err(e) = sys::renameat_concurrently_a(
                        root_node_modules.fd,
                        random_tempdir.as_bytes(),
                        new_folder_handle.fd,
                        b"node_modules",
                        sys::RenameOptions { move_fallback: true },
                    ) {
                        Output::warn(format_args!("failed renaming nested node_modules folder, this may cause issues: {}", e));
                    }
                }

                if let Some(patch_tag) = bun_patch_tag {
                    if let Err(e) = sys::renameat_concurrently_a(
                        root_node_modules.fd,
                        patch_tag_tmpname.as_bytes(),
                        new_folder_handle.fd,
                        patch_tag,
                        sys::RenameOptions { move_fallback: true },
                    ) {
                        Output::warn(format_args!("failed renaming the bun patch tag, this may cause issues: {}", e));
                    }
                }
            }
        }

        let mut cwdbuf = PathBuffer::uninit();
        let cwd = match sys::getcwd_z(&mut cwdbuf) {
            Ok(fd) => fd,
            Err(e) => {
                Output::pretty_error(format_args!(
                    "<r><red>error<r>: failed to get cwd path {}<r>\n",
                    e
                ));
                Global::crash();
            }
        };
        let mut gitbuf = PathBuffer::uninit();
        let git = match bun_which::which(
            &mut gitbuf,
            bun_core::env_var::PATH.get().unwrap_or(b""),
            cwd.as_bytes(),
            b"git",
        ) {
            Some(g) => g,
            None => {
                Output::pretty_error(
                    "<r><red>error<r>: git must be installed to use `bun patch --commit` <r>\n",
                );
                Global::crash();
            }
        };
        let paths = bun_patch::git_diff_preprocess_paths::<false>(old_folder, new_folder);
        let (opts, _envp_guard) =
            bun_patch::spawn_opts(&paths[0], &paths[1], cwd, git, &mut manager.event_loop);

        let mut spawn_result = match bun_spawn::sync::spawn(&opts) {
            Err(e) => {
                Output::pretty_error(format_args!(
                    "<r><red>error<r>: failed to make diff {}<r>\n",
                    e.name(),
                ));
                Global::crash();
            }
            Ok(Ok(r)) => r,
            Ok(Err(e)) => {
                Output::pretty_error(format_args!(
                    "<r><red>error<r>: failed to make diff {}<r>\n",
                    e
                ));
                Global::crash();
            }
        };

        let contents: Vec<u8> =
            match bun_patch::diff_post_process(&mut spawn_result, &paths[0], &paths[1]) {
                Err(e) => {
                    Output::pretty_error(format_args!(
                        "<r><red>error<r>: failed to make diff {}<r>\n",
                        e.name(),
                    ));
                    Global::crash();
                }
                Ok(Ok(stdout)) => stdout,
                Ok(Err(stderr)) => {
                    struct Truncate<'a> {
                        stderr: &'a Vec<u8>,
                    }

                    impl fmt::Display for Truncate<'_> {
                        fn fmt(&self, writer: &mut fmt::Formatter<'_>) -> fmt::Result {
                            let truncate_stderr = self.stderr.len() > 256;
                            if truncate_stderr {
                                write!(
                                    writer,
                                    "{}... ({} more bytes)",
                                    bstr::BStr::new(&self.stderr[0..256]),
                                    self.stderr.len() - 256
                                )
                            } else {
                                write!(writer, "{}", bstr::BStr::new(&self.stderr[..]))
                            }
                        }
                    }
                    Output::pretty_error(format_args!(
                        "<r><red>error<r>: failed to make diff {}<r>\n",
                        Truncate { stderr: &stderr }
                    ));
                    drop(stderr);
                    Global::crash();
                }
            };

        if contents.is_empty() {
            Output::pretty(format_args!(
                "\n<r>No changes detected, comparing <red>{}<r> to <green>{}<r>\n",
                bstr::BStr::new(old_folder),
                bstr::BStr::new(new_folder)
            ));
            Output::flush();
            drop(contents);
            return Ok(None);
        }

        break 'brk contents;
    };
    // `defer patchfile_contents.deinit();` — Drop

    // write the patch contents to temp file then rename
    let mut tmpname_buf = [0u8; 1024];
    let tempfile_name =
        bun_paths::fs::FileSystem::tmpname(b"tmp", &mut tmpname_buf, bun_core::fast_random())?;
    let tmpdir = get_temporary_directory(manager).handle;
    if let Err(e) = sys::File::write_file(tmpdir.fd, tempfile_name, &patchfile_contents) {
        Output::err(e, "failed to write patch to temp file", ());
        Global::crash();
    }

    resolution_buf[resolution_label_len..resolution_label_len + b".patch".len()]
        .copy_from_slice(b".patch");
    let mut patch_filename: &[u8] = &resolution_buf[0..resolution_label_len + b".patch".len()];
    let escaped_owned: Option<Box<[u8]>>;
    if let Some(escaped) = escape_patch_filename(patch_filename) {
        escaped_owned = Some(escaped);
        patch_filename = escaped_owned.as_deref().unwrap();
    } else {
        escaped_owned = None;
    }
    // `defer if (deinit) manager.allocator.free(patch_filename);` — Drop of escaped_owned
    let _ = &escaped_owned;

    let patches_dir: &[u8] = match &manager.options.patch_features {
        PatchFeatures::Commit { patches_dir } => patches_dir,
        // Reaching `doPatchCommit` implies `Subcommand::PatchCommit`, which always
        // sets `patch_features = .commit` in `Options::load`.
        _ => unreachable!("patch_features must be Commit in doPatchCommit"),
    };

    let path_in_patches_dir =
        resolve_path::join_z::<platform::Posix>(&[patches_dir, patch_filename]);

    // mkdir-p syscall is used here, no JS surface; route directly through
    // `bun_sys::mkdir_recursive` to avoid the `bun_runtime` dep cycle.
    if let Err(e) = sys::mkdir_recursive(patches_dir) {
        Output::err(
            e,
            "failed to make patches dir {f}",
            (bun_fmt::quote(patches_dir),),
        );
        Global::crash();
    }

    // rename to patches dir
    if let Err(e) = sys::renameat_concurrently(
        tmpdir.fd,
        tempfile_name,
        Fd::cwd(),
        path_in_patches_dir,
        sys::RenameOptions {
            move_fallback: true,
        },
    ) {
        Output::err(e, "failed renaming patch file to patches dir", ());
        Global::crash();
    }

    let mut patch_key = Vec::new();
    // PORT NOTE: re-slice instead of reusing `resolution_label` so its borrow ends
    // before the `.patch` suffix write above; the prefix bytes are unchanged.
    write!(
        &mut patch_key,
        "{}",
        bstr::BStr::new(&resolution_buf[..resolution_label_len])
    )
    .expect("infallible: in-memory write");
    let patch_key: Box<[u8]> = patch_key.into_boxed_slice();
    let patchfile_path: Box<[u8]> = Box::<[u8]>::from(path_in_patches_dir.as_bytes());
    let _ = sys::unlink(resolve_path::join_z::<platform::Auto>(&[
        changes_dir,
        b".bun-patch-tag",
    ]));

    Ok(Some(PatchCommitResult {
        patch_key,
        patchfile_path,
        not_in_workspace_root,
    }))
}

#[allow(dead_code)]
fn patch_commit_get_version<'a>(
    buf: &'a mut [u8; 1024],
    patch_tag_path: &ZStr,
) -> sys::Maybe<&'a [u8]> {
    let patch_tag = sys::File::open(patch_tag_path, sys::O::RDONLY, 0)?;
    // we actually need to delete this -- runs after fd close (LIFO drop order)
    scopeguard::defer! { let _ = sys::unlink(patch_tag_path); }
    let _close = sys::CloseOnDrop::file(&patch_tag);

    let version = patch_tag.read_fill_buf(&mut buf[..])?;

    // maybe if someone opens it in their editor and hits save a newline will be inserted,
    // so trim that off
    Ok(strings::trim_right(version, b" \n\r\t"))
}

fn escape_patch_filename(name: &[u8]) -> Option<Box<[u8]>> {
    #[derive(Copy, Clone, PartialEq, Eq)]
    #[repr(u8)]
    enum EscapeVal {
        Slash,
        Backslash,
        Space,
        Newline,
        CarriageReturn,
        Tab,
        // Dot,
        Other,
    }

    impl EscapeVal {
        pub fn escaped(self) -> Option<&'static [u8]> {
            match self {
                EscapeVal::Slash => Some(b"%2F"),
                EscapeVal::Backslash => Some(b"%5c"),
                EscapeVal::Space => Some(b"%20"),
                EscapeVal::Newline => Some(b"%0A"),
                EscapeVal::CarriageReturn => Some(b"%0D"),
                EscapeVal::Tab => Some(b"%09"),
                // EscapeVal::Dot => Some(b"%2E"),
                EscapeVal::Other => None,
            }
        }
    }

    // PORT NOTE: Zig built this table via @typeInfo reflection over single-char enum field names.
    // Rust has no equivalent; the table is filled by hand with the same entries.
    const ESCAPE_TABLE: [EscapeVal; 256] = {
        let mut table = [EscapeVal::Other; 256];
        table[b'/' as usize] = EscapeVal::Slash;
        table[b'\\' as usize] = EscapeVal::Backslash;
        table[b' ' as usize] = EscapeVal::Space;
        table[b'\n' as usize] = EscapeVal::Newline;
        table[b'\r' as usize] = EscapeVal::CarriageReturn;
        table[b'\t' as usize] = EscapeVal::Tab;
        table
    };
    let mut count: usize = 0;
    for &c in name {
        count += if let Some(e) = ESCAPE_TABLE[c as usize].escaped() {
            e.len()
        } else {
            1
        };
    }
    if count == name.len() {
        return None;
    }
    let mut buf = vec![0u8; count].into_boxed_slice();
    let mut i: usize = 0;
    for &c in name {
        let single = [c];
        let e: &[u8] = ESCAPE_TABLE[c as usize].escaped().unwrap_or(&single[..]);
        buf[i..i + e.len()].copy_from_slice(e);
        i += e.len();
    }
    Some(buf)
}

/// 1. Arg is either:
///   - name and possibly version (e.g. "is-even" or "is-even@1.0.0")
///   - path to package in node_modules
/// 2. Calculate cache dir for package
/// 3. Overwrite the input package with the one from the cache (cuz it could be hardlinked)
/// 4. Print to user
pub fn prepare_patch(manager: &mut PackageManager) -> Result<(), bun_core::Error> {
    let argument: &'static [u8] = manager.options.positionals[1];

    let arg_kind: PatchArgKind = PatchArgKind::from_arg(argument);

    let mut folder_path_buf = PathBuffer::uninit();
    let mut resolution_buf = [0u8; 1024];

    #[cfg(windows)]
    let mut win_normalizer = PathBuffer::uninit();

    let workspace_name_hash = manager.workspace_name_hash;
    let workspace_package_id = manager
        .root_package_id
        .get(&manager.lockfile, workspace_name_hash);
    let not_in_workspace_root = workspace_package_id != 0;
    // PORT NOTE: reshaped for borrowck — owned buffer kept so `argument` can borrow it.
    let argument_owned: Option<Box<[u8]>>;
    let argument: &[u8] = if arg_kind == PatchArgKind::Path
        && not_in_workspace_root
        && (!Platform::Posix.is_absolute(argument)
            || (cfg!(windows) && !Platform::Windows.is_absolute(argument)))
    {
        if let Some(rel_path) = path_argument_relative_to_root_workspace_package(
            &manager.lockfile,
            workspace_package_id,
            argument,
        ) {
            argument_owned = Some(rel_path);
            argument_owned.as_deref().unwrap()
        } else {
            argument
        }
    } else {
        argument
    };
    // `defer if (free_argument) manager.allocator.free(argument);` — Drop of argument_owned

    let (cache_dir, cache_dir_subpath, module_folder, pkg_name): (Dir, &[u8], Vec<u8>, Vec<u8>) =
        match arg_kind {
            PatchArgKind::Path => 'brk: {
                let package_json_path =
                    resolve_path::join_z::<platform::Auto>(&[argument, b"package.json"]);
                let package_json_source: bun_ast::Source =
                    match bun_ast::to_source(package_json_path, Default::default()) {
                        Ok(s) => s,
                        Err(e) => {
                            Output::err(
                                e,
                                "failed to read {f}",
                                (bun_fmt::quote(package_json_path.as_bytes()),),
                            );
                            Global::crash();
                        }
                    };
                // `defer manager.allocator.free(package_json_source.contents);` — Drop

                initialize_store();
                let log = manager.log_mut();
                let bump = bun_alloc::Arena::new();
                let json = match JSON::parse_package_json_utf8(&package_json_source, log, &bump) {
                    Ok(j) => j,
                    Err(err) => {
                        let _ = log.print(std::ptr::from_mut(Output::error_writer()));
                        Output::pretty_errorln(format_args!(
                            "<r><red>{}<r> parsing package.json in <b>\"{}\"<r>",
                            err.name(),
                            bstr::BStr::new(package_json_source.path.pretty_dir()),
                        ));
                        Global::crash();
                    }
                };

                let version: &[u8] = 'version: {
                    if let Some(v) = json.get(b"version") {
                        if let bun_ast::ExprData::EString(s) = &v.data {
                            let s = s.data.slice();
                            break 'version s;
                        }
                    }
                    Output::pretty_error(format_args!(
                        "<r><red>error<r>: invalid package.json, missing or invalid property \"version\": {}<r>\n",
                        bstr::BStr::new(package_json_source.path.text()),
                    ));
                    Global::crash();
                };

                let mut resolver: () = ();
                let mut package = Package::default();
                let log = manager.log_mut();
                // PORT NOTE: borrowck — `parse_with_json` needs `&mut Lockfile` and
                // `&mut PackageManager` simultaneously, but the lockfile here is
                // `manager.lockfile`. Temporarily move the Box out so the two
                // borrows are disjoint; `parse_with_json` never reads `pm.lockfile`
                // (it takes the lockfile as its own parameter). Restore before
                // propagating any error so `manager` is never left half-torn.
                let mut lockfile: Box<Lockfile> = core::mem::take(&mut manager.lockfile);
                let parse_result = package.parse_with_json::<()>(
                    &mut lockfile,
                    manager,
                    log,
                    &package_json_source,
                    json,
                    &mut resolver,
                    Features::FOLDER,
                );
                manager.lockfile = lockfile;
                parse_result?;
                let lockfile: &Lockfile = &manager.lockfile;
                let strbuf = lockfile.buffers.string_bytes.as_slice();

                let actual_package = match lockfile.package_index.get(&package.name_hash) {
                    None => {
                        Output::pretty_error(
                            "<r><red>error<r>: failed to find package in lockfile package index, this is a bug in Bun. Please file a GitHub issue.<r>\n",
                        );
                        Global::crash();
                    }
                    Some(PackageIndexEntry::Id(id)) => *lockfile.packages.get(*id as usize),
                    Some(PackageIndexEntry::Ids(ids)) => 'id: {
                        for &id in ids.as_slice() {
                            let pkg = *lockfile.packages.get(id as usize);
                            let total = resolution_buf.len();
                            let mut cursor: &mut [u8] = &mut resolution_buf[..];
                            write!(
                                &mut cursor,
                                "{}",
                                pkg.resolution.fmt(strbuf, PathSep::Posix)
                            )
                            .expect("unreachable");
                            let written = total - cursor.len();
                            let resolution_label = &resolution_buf[..written];
                            if resolution_label == version {
                                break 'id pkg;
                            }
                        }
                        Output::pretty_error(format_args!(
                            "<r><red>error<r>: could not find package with name:<r> {}\n<r>",
                            bstr::BStr::new(package.name.slice(strbuf)),
                        ));
                        Global::crash();
                    }
                };

                let name = lockfile.str(&package.name).to_vec();
                let existing_patchfile_hash: Option<u64> = 'existing_patchfile_hash: {
                    // PERF(port): was stack-fallback alloc — profile in Phase B
                    let mut name_and_version = Vec::new();
                    write!(
                        &mut name_and_version,
                        "{}@{}",
                        bstr::BStr::new(&name),
                        actual_package.resolution.fmt(strbuf, PathSep::Posix)
                    )
                    .expect("unreachable");
                    let name_and_version_hash = string_hash(&name_and_version);
                    if let Some(patched_dep) =
                        lockfile.patched_dependencies.get(&name_and_version_hash)
                    {
                        if let Some(hash) = patched_dep.patchfile_hash() {
                            break 'existing_patchfile_hash Some(hash);
                        }
                    }
                    break 'existing_patchfile_hash None;
                };

                let cache_result = compute_cache_dir_and_subpath(
                    manager,
                    &name,
                    &actual_package.resolution,
                    &mut folder_path_buf,
                    existing_patchfile_hash,
                );
                let cache_dir = cache_result.cache_dir;
                let cache_dir_subpath = cache_result.cache_dir_subpath;

                #[cfg(windows)]
                let buf = resolve_path::path_to_posix_buf::<u8>(argument, &mut win_normalizer[..])
                    .to_vec();
                #[cfg(not(windows))]
                let buf = argument.to_vec();

                break 'brk (cache_dir, cache_dir_subpath.as_bytes(), buf, name);
            }
            PatchArgKind::NameAndVersion => 'brk: {
                let pkg_maybe_version_to_patch = argument;
                let (name, version) =
                    Dependency::split_name_and_maybe_version(pkg_maybe_version_to_patch);
                let mut iterator = tree::Iterator::<{ tree::IteratorPathStyle::NodeModules }>::init(
                    &manager.lockfile,
                );
                let (pkg_id, folder_relative_path) = pkg_info_for_name_and_version(
                    &manager.lockfile,
                    &mut iterator,
                    pkg_maybe_version_to_patch,
                    name,
                    version,
                );

                let strbuf = manager.lockfile.buffers.string_bytes.as_slice();
                let pkg = *manager.lockfile.packages.get(pkg_id as usize);
                let pkg_name = pkg.name.slice(strbuf).to_vec();

                let existing_patchfile_hash: Option<u64> = 'existing_patchfile_hash: {
                    // PERF(port): was stack-fallback alloc — profile in Phase B
                    let mut name_and_version = Vec::new();
                    write!(
                        &mut name_and_version,
                        "{}@{}",
                        bstr::BStr::new(name),
                        pkg.resolution.fmt(strbuf, PathSep::Posix)
                    )
                    .expect("unreachable");
                    let name_and_version_hash = string_hash(&name_and_version);
                    if let Some(patched_dep) = manager
                        .lockfile
                        .patched_dependencies
                        .get(&name_and_version_hash)
                    {
                        if let Some(hash) = patched_dep.patchfile_hash() {
                            break 'existing_patchfile_hash Some(hash);
                        }
                    }
                    break 'existing_patchfile_hash None;
                };

                let pkg_resolution = pkg.resolution;
                let cache_result = compute_cache_dir_and_subpath(
                    manager,
                    &pkg_name,
                    &pkg_resolution,
                    &mut folder_path_buf,
                    existing_patchfile_hash,
                );

                let cache_dir = cache_result.cache_dir;
                let cache_dir_subpath = cache_result.cache_dir_subpath;

                let module_folder_ =
                    resolve_path::join::<platform::Auto>(&[&folder_relative_path, name]);
                #[cfg(windows)]
                let buf =
                    resolve_path::path_to_posix_buf::<u8>(module_folder_, &mut win_normalizer[..])
                        .to_vec();
                #[cfg(not(windows))]
                let buf = module_folder_.to_vec();

                break 'brk (cache_dir, cache_dir_subpath.as_bytes(), buf, pkg_name);
            }
        };

    let module_folder: &[u8] = &module_folder;
    let pkg_name: &[u8] = &pkg_name;

    // The package may be installed using the hard link method,
    // meaning that changes to the folder will also change the package in the cache.
    //
    // So we will overwrite the folder by directly copying the package in cache into it
    //
    // With the isolated linker's global virtual store, `module_folder` is
    // reached *through* a `node_modules/.bun/<storepath>` symlink that points
    // into `<cache>/links/`. `deleteTree(module_folder)` would follow that
    // symlink and wipe the shared global entry (and its dep symlinks)
    // underneath every other project, then FileCopier would write the user's
    // edits into the shared cache. Detach first: walk up `module_folder` to
    // find the first symlink ancestor, replace it with a real directory, and
    // recreate the path below it so the copy lands in a project-local tree.
    detach_module_folder_from_shared_store(module_folder);

    if let Err(e) =
        overwrite_package_in_node_modules_folder(cache_dir, cache_dir_subpath, module_folder)
    {
        Output::pretty_error(format_args!(
            "<r><red>error<r>: error overwriting folder in node_modules: {}\n<r>",
            e.name(),
        ));
        Global::crash();
    }

    if not_in_workspace_root {
        let mut bufn = PathBuffer::uninit();
        Output::pretty(format_args!(
            "\nTo patch <b>{}<r>, edit the following folder:\n\n  <cyan>{}<r>\n",
            bstr::BStr::new(pkg_name),
            bstr::BStr::new(resolve_path::join_string_buf::<platform::Posix>(
                &mut bufn[..],
                &[
                    FileSystem::instance().top_level_dir_without_trailing_slash(),
                    module_folder
                ]
            )),
        ));
        Output::pretty(format_args!(
            "\nOnce you're done with your changes, run:\n\n  <cyan>bun patch --commit '{}'<r>\n",
            bstr::BStr::new(resolve_path::join_string_buf::<platform::Posix>(
                &mut bufn[..],
                &[
                    FileSystem::instance().top_level_dir_without_trailing_slash(),
                    module_folder
                ]
            )),
        ));
    } else {
        Output::pretty(format_args!(
            "\nTo patch <b>{}<r>, edit the following folder:\n\n  <cyan>{}<r>\n",
            bstr::BStr::new(pkg_name),
            bstr::BStr::new(module_folder)
        ));
        Output::pretty(format_args!(
            "\nOnce you're done with your changes, run:\n\n  <cyan>bun patch --commit '{}'<r>\n",
            bstr::BStr::new(module_folder)
        ));
    }

    Ok(())
}

fn detach_module_folder_from_shared_store(module_folder: &[u8]) {
    // `module_folder` reaches here normalised to forward slashes on every
    // platform (see `pathToPosixBuf` in `preparePatch`). Re-normalise to the
    // platform separator so `undo()`/`basename()` walk the path correctly on
    // Windows and the lstat/getFileAttributes calls below see a native path.
    #[cfg(windows)]
    let mut native_buf = PathBuffer::uninit();
    #[cfg(windows)]
    let native: &[u8] = {
        native_buf[0..module_folder.len()].copy_from_slice(module_folder);
        let slice = &mut native_buf[0..module_folder.len()];
        resolve_path::posix_to_platform_in_place::<u8>(slice);
        &*slice
    };
    #[cfg(not(windows))]
    let native: &[u8] = module_folder;

    let mut p = bun_paths::Path::<u8>::from(native).unwrap();
    // `defer path.deinit();` — Drop
    let mut components: usize = 1;
    for &c in native {
        if c == SEP {
            components += 1;
        }
    }
    let mut depth: usize = 0;
    while depth < components {
        let is_symlink: bool = {
            #[cfg(windows)]
            {
                match sys::get_file_attributes(p.slice_z()) {
                    Some(attrs) => attrs.is_reparse_point,
                    None => return,
                }
            }
            #[cfg(not(windows))]
            {
                if let Ok(st) = sys::lstat(p.slice_z()) {
                    sys::posix::s_islnk(st.st_mode as u32)
                } else {
                    return;
                }
            }
        };
        if is_symlink {
            // Windows directory symlinks/junctions are removed with rmdir,
            // file symlinks with unlink; on POSIX unlink covers both. If
            // removal fails the symlink is still live, and the caller's
            // `deleteTree` + `FileCopier` would follow it into the shared
            // global-store entry — so fail loudly here rather than silently
            // corrupting the cache.
            let remove_err: Option<sys::Error> = {
                #[cfg(windows)]
                'remove: {
                    if sys::rmdir(p.slice_z()).is_err() {
                        if let Err(e) = sys::unlink(p.slice_z()) {
                            break 'remove if e.get_errno() == sys::E::ENOENT {
                                None
                            } else {
                                Some(e)
                            };
                        }
                    }
                    break 'remove None;
                }
                #[cfg(not(windows))]
                {
                    if let Err(e) = sys::unlink(p.slice_z()) {
                        if e.get_errno() == sys::E::ENOENT {
                            None
                        } else {
                            Some(e)
                        }
                    } else {
                        None
                    }
                }
            };
            if let Some(e) = remove_err {
                Output::err(
                    e,
                    "failed to detach <b>{s}<r> from the shared package store; refusing to patch through it",
                    (bstr::BStr::new(p.slice()),),
                );
                Global::crash();
            }
            // Re-create the now-missing path segments below the removed
            // symlink so `module_folder`'s parent exists for the copy.
            let parent = resolve_path::dirname::<platform::Auto>(native);
            if !parent.is_empty() {
                let _ = Fd::cwd().make_path(parent);
            }
            return;
        }
        p.undo(1);
        depth += 1;
    }
}

fn overwrite_package_in_node_modules_folder(
    cache_dir: Dir,
    cache_dir_subpath: &[u8],
    node_modules_folder_path: &[u8],
) -> Result<(), bun_core::Error> {
    let _ = Fd::cwd().delete_tree(node_modules_folder_path);

    // FileCopier's path fields are `.unit = .os` (u16 on Windows). `Path::from`
    // is generic over the *input* width and converts internally, so accepting
    // `&[u8]` and producing `Path<OSPathChar>` is intentional. `.sep = .auto`
    // (Zig spec) is required so `/` is normalized to `\` on Windows — the inputs
    // here arrive posix-normalized and are later passed to Win32 APIs.
    let dest_subpath = bun_paths::Path::<
        bun_paths::OSPathChar,
        { bun_paths::path_options::Kind::ANY },
        { bun_paths::path_options::PathSeparators::AUTO },
    >::from(node_modules_folder_path)
    .unwrap();
    // `defer dest_subpath.deinit();` — Drop

    let src_path: bun_paths::AbsPath<
        bun_paths::OSPathChar,
        { bun_paths::path_options::PathSeparators::AUTO },
    > = 'src_path: {
        #[cfg(windows)]
        {
            let mut path_buf = bun_paths::WPathBuffer::uninit();
            let abs_path = sys::get_fd_path_w(cache_dir.fd, &mut path_buf)?;

            let mut sp = bun_paths::AbsPath::<
                bun_paths::OSPathChar,
                { bun_paths::path_options::PathSeparators::AUTO },
            >::from(&*abs_path)
            .unwrap();
            sp.append(cache_dir_subpath)?;

            break 'src_path sp;
        }

        // unused if not windows
        #[cfg(not(windows))]
        {
            break 'src_path bun_paths::AbsPath::init();
        }
    };
    // `defer src_path.deinit();` — Drop

    let cached_package_folder = cache_dir.open_dir(
        cache_dir_subpath,
        sys::OpenDirOptions {
            iterate: true,
            ..Default::default()
        },
    )?;
    let _close = sys::CloseOnDrop::dir(cached_package_folder);

    let ignore_directories: &[&bun_paths::OSPathSlice] = &[
        bun_paths::os_path_literal!("node_modules"),
        bun_paths::os_path_literal!(".git"),
        bun_paths::os_path_literal!("CMakeFiles"),
    ];

    let mut copier: FileCopier = FileCopier::init(
        cached_package_folder.fd,
        src_path,
        dest_subpath,
        ignore_directories,
    )?;
    // `defer copier.deinit();` — Drop

    copier.copy()?;
    Ok(())
}

type NodeModulesIterator<'a> = tree::Iterator<'a, { tree::IteratorPathStyle::NodeModules }>;

// PORT NOTE: reshaped for borrowck — `tree::Iterator::next` returns an
// `IteratorNext<'_>` borrowing the iterator's internal `path_buf`, so we
// cannot return it from inside a `while let` (borrowck rejects the next
// iteration's reborrow even though it's unreachable). Callers only need
// `relative_path`, so copy it out into an owned `Vec<u8>`.

fn node_modules_folder_for_dependency_ids(
    iterator: &mut NodeModulesIterator<'_>,
    ids: &[IdPair],
) -> Option<Vec<u8>> {
    loop {
        let node_modules = iterator.next(None)?;
        let mut found = false;
        for id in ids {
            if node_modules.dependencies.iter().any(|d| *d == id.0) {
                found = true;
                break;
            }
        }
        if found {
            return Some(node_modules.relative_path.as_bytes().to_vec());
        }
    }
}

fn node_modules_folder_for_dependency_id(
    iterator: &mut NodeModulesIterator<'_>,
    dependency_id: DependencyID,
) -> Option<Vec<u8>> {
    loop {
        let node_modules = iterator.next(None)?;
        if !node_modules
            .dependencies
            .iter()
            .any(|d| *d == dependency_id)
        {
            continue;
        }
        return Some(node_modules.relative_path.as_bytes().to_vec());
    }
}

type IdPair = (DependencyID, PackageID);

fn pkg_info_for_name_and_version(
    lockfile: &Lockfile,
    iterator: &mut NodeModulesIterator<'_>,
    pkg_maybe_version_to_patch: &[u8],
    name: &[u8],
    version: Option<&[u8]>,
) -> (PackageID, Vec<u8>) {
    // PERF(port): was stack-fallback alloc — profile in Phase B
    let mut pairs: Vec<IdPair> = Vec::with_capacity(8);

    let name_hash = string_hash(name);

    let strbuf = lockfile.buffers.string_bytes.as_slice();

    let mut buf = [0u8; 1024];
    let dependencies = lockfile.buffers.dependencies.as_slice();

    for (dep_id, dep) in dependencies.iter().enumerate() {
        if dep.name_hash != name_hash {
            continue;
        }
        let pkg_id = lockfile.buffers.resolutions.as_slice()[dep_id];
        if pkg_id == invalid_package_id {
            continue;
        }
        let pkg = *lockfile.packages.get(pkg_id as usize);
        if let Some(v) = version {
            let written = {
                let total = buf.len();
                let mut cursor: &mut [u8] = &mut buf[..];
                write!(
                    &mut cursor,
                    "{}",
                    pkg.resolution.fmt(strbuf, PathSep::Posix)
                )
                .expect("Resolution name too long");
                total - cursor.len()
            };
            let label = &buf[..written];
            if label == v {
                pairs.push((dep_id as DependencyID, pkg_id));
            }
        } else {
            pairs.push((dep_id as DependencyID, pkg_id));
        }
    }

    if pairs.is_empty() {
        Output::pretty_errorln(format_args!(
            "\n<r><red>error<r>: package <b>{}<r> not found<r>",
            bstr::BStr::new(pkg_maybe_version_to_patch)
        ));
        Global::crash();
    }

    // user supplied a version e.g. `is-even@1.0.0`
    if version.is_some() {
        if pairs.len() == 1 {
            let (dep_id, pkg_id) = pairs[0];
            let folder = match node_modules_folder_for_dependency_id(iterator, dep_id) {
                Some(f) => f,
                None => {
                    Output::pretty_error(format_args!(
                        "<r><red>error<r>: could not find the folder for <b>{}<r> in node_modules<r>\n<r>",
                        bstr::BStr::new(pkg_maybe_version_to_patch),
                    ));
                    Global::crash();
                }
            };
            return (pkg_id, folder);
        }

        // we found multiple dependents of the supplied pkg + version
        // the final package in the node_modules might be hoisted
        // so we are going to try looking for each dep id in node_modules
        let (_, pkg_id) = pairs[0];
        let folder = match node_modules_folder_for_dependency_ids(iterator, &pairs) {
            Some(f) => f,
            None => {
                Output::pretty_error(format_args!(
                    "<r><red>error<r>: could not find the folder for <b>{}<r> in node_modules<r>\n<r>",
                    bstr::BStr::new(pkg_maybe_version_to_patch),
                ));
                Global::crash();
            }
        };

        return (pkg_id, folder);
    }

    // Otherwise the user did not supply a version, just the pkg name

    // Only one match, let's use it
    if pairs.len() == 1 {
        let (dep_id, pkg_id) = pairs[0];
        let folder = match node_modules_folder_for_dependency_id(iterator, dep_id) {
            Some(f) => f,
            None => {
                Output::pretty_error(format_args!(
                    "<r><red>error<r>: could not find the folder for <b>{}<r> in node_modules<r>\n<r>",
                    bstr::BStr::new(pkg_maybe_version_to_patch),
                ));
                Global::crash();
            }
        };
        return (pkg_id, folder);
    }

    // Otherwise we have multiple matches
    //
    // There are two cases:
    // a) the multiple matches are all the same underlying package (this happens because there could be multiple dependents of the same package)
    // b) the matches are actually different packages, we'll prompt the user to select which one

    let (_, pkg_id) = pairs[0];
    let count: u32 = {
        let mut count: u32 = 0;
        for pair in &pairs {
            if pair.1 == pkg_id {
                count += 1;
            }
        }
        count
    };

    // Disambiguate case a) from b)
    if count as usize == pairs.len() {
        // It may be hoisted, so we'll try the first one that matches
        let folder = match node_modules_folder_for_dependency_ids(iterator, &pairs) {
            Some(f) => f,
            None => {
                Output::pretty_error(format_args!(
                    "<r><red>error<r>: could not find the folder for <b>{}<r> in node_modules<r>\n<r>",
                    bstr::BStr::new(pkg_maybe_version_to_patch),
                ));
                Global::crash();
            }
        };
        return (pkg_id, folder);
    }

    Output::pretty_errorln(format_args!(
        "\n<r><red>error<r>: Found multiple versions of <b>{}<r>, please specify a precise version from the following list:<r>",
        bstr::BStr::new(name),
    ));
    let mut i: usize = 0;
    while i < pairs.len() {
        let (_, pkgid) = pairs[i];
        if pkgid == invalid_package_id {
            i += 1;
            continue;
        }

        let pkg = *lockfile.packages.get(pkgid as usize);

        Output::pretty_error(format_args!(
            "  {}@<blue>{}<r>\n",
            bstr::BStr::new(pkg.name.slice(strbuf)),
            pkg.resolution.fmt(strbuf, PathSep::Posix)
        ));

        if i + 1 < pairs.len() {
            for p in &mut pairs[i + 1..] {
                if p.1 == pkgid {
                    p.1 = invalid_package_id;
                }
            }
        }
        i += 1;
    }
    Global::crash();
}

// PORT NOTE: takes `workspace_package_id` directly instead of `&mut PackageManager` —
// both callers already compute it via `root_package_id.get()` immediately before, and
// passing `manager` here would alias `&manager.lockfile` in `prepare_patch`.
fn path_argument_relative_to_root_workspace_package(
    lockfile: &Lockfile,
    workspace_package_id: PackageID,
    argument: &[u8],
) -> Option<Box<[u8]>> {
    if workspace_package_id == 0 {
        return None;
    }
    let workspace_res = &lockfile.packages.items_resolution()[workspace_package_id as usize];
    let workspace_str = *workspace_res.workspace();
    let rel_path: &[u8] = workspace_str.slice(lockfile.buffers.string_bytes.as_slice());
    Some(Box::<[u8]>::from(resolve_path::join::<platform::Posix>(&[
        rel_path, argument,
    ])))
}

#[derive(Copy, Clone, PartialEq, Eq)]
enum PatchArgKind {
    Path,
    NameAndVersion,
}

impl PatchArgKind {
    pub fn from_arg(argument: &[u8]) -> PatchArgKind {
        if strings::contains(argument, b"node_modules/") {
            return PatchArgKind::Path;
        }
        // PORT NOTE: spec asymmetry — Zig (patchPackage.zig:1028) uses `hasPrefix`
        // for the Windows-backslash arm but `contains` for the posix arm above.
        // Match the spec exactly; if this is a Zig bug, fix both sides separately.
        if cfg!(windows) && strings::has_prefix(argument, b"node_modules\\") {
            return PatchArgKind::Path;
        }
        PatchArgKind::NameAndVersion
    }
}

// ported from: src/install/PackageManager/patchPackage.zig
