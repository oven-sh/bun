//! Enforces `install.blockExoticSubdeps`: fails the install when any
//! *transitive* dependency is specified with a non-registry source (git,
//! github, tarball URL, folder, symlink, or a `workspace:` ref from a
//! non-workspace parent). Direct deps of the root and of workspace packages
//! are exempt. Modeled on pnpm:
//! https://pnpm.io/11.x/supply-chain-security#prevent-exotic-transitive-dependencies
//!
//! Classification layers (see `classify`): `catalog:` literals are
//! root-authored and skipped first; then the child's `Resolution::Tag`
//! decides; only a `.workspace` resolution falls back to re-inferring the
//! parent's literal, because `linkWorkspacePackages` can rewrite a plain
//! semver to a workspace. Root `overrides`/`resolutions` take priority over
//! the transitive literal when the resolver applied them.

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

    // Dedupe by (parent_id, child_pkg_id) — the same resolved package can
    // appear as a dep of more than one parent and we only want to report
    // each distinct edge once.
    let mut seen: ArrayHashMap<u64, ()> = ArrayHashMap::default();
    let mut header_printed = false;
    let mut count: usize = 0;

    for _parent_id in 0..pkgs.len() {
        let parent_id: PackageID = _parent_id as PackageID;
        let parent_res = &pkg_resolutions[parent_id as usize];

        // Only transitive edges — skip root and workspace parents.
        if parent_res.tag == ResolutionTag::Root || parent_res.tag == ResolutionTag::Workspace {
            continue;
        }

        let parent_deps = pkg_dependencies[parent_id as usize];
        for _dep_id in parent_deps.begin()..parent_deps.end() {
            let dep_id: DependencyID = _dep_id as DependencyID;
            if (dep_id as usize) >= dependencies.len() {
                continue;
            }
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

            // Consult the same override the resolver applied: gate and
            // realname-keyed hash both mirror
            // `enqueue_dependency_with_main_and_success_fn` (bun.lock.rs
            // carries the same pair).
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
            let overridden = if overridable {
                manager
                    .lockfile
                    .overrides
                    .get(&manager.lockfile, dep_id, name_hash)
            } else {
                None
            };
            let literal_raw: &[u8] = match overridden.as_ref() {
                Some(ovr) => ovr.literal.slice(string_buf),
                None => dep.version.literal.slice(string_buf),
            };

            let Some(verdict) = classify(dep_res_tag, literal_raw) else {
                continue;
            };

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
            bun_core::pretty_errorln!(
                "  <b>{}<r><d>@{}<r> depends on <b>{}<r><d>@{}<r> via <yellow>{}<r> source",
                BStr::new(parent_name),
                parent_res.fmt(string_buf, bun_fmt::PathSep::Auto),
                BStr::new(dep_name),
                BStr::new(literal_raw),
                verdict,
            );
        }
    }

    if count > 0 && !silent {
        bun_core::pretty_errorln!(
            "\n<d>To allow these, disable <b>install.blockExoticSubdeps<r><d> in bunfig.toml or set <b>block-exotic-subdeps=false<r><d> in .npmrc; to fix a single offender, add an <b>overrides<r><d> entry in package.json pointing it at a registry version (an override to a non-registry source is itself blocked).<r>",
        );
        Output::flush();
    }
    count
}

/// Returns the exotic-source label if the (resolution, literal) pair is
/// exotic per this policy, or `None` if it's allowed.
#[inline]
fn classify(res_tag: ResolutionTag, literal_raw: &[u8]) -> Option<&'static str> {
    // Trim like `Dependency::parse` does so re-inference matches the
    // resolver's read of the same literal (untrimmed bytes skew `infer()`:
    // `" workspace:*"` reads as a git SCP shorthand, for example).
    let literal = strings::trim_left(literal_raw, b" \t\n\r");
    let literal_tag = dependency::Tag::infer(literal);

    // `catalog:` is root-authored. The resolver dereferences it inline, so
    // the resolution carries the catalog target's tag; the stored literal
    // is the only signal the parent wrote `catalog:`.
    if literal_tag == dependency::Tag::Catalog {
        return None;
    }

    match res_tag {
        ResolutionTag::Uninitialized | ResolutionTag::Root | ResolutionTag::Npm => None,

        // These tags are unreachable via `linkWorkspacePackages` or any
        // other implicit rewrite; the resolution alone is authoritative.
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
