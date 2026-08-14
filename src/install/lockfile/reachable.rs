use crate::lockfile::package::PackageColumns as _;
use crate::lockfile_real::Lockfile;
use crate::npm::{Architecture, OperatingSystem};
use crate::{PackageID, PackageManager};

#[derive(Clone, Copy)]
pub struct Options {
    pub root: PackageID,
    pub dev: bool,
    pub optional: bool,
    pub peer: bool,
    pub optional_peer: bool,
    pub bundled: bool,
    pub platform: Option<(Architecture, OperatingSystem)>,
}

impl Options {
    pub fn all(root: PackageID) -> Options {
        Options {
            root,
            dev: true,
            optional: true,
            peer: true,
            optional_peer: true,
            bundled: true,
            platform: None,
        }
    }

    // What `bun install` would link with the manager's `--production` / `--omit` / os / cpu settings.
    pub(crate) fn install(manager: &PackageManager) -> Options {
        let features = manager.options.local_package_features;
        Options {
            root: 0,
            dev: features.dev_dependencies,
            optional: features.optional_dependencies,
            peer: features.peer_dependencies,
            optional_peer: features.peer_dependencies,
            bundled: false,
            platform: Some((manager.options.cpu, manager.options.os)),
        }
    }
}

// `resolutions` is passed separately so callers can walk a candidate resolution buffer (dedupe).
pub fn packages(lockfile: &Lockfile, resolutions: &[PackageID], options: Options) -> Vec<bool> {
    let pkgs = lockfile.packages.slice();
    let dep_slices = pkgs.items_dependencies();
    let metas = pkgs.items_meta();
    let deps = lockfile.buffers.dependencies.as_slice();

    let mut seen = vec![false; dep_slices.len()];
    if (options.root as usize) >= seen.len() {
        return seen;
    }
    seen[options.root as usize] = true;
    let follow_all =
        options.dev && options.optional && options.peer && options.optional_peer && options.bundled;
    let mut worklist: Vec<PackageID> = vec![options.root];
    while let Some(parent) = worklist.pop() {
        let slice = dep_slices[parent as usize];
        for dep_id in slice.begin() as usize..slice.end() as usize {
            let followed = follow_all || {
                let behavior = deps[dep_id].behavior;
                if behavior.is_bundled() && !options.bundled {
                    false
                } else if behavior.is_optional_peer() {
                    options.optional_peer
                } else if behavior.is_peer() {
                    options.peer
                } else if behavior.is_optional() {
                    options.optional
                } else if behavior.is_dev() {
                    options.dev
                } else {
                    true
                }
            };
            if !followed {
                continue;
            }
            let target = resolutions[dep_id];
            let Some(slot) = seen.get_mut(target as usize) else {
                continue;
            };
            if *slot {
                continue;
            }
            if let Some((cpu, os)) = options.platform
                && metas[target as usize].is_disabled(cpu, os)
            {
                continue;
            }
            *slot = true;
            worklist.push(target);
        }
    }
    seen
}
