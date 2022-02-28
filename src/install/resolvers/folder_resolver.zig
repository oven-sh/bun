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
const _global = @import("../../global.zig");
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

    pub const Resolver = struct {
        folder_path: string,

        pub fn resolve(this: Resolver, comptime Builder: type, builder: Builder, _: JSAst.Expr) !Resolution {
            return Resolution{
                .tag = .folder,
                .value = .{
                    .folder = builder.append(String, this.folder_path),
                },
            };
        }

        pub fn count(this: Resolver, comptime Builder: type, builder: Builder, _: JSAst.Expr) void {
            builder.count(this.folder_path);
        }
    };

    pub fn getOrPut(non_normalized_path: string, manager: *PackageManager) FolderResolution {

        // We consider it valid if there is a package.json in the folder
        const normalized = std.mem.trimRight(u8, normalize(non_normalized_path), std.fs.path.sep_str);
        var joined: [_global.MAX_PATH_BYTES]u8 = undefined;
        var abs: string = "";
        var rel: string = "";
        if (strings.startsWithChar(normalized, '.')) {
            var tempcat: [_global.MAX_PATH_BYTES]u8 = undefined;

            std.mem.copy(u8, &tempcat, normalized);
            tempcat[normalized.len] = std.fs.path.sep;
            std.mem.copy(u8, tempcat[normalized.len + 1 ..], "package.json");
            var parts = [_]string{ FileSystem.instance.top_level_dir, tempcat[0 .. normalized.len + 1 + "package.json".len] };
            abs = FileSystem.instance.absBuf(&parts, &joined);
            rel = FileSystem.instance.relative(FileSystem.instance.top_level_dir, abs[0 .. abs.len - "/package.json".len]);
        } else {
            std.mem.copy(u8, &joined, normalized);
            joined[normalized.len] = std.fs.path.sep;
            joined[normalized.len + 1 ..][0.."package.json".len].* = "package.json".*;
            abs = joined[0 .. normalized.len + 1 + "package.json".len];
            // We store the folder name without package.json
            rel = abs[0 .. abs.len - "/package.json".len];
        }

        var entry = manager.folders.getOrPut(manager.allocator, hash(abs)) catch unreachable;
        if (entry.found_existing) return entry.value_ptr.*;

        joined[abs.len] = 0;
        var joinedZ: [:0]u8 = joined[0..abs.len :0];

        var package_json: std.fs.File = std.fs.cwd().openFileZ(joinedZ, .{ .read = true }) catch |err| {
            entry.value_ptr.* = .{ .err = err };
            return entry.value_ptr.*;
        };
        var package = Lockfile.Package{};
        var body = Npm.Registry.BodyPool.get(manager.allocator);

        defer Npm.Registry.BodyPool.release(body);
        const len = package_json.getEndPos() catch |err| {
            entry.value_ptr.* = .{ .err = err };
            return entry.value_ptr.*;
        };

        body.data.reset();
        body.data.inflate(@maximum(len, 2048)) catch unreachable;
        body.data.list.expandToCapacity();
        const source_buf = package_json.readAll(body.data.list.items) catch |err| {
            entry.value_ptr.* = .{ .err = err };
            return entry.value_ptr.*;
        };
        var resolver = Resolver{
            .folder_path = rel,
        };
        const source = logger.Source.initPathString(abs, body.data.list.items[0..source_buf]);

        Lockfile.Package.parse(
            manager.lockfile,
            &package,
            manager.allocator,
            manager.log,
            source,
            Resolver,
            resolver,
            Features.folder,
        ) catch |err| {
            // Folders are considered dependency-less
            entry.value_ptr.* = .{ .err = err };
            return entry.value_ptr.*;
        };

        package = manager.lockfile.appendPackage(package) catch unreachable;
        entry.value_ptr.* = .{ .package_id = package.meta.id };
        return FolderResolution{ .new_package_id = package.meta.id };
    }
};
