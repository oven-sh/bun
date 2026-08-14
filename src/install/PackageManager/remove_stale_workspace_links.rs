//! A workspace package is linked into `node_modules/<name>`: the root's, and
//! that of every workspace depending on it. Both linkers only create or
//! repoint the links the current lockfile asks for, so when a workspace is
//! renamed or removed from the project the link under its previous name
//! survives, still resolving to the workspace folder, even though the install
//! summary reports the package as removed. This runs after
//! `Lockfile::clean_with_logger` and before either linker: every workspace
//! name that was in the previous lockfile and is not in the new one has its
//! links unlinked, and anything the new lockfile still wants under that name
//! is recreated by the linker that follows.

use bstr::BStr;
use bun_paths::AutoAbsPathChecked;

use crate::lockfile::Lockfile;
use crate::lockfile::package::PackageColumns as _;
use crate::package_installer::alias_is_safe_install_target;
use crate::package_manager_real::PackageManager;
use crate::resolution::Tag as ResolutionTag;

pub(crate) fn remove_stale_workspace_links(previous: &Lockfile, current: &Lockfile) {
    let previous_string_buf = previous.buffers.string_bytes.as_slice();
    let previous_packages = previous.packages.slice();
    let resolutions = previous_packages.items_resolution();
    let name_hashes = previous_packages.items_name_hash();
    let names = previous_packages.items_name();

    for pkg_id in 0..previous_packages.len() {
        if resolutions[pkg_id].tag != ResolutionTag::Workspace
            || current.workspace_paths.contains_key(&name_hashes[pkg_id])
        {
            continue;
        }

        let name = names[pkg_id].slice(previous_string_buf);
        if !alias_is_safe_install_target(name) {
            continue;
        }

        remove_links_named(current, name);
    }
}

#[cold]
#[inline(never)]
fn remove_links_named(current: &Lockfile, name: &[u8]) {
    let current_string_buf = current.buffers.string_bytes.as_slice();

    let mut path = AutoAbsPathChecked::init_top_level_dir();
    let top_level_len = path.len();

    remove_link(&mut path, b"", name);
    for workspace_path in current.workspace_paths.values() {
        path.set_length(top_level_len);
        remove_link(&mut path, workspace_path.slice(current_string_buf), name);
    }
}

/// Unlinks `<package_dir>/node_modules/<name>` if it is a symlink (or, on
/// Windows, a junction). A real directory or file at that path was not put
/// there as a workspace link and is left alone.
fn remove_link(path: &mut AutoAbsPathChecked, package_dir: &[u8], name: &[u8]) {
    if path.append(package_dir).is_err()
        || path.append(b"node_modules").is_err()
        || path.append(name).is_err()
    {
        return;
    }

    let mut link_target = bun_paths::path_buffer_pool::get();
    if bun_sys::readlink(path.slice_z(), &mut link_target).is_err() {
        return;
    }

    bun_output::scoped_log!(
        PackageManager,
        "removing stale workspace link {}",
        BStr::new(path.slice())
    );

    #[cfg(windows)]
    {
        // Directory symlinks and junctions are removed with rmdir; only a file
        // symlink needs unlink.
        if bun_sys::rmdir(path.slice_z()).is_err() {
            let _ = bun_sys::unlink(path.slice_z());
        }
    }
    #[cfg(not(windows))]
    {
        let _ = bun_sys::unlink(path.slice_z());
    }
}
