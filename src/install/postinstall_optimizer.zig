pub const PostinstallOptimizer = enum {
    native_binlink,
    ignore,

    const default_native_binlinks_name_hashes = &[_]PackageNameHash{
        Semver.String.Builder.stringHash("esbuild"),
    };

    const DefaultIgnore = struct {
        name_hash: PackageNameHash,
        minimum_version: Semver.Version,
    };

    const default_ignore = [1]DefaultIgnore{
        .{
            .name_hash = Semver.String.Builder.stringHash("sharp"),
            .minimum_version = Semver.Version.parseUTF8("0.33.0").version.min(),
        },
    };

    fn fromStringArrayGroup(list: *List, expr: *const ast.Expr, allocator: std.mem.Allocator, value: PostinstallOptimizer) !bool {
        var array = expr.asArray() orelse return false;
        if (array.array.items.len == 0) {
            return true;
        }

        while (array.next()) |entry| {
            if (entry.isString()) {
                const str = entry.asString(allocator) orelse continue;
                if (str.len == 0) continue;
                const hash = Semver.String.Builder.stringHash(str);
                try list.dynamic.put(allocator, hash, value);
            }
        }

        return true;
    }

    pub fn fromPackageJSON(list: *List, expr: *const ast.Expr, allocator: std.mem.Allocator) !void {
        if (expr.get("nativeDependencies")) |*native_deps_expr| {
            list.disable_default_native_binlinks = try fromStringArrayGroup(list, native_deps_expr, allocator, .native_binlink);
        }
        if (expr.get("ignoreScripts")) |*ignored_scripts_expr| {
            list.disable_default_ignore = try fromStringArrayGroup(list, ignored_scripts_expr, allocator, .ignore);
        }
    }

    pub fn getNativeBinlinkReplacementPackageID(
        resolutions: []const PackageID,
        metas: []const Meta,
        target_cpu: Npm.Architecture,
        target_os: Npm.OperatingSystem,
    ) ?PackageID {
        // Windows needs file extensions.
        if (target_os.isMatch(@enumFromInt(Npm.OperatingSystem.win32))) {
            return null;
        }

        // Loop through the list of optional dependencies with platform-specific constraints
        // Find a matching target-specific dependency.
        for (resolutions) |resolution| {
            if (resolution >= metas.len) continue;
            const meta: *const Meta = &metas[resolution];
            if (meta.arch == .all or meta.os == .all) continue;
            if (meta.arch.isMatch(target_cpu) and meta.os.isMatch(target_os)) {
                return resolution;
            }
        }

        return null;
    }

    pub const List = struct {
        dynamic: Map = .{},
        disable_default_native_binlinks: bool = false,
        disable_default_ignore: bool = false,

        pub const Map = std.ArrayHashMapUnmanaged(PackageNameHash, PostinstallOptimizer, install.ArrayIdentityContext.U64, false);

        pub fn isNativeBinlinkEnabled(this: *const @This()) bool {
            if (this.dynamic.count() == 0) {
                if (this.disable_default_native_binlinks) {
                    return true;
                }
            }

            if (bun.env_var.feature_flag.BUN_FEATURE_FLAG_DISABLE_NATIVE_DEPENDENCY_LINKER.get()) {
                return false;
            }

            return true;
        }

        const PkgInfo = struct {
            name_hash: PackageNameHash,
            version: ?Semver.Version = null,
            version_buf: []const u8 = "",
        };

        pub fn shouldIgnoreLifecycleScripts(
            this: *const @This(),
            pkg_info: PkgInfo,
            resolutions: []const PackageID,
            metas: []const Meta,
            target_cpu: Npm.Architecture,
            target_os: Npm.OperatingSystem,
            tree_id: ?Lockfile.Tree.Id,
        ) bool {
            if (bun.env_var.feature_flag.BUN_FEATURE_FLAG_DISABLE_IGNORE_SCRIPTS.get()) {
                return false;
            }

            const mode = this.get(pkg_info) orelse return false;

            return switch (mode) {
                .native_binlink =>
                // TODO: support hoisted.
                (tree_id == null or tree_id.? == 0) and

                    // It's not as simple as checking `get(name_hash) != null` because if the
                    // specific versions of the package do not have optional
                    // dependencies then we cannot do this optimization without
                    // breaking the code.
                    //
                    // This shows up in test/integration/esbuild/esbuild.test.ts
                    getNativeBinlinkReplacementPackageID(resolutions, metas, target_cpu, target_os) != null,

                .ignore => true,
            };
        }

        fn fromDefault(pkg_info: PkgInfo) ?PostinstallOptimizer {
            for (default_native_binlinks_name_hashes) |hash| {
                if (hash == pkg_info.name_hash) {
                    return .native_binlink;
                }
            }
            for (default_ignore) |default| {
                if (default.name_hash == pkg_info.name_hash) {
                    if (pkg_info.version) |version| {
                        if (version.order(
                            default.minimum_version,
                            pkg_info.version_buf,

                            // minimum version doesn't need a string_buf because
                            // it doesn't use pre/build tags
                            "",
                        ) == .lt) {
                            return null;
                        }
                    }
                    return .ignore;
                }
            }
            return null;
        }

        pub fn get(this: *const @This(), pkg_info: PkgInfo) ?PostinstallOptimizer {
            if (this.dynamic.get(pkg_info.name_hash)) |optimize| {
                return optimize;
            }

            const default = fromDefault(pkg_info) orelse {
                return null;
            };

            switch (default) {
                .native_binlink => {
                    if (!this.disable_default_native_binlinks) {
                        return .native_binlink;
                    }
                },
                .ignore => {
                    if (!this.disable_default_ignore) {
                        return .ignore;
                    }
                },
            }

            return null;
        }
    };
};

const std = @import("std");

const bun = @import("bun");
const Semver = bun.Semver;
const ast = bun.ast;

const install = bun.install;
const ArrayIdentityContext = install.ArrayIdentityContext;
const Lockfile = install.Lockfile;
const Npm = install.Npm;
const PackageID = install.PackageID;
const PackageNameHash = install.PackageNameHash;
const Meta = Lockfile.Package.Meta;
