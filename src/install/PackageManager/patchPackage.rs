use std::io::Write as _;

use bun_collections::DynamicBitSet;
use bun_core::fmt::PathSep;
use bun_core::{Global, Output, fmt as bun_fmt};
use bun_core::{ZBox, ZStr, handle_oom, strings};
use bun_install_types::NodeLinker::NodeLinker;
use bun_paths::platform;
use bun_paths::resolve_path;
use bun_paths::{AbsPath, Platform, SEP};
use bun_sys::{self as sys, Dir, Fd, FdDirExt as _, FdExt as _};

use crate::bin;
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
use crate::package_manager_real::options::{Do, LogLevel, PatchFeatures};
use crate::package_manager_real::package_json_editor::{edit_patched_dependencies, remove_entry};
use crate::package_manager_real::package_manager_directories::{
    compute_cache_dir_and_subpath, get_temporary_directory, is_package_in_cache_at,
};
use crate::package_manager_real::populate_package_cache::download_pinned_packages;
use crate::patch_install::{PatchStamp, RecordedPatches};
use crate::resolution::append_without_url_credentials;
use crate::{DependencyID, PackageID, PatchTask, Resolution, ResolutionTag, initialize_store};

#[inline]
fn string_hash(s: &[u8]) -> u64 {
    bun_semver::semver_string::Builder::string_hash(s)
}

/// Writes the version half of a `name@version` patch key into `label`, clearing it first.
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

/// Returns the `name@version` key that `patchedDependencies` uses for the package.
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
    /// The folder has no edits left, so this commit removes the package's existing patch.
    /// `patchfile_path` is then the path of that patch as recorded in the lockfile.
    removes_patch: bool,
}

impl PatchCommitResult {
    pub(crate) fn edit_package_json(
        &self,
        manager: &mut PackageManager,
        package_json: &mut bun_ast::Expr,
    ) -> Result<(), bun_alloc::AllocError> {
        if self.removes_patch {
            remove_entry(package_json, b"patchedDependencies", &self.patch_key);
            return Ok(());
        }
        edit_patched_dependencies(manager, package_json, &self.patch_key, &self.patchfile_path)
    }

    /// Deletes the file of a removed patch. Call this once package.json and the lockfile no longer
    /// refer to the file for this package.
    pub(crate) fn delete_removed_patch(&self, manager: &PackageManager) {
        if !self.removes_patch || !manager.options.do_.contains(Do::WRITE_PACKAGE_JSON) {
            return;
        }
        let path = ZBox::from_bytes(&self.patchfile_path);
        let lockfile = &manager.lockfile;
        let real = resolve_links(&self.patchfile_path).ok();
        let own_key = string_hash(&self.patch_key);
        let is_shared = real.is_some()
            && (lockfile.patched_dependencies.iter()).any(|(key, other)| {
                *key != own_key && resolve_links(lockfile.str(&other.path)).ok() == real
            });
        let (outcome, why) = if is_shared {
            ("kept", ", used by another package")
        } else if is_file_of_the_project(&path) && sys::unlink(&path).is_ok() {
            ("deleted", "")
        } else {
            ("did not delete", "")
        };
        bun_core::pretty!(
            "\nRemoved the patch for <b>{}<r> ({} {}{})\n",
            bun_fmt::for_terminal(bstr::BStr::new(&self.patch_key)),
            outcome,
            bun_fmt::escape_control_chars(&self.patchfile_path),
            why,
        );
    }
}

/// The file system changes of `bun patch --commit`. They are deferred until its install has passed
/// every check that can abort it.
#[derive(Default)]
pub(crate) struct PendingCommit {
    new_patch: Option<NewPatch>,
    /// A folder to delete so that the install creates the package there again.
    stale_folder: Option<StaleFolder>,
}

struct NewPatch {
    name_and_version_hash: u64,
    path: ZBox,
    contents: Vec<u8>,
}

struct StaleFolder {
    /// The package, links resolved.
    package: Vec<u8>,
    /// The package's own entry of the isolated store around it, which is deleted with it.
    entry: Option<Vec<u8>>,
}

impl PendingCommit {
    /// The hash of the pending patch. An install hashes the patch files before it runs its checks,
    /// when this one is not on disk yet.
    pub(crate) fn patch_hash(&self, name_and_version_hash: u64) -> Option<u64> {
        (self.new_patch.as_ref())
            .filter(|patch| patch.name_and_version_hash == name_and_version_hash)
            .map(|patch| crate::patch_install::hash_patch(&patch.contents))
    }
}

/// Writes the pending patch file, if there is one, and returns its path.
pub(crate) fn write_pending_patch(
    manager: &mut PackageManager,
) -> Result<Option<ZBox>, crate::Error> {
    let Some(patch) = manager.pending_patch_commit.new_patch.take() else {
        return Ok(None);
    };
    let patches_dir = resolve_path::dirname::<platform::Posix>(patch.path.as_bytes());
    if let Err(e) = sys::mkdir_recursive(patches_dir) {
        Output::err(
            e,
            "failed to make patches dir {f}",
            (bun_fmt::quote(patches_dir),),
        );
        Global::crash();
    }

    // write the patch contents to temp file then rename
    let mut tmpname_buf = [0u8; 1024];
    let tempfile_name =
        bun_paths::fs::FileSystem::tmpname(b"tmp", &mut tmpname_buf, bun_core::fast_random())?;
    let tmpdir = get_temporary_directory(manager).handle.fd();
    if let Err(e) = sys::File::write_file(tmpdir, tempfile_name, &patch.contents) {
        Output::err(e, "failed to write patch to temp file", ());
        Global::crash();
    }
    if let Err(e) = sys::renameat_concurrently(
        tmpdir,
        tempfile_name,
        Fd::cwd(),
        &patch.path,
        sys::RenameOptions {
            move_fallback: true,
        },
    ) {
        Output::err(e, "failed renaming patch file to patches dir", ());
        Global::crash();
    }
    Ok(Some(patch.path))
}

/// Called right before the linker runs. The patch file has been written by then, so the edits in
/// the folder are not lost.
/// The package first leaves its path in one step: `delete_tree` can stop midway, and what then still has the file that an install looks for counts as installed.
pub(crate) fn remove_stale_folder(manager: &mut PackageManager) {
    let Some(stale) = manager.pending_patch_commit.stale_folder.take() else {
        return;
    };
    let staged = temp_sibling(&stale.package);
    let moved = sys::renameat(
        Fd::cwd(),
        &ZBox::from_bytes(&stale.package),
        Fd::cwd(),
        &ZBox::from_bytes(&staged),
    );
    let (package, unmarked) = match moved {
        Ok(()) => (&staged, Ok(())),
        Err(e) if e.get_errno() == sys::E::ENOENT => (&stale.package, Ok(())),
        // Refused, so it is deleted in place: what an install looks for first, and nothing more once that stays.
        Err(_) => (&stale.package, unlink_install_markers(&stale.package)),
    };
    let rest = stale.entry.as_ref().unwrap_or(package);
    if let Err(e) = unmarked.and_then(|()| Fd::cwd().delete_tree(rest)) {
        bun_core::warn!("failed to delete {}: {}", bstr::BStr::new(rest), e);
    }
}

/// Unlinks the files that make an install take the package in `folder` for installed: the marker of a patch first and `package.json` last, so that a file that stays leaves a copy that is whole or not installed.
fn unlink_install_markers(folder: &[u8]) -> sys::Result<()> {
    let dir = Dir::cwd().open_dir(folder, ITERATE)?;
    let mut markers: Vec<ZBox> = Vec::new();
    let mut iter = sys::iterate_dir(dir.fd);
    while let Some(entry) = iter.next()? {
        let name = entry.name.slice_u8();
        if entry.kind != sys::EntryKind::Directory && strings::has_prefix(name, crate::bun_hash_tag)
        {
            markers.push(ZBox::from_bytes(name));
        }
    }
    markers.push(ZBox::from_bytes(crate::package_install::BUN_TAG));
    markers.push(ZBox::from_bytes(b"package.json"));
    for marker in &markers {
        match sys::unlinkat(dir.fd, marker) {
            Err(e) if e.get_errno() != sys::E::ENOENT => return Err(e),
            _ => {}
        }
    }
    Ok(())
}

/// Returns true if `path`, which comes from the repository's lockfile, is a regular file in the
/// project. A path that leaves the project through `..`, an absolute path or a symlink doesn't
/// qualify.
fn is_file_of_the_project(path: &ZStr) -> bool {
    use resolve_path::{ParentEqual, is_parent_or_equal};
    if bin::bin_target_escapes_package_dir(path.as_bytes()) {
        return false;
    }
    let (Ok(stat), Ok(project), Ok(real)) = (
        sys::lstat(path),
        resolve_links(b"."),
        resolve_links(path.as_bytes()),
    ) else {
        return false;
    };
    sys::S::ISREG(stat.st_mode as _) && is_parent_or_equal(&project, &real) == ParentEqual::Parent
}

/// The package that the argument of `bun patch` or `bun patch --commit` refers to.
struct Target {
    pkg: Package,
    /// The folder as the user wrote it: relative to the project root unless it's absolute, with
    /// symlinks unresolved.
    folder: Vec<u8>,
    /// The package's other folders in the isolated store. It has one per set of resolved peers.
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

    // Every package except the ones that only ship inside another package's tarball.
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
            "<r><red>error<r>: refusing to patch {} <b>\"{}\"<r>",
            match pkg.resolution.tag {
                ResolutionTag::Folder => "file: folder",
                ResolutionTag::Symlink => "link: dependency",
                _ => "workspace package",
            },
            bstr::BStr::new(lockfile.str(&pkg.name)),
        );
        bun_core::note!("edit the folder directly");
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
        "<r><red>error<r>: refusing to patch bundled dependency <b>\"{}\"<r>",
        bstr::BStr::new(name),
    );
    bun_core::note!(
        "patch the package that bundles it, and edit it in that package's node_modules"
    );
    Global::crash();
}

/// A relative path from the user is relative to where the command was run, but the process has
/// since changed to the project root.
fn path_argument_from_root(
    lockfile: &Lockfile,
    workspace_package_id: PackageID,
    argument: &[u8],
) -> Vec<u8> {
    if workspace_package_id != 0 && !Platform::AUTO.is_absolute(argument) {
        let workspace =
            *lockfile.packages.items_resolution()[workspace_package_id as usize].workspace();
        let mut spill = Vec::new();
        let from_root = resolve_path::join_spill::<platform::Posix>(
            &mut spill,
            &[lockfile.str(&workspace), argument],
        )
        .to_vec();
        // The hoisted linker may have put the package in the root's node_modules only.
        if sys::exists(&from_root) || !sys::exists(argument) {
            return from_root;
        }
    }
    argument.to_vec()
}

fn read_name_and_version(manager: &PackageManager, folder: &[u8]) -> (Vec<u8>, Vec<u8>) {
    // `folder` is user input of any length, so the join can spill to the heap. A path that is too
    // long then simply fails to open.
    let mut spill = Vec::new();
    let package_json_path =
        resolve_path::join_z_spill::<platform::Auto>(&mut spill, &[folder, b"package.json"]);
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
pub(crate) enum FolderLookupError {
    NotInLockfile,
    /// The name matches git, tarball or folder packages, whose labels aren't versions.
    NeedsLabel,
}

/// Only an npm package's label is a version. A non-npm package only matches if it's the only
/// package with that name.
pub(crate) fn package_for_folder(
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
                "<r><red>error<r>: cannot patch <b>{}<r>: <b>{}@{}<r> not in lockfile",
                bstr::BStr::new(folder),
                bun_fmt::EscapeControlChars(bstr::BStr::new(name)),
                bun_fmt::EscapeControlChars(bstr::BStr::new(version)),
            );
            bun_core::note!(
                "if the edits changed \"version\" in its package.json, run <b>{} {}@\\<version in the lockfile\\><r> instead",
                command,
                bun_fmt::EscapeControlChars(bstr::BStr::new(name)),
            );
        }
        FolderLookupError::NeedsLabel => bun_core::pretty_errorln!(
            "<r><red>error<r>: cannot patch <b>{}<r>: no npm package <b>{}@{}<r> in lockfile. Other packages named <b>{}<r> have a git, tarball or folder label: run <b>{} \\<dependency\\>@\\<label\\><r>",
            bstr::BStr::new(folder),
            bun_fmt::EscapeControlChars(bstr::BStr::new(name)),
            bun_fmt::EscapeControlChars(bstr::BStr::new(version)),
            bun_fmt::EscapeControlChars(bstr::BStr::new(name)),
            command,
        ),
    }
    Global::crash();
}

/// - Arg is the dir containing the package with changes OR name and version
/// - Get the patch file contents by running git diff on the temp dir and the original package dir
/// - Update "patchedDependencies" in package.json
/// - Run install to install newly patched pkg
/// - Once the install's checks have passed, it writes $PATCHES_DIR/$PKG_NAME_AND_VERSION.patch
///
/// This function itself changes nothing in the project, because the install may still abort.
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

    // An install applies the patches that package.json lists, whatever bun.lock records, and their hashes name the entries of the isolated store.
    let recorded = RecordedPatches::swap_for_wanted(manager, &mut lockfile)?;
    let target = resolve_target(manager, &lockfile, "bun patch --commit");
    recorded.restore(&mut lockfile);
    let pkg = target.pkg;

    // `compute_cache_dir_and_subpath` resolves `pkg.resolution`'s strings against `manager.lockfile`.
    manager.lockfile = lockfile;
    download_if_not_cached(manager, &pkg);
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
    let cache_dir = cache_result.cache_dir;
    let cache_dir_subpath = cache_result.cache_dir_subpath.as_bytes().to_vec();
    let cache_path = cache_dir_path(cache_dir);
    let old_folder =
        resolve_path::join::<platform::Posix>(&[&cache_path, &cache_dir_subpath]).to_vec();
    let new_folder = real_folder(&cache_path, &target.folder, false);
    let stamp_file: &[u8] = PatchStamp::file(pkg.resolution.tag);
    let unstamped = match PatchStamp::without_hash(&new_folder, &old_folder, pkg.resolution.tag) {
        Ok(unstamped) => unstamped.map(|(contents, mode)| (stamp_file, contents, mode)),
        Err(e) => {
            Output::err(
                e,
                "failed to read <b>{s}<r> in <b>{s}<r>",
                (bstr::BStr::new(stamp_file), bstr::BStr::new(&target.folder)),
            );
            Global::crash();
        }
    };
    // Neither package.json nor the lockfile lists a patch for the package: what differs in this copy is another commit's patch, not an edit.
    if !is_patch_listed(manager, &patch_key)
        && (unstamped.is_some()
            || is_stale_store_copy(manager, pkg.meta.id, &new_folder, &old_folder))
    {
        bun_core::pretty_errorln!(
            "<r><red>error<r>: refusing to patch <b>{}<r>: it holds a patch that \"patchedDependencies\" does not list",
            bstr::BStr::new(&target.folder),
        );
        bun_core::note!("run <cyan>bun install<r> first");
        Global::crash();
    }
    make_bins_executable(
        &manager.lockfile,
        &pkg,
        cache_dir,
        &cache_dir_subpath,
        &new_folder,
    );

    let Some(patchfile_contents) = diff_against_cache(manager, &old_folder, &new_folder, unstamped)
    else {
        Global::crash();
    };

    if patchfile_contents.is_empty() {
        // Undoing every edit and committing is how a user removes a patch.
        let patched = &manager.lockfile.patched_dependencies;
        if let Some(registered) = patched.get(&string_hash(&patch_key)) {
            let patchfile_path = Box::<[u8]>::from(manager.lockfile.str(&registered.path));
            if manager.options.dry_run {
                bun_core::prettyln!(
                    "<r><d>dry run:<r> would remove the patch for <b>{}<r> ({})",
                    bun_fmt::for_terminal(bstr::BStr::new(&patch_key)),
                    bun_fmt::escape_control_chars(&patchfile_path),
                );
                Output::flush();
                Global::exit(0);
            }
            manager.pending_patch_commit.stale_folder =
                copy_at_link_position(linker, &manager.lockfile, &pkg, new_folder);
            return Ok(Some(PatchCommitResult {
                patch_key: patch_key.into_boxed_slice(),
                patchfile_path,
                not_in_workspace_root: target.not_in_workspace_root,
                removes_patch: true,
            }));
        }
        bun_core::pretty!(
            "\n<r>No changes detected, comparing <red>{}<r> to <green>{}<r>\n",
            bstr::BStr::new(&old_folder),
            bstr::BStr::new(&target.folder)
        );
        // Running `bun patch` from another directory prepares the folder that the workspace there
        // loads.
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
        // The copy has no edits to keep, and it lacks the files that the package's scripts create.
        // Delete it so that the install creates the package again and runs its scripts.
        if !manager.options.dry_run && has_trusted_scripts(manager, &pkg, &name, &new_folder) {
            manager.pending_patch_commit.stale_folder = Some(StaleFolder {
                package: new_folder,
                entry: None,
            });
        }
        return Ok(None);
    }

    // A "Binary files ... differ" line does not contain the change itself, so an install would skip
    // it with a warning.
    let mut binary_files = strings::split(&patchfile_contents, b"\n")
        .filter(|line| line.starts_with(b"Binary files ") && line.ends_with(b" differ"))
        .peekable();
    if binary_files.peek().is_some() {
        bun_core::pretty_errorln!(
            "<r><red>error<r>: patches cannot contain binary file changes. found in <b>{}<r>:",
            bstr::BStr::new(&target.folder),
        );
        for line in binary_files {
            bun_core::pretty_errorln!("  {}", bun_fmt::EscapeControlChars(bstr::BStr::new(line)));
        }
        bun_core::note!("undo the changes to these files, then commit again");
        Global::crash();
    }

    // The file name is printed and committed to the repository, so a URL in the key loses its
    // credentials, as it does in the name of a store folder.
    let mut patch_filename = Vec::new();
    append_without_url_credentials(&mut patch_filename, &patch_key);
    patch_filename.extend_from_slice(b".patch");
    let patch_filename = escape_patch_filename(&patch_filename);

    // Try the patch before writing anything. A patch that does not apply would make every later
    // install fail.
    if !patch_applies(
        cache_dir,
        &cache_dir_subpath,
        &new_folder,
        &bun_ast::Source::init_path_string(&patch_filename[..], &patchfile_contents[..]),
    ) {
        bun_core::note!(
            "no changes made to <b>{}<r>, package.json or the lockfile",
            bstr::BStr::new(&target.folder),
        );
        Global::crash();
    }

    let typed_patches_dir: &[u8] = match &manager.options.patch_features {
        PatchFeatures::Commit { patches_dir } => patches_dir,
        // Reaching `doPatchCommit` implies `Subcommand::PatchCommit`, which always
        // sets `patch_features = .commit` in `Options::load`.
        _ => unreachable!("patch_features must be Commit in doPatchCommit"),
    };

    // Check the length first, because the path functions below need input that fits a path buffer.
    if typed_patches_dir.len() >= bun_paths::MAX_PATH_BYTES {
        Output::err(
            sys::Error::from_code(sys::E::ENAMETOOLONG, sys::Tag::mkdir),
            "failed to make patches dir {f}",
            (bun_fmt::quote(typed_patches_dir),),
        );
        Global::crash();
    }

    // Paths use `/` from here on. On Windows this replaces each `\`, so that the path written to
    // package.json also works on other systems.
    let with_slashes = |path: &[u8]| {
        let mut path = path.to_vec();
        resolve_path::platform_to_posix_in_place(&mut path[..]);
        path
    };
    let mut patches_dir = with_slashes(typed_patches_dir);

    // package.json is shared with other machines, so an absolute path to a directory inside the
    // project is written relative to the project root.
    let project = with_slashes(FileSystem::instance().top_level_dir());
    if bun_paths::is_absolute(&patches_dir)
        && resolve_path::is_parent_or_equal(&project, &patches_dir)
            != resolve_path::ParentEqual::Unrelated
    {
        patches_dir = with_slashes(resolve_path::relative(&project, &patches_dir));
    }

    // Copy the result: `join_spill` usually returns the thread-local buffer that every later join
    // overwrites.
    let path_in_patches_dir = ZBox::from_bytes(resolve_path::join_spill::<platform::Posix>(
        &mut Vec::new(),
        &[&patches_dir, &patch_filename],
    ));

    if manager.options.dry_run {
        bun_core::prettyln!(
            "<r><d>dry run:<r> would write {} and add <b>{}<r> to patchedDependencies",
            bun_fmt::escape_control_chars(path_in_patches_dir.as_bytes()),
            bun_fmt::for_terminal(bstr::BStr::new(&patch_key)),
        );
        Output::flush();
        Global::exit(0);
    }

    let patchfile_path = Box::<[u8]>::from(path_in_patches_dir.as_bytes());
    manager.pending_patch_commit = PendingCommit {
        new_patch: Some(NewPatch {
            name_and_version_hash: string_hash(&patch_key),
            path: path_in_patches_dir,
            contents: patchfile_contents,
        }),
        stale_folder: copy_at_link_position(linker, &manager.lockfile, &pkg, new_folder),
    };

    Ok(Some(PatchCommitResult {
        patch_key: patch_key.into_boxed_slice(),
        patchfile_path,
        not_in_workspace_root: target.not_in_workspace_root,
        removes_patch: false,
    }))
}

/// Returns the copy that `bun patch` made for the isolated linker: `folder` where a symlink goes, or `folder` with the store entry around it if that entry is the package's own, whose name comes from the patch before this commit.
/// An install does not replace such a copy, so it has to be deleted first.
/// `None` for any other folder of the store, such as a dependency that another package bundles.
fn copy_at_link_position(
    linker: NodeLinker,
    lockfile: &Lockfile,
    pkg: &Package,
    folder: Vec<u8>,
) -> Option<StaleFolder> {
    if linker != NodeLinker::Isolated {
        return None;
    }
    let entry = match store_entry_of(&folder) {
        None if is_link_position(&folder) => None,
        None => return None,
        Some(entry) if is_own_entry(lockfile, pkg, &entry, &folder) => Some(entry),
        Some(entry) if is_store_link_position(&entry, &folder) => None,
        Some(_) => return None,
    };
    Some(StaleFolder {
        package: folder,
        entry,
    })
}

/// Whether `entry` of the isolated store has the name of `pkg` and `folder` is the package in it.
fn is_own_entry(lockfile: &Lockfile, pkg: &Package, entry: &[u8], folder: &[u8]) -> bool {
    let string_buf = lockfile.buffers.string_bytes.as_slice();
    let key = store_entry::fmt_store_key(pkg.name, &pkg.resolution, string_buf).to_string();
    let name = pkg.name.slice(string_buf);
    is_entry_of(bun_paths::basename(entry), key.as_bytes())
        && folder == resolve_path::join::<platform::Auto>(&[entry, b"node_modules", name])
}

/// Whether `patchedDependencies` has `patch_key`, in the lockfile or in the root package.json.
fn is_patch_listed(manager: &mut PackageManager, patch_key: &[u8]) -> bool {
    let recorded = &manager.lockfile.patched_dependencies;
    recorded.contains(&string_hash(patch_key))
        || crate::update_transitive::patched_dependency_keys(manager)
            .iter()
            .any(|key| **key == *patch_key)
}

/// `node_modules/.bun/<entry>`, links resolved, when `folder` is inside that entry.
fn store_entry_of(folder: &[u8]) -> Option<Vec<u8>> {
    use resolve_path::{ParentEqual, is_parent_or_equal};
    let store = resolve_links(b"node_modules/.bun").ok()?;
    if is_parent_or_equal(&store, folder) != ParentEqual::Parent {
        return None;
    }
    let entry = strings::tokenize_any(&folder[store.len()..], b"/\\").next()?;
    Some(resolve_path::join::<platform::Auto>(&[&store, entry]).to_vec())
}

/// Whether `folder`, links resolved, is a patched package in a store entry under a name that the lockfile does not give.
fn is_stale_store_copy(
    manager: &PackageManager,
    pkg_id: PackageID,
    folder: &[u8],
    cache_entry: &[u8],
) -> bool {
    let Some(entry) = store_entry_of(folder) else {
        return false;
    };
    if !has_patch_marker(folder, Some(cache_entry)) {
        return false;
    }
    let lockfile: &Lockfile = &manager.lockfile;
    let store = handle_oom(build_whole_store(manager, lockfile));
    let node_pkg_ids = store.nodes.items_pkg_id();
    let entry_pkgs =
        (store.entries.items_node_id().iter()).map(|node| node_pkg_ids[node.get() as usize]);
    !entry_pkgs.enumerate().any(|(id, pkg)| {
        let name = store_entry::fmt_store_path(store_entry::Id::from(id as u32), &store, lockfile);
        pkg == pkg_id && name.to_string().as_bytes() == bun_paths::basename(&entry)
    })
}

/// Whether `folder` has the marker file of a patch. The package in `cache_entry` can ship one of its own.
fn has_patch_marker(folder: &[u8], cache_entry: Option<&[u8]>) -> bool {
    let Ok(dir) = Dir::cwd().open_dir(folder, ITERATE) else {
        return false;
    };
    let mut iter = sys::iterate_dir(dir.fd);
    while let Ok(Some(entry)) = iter.next() {
        let name = entry.name.slice_u8();
        let is_shipped = |cache_entry: &[u8]| {
            sys::exists(resolve_path::join::<platform::Auto>(&[cache_entry, name]))
        };
        if entry.kind != sys::EntryKind::Directory
            && strings::has_prefix(name, crate::bun_hash_tag)
            && !cache_entry.is_some_and(is_shipped)
        {
            return true;
        }
    }
    false
}

/// Applies the patch to a scratch copy of the package, the way an install would. On failure, prints
/// an error and returns `false`.
fn patch_applies(
    cache_dir: Fd,
    cache_dir_subpath: &[u8],
    folder: &[u8],
    patch: &bun_ast::Source,
) -> bool {
    let mut log = bun_ast::Log::init();
    let patchfile = crate::patch_install::parse_patch_source(patch, &mut log);
    let _ = log.print(std::ptr::from_mut(Output::error_writer()));
    // An install only warns about the sections it skips, because older versions of Bun wrote patch
    // files that have them. A new patch must not have any.
    let Some(patchfile) = patchfile.filter(|patchfile| patchfile.skipped.is_empty()) else {
        return false;
    };
    let scratch = TempTree(temp_sibling(folder));
    if let Err(e) = copy_cache_entry(cache_dir, cache_dir_subpath, &scratch.0) {
        bun_core::pretty_errorln!(
            "<r><red>error<r>: failed to copy package to test the patch: {}",
            e.name(),
        );
        return false;
    }
    let applied = Dir::cwd()
        .open_dir(&scratch.0, Default::default())
        .map_err(bun_patch::ApplyError::Sys)
        .and_then(|dir| patchfile.apply(dir.fd));
    if let Err(e) = applied {
        bun_core::pretty_errorln!("<r><red>error<r>: failed applying patch file: {}", e);
        return false;
    }
    true
}

/// Returns `None` after printing an error. Calling `Global::crash()` in here would skip
/// `HiddenFromDiff`'s drop.
fn diff_against_cache(
    manager: &mut PackageManager,
    old_folder: &[u8],
    new_folder: &[u8],
    unstamped: Option<(&[u8], Vec<u8>, sys::Mode)>,
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
    let event_loop = &mut manager.event_loop;
    let mut diff = git_diff(event_loop, cwd, git, [old_folder, new_folder], None)?;

    // The copy keeps the file that names its patch, so a commit that dies here leaves what the next install reads.
    if let Some((file, contents, mode)) = unstamped {
        let scratch = TempTree(temp_sibling(new_folder));
        if let Err(e) = write_scratch_file(&scratch.0, file, &contents, mode) {
            Output::err(
                e,
                "failed to write <b>{s}<r> in <b>{s}<r>",
                (bstr::BStr::new(file), bstr::BStr::new(&scratch.0)),
            );
            return None;
        }
        let section = git_diff(event_loop, cwd, git, [old_folder, &scratch.0], Some(file))?;
        replace_diff_of_file(&mut diff, file, &section);
    }
    Some(diff)
}

/// Makes `folder` and writes `contents` to `file` in it.
fn write_scratch_file(
    folder: &[u8],
    file: &[u8],
    contents: &[u8],
    mode: sys::Mode,
) -> sys::Result<()> {
    Fd::cwd().make_path(folder)?;
    let path = resolve_path::join::<platform::Auto>(&[folder, file]);
    let flags = sys::O::WRONLY | sys::O::CREAT | sys::O::EXCL;
    let created = sys::File::openat(Fd::cwd(), path, flags, mode)?;
    // The umask cut the mode, and git compares the executable bit.
    #[cfg(not(windows))]
    let _ = sys::fchmod(created.handle(), mode);
    created.write_all(contents)
}

/// Replaces the section of `file` in the output of `git diff` with `section`.
fn replace_diff_of_file(diff: &mut Vec<u8>, file: &[u8], section: &[u8]) {
    let header = [b"diff --git a/".as_slice(), file, b" b/", file, b"\n"].concat();
    let mut from = 0;
    let start = loop {
        let Some(found) = strings::index_of(&diff[from..], &header) else {
            return;
        };
        let found = from + found;
        if found == 0 || diff[found - 1] == b'\n' {
            break found;
        }
        from = found + 1;
    };
    let header_end = start + header.len() - 1;
    let end = strings::index_of(&diff[header_end..], b"\ndiff --git ")
        .map_or(diff.len(), |next| header_end + next + 1);
    diff.splice(start..end, section.iter().copied());
}

/// `git diff --no-index` of two folders, or of `file` in both. `None` after a printed error.
fn git_diff(
    event_loop: &mut bun_event_loop::AnyEventLoop,
    cwd: &ZStr,
    git: &ZStr,
    folders: [&[u8]; 2],
    file: Option<&[u8]>,
) -> Option<Vec<u8>> {
    // The `./` that `from_cwd` adds puts a `/./` in the folder prefixes that are stripped from the
    // diff afterwards, which no path inside the package can match.
    let folders = bun_patch::git_diff_preprocess_paths(
        &from_cwd(cwd.as_bytes(), folders[0]),
        &from_cwd(cwd.as_bytes(), folders[1]),
    );
    let files = file
        .map(|file| (folders.each_ref()).map(|folder| [folder.as_slice(), b"/", file].concat()));
    let paths = files.as_ref().unwrap_or(&folders);
    let (opts, _envp_guard) = bun_patch::spawn_opts(&paths[0], &paths[1], cwd, git, event_loop);

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

    match bun_patch::diff_post_process(&mut spawn_result, &folders[0], &folders[1]) {
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
                bun_fmt::escape_control_chars_multiline(&stderr)
            );
            None
        }
    }
}

const ITERATE: sys::OpenDirOptions = sys::OpenDirOptions {
    iterate: true,
    no_follow: false,
};

/// `git diff --no-index` doesn't accept a pathspec, so everything in the folder that isn't part of
/// the package is moved next to it until this is dropped.
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
                "failed to move {} back into package folder: {}",
                bstr::BStr::new(&self.stash_path),
                e
            ),
        }
    }
}

/// `@scope` and `.bin` contain entries from several packages, so they're merged one level down.
fn is_package_group(name: &[u8]) -> bool {
    strings::starts_with_char(name, b'@') || name == b".bin"
}

/// Moves the entries of `from` that aren't in `reference` into `to`. With `None`, moves all of
/// them.
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

/// The characters `:?*"<>|` are reserved on NTFS. They're escaped on every OS, so that `patches/`
/// can be checked out on Windows.
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
    if manager.options.dry_run {
        bun_core::prettyln!(
            "\n<r><d>dry run:<r> would replace {} with a copy of <b>{}<r> to edit",
            bstr::BStr::new(&target.folder),
            bstr::BStr::new(&pkg_name),
        );
        return Ok(());
    }
    // A package that is patched already starts from its patched copy.
    let patch_key_hash = string_hash(&patch_key_of(&manager.lockfile, &pkg));
    let existing_patchfile_hash: Option<u64> = manager
        .lockfile
        .patched_dependencies
        .get(&patch_key_hash)
        .and_then(|patched_dep| patched_dep.patchfile_hash());

    download_if_not_cached(manager, &pkg);
    if let Some(patchfile_hash) = existing_patchfile_hash {
        apply_patch_if_not_cached(manager, pkg.meta.id, patchfile_hash, patch_key_hash)?;
    }

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
    // The folder is only missing for a package in the global store that no package.json in the
    // project depends on directly.
    let is_loaded = sys::exists(&folder);

    make_bins_executable(
        &manager.lockfile,
        &pkg,
        cache_result.cache_dir,
        cache_result.cache_dir_subpath.as_bytes(),
        &folder,
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
    // Outside the isolated store a patched copy names its patch, see `PatchStamp`. The cache folder that it is a copy of does not.
    if let Some(patch_hash) = existing_patchfile_hash
        && store_entry_of(&folder).is_none()
        && let Err(e) = PatchStamp::write(Fd::cwd(), &folder, pkg.resolution.tag, patch_hash)
    {
        Output::err(
            e,
            "failed to write <b>{s}<r> in <b>{s}<r>",
            (
                bstr::BStr::new(PatchStamp::file(pkg.resolution.tag).as_bytes()),
                bstr::BStr::new(&target.folder),
            ),
        );
        Global::crash();
    }

    let mut spill = Vec::new();
    let shown_folder: &[u8] = if target.not_in_workspace_root {
        resolve_path::join_spill::<platform::Posix>(
            &mut spill,
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
    if !is_loaded {
        bun_core::pretty!(
            "\nDependents of <b>{}<r> load it from the global store and will not see changes until <cyan>bun patch --commit<r>.\n",
            bstr::BStr::new(&pkg_name),
        );
    }
    if has_trusted_scripts(manager, &pkg, &pkg_name, &folder) {
        bun_core::pretty!(
            "\nInstall scripts of <b>{}<r> have not run on this copy. They run on <cyan>bun patch --commit<r>.\n",
            bstr::BStr::new(&pkg_name),
        );
    }

    Ok(())
}

/// Returns true if an install runs lifecycle scripts for this package. The files they created are
/// lost when `bun patch` replaces the folder with a copy from the cache.
fn has_trusted_scripts(
    manager: &PackageManager,
    pkg: &Package,
    name: &[u8],
    folder: &[u8],
) -> bool {
    if !manager.options.do_.run_scripts()
        || !(manager.lockfile).has_trusted_dependency(name, name, &pkg.resolution)
    {
        return false;
    }
    let Ok(mut folder_path) = bun_paths::AutoAbsPath::from(folder) else {
        return false;
    };
    // bun.lock does not record a dependency's scripts, so they are read from its package.json.
    let mut scripts = pkg.scripts;
    let list = scripts.get_list(
        &mut bun_ast::Log::init(),
        &manager.lockfile,
        &mut folder_path,
        name,
        &pkg.resolution,
        true,
    );
    matches!(list, Ok(Some(list)) if list.total > 0)
}

/// A package can be installed but no longer cached, for example after `bun pm cache rm` or on a CI
/// that only preserves node_modules.
fn download_if_not_cached(manager: &mut PackageManager, pkg: &Package) {
    let name = manager.lockfile.str(&pkg.name).to_vec();
    let is_cached = |manager: &mut PackageManager| {
        let mut folder_path_buf = bun_paths::path_buffer_pool::get();
        let entry = compute_cache_dir_and_subpath(
            manager,
            &name,
            &pkg.resolution,
            &pkg.meta.integrity,
            &mut folder_path_buf,
            None,
        );
        is_package_in_cache_at(entry.cache_dir, entry.cache_dir_subpath, pkg.resolution.tag)
    };
    if is_cached(manager) {
        return;
    }
    if download_pinned_packages(manager, Some(pkg.meta.id), false).is_err() || !is_cached(manager) {
        let _ = manager
            .log_mut()
            .print(std::ptr::from_mut(Output::error_writer()));
        bun_core::pretty_errorln!(
            "<r><red>error<r>: <b>{}<r> not in cache, re-download failed",
            bstr::BStr::new(&name),
        );
        Global::crash();
    }
}

/// Makes the package's `bin` targets executable in its cache entry. An install does that in
/// node_modules, which only reaches the cache entry if the files are hardlinks.
fn make_bins_executable(
    lockfile: &Lockfile,
    pkg: &Package,
    cache_dir: Fd,
    cache_dir_subpath: &[u8],
    folder: &[u8],
) {
    if cfg!(windows) || pkg.bin.tag == bin::Tag::None {
        return;
    }
    // `bin::Linker` sets the mode of the files it links to. The links themselves are not needed, so
    // they go in a temporary folder.
    let links = TempTree(temp_sibling(folder));
    let (Ok(cache_path), Ok(mut links_path)) = (
        <AbsPath>::init_fd_path(cache_dir),
        <AbsPath>::from(links.0.as_slice()),
    ) else {
        return;
    };
    let cache_entry = strings::StringOrTinyString::init(cache_dir_subpath);
    let mut abs_target_buf = bun_paths::path_buffer_pool::get();
    let mut abs_dest_buf = bun_paths::path_buffer_pool::get();
    let mut rel_buf = bun_paths::path_buffer_pool::get();
    bin::Linker {
        bin: pkg.bin,
        target_node_modules_path: &raw const cache_path,
        target_package_name: cache_entry,
        seen: None,
        node_modules_path: &mut links_path,
        package_name: cache_entry,
        global_bin_path: ZStr::EMPTY,
        string_buf: lockfile.buffers.string_bytes.as_slice(),
        extern_string_buf: lockfile.buffers.extern_strings.as_slice(),
        abs_target_buf: abs_target_buf.as_mut_slice(),
        abs_dest_buf: abs_dest_buf.as_mut_slice(),
        rel_buf: rel_buf.as_mut_slice(),
        is_behind_link: Some(false),
        err: None,
        skipped_due_to_missing_bin: false,
    }
    .link(false);
}

/// The patched package's cache entry can be missing, because an install that finds the patched
/// package in node_modules does not create the entry again.
fn apply_patch_if_not_cached(
    manager: &mut PackageManager,
    pkg_id: PackageID,
    patchfile_hash: u64,
    patch_key_hash: u64,
) -> Result<(), crate::Error> {
    let mut task = PatchTask::new_apply_patch_hash(manager, pkg_id, patchfile_hash, patch_key_hash);
    let apply = task.callback.apply_mut();
    let patched_entry = apply.cache_dir_subpath.as_zstr();
    if sys::directory_exists_at(apply.cache_dir, patched_entry).unwrap_or(false) {
        return Ok(());
    }
    handle_oom(task.apply());
    let log_level = manager.options.log_level;
    task.run_from_main_thread(manager, log_level)?;
    if task.callback.apply_mut().logger.has_errors() {
        Global::crash();
    }
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

/// Returns `path` with every symlink resolved. The part that doesn't exist yet is appended
/// unchanged.
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

/// Returns `folder` with symlinks resolved. If that's inside the shared global store and
/// `replaces_folder` is set, returns the last symlink on the way instead, which `bun patch`
/// replaces with a copy.
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
        "<r><red>error<r>: refusing to patch <b>{}<r>: resolves into the shared global store",
        bstr::BStr::new(folder),
    );
    if replaces_folder {
        bun_core::note!(
            "set <b>globalStore = false<r> under <b>[install]<r> in bunfig.toml, run <cyan>bun install<r> and patch the package again"
        );
    } else {
        bun_core::note!("run <cyan>bun patch<r> on the package first to create an editable copy");
    }
    Global::crash();
}

fn is_link(path: &[u8]) -> bool {
    let mut buf = bun_paths::path_buffer_pool::get();
    sys::readlink(&ZBox::from_bytes(path), &mut buf[..]).is_ok()
}

/// Returns true if `folder`, with symlinks resolved, is an entry of a project's `node_modules`
/// outside `node_modules/.bun`.
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

/// Whether `folder` is where `entry`, a directory of `node_modules/.bun`, has the link to a package: in the `node_modules` of a package's entry, or in `node_modules/.bun/node_modules` itself.
fn is_store_link_position(entry: &[u8], folder: &[u8]) -> bool {
    use resolve_path::dirname;
    let mut links = dirname::<platform::Auto>(folder);
    if strings::starts_with_char(bun_paths::basename(links), b'@') {
        links = dirname::<platform::Auto>(links);
    }
    if bun_paths::basename(entry) == b"node_modules" {
        return links == entry;
    }
    bun_paths::basename(links) == b"node_modules" && dirname::<platform::Auto>(links) == entry
}

/// Uses the same naming as an install's staging folder, so that `bun prune` removes it if a crash
/// leaves it behind.
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

/// `folder` is never left half-written: the copy is created next to it and then renamed into place.
fn replace_with_cache_copy(
    cache_dir: Fd,
    cache_dir_subpath: &[u8],
    folder: &[u8],
) -> Result<(), crate::Error> {
    let cwd = Fd::cwd();
    let staging = TempTree(temp_sibling(folder));
    copy_cache_entry(cache_dir, cache_dir_subpath, &staging.0)?;

    let old_path = temp_sibling(folder);
    let folder_z = ZBox::from_bytes(folder);
    let staging_z = ZBox::from_bytes(&staging.0);
    let old_z = ZBox::from_bytes(&old_path);

    let has_old = match move_aside(&folder_z, &old_z) {
        Ok(()) => true,
        Err(e) if e.get_errno() == sys::E::ENOENT => false,
        Err(e) => return Err(e.into()),
    };
    // `old_path` is only marked for deletion now. After a failed `move_aside` it can hold entries
    // that could not be moved back.
    let old = TempTree(old_path);

    if let Err(e) = rename_staging_into_place(cwd, &staging_z, &folder_z) {
        if has_old && let Err(restore_err) = move_aside(&old_z, &folder_z) {
            bun_core::warn!(
                "failed to restore previous package folder (now at {}): {}",
                bstr::BStr::new(&old.keep()),
                restore_err
            );
        }
        return Err(e.into());
    }

    if has_old {
        // If the old folder was a symlink, it points into the global store, which other projects
        // share, so only the symlink itself is removed.
        if is_link(&old.0) {
            if let Err(e) = link_store_siblings(&old.0, folder) {
                bun_core::warn!(
                    "failed to link package dependencies into {}: {}",
                    bstr::BStr::new(folder),
                    e
                );
            }
            let _ = crate::isolated_install::installer::remove_link(&old_z);
        } else if let Err(e) = keep_nested_packages(&old.0, folder) {
            bun_core::warn!(
                "failed to keep packages under {}, run bun install to restore them: {}",
                bstr::BStr::new(folder),
                e
            );
        }
    }
    Ok(())
}

/// Renames `folder` to `aside`. If that is refused (an open file on Windows, a lower overlayfs
/// layer in Docker), the entries are moved one by one, and moved back if that fails.
fn move_aside(folder: &ZStr, aside: &ZStr) -> sys::Result<()> {
    let cwd = Dir::cwd();
    let Err(refused) = sys::renameat(cwd.fd, folder, cwd.fd, aside) else {
        return Ok(());
    };
    // If `folder` is a symlink, it points into the global store, which other projects share, so
    // nothing is moved out of it.
    if refused.get_errno() == sys::E::ENOENT || is_link(folder.as_bytes()) {
        return Err(refused);
    }
    let move_all = |from: &ZStr, to: &ZStr| -> sys::Result<()> {
        move_entries(
            &cwd.open_dir(from.as_bytes(), ITERATE)?,
            &cwd.make_open_path(to.as_bytes(), Default::default())?,
        )?;
        sys::rmdir(from)
    };
    move_all(folder, aside).inspect_err(|_| match move_all(aside, folder) {
        Err(e) if e.get_errno() != sys::E::ENOENT => bun_core::warn!(
            "failed to restore package folder (rest is at {}): {}",
            bstr::BStr::new(aside.as_bytes()),
            e
        ),
        _ => {}
    })
}

/// Moves every entry of `from` into `to`, descending into a subfolder that cannot be renamed.
fn move_entries(from: &Dir, to: &Dir) -> sys::Result<()> {
    let mut iter = sys::iterate_dir(from.fd);
    while let Some(entry) = iter.next()? {
        let name = ZBox::from_bytes(entry.name.slice_u8());
        let Err(refused) = sys::renameat(from.fd, &name, to.fd, &name) else {
            continue;
        };
        let kind = crate::prune::entry_kind(from, name.as_bytes(), entry.kind);
        if kind != sys::EntryKind::Directory {
            return Err(refused);
        }
        move_entries(
            &from.open_dir(name.as_bytes(), ITERATE)?,
            &to.make_open_path(name.as_bytes(), Default::default())?,
        )?;
        sys::rmdirat(from.fd, &name)?;
    }
    Ok(())
}

/// In the global store, the symlinks to a package's dependencies are siblings of the package. The
/// copy in `folder` gets them in its own node_modules, where `--commit` keeps them out of the diff.
fn link_store_siblings(link: &[u8], folder: &[u8]) -> sys::Result<()> {
    let package = resolve_links(link)?;
    let mut siblings = resolve_path::dirname::<platform::Auto>(&package);
    if strings::starts_with_char(bun_paths::basename(siblings), b'@') {
        siblings = resolve_path::dirname::<platform::Auto>(siblings);
    }
    let node_modules = resolve_path::join::<platform::Auto>(&[folder, b"node_modules"]).to_vec();
    link_entries(siblings, &node_modules, &package)
}

/// Creates a symlink in `to` for each entry of `from` other than `except`. The entries of an
/// `@scope` folder are linked one by one.
fn link_entries(from: &[u8], to: &[u8], except: &[u8]) -> sys::Result<()> {
    let dir = Dir::cwd().open_dir(from, ITERATE)?;
    let mut iter = sys::iterate_dir(dir.fd);
    while let Some(entry) = iter.next()? {
        let name = entry.name.slice_u8();
        let target = ZBox::from_bytes(resolve_path::join::<platform::Auto>(&[from, name]));
        let link = ZBox::from_bytes(resolve_path::join::<platform::Auto>(&[to, name]));
        if target.as_bytes() == except {
            continue;
        }
        if entry.kind == sys::EntryKind::Directory && strings::starts_with_char(name, b'@') {
            link_entries(target.as_bytes(), link.as_bytes(), except)?;
            continue;
        }
        Fd::cwd().make_path(to)?;
        #[cfg(windows)]
        let linked = sys::symlink_or_junction(&link, &target, None);
        #[cfg(not(windows))]
        let linked = sys::symlink(&target, &link);
        match linked {
            // A dependency that the package bundles already exists and wins, as in the store.
            Err(e) if e.get_errno() != sys::E::EEXIST => return Err(e),
            _ => {}
        }
    }
    Ok(())
}

/// On POSIX, returns `path` relative to `cwd` with a leading `./`, because the project's own path
/// can contain a `\` or a `"` there. On Windows, returns `path` unchanged.
fn from_cwd(cwd: &[u8], path: &[u8]) -> Vec<u8> {
    if cfg!(windows) {
        return path.to_vec();
    }
    // Both paths are already absolute and normalized. `relative` would normalize them again, and
    // that treats a `\` as a separator.
    let relative = resolve_path::relative_normalized::<platform::Auto, false>(cwd, path);
    [&b"./"[..], relative].concat()
}

/// Copies the whole cache entry to `to`. Nothing is skipped, because `--commit` records any file
/// that the cache entry has and the copy lacks as deleted.
fn copy_cache_entry(
    cache_dir: Fd,
    cache_dir_subpath: &[u8],
    to: &[u8],
) -> Result<(), crate::Error> {
    // Open the cache entry before changing anything, because it may no longer exist.
    let cached_package_folder = Dir::borrow(&cache_dir).open_dir(cache_dir_subpath, ITERATE)?;

    // FileCopier's path fields are `.unit = .os` (u16 on Windows). `Path::from`
    // is generic over the *input* width and converts internally, so accepting
    // `&[u8]` and producing `Path<OSPathChar>` is intentional. `.sep = .auto`
    // is required so `/` is normalized to `\` on Windows. On POSIX it turns a `\` into a `/`, so
    // `from_cwd` keeps the project's own path, which may contain a `\`, out of `to`.
    let mut cwd_buf = bun_paths::path_buffer_pool::get();
    let to = from_cwd(sys::getcwd_z(&mut cwd_buf)?.as_bytes(), to);
    let dest_subpath = bun_paths::Path::<
        bun_paths::OSPathChar,
        { bun_paths::path_options::Kind::ANY },
        { bun_paths::path_options::PathSeparators::AUTO },
    >::from(to.as_slice())?;

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

    FileCopier::init(cached_package_folder.fd, src_path, dest_subpath, &[])?.copy()?;
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

/// Returns the package's store entries. It has one per set of resolved peers. The ones that the
/// current workspace loads come first.
pub(crate) fn isolated_store_folders(
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

    // Under the name that the lockfile and the patch files give the entry now. The last install can have linked it under another.
    let named_dir = |entry: usize| -> Vec<u8> {
        let mut dir = Vec::new();
        write!(
            dir,
            "node_modules/.bun/{}",
            store_entry::fmt_store_path(store_entry::Id::from(entry as u32), &store, lockfile),
        )
        .expect("formatting into a Vec is infallible");
        dir
    };

    let string_buf = lockfile.buffers.string_bytes.as_slice();
    let dependencies = lockfile.buffers.dependencies.as_slice();
    let names = lockfile.packages.items_name();
    let is_importer = |entry: usize| {
        matches!(
            resolutions[entry_pkgs[entry] as usize].tag,
            ResolutionTag::Root | ResolutionTag::Workspace
        )
    };
    let alias_of = |dep_id: DependencyID| {
        (dependencies.get(dep_id as usize))
            .map(|dependency| dependency.name.slice(string_buf))
            .filter(|alias| alias_is_safe_install_target(alias))
    };
    // Where the isolated linker puts the link to the dependency `alias` of the entry `dependent`, which is in `dir`.
    let link_of = |dependent: usize, dir: &[u8], alias: &[u8]| -> Vec<u8> {
        let dependent_pkg = entry_pkgs[dependent] as usize;
        let resolution = &resolutions[dependent_pkg];
        let (mut link, own_name) = match resolution.tag {
            ResolutionTag::Root => (Vec::new(), None),
            ResolutionTag::Workspace => (resolution.workspace().slice(string_buf).to_vec(), None),
            ResolutionTag::Symlink => (dir.to_vec(), None),
            _ => (dir.to_vec(), Some(names[dependent_pkg].slice(string_buf))),
        };
        if !link.is_empty() {
            link.push(b'/');
        }
        write!(link, "node_modules/{}", bstr::BStr::new(alias))
            .expect("formatting into a Vec is infallible");
        // A dependency with the name of the package's own folder is linked inside that folder.
        if own_name == Some(alias) {
            write!(link, "/node_modules/{}", bstr::BStr::new(alias))
                .expect("formatting into a Vec is infallible");
        }
        link
    };
    // The `node_modules/.bun/<entry>` that the link at `link` leads into, if it holds the package of `entry` and is still there.
    let dir_behind = |entry: usize, link: &[u8]| -> Option<Vec<u8>> {
        let found = linked_store_entry(link)?;
        let pkg = entry_pkgs[entry] as usize;
        let key = store_entry::fmt_store_key(names[pkg], &resolutions[pkg], string_buf).to_string();
        let dir = [&b"node_modules/.bun/"[..], &found[..]].concat();
        (is_entry_of(&found, key.as_bytes()) && sys::exists(&dir)).then_some(dir)
    };

    // Breadth first from the importers, whose `node_modules` no patch renames: where the last install linked each entry, whichever patches it applied.
    let mut linked_dirs: Vec<Option<Vec<u8>>> = vec![None; entry_pkgs.len()];
    let mut pending = (0..entry_pkgs.len())
        .filter(|&entry| entry_pkgs[entry] == pkg_id && !is_importer(entry))
        .count();
    let mut walk: Vec<usize> = (0..entry_pkgs.len())
        .filter(|&entry| is_importer(entry))
        .collect();
    let mut walked = 0;
    while pending > 0
        && let Some(&dependent) = walk.get(walked)
    {
        walked += 1;
        let dir = linked_dirs[dependent].clone().unwrap_or_default();
        for item in entry_dependencies[dependent].slice() {
            let Some(entry) = item.entry_id.try_get().map(|id| id as usize) else {
                continue;
            };
            if pending == 0 || linked_dirs[entry].is_some() || is_importer(entry) {
                continue;
            }
            let linked = alias_of(item.dep_id)
                .and_then(|alias| dir_behind(entry, &link_of(dependent, &dir, alias)));
            if let Some(linked) = linked {
                pending -= usize::from(entry_pkgs[entry] == pkg_id);
                linked_dirs[entry] = Some(linked);
                walk.push(entry);
            }
        }
    }

    // `node_modules/.bun/node_modules/<alias>` is one more link to the entry, at a path that no entry name is part of.
    let hoisted_dir = |entry: usize| -> Option<Vec<u8>> {
        let id = store_entry::Id::from(entry as u32);
        let own = store.entries.items_hoisted()[entry].then(|| store.ids(id).dep_id);
        let more = (store.hidden_hoist_keys.iter())
            .filter(|key| key.entry_id == id)
            .map(|key| key.dep_id);
        (own.into_iter().chain(more))
            .filter_map(&alias_of)
            .find_map(|alias| {
                let link = [&b"node_modules/.bun/node_modules/"[..], alias].concat();
                dir_behind(entry, &link)
            })
    };
    // A dependent that no link leads to has its own links under the name computed for it.
    let dependents_dir = |entry: usize| -> Option<Vec<u8>> {
        (entry_dependencies.iter().enumerate())
            .filter(|&(dependent, _)| linked_dirs[dependent].is_none() && !is_importer(dependent))
            .find_map(|(dependent, items)| {
                let mut aliases = (items.slice().iter())
                    .filter(|item| item.entry_id.try_get() == Some(entry as u32))
                    .filter_map(|item| alias_of(item.dep_id))
                    .peekable();
                aliases.peek()?;
                let dir = named_dir(dependent);
                aliases.find_map(|alias| dir_behind(entry, &link_of(dependent, &dir, alias)))
            })
    };

    let pkg = *lockfile.packages.get(pkg_id as usize);
    let patch = (lockfile.patched_dependencies).get(&string_hash(&patch_key_of(lockfile, &pkg)));
    let is_name_a_guess = patch.is_some_and(|patch| patch.patchfile_hash().is_none());
    // Without its patch file a patched package gets the name of the published one, so a folder that no link vouches for is the patched copy only with the marker of a patch.
    let unlinked_folder = |dir: Vec<u8>| -> Option<Vec<u8>> {
        package_folder_in(dir, name)
            .filter(|folder| !is_name_a_guess || has_patch_marker(folder, None))
    };
    let project_folder = |entry: usize| -> Option<Vec<u8>> {
        if let Some(dir) = linked_dirs[entry].clone().or_else(|| hoisted_dir(entry)) {
            return package_folder_in(dir, name);
        }
        dependents_dir(entry)
            .and_then(&unlinked_folder)
            .or_else(|| unlinked_folder(named_dir(entry)))
    };

    // Walk breadth-first from the current package, then add the entries that it doesn't load.
    let mut seen = vec![false; entry_pkgs.len()];
    let mut queue: Vec<usize> = Vec::with_capacity(entry_pkgs.len());
    let mut enqueue = |entry: usize, queue: &mut Vec<usize>| {
        let pkg = entry_pkgs[entry];
        // Only one of a workspace's entries has its dependencies. A `workspace:` range links to a
        // different one.
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

    let mut folders: Vec<Vec<u8>> = Vec::new();
    for folder in (queue.into_iter())
        .filter(|&entry| entry_pkgs[entry] == pkg_id)
        .filter_map(project_folder)
    {
        // Links that an install with other peers made can lead two entries to one folder.
        if !folders.contains(&folder) {
            folders.push(folder);
        }
    }
    folders
}

/// `<entry_dir>/node_modules/<name>`, if the project has that folder.
fn package_folder_in(mut entry_dir: Vec<u8>, name: &[u8]) -> Option<Vec<u8>> {
    // A link into the global store: the project has no folder of the package.
    if is_link(&entry_dir) {
        return None;
    }
    write!(entry_dir, "/node_modules/{}", bstr::BStr::new(name))
        .expect("formatting into a Vec is infallible");
    sys::exists(&entry_dir).then_some(entry_dir)
}

/// The `<entry>` of the `node_modules/.bun/<entry>` that the link at `link` leads into.
fn linked_store_entry(link: &[u8]) -> Option<Vec<u8>> {
    let mut buf = bun_paths::path_buffer_pool::get();
    let len = sys::readlink(&ZBox::from_bytes(link), &mut buf[..]).ok()?;
    let target = &buf[..len];
    let mut spill = Vec::new();
    let path = if Platform::AUTO.is_absolute(target) {
        target
    } else {
        let folder = resolve_path::dirname::<platform::Auto>(link);
        resolve_path::join_spill::<platform::Auto>(&mut spill, &[folder, target])
    };
    // The last `.bun` is the store: the path of the project can have a folder of that name too.
    let mut entry = None;
    let mut is_in_store = false;
    for component in strings::tokenize_any(path, b"/\\") {
        if is_in_store {
            entry = Some(component);
        }
        is_in_store = component == b".bun";
    }
    entry.map(<[u8]>::to_vec)
}

/// Whether the store entry `entry` is `key` or `key+<16 hex digits>`, the names the linker gives.
fn is_entry_of(entry: &[u8], key: &[u8]) -> bool {
    match entry.strip_prefix(key) {
        Some([]) => true,
        Some([b'+', hash @ ..]) => hash.len() == 16 && hash.iter().all(u8::is_ascii_hexdigit),
        _ => false,
    }
}

type NodeModulesIterator<'a> = tree::Iterator<'a, { tree::IteratorPathStyle::NodeModules }>;

type IdPair = (DependencyID, PackageID);

/// Returns the package that `name` or `name@version` refers to, and its folder in a hoisted
/// node_modules.
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
            let label = print_resolution_label(&mut resolution_label, resolution, strbuf);
            // Also accept the redacted label, which is what the list of versions below prints for
            // the user to copy.
            if label != v
                && bun_fmt::redacted(bstr::BStr::new(label))
                    .to_string()
                    .as_bytes()
                    != v
            {
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

    // Several dependents of the same package are fine. If they resolve to different packages, the
    // user has to give a version.
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
                bun_fmt::for_terminal(pkg_resolutions[pkg_id as usize].fmt(strbuf, PathSep::Posix))
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
