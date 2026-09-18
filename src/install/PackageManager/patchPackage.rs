use core::fmt;
use std::io::Write as _;

use bun_core::fmt::PathSep;
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
    BuntagHashBuf, DependencyID, Features, PackageID, Resolution, ResolutionTag,
    buntaghashbuf_make, initialize_store, invalid_package_id,
};

#[inline]
fn string_hash(s: &[u8]) -> u64 {
    bun_semver::semver_string::Builder::string_hash(s)
}

/// Formats `resolution` as the version half of a `name@version` patch key into
/// `label` (cleared first, so one allocation serves a whole candidate loop).
/// Tarball, folder and git resolutions repeat a user-supplied path or URL, so
/// the label has no length bound.
fn print_resolution_label<'a>(
    label: &'a mut Vec<u8>,
    resolution: &Resolution,
    string_buf: &[u8],
) -> &'a [u8] {
    label.clear();
    write!(label, "{}", resolution.fmt(string_buf, PathSep::Posix))
        .expect("formatting into a Vec is infallible");
    label
}

#[derive(Default)]
pub struct PatchCommitResult {
    pub(crate) patch_key: Box<[u8]>,
    pub(crate) patchfile_path: Box<[u8]>,
    pub(crate) not_in_workspace_root: bool,
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
) -> Result<Option<PatchCommitResult>, crate::Error> {
    let mut folder_path_buf = bun_paths::path_buffer_pool::get();
    let mut lockfile: Box<Lockfile> = Box::default();
    let log = manager.log_mut();
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
                    lockfile::LoadStep::OpenFile => bun_core::pretty_error!(
                        "<r><red>error<r> opening lockfile:<r> {}\n<r>",
                        cause.value.name(),
                    ),
                    lockfile::LoadStep::ParseFile => bun_core::pretty_error!(
                        "<r><red>error<r> parsing lockfile:<r> {}\n<r>",
                        cause.value.name(),
                    ),
                    lockfile::LoadStep::ReadFile => bun_core::pretty_error!(
                        "<r><red>error<r> reading lockfile:<r> {}\n<r>",
                        cause.value.name(),
                    ),
                    lockfile::LoadStep::Migrating => bun_core::pretty_error!(
                        "<r><red>error<r> migrating lockfile:<r> {}\n<r>",
                        cause.value.name(),
                    ),
                }

                if manager.options.enable.fail_early() {
                    bun_core::pretty_error!("<b><red>failed to load lockfile<r>\n");
                } else {
                    bun_core::pretty_error!("<b><red>ignoring lockfile<r>\n");
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
    // reshaped for borrowck — owned buffer kept separately so `argument` can borrow it
    let mut argument_owned: Option<Box<[u8]>> = None;
    let argument: &[u8] = if arg_kind == PatchArgKind::Path
        && not_in_workspace_root
        && !Platform::AUTO.is_absolute(argument)
    {
        if let Some(rel_path) = path_argument_relative_to_root_workspace_package(
            &lockfile,
            workspace_package_id,
            argument,
        ) {
            // prepare_patch detaches symlinks; a symlink here means the prepared copy is at the root
            if !is_real_dir_not_symlink(&rel_path) && is_real_dir_not_symlink(argument) {
                argument
            } else {
                argument_owned = Some(rel_path);
                argument_owned.as_deref().unwrap()
            }
        } else {
            argument
        }
    } else {
        argument
    };
    let _ = &argument_owned;

    // Attempt to open the existing node_modules folder
    let root_node_modules: Dir = match sys::openat_os_path(
        Fd::cwd(),
        bun_paths::os_path_literal!("node_modules"),
        sys::O::DIRECTORY | sys::O::RDONLY,
        0o755,
    ) {
        Ok(fd) => Dir::from_fd(fd),
        Err(e) => {
            bun_core::pretty_error!(
                "<r><red>error<r>: failed to open root <b>node_modules<r> folder: {}<r>\n",
                e
            );
            Global::crash();
        }
    };

    let mut iterator = tree::Iterator::<{ tree::IteratorPathStyle::NodeModules }>::init(&lockfile);
    let (changes_dir, pkg): (Vec<u8>, Package) = match arg_kind {
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

            initialize_store();
            let log = manager.log_mut();
            let parsed = match JSON::ParsedJson::parse_package_json(&package_json_source, log) {
                Ok(p) => p,
                Err(err) => {
                    let _ = log.print(std::ptr::from_mut(Output::error_writer()));
                    bun_core::pretty_errorln!(
                        "<r><red>{}<r> parsing package.json in <b>\"{}\"<r>",
                        err.name(),
                        bstr::BStr::new(package_json_source.path.pretty_dir()),
                    );
                    Global::crash();
                }
            };
            let json = parsed.root;

            let version: &[u8] = 'version: {
                if let Some(v) = json.get(b"version") {
                    if let bun_ast::ExprData::EString(s) = &v.data {
                        let s = s.data.slice();
                        break 'version s;
                    }
                }
                bun_core::pretty_error!(
                    "<r><red>error<r>: invalid package.json, missing or invalid property \"version\": {}<r>\n",
                    bstr::BStr::new(package_json_source.path.text()),
                );
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
                    bun_core::pretty_error!(
                        "<r><red>error<r>: failed to find package in lockfile package index, this is a bug in Bun. Please file a GitHub issue.<r>\n",
                    );
                    Global::crash();
                }
                Some(PackageIndexEntry::Id(id)) => *lockfile.packages.get(*id as usize),
                Some(PackageIndexEntry::Ids(ids)) => 'brk: {
                    let mut resolution_label = Vec::new();
                    for &id in ids.as_slice() {
                        let pkg = *lockfile.packages.get(id as usize);
                        if print_resolution_label(
                            &mut resolution_label,
                            &pkg.resolution,
                            lockfile.buffers.string_bytes.as_slice(),
                        ) == version
                        {
                            break 'brk pkg;
                        }
                    }
                    bun_core::pretty_error!(
                        "<r><red>error<r>: could not find package with name:<r> {}\n<r>",
                        bstr::BStr::new(
                            package.name.slice(lockfile.buffers.string_bytes.as_slice())
                        ),
                    );
                    Global::crash();
                }
            };

            break 'result (argument.to_vec(), actual_package);
        }
        PatchArgKind::NameAndVersion => 'brk: {
            let (name, version) = Dependency::split_name_and_maybe_version(argument);
            let (pkg_id, node_modules_relative_path) =
                pkg_info_for_name_and_version(&lockfile, &mut iterator, argument, name, version);

            let changes_dir = resolve_path::join_z_buf::<platform::Auto>(
                &mut pathbuf[..],
                &[&node_modules_relative_path, name],
            )
            .as_bytes()
            .to_vec();
            break 'brk (changes_dir, *lockfile.packages.get(pkg_id as usize));
        }
    };

    // `compute_cache_dir_and_subpath` resolves `pkg.resolution`'s strings against `manager.lockfile`.
    manager.lockfile = lockfile;
    let name = manager.lockfile.str(&pkg.name).to_vec();
    let cache_result =
        compute_cache_dir_and_subpath(manager, &name, &pkg.resolution, &mut folder_path_buf, None);
    let cache_dir: Fd = cache_result.cache_dir;
    let cache_dir_subpath: &ZStr = cache_result.cache_dir_subpath;
    let changes_dir: &[u8] = &changes_dir;
    let lockfile: &Lockfile = &manager.lockfile;

    let name = name.as_slice();
    let mut patch_key = Vec::new();
    write!(
        &mut patch_key,
        "{}@{}",
        bstr::BStr::new(name),
        pkg.resolution
            .fmt(lockfile.buffers.string_bytes.as_slice(), PathSep::Posix)
    )
    .expect("formatting into a Vec is infallible");

    let source_is_cache_entry = is_cache_entry(pkg.resolution.tag);
    let patchfile_contents: Vec<u8> = 'brk: {
        let new_folder = changes_dir;
        let mut buf2 = bun_paths::path_buffer_pool::get();
        let mut buf3 = bun_paths::path_buffer_pool::get();
        let old_folder: Vec<u8> = 'old_folder: {
            let cache_dir_path = match sys::get_fd_path(cache_dir, &mut buf2) {
                Ok(s) => s,
                Err(e) => {
                    Output::err(e, "failed to read from cache", ());
                    Global::crash();
                }
            };
            break 'old_folder resolve_path::join::<platform::Posix>(&[
                cache_dir_path,
                cache_dir_subpath.as_bytes(),
            ])
            .to_vec();
        };
        let old_folder: &[u8] = &old_folder;

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

        // `git diff --no-index` takes no pathspec: the packages bun installed move out and back.
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

            let Ok(nested) = new_folder_handle.open_dir(b"node_modules", ITERATE) else {
                break 'has_nested_node_modules false;
            };
            // A folder or workspace source has its own installs in `node_modules`, not bundled ones.
            let cache_nested = if source_is_cache_entry {
                match Dir::cwd().open_dir(
                    resolve_path::join::<platform::Auto>(&[old_folder, b"node_modules"]),
                    sys::OpenDirOptions::default(),
                ) {
                    Ok(d) => Some(d),
                    Err(e) if e.get_errno() == sys::E::ENOENT => None,
                    Err(e) => {
                        Output::err(e, "failed to read from cache", ());
                        Global::crash();
                    }
                }
            } else {
                None
            };
            let tempdir = match root_node_modules
                .make_open_path(random_tempdir.as_bytes(), sys::OpenDirOptions::default())
            {
                Ok(d) => d,
                Err(e) => {
                    Output::err(e, "failed to make tempdir", ());
                    Global::crash();
                }
            };
            if let Err(e) = move_entries_absent_from(&nested, cache_nested.as_ref(), &tempdir, true)
            {
                drop((nested, cache_nested, tempdir));
                if let Err(e) = restore_nested_from_tempdir(
                    &root_node_modules,
                    random_tempdir.as_bytes(),
                    &new_folder_handle,
                ) {
                    bun_core::warn!(
                        "failed restoring nested node_modules folder, this may cause issues: {}",
                        e
                    );
                }
                Output::err(e, "failed moving the nested node_modules folder aside", ());
                Global::crash();
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
            let name_and_version_hash = string_hash(&patch_key);
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

            if let Err(e) = sys::renameat_concurrently_a(
                new_folder_handle.fd,
                patch_tag,
                root_node_modules.fd,
                patch_tag_tmpname.as_bytes(),
                sys::RenameOptions {
                    move_fallback: true,
                },
            ) {
                bun_core::warn!(
                    "failed renaming the bun patch tag, this may cause issues: {}",
                    e
                );
                break 'has_bun_patch_tag None;
            }
            break 'has_bun_patch_tag Some(patch_tag);
        };
        // deferred restore — one-off rename-back logic on every exit
        // path of `'brk`. Captures borrow into stack buffers.
        scopeguard::defer! {
            if has_nested_node_modules || bun_patch_tag.is_some() {
                let new_folder_handle = match Dir::cwd().open_dir(new_folder, sys::OpenDirOptions::default()) {
                    Ok(h) => h,
                    Err(e) => {
                        bun_core::pretty_error!(
                            "<r><red>error<r>: failed to open directory <b>{}<r> {}<r>\n",
                            bstr::BStr::new(new_folder),
                            e,
                        );
                        Global::crash();
                    }
                };

                if has_nested_node_modules {
                    if let Err(e) = restore_nested_from_tempdir(&root_node_modules, random_tempdir.as_bytes(), &new_folder_handle) {
                        bun_core::warn!("failed restoring nested node_modules folder, this may cause issues: {}", e);
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
                        bun_core::warn!("failed renaming the bun patch tag, this may cause issues: {}", e);
                    }
                }
            }
        }

        let mut cwdbuf = bun_paths::path_buffer_pool::get();
        let cwd = match sys::getcwd_z(&mut cwdbuf) {
            Ok(fd) => fd,
            Err(e) => {
                bun_core::pretty_error!("<r><red>error<r>: failed to get cwd path {}<r>\n", e);
                Global::crash();
            }
        };
        let mut gitbuf = bun_paths::path_buffer_pool::get();
        let git = match bun_which::which(
            &mut gitbuf,
            bun_core::env_var::PATH.get().unwrap_or(b""),
            cwd.as_bytes(),
            b"git",
        ) {
            Some(g) => g,
            None => {
                bun_core::pretty_error!(
                    "<r><red>error<r>: git must be installed to use `bun patch --commit` <r>\n",
                );
                Global::crash();
            }
        };
        let paths = bun_patch::git_diff_preprocess_paths(old_folder, new_folder);
        let (opts, _envp_guard) =
            bun_patch::spawn_opts(&paths[0], &paths[1], cwd, git, &mut manager.event_loop);

        let mut spawn_result = match bun_spawn::sync::spawn(&opts) {
            Err(e) => {
                bun_core::pretty_error!("<r><red>error<r>: failed to make diff {}<r>\n", e.name(),);
                Global::crash();
            }
            Ok(Ok(r)) => r,
            Ok(Err(e)) => {
                bun_core::pretty_error!("<r><red>error<r>: failed to make diff {}<r>\n", e);
                Global::crash();
            }
        };

        let contents: Vec<u8> =
            match bun_patch::diff_post_process(&mut spawn_result, &paths[0], &paths[1]) {
                Err(e) => {
                    bun_core::pretty_error!(
                        "<r><red>error<r>: failed to make diff {}<r>\n",
                        e.name(),
                    );
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
                    bun_core::pretty_error!(
                        "<r><red>error<r>: failed to make diff {}<r>\n",
                        Truncate { stderr: &stderr }
                    );
                    drop(stderr);
                    Global::crash();
                }
            };

        if contents.is_empty() {
            bun_core::pretty!(
                "\n<r>No changes detected, comparing <red>{}<r> to <green>{}<r>\n",
                bstr::BStr::new(old_folder),
                bstr::BStr::new(new_folder)
            );
            Output::flush();
            drop(contents);
            return Ok(None);
        }

        break 'brk contents;
    };

    // write the patch contents to temp file then rename
    let mut tmpname_buf = [0u8; 1024];
    let tempfile_name =
        bun_paths::fs::FileSystem::tmpname(b"tmp", &mut tmpname_buf, bun_core::fast_random())?;
    let tmpdir = get_temporary_directory(manager).handle.fd();
    if let Err(e) = sys::File::write_file(tmpdir, tempfile_name, &patchfile_contents) {
        Output::err(e, "failed to write patch to temp file", ());
        Global::crash();
    }

    let unescaped_patch_filename = [patch_key.as_slice(), b".patch"].concat();
    let escaped_patch_filename = escape_patch_filename(&unescaped_patch_filename);
    let patch_filename: &[u8] = escaped_patch_filename
        .as_deref()
        .unwrap_or(&unescaped_patch_filename);

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
        tmpdir,
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

    let patchfile_path: Box<[u8]> = Box::<[u8]>::from(path_in_patches_dir.as_bytes());
    let _ = sys::unlink(resolve_path::join_z::<platform::Auto>(&[
        changes_dir,
        b".bun-patch-tag",
    ]));

    Ok(Some(PatchCommitResult {
        patch_key: patch_key.into_boxed_slice(),
        patchfile_path,
        not_in_workspace_root,
    }))
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
        // NTFS-reserved; escaped on every OS so a committed patches/ dir checks out on Windows.
        Colon,
        Question,
        Asterisk,
        Quote,
        LessThan,
        GreaterThan,
        Pipe,
        // Dot,
        Other,
    }

    impl EscapeVal {
        fn escaped(self) -> Option<&'static [u8]> {
            match self {
                EscapeVal::Slash => Some(b"%2F"),
                EscapeVal::Backslash => Some(b"%5c"),
                EscapeVal::Space => Some(b"%20"),
                EscapeVal::Newline => Some(b"%0A"),
                EscapeVal::CarriageReturn => Some(b"%0D"),
                EscapeVal::Tab => Some(b"%09"),
                EscapeVal::Colon => Some(b"%3A"),
                EscapeVal::Question => Some(b"%3F"),
                EscapeVal::Asterisk => Some(b"%2A"),
                EscapeVal::Quote => Some(b"%22"),
                EscapeVal::LessThan => Some(b"%3C"),
                EscapeVal::GreaterThan => Some(b"%3E"),
                EscapeVal::Pipe => Some(b"%7C"),
                // EscapeVal::Dot => Some(b"%2E"),
                EscapeVal::Other => None,
            }
        }
    }

    // The table is filled by hand.
    const ESCAPE_TABLE: [EscapeVal; 256] = {
        let mut table = [EscapeVal::Other; 256];
        table[b'/' as usize] = EscapeVal::Slash;
        table[b'\\' as usize] = EscapeVal::Backslash;
        table[b' ' as usize] = EscapeVal::Space;
        table[b'\n' as usize] = EscapeVal::Newline;
        table[b'\r' as usize] = EscapeVal::CarriageReturn;
        table[b'\t' as usize] = EscapeVal::Tab;
        table[b':' as usize] = EscapeVal::Colon;
        table[b'?' as usize] = EscapeVal::Question;
        table[b'*' as usize] = EscapeVal::Asterisk;
        table[b'"' as usize] = EscapeVal::Quote;
        table[b'<' as usize] = EscapeVal::LessThan;
        table[b'>' as usize] = EscapeVal::GreaterThan;
        table[b'|' as usize] = EscapeVal::Pipe;
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
pub fn prepare_patch(manager: &mut PackageManager) -> Result<(), crate::Error> {
    let argument: &'static [u8] = manager.options.positionals[1];

    let arg_kind: PatchArgKind = PatchArgKind::from_arg(argument);

    let mut folder_path_buf = bun_paths::path_buffer_pool::get();

    #[cfg(windows)]
    let mut win_normalizer = bun_paths::path_buffer_pool::get();

    let workspace_name_hash = manager.workspace_name_hash;
    let workspace_package_id = manager
        .root_package_id
        .get(&manager.lockfile, workspace_name_hash);
    let not_in_workspace_root = workspace_package_id != 0;
    // reshaped for borrowck — owned buffer kept so `argument` can borrow it.
    let argument_owned: Option<Box<[u8]>>;
    let argument: &[u8] = if arg_kind == PatchArgKind::Path
        && not_in_workspace_root
        && !Platform::AUTO.is_absolute(argument)
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

    let resolution_tag: ResolutionTag;
    let (cache_dir, cache_dir_subpath, module_folder, pkg_name): (Fd, &[u8], Vec<u8>, Vec<u8>) =
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

                initialize_store();
                let log = manager.log_mut();
                let parsed = match JSON::ParsedJson::parse_package_json(&package_json_source, log) {
                    Ok(p) => p,
                    Err(err) => {
                        let _ = log.print(std::ptr::from_mut(Output::error_writer()));
                        bun_core::pretty_errorln!(
                            "<r><red>{}<r> parsing package.json in <b>\"{}\"<r>",
                            err.name(),
                            bstr::BStr::new(package_json_source.path.pretty_dir()),
                        );
                        Global::crash();
                    }
                };
                let json = parsed.root;

                let version: &[u8] = 'version: {
                    if let Some(v) = json.get(b"version") {
                        if let bun_ast::ExprData::EString(s) = &v.data {
                            let s = s.data.slice();
                            break 'version s;
                        }
                    }
                    bun_core::pretty_error!(
                        "<r><red>error<r>: invalid package.json, missing or invalid property \"version\": {}<r>\n",
                        bstr::BStr::new(package_json_source.path.text()),
                    );
                    Global::crash();
                };

                let mut resolver: () = ();
                let mut package = Package::default();
                let log = manager.log_mut();
                // borrowck — `parse_with_json` needs `&mut Lockfile` and
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
                        bun_core::pretty_error!(
                            "<r><red>error<r>: failed to find package in lockfile package index, this is a bug in Bun. Please file a GitHub issue.<r>\n",
                        );
                        Global::crash();
                    }
                    Some(PackageIndexEntry::Id(id)) => *lockfile.packages.get(*id as usize),
                    Some(PackageIndexEntry::Ids(ids)) => 'id: {
                        let mut resolution_label = Vec::new();
                        for &id in ids.as_slice() {
                            let pkg = *lockfile.packages.get(id as usize);
                            if print_resolution_label(
                                &mut resolution_label,
                                &pkg.resolution,
                                strbuf,
                            ) == version
                            {
                                break 'id pkg;
                            }
                        }
                        bun_core::pretty_error!(
                            "<r><red>error<r>: could not find package with name:<r> {}\n<r>",
                            bstr::BStr::new(package.name.slice(strbuf)),
                        );
                        Global::crash();
                    }
                };

                let name = lockfile.str(&package.name).to_vec();
                let existing_patchfile_hash: Option<u64> = 'existing_patchfile_hash: {
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

                resolution_tag = actual_package.resolution.tag;
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

                resolution_tag = pkg_resolution.tag;
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

    if let Err(e) = overwrite_package_in_node_modules_folder(
        cache_dir,
        cache_dir_subpath,
        module_folder,
        is_cache_entry(resolution_tag),
    ) {
        bun_core::pretty_error!(
            "<r><red>error<r>: error overwriting folder in node_modules: {}\n<r>",
            e.name(),
        );
        Global::crash();
    }

    if not_in_workspace_root {
        let mut bufn = bun_paths::path_buffer_pool::get();
        bun_core::pretty!(
            "\nTo patch <b>{}<r>, edit the following folder:\n\n  <cyan>{}<r>\n",
            bstr::BStr::new(pkg_name),
            bstr::BStr::new(resolve_path::join_string_buf::<platform::Posix>(
                &mut bufn[..],
                &[
                    FileSystem::instance().top_level_dir_without_trailing_slash(),
                    module_folder
                ]
            )),
        );
        bun_core::pretty!(
            "\nOnce you're done with your changes, run:\n\n  <cyan>bun patch --commit '{}'<r>\n",
            bstr::BStr::new(resolve_path::join_string_buf::<platform::Posix>(
                &mut bufn[..],
                &[
                    FileSystem::instance().top_level_dir_without_trailing_slash(),
                    module_folder
                ]
            )),
        );
    } else {
        bun_core::pretty!(
            "\nTo patch <b>{}<r>, edit the following folder:\n\n  <cyan>{}<r>\n",
            bstr::BStr::new(pkg_name),
            bstr::BStr::new(module_folder)
        );
        bun_core::pretty!(
            "\nOnce you're done with your changes, run:\n\n  <cyan>bun patch --commit '{}'<r>\n",
            bstr::BStr::new(module_folder)
        );
    }

    Ok(())
}

fn is_real_dir_not_symlink(path: &[u8]) -> bool {
    #[cfg(windows)]
    let mut native_buf = bun_paths::path_buffer_pool::get();
    #[cfg(windows)]
    let native: &[u8] = {
        if path.len() > native_buf.len() {
            return false;
        }
        native_buf[0..path.len()].copy_from_slice(path);
        let slice = &mut native_buf[0..path.len()];
        resolve_path::posix_to_platform_in_place::<u8>(slice);
        &*slice
    };
    #[cfg(not(windows))]
    let native: &[u8] = path;

    let Ok(mut p) = bun_paths::Path::<u8>::from(native) else {
        return false;
    };

    #[cfg(windows)]
    {
        match sys::get_file_attributes(p.slice_z()) {
            Some(attrs) => attrs.is_directory && !attrs.is_reparse_point,
            None => false,
        }
    }
    #[cfg(not(windows))]
    {
        match sys::lstat(p.slice_z()) {
            Ok(st) => sys::posix::s_isdir(st.st_mode as u32),
            Err(_) => false,
        }
    }
}

fn detach_module_folder_from_shared_store(module_folder: &[u8]) {
    // `module_folder` reaches here normalised to forward slashes on every
    // platform (see `pathToPosixBuf` in `preparePatch`). Re-normalise to the
    // platform separator so `undo()`/`basename()` walk the path correctly on
    // Windows and the lstat/getFileAttributes calls below see a native path.
    #[cfg(windows)]
    let mut native_buf = bun_paths::path_buffer_pool::get();
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
                    // `mode_t` is `u16` on darwin/freebsd, `u32` on linux.
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

/// The source folder is an extracted archive, not a project folder.
fn is_cache_entry(tag: ResolutionTag) -> bool {
    matches!(
        tag,
        ResolutionTag::Npm
            | ResolutionTag::Git
            | ResolutionTag::Github
            | ResolutionTag::LocalTarball
            | ResolutionTag::RemoteTarball
    )
}

const ITERATE: sys::OpenDirOptions = sys::OpenDirOptions {
    iterate: true,
    no_follow: false,
};

/// `@scope` and `.bin` hold packages, so they merge one level down.
fn is_package_group(name: &[u8]) -> bool {
    bun_core::starts_with_char(name, b'@') || name == b".bin"
}

/// Moves the entries of `from` that `reference` lacks into `to`. `None` moves all.
fn move_entries_absent_from(
    from: &Dir,
    reference: Option<&Dir>,
    to: &Dir,
    merge_groups: bool,
) -> sys::Result<()> {
    use bun_paths::path_options::AssumeOk as _;

    let mut iter = sys::iterate_dir(from.fd);
    while let Some(entry) = iter.next()? {
        let mut name = bun_paths::AutoRelPath::from(entry.name.slice()).assume_ok();
        let name_z = name.slice_z();
        let Some(reference) = reference else {
            sys::renameat(from.fd, name_z, to.fd, name_z)?;
            continue;
        };
        match sys::exists_at_type(reference.fd, name_z) {
            Err(e) if e.get_errno() == sys::E::ENOENT => {
                sys::renameat(from.fd, name_z, to.fd, name_z)?;
            }
            Err(e) => return Err(e),
            Ok(sys::ExistsAtType::Directory)
                if merge_groups && is_package_group(name_z.as_bytes()) =>
            {
                let from_group = from.open_dir(name_z.as_bytes(), ITERATE)?;
                let reference_group = reference.open_dir(name_z.as_bytes(), Default::default())?;
                let to_group = to.make_open_path(name_z.as_bytes(), Default::default())?;
                move_entries_absent_from(&from_group, Some(&reference_group), &to_group, false)?;
            }
            Ok(_) => {}
        }
    }
    Ok(())
}

/// Moves the packages `bun patch --commit` set aside back under `<pkg>/node_modules`.
fn restore_nested_from_tempdir(
    root_node_modules: &Dir,
    tempdir_name: &[u8],
    new_folder_handle: &Dir,
) -> sys::Result<()> {
    let tempdir = root_node_modules.open_dir(tempdir_name, ITERATE)?;
    let nested =
        new_folder_handle.make_open_path(b"node_modules", sys::OpenDirOptions::default())?;
    move_entries_absent_from(&tempdir, Some(&nested), &nested, true)?;
    drop((tempdir, nested));
    root_node_modules.delete_tree(tempdir_name)
}

/// Moves `<pkg>/node_modules` to a sibling of `<pkg>`. `None` when absent.
fn stash_nested_node_modules(
    node_modules_folder_path: &[u8],
) -> Result<Option<Vec<u8>>, crate::Error> {
    let mut tmpbuf = bun_paths::path_buffer_pool::get();
    let tmpname = bun_paths::fs::FileSystem::tmpname(
        b"node_modules_tmp",
        &mut tmpbuf[..],
        bun_core::fast_random(),
    )?;
    let parent = resolve_path::dirname::<platform::Auto>(node_modules_folder_path);
    let mut stash_buf = bun_paths::path_buffer_pool::get();
    let stash_path = resolve_path::join_z_buf::<platform::Auto>(
        &mut stash_buf[..],
        &[parent, tmpname.as_bytes()],
    );
    let nested =
        resolve_path::join_z::<platform::Auto>(&[node_modules_folder_path, b"node_modules"]);
    match sys::renameat(Fd::cwd(), nested, Fd::cwd(), stash_path) {
        Ok(()) => Ok(Some(stash_path.as_bytes().to_vec())),
        Err(e) if e.get_errno() == sys::E::ENOENT => Ok(None),
        // overlayfs cannot rename a lower-layer directory: the copy still runs.
        Err(e) => {
            bun_core::warn!(
                "failed to keep {} aside, the dependencies installed under it are removed: {}",
                bstr::BStr::new(nested.as_bytes()),
                e
            );
            Ok(None)
        }
    }
}

/// Moves back the stashed packages the fresh copy lacks, then drops the rest.
fn restore_nested_node_modules(
    node_modules_folder_path: &[u8],
    stash_path: &[u8],
) -> Result<(), crate::Error> {
    let nested = resolve_path::join::<platform::Auto>(&[node_modules_folder_path, b"node_modules"]);
    let dest = Fd::cwd().make_open_path(nested)?;
    let stash = Dir::cwd().open_dir(stash_path, ITERATE)?;
    move_entries_absent_from(&stash, Some(&dest), &dest, true)?;
    drop(stash);
    drop(dest);
    if let Err(e) = Fd::cwd().delete_tree(stash_path) {
        bun_core::warn!(
            "failed to remove {}, this may cause issues: {}",
            bstr::BStr::new(stash_path),
            e
        );
    }
    Ok(())
}

fn overwrite_package_in_node_modules_folder(
    cache_dir: Fd,
    cache_dir_subpath: &[u8],
    node_modules_folder_path: &[u8],
    source_is_cache_entry: bool,
) -> Result<(), crate::Error> {
    let node_modules_folder_path = strings::trim_right(node_modules_folder_path, b"/");

    // Keep the packages bun installed under `<pkg>` across the delete and copy.
    let stash_path = stash_nested_node_modules(node_modules_folder_path)?;
    let Some(stash_path) = stash_path else {
        return copy_package_from_cache(
            cache_dir,
            cache_dir_subpath,
            node_modules_folder_path,
            source_is_cache_entry,
        );
    };
    match copy_package_from_cache(
        cache_dir,
        cache_dir_subpath,
        node_modules_folder_path,
        source_is_cache_entry,
    ) {
        Ok(()) => restore_nested_node_modules(node_modules_folder_path, &stash_path),
        Err(e) => {
            let nested =
                resolve_path::join::<platform::Auto>(&[node_modules_folder_path, b"node_modules"]);
            let _ = Fd::cwd().make_path(node_modules_folder_path);
            if let Err(e) = sys::renameat_concurrently_a(
                Fd::cwd(),
                &stash_path,
                Fd::cwd(),
                nested,
                sys::RenameOptions {
                    move_fallback: true,
                },
            ) {
                bun_core::warn!(
                    "failed moving {} back to {}, this may cause issues: {}",
                    bstr::BStr::new(&stash_path),
                    bstr::BStr::new(nested),
                    e
                );
            }
            Err(e)
        }
    }
}

/// A cache entry ships its `node_modules`. A project folder or `file:.` does not.
fn copy_package_from_cache(
    cache_dir: Fd,
    cache_dir_subpath: &[u8],
    node_modules_folder_path: &[u8],
    source_is_cache_entry: bool,
) -> Result<(), crate::Error> {
    let _ = Fd::cwd().delete_tree(node_modules_folder_path);

    // FileCopier's path fields are `.unit = .os` (u16 on Windows). `Path::from`
    // is generic over the *input* width and converts internally, so accepting
    // `&[u8]` and producing `Path<OSPathChar>` is intentional. `.sep = .auto`
    // is required so `/` is normalized to `\` on Windows — the inputs
    // here arrive posix-normalized and are later passed to Win32 APIs.
    let dest_subpath = bun_paths::Path::<
        bun_paths::OSPathChar,
        { bun_paths::path_options::Kind::ANY },
        { bun_paths::path_options::PathSeparators::AUTO },
    >::from(node_modules_folder_path)
    .unwrap();

    let src_path: bun_paths::AbsPath<
        bun_paths::OSPathChar,
        { bun_paths::path_options::PathSeparators::AUTO },
    > = 'src_path: {
        #[cfg(windows)]
        {
            let mut path_buf = bun_paths::w_path_buffer_pool::get();
            let abs_path = sys::get_fd_path_w(cache_dir, &mut path_buf)?;

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

    let cached_package_folder = Dir::borrow(&cache_dir).open_dir(
        cache_dir_subpath,
        sys::OpenDirOptions {
            iterate: true,
            ..Default::default()
        },
    )?;

    let ignore_directories: &[&bun_paths::OSPathSlice] = if source_is_cache_entry {
        &[
            bun_paths::os_path_literal!(".git"),
            bun_paths::os_path_literal!("CMakeFiles"),
        ]
    } else {
        &[
            bun_paths::os_path_literal!("node_modules"),
            bun_paths::os_path_literal!(".git"),
            bun_paths::os_path_literal!("CMakeFiles"),
        ]
    };

    let mut copier: FileCopier = FileCopier::init(
        cached_package_folder.fd,
        src_path,
        dest_subpath,
        ignore_directories,
    )?;

    copier.copy()?;
    Ok(())
}

type NodeModulesIterator<'a> = tree::Iterator<'a, { tree::IteratorPathStyle::NodeModules }>;

// reshaped for borrowck — `tree::Iterator::next` returns an
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
            if node_modules.dependencies.contains(&id.0) {
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
        if !node_modules.dependencies.contains(&dependency_id) {
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
    let mut pairs: Vec<IdPair> = Vec::with_capacity(8);

    let name_hash = string_hash(name);

    let strbuf = lockfile.buffers.string_bytes.as_slice();

    let mut resolution_label = Vec::new();
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
            if print_resolution_label(&mut resolution_label, &pkg.resolution, strbuf) == v {
                pairs.push((dep_id as DependencyID, pkg_id));
            }
        } else {
            pairs.push((dep_id as DependencyID, pkg_id));
        }
    }

    if pairs.is_empty() {
        bun_core::pretty_errorln!(
            "\n<r><red>error<r>: package <b>{}<r> not found<r>",
            bstr::BStr::new(pkg_maybe_version_to_patch)
        );
        Global::crash();
    }

    // user supplied a version e.g. `is-even@1.0.0`
    if version.is_some() {
        if pairs.len() == 1 {
            let (dep_id, pkg_id) = pairs[0];
            let folder = match node_modules_folder_for_dependency_id(iterator, dep_id) {
                Some(f) => f,
                None => {
                    bun_core::pretty_error!(
                        "<r><red>error<r>: could not find the folder for <b>{}<r> in node_modules<r>\n<r>",
                        bstr::BStr::new(pkg_maybe_version_to_patch),
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
        let folder = match node_modules_folder_for_dependency_ids(iterator, &pairs) {
            Some(f) => f,
            None => {
                bun_core::pretty_error!(
                    "<r><red>error<r>: could not find the folder for <b>{}<r> in node_modules<r>\n<r>",
                    bstr::BStr::new(pkg_maybe_version_to_patch),
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
        let folder = match node_modules_folder_for_dependency_id(iterator, dep_id) {
            Some(f) => f,
            None => {
                bun_core::pretty_error!(
                    "<r><red>error<r>: could not find the folder for <b>{}<r> in node_modules<r>\n<r>",
                    bstr::BStr::new(pkg_maybe_version_to_patch),
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
        let folder = match node_modules_folder_for_dependency_ids(iterator, &pairs) {
            Some(f) => f,
            None => {
                bun_core::pretty_error!(
                    "<r><red>error<r>: could not find the folder for <b>{}<r> in node_modules<r>\n<r>",
                    bstr::BStr::new(pkg_maybe_version_to_patch),
                );
                Global::crash();
            }
        };
        return (pkg_id, folder);
    }

    bun_core::pretty_errorln!(
        "\n<r><red>error<r>: Found multiple versions of <b>{}<r>, please specify a precise version from the following list:<r>",
        bstr::BStr::new(name),
    );
    let mut i: usize = 0;
    while i < pairs.len() {
        let (_, pkgid) = pairs[i];
        if pkgid == invalid_package_id {
            i += 1;
            continue;
        }

        let pkg = *lockfile.packages.get(pkgid as usize);

        bun_core::pretty_error!(
            "  {}@<blue>{}<r>\n",
            bstr::BStr::new(pkg.name.slice(strbuf)),
            pkg.resolution.fmt(strbuf, PathSep::Posix)
        );

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

// takes `workspace_package_id` directly instead of `&mut PackageManager` —
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
    fn from_arg(argument: &[u8]) -> PatchArgKind {
        if strings::contains(argument, b"node_modules/") {
            return PatchArgKind::Path;
        }
        // Intentional asymmetry — the Windows-backslash arm uses `has_prefix`
        // while the posix arm above uses `contains`.
        if cfg!(windows) && strings::has_prefix(argument, b"node_modules\\") {
            return PatchArgKind::Path;
        }
        PatchArgKind::NameAndVersion
    }
}
