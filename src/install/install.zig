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
    const digits = std.fmt.bufPrint(buf[bun_hash_tag.len..], "{x}", .{patch_hash}) catch |err|
        switch (err) {
            error.NoSpaceLeft => unreachable,
        };
    buf[bun_hash_tag.len + digits.len] = 0;
    const bunhashtag = buf[0 .. bun_hash_tag.len + digits.len :0];
    return bunhashtag;
}

pub const StorePathFormatter = struct {
    str: string,

    pub fn format(this: StorePathFormatter, writer: *std.Io.Writer) std.Io.Writer.Error!void {
        // if (!this.opts.replace_slashes) {
        //     try writer.writeAll(this.str);
        //     return;
        // }

        for (this.str) |c| {
            switch (c) {
                '/' => try writer.writeByte('+'),
                '\\' => try writer.writeByte('+'),
                else => try writer.writeByte(c),
            }
        }
    }
};

pub fn fmtStorePath(str: string) StorePathFormatter {
    return .{
        .str = str,
    };
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
        var mini_store = bun.handleOom(bun.default_allocator.create(MiniStore));
        mini_store.* = .{
            .heap = bun.MimallocArena.init(),
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
            mini_store.heap = bun.MimallocArena.init();
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
    path: std.array_list.Managed(u8) = std.array_list.Managed(u8).init(bun.default_allocator),
    dependency_id: DependencyID,
};

pub const TaskCallbackContext = union(enum) {
    dependency: DependencyID,
    dependency_install_context: DependencyInstallContext,
    isolated_package_install_context: Store.Entry.Id,
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
pub const NetworkTask = @import("./NetworkTask.zig");
pub const Npm = @import("./npm.zig");
pub const PackageManager = @import("./PackageManager.zig");
pub const PackageManifestMap = @import("./PackageManifestMap.zig");
pub const Task = @import("./PackageManagerTask.zig");
pub const TextLockfile = @import("./lockfile/bun.lock.zig");
pub const Bin = @import("./bin.zig").Bin;
pub const FolderResolution = @import("./resolvers/folder_resolver.zig").FolderResolution;
pub const LifecycleScriptSubprocess = @import("./lifecycle_script_runner.zig").LifecycleScriptSubprocess;
pub const SecurityScanSubprocess = @import("./PackageManager/security_scanner.zig").SecurityScanSubprocess;
pub const PackageInstall = @import("./PackageInstall.zig").PackageInstall;
pub const Repository = @import("./repository.zig").Repository;
pub const Resolution = @import("./resolution.zig").Resolution;
pub const Store = @import("./isolated_install/Store.zig").Store;
pub const FileCopier = @import("./isolated_install/FileCopier.zig").FileCopier;
pub const PnpmMatcher = @import("./PnpmMatcher.zig");
pub const PostinstallOptimizer = @import("./postinstall_optimizer.zig").PostinstallOptimizer;

pub const ArrayIdentityContext = @import("../identity_context.zig").ArrayIdentityContext;
pub const IdentityContext = @import("../identity_context.zig").IdentityContext;

pub const external = @import("./ExternalSlice.zig");
pub const ExternalPackageNameHashList = external.ExternalPackageNameHashList;
pub const ExternalSlice = external.ExternalSlice;
pub const ExternalStringList = external.ExternalStringList;
pub const ExternalStringMap = external.ExternalStringMap;
pub const VersionSlice = external.VersionSlice;

pub const Dependency = @import("./dependency.zig");
pub const Behavior = @import("./dependency.zig").Behavior;

pub const Lockfile = @import("./lockfile.zig");
pub const PatchedDep = Lockfile.PatchedDep;

pub const patch = @import("./patch_install.zig");
pub const PatchTask = patch.PatchTask;

const string = []const u8;

const std = @import("std");

const bun = @import("bun");
const JSAst = bun.ast;
const default_allocator = bun.default_allocator;

const Semver = bun.Semver;
const String = Semver.String;
