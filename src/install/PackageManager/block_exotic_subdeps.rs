//! Enforces `install.blockExoticSubdeps`: fails the install when a
//! *transitive* dependency names a non-registry source (git, github, tarball,
//! folder, symlink, or `workspace:` from a non-workspace parent). Direct deps
//! of the root and of workspace packages are exempt. Modeled on pnpm:
//! https://pnpm.io/11.x/supply-chain-security#prevent-exotic-transitive-dependencies

use std::borrow::Cow;

use bstr::BStr;
use bun_collections::ArrayHashMap;
use bun_core::{Output, fmt as bun_fmt, strings};
use bun_install::dependency::{self, DependencyExt as _, TagExt as _};
use bun_install::{DependencyID, PackageID, PackageManager, invalid_package_id};
use bun_semver::semver_string::Builder as StringBuilder;

use crate::lockfile::package::PackageColumns as _;
use crate::resolution::Tag as ResolutionTag;

/// Walks the fully-resolved lockfile and emits an error for every transitive
/// dependency that is specified with a non-registry source. Returns the
/// number of violations reported (so the caller can decide whether to exit).
pub fn enforce_block_exotic_subdeps(manager: &PackageManager) -> usize {
    let pkgs = manager.lockfile.packages.slice();
    if pkgs.len() == 0 {
        return 0;
    }

    // Like `verify_resolutions`: stay quiet under `--silent`, still fail.
    let silent = manager.options.log_level.is_silent();

    let pkg_resolutions = pkgs.items_resolution();
    let pkg_names = pkgs.items_name();
    let pkg_dependencies = pkgs.items_dependencies();
    let string_buf = manager.lockfile.buffers.string_bytes.as_slice();
    let resolutions = manager.lockfile.buffers.resolutions.as_slice();
    let dependencies = manager.lockfile.buffers.dependencies.as_slice();

    // The package each dependency row belongs to.
    let mut owner_of: Vec<PackageID> = vec![invalid_package_id; dependencies.len()];
    for (pkg_id, deps) in pkg_dependencies.iter().enumerate() {
        for dep_id in deps.begin()..deps.end() {
            if let Some(owner) = owner_of.get_mut(dep_id as usize) {
                *owner = pkg_id as PackageID;
            }
        }
    }
    let is_direct = |pkg_id: PackageID| {
        matches!(
            pkg_resolutions[pkg_id as usize].tag,
            ResolutionTag::Root | ResolutionTag::Workspace
        )
    };

    // An edge whose specifier names a source is judged as written. An edge
    // with a plain range is judged only where the saved tree places it: a
    // range that dedupes onto a package above it keeps its loaded binding,
    // which can be a package the root moved away from.
    let mut candidates: Vec<(PackageID, DependencyID)> = Vec::new();
    for parent_id in 0..pkgs.len() as PackageID {
        if is_direct(parent_id) {
            continue;
        }
        let deps = pkg_dependencies[parent_id as usize];
        for dep_id in deps.begin()..deps.end() {
            if (dep_id as usize) < dependencies.len()
                && !names_no_source(effective_version(manager, dep_id).tag)
            {
                candidates.push((parent_id, dep_id));
            }
        }
    }
    let hoisted = manager.lockfile.buffers.hoisted_dependencies.as_slice();
    for tree in manager.lockfile.buffers.trees.as_slice() {
        for &dep_id in tree.dependencies.get(hoisted) {
            let Some(&parent_id) = owner_of.get(dep_id as usize) else {
                continue;
            };
            if parent_id != invalid_package_id
                && names_no_source(effective_version(manager, dep_id).tag)
            {
                candidates.push((parent_id, dep_id));
            }
        }
    }

    // Dedupe by (parent_id, child_pkg_id) — the same resolved package can
    // appear as a dep of more than one parent and we only want to report
    // each distinct edge once.
    let mut seen: ArrayHashMap<u64, ()> = ArrayHashMap::default();
    let mut header_printed = false;
    let mut count: usize = 0;

    for (parent_id, dep_id) in candidates {
        if (dep_id as usize) >= resolutions.len() {
            continue;
        }
        let dep_pkg_id = resolutions[dep_id as usize];
        if dep_pkg_id == invalid_package_id {
            continue;
        }
        if (dep_pkg_id as usize) >= pkgs.len() {
            continue;
        }

        let dep = &dependencies[dep_id as usize];
        let dep_res_tag = pkg_resolutions[dep_pkg_id as usize].tag;
        let parent_res = &pkg_resolutions[parent_id as usize];
        let direct = is_direct(parent_id);
        let version = effective_version(manager, dep_id);
        let literal_raw: &[u8] = version.literal.slice(string_buf);

        let Some(verdict) = classify(dep_res_tag, version.tag, literal_raw) else {
            continue;
        };

        // A range names no source. It is allowed to bind to a package whose
        // source the root or a workspace declares (a peer range on a tarball).
        if names_no_source(version.tag) && project_names_source_of(manager, dep_pkg_id) {
            continue;
        }

        let key = ((parent_id as u64) << 32) | (dep_pkg_id as u64);
        let gop = bun_core::handle_oom(seen.get_or_put(key));
        if gop.found_existing {
            continue;
        }

        count += 1;
        if silent {
            continue;
        }

        if !header_printed {
            header_printed = true;
            Output::err_generic(
                "<b>install.blockExoticSubdeps<r> is enabled, but the following transitive dependencies use non-registry sources:",
                (),
            );
        }

        let parent_name = pkg_names[parent_id as usize].slice(string_buf);
        let dep_name = dep.name.slice(string_buf);
        // Informational only; the verdict comes from `dep_res_tag`. The
        // literal can print empty when the lockfile clone pass wiped it.
        // Macro form so only the template is tag-rewritten and the
        // untrusted interpolated bytes print verbatim.
        if direct {
            bun_core::pretty_error!("  <b>{}<r>", BStr::new(parent_name));
        } else {
            bun_core::pretty_error!(
                "  <b>{}<r><d>@{}<r>",
                BStr::new(parent_name),
                parent_res.fmt(string_buf, bun_fmt::PathSep::Auto),
            );
        }
        bun_core::pretty_error!(
            " depends on <b>{}<r><d>@{}<r> via <yellow>{}<r> source",
            BStr::new(dep_name),
            BStr::new(literal_raw),
            verdict,
        );
        // An override is looked up by this name, not by the dependency key.
        let package_name = pkg_names[dep_pkg_id as usize].slice(string_buf);
        if package_name != dep_name {
            bun_core::pretty_error!(" <d>(package name: {})<r>", BStr::new(package_name));
        }
        bun_core::pretty_errorln!("");
    }

    if count > 0 && !silent {
        bun_core::pretty_errorln!(
            "\n<d>To allow these, disable <b>install.blockExoticSubdeps<r><d> in bunfig.toml or set <b>block-exotic-subdeps=false<r><d> in .npmrc; to fix a single offender, add an <b>overrides<r><d> entry in package.json for its package name that points at a registry version (an override to a non-registry source is itself blocked).<r>",
        );
        Output::flush();
    }
    count
}

/// The version the resolver used for this edge: the root's override when one
/// applies (gate and realname-keyed hash mirror
/// `enqueue_dependency_with_main_and_success_fn`), else the edge's own.
fn effective_version(
    manager: &PackageManager,
    dep_id: DependencyID,
) -> Cow<'_, dependency::Version> {
    let lockfile = &manager.lockfile;
    let string_buf = lockfile.buffers.string_bytes.as_slice();
    let dep = &lockfile.buffers.dependencies.as_slice()[dep_id as usize];
    let name_hash = match dep.version.tag {
        dependency::Tag::DistTag
        | dependency::Tag::Git
        | dependency::Tag::Github
        | dependency::Tag::Npm
        | dependency::Tag::Tarball
        | dependency::Tag::Workspace => {
            StringBuilder::string_hash(dep.realname().slice(string_buf))
        }
        _ => dep.name_hash,
    };
    let overridable = !dep.behavior.is_workspace()
        && (dep.version.tag != dependency::Tag::Npm || !dep.version.npm().is_alias);
    if overridable {
        if let Some(version) = lockfile.overrides.get(lockfile, dep_id, name_hash) {
            return Cow::Owned(version);
        }
    }
    Cow::Borrowed(&dep.version)
}

/// A plain range or a dist-tag: the specifier names no source.
fn names_no_source(tag: dependency::Tag) -> bool {
    matches!(tag, dependency::Tag::Npm | dependency::Tag::DistTag)
}

/// Does the root or a workspace declare a non-registry source for package
/// `id` in its own package.json (or the catalog entry it references)?
fn project_names_source_of(manager: &PackageManager, id: PackageID) -> bool {
    let lockfile = &manager.lockfile;
    let pkgs = lockfile.packages.slice();
    let string_buf = lockfile.buffers.string_bytes.as_slice();
    let dependencies = lockfile.buffers.dependencies.as_slice();
    let resolutions = lockfile.buffers.resolutions.as_slice();

    for (res, deps) in pkgs
        .items_resolution()
        .iter()
        .zip(pkgs.items_dependencies())
    {
        if res.tag != ResolutionTag::Root && res.tag != ResolutionTag::Workspace {
            continue;
        }
        for dep_id in deps.begin()..deps.end() {
            let dep_id = dep_id as usize;
            if dep_id >= dependencies.len() || resolutions.get(dep_id) != Some(&id) {
                continue;
            }
            let version = lockfile
                .catalogs
                .resolve_range(string_buf, &dependencies[dep_id]);
            if matches!(
                version.tag,
                dependency::Tag::Git
                    | dependency::Tag::Github
                    | dependency::Tag::Tarball
                    | dependency::Tag::Folder
                    | dependency::Tag::Symlink
            ) {
                return true;
            }
        }
    }
    false
}

/// The exotic-source label for this edge, or `None` when it is allowed.
/// `version_tag` is the tag the resolver parsed for `literal_raw`.
#[inline]
fn classify(
    res_tag: ResolutionTag,
    version_tag: dependency::Tag,
    literal_raw: &[u8],
) -> Option<&'static str> {
    // A dereferenced `catalog:` is root-authored. A `catalog:` peer from
    // outside the project arrives as a `*` range (`CatalogMap::strip_reference`).
    if version_tag == dependency::Tag::Catalog {
        return None;
    }

    // Trim like `Dependency::parse` does so re-inference matches the
    // resolver's read of the same literal (untrimmed bytes skew `infer()`:
    // `" workspace:*"` reads as a git SCP shorthand, for example).
    let literal = strings::trim_left(literal_raw, b" \t\n\r");
    let literal_tag = dependency::Tag::infer(literal);

    match res_tag {
        ResolutionTag::Uninitialized | ResolutionTag::Root | ResolutionTag::Npm => None,

        // `linkWorkspacePackages` never produces these tags. A plain range
        // can still bind to one: the caller checks `project_names_source_of`.
        ResolutionTag::Git => Some("git"),
        ResolutionTag::Github => Some("github"),
        ResolutionTag::LocalTarball => Some("local_tarball"),
        ResolutionTag::RemoteTarball => Some("remote_tarball"),
        ResolutionTag::Symlink => Some("symlink"),
        ResolutionTag::SingleFileModule => Some("single_file_module"),
        ResolutionTag::Folder => Some("folder"),

        // `.workspace` can come from `linkWorkspacePackages` rewriting a
        // plain transitive semver; the parent's literal disambiguates.
        ResolutionTag::Workspace => match literal_tag {
            dependency::Tag::Uninitialized | dependency::Tag::Npm | dependency::Tag::DistTag => {
                None
            }
            dependency::Tag::Catalog => None,
            dependency::Tag::Folder => Some("folder"),
            dependency::Tag::Symlink => Some("symlink"),
            dependency::Tag::Workspace => Some("workspace"),
            dependency::Tag::Git => Some("git"),
            dependency::Tag::Github => Some("github"),
            dependency::Tag::Tarball => Some("tarball"),
        },

        // Unknown tag (open u8 newtype): fail closed.
        _ => Some("unknown"),
    }
}
