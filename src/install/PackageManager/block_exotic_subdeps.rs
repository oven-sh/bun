//! Enforces `install.blockExoticSubdeps` — refuses to install when any
//! *transitive* dependency is **specified** with a non-registry source: git,
//! github, remote/local tarball URLs, local folders, symlinks, or a literal
//! `workspace:` reference pulled in by a non-workspace parent.
//!
//! Modeled on pnpm's feature of the same name:
//! https://pnpm.io/11.x/supply-chain-security#prevent-exotic-transitive-dependencies
//!
//! Direct dependencies of the root package (and of any workspace package)
//! are allowed to use exotic specifiers — only *nested* dependencies are
//! restricted.
//!
//! The check is layered:
//!   0. Before anything else we re-infer the parent's trimmed literal. If it
//!      reads as `catalog:`, the effective source is whatever the **root**
//!      user's catalog entry resolves to — root-authored, not exotic — and
//!      we skip. This has to run before the resolution switch because
//!      `PackageManagerEnqueue::enqueue_dependency*` dereferences `catalog:`
//!      inline, so the resolution ends up carrying the target's tag
//!      (`.folder` / `.git` / `.workspace` / ...), not a dedicated catalog
//!      variant; without this short-circuit a root catalog pointing at e.g.
//!      `file:./shared` would false-positive.
//!   1. The child package's **Resolution.Tag** decides the bulk of the
//!      remaining cases. Tags like `.git` / `.github` / `.local_tarball` /
//!      `.remote_tarball` / `.symlink` / `.single_file_module` / `.folder`
//!      are never reachable via `linkWorkspacePackages` redirection or any
//!      other implicit path (`Package.rs`'s `parse_dependency` only
//!      rewrites `.npm` / `.dist_tag` to `.workspace`, never to `.folder`
//!      or the URL-family tags) — they're always the parent's explicit
//!      choice and are always exotic.
//!   2. Only `.workspace` is ambiguous: `linkWorkspacePackages` (default
//!      true) can rewrite a transitive registry semver like `^2.0.0` to a
//!      local workspace package when the names match. For that one case we
//!      re-inspect the **literal specifier** the parent's `package.json`
//!      actually wrote (trimmed as above; without trimming, an
//!      attacker-controlled leading-whitespace byte could smuggle an
//!      exotic spec past the check because `infer()`'s match has no arm
//!      for whitespace).
//!
//! When the root user has an `overrides`/`resolutions` entry for a given
//! dependency name, the override's literal takes priority: overrides are the
//! canonical way to remediate a violation (enable → identify the offender →
//! add an override pointing it at a registry version), and the override is
//! root-user-defined so it's not attacker-controlled.

use bstr::BStr;
use bun_collections::ArrayHashMap;
use bun_core::{Output, fmt as bun_fmt, strings};
use bun_install::dependency::{self, TagExt as _};
use bun_install::{DependencyID, PackageID, PackageManager, invalid_package_id};

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

            // If the root user has an `overrides` / `resolutions` entry for
            // this name, the effective specifier is whatever the root chose,
            // not whatever the transitive parent wrote. Same rationale as
            // `.catalog` — root-user-defined indirection isn't
            // attacker-controlled.
            //
            // We only trust the override's literal when the resolver's own
            // lookup would have hit. `PackageManagerEnqueue` only consults
            // the override map when ALL of the following hold (see the
            // `if !dependency.behavior.is_workspace() && (tag != Npm ||
            // !npm.is_alias) { overrides.get(hash(realname())) }` block):
            //   * the dep isn't a workspace declaration (we already skip
            //     root/workspace parents above, so parent-side deps ARE
            //     transitive, but `behavior.is_workspace()` can still flag
            //     a declared workspace member reached via a folder parent —
            //     rare but we mirror the resolver's skip),
            //   * it isn't an npm alias (`"foo": "npm:bar@^1.0.0"` keys on
            //     the alias target `"bar"` — `hash(realname())` — not the
            //     alias name `"foo"`, and the resolver skips the lookup
            //     entirely for aliases per its comment), and
            //   * for `.Git` / `.Github` / `.Tarball` specifiers `realname()`
            //     is the `package_name` which `parse_with_tag` leaves empty
            //     until `runTasks` backfills it after the fetch, so
            //     `overrides.get(hash(""))` misses.
            // For every other specifier tag the lookup hits (either via
            // `dep.name_hash` directly or via a `hash(realname())` whose
            // `realname()` equals the name), so the override IS applied.
            //
            // Keying on the specifier tag here matters for overrides whose
            // *target* is exotic: a parent that wrote `"foo": "file:../bad"`
            // with a root override of `{foo: "git+https://..."}` has
            // `dep.version.tag == .Folder` but `dep_res_tag == .Git`; gating
            // on `dep_res_tag` would incorrectly suppress the applied
            // override literal. It also matters for an
            // override-to-`catalog:` target — `classify`'s catalog
            // short-circuit only fires when `literal_raw == "catalog:"`,
            // which requires propagating the override.
            let override_applied = !dep.behavior.is_workspace()
                && !matches!(
                    dep.version.tag,
                    dependency::Tag::Git | dependency::Tag::Github | dependency::Tag::Tarball,
                )
                && !dep.version.try_npm().is_some_and(|n| n.is_alias);
            let overridden = if override_applied {
                manager.lockfile.overrides.get(dep.name_hash)
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

            if !header_printed {
                header_printed = true;
                Output::err_generic(
                    "<b>install.blockExoticSubdeps<r> is enabled, but the following transitive dependencies use non-registry sources:",
                    (),
                );
            }

            let parent_name = pkg_names[parent_id as usize].slice(string_buf);
            let dep_name = dep.name.slice(string_buf);
            // Show the stored (untrimmed) literal so the user can identify
            // which spec was published. Note: for a `.folder` tag with a
            // leading-whitespace attack, `cleanWithLogger`'s clone pass
            // wipes `dep.version.literal` because `parseWithTag(.folder,
            // " file:...")` returns null — so this prints as an empty
            // `@` for that one case. The block still fires on `dep_res_tag`,
            // which is what matters; the display is purely informational.
            Output::pretty_errorln(format_args!(
                "  <b>{}<r><d>@{}<r> depends on <b>{}<r><d>@{}<r> via <yellow>{}<r> source",
                BStr::new(parent_name),
                parent_res.fmt(string_buf, bun_fmt::PathSep::Auto),
                BStr::new(dep_name),
                BStr::new(literal_raw),
                verdict,
            ));
            count += 1;
        }
    }

    if count > 0 {
        Output::pretty_errorln(format_args!(
            "\n<d>To allow these, disable <b>install.blockExoticSubdeps<r><d> in bunfig.toml or set <b>block-exotic-subdeps=false<r><d> in .npmrc; to allow a single exotic transitive, add an <b>overrides<r><d> entry in package.json that points the offender at a registry version.<r>",
        ));
        Output::flush();
    }
    count
}

/// Returns the exotic-source label if the (resolution, literal) pair is
/// exotic per this policy, or `None` if it's allowed.
#[inline]
fn classify(res_tag: ResolutionTag, literal_raw: &[u8]) -> Option<&'static str> {
    // Mirror the resolver's leading-whitespace trim — `Dependency::parse`
    // calls `strings::trim_left(dependency, b" \t\n\r")` before handing the
    // specifier to `infer()`. If we re-infer on the raw string instead, a
    // published spec like `" workspace:*"` falls through `infer()`'s match
    // to `.dist_tag` → looks non-exotic.
    let literal = strings::trim_left(literal_raw, b" \t\n\r");
    let literal_tag = dependency::Tag::infer(literal);

    // `catalog:` references are defined by the root user, not the
    // transitive package, so they can't smuggle in an arbitrary source.
    // We short-circuit on the *literal* before the resolution switch:
    // `PackageManagerEnqueue::enqueue_dependency*` dereferences a `catalog:`
    // specifier inline against the root's catalog, so `dep_res_tag` ends up
    // being the target's tag (`.folder` / `.git` / `.workspace` / ...), not
    // a dedicated catalog variant. Re-inferring the parent's stored literal
    // is the only signal that tells us the parent wrote `catalog:` rather
    // than the target's source directly.
    if literal_tag == dependency::Tag::Catalog {
        return None;
    }

    match res_tag {
        // Uninitialized / root / npm resolutions are never exotic.
        ResolutionTag::Uninitialized | ResolutionTag::Root | ResolutionTag::Npm => None,

        // These resolution tags can only be reached if some nested
        // package.json literally named a non-registry source —
        // `linkWorkspacePackages` can't produce them. The Resolution.Tag
        // itself is authoritative; we don't need the literal.
        ResolutionTag::Git => Some("git"),
        ResolutionTag::Github => Some("github"),
        ResolutionTag::LocalTarball => Some("local_tarball"),
        ResolutionTag::RemoteTarball => Some("remote_tarball"),
        ResolutionTag::Symlink => Some("symlink"),
        ResolutionTag::SingleFileModule => Some("single_file_module"),

        // `linkWorkspacePackages` only rewrites a transitive `.npm` /
        // `.dist_tag` specifier to `.workspace`, never to `.folder`. So a
        // `.folder` resolution on a transitive edge is always the parent's
        // explicit request.
        ResolutionTag::Folder => Some("folder"),

        // Ambiguous: `.workspace` can come from `linkWorkspacePackages`
        // redirecting a transitive plain-semver dep to a local workspace
        // package. Consult the parent's literal specifier to tell the two
        // cases apart.
        ResolutionTag::Workspace => match literal_tag {
            // Parent wrote plain npm semver; `linkWorkspacePackages`
            // redirected it. Not the parent's doing, not exotic.
            dependency::Tag::Uninitialized | dependency::Tag::Npm | dependency::Tag::DistTag => {
                None
            }
            // `.catalog` handled above the switch — unreachable here.
            dependency::Tag::Catalog => None,
            dependency::Tag::Folder => Some("folder"),
            dependency::Tag::Symlink => Some("symlink"),
            dependency::Tag::Workspace => Some("workspace"),
            dependency::Tag::Git => Some("git"),
            dependency::Tag::Github => Some("github"),
            dependency::Tag::Tarball => Some("tarball"),
        },

        // Any other non-named resolution tag (the enum is open via the u8
        // newtype) — treat as exotic; better to false-positive than to miss.
        _ => Some("unknown"),
    }
}
