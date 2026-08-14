use bun_paths::AutoAbsPath;

use crate::PackageNameHash;
use crate::lockfile_real::Lockfile;

pub(crate) fn workspace_is_missing_on_disk(
    lockfile: &Lockfile,
    workspace_name_hash: PackageNameHash,
) -> bool {
    let Some(workspace_path) = lockfile.workspace_paths.get(&workspace_name_hash).copied() else {
        return false;
    };
    let mut package_json_path: AutoAbsPath = AutoAbsPath::init_top_level_dir();
    let _ =
        package_json_path.append(workspace_path.slice(lockfile.buffers.string_bytes.as_slice()));
    let _ = package_json_path.append(b"package.json");
    !bun_sys::exists_z(package_json_path.slice_z())
}

pub(crate) fn lockfile_lists_workspace_path(lockfile: &Lockfile, workspace_path: &[u8]) -> bool {
    let string_bytes = lockfile.buffers.string_bytes.as_slice();
    lockfile
        .workspace_paths
        .values()
        .iter()
        .any(|path| path.slice(string_bytes) == workspace_path)
}
