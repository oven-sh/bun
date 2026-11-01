use bun_paths::AutoAbsPathChecked;

use crate::isolated_install::installer::{is_link, remove_link};
use crate::lockfile::Lockfile;
use crate::lockfile::package::PackageColumns as _;
use crate::package_installer::alias_is_safe_install_target;
use crate::resolution::Tag as ResolutionTag;

/// The linkers only visit the names in the new lockfile, so the link of a workspace that's no
/// longer in it is removed here.
pub(crate) fn remove_stale_workspace_links(previous: &Lockfile, current: &Lockfile) {
    let previous_packages = previous.packages.slice();
    let resolutions = previous_packages.items_resolution();
    let name_hashes = previous_packages.items_name_hash();

    for (pkg_id, name) in previous_packages.items_name().iter().enumerate() {
        let name = name.slice(&previous.buffers.string_bytes);
        if resolutions[pkg_id].tag != ResolutionTag::Workspace
            || current.workspace_paths.contains_key(&name_hashes[pkg_id])
            || !alias_is_safe_install_target(name)
        {
            continue;
        }

        remove_link_in(b"", name);
        for workspace_path in current.workspace_paths.values() {
            let workspace_path = workspace_path.slice(&current.buffers.string_bytes);
            if !current.is_member_path_outside(workspace_path) {
                remove_link_in(workspace_path, name);
            }
        }
    }
}

/// `readlink` only succeeds for a symlink or a junction, so a real directory or file is left alone.
fn remove_link_in(package_dir: &[u8], name: &[u8]) {
    let mut path = AutoAbsPathChecked::init_top_level_dir();
    if path.append(package_dir).is_err()
        || path.append(b"node_modules").is_err()
        // Nothing is removed from a `node_modules` that is a symlink. See `LinkedNodeModules`.
        || is_link(path.slice_z()) == Some(true)
        || path.append(name).is_err()
    {
        return;
    }

    let mut link_target = bun_paths::path_buffer_pool::get();
    if bun_sys::readlink(path.slice_z(), &mut link_target).is_ok() {
        let _ = remove_link(path.slice_z());
    }
}
