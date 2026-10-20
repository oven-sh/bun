use bstr::BStr;
use bun_semver::String;
use bun_semver::string::Builder as StringBuilderNs;

use crate::dependency::{Dependency, Tag as DependencyVersionTag, VersionExt as _};
use crate::lockfile::DependencySlice;
use crate::lockfile::package::PackageColumns as _;
use crate::lockfile_real::{CatalogMap, Lockfile, bun_lock, join_top_level_dir};
use crate::{PackageID, PackageManager, PackageNameHash, ResolutionTag, Subcommand};

/// Returns true if a workspace that's in bun.lock but missing on disk should be kept. A regular
/// install drops it. `--frozen-lockfile` keeps it, and so does `bun pm fetch`, so that a Docker
/// layer with only the root package.json and bun.lock can download every workspace's dependencies.
pub(crate) fn keeps_missing_workspaces(manager: &PackageManager) -> bool {
    manager.options.enable.frozen_lockfile() || manager.subcommand == Subcommand::Pm
}

pub(crate) fn workspace_is_missing_on_disk(
    lockfile: &Lockfile,
    workspace_name_hash: PackageNameHash,
) -> bool {
    let Some(workspace_path) = lockfile.workspace_paths.get(&workspace_name_hash).copied() else {
        return false;
    };
    let Some(mut package_json_path) = join_top_level_dir(&[
        workspace_path.slice(lockfile.buffers.string_bytes.as_slice()),
        b"package.json",
    ]) else {
        return true;
    };
    !bun_sys::exists_z(package_json_path.slice_z())
}

/// Doesn't apply to a dependency of a local package. That's an error (see
/// `exit_if_survivor_depends_on_missing`).
pub(crate) fn skips_link_to_pruned_workspace(
    manager: &PackageManager,
    lockfile: &Lockfile,
    dependent: PackageID,
    dep: &Dependency,
    target: PackageID,
) -> bool {
    let pruned = &manager.summary.pruned_workspaces;
    if pruned.is_empty() || !bun_lock::may_stay_unresolved(dep) {
        return false;
    }
    let pkgs = lockfile.packages.slice();
    let resolutions = pkgs.items_resolution();
    // A registry package can share the name of a pruned workspace.
    resolutions[target as usize].tag == ResolutionTag::Workspace
        && pruned.contains(&pkgs.items_name_hash()[target as usize])
        && !resolutions[dependent as usize].tag.is_local_package()
}

pub(crate) fn lockfile_lists_workspace_path(lockfile: &Lockfile, workspace_path: &[u8]) -> bool {
    let string_bytes = lockfile.buffers.string_bytes.as_slice();
    lockfile
        .workspace_paths
        .values()
        .iter()
        .any(|path| path.slice(string_bytes) == workspace_path)
}

/// A package whose package.json is on disk in this checkout.
pub(crate) struct Survivor {
    pub(crate) name: String,
    pub(crate) dependencies: DependencySlice,
    /// Its rows in the loaded lockfile.
    pub(crate) recorded: DependencySlice,
}

pub(crate) fn exit_if_survivor_depends_on_missing(
    from_lockfile: &Lockfile,
    missing: &[PackageID],
    to_lockfile: &Lockfile,
    root: &Survivor,
    survivors: &[Survivor],
    keeps_missing_workspaces: bool,
    silent: bool,
) {
    let pkgs = from_lockfile.packages.slice();
    let names = pkgs.items_name();
    let name_hashes = pkgs.items_name_hash();
    let pkg_res = pkgs.items_resolution();
    let from_buf = from_lockfile.buffers.string_bytes.as_slice();
    let to_buf = to_lockfile.buffers.string_bytes.as_slice();
    let to_deps = to_lockfile.buffers.dependencies.as_slice();

    let missing_target = |dep: &Dependency, recorded: DependencySlice| -> Option<PackageID> {
        if dep.version.tag == DependencyVersionTag::Workspace {
            if let Some(&id) = missing
                .iter()
                .find(|&&id| name_hashes[id as usize] == dep.name_hash)
            {
                return Some(id);
            }
        }
        // `--frozen-lockfile` and `bun pm fetch` must never look up a workspace's name in the
        // registry. A regular install can.
        if !keeps_missing_workspaces {
            return None;
        }
        let rows = recorded.begin() as usize..recorded.end() as usize;
        from_lockfile.buffers.dependencies[rows.clone()]
            .iter()
            .zip(&from_lockfile.buffers.resolutions[rows])
            .find(|(from_dep, _)| {
                from_dep.name_hash == dep.name_hash && from_dep.behavior == dep.behavior
            })
            .map(|(_, &bound)| bound)
            .filter(|bound| missing.contains(bound))
    };

    let mut found = false;
    // One line for a name that a package lists in two groups.
    let mut reported: Vec<PackageID> = Vec::new();
    for (i, survivor) in core::iter::once(root).chain(survivors).enumerate() {
        reported.clear();
        for dep in survivor.dependencies.get(to_deps) {
            if dep.behavior.is_workspace() {
                continue;
            }
            let Some(target) = missing_target(dep, survivor.recorded) else {
                continue;
            };
            found = true;
            if silent || reported.contains(&target) {
                continue;
            }
            reported.push(target);
            let target = target as usize;
            debug_assert_eq!(pkg_res[target].tag, ResolutionTag::Workspace);
            let target_name = BStr::new(names[target].slice(from_buf));
            let target_path =
                bun_core::fmt::escape_control_chars(pkg_res[target].workspace().slice(from_buf));
            if i == 0 {
                bun_core::pretty_errorln!(
                    "<r><red>error<r><d>:<r> the root package depends on workspace <b>\"{}\"<r> ({}), which is listed in bun.lock but not on disk",
                    target_name,
                    target_path,
                );
            } else {
                bun_core::pretty_errorln!(
                    "<r><red>error<r><d>:<r> workspace <b>\"{}\"<r> depends on workspace <b>\"{}\"<r> ({}), which is listed in bun.lock but not on disk",
                    BStr::new(survivor.name.slice(to_buf)),
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
