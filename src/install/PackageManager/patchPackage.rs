use core::fmt;
use std::io::Write as _;

use bun_core::{Global, Output, env_var, fmt as bun_fmt};
use bun_paths::{self as path, PathBuffer, SEP};
use bun_str::{strings, ZStr};
use bun_sys::{self as sys, Fd};

use bun_install::{
    BuntagHashBuf, Dependency, DependencyID, Features, FileCopier, PackageID, Resolution,
    buntaghashbuf_make, initialize_store, invalid_package_id,
};
use bun_install::lockfile::{Lockfile, Package};
use bun_install::package_manager::{Options, PackageManager};
use bun_semver::String as SemverString;
use bun_logger as logger;
use bun_json as JSON;

pub struct PatchCommitResult {
    pub patch_key: Box<[u8]>,
    pub patchfile_path: Box<[u8]>,
    pub not_in_workspace_root: bool,
}

impl Default for PatchCommitResult {
    fn default() -> Self {
        Self { patch_key: Box::default(), patchfile_path: Box::default(), not_in_workspace_root: false }
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
    log_level: Options::LogLevel,
) -> Result<Option<PatchCommitResult>, bun_core::Error> {
    let mut folder_path_buf = PathBuffer::uninit();
    let mut lockfile: Box<Lockfile> = Box::new(Lockfile::default());
    // TODO(port): narrow error set
    match lockfile.load_from_cwd(manager, &mut manager.log, true) {
        Lockfile::LoadResult::NotFound => {
            Output::err_generic("Cannot find lockfile. Install packages with `<cyan>bun install<r>` before patching them.", format_args!(""));
            Global::crash();
        }
        Lockfile::LoadResult::Err(cause) => {
            if log_level != Options::LogLevel::Silent {
                match cause.step {
                    Lockfile::LoadStep::OpenFile => Output::pretty_error(
                        "<r><red>error<r> opening lockfile:<r> {s}\n<r>",
                        format_args!("{}", cause.value.name()),
                    ),
                    Lockfile::LoadStep::ParseFile => Output::pretty_error(
                        "<r><red>error<r> parsing lockfile:<r> {s}\n<r>",
                        format_args!("{}", cause.value.name()),
                    ),
                    Lockfile::LoadStep::ReadFile => Output::pretty_error(
                        "<r><red>error<r> reading lockfile:<r> {s}\n<r>",
                        format_args!("{}", cause.value.name()),
                    ),
                    Lockfile::LoadStep::Migrating => Output::pretty_error(
                        "<r><red>error<r> migrating lockfile:<r> {s}\n<r>",
                        format_args!("{}", cause.value.name()),
                    ),
                }

                if manager.options.enable.fail_early {
                    Output::pretty_error("<b><red>failed to load lockfile<r>\n", format_args!(""));
                } else {
                    Output::pretty_error("<b><red>ignoring lockfile<r>\n", format_args!(""));
                }

                Output::flush();
            }
            Global::crash();
        }
        Lockfile::LoadResult::Ok(_) => {}
    }

    let mut argument: &[u8] = manager.options.positionals[1];
    let arg_kind: PatchArgKind = PatchArgKind::from_arg(argument);

    let not_in_workspace_root = manager.root_package_id.get(&lockfile, manager.workspace_name_hash) != 0;
    let mut free_argument = false;
    // PORT NOTE: reshaped for borrowck — owned buffer kept separately so `argument` can borrow it
    let mut argument_owned: Option<Box<[u8]>> = None;
    if arg_kind == PatchArgKind::Path
        && not_in_workspace_root
        && (!path::Platform::Posix.is_absolute(argument)
            || (cfg!(windows) && !path::Platform::Windows.is_absolute(argument)))
    {
        if let Some(rel_path) = path_argument_relative_to_root_workspace_package(manager, &lockfile, argument) {
            free_argument = true;
            argument_owned = Some(rel_path);
            argument = argument_owned.as_ref().unwrap();
        }
    }
    // `defer if (free_argument) manager.allocator.free(argument);` — handled by Drop of `argument_owned`
    let _ = free_argument;

    // Attempt to open the existing node_modules folder
    let root_node_modules: sys::Dir = match sys::openat_os_path(
        Fd::cwd(),
        bun_paths::os_path_literal!("node_modules"),
        sys::O::DIRECTORY | sys::O::RDONLY,
        0o755,
    ) {
        sys::Result::Ok(fd) => sys::Dir::from_fd(fd),
        sys::Result::Err(e) => {
            Output::pretty_error(
                "<r><red>error<r>: failed to open root <b>node_modules<r> folder: {f}<r>\n",
                format_args!("{}", e),
            );
            Global::crash();
        }
    };
    // `defer root_node_modules.close();` — handled by Drop

    let mut iterator = Lockfile::Tree::Iterator::<{ Lockfile::Tree::IterKind::NodeModules }>::init(&lockfile);
    let mut resolution_buf = [0u8; 1024];
    let (cache_dir, cache_dir_subpath, changes_dir, pkg): (sys::Dir, &ZStr, &[u8], Package) = match arg_kind {
        PatchArgKind::Path => 'result: {
            let package_json_source: logger::Source = 'brk: {
                let package_json_path = path::join_z(&[argument, b"package.json"], path::Style::Auto);

                match sys::File::to_source(&package_json_path, Default::default()) {
                    sys::Result::Ok(s) => break 'brk s,
                    sys::Result::Err(e) => {
                        Output::err(e, "failed to read {f}", format_args!("{}", bun_fmt::quote(&package_json_path)));
                        Global::crash();
                    }
                }
            };
            // `defer manager.allocator.free(package_json_source.contents);` — Drop of Source frees contents

            initialize_store();
            let json = match JSON::parse_package_json_utf8(&package_json_source, &mut manager.log) {
                Ok(j) => j,
                Err(err) => {
                    let _ = manager.log.print(Output::error_writer());
                    Output::pretty_errorln(
                        "<r><red>{s}<r> parsing package.json in <b>\"{s}\"<r>",
                        format_args!("{} {}", err.name(), bstr::BStr::new(package_json_source.path.pretty_dir())),
                    );
                    Global::crash();
                }
            };

            let version: &[u8] = 'version: {
                if let Some(v) = json.as_property(b"version") {
                    if let Some(s) = v.expr.as_string() {
                        break 'version s;
                    }
                }
                Output::pretty_error(
                    "<r><red>error<r>: invalid package.json, missing or invalid property \"version\": {s}<r>\n",
                    format_args!("{}", bstr::BStr::new(&package_json_source.path.text)),
                );
                Global::crash();
            };

            let mut resolver: () = ();
            let mut package = Package::default();
            package.parse_with_json::<()>(&mut lockfile, manager, &mut manager.log, &package_json_source, &json, &mut resolver, Features::FOLDER)?;

            let name = lockfile.str(&package.name);
            let actual_package = match lockfile.package_index.get(&package.name_hash) {
                None => {
                    Output::pretty_error(
                        "<r><red>error<r>: failed to find package in lockfile package index, this is a bug in Bun. Please file a GitHub issue.<r>\n",
                        format_args!(""),
                    );
                    Global::crash();
                }
                Some(Lockfile::PackageIndexEntry::Id(id)) => lockfile.packages.get(id),
                Some(Lockfile::PackageIndexEntry::Ids(ids)) => 'brk: {
                    for &id in ids.as_slice() {
                        let pkg = lockfile.packages.get(id);
                        let mut cursor: &mut [u8] = &mut resolution_buf[..];
                        write!(&mut cursor, "{}", pkg.resolution.fmt(lockfile.buffers.string_bytes.as_slice(), path::Style::Posix)).expect("unreachable");
                        let written = resolution_buf.len() - cursor.len();
                        let resolution_label = &resolution_buf[..written];
                        if resolution_label == version {
                            break 'brk pkg;
                        }
                    }
                    Output::pretty_error(
                        "<r><red>error<r>: could not find package with name:<r> {s}\n<r>",
                        format_args!("{}", bstr::BStr::new(package.name.slice(lockfile.buffers.string_bytes.as_slice()))),
                    );
                    Global::crash();
                }
            };

            let cache_result = manager.compute_cache_dir_and_subpath(
                name,
                &actual_package.resolution,
                &mut folder_path_buf,
                None,
            );
            let cache_dir = cache_result.cache_dir;
            let cache_dir_subpath = cache_result.cache_dir_subpath;

            let changes_dir = argument;

            break 'result (cache_dir, cache_dir_subpath, changes_dir, actual_package);
        }
        PatchArgKind::NameAndVersion => 'brk: {
            let (name, version) = Dependency::split_name_and_maybe_version(argument);
            let (pkg_id, node_modules) = pkg_info_for_name_and_version(&mut lockfile, &mut iterator, argument, name, version);

            let changes_dir = path::join_z_buf(&mut pathbuf[..], &[
                node_modules.relative_path,
                name,
            ], path::Style::Auto);
            let pkg = lockfile.packages.get(pkg_id);

            let cache_result = manager.compute_cache_dir_and_subpath(
                pkg.name.slice(lockfile.buffers.string_bytes.as_slice()),
                &pkg.resolution,
                &mut folder_path_buf,
                None,
            );
            let cache_dir = cache_result.cache_dir;
            let cache_dir_subpath = cache_result.cache_dir_subpath;
            break 'brk (cache_dir, cache_dir_subpath, changes_dir.as_bytes(), pkg);
        }
    };

    // zls
    let cache_dir: sys::Dir = cache_dir;
    let cache_dir_subpath: &ZStr = cache_dir_subpath;
    let changes_dir: &[u8] = changes_dir;
    let pkg: Package = pkg;

    let name = pkg.name.slice(lockfile.buffers.string_bytes.as_slice());
    let resolution_label_len = {
        let mut cursor: &mut [u8] = &mut resolution_buf[..];
        write!(&mut cursor, "{}@{}", bstr::BStr::new(name), pkg.resolution.fmt(lockfile.buffers.string_bytes.as_slice(), path::Style::Posix)).expect("unreachable");
        resolution_buf.len() - cursor.len()
    };
    let resolution_label = &resolution_buf[..resolution_label_len];

    let patchfile_contents: Vec<u8> = 'brk: {
        let new_folder = changes_dir;
        let mut buf2 = PathBuffer::uninit();
        let mut buf3 = PathBuffer::uninit();
        let old_folder: &[u8] = 'old_folder: {
            let cache_dir_path = match sys::get_fd_path(Fd::from_std_dir(&cache_dir), &mut buf2) {
                sys::Result::Ok(s) => s,
                sys::Result::Err(e) => {
                    Output::err(e, "failed to read from cache", format_args!(""));
                    Global::crash();
                }
            };
            break 'old_folder path::join(&[
                cache_dir_path,
                cache_dir_subpath.as_bytes(),
            ], path::Style::Posix);
        };

        let random_tempdir = match bun_fs::FileSystem::tmpname("node_modules_tmp", &mut buf2[..], bun_core::fast_random()) {
            Ok(s) => s,
            Err(e) => {
                Output::err(e, "failed to make tempdir", format_args!(""));
                Global::crash();
            }
        };

        // If the package has nested a node_modules folder, we don't want this to
        // appear in the patch file when we run git diff.
        //
        // There isn't an option to exclude it with `git diff --no-index`, so we
        // will `rename()` it out and back again.
        let has_nested_node_modules: bool = 'has_nested_node_modules: {
            let new_folder_handle = match sys::Dir::open_from_cwd(new_folder) {
                Ok(h) => h,
                Err(e) => {
                    Output::err(e, "failed to open directory <b>{s}<r>", format_args!("{}", bstr::BStr::new(new_folder)));
                    Global::crash();
                }
            };
            // `defer new_folder_handle.close();` — Drop

            if sys::renameat_concurrently(
                Fd::from_std_dir(&new_folder_handle),
                b"node_modules",
                Fd::from_std_dir(&root_node_modules),
                random_tempdir,
                sys::RenameOptions { move_fallback: true, ..Default::default() },
            ).as_err().is_some() {
                break 'has_nested_node_modules false;
            }

            break 'has_nested_node_modules true;
        };

        let patch_tag_tmpname = match bun_fs::FileSystem::tmpname("patch_tmp", &mut buf3[..], bun_core::fast_random()) {
            Ok(s) => s,
            Err(e) => {
                Output::err(e, "failed to make tempdir", format_args!(""));
                Global::crash();
            }
        };

        let mut bunpatchtagbuf: BuntagHashBuf = BuntagHashBuf::default();
        // If the package was already patched then it might have a ".bun-tag-XXXXXXXX"
        // we need to rename this out and back too.
        let bun_patch_tag: Option<&ZStr> = 'has_bun_patch_tag: {
            let name_and_version_hash = SemverString::Builder::string_hash(resolution_label);
            let patch_tag: &ZStr = 'patch_tag: {
                if let Some(patchdep) = lockfile.patched_dependencies.get(&name_and_version_hash) {
                    if let Some(hash) = patchdep.patchfile_hash() {
                        break 'patch_tag buntaghashbuf_make(&mut bunpatchtagbuf, hash);
                    }
                }
                break 'has_bun_patch_tag None;
            };
            let new_folder_handle = match sys::Dir::open_from_cwd(new_folder) {
                Ok(h) => h,
                Err(e) => {
                    Output::err(e, "failed to open directory <b>{s}<r>", format_args!("{}", bstr::BStr::new(new_folder)));
                    Global::crash();
                }
            };
            // `defer new_folder_handle.close();` — Drop

            if let Some(e) = sys::renameat_concurrently(
                Fd::from_std_dir(&new_folder_handle),
                patch_tag.as_bytes(),
                Fd::from_std_dir(&root_node_modules),
                patch_tag_tmpname,
                sys::RenameOptions { move_fallback: true, ..Default::default() },
            ).as_err() {
                Output::warn("failed renaming the bun patch tag, this may cause issues: {f}", format_args!("{}", e));
                break 'has_bun_patch_tag None;
            }
            break 'has_bun_patch_tag Some(patch_tag);
        };
        // TODO(port): errdefer-like deferred restore — using scopeguard for the rename-back logic
        let _restore = scopeguard::guard((), |_| {
            if has_nested_node_modules || bun_patch_tag.is_some() {
                let new_folder_handle = match sys::Dir::open_from_cwd(new_folder) {
                    Ok(h) => h,
                    Err(e) => {
                        Output::pretty_error(
                            "<r><red>error<r>: failed to open directory <b>{s}<r> {s}<r>\n",
                            format_args!("{} {}", bstr::BStr::new(new_folder), e.name()),
                        );
                        Global::crash();
                    }
                };

                if has_nested_node_modules {
                    if let Some(e) = sys::renameat_concurrently(
                        Fd::from_std_dir(&root_node_modules),
                        random_tempdir,
                        Fd::from_std_dir(&new_folder_handle),
                        b"node_modules",
                        sys::RenameOptions { move_fallback: true, ..Default::default() },
                    ).as_err() {
                        Output::warn("failed renaming nested node_modules folder, this may cause issues: {f}", format_args!("{}", e));
                    }
                }

                if let Some(patch_tag) = bun_patch_tag {
                    if let Some(e) = sys::renameat_concurrently(
                        Fd::from_std_dir(&root_node_modules),
                        patch_tag_tmpname,
                        Fd::from_std_dir(&new_folder_handle),
                        patch_tag.as_bytes(),
                        sys::RenameOptions { move_fallback: true, ..Default::default() },
                    ).as_err() {
                        Output::warn("failed renaming the bun patch tag, this may cause issues: {f}", format_args!("{}", e));
                    }
                }
            }
        });

        let mut cwdbuf = PathBuffer::uninit();
        let cwd = match sys::getcwd_z(&mut cwdbuf) {
            sys::Result::Ok(fd) => fd,
            sys::Result::Err(e) => {
                Output::pretty_error(
                    "<r><red>error<r>: failed to get cwd path {f}<r>\n",
                    format_args!("{}", e),
                );
                Global::crash();
            }
        };
        let mut gitbuf = PathBuffer::uninit();
        let git = match bun_core::which(&mut gitbuf, env_var::PATH.get().unwrap_or(b""), cwd.as_bytes(), b"git") {
            Some(g) => g,
            None => {
                Output::pretty_error(
                    "<r><red>error<r>: git must be installed to use `bun patch --commit` <r>\n",
                    format_args!(""),
                );
                Global::crash();
            }
        };
        let paths = bun_patch::git_diff_preprocess_paths(old_folder, new_folder, false);
        let opts = bun_patch::spawn_opts(paths[0], paths[1], cwd.as_bytes(), git, &manager.event_loop);

        let mut spawn_result = match bun_core::spawn_sync(&opts) {
            Err(e) => {
                Output::pretty_error(
                    "<r><red>error<r>: failed to make diff {s}<r>\n",
                    format_args!("{}", e.name()),
                );
                Global::crash();
            }
            Ok(sys::Result::Ok(r)) => r,
            Ok(sys::Result::Err(e)) => {
                Output::pretty_error(
                    "<r><red>error<r>: failed to make diff {f}<r>\n",
                    format_args!("{}", e),
                );
                Global::crash();
            }
        };

        let contents: Vec<u8> = match bun_patch::diff_post_process(&mut spawn_result, paths[0], paths[1]) {
            Err(e) => {
                Output::pretty_error(
                    "<r><red>error<r>: failed to make diff {s}<r>\n",
                    format_args!("{}", e.name()),
                );
                Global::crash();
            }
            Ok(sys::Result::Ok(stdout)) => stdout,
            Ok(sys::Result::Err(stderr)) => {
                struct Truncate<'a> {
                    stderr: &'a Vec<u8>,
                }

                impl fmt::Display for Truncate<'_> {
                    fn fmt(&self, writer: &mut fmt::Formatter<'_>) -> fmt::Result {
                        let truncate_stderr = self.stderr.len() > 256;
                        if truncate_stderr {
                            write!(writer, "{}... ({} more bytes)", bstr::BStr::new(&self.stderr[0..256]), self.stderr.len() - 256)
                        } else {
                            write!(writer, "{}", bstr::BStr::new(&self.stderr[..]))
                        }
                    }
                }
                Output::pretty_error(
                    "<r><red>error<r>: failed to make diff {f}<r>\n",
                    format_args!("{}", Truncate { stderr: &stderr }),
                );
                drop(stderr);
                Global::crash();
            }
        };

        if contents.is_empty() {
            Output::pretty("\n<r>No changes detected, comparing <red>{s}<r> to <green>{s}<r>\n", format_args!("{} {}", bstr::BStr::new(old_folder), bstr::BStr::new(new_folder)));
            Output::flush();
            drop(contents);
            return Ok(None);
        }

        break 'brk contents;
    };
    // `defer patchfile_contents.deinit();` — Drop

    // write the patch contents to temp file then rename
    let mut tmpname_buf = [0u8; 1024];
    let tempfile_name = bun_fs::FileSystem::tmpname("tmp", &mut tmpname_buf, bun_core::fast_random())?;
    let tmpdir = manager.get_temporary_directory().handle;
    let tmpfd = match sys::openat(
        Fd::from_std_dir(&tmpdir),
        tempfile_name,
        sys::O::RDWR | sys::O::CREAT,
        0o666,
    ) {
        sys::Result::Ok(fd) => fd,
        sys::Result::Err(e) => {
            Output::err(e, "failed to open temp file", format_args!(""));
            Global::crash();
        }
    };
    // `defer tmpfd.close();` — TODO(port): Fd Drop semantics; explicit close at end of scope
    let _tmpfd_guard = scopeguard::guard(tmpfd, |fd| fd.close());

    if let Some(e) = sys::File::write_all(sys::File { handle: tmpfd }, &patchfile_contents).as_err() {
        Output::err(e, "failed to write patch to temp file", format_args!(""));
        Global::crash();
    }

    resolution_buf[resolution_label_len..resolution_label_len + b".patch".len()].copy_from_slice(b".patch");
    let mut patch_filename: &[u8] = &resolution_buf[0..resolution_label_len + b".patch".len()];
    let mut deinit = false;
    let escaped_owned: Option<Box<[u8]>>;
    if let Some(escaped) = escape_patch_filename(patch_filename) {
        deinit = true;
        escaped_owned = Some(escaped);
        patch_filename = escaped_owned.as_ref().unwrap();
    } else {
        escaped_owned = None;
    }
    // `defer if (deinit) manager.allocator.free(patch_filename);` — Drop of escaped_owned
    let _ = (deinit, &escaped_owned);

    let path_in_patches_dir = path::join_z(
        &[
            &manager.options.patch_features.commit.patches_dir,
            patch_filename,
        ],
        path::Style::Posix,
    );

    let mut nodefs = bun_jsc::node::fs::NodeFS::default();
    let args = bun_jsc::node::fs::Arguments::Mkdir {
        path: bun_jsc::node::fs::PathLike::String(bun_str::PathString::init(&manager.options.patch_features.commit.patches_dir)),
        ..Default::default()
    };
    if let Some(e) = nodefs.mkdir_recursive(&args).as_err() {
        Output::err(e, "failed to make patches dir {f}", format_args!("{}", bun_fmt::quote(args.path.slice())));
        Global::crash();
    }

    // rename to patches dir
    if let Some(e) = sys::renameat_concurrently(
        Fd::from_std_dir(&tmpdir),
        tempfile_name,
        Fd::cwd(),
        path_in_patches_dir.as_bytes(),
        sys::RenameOptions { move_fallback: true, ..Default::default() },
    ).as_err() {
        Output::err(e, "failed renaming patch file to patches dir", format_args!(""));
        Global::crash();
    }

    let mut patch_key = Vec::new();
    write!(&mut patch_key, "{}", bstr::BStr::new(resolution_label)).unwrap();
    let patch_key: Box<[u8]> = patch_key.into_boxed_slice();
    let patchfile_path: Box<[u8]> = Box::<[u8]>::from(path_in_patches_dir.as_bytes());
    let _ = sys::unlink(path::join_z(&[changes_dir, b".bun-patch-tag"], path::Style::Auto).as_bytes());

    Ok(Some(PatchCommitResult {
        patch_key,
        patchfile_path,
        not_in_workspace_root,
    }))
}

fn patch_commit_get_version<'a>(
    buf: &'a mut [u8; 1024],
    patch_tag_path: &ZStr,
) -> sys::Result<&'a [u8]> {
    let patch_tag_fd = match sys::open(patch_tag_path, sys::O::RDONLY, 0) {
        sys::Result::Ok(fd) => fd,
        sys::Result::Err(e) => return sys::Result::Err(e),
    };
    let _guard = scopeguard::guard((), |_| {
        patch_tag_fd.close();
        // we actually need to delete this
        let _ = sys::unlink(patch_tag_path.as_bytes());
    });

    let version = match sys::File::read_fill_buf(sys::File { handle: patch_tag_fd }, &mut buf[..]) {
        sys::Result::Ok(v) => v,
        sys::Result::Err(e) => return sys::Result::Err(e),
    };

    // maybe if someone opens it in their editor and hits save a newline will be inserted,
    // so trim that off
    sys::Result::Ok(strings::trim_right(version, b" \n\r\t"))
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
        count += if let Some(e) = ESCAPE_TABLE[c as usize].escaped() { e.len() } else { 1 };
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
    let strbuf = manager.lockfile.buffers.string_bytes.as_slice();
    let mut argument: &[u8] = manager.options.positionals[1];

    let arg_kind: PatchArgKind = PatchArgKind::from_arg(argument);

    let mut folder_path_buf = PathBuffer::uninit();
    let mut iterator = Lockfile::Tree::Iterator::<{ Lockfile::Tree::IterKind::NodeModules }>::init(manager.lockfile);
    let mut resolution_buf = [0u8; 1024];

    #[cfg(windows)]
    let mut win_normalizer = PathBuffer::uninit();
    #[cfg(not(windows))]
    let mut win_normalizer = ();
    let _ = &win_normalizer;

    let not_in_workspace_root = manager.root_package_id.get(manager.lockfile, manager.workspace_name_hash) != 0;
    let mut free_argument = false;
    let mut argument_owned: Option<Box<[u8]>> = None;
    if arg_kind == PatchArgKind::Path
        && not_in_workspace_root
        && (!path::Platform::Posix.is_absolute(argument)
            || (cfg!(windows) && !path::Platform::Windows.is_absolute(argument)))
    {
        if let Some(rel_path) = path_argument_relative_to_root_workspace_package(manager, manager.lockfile, argument) {
            free_argument = true;
            argument_owned = Some(rel_path);
            argument = argument_owned.as_ref().unwrap();
        }
    }
    // `defer if (free_argument) manager.allocator.free(argument);` — Drop of argument_owned
    let _ = free_argument;

    let (cache_dir, cache_dir_subpath, module_folder, pkg_name): (sys::Dir, &[u8], &[u8], &[u8]) = match arg_kind {
        PatchArgKind::Path => 'brk: {
            let lockfile = manager.lockfile;

            let package_json_source: logger::Source = 'src: {
                let package_json_path = path::join_z(&[argument, b"package.json"], path::Style::Auto);

                match sys::File::to_source(&package_json_path, Default::default()) {
                    sys::Result::Ok(s) => break 'src s,
                    sys::Result::Err(e) => {
                        Output::err(e, "failed to read {f}", format_args!("{}", bun_fmt::quote(&package_json_path)));
                        Global::crash();
                    }
                }
            };
            // `defer manager.allocator.free(package_json_source.contents);` — Drop

            initialize_store();
            let json = match JSON::parse_package_json_utf8(&package_json_source, &mut manager.log) {
                Ok(j) => j,
                Err(err) => {
                    let _ = manager.log.print(Output::error_writer());
                    Output::pretty_errorln(
                        "<r><red>{s}<r> parsing package.json in <b>\"{s}\"<r>",
                        format_args!("{} {}", err.name(), bstr::BStr::new(package_json_source.path.pretty_dir())),
                    );
                    Global::crash();
                }
            };

            let version: &[u8] = 'version: {
                if let Some(v) = json.as_property(b"version") {
                    if let Some(s) = v.expr.as_string() {
                        break 'version s;
                    }
                }
                Output::pretty_error(
                    "<r><red>error<r>: invalid package.json, missing or invalid property \"version\": {s}<r>\n",
                    format_args!("{}", bstr::BStr::new(&package_json_source.path.text)),
                );
                Global::crash();
            };

            let mut resolver: () = ();
            let mut package = Package::default();
            package.parse_with_json::<()>(lockfile, manager, &mut manager.log, &package_json_source, &json, &mut resolver, Features::FOLDER)?;

            let name = lockfile.str(&package.name);
            let actual_package = match lockfile.package_index.get(&package.name_hash) {
                None => {
                    Output::pretty_error(
                        "<r><red>error<r>: failed to find package in lockfile package index, this is a bug in Bun. Please file a GitHub issue.<r>\n",
                        format_args!(""),
                    );
                    Global::crash();
                }
                Some(Lockfile::PackageIndexEntry::Id(id)) => lockfile.packages.get(id),
                Some(Lockfile::PackageIndexEntry::Ids(ids)) => 'id: {
                    for &id in ids.as_slice() {
                        let pkg = lockfile.packages.get(id);
                        let mut cursor: &mut [u8] = &mut resolution_buf[..];
                        write!(&mut cursor, "{}", pkg.resolution.fmt(lockfile.buffers.string_bytes.as_slice(), path::Style::Posix)).expect("unreachable");
                        let written = resolution_buf.len() - cursor.len();
                        let resolution_label = &resolution_buf[..written];
                        if resolution_label == version {
                            break 'id pkg;
                        }
                    }
                    Output::pretty_error(
                        "<r><red>error<r>: could not find package with name:<r> {s}\n<r>",
                        format_args!("{}", bstr::BStr::new(package.name.slice(lockfile.buffers.string_bytes.as_slice()))),
                    );
                    Global::crash();
                }
            };

            let existing_patchfile_hash: Option<u64> = 'existing_patchfile_hash: {
                // PERF(port): was stack-fallback alloc — profile in Phase B
                let mut name_and_version = Vec::new();
                write!(&mut name_and_version, "{}@{}", bstr::BStr::new(name), actual_package.resolution.fmt(strbuf, path::Style::Posix)).expect("unreachable");
                let name_and_version_hash = SemverString::Builder::string_hash(&name_and_version);
                if let Some(patched_dep) = lockfile.patched_dependencies.get(&name_and_version_hash) {
                    if let Some(hash) = patched_dep.patchfile_hash() {
                        break 'existing_patchfile_hash Some(hash);
                    }
                }
                break 'existing_patchfile_hash None;
            };

            let cache_result = manager.compute_cache_dir_and_subpath(
                name,
                &actual_package.resolution,
                &mut folder_path_buf,
                existing_patchfile_hash,
            );
            let cache_dir = cache_result.cache_dir;
            let cache_dir_subpath = cache_result.cache_dir_subpath;

            #[cfg(windows)]
            let buf = path::path_to_posix_buf::<u8>(argument, &mut win_normalizer[..]);
            #[cfg(not(windows))]
            let buf = argument;

            break 'brk (
                cache_dir,
                cache_dir_subpath.as_bytes(),
                buf,
                name,
            );
        }
        PatchArgKind::NameAndVersion => 'brk: {
            let pkg_maybe_version_to_patch = argument;
            let (name, version) = Dependency::split_name_and_maybe_version(pkg_maybe_version_to_patch);
            let (pkg_id, folder) = pkg_info_for_name_and_version(manager.lockfile, &mut iterator, pkg_maybe_version_to_patch, name, version);

            let pkg = manager.lockfile.packages.get(pkg_id);
            let pkg_name = pkg.name.slice(strbuf);

            let existing_patchfile_hash: Option<u64> = 'existing_patchfile_hash: {
                // PERF(port): was stack-fallback alloc — profile in Phase B
                let mut name_and_version = Vec::new();
                write!(&mut name_and_version, "{}@{}", bstr::BStr::new(name), pkg.resolution.fmt(strbuf, path::Style::Posix)).expect("unreachable");
                let name_and_version_hash = SemverString::Builder::string_hash(&name_and_version);
                if let Some(patched_dep) = manager.lockfile.patched_dependencies.get(&name_and_version_hash) {
                    if let Some(hash) = patched_dep.patchfile_hash() {
                        break 'existing_patchfile_hash Some(hash);
                    }
                }
                break 'existing_patchfile_hash None;
            };

            let cache_result = manager.compute_cache_dir_and_subpath(
                pkg_name,
                &pkg.resolution,
                &mut folder_path_buf,
                existing_patchfile_hash,
            );

            let cache_dir = cache_result.cache_dir;
            let cache_dir_subpath = cache_result.cache_dir_subpath;

            let module_folder_ = path::join(&[folder.relative_path, name], path::Style::Auto);
            #[cfg(windows)]
            let buf = path::path_to_posix_buf::<u8>(module_folder_, &mut win_normalizer[..]);
            #[cfg(not(windows))]
            let buf = module_folder_;

            break 'brk (
                cache_dir,
                cache_dir_subpath.as_bytes(),
                buf,
                pkg_name,
            );
        }
    };

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

    if let Err(e) = overwrite_package_in_node_modules_folder(cache_dir, cache_dir_subpath, module_folder) {
        Output::pretty_error(
            "<r><red>error<r>: error overwriting folder in node_modules: {s}\n<r>",
            format_args!("{}", e.name()),
        );
        Global::crash();
    }

    if not_in_workspace_root {
        let mut bufn = PathBuffer::uninit();
        Output::pretty(
            "\nTo patch <b>{s}<r>, edit the following folder:\n\n  <cyan>{s}<r>\n",
            format_args!(
                "{} {}",
                bstr::BStr::new(pkg_name),
                bstr::BStr::new(path::join_string_buf(&mut bufn[..], &[bun_fs::FileSystem::instance().top_level_dir_without_trailing_slash(), module_folder], path::Style::Posix)),
            ),
        );
        Output::pretty(
            "\nOnce you're done with your changes, run:\n\n  <cyan>bun patch --commit '{s}'<r>\n",
            format_args!(
                "{}",
                bstr::BStr::new(path::join_string_buf(&mut bufn[..], &[bun_fs::FileSystem::instance().top_level_dir_without_trailing_slash(), module_folder], path::Style::Posix)),
            ),
        );
    } else {
        Output::pretty("\nTo patch <b>{s}<r>, edit the following folder:\n\n  <cyan>{s}<r>\n", format_args!("{} {}", bstr::BStr::new(pkg_name), bstr::BStr::new(module_folder)));
        Output::pretty("\nOnce you're done with your changes, run:\n\n  <cyan>bun patch --commit '{s}'<r>\n", format_args!("{}", bstr::BStr::new(module_folder)));
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
        path::posix_to_platform_in_place::<u8>(slice);
        &*slice
    };
    #[cfg(not(windows))]
    let native: &[u8] = module_folder;

    let mut p = bun_paths::Path::<{ path::Sep::Auto }>::from(native);
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
                if let Some(st) = sys::lstat(p.slice_z()).as_value() {
                    sys::posix::S::ISLNK(u32::try_from(st.mode).unwrap())
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
                    if sys::rmdir(p.slice_z()).as_err().is_some() {
                        if let Some(e) = sys::unlink(p.slice_z()).as_err() {
                            break 'remove if e.get_errno() == sys::Errno::NOENT { None } else { Some(e) };
                        }
                    }
                    break 'remove None;
                }
                #[cfg(not(windows))]
                {
                    if let Some(e) = sys::unlink(p.slice_z()).as_err() {
                        if e.get_errno() == sys::Errno::NOENT { None } else { Some(e) }
                    } else {
                        None
                    }
                }
            };
            if let Some(e) = remove_err {
                Output::err(e, "failed to detach <b>{s}<r> from the shared package store; refusing to patch through it", format_args!("{}", bstr::BStr::new(p.slice())));
                Global::crash();
            }
            // Re-create the now-missing path segments below the removed
            // symlink so `module_folder`'s parent exists for the copy.
            let parent = path::dirname(native, path::Style::Auto);
            if !parent.is_empty() {
                let _ = Fd::cwd().make_path::<u8>(parent);
            }
            return;
        }
        p.undo(1);
        depth += 1;
    }
}

fn overwrite_package_in_node_modules_folder(
    cache_dir: sys::Dir,
    cache_dir_subpath: &[u8],
    node_modules_folder_path: &[u8],
) -> Result<(), bun_core::Error> {
    let _ = Fd::cwd().delete_tree(node_modules_folder_path);

    let mut dest_subpath = bun_paths::Path::<{ path::Sep::Auto }, { path::Unit::Os }>::from(node_modules_folder_path);
    // `defer dest_subpath.deinit();` — Drop

    let src_path: bun_paths::AbsPath<{ path::Sep::Auto }, { path::Unit::Os }> = 'src_path: {
        #[cfg(windows)]
        {
            let mut path_buf = bun_paths::WPathBuffer::uninit();
            let abs_path = bun_sys::get_fd_path_w(Fd::from_std_dir(&cache_dir), &mut path_buf)?;

            let mut src_path = bun_paths::AbsPath::<{ path::Sep::Auto }, { path::Unit::Os }>::from(abs_path);
            src_path.append(cache_dir_subpath);

            break 'src_path src_path;
        }

        // unused if not windows
        #[cfg(not(windows))]
        {
            break 'src_path bun_paths::AbsPath::init();
        }
    };
    // `defer src_path.deinit();` — Drop

    let cached_package_folder = cache_dir.open_dir(cache_dir_subpath, sys::OpenDirOptions { iterate: true, ..Default::default() })?;
    // `defer cached_package_folder.close();` — Drop

    let ignore_directories: &[&bun_paths::OsPathSlice] = &[
        bun_paths::os_path_literal!("node_modules"),
        bun_paths::os_path_literal!(".git"),
        bun_paths::os_path_literal!("CMakeFiles"),
    ];

    let mut copier: FileCopier = FileCopier::init(
        Fd::from_std_dir(&cached_package_folder),
        src_path,
        dest_subpath,
        ignore_directories,
    )?;
    // `defer copier.deinit();` — Drop

    copier.copy().unwrap()?;
    Ok(())
}

// TODO(port): Lockfile::Tree::Iterator generic over IterKind enum const param
type NodeModulesIterator = Lockfile::Tree::Iterator<{ Lockfile::Tree::IterKind::NodeModules }>;
type NodeModulesNext = <NodeModulesIterator as Iterator>::Next;
// TODO(port): the above `Next` associated type is a guess — Phase B should verify against lockfile/Tree.

fn node_modules_folder_for_dependency_ids(iterator: &mut NodeModulesIterator, ids: &[IdPair]) -> Result<Option<NodeModulesNext>, bun_core::Error> {
    while let Some(node_modules) = iterator.next(None) {
        for id in ids {
            if node_modules.dependencies.iter().position(|d| *d == id.0).is_none() {
                continue;
            }
            return Ok(Some(node_modules));
        }
    }
    Ok(None)
}

fn node_modules_folder_for_dependency_id(iterator: &mut NodeModulesIterator, dependency_id: DependencyID) -> Result<Option<NodeModulesNext>, bun_core::Error> {
    while let Some(node_modules) = iterator.next(None) {
        if node_modules.dependencies.iter().position(|d| *d == dependency_id).is_none() {
            continue;
        }
        return Ok(Some(node_modules));
    }

    Ok(None)
}

type IdPair = (DependencyID, PackageID);

fn pkg_info_for_name_and_version(
    lockfile: &mut Lockfile,
    iterator: &mut NodeModulesIterator,
    pkg_maybe_version_to_patch: &[u8],
    name: &[u8],
    version: Option<&[u8]>,
) -> (PackageID, NodeModulesNext) {
    // PERF(port): was stack-fallback alloc — profile in Phase B
    let mut pairs: Vec<IdPair> = Vec::with_capacity(8);

    let name_hash = SemverString::Builder::string_hash(name);

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
        let pkg = lockfile.packages.get(pkg_id);
        if let Some(v) = version {
            let mut cursor: &mut [u8] = &mut buf[..];
            write!(&mut cursor, "{}", pkg.resolution.fmt(strbuf, path::Style::Posix)).expect("Resolution name too long");
            let written = buf.len() - cursor.len();
            let label = &buf[..written];
            if label == v {
                pairs.push((u32::try_from(dep_id).unwrap(), pkg_id));
            }
        } else {
            pairs.push((u32::try_from(dep_id).unwrap(), pkg_id));
        }
    }

    if pairs.is_empty() {
        Output::pretty_errorln("\n<r><red>error<r>: package <b>{s}<r> not found<r>", format_args!("{}", bstr::BStr::new(pkg_maybe_version_to_patch)));
        Global::crash();
    }

    // user supplied a version e.g. `is-even@1.0.0`
    if version.is_some() {
        if pairs.len() == 1 {
            let (dep_id, pkg_id) = pairs[0];
            let folder = match node_modules_folder_for_dependency_id(iterator, dep_id).expect("unreachable") {
                Some(f) => f,
                None => {
                    Output::pretty_error(
                        "<r><red>error<r>: could not find the folder for <b>{s}<r> in node_modules<r>\n<r>",
                        format_args!("{}", bstr::BStr::new(pkg_maybe_version_to_patch)),
                    );
                    Global::crash();
                }
            };
            return (pkg_id, folder);
        }

        // we found multiple dependents of the supplied pkg + version
        // the final package in the node_modules might be hoisted
        // so we are going to try looking for each dep id in node_modules
        let (_, pkg_id) = pairs[0];
        let folder = match node_modules_folder_for_dependency_ids(iterator, &pairs).expect("unreachable") {
            Some(f) => f,
            None => {
                Output::pretty_error(
                    "<r><red>error<r>: could not find the folder for <b>{s}<r> in node_modules<r>\n<r>",
                    format_args!("{}", bstr::BStr::new(pkg_maybe_version_to_patch)),
                );
                Global::crash();
            }
        };

        return (pkg_id, folder);
    }

    // Otherwise the user did not supply a version, just the pkg name

    // Only one match, let's use it
    if pairs.len() == 1 {
        let (dep_id, pkg_id) = pairs[0];
        let folder = match node_modules_folder_for_dependency_id(iterator, dep_id).expect("unreachable") {
            Some(f) => f,
            None => {
                Output::pretty_error(
                    "<r><red>error<r>: could not find the folder for <b>{s}<r> in node_modules<r>\n<r>",
                    format_args!("{}", bstr::BStr::new(pkg_maybe_version_to_patch)),
                );
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
        let folder = match node_modules_folder_for_dependency_ids(iterator, &pairs).expect("unreachable") {
            Some(f) => f,
            None => {
                Output::pretty_error(
                    "<r><red>error<r>: could not find the folder for <b>{s}<r> in node_modules<r>\n<r>",
                    format_args!("{}", bstr::BStr::new(pkg_maybe_version_to_patch)),
                );
                Global::crash();
            }
        };
        return (pkg_id, folder);
    }

    Output::pretty_errorln(
        "\n<r><red>error<r>: Found multiple versions of <b>{s}<r>, please specify a precise version from the following list:<r>\n",
        format_args!("{}", bstr::BStr::new(name)),
    );
    let mut i: usize = 0;
    while i < pairs.len() {
        let (_, pkgid) = pairs[i];
        if pkgid == invalid_package_id {
            i += 1;
            continue;
        }

        let pkg = lockfile.packages.get(pkgid);

        Output::pretty_error("  {s}@<blue>{f}<r>\n", format_args!("{} {}", bstr::BStr::new(pkg.name.slice(strbuf)), pkg.resolution.fmt(strbuf, path::Style::Posix)));

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

fn path_argument_relative_to_root_workspace_package(manager: &PackageManager, lockfile: &Lockfile, argument: &[u8]) -> Option<Box<[u8]>> {
    let workspace_package_id = manager.root_package_id.get(lockfile, manager.workspace_name_hash);
    if workspace_package_id == 0 {
        return None;
    }
    let workspace_res = &lockfile.packages.items(Lockfile::PackageField::Resolution)[workspace_package_id as usize];
    let rel_path: &[u8] = workspace_res.value.workspace.slice(lockfile.buffers.string_bytes.as_slice());
    Some(Box::<[u8]>::from(path::join(&[rel_path, argument], path::Style::Posix)))
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
        if cfg!(windows) && argument.starts_with(b"node_modules\\") {
            return PatchArgKind::Path;
        }
        PatchArgKind::NameAndVersion
    }
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/install/PackageManager/patchPackage.zig (1070 lines)
//   confidence: medium
//   todos:      4
//   notes:      heavy borrow reshaping around labeled blocks; sys::Dir/Tree::Iterator/NodeFS types are placeholders; defer-restore in do_patch_commit uses scopeguard with captured borrows that may need restructuring
// ──────────────────────────────────────────────────────────────────────────
