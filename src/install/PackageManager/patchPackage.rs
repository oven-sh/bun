use std::io::Write as _;

use bun_collections::DynamicBitSet;
use bun_core::fmt::PathSep;
use bun_core::{Global, Output, fmt as bun_fmt};
use bun_core::{ZBox, handle_oom, strings};
use bun_install_types::NodeLinker::NodeLinker;
use bun_paths::platform;
use bun_paths::resolve_path;
use bun_paths::{Platform, SEP};
use bun_sys::{self as sys, Dir, Fd, FdDirExt as _, FdExt as _};

use crate::bun_fs::FileSystem;
use crate::bun_json as JSON;
use crate::dependency::{Dependency, DependencyExt as _, without_build_tag};
use crate::isolated_install::store::{EntryColumns as _, NodeColumns as _, entry as store_entry};
use crate::isolated_install::{FileCopier, build_whole_store};
use crate::lockfile_real::package::{Package, PackageColumns as _};
use crate::lockfile_real::{self as lockfile, Lockfile, reachable, tree};
use crate::package_install::{StagingPath, rename_staging_into_place};
use crate::package_installer::alias_is_safe_install_target;
use crate::package_manager_real::PackageManager;
use crate::package_manager_real::options::{LogLevel, PatchFeatures};
use crate::package_manager_real::package_manager_directories::{
    compute_cache_dir_and_subpath, get_temporary_directory,
};
use crate::{DependencyID, PackageID, Resolution, ResolutionTag, initialize_store};

#[inline]
fn string_hash(s: &[u8]) -> u64 {
    bun_semver::semver_string::Builder::string_hash(s)
}

/// The version half of a `name@version` patch key, into `label` (cleared first).
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

/// The `name@version` that `patchedDependencies` records the package under.
fn patch_key_of(lockfile: &Lockfile, pkg: &Package) -> Vec<u8> {
    let string_buf = lockfile.buffers.string_bytes.as_slice();
    let mut key = Vec::new();
    write!(
        key,
        "{}@{}",
        bstr::BStr::new(pkg.name.slice(string_buf)),
        pkg.resolution.fmt(string_buf, PathSep::Posix)
    )
    .expect("formatting into a Vec is infallible");
    key
}

#[derive(Default)]
pub struct PatchCommitResult {
    pub(crate) patch_key: Box<[u8]>,
    pub(crate) patchfile_path: Box<[u8]>,
    pub(crate) not_in_workspace_root: bool,
}

/// What the argument of `bun patch` and of `bun patch --commit` selects.
struct Target {
    pkg: Package,
    /// As the user names it: relative to the project root unless absolute, links not resolved.
    folder: Vec<u8>,
    /// The package's other folders in the isolated store: it has one for each peer resolution.
    other_folders: Vec<Vec<u8>>,
    not_in_workspace_root: bool,
}

fn resolve_target(
    manager: &mut PackageManager,
    lockfile: &Lockfile,
    command: &'static str,
) -> Target {
    let argument: &'static [u8] = manager.options.positionals[1];
    let workspace_name_hash = manager.workspace_name_hash;
    let workspace_package_id = manager.root_package_id.get(lockfile, workspace_name_hash);

    // Everything but what only ships inside another package's tarball.
    let installed = reachable::packages(
        lockfile,
        lockfile.buffers.resolutions.as_slice(),
        reachable::Options {
            bundled: false,
            ..reachable::Options::all(0)
        },
    );

    // The Windows-backslash arm intentionally uses `has_prefix`, the posix arm `contains`.
    let is_path = strings::contains(argument, b"node_modules/")
        || (cfg!(windows) && strings::has_prefix(argument, b"node_modules\\"));
    let (pkg, folder, other_folders) = if is_path {
        let folder = path_argument_from_root(lockfile, workspace_package_id, argument);
        let (name, version) = read_name_and_version(manager, &folder);
        let pkg = match package_for_folder(lockfile, string_hash(&name), &version) {
            Ok(pkg) => pkg,
            Err(err) => folder_lookup_error(err, command, &folder, &name, &version),
        };
        if !installed.is_set(pkg.meta.id as usize) {
            crash_bundled(&name);
        }
        (pkg, folder, Vec::new())
    } else {
        let (pkg_id, hoisted_folder) =
            pkg_info_for_name_and_version(lockfile, &installed, argument);
        let (folder, other_folders) = installed_module_folder(
            manager,
            lockfile,
            pkg_id,
            workspace_package_id,
            hoisted_folder,
        );
        let pkg = *lockfile.packages.get(pkg_id as usize);
        (pkg, folder, other_folders)
    };

    if !pkg.resolution.tag.can_enqueue_install_task() {
        bun_core::pretty_errorln!(
            "<r><red>error<r>: cannot patch <b>{}<r>: it is {}, and bun install never applies a patch to one",
            bstr::BStr::new(lockfile.str(&pkg.name)),
            match pkg.resolution.tag {
                ResolutionTag::Folder => "a file: folder",
                ResolutionTag::Symlink => "a link: dependency",
                _ => "a workspace package",
            },
        );
        bun_core::note!("edit the folder itself instead");
        Global::crash();
    }

    #[cfg(windows)]
    let folder = {
        let mut folder = folder;
        resolve_path::slashes_to_posix_in_place(&mut folder[..]);
        folder
    };

    Target {
        pkg,
        folder,
        other_folders,
        not_in_workspace_root: workspace_package_id != 0,
    }
}

fn crash_bundled(name: &[u8]) -> ! {
    bun_core::pretty_errorln!(
        "<r><red>error<r>: cannot patch <b>{}<r>: bun does not install it, it ships inside the tarball of a package that bundles it",
        bstr::BStr::new(name),
    );
    bun_core::note!(
        "patch the package that bundles it, and edit it in that package's node_modules"
    );
    Global::crash();
}

/// The user typed a relative path where the command ran; the process is in the project root.
fn path_argument_from_root(
    lockfile: &Lockfile,
    workspace_package_id: PackageID,
    argument: &[u8],
) -> Vec<u8> {
    if workspace_package_id != 0 && !Platform::AUTO.is_absolute(argument) {
        let workspace =
            *lockfile.packages.items_resolution()[workspace_package_id as usize].workspace();
        let from_root =
            resolve_path::join::<platform::Posix>(&[lockfile.str(&workspace), argument]).to_vec();
        // The hoisted linker may have put the package in the root's node_modules only.
        if sys::exists(&from_root) || !sys::exists(argument) {
            return from_root;
        }
    }
    argument.to_vec()
}

fn read_name_and_version(manager: &PackageManager, folder: &[u8]) -> (Vec<u8>, Vec<u8>) {
    let package_json_path = resolve_path::join_z::<platform::Auto>(&[folder, b"package.json"]);
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

    let string_property = |property: &'static str| -> Vec<u8> {
        if let Some(v) = parsed.root.get(property.as_bytes()) {
            if let bun_ast::ExprData::EString(s) = &v.data {
                return s.data.slice().to_vec();
            }
        }
        bun_core::pretty_error!(
            "<r><red>error<r>: invalid package.json, missing or invalid property \"{}\": {}<r>\n",
            property,
            bstr::BStr::new(package_json_source.path.text()),
        );
        Global::crash();
    };
    (string_property("name"), string_property("version"))
}

#[derive(Clone, Copy)]
enum FolderLookupError {
    NotInLockfile,
    /// The name has git, tarball or folder packages, whose labels are not versions.
    NeedsLabel,
}

/// Only an npm label is a version: a non-npm package matches only as the one of that name.
fn package_for_folder(
    lockfile: &Lockfile,
    name_hash: u64,
    version: &[u8],
) -> Result<Package, FolderLookupError> {
    let Some(entry) = lockfile.package_index.get(&name_hash) else {
        return Err(FolderLookupError::NotInLockfile);
    };
    let strbuf = lockfile.buffers.string_bytes.as_slice();
    let mut resolution_label = Vec::new();
    let mut has_npm = false;
    let mut has_other = false;
    for &id in entry.as_slice() {
        let pkg = *lockfile.packages.get(id as usize);
        if pkg.resolution.tag != ResolutionTag::Npm {
            has_other = true;
            continue;
        }
        has_npm = true;
        let label = print_resolution_label(&mut resolution_label, &pkg.resolution, strbuf);
        if without_build_tag(label) == without_build_tag(version) {
            return Ok(pkg);
        }
    }
    match (has_npm, has_other, entry.as_slice()) {
        (false, true, [id]) => Ok(*lockfile.packages.get(*id as usize)),
        (_, true, _) => Err(FolderLookupError::NeedsLabel),
        (_, false, _) => Err(FolderLookupError::NotInLockfile),
    }
}

fn folder_lookup_error(
    err: FolderLookupError,
    command: &str,
    folder: &[u8],
    name: &[u8],
    version: &[u8],
) -> ! {
    match err {
        FolderLookupError::NotInLockfile => {
            bun_core::pretty_errorln!(
                "<r><red>error<r>: cannot patch <b>{}<r>: <b>{}@{}<r> is not in the lockfile",
                bstr::BStr::new(folder),
                bstr::BStr::new(name),
                bstr::BStr::new(version),
            );
            bun_core::note!(
                "if the edits changed \"version\" in its package.json, run <b>{} {}@\\<version in the lockfile\\><r> instead",
                command,
                bstr::BStr::new(name),
            );
        }
        FolderLookupError::NeedsLabel => bun_core::pretty_errorln!(
            "<r><red>error<r>: cannot patch <b>{}<r>: no npm package <b>{}@{}<r> is in the lockfile, and the other packages named <b>{}<r> have a git, tarball or folder label. Run <b>{} \\<dependency\\>@\\<label\\><r> with the dependency name and the label from the lockfile instead.",
            bstr::BStr::new(folder),
            bstr::BStr::new(name),
            bstr::BStr::new(version),
            bstr::BStr::new(name),
            command,
        ),
    }
    Global::crash();
}

/// - Arg is the dir containing the package with changes OR name and version
/// - Get the patch file contents by running git diff on the temp dir and the original package dir
/// - Write the patch file to $PATCHES_DIR/$PKG_NAME_AND_VERSION.patch
/// - Update "patchedDependencies" in package.json
/// - Run install to install newly patched pkg
pub fn do_patch_commit(
    manager: &mut PackageManager,
    log_level: LogLevel,
) -> Result<Option<PatchCommitResult>, crate::Error> {
    let mut lockfile: Box<Lockfile> = Box::default();
    let log = manager.log_mut();
    let load_result = lockfile.load_from_cwd::<true>(Some(manager), log);
    let linker = load_result.node_linker(manager.options.node_linker);
    match load_result {
        lockfile::LoadResult::NotFound => {
            Output::err_generic(
                "Cannot find lockfile. Install packages with `<cyan>bun install<r>` before patching them.",
                (),
            );
            Global::crash();
        }
        lockfile::LoadResult::Err(cause) => {
            if log_level != LogLevel::Silent {
                bun_core::pretty_error!(
                    "<r><red>error<r> {} lockfile:<r> {}\n<r>",
                    match cause.step {
                        lockfile::LoadStep::OpenFile => "opening",
                        lockfile::LoadStep::ParseFile => "parsing",
                        lockfile::LoadStep::ReadFile => "reading",
                        lockfile::LoadStep::Migrating => "migrating",
                    },
                    cause.value.name(),
                );

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

    let target = resolve_target(manager, &lockfile, "bun patch --commit");
    let pkg = target.pkg;

    // `compute_cache_dir_and_subpath` resolves `pkg.resolution`'s strings against `manager.lockfile`.
    manager.lockfile = lockfile;
    let name = manager.lockfile.str(&pkg.name).to_vec();
    let patch_key = patch_key_of(&manager.lockfile, &pkg);
    let mut folder_path_buf = bun_paths::path_buffer_pool::get();
    let cache_result = compute_cache_dir_and_subpath(
        manager,
        &name,
        &pkg.resolution,
        &pkg.meta.integrity,
        &mut folder_path_buf,
        None,
    );
    let cache_path = cache_dir_path(cache_result.cache_dir);
    let old_folder = resolve_path::join::<platform::Posix>(&[
        &cache_path,
        cache_result.cache_dir_subpath.as_bytes(),
    ])
    .to_vec();
    let new_folder = real_folder(&cache_path, &target.folder, false);

    let Some(patchfile_contents) = diff_against_cache(manager, &old_folder, &new_folder) else {
        Global::crash();
    };

    if patchfile_contents.is_empty() {
        bun_core::pretty!(
            "\n<r>No changes detected, comparing <red>{}<r> to <green>{}<r>\n",
            bstr::BStr::new(&old_folder),
            bstr::BStr::new(&target.folder)
        );
        // `bun patch` in another directory prepares the folder that the workspace there loads.
        if !target.other_folders.is_empty() {
            bun_core::pretty!(
                "\n<b>{}<r> has more than one folder. To commit another one, run:\n\n",
                bstr::BStr::new(&name),
            );
        }
        for folder in &target.other_folders {
            bun_core::pretty!(
                "  <cyan>bun patch --commit '{}'<r>\n",
                bstr::BStr::new(folder),
            );
        }
        Output::flush();
        return Ok(None);
    }

    // The patch parser drops such a line: a new file would be installed empty.
    let mut binary_files = strings::split(&patchfile_contents, b"\n")
        .filter(|line| line.starts_with(b"Binary files ") && line.ends_with(b" differ"))
        .peekable();
    if binary_files.peek().is_some() {
        bun_core::pretty_errorln!(
            "<r><red>error<r>: a patch cannot hold a change to a binary file, and git found these in <b>{}<r>:",
            bstr::BStr::new(&target.folder),
        );
        for line in binary_files {
            bun_core::pretty_errorln!("  {}", bstr::BStr::new(line));
        }
        bun_core::note!("undo the changes to these files, then commit again");
        Global::crash();
    }

    // write the patch contents to temp file then rename
    let mut tmpname_buf = [0u8; 1024];
    let tempfile_name =
        bun_paths::fs::FileSystem::tmpname(b"tmp", &mut tmpname_buf, bun_core::fast_random())?;
    let tmpdir = get_temporary_directory(manager).handle.fd();
    if let Err(e) = sys::File::write_file(tmpdir, tempfile_name, &patchfile_contents) {
        Output::err(e, "failed to write patch to temp file", ());
        Global::crash();
    }

    let patch_filename = escape_patch_filename(&[patch_key.as_slice(), b".patch"].concat());

    let patches_dir: &[u8] = match &manager.options.patch_features {
        PatchFeatures::Commit { patches_dir } => patches_dir,
        // Reaching `doPatchCommit` implies `Subcommand::PatchCommit`, which always
        // sets `patch_features = .commit` in `Options::load`.
        _ => unreachable!("patch_features must be Commit in doPatchCommit"),
    };

    // Owned: `join` hands out the thread's one buffer, and every later `join` writes to it.
    let path_in_patches_dir = ZBox::from_bytes(resolve_path::join::<platform::Posix>(&[
        patches_dir,
        &patch_filename,
    ]));

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
        &path_in_patches_dir,
        sys::RenameOptions {
            move_fallback: true,
        },
    ) {
        Output::err(e, "failed renaming patch file to patches dir", ());
        Global::crash();
    }

    // An install leaves the copy `bun patch` made here alone; a readable patch has the edits now.
    if linker == NodeLinker::Isolated
        && is_link_position(&new_folder)
        && bun_patch::parse_patch_file(&patchfile_contents).is_ok()
    {
        let _ = Fd::cwd().delete_tree(&new_folder);
    }

    Ok(Some(PatchCommitResult {
        patch_key: patch_key.into_boxed_slice(),
        patchfile_path: Box::<[u8]>::from(path_in_patches_dir.as_bytes()),
        not_in_workspace_root: target.not_in_workspace_root,
    }))
}

/// `None` after a printed error: `Global::crash()` in here would skip `HiddenFromDiff`'s drop.
fn diff_against_cache(
    manager: &mut PackageManager,
    old_folder: &[u8],
    new_folder: &[u8],
) -> Option<Vec<u8>> {
    let mut cwdbuf = bun_paths::path_buffer_pool::get();
    let cwd = match sys::getcwd_z(&mut cwdbuf) {
        Ok(fd) => fd,
        Err(e) => {
            bun_core::pretty_error!("<r><red>error<r>: failed to get cwd path {}<r>\n", e);
            return None;
        }
    };
    let mut gitbuf = bun_paths::path_buffer_pool::get();
    let Some(git) = bun_which::which(
        &mut gitbuf,
        bun_core::env_var::PATH.get().unwrap_or(b""),
        cwd.as_bytes(),
        b"git",
    ) else {
        bun_core::pretty_error!(
            "<r><red>error<r>: git must be installed to use `bun patch --commit` <r>\n",
        );
        return None;
    };

    let _hidden = match HiddenFromDiff::new(old_folder, new_folder) {
        Ok(hidden) => hidden,
        Err(e) => {
            Output::err(
                e,
                "failed to prepare <b>{s}<r> for the diff",
                (bstr::BStr::new(new_folder),),
            );
            return None;
        }
    };

    let paths = bun_patch::git_diff_preprocess_paths(old_folder, new_folder);
    let (opts, _envp_guard) =
        bun_patch::spawn_opts(&paths[0], &paths[1], cwd, git, &mut manager.event_loop);

    let mut spawn_result = match bun_spawn::sync::spawn(&opts) {
        Err(e) => {
            bun_core::pretty_error!("<r><red>error<r>: failed to make diff {}<r>\n", e.name(),);
            return None;
        }
        Ok(Ok(r)) => r,
        Ok(Err(e)) => {
            bun_core::pretty_error!("<r><red>error<r>: failed to make diff {}<r>\n", e);
            return None;
        }
    };

    match bun_patch::diff_post_process(&mut spawn_result, &paths[0], &paths[1]) {
        Err(e) => {
            bun_core::pretty_error!("<r><red>error<r>: failed to make diff {}<r>\n", e.name(),);
            None
        }
        Ok(Ok(stdout)) => Some(stdout),
        Ok(Err(mut stderr)) => {
            if stderr.len() > 256 {
                let more = stderr.len() - 256;
                stderr.truncate(256);
                write!(stderr, "... ({} more bytes)", more)
                    .expect("formatting into a Vec is infallible");
            }
            bun_core::pretty_error!(
                "<r><red>error<r>: failed to make diff {}<r>\n",
                bstr::BStr::new(&stderr)
            );
            None
        }
    }
}

const ITERATE: sys::OpenDirOptions = sys::OpenDirOptions {
    iterate: true,
    no_follow: false,
};

/// `git diff --no-index` takes no pathspec: what is not the package waits next to it until drop.
struct HiddenFromDiff {
    folder: Dir,
    stash: Dir,
    stash_path: Vec<u8>,
}

impl HiddenFromDiff {
    fn new(cache_entry: &[u8], folder_path: &[u8]) -> sys::Result<HiddenFromDiff> {
        let folder = Dir::cwd().open_dir(folder_path, ITERATE)?;
        let stash_path = temp_sibling(folder_path);
        Fd::cwd().make_path(&stash_path)?;
        let hidden = HiddenFromDiff {
            folder,
            stash: Dir::cwd().open_dir(&stash_path, ITERATE)?,
            stash_path,
        };
        hidden.hide(cache_entry)?;
        Ok(hidden)
    }

    fn hide(&self, cache_entry: &[u8]) -> sys::Result<()> {
        // bun.lock does not record the hash, so the names come from the folder.
        let mut iter = sys::iterate_dir(self.folder.fd);
        while let Some(entry) = iter.next()? {
            if entry.kind != sys::EntryKind::Directory
                && strings::has_prefix(entry.name.slice_u8(), crate::bun_hash_tag)
            {
                let name = ZBox::from_bytes(entry.name.slice_u8());
                sys::renameat(self.folder.fd, &name, self.stash.fd, &name)?;
            }
        }

        let Ok(nested) = self.folder.open_dir(b"node_modules", ITERATE) else {
            return Ok(());
        };
        // The bundled dependencies, which are part of the package.
        let bundled = match Dir::cwd().open_dir(
            resolve_path::join::<platform::Auto>(&[cache_entry, b"node_modules"]),
            Default::default(),
        ) {
            Ok(dir) => Some(dir),
            Err(e) if e.get_errno() == sys::E::ENOENT => None,
            Err(e) => return Err(e),
        };
        let stash = self
            .stash
            .make_open_path(b"node_modules", Default::default())?;
        move_entries_absent_from(&nested, bundled.as_ref(), &stash, true)
    }

    fn restore(&self) -> sys::Result<()> {
        if let Ok(stash) = self.stash.open_dir(b"node_modules", ITERATE) {
            let nested = self
                .folder
                .make_open_path(b"node_modules", Default::default())?;
            move_entries_absent_from(&stash, Some(&nested), &nested, true)?;
        }
        move_entries_absent_from(&self.stash, Some(&self.folder), &self.folder, false)
    }
}

impl Drop for HiddenFromDiff {
    fn drop(&mut self) {
        match self.restore() {
            Ok(()) => {
                let _ = Fd::cwd().delete_tree(&self.stash_path);
            }
            Err(e) => bun_core::warn!(
                "failed to move the contents of {} back into the package folder: {}",
                bstr::BStr::new(&self.stash_path),
                e
            ),
        }
    }
}

/// `@scope` and `.bin` hold what belongs to several packages, so they merge one level down.
fn is_package_group(name: &[u8]) -> bool {
    strings::starts_with_char(name, b'@') || name == b".bin"
}

/// Moves the entries of `from` that `reference` lacks into `to`. `None` moves all.
fn move_entries_absent_from(
    from: &Dir,
    reference: Option<&Dir>,
    to: &Dir,
    merge_groups: bool,
) -> sys::Result<()> {
    let mut iter = sys::iterate_dir(from.fd);
    while let Some(entry) = iter.next()? {
        let name = ZBox::from_bytes(entry.name.slice_u8());
        let Some(reference) = reference else {
            sys::renameat(from.fd, &name, to.fd, &name)?;
            continue;
        };
        match sys::exists_at_type(reference.fd, &name) {
            Err(e) if e.get_errno() == sys::E::ENOENT => {
                sys::renameat(from.fd, &name, to.fd, &name)?;
            }
            Err(e) => return Err(e),
            Ok(sys::ExistsAtType::Directory)
                if merge_groups && is_package_group(name.as_bytes()) =>
            {
                let from_group = from.open_dir(name.as_bytes(), ITERATE)?;
                let reference_group = reference.open_dir(name.as_bytes(), Default::default())?;
                let to_group = to.make_open_path(name.as_bytes(), Default::default())?;
                move_entries_absent_from(&from_group, Some(&reference_group), &to_group, false)?;
            }
            Ok(_) => {}
        }
    }
    Ok(())
}

/// `:?*"<>|` are NTFS-reserved: escaped on every OS, so that patches/ checks out on Windows.
fn escape_patch_filename(name: &[u8]) -> Vec<u8> {
    let mut escaped = Vec::with_capacity(name.len());
    for c in name {
        let replacement: &[u8] = match *c {
            b'/' => b"%2F",
            b'\\' => b"%5c",
            b' ' => b"%20",
            b'\n' => b"%0A",
            b'\r' => b"%0D",
            b'\t' => b"%09",
            b':' => b"%3A",
            b'?' => b"%3F",
            b'*' => b"%2A",
            b'"' => b"%22",
            b'<' => b"%3C",
            b'>' => b"%3E",
            b'|' => b"%7C",
            _ => core::slice::from_ref(c),
        };
        escaped.extend_from_slice(replacement);
    }
    escaped
}

/// 1. Arg is either:
///   - name and possibly version (e.g. "is-even" or "is-even@1.0.0")
///   - path to package in node_modules
/// 2. Calculate cache dir for package
/// 3. Overwrite the input package with the one from the cache (cuz it could be hardlinked)
/// 4. Print to user
pub fn prepare_patch(manager: &mut PackageManager) -> Result<(), crate::Error> {
    // Moved out so that `resolve_target` can borrow it next to `&mut PackageManager`.
    let lockfile: Box<Lockfile> = core::mem::take(&mut manager.lockfile);
    let target = resolve_target(manager, &lockfile, "bun patch");
    manager.lockfile = lockfile;

    let pkg = target.pkg;
    let pkg_name = manager.lockfile.str(&pkg.name).to_vec();
    // A package that is patched already starts from its patched copy.
    let existing_patchfile_hash: Option<u64> = manager
        .lockfile
        .patched_dependencies
        .get(&string_hash(&patch_key_of(&manager.lockfile, &pkg)))
        .and_then(|patched_dep| patched_dep.patchfile_hash());

    let mut folder_path_buf = bun_paths::path_buffer_pool::get();
    let cache_result = compute_cache_dir_and_subpath(
        manager,
        &pkg_name,
        &pkg.resolution,
        &pkg.meta.integrity,
        &mut folder_path_buf,
        existing_patchfile_hash,
    );
    let folder = real_folder(
        &cache_dir_path(cache_result.cache_dir),
        &target.folder,
        true,
    );

    // The package may be installed using the hard link method,
    // meaning that changes to the folder will also change the package in the cache.
    //
    // So we will overwrite the folder by directly copying the package in cache into it
    if let Err(e) = replace_with_cache_copy(
        cache_result.cache_dir,
        cache_result.cache_dir_subpath.as_bytes(),
        &folder,
    ) {
        bun_core::pretty_error!(
            "<r><red>error<r>: error overwriting folder in node_modules: {}\n<r>",
            e.name(),
        );
        Global::crash();
    }

    let mut bufn = bun_paths::path_buffer_pool::get();
    let shown_folder: &[u8] = if target.not_in_workspace_root {
        resolve_path::join_string_buf::<platform::Posix>(
            &mut bufn[..],
            &[
                FileSystem::instance().top_level_dir_without_trailing_slash(),
                &target.folder,
            ],
        )
    } else {
        &target.folder
    };
    bun_core::pretty!(
        "\nTo patch <b>{}<r>, edit the following folder:\n\n  <cyan>{}<r>\n",
        bstr::BStr::new(&pkg_name),
        bstr::BStr::new(shown_folder)
    );
    bun_core::pretty!(
        "\nOnce you're done with your changes, run:\n\n  <cyan>bun patch --commit '{}'<r>\n",
        bstr::BStr::new(shown_folder)
    );

    Ok(())
}

fn cache_dir_path(cache_dir: Fd) -> Vec<u8> {
    let mut buf = bun_paths::path_buffer_pool::get();
    match sys::get_fd_path(cache_dir, &mut buf) {
        Ok(path) => path.to_vec(),
        Err(e) => {
            Output::err(e, "failed to read from cache", ());
            Global::crash();
        }
    }
}

/// `path` with every link in it resolved. What does not exist yet is appended as it is.
fn resolve_links(path: &[u8]) -> sys::Result<Vec<u8>> {
    let path = strings::without_trailing_slash(path);
    let mut buf = bun_paths::path_buffer_pool::get();
    let mut existing = path;
    loop {
        let existing_z = ZBox::from_bytes(if existing.is_empty() {
            &b"."[..]
        } else {
            existing
        });
        match sys::realpath(&existing_z, &mut buf) {
            Ok(real) => {
                return Ok(
                    resolve_path::join::<platform::Auto>(&[real, &path[existing.len()..]]).to_vec(),
                );
            }
            Err(e) if e.get_errno() == sys::E::ENOENT => {
                let parent = resolve_path::dirname::<platform::Auto>(existing);
                if parent.len() == existing.len() {
                    return Err(e);
                }
                existing = parent;
            }
            Err(e) => return Err(e),
        }
    }
}

/// `folder`, links resolved; when that is in the shared store, `bun patch` replaces the last link.
fn real_folder(cache_path: &[u8], folder: &[u8], replaces_folder: bool) -> Vec<u8> {
    let resolve = |path: &[u8]| match resolve_links(path) {
        Ok(real) => real,
        Err(e) => {
            Output::err(e, "failed to resolve <b>{s}<r>", (bstr::BStr::new(folder),));
            Global::crash();
        }
    };
    let is_shared = |real: &[u8]| {
        resolve_path::is_parent_or_equal(cache_path, real) != resolve_path::ParentEqual::Unrelated
    };

    let real = resolve(folder);
    if !is_shared(&real) {
        return real;
    }
    if replaces_folder {
        let link = strings::without_trailing_slash(folder);
        let link = resolve_path::join::<platform::Auto>(&[
            &resolve(resolve_path::dirname::<platform::Auto>(link)),
            bun_paths::basename(link),
        ])
        .to_vec();
        if !is_shared(&link) {
            return link;
        }
    }

    bun_core::pretty_errorln!(
        "<r><red>error<r>: <b>{}<r> resolves into the global store, which other projects share; refusing to patch through it",
        bstr::BStr::new(folder),
    );
    if replaces_folder {
        bun_core::note!(
            "set <b>globalStore = false<r> under <b>[install]<r> in bunfig.toml, run <cyan>bun install<r> and patch the package again"
        );
    } else {
        bun_core::note!("run <cyan>bun patch<r> on the package first, it makes the copy to edit");
    }
    Global::crash();
}

fn is_link(path: &[u8]) -> bool {
    let mut buf = bun_paths::path_buffer_pool::get();
    sys::readlink(&ZBox::from_bytes(path), &mut buf[..]).is_ok()
}

/// `folder`, links resolved, is an entry of a project `node_modules` outside `node_modules/.bun`.
fn is_link_position(folder: &[u8]) -> bool {
    use resolve_path::{ParentEqual, dirname, is_parent_or_equal};
    let Ok(store) = resolve_links(b"node_modules/.bun") else {
        return false;
    };
    let project = dirname::<platform::Auto>(dirname::<platform::Auto>(&store));
    let mut node_modules = dirname::<platform::Auto>(folder);
    if strings::starts_with_char(bun_paths::basename(node_modules), b'@') {
        node_modules = dirname::<platform::Auto>(node_modules);
    }
    bun_paths::basename(node_modules) == b"node_modules"
        && is_parent_or_equal(project, folder) == ParentEqual::Parent
        && is_parent_or_equal(&store, folder) == ParentEqual::Unrelated
}

/// Named like an install's staging folder, so that `bun prune` collects one a crash left behind.
fn temp_sibling(folder: &[u8]) -> Vec<u8> {
    let mut path = resolve_path::dirname::<platform::Auto>(folder).to_vec();
    write!(
        path,
        "{}{}{:016x}",
        SEP as char,
        StagingPath::PREFIX,
        bun_core::fast_random()
    )
    .expect("formatting into a Vec is infallible");
    path
}

/// Deleted on drop, unless it was renamed away or kept.
struct TempTree(Vec<u8>);

impl TempTree {
    fn keep(mut self) -> Vec<u8> {
        core::mem::take(&mut self.0)
    }
}

impl Drop for TempTree {
    fn drop(&mut self) {
        if !self.0.is_empty() {
            let _ = Fd::cwd().delete_tree(&self.0);
        }
    }
}

/// `folder` is never partial: the copy is made next to it and renamed in.
fn replace_with_cache_copy(
    cache_dir: Fd,
    cache_dir_subpath: &[u8],
    folder: &[u8],
) -> Result<(), crate::Error> {
    // Before anything is touched: the cache entry may be gone.
    let cached_package_folder = Dir::borrow(&cache_dir).open_dir(cache_dir_subpath, ITERATE)?;

    let cwd = Fd::cwd();
    cwd.make_path(resolve_path::dirname::<platform::Auto>(folder))?;
    let staging = TempTree(temp_sibling(folder));

    // FileCopier's path fields are `.unit = .os` (u16 on Windows). `Path::from`
    // is generic over the *input* width and converts internally, so accepting
    // `&[u8]` and producing `Path<OSPathChar>` is intentional. `.sep = .auto`
    // is required so `/` is normalized to `\` on Windows.
    let dest_subpath = bun_paths::Path::<
        bun_paths::OSPathChar,
        { bun_paths::path_options::Kind::ANY },
        { bun_paths::path_options::PathSeparators::AUTO },
    >::from(staging.0.as_slice())?;

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

    // Not `node_modules`: a cache entry has the bundled dependencies in it.
    let ignore_directories: &[&bun_paths::OSPathSlice] = &[
        bun_paths::os_path_literal!(".git"),
        bun_paths::os_path_literal!("CMakeFiles"),
    ];

    FileCopier::init(
        cached_package_folder.fd,
        src_path,
        dest_subpath,
        ignore_directories,
    )?
    .copy()?;

    let old = TempTree(temp_sibling(folder));
    let folder_z = ZBox::from_bytes(folder);
    let staging_z = ZBox::from_bytes(&staging.0);
    let old_z = ZBox::from_bytes(&old.0);

    let (has_old, deleted_old) = match sys::renameat(cwd, &folder_z, cwd, &old_z) {
        Ok(()) => (true, false),
        Err(e) if e.get_errno() == sys::E::ENOENT => (false, false),
        // overlayfs (Docker) refuses to rename a directory from a lower layer.
        Err(e) if e.get_errno() == sys::E::EXDEV => {
            cwd.delete_tree(folder)?;
            (false, true)
        }
        Err(e) => return Err(e.into()),
    };

    if let Err(e) = rename_staging_into_place(cwd, &staging_z, &folder_z) {
        if has_old {
            if let Err(restore_err) = sys::renameat(cwd, &old_z, cwd, &folder_z) {
                bun_core::warn!(
                    "failed to move the previous package folder back, it is at {}: {}",
                    bstr::BStr::new(&old.keep()),
                    restore_err
                );
            }
        } else if deleted_old {
            bun_core::warn!(
                "the copy of the package is at {}",
                bstr::BStr::new(&staging.keep())
            );
        }
        return Err(e.into());
    }

    if has_old {
        // Behind a link is the global store, which is not the project's to move or delete.
        if is_link(&old.0) {
            let _ = crate::isolated_install::installer::remove_link(&old_z);
        } else if let Err(e) = keep_nested_packages(&old.0, folder) {
            bun_core::warn!(
                "failed to keep the packages installed under {}, run bun install to get them back: {}",
                bstr::BStr::new(folder),
                e
            );
        }
    }
    Ok(())
}

/// The cache entry does not have the packages that the hoisted linker nested under the old folder.
fn keep_nested_packages(old: &[u8], folder: &[u8]) -> sys::Result<()> {
    let from = match Dir::cwd().open_dir(
        resolve_path::join::<platform::Auto>(&[old, b"node_modules"]),
        ITERATE,
    ) {
        Ok(dir) => dir,
        Err(e) if e.get_errno() == sys::E::ENOENT => return Ok(()),
        Err(e) => return Err(e),
    };
    let to = Fd::cwd().make_open_path(resolve_path::join::<platform::Auto>(&[
        folder,
        b"node_modules",
    ]))?;
    move_entries_absent_from(&from, Some(&to), &to, true)
}

/// The isolated linker puts nothing at the hoisted path of a package that the root does not link.
fn installed_module_folder(
    manager: &PackageManager,
    lockfile: &Lockfile,
    pkg_id: PackageID,
    workspace_package_id: PackageID,
    hoisted_folder: Vec<u8>,
) -> (Vec<u8>, Vec<Vec<u8>>) {
    let exists = sys::exists(&hoisted_folder);
    if exists && !is_link(&hoisted_folder) {
        return (hoisted_folder, Vec::new());
    }
    let store_folders = isolated_store_folders(manager, lockfile, pkg_id, workspace_package_id);
    // A `publicHoistPattern` link can lead to another version than the hoisted tree has.
    if exists {
        let real = resolve_links(&hoisted_folder).ok();
        if store_folders
            .iter()
            .any(|folder| resolve_links(folder).ok() == real)
        {
            return (hoisted_folder, Vec::new());
        }
    }
    let mut store_folders = store_folders.into_iter();
    match store_folders.next() {
        Some(folder) => (folder, store_folders.collect()),
        None => (hoisted_folder, Vec::new()),
    }
}

/// A package has one store entry for each peer resolution: the ones that the workspace loads first.
fn isolated_store_folders(
    manager: &PackageManager,
    lockfile: &Lockfile,
    pkg_id: PackageID,
    workspace_package_id: PackageID,
) -> Vec<Vec<u8>> {
    let store = handle_oom(build_whole_store(manager, lockfile));
    let name = lockfile.str(&lockfile.packages.items_name()[pkg_id as usize]);
    let resolutions = lockfile.packages.items_resolution();
    let entry_dependencies = store.entries.items_dependencies();
    let node_pkg_ids = store.nodes.items_pkg_id();
    let entry_pkgs: Vec<PackageID> = store
        .entries
        .items_node_id()
        .iter()
        .map(|node_id| node_pkg_ids[node_id.get() as usize])
        .collect();

    let project_folder = |entry: usize| -> Option<Vec<u8>> {
        let mut folder = Vec::new();
        write!(
            folder,
            "node_modules/.bun/{}",
            store_entry::fmt_store_path(store_entry::Id::from(entry as u32), &store, lockfile),
        )
        .expect("formatting into a Vec is infallible");
        // A link into the global store: the project has no folder of the package.
        if is_link(&folder) {
            return None;
        }
        write!(folder, "/node_modules/{}", bstr::BStr::new(name))
            .expect("formatting into a Vec is infallible");
        sys::exists(&folder).then_some(folder)
    };

    // Breadth first from the current package, then the entries that it does not load.
    let mut seen = vec![false; entry_pkgs.len()];
    let mut queue: Vec<usize> = Vec::with_capacity(entry_pkgs.len());
    let mut enqueue = |entry: usize, queue: &mut Vec<usize>| {
        let pkg = entry_pkgs[entry];
        // Only one entry of a workspace has its dependencies: a `workspace:` range links another.
        let same_package = matches!(
            resolutions[pkg as usize].tag,
            ResolutionTag::Root | ResolutionTag::Workspace
        );
        let entries = if same_package {
            0..entry_pkgs.len()
        } else {
            entry..entry + 1
        };
        for entry in entries {
            if entry_pkgs[entry] == pkg && !core::mem::replace(&mut seen[entry], true) {
                queue.push(entry);
            }
        }
    };
    if let Some(start) = entry_pkgs
        .iter()
        .position(|&pkg| pkg == workspace_package_id)
    {
        enqueue(start, &mut queue);
    }
    let mut next = 0;
    while let Some(&entry) = queue.get(next) {
        next += 1;
        for dependency in entry_dependencies[entry].slice() {
            if let Some(dependency_entry) = dependency.entry_id.try_get() {
                enqueue(dependency_entry as usize, &mut queue);
            }
        }
    }
    queue.extend((0..entry_pkgs.len()).filter(|&entry| !seen[entry]));

    queue
        .into_iter()
        .filter(|&entry| entry_pkgs[entry] == pkg_id)
        .filter_map(project_folder)
        .collect()
}

type NodeModulesIterator<'a> = tree::Iterator<'a, { tree::IteratorPathStyle::NodeModules }>;

type IdPair = (DependencyID, PackageID);

/// The package that `name` or `name@version` selects, and its folder in a hoisted node_modules.
fn pkg_info_for_name_and_version(
    lockfile: &Lockfile,
    installed: &DynamicBitSet,
    pkg_maybe_version_to_patch: &[u8],
) -> (PackageID, Vec<u8>) {
    let (name, version) = Dependency::split_name_and_maybe_version(pkg_maybe_version_to_patch);
    let name_hash = string_hash(name);

    let strbuf = lockfile.buffers.string_bytes.as_slice();
    let dependencies = lockfile.buffers.dependencies.as_slice();
    let resolutions = lockfile.buffers.resolutions.as_slice();
    let pkg_name_hashes = lockfile.packages.items_name_hash();
    let pkg_resolutions = lockfile.packages.items_resolution();

    let mut pairs: Vec<IdPair> = Vec::with_capacity(8);
    let mut aliased: Vec<IdPair> = Vec::new();
    let mut is_bundled = false;
    let mut resolution_label = Vec::new();

    for (dep_id, (dep, &pkg_id)) in dependencies.iter().zip(resolutions).enumerate() {
        // `invalid_package_id` and any other id past the end: the dependency did not resolve.
        let Some(&pkg_name_hash) = pkg_name_hashes.get(pkg_id as usize) else {
            continue;
        };
        let matches = if dep.name_hash == name_hash {
            &mut pairs
        } else if pkg_name_hash == name_hash {
            &mut aliased
        } else {
            continue;
        };
        if let Some(v) = version {
            let resolution = &pkg_resolutions[pkg_id as usize];
            if print_resolution_label(&mut resolution_label, resolution, strbuf) != v {
                continue;
            }
        }
        if dep.behavior.is_bundled() || !installed.is_set(pkg_id as usize) {
            is_bundled = true;
            continue;
        }
        matches.push((dep_id as DependencyID, pkg_id));
    }

    // Not a union: an alias of another version must not make a dependency's name ambiguous.
    if pairs.is_empty() {
        pairs = aliased;
    }

    if pairs.is_empty() {
        if is_bundled {
            crash_bundled(pkg_maybe_version_to_patch);
        }
        bun_core::pretty_errorln!(
            "\n<r><red>error<r>: package <b>{}<r> not found<r>",
            bun_fmt::for_terminal(bstr::BStr::new(pkg_maybe_version_to_patch))
        );
        Global::crash();
    }

    // Several dependents of one package are fine. Several packages need a version.
    if version.is_none() && pairs.iter().any(|pair| pair.1 != pairs[0].1) {
        bun_core::pretty_errorln!(
            "\n<r><red>error<r>: Found multiple versions of <b>{}<r>, please specify a precise version from the following list:<r>",
            bstr::BStr::new(name),
        );
        let mut printed: Vec<PackageID> = Vec::new();
        for &(_, pkg_id) in &pairs {
            if printed.contains(&pkg_id) {
                continue;
            }
            printed.push(pkg_id);
            bun_core::pretty_error!(
                "  {}@<blue>{}<r>\n",
                bstr::BStr::new(lockfile.str(&lockfile.packages.items_name()[pkg_id as usize])),
                bun_fmt::EscapeControlChars(
                    pkg_resolutions[pkg_id as usize].fmt(strbuf, PathSep::Posix)
                )
            );
        }
        Global::crash();
    }

    // The package may be hoisted, so this takes the first dependent whose node_modules has it.
    let mut iterator = NodeModulesIterator::init(lockfile);
    let ((dep_id, pkg_id), node_modules) = loop {
        let Some(node_modules) = iterator.next(None) else {
            bun_core::pretty_error!(
                "<r><red>error<r>: could not find the folder for <b>{}<r> in node_modules<r>\n<r>",
                bun_fmt::for_terminal(bstr::BStr::new(pkg_maybe_version_to_patch)),
            );
            Global::crash();
        };
        if let Some(&id) = (pairs.iter()).find(|id| node_modules.dependencies.contains(&id.0)) {
            break (id, node_modules.relative_path.as_bytes().to_vec());
        }
    };

    // An alias is installed under the dependency's name, which becomes a path.
    let folder_name = dependencies[dep_id as usize].name.slice(strbuf);
    if !alias_is_safe_install_target(folder_name) {
        bun_core::pretty_errorln!(
            "<r><red>error<r>: refusing to patch dependency with unsafe name {}",
            bun_fmt::quote(folder_name),
        );
        Global::crash();
    }
    (
        pkg_id,
        resolve_path::join::<platform::Auto>(&[&node_modules, folder_name]).to_vec(),
    )
}
