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
//!   0. Before anything else we re-infer the parent's trimmed literal. If
//!      it reads as `catalog:`, the effective source is whatever the
//!      **root** user's catalog entry resolves to — root-authored, not
//!      exotic — and we skip. This has to run before the resolution switch
//!      because `enqueueDependencyWithMainAndSuccessFn` dereferences
//!      `catalog:` inline, so the resolution ends up carrying the target's
//!      tag (`.folder` / `.git` / `.workspace` / ...), not a dedicated
//!      catalog variant; without this short-circuit a root catalog
//!      pointing at e.g. `file:./shared` would false-positive.
//!   1. The child package's **Resolution.Tag** decides the bulk of the
//!      remaining cases. Tags like `.git` / `.github` / `.local_tarball` /
//!      `.remote_tarball` / `.symlink` / `.single_file_module` / `.folder`
//!      are never reachable via `linkWorkspacePackages` redirection or any
//!      other implicit path (`Package.zig`'s `parseDependency` only
//!      rewrites `.npm` / `.dist_tag` to `.workspace`, never to `.folder`
//!      or the URL-family tags) — they're always the parent's explicit
//!      choice and are always exotic.
//!   2. Only `.workspace` is ambiguous: `linkWorkspacePackages` (default
//!      true) can rewrite a transitive registry semver like `^2.0.0` to a
//!      local workspace package when the names match. For that one case
//!      we re-inspect the **literal specifier** the parent's
//!      `package.json` actually wrote (trimmed as above; without trimming,
//!      an attacker-controlled leading-whitespace byte could smuggle an
//!      exotic spec past the check because `infer()`'s switch has no case
//!      for whitespace).
//!
//! When the root user has an `overrides`/`resolutions` entry for a given
//! dependency name, the override's literal takes priority: overrides are the
//! canonical way to remediate a violation (enable → identify the offender →
//! add an override pointing it at a registry version), and the override is
//! root-user-defined so it's not attacker-controlled.

/// Walks the fully-resolved lockfile and emits an error for every transitive
/// dependency that is specified with a non-registry source. Returns the
/// number of violations reported (so the caller can decide whether to exit).
pub fn enforceBlockExoticSubdeps(manager: *PackageManager) bun.OOM!usize {
    if (!manager.options.enable.block_exotic_subdeps) return 0;

    const pkgs = manager.lockfile.packages.slice();
    if (pkgs.len == 0) return 0;

    const pkg_resolutions = pkgs.items(.resolution);
    const pkg_names = pkgs.items(.name);
    const pkg_dependencies = pkgs.items(.dependencies);
    const string_buf = manager.lockfile.buffers.string_bytes.items;
    const resolutions = manager.lockfile.buffers.resolutions.items;
    const dependencies = manager.lockfile.buffers.dependencies.items;

    // Dedupe by (parent_id, child_pkg_id) — the same resolved package can
    // appear as a dep of more than one parent and we only want to report
    // each distinct edge once.
    var seen: std.AutoHashMapUnmanaged(u64, void) = .{};
    defer seen.deinit(manager.allocator);

    var header_printed = false;
    var count: usize = 0;

    for (0..pkgs.len) |_parent_id| {
        const parent_id: PackageID = @intCast(_parent_id);
        const parent_res = pkg_resolutions[parent_id];

        // Only transitive edges — skip root and workspace parents.
        if (parent_res.tag == .root or parent_res.tag == .workspace) continue;

        const parent_deps = pkg_dependencies[parent_id];
        for (parent_deps.begin()..parent_deps.end()) |_dep_id| {
            const dep_id: DependencyID = @intCast(_dep_id);
            if (dep_id >= dependencies.len) continue;
            if (dep_id >= resolutions.len) continue;

            const dep_pkg_id = resolutions[dep_id];
            if (dep_pkg_id == invalid_package_id) continue;
            if (dep_pkg_id >= pkgs.len) continue;

            const dep = dependencies[dep_id];
            const dep_res_tag = pkg_resolutions[dep_pkg_id].tag;

            // If the root user has an `overrides` / `resolutions` entry for
            // this name, the effective specifier is whatever the root chose,
            // not whatever the transitive parent wrote. Overrides are the
            // standard remediation for this flag so we must honor them
            // instead of the now-stale transitive literal. Same rationale as
            // `.catalog` — root-user-defined indirection isn't
            // attacker-controlled.
            //
            // We only trust the override's literal when the resolver's own
            // lookup would have hit. `enqueueDependencyWithMainAndSuccessFn`
            // only consults the override map when ALL of the following hold
            // (see the
            // `if !dependency.behavior.isWorkspace() and (tag != .npm or
            // !npm.is_alias) { overrides.get(hash(realname())) }` block):
            //   * the dep isn't a workspace declaration,
            //   * it isn't an npm alias (`"foo": "npm:bar@^1.0.0"` keys on
            //     the alias target `"bar"` — `hash(realname())` — not the
            //     alias name `"foo"`, and the resolver skips the lookup
            //     entirely for aliases), and
            //   * for `.git` / `.github` / `.tarball` specifiers `realname()`
            //     is the `package_name` which `parseWithTag` leaves empty
            //     until `runTasks` backfills it after the fetch, so
            //     `overrides.get(hash(""))` misses.
            // For every other specifier tag the lookup hits (either via
            // `dep.name_hash` directly or via a `hash(realname())` whose
            // `realname()` equals the name), so the override IS applied.
            //
            // Keying on the specifier tag here matters for overrides whose
            // *target* is exotic: a parent that wrote `"foo": "file:../bad"`
            // with a root override of `{foo: "git+https://..."}` has
            // `dep.version.tag == .folder` but `dep_res_tag == .git`;
            // gating on `dep_res_tag` would incorrectly suppress the
            // applied override literal. It also matters for an
            // override-to-`catalog:` target — `classify`'s catalog
            // short-circuit only fires when `literal_raw` is `"catalog:"`,
            // which requires propagating the override.
            //
            // `OverrideMap.get()` returns `?Dependency.Version` **by value**,
            // and for inline Semver.String payloads (≤8 bytes) `.slice()`
            // returns a pointer into `this`'s storage (see SemverString.zig:
            // "String must be a pointer because we reference it as a slice.
            // It will become a dead pointer if it is copied"). Bind by
            // pointer via `|*ovr|` so the slice points into the named
            // `overridden` local and stays valid through `classify` and the
            // error-print below.
            const override_applied = blk: {
                if (dep.behavior.isWorkspace()) break :blk false;
                switch (dep.version.tag) {
                    .git, .github, .tarball => break :blk false,
                    .npm => if (dep.version.value.npm.is_alias) break :blk false,
                    else => {},
                }
                break :blk true;
            };
            const overridden = if (override_applied) manager.lockfile.overrides.get(dep.name_hash) else null;
            const literal_raw = if (overridden) |*ovr|
                ovr.literal.slice(string_buf)
            else
                dep.version.literal.slice(string_buf);

            const verdict = classify(dep_res_tag, literal_raw) orelse continue;

            const key = (@as(u64, parent_id) << 32) | @as(u64, dep_pkg_id);
            const gop = try seen.getOrPut(manager.allocator, key);
            if (gop.found_existing) continue;

            if (!header_printed) {
                header_printed = true;
                Output.errGeneric(
                    "<b>install.blockExoticSubdeps<r> is enabled, but the following transitive dependencies use non-registry sources:",
                    .{},
                );
            }

            const parent_name = pkg_names[parent_id].slice(string_buf);
            const dep_name = dep.name.slice(string_buf);
            // Show the stored (untrimmed) literal so the user can identify
            // which spec was published. Note: for a `.folder` tag with a
            // leading-whitespace attack, `cleanWithLogger`'s clone pass
            // wipes `dep.version.literal` because `parseWithTag(.folder,
            // " file:...")` returns null — so this prints as an empty
            // `@` for that one case. The block still fires on `dep_res_tag`,
            // which is what matters; the display is purely informational.
            Output.prettyErrorln(
                "  <b>{s}<r><d>@{f}<r> depends on <b>{s}<r><d>@{s}<r> via <yellow>{s}<r> source",
                .{
                    parent_name,
                    parent_res.fmt(string_buf, .auto),
                    dep_name,
                    literal_raw,
                    verdict.label,
                },
            );
            count += 1;
        }
    }

    if (count > 0) {
        Output.prettyErrorln(
            "\n<d>To allow these, disable <b>install.blockExoticSubdeps<r><d> in bunfig.toml or set <b>block-exotic-subdeps=false<r><d> in .npmrc;" ++
                " to allow a single exotic transitive, add an <b>overrides<r><d> entry in package.json that points the offender at a registry version.<r>",
            .{},
        );
        Output.flush();
    }
    return count;
}

const Verdict = struct { label: []const u8 };

/// Returns the exotic-source label if the (resolution, literal) pair is
/// exotic per this policy, or `null` if it's allowed.
inline fn classify(res_tag: Resolution.Tag, literal_raw: []const u8) ?Verdict {
    // Mirror the resolver's leading-whitespace trim
    // (`Dependency.parse` does `trimLeft(" \t\n\r")` before calling
    // `infer()` on the specifier). If we re-infer on the raw string
    // instead, a published spec like `" workspace:*"` falls through
    // `infer()`'s switch to `.dist_tag` → looks non-exotic.
    const literal = std.mem.trimLeft(u8, literal_raw, " \t\n\r");
    const literal_tag = Dependency.Version.Tag.infer(literal);

    // `catalog:` references are defined by the root user, not the
    // transitive package, so they can't smuggle in an arbitrary source.
    // Short-circuit on the *literal* before the resolution switch:
    // `enqueueDependencyWithMainAndSuccessFn` dereferences `catalog:`
    // inline, so `res_tag` ends up being the target's tag (`.folder` /
    // `.git` / `.workspace` / ...), not a dedicated catalog variant.
    // Re-inferring the parent's stored literal is the only signal that
    // tells us the parent wrote `catalog:` rather than the target's source
    // directly.
    if (literal_tag == .catalog) return null;

    switch (res_tag) {
        // Uninitialized / root / npm resolutions are never exotic.
        .uninitialized, .root, .npm => return null,

        // These resolution tags can only be reached if some nested
        // package.json literally named a non-registry source —
        // `linkWorkspacePackages` can't produce them. The Resolution.Tag
        // itself is authoritative; we don't need the literal.
        .git => return .{ .label = "git" },
        .github => return .{ .label = "github" },
        .local_tarball => return .{ .label = "local_tarball" },
        .remote_tarball => return .{ .label = "remote_tarball" },
        .symlink => return .{ .label = "symlink" },
        .single_file_module => return .{ .label = "single_file_module" },

        // `linkWorkspacePackages` only rewrites a transitive `.npm` /
        // `.dist_tag` specifier to `.workspace`, never to `.folder` (see
        // `Package.zig`'s `parseDependency`). So a `.folder` resolution on
        // a transitive edge is always the parent's explicit request.
        .folder => return .{ .label = "folder" },

        // Any other non-named resolution tag (the enum is non-exhaustive)
        // — treat as exotic; better to false-positive than to miss.
        _ => return .{ .label = "unknown" },

        // Ambiguous: `.workspace` can come from `linkWorkspacePackages`
        // redirecting a transitive plain-semver dep to a local workspace
        // package. Consult the parent's literal specifier to tell the two
        // cases apart.
        .workspace => {
            return switch (literal_tag) {
                // Parent wrote plain npm semver; `linkWorkspacePackages`
                // redirected it. Not the parent's doing, not exotic.
                .uninitialized, .npm, .dist_tag => null,
                // `.catalog` handled above the switch — unreachable here.
                .catalog => null,
                .folder => .{ .label = "folder" },
                .symlink => .{ .label = "symlink" },
                .workspace => .{ .label = "workspace" },
                .git => .{ .label = "git" },
                .github => .{ .label = "github" },
                .tarball => .{ .label = "tarball" },
            };
        },
    }
}

const std = @import("std");

const bun = @import("bun");
const Output = bun.Output;

const install = bun.install;
const Dependency = install.Dependency;
const DependencyID = install.DependencyID;
const PackageID = install.PackageID;
const PackageManager = install.PackageManager;
const Resolution = install.Resolution;
const invalid_package_id = install.invalid_package_id;
