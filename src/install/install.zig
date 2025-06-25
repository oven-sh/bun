threadlocal var initialized_store = false;

pub const bun_hash_tag = ".bun-tag-";
pub const max_hex_hash_len: comptime_int = brk: {
    var buf: [128]u8 = undefined;
    break :brk (std.fmt.bufPrint(buf[0..], "{x}", .{std.math.maxInt(u64)}) catch @panic("Buf wasn't big enough.")).len;
};
pub const max_buntag_hash_buf_len: comptime_int = max_hex_hash_len + bun_hash_tag.len + 1;
pub const BuntagHashBuf = [max_buntag_hash_buf_len]u8;

pub fn buntaghashbuf_make(buf: *BuntagHashBuf, patch_hash: u64) [:0]u8 {
    @memcpy(buf[0..bun_hash_tag.len], bun_hash_tag);
    const digits = std.fmt.bufPrint(buf[bun_hash_tag.len..], "{x}", .{patch_hash}) catch bun.outOfMemory();
    buf[bun_hash_tag.len + digits.len] = 0;
    const bunhashtag = buf[0 .. bun_hash_tag.len + digits.len :0];
    return bunhashtag;
}

// these bytes are skipped
// so we just make it repeat bun bun bun bun bun bun bun bun bun
// because why not
pub const alignment_bytes_to_repeat_buffer = [_]u8{0} ** 144;

pub fn initializeStore() void {
    if (initialized_store) {
        JSAst.Expr.Data.Store.reset();
        JSAst.Stmt.Data.Store.reset();
        return;
    }

    initialized_store = true;
    JSAst.Expr.Data.Store.create();
    JSAst.Stmt.Data.Store.create();
}

/// The default store we use pre-allocates around 16 MB of memory per thread
/// That adds up in multi-threaded scenarios.
/// ASTMemoryAllocator uses a smaller fixed buffer allocator
pub fn initializeMiniStore() void {
    const MiniStore = struct {
        heap: bun.MimallocArena,
        memory_allocator: JSAst.ASTMemoryAllocator,

        pub threadlocal var instance: ?*@This() = null;
    };
    if (MiniStore.instance == null) {
        var mini_store = bun.default_allocator.create(MiniStore) catch bun.outOfMemory();
        mini_store.* = .{
            .heap = bun.MimallocArena.init() catch bun.outOfMemory(),
            .memory_allocator = undefined,
        };
        mini_store.memory_allocator = .{ .allocator = mini_store.heap.allocator() };
        mini_store.memory_allocator.reset();
        MiniStore.instance = mini_store;
        mini_store.memory_allocator.push();
    } else {
        var mini_store = MiniStore.instance.?;
        if (mini_store.memory_allocator.stack_allocator.fixed_buffer_allocator.end_index >= mini_store.memory_allocator.stack_allocator.fixed_buffer_allocator.buffer.len -| 1) {
            mini_store.heap.deinit();
            mini_store.heap = bun.MimallocArena.init() catch bun.outOfMemory();
            mini_store.memory_allocator.allocator = mini_store.heap.allocator();
        }
        mini_store.memory_allocator.reset();
        mini_store.memory_allocator.push();
    }
}

pub const PackageID = u32;
pub const DependencyID = u32;

// pub const DependencyID = enum(u32) {
//     root = max - 1,
//     invalid = max,
//     _,

//     const max = std.math.maxInt(u32);
// };

pub const invalid_package_id = std.math.maxInt(PackageID);
pub const invalid_dependency_id = std.math.maxInt(DependencyID);

pub const PackageNameAndVersionHash = u64;
pub const PackageNameHash = u64; // Use String.Builder.stringHash to compute this
pub const TruncatedPackageNameHash = u32; // @truncate String.Builder.stringHash to compute this

pub const Aligner = struct {
    pub fn write(comptime Type: type, comptime Writer: type, writer: Writer, pos: usize) !usize {
        const to_write = skipAmount(Type, pos);

        const remainder: string = alignment_bytes_to_repeat_buffer[0..@min(to_write, alignment_bytes_to_repeat_buffer.len)];
        try writer.writeAll(remainder);

        return to_write;
    }

    pub inline fn skipAmount(comptime Type: type, pos: usize) usize {
        return std.mem.alignForward(usize, pos, @alignOf(Type)) - pos;
    }
};

pub const Origin = enum(u8) {
    local = 0,
    npm = 1,
    tarball = 2,
};

pub const Features = struct {
    dependencies: bool = true,
    dev_dependencies: bool = false,
    is_main: bool = false,
    optional_dependencies: bool = false,
    peer_dependencies: bool = true,
    trusted_dependencies: bool = false,
    workspaces: bool = false,
    patched_dependencies: bool = false,

    check_for_duplicate_dependencies: bool = false,

    pub fn behavior(this: Features) Behavior {
        var out: u8 = 0;
        out |= @as(u8, @intFromBool(this.dependencies)) << 1;
        out |= @as(u8, @intFromBool(this.optional_dependencies)) << 2;
        out |= @as(u8, @intFromBool(this.dev_dependencies)) << 3;
        out |= @as(u8, @intFromBool(this.peer_dependencies)) << 4;
        out |= @as(u8, @intFromBool(this.workspaces)) << 5;
        return @as(Behavior, @enumFromInt(out));
    }

    pub const main = Features{
        .check_for_duplicate_dependencies = true,
        .dev_dependencies = true,
        .is_main = true,
        .optional_dependencies = true,
        .trusted_dependencies = true,
        .patched_dependencies = true,
        .workspaces = true,
    };

    pub const folder = Features{
        .dev_dependencies = true,
        .optional_dependencies = true,
    };

    pub const workspace = Features{
        .dev_dependencies = true,
        .optional_dependencies = true,
        .trusted_dependencies = true,
    };

    pub const link = Features{
        .dependencies = false,
        .peer_dependencies = false,
    };

    pub const npm = Features{
        .optional_dependencies = true,
    };

    pub const tarball = npm;

    pub const npm_manifest = Features{
        .optional_dependencies = true,
    };
};

pub const PreinstallState = enum(u4) {
    unknown = 0,
    done,
    extract,
    extracting,
    calc_patch_hash,
    calcing_patch_hash,
    apply_patch,
    applying_patch,
};

pub const ExtractData = struct {
    url: string = "",
    resolved: string = "",
    json: ?struct {
        path: string = "",
        buf: []u8 = "",
    } = null,
};

pub const DependencyInstallContext = struct {
    tree_id: Lockfile.Tree.Id = 0,
    path: std.ArrayList(u8) = std.ArrayList(u8).init(bun.default_allocator),
    dependency_id: DependencyID,
};

pub const TaskCallbackContext = union(enum) {
    dependency: DependencyID,
    dependency_install_context: DependencyInstallContext,
    root_dependency: DependencyID,
    root_request_id: PackageID,
};

// We can't know all the packages we need until we've downloaded all the packages
// The easy way would be:
// 1. Download all packages, parsing their dependencies and enqueuing all dependencies for resolution
// 2.

pub const PackageManifestError = error{
    PackageManifestHTTP400,
    PackageManifestHTTP401,
    PackageManifestHTTP402,
    PackageManifestHTTP403,
    PackageManifestHTTP404,
    PackageManifestHTTP4xx,
    PackageManifestHTTP5xx,
};

pub const ExtractTarball = @import("./extract_tarball.zig");
pub const NetworkTask = @import("NetworkTask.zig");
pub const Npm = @import("./npm.zig");
pub const PackageManager = @import("PackageManager.zig");
pub const PackageManifestMap = @import("PackageManifestMap.zig");
pub const Task = @import("Task.zig");
pub const TextLockfile = @import("./lockfile/bun.lock.zig");
const std = @import("std");
pub const Bin = @import("./bin.zig").Bin;
pub const FolderResolution = @import("./resolvers/folder_resolver.zig").FolderResolution;
pub const LifecycleScriptSubprocess = @import("./lifecycle_script_runner.zig").LifecycleScriptSubprocess;
pub const PackageInstall = @import("./PackageInstall.zig").PackageInstall;
pub const Repository = @import("./repository.zig").Repository;
pub const Resolution = @import("./resolution.zig").Resolution;

pub const ArrayIdentityContext = @import("../identity_context.zig").ArrayIdentityContext;
pub const IdentityContext = @import("../identity_context.zig").IdentityContext;

pub const Dependency = @import("./dependency.zig");
pub const Behavior = @import("./dependency.zig").Behavior;

pub const external = @import("./external.zig");
pub const ExternalPackageNameHashList = external.ExternalPackageNameHashList;
pub const ExternalSlice = external.ExternalSlice;
pub const ExternalStringList = external.ExternalStringList;
pub const ExternalStringMap = external.ExternalStringMap;
pub const VersionSlice = external.VersionSlice;

pub const Lockfile = @import("./lockfile.zig");
const Package = Lockfile.Package;
pub const PatchedDep = Lockfile.PatchedDep;

pub const patch = @import("./patch_install.zig");
pub const PatchTask = patch.PatchTask;

const bun = @import("bun");
const HTTP = bun.http;
const JSAst = bun.JSAst;
const default_allocator = bun.default_allocator;
const string = bun.string;

const Semver = bun.Semver;
const ExternalString = Semver.ExternalString;
const String = Semver.String;
