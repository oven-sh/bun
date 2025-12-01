const Buffers = @This();

trees: Tree.List = .{},
hoisted_dependencies: DependencyIDList = .{},
/// This is the underlying buffer used for the `resolutions` external slices inside of `Package`
/// Should be the same length as `dependencies`
resolutions: PackageIDList = .{},
/// This is the underlying buffer used for the `dependencies` external slices inside of `Package`
dependencies: DependencyList = .{},
/// This is the underlying buffer used for any `Semver.ExternalString` instance in the lockfile
extern_strings: ExternalStringBuffer = .{},
/// This is where all non-inlinable `Semver.String`s are stored.
string_bytes: StringBuffer = .{},

pub fn deinit(this: *Buffers, allocator: Allocator) void {
    this.trees.deinit(allocator);
    this.resolutions.deinit(allocator);
    this.dependencies.deinit(allocator);
    this.extern_strings.deinit(allocator);
    this.string_bytes.deinit(allocator);
}

pub fn preallocate(this: *Buffers, that: Buffers, allocator: Allocator) !void {
    try this.trees.ensureTotalCapacity(allocator, that.trees.items.len);
    try this.resolutions.ensureTotalCapacity(allocator, that.resolutions.items.len);
    try this.dependencies.ensureTotalCapacity(allocator, that.dependencies.items.len);
    try this.extern_strings.ensureTotalCapacity(allocator, that.extern_strings.items.len);
    try this.string_bytes.ensureTotalCapacity(allocator, that.string_bytes.items.len);
}

const sizes = blk: {
    const fields = std.meta.fields(Lockfile.Buffers);
    const Data = struct {
        size: usize,
        name: []const u8,
        type: type,
        alignment: usize,
    };
    var data: [fields.len]Data = undefined;
    for (fields, &data) |field_info, *elem| {
        elem.* = .{
            .size = @sizeOf(field_info.type),
            .name = field_info.name,
            .alignment = if (@sizeOf(field_info.type) == 0) 1 else field_info.alignment,
            .type = field_info.type.Slice,
        };
    }

    const SortContext = struct {
        data: []Data,
        pub fn swap(comptime ctx: @This(), comptime lhs: usize, comptime rhs: usize) void {
            const tmp = ctx.data[lhs];
            ctx.data[lhs] = ctx.data[rhs];
            ctx.data[rhs] = tmp;
        }
        pub fn lessThan(comptime ctx: @This(), comptime lhs: usize, comptime rhs: usize) bool {
            return ctx.data[lhs].alignment > ctx.data[rhs].alignment;
        }
    };

    std.sort.insertionContext(0, fields.len, SortContext{
        .data = &data,
    });
    var sizes_bytes: [fields.len]usize = undefined;
    var names: [fields.len][]const u8 = undefined;
    var types: [fields.len]type = undefined;
    for (data, &sizes_bytes, &names, &types) |elem, *size, *name, *Type| {
        size.* = elem.size;
        name.* = elem.name;
        Type.* = elem.type;
    }
    break :blk .{
        .bytes = sizes_bytes,
        .names = names,
        .types = types,
    };
};

pub fn readArray(stream: *Stream, allocator: Allocator, comptime ArrayList: type) !ArrayList {
    const arraylist: ArrayList = undefined;

    const PointerType = std.meta.Child(@TypeOf(arraylist.items.ptr));

    var reader = stream.reader();
    const start_pos = try reader.readInt(u64, .little);

    // If its 0xDEADBEEF, then that means the value was never written in the lockfile.
    if (start_pos == 0xDEADBEEF) {
        return error.CorruptLockfile;
    }

    // These are absolute numbers, it shouldn't be zero.
    // There's a prefix before any of the arrays, so it can never be zero here.
    if (start_pos == 0) {
        return error.CorruptLockfile;
    }

    // We shouldn't be going backwards.
    if (start_pos < (stream.pos -| @sizeOf(u64))) {
        return error.CorruptLockfile;
    }

    const end_pos = try reader.readInt(u64, .little);

    // If its 0xDEADBEEF, then that means the value was never written in the lockfile.
    // That shouldn't happen.
    if (end_pos == 0xDEADBEEF) {
        return error.CorruptLockfile;
    }

    // These are absolute numbers, it shouldn't be zero.
    if (end_pos == 0) {
        return error.CorruptLockfile;
    }

    // Prevent integer overflow.
    if (start_pos > end_pos) {
        return error.CorruptLockfile;
    }

    // Prevent buffer overflow.
    if (end_pos > stream.buffer.len) {
        return error.CorruptLockfile;
    }

    const byte_len = end_pos - start_pos;
    stream.pos = end_pos;

    if (byte_len == 0) return ArrayList{
        .items = &[_]PointerType{},
        .capacity = 0,
    };

    const misaligned = std.mem.bytesAsSlice(PointerType, stream.buffer[start_pos..end_pos]);

    return ArrayList{
        .items = try allocator.dupe(PointerType, @as([*]PointerType, @alignCast(misaligned.ptr))[0..misaligned.len]),
        .capacity = misaligned.len,
    };
}

pub fn writeArray(comptime StreamType: type, stream: StreamType, comptime Writer: type, writer: Writer, comptime ArrayList: type, array: ArrayList) !void {
    comptime assertNoUninitializedPadding(@TypeOf(array));
    const bytes = std.mem.sliceAsBytes(array);

    const start_pos = try stream.getPos();
    try writer.writeInt(u64, 0xDEADBEEF, .little);
    try writer.writeInt(u64, 0xDEADBEEF, .little);

    const prefix = comptime std.fmt.comptimePrint(
        "\n<{s}> {d} sizeof, {d} alignof\n",
        .{
            @typeName(std.meta.Child(ArrayList)),
            @sizeOf(std.meta.Child(ArrayList)),
            @alignOf(std.meta.Child(ArrayList)),
        },
    );
    try writer.writeAll(prefix);

    if (bytes.len > 0) {
        _ = try Aligner.write(sizes.types[0], Writer, writer, try stream.getPos());

        const real_start_pos = try stream.getPos();
        try writer.writeAll(bytes);
        const real_end_pos = try stream.getPos();
        const positioned = [2]u64{ real_start_pos, real_end_pos };
        var written: usize = 0;
        while (written < 16) {
            written += stream.pwrite(std.mem.asBytes(&positioned)[written..], start_pos + written);
        }
    } else {
        const real_end_pos = try stream.getPos();
        const positioned = [2]u64{ real_end_pos, real_end_pos };
        var written: usize = 0;
        while (written < 16) {
            written += stream.pwrite(std.mem.asBytes(&positioned)[written..], start_pos + written);
        }
    }
}

pub fn save(
    lockfile: *Lockfile,
    options: *const PackageManager.Options,
    allocator: Allocator,
    comptime StreamType: type,
    stream: StreamType,
    comptime Writer: type,
    writer: Writer,
) !void {
    const buffers = lockfile.buffers;
    inline for (sizes.names) |name| {
        if (options.log_level.isVerbose()) {
            Output.prettyErrorln("Saving {d} {s}", .{ @field(buffers, name).items.len, name });
        }

        // Dependencies have to be converted to .toExternal first
        // We store pointers in Version.Value, so we can't just write it directly
        if (comptime strings.eqlComptime(name, "dependencies")) {
            const remaining = buffers.dependencies.items;

            if (comptime Environment.allow_assert) {
                for (remaining) |dep| {
                    switch (dep.version.tag) {
                        .folder => {
                            const folder = lockfile.str(&dep.version.value.folder);
                            if (strings.containsChar(folder, std.fs.path.sep_windows)) {
                                std.debug.panic("workspace windows separator: {s}\n", .{folder});
                            }
                        },
                        .tarball => {
                            if (dep.version.value.tarball.uri == .local) {
                                const tarball = lockfile.str(&dep.version.value.tarball.uri.local);
                                if (strings.containsChar(tarball, std.fs.path.sep_windows)) {
                                    std.debug.panic("tarball windows separator: {s}", .{tarball});
                                }
                            }
                        },
                        .workspace => {
                            const workspace = lockfile.str(&dep.version.value.workspace);
                            if (strings.containsChar(workspace, std.fs.path.sep_windows)) {
                                std.debug.panic("workspace windows separator: {s}\n", .{workspace});
                            }
                        },
                        .symlink => {
                            const symlink = lockfile.str(&dep.version.value.symlink);
                            if (strings.containsChar(symlink, std.fs.path.sep_windows)) {
                                std.debug.panic("symlink windows separator: {s}\n", .{symlink});
                            }
                        },
                        else => {},
                    }
                }
            }

            // It would be faster to buffer these instead of one big allocation
            var to_clone = try std.ArrayListUnmanaged(Dependency.External).initCapacity(allocator, remaining.len);

            defer to_clone.deinit(allocator);
            for (remaining) |dep| {
                to_clone.appendAssumeCapacity(Dependency.toExternal(dep));
            }

            try writeArray(StreamType, stream, Writer, writer, []Dependency.External, to_clone.items);
        } else {
            const list = @field(buffers, name);
            const items = list.items;
            const Type = @TypeOf(items);
            if (comptime Type == Tree) {
                // We duplicate it here so that alignment bytes are zeroed out
                var clone = try std.ArrayListUnmanaged(Tree.External).initCapacity(allocator, list.items.len);
                for (list.items) |item| {
                    clone.appendAssumeCapacity(Tree.toExternal(item));
                }
                defer clone.deinit(allocator);

                try writeArray(StreamType, stream, Writer, writer, Tree.External, clone.items);
            } else {
                // We duplicate it here so that alignment bytes are zeroed out
                var clone = try std.ArrayListUnmanaged(std.meta.Child(Type)).initCapacity(allocator, list.items.len);
                clone.appendSliceAssumeCapacity(items);
                defer clone.deinit(allocator);

                try writeArray(StreamType, stream, Writer, writer, Type, clone.items);
            }
        }

        if (comptime Environment.isDebug) {
            // Output.prettyErrorln("Field {s}: {d} - {d}", .{ name, pos, try stream.getPos() });
        }
    }
}

pub fn legacyPackageToDependencyID(this: Buffers, dependency_visited: ?*Bitset, package_id: PackageID) !DependencyID {
    switch (package_id) {
        0 => return Tree.root_dep_id,
        invalid_package_id => return invalid_package_id,
        else => for (this.resolutions.items, 0..) |pkg_id, dep_id| {
            if (pkg_id == package_id) {
                if (dependency_visited) |visited| {
                    if (visited.isSet(dep_id)) continue;
                    visited.set(dep_id);
                }
                return @as(DependencyID, @truncate(dep_id));
            }
        },
    }
    return error.@"Lockfile is missing resolution data";
}

pub fn load(stream: *Stream, allocator: Allocator, log: *logger.Log, pm_: ?*PackageManager) !Buffers {
    var this = Buffers{};
    var external_dependency_list_: std.ArrayListUnmanaged(Dependency.External) = std.ArrayListUnmanaged(Dependency.External){};

    inline for (sizes.names) |name| {
        const Type = @TypeOf(@field(this, name));

        var pos: usize = 0;
        if (comptime Environment.isDebug) {
            pos = try stream.getPos();
        }

        if (comptime Type == @TypeOf(this.dependencies)) {
            external_dependency_list_ = try readArray(stream, allocator, std.ArrayListUnmanaged(Dependency.External));
            if (pm_) |pm| {
                if (pm.options.log_level.isVerbose()) {
                    Output.prettyErrorln("Loaded {d} {s}", .{ external_dependency_list_.items.len, name });
                }
            }
        } else if (comptime Type == @TypeOf(this.trees)) {
            var tree_list = try readArray(stream, allocator, std.ArrayListUnmanaged(Tree.External));
            defer tree_list.deinit(allocator);
            this.trees = try Tree.List.initCapacity(allocator, tree_list.items.len);
            this.trees.items.len = tree_list.items.len;

            for (tree_list.items, this.trees.items) |from, *to| {
                to.* = Tree.toTree(from);
            }
        } else {
            @field(this, name) = try readArray(stream, allocator, Type);
            if (pm_) |pm| {
                if (pm.options.log_level.isVerbose()) {
                    Output.prettyErrorln("Loaded {d} {s}", .{ @field(this, name).items.len, name });
                }
            }
        }

        // if (comptime Environment.isDebug) {
        //     Output.prettyErrorln("Field {s}: {d} - {d}", .{ name, pos, try stream.getPos() });
        // }
    }

    const external_dependency_list = external_dependency_list_.items;
    // Dependencies are serialized separately.
    // This is unfortunate. However, not using pointers for Semver Range's make the code a lot more complex.
    this.dependencies = try DependencyList.initCapacity(allocator, external_dependency_list.len);
    const string_buf = this.string_bytes.items;
    const extern_context = Dependency.Context{
        .log = log,
        .allocator = allocator,
        .buffer = string_buf,
        .package_manager = pm_,
    };

    this.dependencies.expandToCapacity();
    this.dependencies.items.len = external_dependency_list.len;

    {
        var external_deps = external_dependency_list.ptr;
        const dependencies = this.dependencies.items;
        if (comptime Environment.allow_assert) assert(external_dependency_list.len == dependencies.len);
        for (dependencies) |*dep| {
            dep.* = Dependency.toDependency(external_deps[0], extern_context);
            external_deps += 1;
        }
    }

    // Legacy tree structure stores package IDs instead of dependency IDs
    if (this.trees.items.len > 0 and this.trees.items[0].dependency_id != Tree.root_dep_id) {
        var visited = try Bitset.initEmpty(allocator, this.dependencies.items.len);
        for (this.trees.items) |*tree| {
            const package_id = tree.dependency_id;
            tree.dependency_id = try this.legacyPackageToDependencyID(&visited, package_id);
        }
        visited.setRangeValue(.{
            .start = 0,
            .end = this.dependencies.items.len,
        }, false);
        for (this.hoisted_dependencies.items) |*package_id| {
            const pid = package_id.*;
            package_id.* = try this.legacyPackageToDependencyID(&visited, pid);
        }
        visited.deinit(allocator);
    }

    return this;
}

const std = @import("std");
const Allocator = std.mem.Allocator;

const bun = @import("bun");
const Environment = bun.Environment;
const Output = bun.Output;
const assert = bun.assert;
const logger = bun.logger;
const strings = bun.strings;
const Bitset = bun.bit_set.DynamicBitSetUnmanaged;
const String = bun.Semver.String;

const install = bun.install;
const Aligner = install.Aligner;
const Dependency = bun.install.Dependency;
const DependencyID = install.DependencyID;
const PackageID = install.PackageID;
const PackageManager = bun.install.PackageManager;
const invalid_package_id = install.invalid_package_id;

const Lockfile = bun.install.Lockfile;
const DependencyIDList = Lockfile.DependencyIDList;
const DependencyList = Lockfile.DependencyList;
const ExternalStringBuffer = Lockfile.ExternalStringBuffer;
const PackageIDList = Lockfile.PackageIDList;
const Stream = Lockfile.Stream;
const StringBuffer = Lockfile.StringBuffer;
const Tree = Lockfile.Tree;
const assertNoUninitializedPadding = Lockfile.assertNoUninitializedPadding;
