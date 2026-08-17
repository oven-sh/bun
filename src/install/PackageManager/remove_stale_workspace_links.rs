use bstr::BStr;
use bun_paths::AutoAbsPathChecked;

use crate::isolated_install::installer::remove_link;
use crate::lockfile::Lockfile;
use crate::lockfile::package::PackageColumns as _;
use crate::package_installer::alias_is_safe_install_target;
use crate::package_manager_real::PackageManager;
use crate::resolution::Tag as ResolutionTag;

/// Linkers only visit names in the new lockfile; a workspace name that left it is unlinked here.
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

        let mut path = AutoAbsPathChecked::init_top_level_dir();
        let top_level_len = path.len();
        remove_link_in(&mut path, b"", name);
        for workspace_path in current.workspace_paths.values() {
            path.set_length(top_level_len);
            remove_link_in(
                &mut path,
                workspace_path.slice(&current.buffers.string_bytes),
                name,
            );
        }
    }
}

/// `readlink` is the symlink (or junction) check; a real directory or file there is left alone.
fn remove_link_in(path: &mut AutoAbsPathChecked, package_dir: &[u8], name: &[u8]) {
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
    let _ = remove_link(path.slice_z());
}
