pub const PostinstallOptimizer = enum {
    native_binlink,
    ignore,

    const default_native_binlinks_name_hashes = &[_]PackageNameHash{
        bun.Semver.String.Builder.stringHash("esbuild"),
    };

    const default_ignore_name_hashes = &[_]PackageNameHash{
        bun.Semver.String.Builder.stringHash("sharp"),
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
                const hash = bun.Semver.String.Builder.stringHash(str);
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
        // Loop through the list of optional dependencies with platform-specific constraints
        // Find a matching target-specific dependency.
        for (resolutions) |resolution| {
            if (resolution > metas.len) continue;
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

        pub fn shouldIgnoreLifecycleScripts(this: *const @This(), name_hash: PackageNameHash) bool {
            if (bun.env_var.feature_flag.BUN_FEATURE_FLAG_DISABLE_IGNORE_SCRIPTS.get()) {
                return false;
            }

            return this.get(name_hash) != null;
        }

        fn fromDefault(name_hash: PackageNameHash) ?PostinstallOptimizer {
            for (default_native_binlinks_name_hashes) |hash| {
                if (hash == name_hash) {
                    return .native_binlink;
                }
            }
            for (default_ignore_name_hashes) |hash| {
                if (hash == name_hash) {
                    return .ignore;
                }
            }
            return null;
        }

        pub fn get(this: *const @This(), name_hash: PackageNameHash) ?PostinstallOptimizer {
            return this.dynamic.get(name_hash) orelse {
                switch (fromDefault(name_hash) orelse return null) {
                    .native_binlink => {
                        if (this.disable_default_native_binlinks) {
                            return null;
                        }
                        return .native_binlink;
                    },
                    .ignore => {
                        if (this.disable_default_ignore) {
                            return null;
                        }
                        return .ignore;
                    },
                }

                return null;
            };
        }
    };
};

const std = @import("std");

const bun = @import("bun");
const ast = bun.ast;

const install = bun.install;
const ArrayIdentityContext = install.ArrayIdentityContext;
const Lockfile = install.Lockfile;
const Npm = install.Npm;
const PackageID = install.PackageID;
const PackageNameHash = install.PackageNameHash;
const Meta = Lockfile.Package.Meta;
