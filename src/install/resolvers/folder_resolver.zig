const std = @import("std");
const PackageID = @import("../install.zig").PackageID;
const Lockfile = @import("../install.zig").Lockfile;
const PackageManager = @import("../install.zig").PackageManager;
const Npm = @import("../npm.zig");
const logger = @import("../../logger.zig");
const FileSystem = @import("../../fs.zig").FileSystem;
const JSAst = @import("../../js_ast.zig");
const string = @import("../../string_types.zig").string;
const Features = @import("../install.zig").Features;
const IdentityContext = @import("../../identity_context.zig").IdentityContext;
const strings = @import("strings");
const Resolution = @import("../resolution.zig").Resolution;
const String = @import("../semver.zig").String;
const Semver = @import("../semver.zig");
const bun = @import("../../global.zig");
const Dependency = @import("../dependency.zig");
pub const FolderResolution = union(Tag) {
    package_id: PackageID,
    new_package_id: PackageID,
    err: anyerror,

    pub const Tag = enum { package_id, err, new_package_id };

    pub const Map = std.HashMapUnmanaged(u64, FolderResolution, IdentityContext(u64), 80);

    pub fn normalize(path: string) string {
        return FileSystem.instance.normalize(path);
    }

    pub fn hash(normalized_path: string) u64 {
        return std.hash.Wyhash.hash(0, normalized_path);
    }

    pub fn NewResolver(comptime tag: Resolution.Tag) type {
        return struct {
            folder_path: string,

            pub fn resolve(this: @This(), comptime Builder: type, builder: Builder, _: JSAst.Expr) !Resolution {
                return Resolution{
                    .tag = tag,
                    .value = @unionInit(Resolution.Value, @tagName(tag), builder.append(String, this.folder_path)),
                };
            }

            pub fn count(this: @This(), comptime Builder: type, builder: Builder, _: JSAst.Expr) void {
                builder.count(this.folder_path);
            }
        };
    }

    pub const Resolver = NewResolver(Resolution.Tag.folder);
    pub const SymlinkResolver = NewResolver(Resolution.Tag.symlink);
    pub const CacheFolderResolver = struct {
        folder_path: []const u8 = "",
        version: Semver.Version,

        pub fn resolve(this: @This(), comptime Builder: type, _: Builder, _: JSAst.Expr) !Resolution {
            return Resolution{
                .tag = Resolution.Tag.npm,
                .value = .{
                    .npm = .{
                        .version = this.version,
                        .url = String.init("", ""),
                    },
                },
            };
        }

        pub fn count(_: @This(), comptime Builder: type, _: Builder, _: JSAst.Expr) void {}
    };

    pub fn normalizePackageJSONPath(global_or_relative: GlobalOrRelative, joined: *[bun.MAX_PATH_BYTES]u8, non_normalized_path: string) [2]string {
        var abs: string = "";
        var rel: string = "";
        // We consider it valid if there is a package.json in the folder
        const normalized = std.mem.trimRight(u8, normalize(non_normalized_path), std.fs.path.sep_str);

        if (strings.startsWithChar(normalized, '.')) {
            var tempcat: [bun.MAX_PATH_BYTES]u8 = undefined;

            std.mem.copy(u8, &tempcat, normalized);
            tempcat[normalized.len] = std.fs.path.sep;
            std.mem.copy(u8, tempcat[normalized.len + 1 ..], "package.json");
            var parts = [_]string{ FileSystem.instance.top_level_dir, tempcat[0 .. normalized.len + 1 + "package.json".len] };
            abs = FileSystem.instance.absBuf(&parts, joined);
            rel = FileSystem.instance.relative(FileSystem.instance.top_level_dir, abs[0 .. abs.len - "/package.json".len]);
        } else {
            var remain: []u8 = joined[0..];
            switch (global_or_relative) {
                .global, .cache_folder => {
                    const path = if (global_or_relative == .global) global_or_relative.global else global_or_relative.cache_folder;
                    if (path.len > 0) {
                        const offset = path.len -| @as(usize, @boolToInt(path[path.len -| 1] == std.fs.path.sep));
                        if (offset > 0)
                            @memcpy(remain.ptr, path.ptr, offset);
                        remain = remain[offset..];
                        if (normalized.len > 0) {
                            if ((path[path.len - 1] != std.fs.path.sep) and (normalized[0] != std.fs.path.sep)) {
                                remain[0] = std.fs.path.sep;
                                remain = remain[1..];
                            }
                        }
                    }
                },
                else => {},
            }
            std.mem.copy(u8, remain, normalized);
            remain[normalized.len] = std.fs.path.sep;
            remain[normalized.len + 1 ..][0.."package.json".len].* = "package.json".*;
            remain = remain[normalized.len + 1 + "package.json".len ..];
            abs = joined[0 .. joined.len - remain.len];
            // We store the folder name without package.json
            rel = abs[0 .. abs.len - "/package.json".len];
        }

        return .{ abs, rel };
    }

    pub fn readPackageJSONFromDisk(
        manager: *PackageManager,
        joinedZ: [:0]const u8,
        abs: []const u8,
        version: Dependency.Version,
        comptime features: Features,
        comptime ResolverType: type,
        resolver: ResolverType,
    ) !Lockfile.Package {
        var package_json: std.fs.File = try std.fs.cwd().openFileZ(joinedZ, .{ .mode = .read_only });
        defer package_json.close();
        var package = Lockfile.Package{};
        var body = Npm.Registry.BodyPool.get(manager.allocator);
        defer Npm.Registry.BodyPool.release(body);
        const len = try package_json.getEndPos();

        body.data.reset();
        body.data.inflate(@maximum(len, 2048)) catch unreachable;
        body.data.list.expandToCapacity();
        const source_buf = try package_json.readAll(body.data.list.items);

        const source = logger.Source.initPathString(abs, body.data.list.items[0..source_buf]);

        try Lockfile.Package.parse(
            manager.lockfile,
            &package,
            manager.allocator,
            manager.log,
            source,
            ResolverType,
            resolver,
            features,
        );

        if (manager.lockfile.getPackageID(package.name_hash, version, package.resolution)) |existing_id| {
            return manager.lockfile.packages.get(existing_id);
        }

        return manager.lockfile.appendPackage(package) catch unreachable;
    }

    pub const GlobalOrRelative = union(enum) {
        global: []const u8,
        relative: void,
        cache_folder: []const u8,
    };

    pub fn getOrPut(global_or_relative: GlobalOrRelative, version: Dependency.Version, non_normalized_path: string, manager: *PackageManager) FolderResolution {
        var joined: [bun.MAX_PATH_BYTES]u8 = undefined;
        const paths = normalizePackageJSONPath(global_or_relative, &joined, non_normalized_path);
        const abs = paths[0];
        const rel = paths[1];

        var entry = manager.folders.getOrPut(manager.allocator, hash(abs)) catch unreachable;
        if (entry.found_existing) return entry.value_ptr.*;

        joined[abs.len] = 0;
        var joinedZ: [:0]u8 = joined[0..abs.len :0];
        const package: Lockfile.Package = switch (global_or_relative) {
            .global => readPackageJSONFromDisk(
                manager,
                joinedZ,
                abs,
                version,
                Features.link,
                SymlinkResolver,
                SymlinkResolver{ .folder_path = non_normalized_path },
            ),
            .relative => readPackageJSONFromDisk(
                manager,
                joinedZ,
                abs,
                version,
                Features.folder,
                Resolver,
                Resolver{ .folder_path = rel },
            ),
            .cache_folder => readPackageJSONFromDisk(
                manager,
                joinedZ,
                abs,
                version,
                Features.npm,
                CacheFolderResolver,
                CacheFolderResolver{ .version = version.value.npm.toVersion() },
            ),
        } catch |err| {
            if (err == error.FileNotFound) {
                entry.value_ptr.* = .{ .err = error.MissingPackageJSON };
            } else {
                entry.value_ptr.* = .{ .err = err };
            }

            return entry.value_ptr.*;
        };

        entry.value_ptr.* = .{ .package_id = package.meta.id };
        return FolderResolution{ .new_package_id = package.meta.id };
    }
};
