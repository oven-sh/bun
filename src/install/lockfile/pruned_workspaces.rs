use bstr::BStr;
use bun_paths::AutoAbsPath;
use bun_semver::string::Builder as StringBuilderNs;

use crate::dependency::{Dependency, Tag as DependencyVersionTag, VersionExt as _};
use crate::lockfile::package::PackageColumns as _;
use crate::lockfile_real::{CatalogMap, Lockfile};
use crate::{PackageNameHash, ResolutionTag};

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

pub(crate) fn exit_if_survivor_depends_on_pruned(
    lockfile: &Lockfile,
    pruned: &[PackageNameHash],
    silent: bool,
) {
    let pkgs = lockfile.packages.slice();
    let names = pkgs.items_name();
    let name_hashes = pkgs.items_name_hash();
    let pkg_res = pkgs.items_resolution();
    let dep_slices = pkgs.items_dependencies();
    let res_slices = pkgs.items_resolutions();
    let deps = lockfile.buffers.dependencies.as_slice();
    let resolutions = lockfile.buffers.resolutions.as_slice();
    let buf = lockfile.buffers.string_bytes.as_slice();

    let is_pruned = |id: usize| {
        pkg_res[id].tag == ResolutionTag::Workspace && pruned.contains(&name_hashes[id])
    };

    let mut found = false;
    for pkg_id in 0..pkgs.len() {
        let tag = pkg_res[pkg_id].tag;
        if (tag != ResolutionTag::Root && tag != ResolutionTag::Workspace) || is_pruned(pkg_id) {
            continue;
        }
        for (dep, &target) in dep_slices[pkg_id]
            .get(deps)
            .iter()
            .zip(res_slices[pkg_id].get(resolutions))
        {
            if pkg_id == 0 && dep.behavior.is_workspace() {
                continue;
            }
            let target = target as usize;
            if target >= pkgs.len() || !is_pruned(target) {
                continue;
            }
            found = true;
            if silent {
                continue;
            }
            let target_name = BStr::new(names[target].slice(buf));
            let target_path = BStr::new(pkg_res[target].workspace().slice(buf));
            if pkg_id == 0 {
                bun_core::pretty_errorln!(
                    "<r><red>error<r><d>:<r> the root package depends on workspace <b>\"{}\"<r> ({}), which is listed in bun.lock but not on disk",
                    target_name,
                    target_path,
                );
            } else {
                bun_core::pretty_errorln!(
                    "<r><red>error<r><d>:<r> workspace <b>\"{}\"<r> depends on workspace <b>\"{}\"<r> ({}), which is listed in bun.lock but not on disk",
                    BStr::new(names[pkg_id].slice(buf)),
                    target_name,
                    target_path,
                );
            }
        }
    }

    if found {
        if !silent {
            bun_core::note!(
                "a pruned checkout must keep every workspace that its remaining workspaces depend on"
            );
        }
        bun_core::Global::crash();
    }
}

pub(crate) fn lockfile_catalogs_are_subset(from: &Lockfile, to: &Lockfile) -> bool {
    let from_buf = from.buffers.string_bytes.as_slice();
    let to_buf = to.buffers.string_bytes.as_slice();

    let mut matched = 0usize;
    let all_kept = for_each_entry(&from.catalogs, from_buf, &mut |group, entry| match to
        .catalogs
        .find(to_buf, group, entry.name.slice(from_buf))
    {
        Some(to_entry) if to_entry.version.eql(&entry.version, to_buf, from_buf) => {
            matched += 1;
            true
        }
        _ => false,
    });
    if !all_kept {
        return false;
    }

    let to_total = to.catalogs.default.count()
        + to.catalogs
            .groups
            .values()
            .iter()
            .map(|group| group.count())
            .sum::<usize>();
    if matched == to_total {
        return true;
    }

    for_each_entry(&to.catalogs, to_buf, &mut |group, entry| {
        let name = entry.name.slice(to_buf);
        from.catalogs.find(from_buf, group, name).is_some()
            || !catalog_entry_is_referenced(from, group, StringBuilderNs::string_hash(name))
    })
}

fn for_each_entry(
    catalogs: &CatalogMap,
    buf: &[u8],
    f: &mut dyn FnMut(&[u8], &Dependency) -> bool,
) -> bool {
    if !catalogs.default.values().iter().all(|entry| f(b"", entry)) {
        return false;
    }
    catalogs
        .groups
        .keys()
        .iter()
        .zip(catalogs.groups.values())
        .all(|(group_key, group)| {
            let group_name = group_key.slice(buf);
            group.values().iter().all(|entry| f(group_name, entry))
        })
}

fn catalog_entry_is_referenced(
    lockfile: &Lockfile,
    group: &[u8],
    name_hash: PackageNameHash,
) -> bool {
    let buf = lockfile.buffers.string_bytes.as_slice();
    let hits = |dep: &Dependency| {
        dep.name_hash == name_hash
            && dep.version.tag == DependencyVersionTag::Catalog
            && CatalogMap::same_name(dep.version.catalog().slice(buf), group)
    };

    if lockfile.overrides.map.values().iter().any(&hits)
        || lockfile.overrides.scoped.iter().any(|rule| hits(&rule.dep))
    {
        return true;
    }

    let pkgs = lockfile.packages.slice();
    let name_hashes = pkgs.items_name_hash();
    let pkg_res = pkgs.items_resolution();
    let dep_slices = pkgs.items_dependencies();
    let deps = lockfile.buffers.dependencies.as_slice();

    (0..pkgs.len()).any(|pkg_id| match pkg_res[pkg_id].tag {
        ResolutionTag::Root => dep_slices[pkg_id].get(deps).iter().any(&hits),
        ResolutionTag::Workspace => {
            dep_slices[pkg_id].get(deps).iter().any(&hits)
                && !workspace_is_missing_on_disk(lockfile, name_hashes[pkg_id])
        }
        _ => false,
    })
}
