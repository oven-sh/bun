const bun = @import("bun");
const string = bun.string;
const Output = bun.Output;
const Global = bun.Global;
const Environment = bun.Environment;
const strings = bun.strings;
const MutableString = bun.MutableString;
const stringZ = bun.stringZ;
const default_allocator = bun.default_allocator;
const std = @import("std");
const JSC = bun.JSC;
const DirInfo = @import("../resolver/dir_info.zig");
const File = bun.sys.File;
const logger = bun.logger;
const OOM = bun.OOM;
const FD = bun.FD;

const JSON = bun.JSON;
const JSPrinter = bun.js_printer;

const Api = @import("../api/schema.zig").Api;
const Path = bun.path;
const Command = @import("../cli.zig").Command;
const BunArguments = @import("../cli.zig").Arguments;
const transpiler = bun.transpiler;

const DotEnv = @import("../env_loader.zig");
const which = @import("../which.zig").which;
const Run = @import("../bun_js.zig").Run;
const Fs = @import("../fs.zig");
const FileSystem = Fs.FileSystem;
const URL = @import("../url.zig").URL;
const HTTP = bun.http;
const AsyncHTTP = HTTP.AsyncHTTP;

const HeaderBuilder = HTTP.HeaderBuilder;

pub const ExtractTarball = @import("./extract_tarball.zig");
pub const Npm = @import("./npm.zig");
const Syscall = bun.sys;
const RunCommand = @import("../cli/run_command.zig").RunCommand;
threadlocal var initialized_store = false;

pub const Lockfile = @import("./lockfile.zig");
pub const TextLockfile = @import("./lockfile/bun.lock.zig");
pub const PatchedDep = Lockfile.PatchedDep;
const Walker = @import("../walker_skippable.zig");

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

pub const patch = @import("./patch_install.zig");
pub const PatchTask = patch.PatchTask;

// these bytes are skipped
// so we just make it repeat bun bun bun bun bun bun bun bun bun
// because why not
pub const alignment_bytes_to_repeat_buffer = [_]u8{0} ** 144;

const JSAst = bun.JSAst;

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

pub const IdentityContext = @import("../identity_context.zig").IdentityContext;
pub const ArrayIdentityContext = @import("../identity_context.zig").ArrayIdentityContext;
const Semver = bun.Semver;
const ExternalString = Semver.ExternalString;
const String = Semver.String;
const GlobalStringBuilder = bun.StringBuilder;
const SlicedString = Semver.SlicedString;
pub const Repository = @import("./repository.zig").Repository;
pub const Bin = @import("./bin.zig").Bin;
pub const Dependency = @import("./dependency.zig");
pub const Behavior = @import("./dependency.zig").Behavior;
pub const FolderResolution = @import("./resolvers/folder_resolver.zig").FolderResolution;

pub const external = @import("./external.zig");
pub const ExternalSlice = external.ExternalSlice;
pub const ExternalStringMap = external.ExternalStringMap;

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

pub const ExternalStringList = external.ExternalStringList;
pub const ExternalPackageNameHashList = external.ExternalPackageNameHashList;
pub const VersionSlice = external.VersionSlice;

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

pub const NetworkTask = @import("NetworkTask.zig");

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

pub const Task = @import("Task.zig");

pub const ExtractData = struct {
    url: string = "",
    resolved: string = "",
    json: ?struct {
        path: string = "",
        buf: []u8 = "",
    } = null,
};

pub const PackageInstall = @import("./PackageInstall.zig").PackageInstall;

pub const Resolution = @import("./resolution.zig").Resolution;
const Progress = bun.Progress;

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

pub const PackageManifestMap = @import("PackageManifestMap.zig");

// We can't know all the packages we need until we've downloaded all the packages
// The easy way would be:
// 1. Download all packages, parsing their dependencies and enqueuing all dependencies for resolution
// 2.
pub const PackageManager = @import("PackageManager.zig");

const Package = Lockfile.Package;

pub const PackageManifestError = error{
    PackageManifestHTTP400,
    PackageManifestHTTP401,
    PackageManifestHTTP402,
    PackageManifestHTTP403,
    PackageManifestHTTP404,
    PackageManifestHTTP4xx,
    PackageManifestHTTP5xx,
};

pub const LifecycleScriptSubprocess = @import("./lifecycle_script_runner.zig").LifecycleScriptSubprocess;
