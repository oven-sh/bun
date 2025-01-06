const std = @import("std");
const bun = @import("root").bun;
const string = bun.string;
const String = bun.Semver.String;
const Lockfile = bun.install.Lockfile;
const OOM = bun.OOM;
const File = bun.sys.File;
const Output = bun.Output;
const DependencyID = bun.install.DependencyID;
const Dependency = bun.install.Dependency;

pub const MiniLockfile = struct {
    version: Version,

    dep_names: []const String,
    dep_behaviors: []const Dependency.Behavior,
    trees: []const Lockfile.Tree,
    string_bytes: []const u8,
    hoisted_dependencies: []const DependencyID,

    pub const Version = enum(u32) {
        v0,
        _,

        pub const current = Version.v0;
    };

    pub fn deinit(mini_lockfile: *const @This(), allocator: std.mem.Allocator) void {
        allocator.free(mini_lockfile.string_bytes);
    }

    pub fn loadFromDir(allocator: std.mem.Allocator, dir: bun.FD) OOM!?@This() {
        const file = File.openatOSPath(dir, bun.OSPathLiteral(".bun.lockb"), bun.O.RDONLY, 0).unwrap() catch {
            return null;
        };
        defer file.close();

        const bytes = file.readToEnd(allocator).unwrap() catch {
            return null;
        };

        var stream = std.io.fixedBufferStream(bytes);

        return deserialize(allocator, stream.reader()) catch |err| {
            // for any error, delete and ignore
            Output.warn("invalid hidden lockfile: {s}", .{@errorName(err)});
            Output.flush();
            _ = bun.sys.unlinkat(dir, bun.OSPathLiteral(".bun.lockb"));
            return null;
        };
    }

    fn deserialize(allocator: std.mem.Allocator, reader: anytype) !@This() {
        const version_num = try reader.readInt(u32, .little);

        const version = try std.meta.intToEnum(Version, version_num);

        const hoisted_dependencies_len = try reader.readInt(usize, .little);
        const hoisted_dependencies = try allocator.alloc(DependencyID, hoisted_dependencies_len);
        for (hoisted_dependencies) |*hoisted_dependency| {
            hoisted_dependency.* = try reader.readInt(DependencyID, .little);
        }

        const trees_len = try reader.readInt(usize, .little);
        const trees = try allocator.alloc(Lockfile.Tree, trees_len);
        var external_tree: Lockfile.Tree.External = undefined;
        for (trees) |*tree| {
            const len = try reader.readAll(&external_tree);
            if (len != Lockfile.Tree.external_size) {
                return error.InvalidTree;
            }
            tree.* = Lockfile.Tree.toTree(external_tree);
        }

        const deps_len = try reader.readInt(usize, .little);
        const dep_behaviors = try allocator.alloc(Dependency.Behavior, deps_len);
        for (dep_behaviors) |*dep_behavior| {
            dep_behavior.* = @bitCast(try reader.readInt(u8, .little));
        }

        const dep_names = try allocator.alloc(String, deps_len);

        for (dep_names) |*dep_name| {
            const len = try reader.readAll(&dep_name.bytes);
            if (len != String.max_inline_len) {
                return error.InvalidExternalString;
            }
        }

        const string_buf_len = try reader.readInt(usize, .little);
        const string_buf = try allocator.alloc(u8, string_buf_len);
        const len = try reader.readAll(string_buf);
        if (len != string_buf_len) {
            return error.InvalidStringBuf;
        }

        return .{
            .version = version,
            .trees = trees,
            .dep_names = dep_names,
            .dep_behaviors = dep_behaviors,
            .string_bytes = string_buf,
            .hoisted_dependencies = hoisted_dependencies,
        };
    }

    pub fn saveToDisk(dir: bun.FD, lockfile: *const Lockfile) OOM!void {
        var bytes = std.ArrayList(u8).init(lockfile.allocator);
        defer bytes.deinit();

        try serialize(lockfile, bytes.writer());

        const file = File.openat(dir, ".bun.lockb", bun.O.CREAT | bun.O.WRONLY, 0o644).unwrap() catch |err| {
            Output.warn("failed to create hidden lockfile 'node_modules/.bun.lockb': {s}", .{@errorName(err)});
            Output.flush();
            return;
        };

        file.writeAll(bytes.items).unwrap() catch |err| {
            Output.warn("failed to write hidden lockfile 'node_modules/.bun.lockb': {s}", .{@errorName(err)});
            Output.flush();
            _ = bun.sys.unlinkat(dir, bun.OSPathLiteral(".bun.lockb"));
            return;
        };

        file.close();
    }

    fn serialize(lockfile: *const Lockfile, writer: anytype) OOM!void {
        try writer.writeInt(u32, @intFromEnum(Version.current), .little);

        try writer.writeInt(usize, lockfile.buffers.hoisted_dependencies.items.len, .little);
        try writer.writeAll(std.mem.sliceAsBytes(lockfile.buffers.hoisted_dependencies.items));

        try writer.writeInt(usize, lockfile.buffers.trees.items.len, .little);
        for (lockfile.buffers.trees.items) |tree| {
            try writer.writeAll(&Lockfile.Tree.toExternal(tree));
        }

        var bytes: std.ArrayListUnmanaged(u8) = .{};
        defer bytes.deinit(lockfile.allocator);
        var pool = String.Builder.StringPool.init(lockfile.allocator);
        defer pool.deinit();
        var new_string_buf = String.Buf.init(lockfile.allocator, &bytes, &pool);

        try writer.writeInt(usize, lockfile.buffers.dependencies.items.len, .little);
        for (lockfile.buffers.dependencies.items) |dep| {
            try writer.writeInt(u8, @bitCast(dep.behavior), .little);
        }
        for (lockfile.buffers.dependencies.items) |dep| {
            const name = try new_string_buf.append(dep.name.slice(lockfile.buffers.string_bytes.items));
            try writer.writeAll(&name.bytes);
        }

        try writer.writeInt(usize, bytes.items.len, .little);
        try writer.writeAll(bytes.items);
    }
};
