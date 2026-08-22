use bstr::BStr;
use bun_paths::AutoAbsPath;
use bun_semver::String;
use bun_semver::string::Builder as StringBuilderNs;

use crate::dependency::{Dependency, Tag as DependencyVersionTag, VersionExt as _};
use crate::lockfile::DependencySlice;
use crate::lockfile::package::PackageColumns as _;
use crate::lockfile_real::{CatalogMap, Lockfile};
use crate::{PackageID, PackageNameHash, ResolutionTag};

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

pub(crate) fn exit_if_survivor_depends_on_missing(
    from_lockfile: &Lockfile,
    missing: &[PackageID],
    to_lockfile: &Lockfile,
    to_root_dependencies: DependencySlice,
    survivors: &[(String, DependencySlice)],
    silent: bool,
) {
    let pkgs = from_lockfile.packages.slice();
    let names = pkgs.items_name();
    let name_hashes = pkgs.items_name_hash();
    let pkg_res = pkgs.items_resolution();
    let from_buf = from_lockfile.buffers.string_bytes.as_slice();
    let to_buf = to_lockfile.buffers.string_bytes.as_slice();
    let to_deps = to_lockfile.buffers.dependencies.as_slice();

    let missing_target = |dep: &Dependency| -> Option<PackageID> {
        if dep.version.tag != DependencyVersionTag::Workspace {
            return None;
        }
        missing
            .iter()
            .copied()
            .find(|&id| name_hashes[id as usize] == dep.name_hash)
    };

    let mut found = false;
    for dep in to_root_dependencies.get(to_deps) {
        if dep.behavior.is_workspace() {
            continue;
        }
        let Some(target) = missing_target(dep) else {
            continue;
        };
        found = true;
        if silent {
            continue;
        }
        let target = target as usize;
        debug_assert_eq!(pkg_res[target].tag, ResolutionTag::Workspace);
        bun_core::pretty_errorln!(
            "<r><red>error<r><d>:<r> the root package depends on workspace <b>\"{}\"<r> ({}), which is listed in bun.lock but not on disk",
            BStr::new(names[target].slice(from_buf)),
            BStr::new(pkg_res[target].workspace().slice(from_buf)),
        );
    }

    for (name, slice) in survivors {
        for dep in slice.get(to_deps) {
            let Some(target) = missing_target(dep) else {
                continue;
            };
            found = true;
            if silent {
                continue;
            }
            let target = target as usize;
            debug_assert_eq!(pkg_res[target].tag, ResolutionTag::Workspace);
            bun_core::pretty_errorln!(
                "<r><red>error<r><d>:<r> workspace <b>\"{}\"<r> depends on workspace <b>\"{}\"<r> ({}), which is listed in bun.lock but not on disk",
                BStr::new(name.slice(to_buf)),
                BStr::new(names[target].slice(from_buf)),
                BStr::new(pkg_res[target].workspace().slice(from_buf)),
            );
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

pub(crate) fn catalog_entries_missing_from_lockfile(
    from: &Lockfile,
    to: &Lockfile,
) -> Option<Vec<Box<[u8]>>> {
    let from_buf = from.buffers.string_bytes.as_slice();
    let to_buf = to.buffers.string_bytes.as_slice();

    let all_kept = for_each_entry(&from.catalogs, from_buf, &mut |group, entry| {
        to.catalogs
            .find(to_buf, group, entry.name.slice(from_buf))
            .is_some_and(|to_entry| to_entry.version.eql(&entry.version, to_buf, from_buf))
    });
    if !all_kept {
        return None;
    }

    let mut skipped: Vec<Box<[u8]>> = Vec::new();
    let unused = for_each_entry(&to.catalogs, to_buf, &mut |group, entry| {
        let name = entry.name.slice(to_buf);
        if from.catalogs.find(from_buf, group, name).is_some() {
            return true;
        }
        skipped.push(Box::from(name));
        !catalog_entry_is_referenced(from, group, StringBuilderNs::string_hash(name))
    });
    if !unused {
        return None;
    }
    bun_collections::index_sort::sort_vec_unstable_by(&mut skipped, |a, b| a.cmp(b));
    Some(skipped)
}

pub(crate) fn quoted_names(names: &mut dyn Iterator<Item = &[u8]>) -> std::string::String {
    use std::fmt::Write as _;
    let mut list = std::string::String::new();
    for name in names {
        if !list.is_empty() {
            list.push_str(", ");
        }
        let _ = write!(list, "\"{}\"", BStr::new(name));
    }
    list
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
