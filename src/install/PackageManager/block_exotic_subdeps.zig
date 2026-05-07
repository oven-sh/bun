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
//! We key off the **literal specifier** written in each nested `package.json`.
//! Neither the parsed specifier tag nor the final resolution tag survives
//! `install.linkWorkspacePackages` cleanly: the parser rewrites a registry
//! semver like `^2.0.0` to `Dependency.Version.Tag.workspace` when the name
//! matches a local workspace (Package.zig:1090-1107), and the resolver
//! likewise points `resolutions[dep_id]` at the workspace package. Both
//! erase the distinction between "parent asked for a registry version" and
//! "parent asked for `workspace:`". The `literal` string never changes, so
//! re-inferring the tag from it reproduces the specifier the remote package
//! actually published — which is what this policy needs to judge.

const Violation = struct {
    parent_id: PackageID,
    dep_id: DependencyID,
    literal_tag: Dependency.Version.Tag,
};

/// Walks the fully-resolved lockfile and emits an error for every
/// transitive dependency whose literal specifier is a non-registry source.
/// Returns true if any violations were found.
pub fn enforceBlockExoticSubdeps(manager: *PackageManager) !bool {
    if (!manager.options.enable.block_exotic_subdeps) return false;
    if (manager.lockfile.packages.len == 0) return false;

    const pkgs = manager.lockfile.packages.slice();
    const pkg_resolutions = pkgs.items(.resolution);
    const pkg_names = pkgs.items(.name);
    const pkg_dependencies = pkgs.items(.dependencies);
    const string_buf = manager.lockfile.buffers.string_bytes.items;
    const resolutions = manager.lockfile.buffers.resolutions.items;
    const dependencies = manager.lockfile.buffers.dependencies.items;

    // Collect violations — dedupe by (parent_id, package_id) so we don't
    // print the same pair twice when a package is referenced more than once.
    var violations: std.ArrayList(Violation) = .{};
    defer violations.deinit(manager.allocator);
    var seen: std.AutoHashMapUnmanaged(u64, void) = .{};
    defer seen.deinit(manager.allocator);

    for (0..pkgs.len) |_parent_id| {
        const parent_id: PackageID = @intCast(_parent_id);
        const parent_res = pkg_resolutions[parent_id];

        // Only transitive edges — skip root/workspace (direct deps are allowed).
        if (isTopLevel(parent_res.tag)) continue;

        const parent_deps = pkg_dependencies[parent_id];
        for (parent_deps.begin()..parent_deps.end()) |_dep_id| {
            const dep_id: DependencyID = @intCast(_dep_id);
            const dep_pkg_id = resolutions[dep_id];
            if (dep_pkg_id == invalid_package_id) continue;
            if (dep_pkg_id >= pkgs.len) continue;

            // Re-infer the specifier tag from the LITERAL string the parent's
            // package.json actually wrote. See module comment for why neither
            // `dep.version.tag` nor `dep_res.tag` is reliable here.
            const literal = dependencies[dep_id].version.literal.slice(string_buf);
            const literal_tag = Dependency.Version.Tag.infer(literal);
            if (!isExoticSpecifier(literal_tag)) continue;

            const key = (@as(u64, parent_id) << 32) | @as(u64, dep_pkg_id);
            const gop = try seen.getOrPut(manager.allocator, key);
            if (gop.found_existing) continue;

            try violations.append(manager.allocator, .{
                .parent_id = parent_id,
                .dep_id = dep_id,
                .literal_tag = literal_tag,
            });
        }
    }

    if (violations.items.len == 0) return false;

    Output.prettyErrorln("<r><red>error<r><d>:<r> <b>install.blockExoticSubdeps<r> is enabled, but the following transitive dependencies use non-registry sources:", .{});
    Output.flush();

    for (violations.items) |v| {
        const parent_name = pkg_names[v.parent_id].slice(string_buf);
        const parent_res = pkg_resolutions[v.parent_id];
        const dep = dependencies[v.dep_id];
        const dep_name = dep.name.slice(string_buf);
        const literal = dep.version.literal.slice(string_buf);

        Output.prettyErrorln(
            "  <b>{s}<r><d>@{f}<r> depends on <b>{s}<r><d>@{s}<r> via <yellow>{s}<r> source",
            .{
                parent_name,
                parent_res.fmt(string_buf, .auto),
                dep_name,
                literal,
                @tagName(v.literal_tag),
            },
        );
    }

    Output.prettyErrorln(
        "\n<d>To allow these, unset <b>install.blockExoticSubdeps<r><d> in bunfig.toml.<r>",
        .{},
    );
    Output.flush();
    return true;
}

inline fn isTopLevel(tag: Resolution.Tag) bool {
    return tag == .root or tag == .workspace;
}

/// A specifier tag is "exotic" when it names a non-registry source. Registry
/// specifiers (`npm:`/plain semver/dist-tag) are allowed; `catalog:`
/// references are also allowed because catalog entries are defined by the
/// user in the workspace-root `package.json`, not by the transitive package —
/// they can only point at something the root user already opted into, so
/// they're not an attacker-controlled vector.
inline fn isExoticSpecifier(tag: Dependency.Version.Tag) bool {
    return switch (tag) {
        // uninitialized + npm + dist_tag — the NPM-registry-family specifiers.
        .uninitialized, .npm, .dist_tag => false,
        // catalog:name — the catalog is defined by the root user, not the
        // transitive package, so it can't smuggle in an arbitrary source.
        .catalog => false,
        // folder, symlink, workspace, git, github, tarball — genuinely exotic.
        .folder, .symlink, .workspace, .git, .github, .tarball => true,
    };
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
