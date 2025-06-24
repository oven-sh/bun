// Default to a maximum of 64 simultaneous HTTP requests for bun install if no proxy is specified
// if a proxy IS specified, default to 64. We have different values because we might change this in the future.
// https://github.com/npm/cli/issues/7072
// https://pnpm.io/npmrc#network-concurrency (pnpm defaults to 16)
// https://yarnpkg.com/configuration/yarnrc#networkConcurrency (defaults to 50)
const default_max_simultaneous_requests_for_bun_install = 64;
const default_max_simultaneous_requests_for_bun_install_for_proxies = 64;

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

const ExtractTarball = @import("./extract_tarball.zig");
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

const IdentityContext = @import("../identity_context.zig").IdentityContext;
const ArrayIdentityContext = @import("../identity_context.zig").ArrayIdentityContext;
const NetworkQueue = std.fifo.LinearFifo(*NetworkTask, .{ .Static = 32 });
const PatchTaskFifo = std.fifo.LinearFifo(*PatchTask, .{ .Static = 32 });
const Semver = bun.Semver;
const ExternalString = Semver.ExternalString;
const String = Semver.String;
const GlobalStringBuilder = bun.StringBuilder;
const SlicedString = Semver.SlicedString;
pub const Repository = @import("./repository.zig").Repository;
pub const Bin = @import("./bin.zig").Bin;
pub const Dependency = @import("./dependency.zig");
const Behavior = @import("./dependency.zig").Behavior;
const FolderResolution = @import("./resolvers/folder_resolver.zig").FolderResolution;

pub fn ExternalSlice(comptime Type: type) type {
    return extern struct {
        pub const Slice = @This();

        pub const Child: type = Type;

        off: u32 = 0,
        len: u32 = 0,

        pub const invalid: @This() = .{ .off = std.math.maxInt(u32), .len = std.math.maxInt(u32) };

        pub inline fn isInvalid(this: Slice) bool {
            return this.off == std.math.maxInt(u32) and this.len == std.math.maxInt(u32);
        }

        pub inline fn contains(this: Slice, id: u32) bool {
            return id >= this.off and id < (this.len + this.off);
        }

        pub inline fn get(this: Slice, in: []const Type) []const Type {
            if (comptime Environment.allow_assert) {
                bun.assert(this.off + this.len <= in.len);
            }
            // it should be impossible to address this out of bounds due to the minimum here
            return in.ptr[this.off..@min(in.len, this.off + this.len)];
        }

        pub inline fn mut(this: Slice, in: []Type) []Type {
            if (comptime Environment.allow_assert) {
                bun.assert(this.off + this.len <= in.len);
            }
            return in.ptr[this.off..@min(in.len, this.off + this.len)];
        }

        pub inline fn begin(this: Slice) u32 {
            return this.off;
        }

        pub inline fn end(this: Slice) u32 {
            return this.off + this.len;
        }

        pub fn init(buf: []const Type, in: []const Type) Slice {
            // if (comptime Environment.allow_assert) {
            //     bun.assert(@intFromPtr(buf.ptr) <= @intFromPtr(in.ptr));
            //     bun.assert((@intFromPtr(in.ptr) + in.len) <= (@intFromPtr(buf.ptr) + buf.len));
            // }

            return Slice{
                .off = @as(u32, @truncate((@intFromPtr(in.ptr) - @intFromPtr(buf.ptr)) / @sizeOf(Type))),
                .len = @as(u32, @truncate(in.len)),
            };
        }
    };
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

pub const ExternalStringList = ExternalSlice(ExternalString);
pub const ExternalPackageNameHashList = ExternalSlice(PackageNameHash);
pub const VersionSlice = ExternalSlice(Semver.Version);

pub const ExternalStringMap = extern struct {
    name: ExternalStringList = .{},
    value: ExternalStringList = .{},
};

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

pub const NetworkTask = struct {
    unsafe_http_client: AsyncHTTP = undefined,
    response: bun.http.HTTPClientResult = .{},
    task_id: u64,
    url_buf: []const u8 = &[_]u8{},
    retried: u16 = 0,
    allocator: std.mem.Allocator,
    request_buffer: MutableString = undefined,
    response_buffer: MutableString = undefined,
    package_manager: *PackageManager,
    callback: union(Task.Tag) {
        package_manifest: struct {
            loaded_manifest: ?Npm.PackageManifest = null,
            name: strings.StringOrTinyString,
        },
        extract: ExtractTarball,
        git_clone: void,
        git_checkout: void,
        local_tarball: void,
    },
    /// Key in patchedDependencies in package.json
    apply_patch_task: ?*PatchTask = null,
    next: ?*NetworkTask = null,

    pub const DedupeMapEntry = struct {
        is_required: bool,
    };
    pub const DedupeMap = std.HashMap(u64, DedupeMapEntry, IdentityContext(u64), 80);

    pub fn notify(this: *NetworkTask, async_http: *AsyncHTTP, result: bun.http.HTTPClientResult) void {
        defer this.package_manager.wake();
        async_http.real.?.* = async_http.*;
        async_http.real.?.response_buffer = async_http.response_buffer;
        this.response = result;
        this.package_manager.async_network_task_queue.push(this);
    }

    pub const Authorization = enum {
        no_authorization,
        allow_authorization,
    };

    // We must use a less restrictive Accept header value
    // https://github.com/oven-sh/bun/issues/341
    // https://www.jfrog.com/jira/browse/RTFACT-18398
    const accept_header_value = "application/vnd.npm.install-v1+json; q=1.0, application/json; q=0.8, */*";

    const default_headers_buf: string = "Accept" ++ accept_header_value;

    fn appendAuth(header_builder: *HeaderBuilder, scope: *const Npm.Registry.Scope) void {
        if (scope.token.len > 0) {
            header_builder.appendFmt("Authorization", "Bearer {s}", .{scope.token});
        } else if (scope.auth.len > 0) {
            header_builder.appendFmt("Authorization", "Basic {s}", .{scope.auth});
        } else {
            return;
        }
        header_builder.append("npm-auth-type", "legacy");
    }

    fn countAuth(header_builder: *HeaderBuilder, scope: *const Npm.Registry.Scope) void {
        if (scope.token.len > 0) {
            header_builder.count("Authorization", "");
            header_builder.content.cap += "Bearer ".len + scope.token.len;
        } else if (scope.auth.len > 0) {
            header_builder.count("Authorization", "");
            header_builder.content.cap += "Basic ".len + scope.auth.len;
        } else {
            return;
        }
        header_builder.count("npm-auth-type", "legacy");
    }

    pub fn forManifest(
        this: *NetworkTask,
        name: string,
        allocator: std.mem.Allocator,
        scope: *const Npm.Registry.Scope,
        loaded_manifest: ?*const Npm.PackageManifest,
        is_optional: bool,
    ) !void {
        this.url_buf = blk: {

            // Not all registries support scoped package names when fetching the manifest.
            // registry.npmjs.org supports both "@storybook%2Faddons" and "@storybook/addons"
            // Other registries like AWS codeartifact only support the former.
            // "npm" CLI requests the manifest with the encoded name.
            var arena = std.heap.ArenaAllocator.init(bun.default_allocator);
            defer arena.deinit();
            var stack_fallback_allocator = std.heap.stackFallback(512, arena.allocator());
            var encoded_name = name;
            if (strings.containsChar(name, '/')) {
                encoded_name = try std.mem.replaceOwned(u8, stack_fallback_allocator.get(), name, "/", "%2f");
            }

            const tmp = bun.JSC.URL.join(
                bun.String.fromUTF8(scope.url.href),
                bun.String.fromUTF8(encoded_name),
            );
            defer tmp.deref();

            if (tmp.tag == .Dead) {
                if (!is_optional) {
                    this.package_manager.log.addErrorFmt(
                        null,
                        logger.Loc.Empty,
                        allocator,
                        "Failed to join registry {} and package {} URLs",
                        .{ bun.fmt.QuotedFormatter{ .text = scope.url.href }, bun.fmt.QuotedFormatter{ .text = name } },
                    ) catch bun.outOfMemory();
                } else {
                    this.package_manager.log.addWarningFmt(
                        null,
                        logger.Loc.Empty,
                        allocator,
                        "Failed to join registry {} and package {} URLs",
                        .{ bun.fmt.QuotedFormatter{ .text = scope.url.href }, bun.fmt.QuotedFormatter{ .text = name } },
                    ) catch bun.outOfMemory();
                }
                return error.InvalidURL;
            }

            if (!(tmp.hasPrefixComptime("https://") or tmp.hasPrefixComptime("http://"))) {
                if (!is_optional) {
                    this.package_manager.log.addErrorFmt(
                        null,
                        logger.Loc.Empty,
                        allocator,
                        "Registry URL must be http:// or https://\nReceived: \"{}\"",
                        .{tmp},
                    ) catch bun.outOfMemory();
                } else {
                    this.package_manager.log.addWarningFmt(
                        null,
                        logger.Loc.Empty,
                        allocator,
                        "Registry URL must be http:// or https://\nReceived: \"{}\"",
                        .{tmp},
                    ) catch bun.outOfMemory();
                }
                return error.InvalidURL;
            }

            // This actually duplicates the string! So we defer deref the WTF managed one above.
            break :blk try tmp.toOwnedSlice(allocator);
        };

        var last_modified: string = "";
        var etag: string = "";
        if (loaded_manifest) |manifest| {
            last_modified = manifest.pkg.last_modified.slice(manifest.string_buf);
            etag = manifest.pkg.etag.slice(manifest.string_buf);
        }

        var header_builder = HeaderBuilder{};

        countAuth(&header_builder, scope);

        if (etag.len != 0) {
            header_builder.count("If-None-Match", etag);
        }

        if (last_modified.len != 0) {
            header_builder.count("If-Modified-Since", last_modified);
        }

        if (header_builder.header_count > 0) {
            header_builder.count("Accept", accept_header_value);
            if (last_modified.len > 0 and etag.len > 0) {
                header_builder.content.count(last_modified);
            }
            try header_builder.allocate(allocator);

            appendAuth(&header_builder, scope);

            if (etag.len != 0) {
                header_builder.append("If-None-Match", etag);
            } else if (last_modified.len != 0) {
                header_builder.append("If-Modified-Since", last_modified);
            }

            header_builder.append("Accept", accept_header_value);

            if (last_modified.len > 0 and etag.len > 0) {
                last_modified = header_builder.content.append(last_modified);
            }
        } else {
            try header_builder.entries.append(
                allocator,
                .{
                    .name = .{ .offset = 0, .length = @as(u32, @truncate("Accept".len)) },
                    .value = .{ .offset = "Accept".len, .length = @as(u32, @truncate(default_headers_buf.len - "Accept".len)) },
                },
            );
            header_builder.header_count = 1;
            header_builder.content = GlobalStringBuilder{ .ptr = @as([*]u8, @ptrFromInt(@intFromPtr(bun.span(default_headers_buf).ptr))), .len = default_headers_buf.len, .cap = default_headers_buf.len };
        }

        this.response_buffer = try MutableString.init(allocator, 0);
        this.allocator = allocator;

        const url = URL.parse(this.url_buf);
        this.unsafe_http_client = AsyncHTTP.init(allocator, .GET, url, header_builder.entries, header_builder.content.ptr.?[0..header_builder.content.len], &this.response_buffer, "", this.getCompletionCallback(), HTTP.FetchRedirect.follow, .{
            .http_proxy = this.package_manager.httpProxy(url),
        });
        this.unsafe_http_client.client.flags.reject_unauthorized = this.package_manager.tlsRejectUnauthorized();

        if (PackageManager.verbose_install) {
            this.unsafe_http_client.client.verbose = .headers;
        }

        this.callback = .{
            .package_manifest = .{
                .name = try strings.StringOrTinyString.initAppendIfNeeded(name, *FileSystem.FilenameStore, FileSystem.FilenameStore.instance),
                .loaded_manifest = if (loaded_manifest) |manifest| manifest.* else null,
            },
        };

        if (PackageManager.verbose_install) {
            this.unsafe_http_client.verbose = .headers;
            this.unsafe_http_client.client.verbose = .headers;
        }

        // Incase the ETag causes invalidation, we fallback to the last modified date.
        if (last_modified.len != 0 and bun.getRuntimeFeatureFlag(.BUN_FEATURE_FLAG_LAST_MODIFIED_PRETEND_304)) {
            this.unsafe_http_client.client.flags.force_last_modified = true;
            this.unsafe_http_client.client.if_modified_since = last_modified;
        }
    }

    pub fn getCompletionCallback(this: *NetworkTask) HTTP.HTTPClientResult.Callback {
        return HTTP.HTTPClientResult.Callback.New(*NetworkTask, notify).init(this);
    }

    pub fn schedule(this: *NetworkTask, batch: *ThreadPool.Batch) void {
        this.unsafe_http_client.schedule(this.allocator, batch);
    }

    pub const ForTarballError = OOM || error{
        InvalidURL,
    };

    pub fn forTarball(
        this: *NetworkTask,
        allocator: std.mem.Allocator,
        tarball_: *const ExtractTarball,
        scope: *const Npm.Registry.Scope,
        authorization: NetworkTask.Authorization,
    ) ForTarballError!void {
        this.callback = .{ .extract = tarball_.* };
        const tarball = &this.callback.extract;
        const tarball_url = tarball.url.slice();
        if (tarball_url.len == 0) {
            this.url_buf = try ExtractTarball.buildURL(
                scope.url.href,
                tarball.name,
                tarball.resolution.value.npm.version,
                this.package_manager.lockfile.buffers.string_bytes.items,
            );
        } else {
            this.url_buf = tarball_url;
        }

        if (!(strings.hasPrefixComptime(this.url_buf, "https://") or strings.hasPrefixComptime(this.url_buf, "http://"))) {
            const msg = .{
                .fmt = "Expected tarball URL to start with https:// or http://, got {} while fetching package {}",
                .args = .{ bun.fmt.QuotedFormatter{ .text = this.url_buf }, bun.fmt.QuotedFormatter{ .text = tarball.name.slice() } },
            };

            try this.package_manager.log.addErrorFmt(null, .{}, allocator, msg.fmt, msg.args);
            return error.InvalidURL;
        }

        this.response_buffer = MutableString.initEmpty(allocator);
        this.allocator = allocator;

        var header_builder = HeaderBuilder{};
        var header_buf: string = "";

        if (authorization == .allow_authorization) {
            countAuth(&header_builder, scope);
        }

        if (header_builder.header_count > 0) {
            try header_builder.allocate(allocator);

            if (authorization == .allow_authorization) {
                appendAuth(&header_builder, scope);
            }

            header_buf = header_builder.content.ptr.?[0..header_builder.content.len];
        }

        const url = URL.parse(this.url_buf);

        this.unsafe_http_client = AsyncHTTP.init(allocator, .GET, url, header_builder.entries, header_buf, &this.response_buffer, "", this.getCompletionCallback(), HTTP.FetchRedirect.follow, .{
            .http_proxy = this.package_manager.httpProxy(url),
        });
        this.unsafe_http_client.client.flags.reject_unauthorized = this.package_manager.tlsRejectUnauthorized();
        if (PackageManager.verbose_install) {
            this.unsafe_http_client.client.verbose = .headers;
        }
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

/// Schedule long-running callbacks for a task
/// Slow stuff is broken into tasks, each can run independently without locks
pub const Task = struct {
    tag: Tag,
    request: Request,
    data: Data,
    status: Status = Status.waiting,
    threadpool_task: ThreadPool.Task = ThreadPool.Task{ .callback = &callback },
    log: logger.Log,
    id: u64,
    err: ?anyerror = null,
    package_manager: *PackageManager,
    apply_patch_task: ?*PatchTask = null,
    next: ?*Task = null,

    /// An ID that lets us register a callback without keeping the same pointer around
    pub fn NewID(comptime Hasher: type, comptime IDType: type) type {
        return struct {
            pub const Type = IDType;
            pub fn forNPMPackage(package_name: string, package_version: Semver.Version) IDType {
                var hasher = Hasher.init(0);
                hasher.update("npm-package:");
                hasher.update(package_name);
                hasher.update("@");
                hasher.update(std.mem.asBytes(&package_version));
                return hasher.final();
            }

            pub fn forBinLink(package_id: PackageID) IDType {
                var hasher = Hasher.init(0);
                hasher.update("bin-link:");
                hasher.update(std.mem.asBytes(&package_id));
                return hasher.final();
            }

            pub fn forManifest(name: string) IDType {
                var hasher = Hasher.init(0);
                hasher.update("manifest:");
                hasher.update(name);
                return hasher.final();
            }

            pub fn forTarball(url: string) IDType {
                var hasher = Hasher.init(0);
                hasher.update("tarball:");
                hasher.update(url);
                return hasher.final();
            }

            // These cannot change:
            // We persist them to the filesystem.
            pub fn forGitClone(url: string) IDType {
                var hasher = Hasher.init(0);
                hasher.update(url);
                return @as(u64, 4 << 61) | @as(u64, @as(u61, @truncate(hasher.final())));
            }

            pub fn forGitCheckout(url: string, resolved: string) IDType {
                var hasher = Hasher.init(0);
                hasher.update(url);
                hasher.update("@");
                hasher.update(resolved);
                return @as(u64, 5 << 61) | @as(u64, @as(u61, @truncate(hasher.final())));
            }
        };
    }
    pub const Id = NewID(bun.Wyhash11, u64);

    pub fn callback(task: *ThreadPool.Task) void {
        Output.Source.configureThread();
        defer Output.flush();

        var this: *Task = @fieldParentPtr("threadpool_task", task);
        const manager = this.package_manager;
        defer {
            if (this.status == .success) {
                if (this.apply_patch_task) |pt| {
                    defer pt.deinit();
                    pt.apply() catch bun.outOfMemory();
                    if (pt.callback.apply.logger.errors > 0) {
                        defer pt.callback.apply.logger.deinit();
                        // this.log.addErrorFmt(null, logger.Loc.Empty, bun.default_allocator, "failed to apply patch: {}", .{e}) catch unreachable;
                        pt.callback.apply.logger.print(Output.errorWriter()) catch {};
                    }
                }
            }
            manager.resolve_tasks.push(this);
            manager.wake();
        }

        switch (this.tag) {
            .package_manifest => {
                const allocator = bun.default_allocator;
                var manifest = &this.request.package_manifest;
                const body = manifest.network.response_buffer.move();

                defer {
                    bun.default_allocator.free(body);
                }

                const package_manifest = Npm.Registry.getPackageMetadata(
                    allocator,
                    manager.scopeForPackageName(manifest.name.slice()),
                    (manifest.network.response.metadata orelse @panic("Assertion failure: Expected metadata to be set")).response,
                    body,
                    &this.log,
                    manifest.name.slice(),
                    manifest.network.callback.package_manifest.loaded_manifest,
                    manager,
                ) catch |err| {
                    bun.handleErrorReturnTrace(err, @errorReturnTrace());

                    this.err = err;
                    this.status = Status.fail;
                    this.data = .{ .package_manifest = .{} };
                    return;
                };

                switch (package_manifest) {
                    .fresh, .cached => |result| {
                        this.status = Status.success;
                        this.data = .{ .package_manifest = result };
                        return;
                    },
                    .not_found => {
                        this.log.addErrorFmt(null, logger.Loc.Empty, allocator, "404 - GET {s}", .{
                            this.request.package_manifest.name.slice(),
                        }) catch unreachable;
                        this.status = Status.fail;
                        this.data = .{ .package_manifest = .{} };
                        return;
                    },
                }
            },
            .extract => {
                const bytes = this.request.extract.network.response_buffer.move();

                defer {
                    bun.default_allocator.free(bytes);
                }

                const result = this.request.extract.tarball.run(
                    &this.log,
                    bytes,
                ) catch |err| {
                    bun.handleErrorReturnTrace(err, @errorReturnTrace());

                    this.err = err;
                    this.status = Status.fail;
                    this.data = .{ .extract = .{} };
                    return;
                };

                this.data = .{ .extract = result };
                this.status = Status.success;
            },
            .git_clone => {
                const name = this.request.git_clone.name.slice();
                const url = this.request.git_clone.url.slice();
                var attempt: u8 = 1;
                const dir = brk: {
                    if (Repository.tryHTTPS(url)) |https| break :brk Repository.download(
                        manager.allocator,
                        this.request.git_clone.env,
                        &this.log,
                        manager.getCacheDirectory(),
                        this.id,
                        name,
                        https,
                        attempt,
                    ) catch |err| {
                        // Exit early if git checked and could
                        // not find the repository, skip ssh
                        if (err == error.RepositoryNotFound) {
                            this.err = err;
                            this.status = Status.fail;
                            this.data = .{ .git_clone = bun.invalid_fd };

                            return;
                        }

                        this.err = err;
                        this.status = Status.fail;
                        this.data = .{ .git_clone = bun.invalid_fd };
                        attempt += 1;
                        break :brk null;
                    };
                    break :brk null;
                } orelse if (Repository.trySSH(url)) |ssh| Repository.download(
                    manager.allocator,
                    this.request.git_clone.env,
                    &this.log,
                    manager.getCacheDirectory(),
                    this.id,
                    name,
                    ssh,
                    attempt,
                ) catch |err| {
                    this.err = err;
                    this.status = Status.fail;
                    this.data = .{ .git_clone = bun.invalid_fd };
                    return;
                } else {
                    return;
                };

                this.err = null;
                this.data = .{ .git_clone = .fromStdDir(dir) };
                this.status = Status.success;
            },
            .git_checkout => {
                const git_checkout = &this.request.git_checkout;
                const data = Repository.checkout(
                    manager.allocator,
                    this.request.git_checkout.env,
                    &this.log,
                    manager.getCacheDirectory(),
                    git_checkout.repo_dir.stdDir(),
                    git_checkout.name.slice(),
                    git_checkout.url.slice(),
                    git_checkout.resolved.slice(),
                ) catch |err| {
                    this.err = err;
                    this.status = Status.fail;
                    this.data = .{ .git_checkout = .{} };

                    return;
                };

                this.data = .{
                    .git_checkout = data,
                };
                this.status = Status.success;
            },
            .local_tarball => {
                const workspace_pkg_id = manager.lockfile.getWorkspacePkgIfWorkspaceDep(this.request.local_tarball.tarball.dependency_id);

                var abs_buf: bun.PathBuffer = undefined;
                const tarball_path, const normalize = if (workspace_pkg_id != invalid_package_id) tarball_path: {
                    const workspace_res = manager.lockfile.packages.items(.resolution)[workspace_pkg_id];

                    if (workspace_res.tag != .workspace) break :tarball_path .{ this.request.local_tarball.tarball.url.slice(), true };

                    // Construct an absolute path to the tarball.
                    // Normally tarball paths are always relative to the root directory, but if a
                    // workspace depends on a tarball path, it should be relative to the workspace.
                    const workspace_path = workspace_res.value.workspace.slice(manager.lockfile.buffers.string_bytes.items);
                    break :tarball_path .{
                        Path.joinAbsStringBuf(
                            FileSystem.instance.top_level_dir,
                            &abs_buf,
                            &[_][]const u8{
                                workspace_path,
                                this.request.local_tarball.tarball.url.slice(),
                            },
                            .auto,
                        ),
                        false,
                    };
                } else .{ this.request.local_tarball.tarball.url.slice(), true };

                const result = readAndExtract(
                    manager.allocator,
                    &this.request.local_tarball.tarball,
                    tarball_path,
                    normalize,
                    &this.log,
                ) catch |err| {
                    bun.handleErrorReturnTrace(err, @errorReturnTrace());

                    this.err = err;
                    this.status = Status.fail;
                    this.data = .{ .extract = .{} };

                    return;
                };

                this.data = .{ .extract = result };
                this.status = Status.success;
            },
        }
    }

    fn readAndExtract(
        allocator: std.mem.Allocator,
        tarball: *const ExtractTarball,
        tarball_path: string,
        normalize: bool,
        log: *logger.Log,
    ) !ExtractData {
        const bytes = if (normalize)
            try File.readFromUserInput(std.fs.cwd(), tarball_path, allocator).unwrap()
        else
            try File.readFrom(bun.FD.cwd(), tarball_path, allocator).unwrap();
        defer allocator.free(bytes);
        return tarball.run(log, bytes);
    }

    pub const Tag = enum(u3) {
        package_manifest = 0,
        extract = 1,
        git_clone = 2,
        git_checkout = 3,
        local_tarball = 4,
    };

    pub const Status = enum {
        waiting,
        success,
        fail,
    };

    pub const Data = union {
        package_manifest: Npm.PackageManifest,
        extract: ExtractData,
        git_clone: bun.FileDescriptor,
        git_checkout: ExtractData,
    };

    pub const Request = union {
        /// package name
        // todo: Registry URL
        package_manifest: struct {
            name: strings.StringOrTinyString,
            network: *NetworkTask,
        },
        extract: struct {
            network: *NetworkTask,
            tarball: ExtractTarball,
        },
        git_clone: struct {
            name: strings.StringOrTinyString,
            url: strings.StringOrTinyString,
            env: DotEnv.Map,
            dep_id: DependencyID,
            res: Resolution,
        },
        git_checkout: struct {
            repo_dir: bun.FileDescriptor,
            dependency_id: DependencyID,
            name: strings.StringOrTinyString,
            url: strings.StringOrTinyString,
            resolved: strings.StringOrTinyString,
            resolution: Resolution,
            env: DotEnv.Map,
        },
        local_tarball: struct {
            tarball: ExtractTarball,
        },
    };
};

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

const TaskCallbackList = std.ArrayListUnmanaged(TaskCallbackContext);
const TaskDependencyQueue = std.HashMapUnmanaged(u64, TaskCallbackList, IdentityContext(u64), 80);

const PreallocatedTaskStore = bun.HiveArray(Task, 64).Fallback;
const PreallocatedNetworkTasks = bun.HiveArray(NetworkTask, 128).Fallback;
const ResolveTaskQueue = bun.UnboundedQueue(Task, .next);

const ThreadPool = bun.ThreadPool;
const RepositoryMap = std.HashMapUnmanaged(u64, bun.FileDescriptor, IdentityContext(u64), 80);
const NpmAliasMap = std.HashMapUnmanaged(PackageNameHash, Dependency.Version, IdentityContext(u64), 80);

const PackageManifestMap = struct {
    hash_map: HashMap = .{},

    const Value = union(enum) {
        expired: Npm.PackageManifest,
        manifest: Npm.PackageManifest,

        // Avoid checking the filesystem again.
        not_found: void,
    };
    const HashMap = std.HashMapUnmanaged(PackageNameHash, Value, IdentityContext(PackageNameHash), 80);

    pub fn byName(this: *PackageManifestMap, pm: *PackageManager, scope: *const Npm.Registry.Scope, name: []const u8, cache_behavior: CacheBehavior) ?*Npm.PackageManifest {
        return this.byNameHash(pm, scope, String.Builder.stringHash(name), cache_behavior);
    }

    pub fn insert(this: *PackageManifestMap, name_hash: PackageNameHash, manifest: *const Npm.PackageManifest) !void {
        try this.hash_map.put(bun.default_allocator, name_hash, .{ .manifest = manifest.* });
    }

    pub fn byNameHash(this: *PackageManifestMap, pm: *PackageManager, scope: *const Npm.Registry.Scope, name_hash: PackageNameHash, cache_behavior: CacheBehavior) ?*Npm.PackageManifest {
        return byNameHashAllowExpired(this, pm, scope, name_hash, null, cache_behavior);
    }

    pub fn byNameAllowExpired(this: *PackageManifestMap, pm: *PackageManager, scope: *const Npm.Registry.Scope, name: string, is_expired: ?*bool, cache_behavior: CacheBehavior) ?*Npm.PackageManifest {
        return byNameHashAllowExpired(this, pm, scope, String.Builder.stringHash(name), is_expired, cache_behavior);
    }

    pub const CacheBehavior = enum {
        load_from_memory,
        load_from_memory_fallback_to_disk,
    };

    pub fn byNameHashAllowExpired(
        this: *PackageManifestMap,
        pm: *PackageManager,
        scope: *const Npm.Registry.Scope,
        name_hash: PackageNameHash,
        is_expired: ?*bool,
        cache_behavior: CacheBehavior,
    ) ?*Npm.PackageManifest {
        if (cache_behavior == .load_from_memory) {
            const entry = this.hash_map.getPtr(name_hash) orelse return null;
            return switch (entry.*) {
                .manifest => &entry.manifest,
                .expired => if (is_expired) |expiry| {
                    expiry.* = true;
                    return &entry.expired;
                } else null,
                .not_found => null,
            };
        }

        const entry = this.hash_map.getOrPut(bun.default_allocator, name_hash) catch bun.outOfMemory();
        if (entry.found_existing) {
            if (entry.value_ptr.* == .manifest) {
                return &entry.value_ptr.manifest;
            }

            if (is_expired) |expiry| {
                if (entry.value_ptr.* == .expired) {
                    expiry.* = true;
                    return &entry.value_ptr.expired;
                }
            }

            return null;
        }

        if (pm.options.enable.manifest_cache) {
            if (Npm.PackageManifest.Serializer.loadByFileID(
                pm.allocator,
                scope,
                pm.getCacheDirectory(),
                name_hash,
            ) catch null) |manifest| {
                if (pm.options.enable.manifest_cache_control and manifest.pkg.public_max_age > pm.timestamp_for_manifest_cache_control) {
                    entry.value_ptr.* = .{ .manifest = manifest };
                    return &entry.value_ptr.manifest;
                } else {
                    entry.value_ptr.* = .{ .expired = manifest };

                    if (is_expired) |expiry| {
                        expiry.* = true;
                        return &entry.value_ptr.expired;
                    }

                    return null;
                }
            }
        }

        entry.value_ptr.* = .{ .not_found = {} };
        return null;
    }
};

// We can't know all the packages we need until we've downloaded all the packages
// The easy way would be:
// 1. Download all packages, parsing their dependencies and enqueuing all dependencies for resolution
// 2.
pub const PackageManager = struct {
    cache_directory_: ?std.fs.Dir = null,

    // TODO(dylan-conway): remove this field when we move away from `std.ChildProcess` in repository.zig
    cache_directory_path: stringZ = "",
    temp_dir_: ?std.fs.Dir = null,
    temp_dir_path: stringZ = "",
    temp_dir_name: string = "",
    root_dir: *Fs.FileSystem.DirEntry,
    allocator: std.mem.Allocator,
    log: *logger.Log,
    resolve_tasks: ResolveTaskQueue = .{},
    timestamp_for_manifest_cache_control: u32 = 0,
    extracted_count: u32 = 0,
    default_features: Features = .{},
    summary: Lockfile.Package.Diff.Summary = .{},
    env: *DotEnv.Loader,
    progress: Progress = .{},
    downloads_node: ?*Progress.Node = null,
    scripts_node: ?*Progress.Node = null,
    progress_name_buf: [768]u8 = undefined,
    progress_name_buf_dynamic: []u8 = &[_]u8{},
    cpu_count: u32 = 0,

    track_installed_bin: TrackInstalledBin = .{
        .none = {},
    },

    // progress bar stuff when not stack allocated
    root_progress_node: *Progress.Node = undefined,

    to_update: bool = false,

    subcommand: Subcommand,
    update_requests: []UpdateRequest = &[_]UpdateRequest{},

    /// Only set in `bun pm`
    root_package_json_name_at_time_of_init: []const u8 = "",

    root_package_json_file: std.fs.File,

    /// The package id corresponding to the workspace the install is happening in. Could be root, or
    /// could be any of the workspaces.
    root_package_id: struct {
        id: ?PackageID = null,
        pub fn get(this: *@This(), lockfile: *const Lockfile, workspace_name_hash: ?PackageNameHash) PackageID {
            return this.id orelse {
                this.id = lockfile.getWorkspacePackageID(workspace_name_hash);
                return this.id.?;
            };
        }
    } = .{},

    thread_pool: ThreadPool,
    task_batch: ThreadPool.Batch = .{},
    task_queue: TaskDependencyQueue = .{},

    manifests: PackageManifestMap = .{},
    folders: FolderResolution.Map = .{},
    git_repositories: RepositoryMap = .{},

    network_dedupe_map: NetworkTask.DedupeMap = NetworkTask.DedupeMap.init(bun.default_allocator),
    async_network_task_queue: AsyncNetworkTaskQueue = .{},
    network_tarball_batch: ThreadPool.Batch = .{},
    network_resolve_batch: ThreadPool.Batch = .{},
    network_task_fifo: NetworkQueue = undefined,
    patch_apply_batch: ThreadPool.Batch = .{},
    patch_calc_hash_batch: ThreadPool.Batch = .{},
    patch_task_fifo: PatchTaskFifo = PatchTaskFifo.init(),
    patch_task_queue: PatchTaskQueue = .{},
    /// We actually need to calculate the patch file hashes
    /// every single time, because someone could edit the patchfile at anytime
    pending_pre_calc_hashes: std.atomic.Value(u32) = std.atomic.Value(u32).init(0),
    pending_tasks: std.atomic.Value(u32) = std.atomic.Value(u32).init(0),
    total_tasks: u32 = 0,
    preallocated_network_tasks: PreallocatedNetworkTasks,
    preallocated_resolve_tasks: PreallocatedTaskStore,

    /// items are only inserted into this if they took more than 500ms
    lifecycle_script_time_log: LifecycleScriptTimeLog = .{},

    pending_lifecycle_script_tasks: std.atomic.Value(u32) = std.atomic.Value(u32).init(0),
    finished_installing: std.atomic.Value(bool) = std.atomic.Value(bool).init(false),
    total_scripts: usize = 0,

    root_lifecycle_scripts: ?Package.Scripts.List = null,

    node_gyp_tempdir_name: string = "",

    env_configure: ?ScriptRunEnvironment = null,

    lockfile: *Lockfile = undefined,

    options: Options,
    preinstall_state: std.ArrayListUnmanaged(PreinstallState) = .{},

    global_link_dir: ?std.fs.Dir = null,
    global_dir: ?std.fs.Dir = null,
    global_link_dir_path: string = "",
    wait_count: std.atomic.Value(usize) = std.atomic.Value(usize).init(0),

    onWake: WakeHandler = .{},
    ci_mode: bun.LazyBool(computeIsContinuousIntegration, @This(), "ci_mode") = .{},

    peer_dependencies: std.fifo.LinearFifo(DependencyID, .Dynamic) = std.fifo.LinearFifo(DependencyID, .Dynamic).init(default_allocator),

    // name hash from alias package name -> aliased package dependency version info
    known_npm_aliases: NpmAliasMap = .{},

    event_loop: JSC.AnyEventLoop,

    // During `installPackages` we learn exactly what dependencies from --trust
    // actually have scripts to run, and we add them to this list
    trusted_deps_to_add_to_package_json: std.ArrayListUnmanaged(string) = .{},

    any_failed_to_install: bool = false,

    // When adding a `file:` dependency in a workspace package, we want to install it
    // relative to the workspace root, but the path provided is relative to the
    // workspace package. We keep track of the original here.
    original_package_json_path: stringZ,

    // null means root. Used during `cleanWithLogger` to identifier which
    // workspace is adding/removing packages
    workspace_name_hash: ?PackageNameHash = null,

    workspace_package_json_cache: WorkspacePackageJSONCache = .{},

    // normally we have `UpdateRequests` to work with for adding/deleting/updating packages, but
    // if `bun update` is used without any package names we need a way to keep information for
    // the original packages that are updating.
    //
    // dependency name -> original version information
    updating_packages: bun.StringArrayHashMapUnmanaged(PackageUpdateInfo) = .{},

    patched_dependencies_to_remove: std.ArrayHashMapUnmanaged(PackageNameAndVersionHash, void, ArrayIdentityContext.U64, false) = .{},

    active_lifecycle_scripts: LifecycleScriptSubprocess.List,
    last_reported_slow_lifecycle_script_at: u64 = 0,
    cached_tick_for_slow_lifecycle_script_logging: u64 = 0,

    pub const WorkspaceFilter = union(enum) {
        all,
        name: []const u8,
        path: []const u8,

        pub fn init(allocator: std.mem.Allocator, input: string, cwd: string, path_buf: []u8) OOM!WorkspaceFilter {
            if ((input.len == 1 and input[0] == '*') or strings.eqlComptime(input, "**")) {
                return .all;
            }

            var remain = input;

            var prepend_negate = false;
            while (remain.len > 0 and remain[0] == '!') {
                prepend_negate = !prepend_negate;
                remain = remain[1..];
            }

            const is_path = remain.len > 0 and remain[0] == '.';

            const filter = if (is_path)
                strings.withoutTrailingSlash(bun.path.joinAbsStringBuf(cwd, path_buf, &.{remain}, .posix))
            else
                remain;

            if (filter.len == 0) {
                // won't match anything
                return .{ .path = &.{} };
            }
            const copy_start = @intFromBool(prepend_negate);
            const copy_end = copy_start + filter.len;

            const buf = try allocator.alloc(u8, copy_end);
            @memcpy(buf[copy_start..copy_end], filter);

            if (prepend_negate) {
                buf[0] = '!';
            }

            const pattern = buf[0..copy_end];

            return if (is_path)
                .{ .path = pattern }
            else
                .{ .name = pattern };
        }

        pub fn deinit(this: WorkspaceFilter, allocator: std.mem.Allocator) void {
            switch (this) {
                .name,
                .path,
                => |pattern| allocator.free(pattern),
                .all => {},
            }
        }
    };

    pub const Options = @import("./PackageManager/PackageManagerOptions.zig");

    pub fn reportSlowLifecycleScripts(this: *PackageManager) void {
        const log_level = this.options.log_level;
        if (log_level == .silent) return;
        if (bun.getRuntimeFeatureFlag(.BUN_DISABLE_SLOW_LIFECYCLE_SCRIPT_LOGGING)) {
            return;
        }

        if (this.active_lifecycle_scripts.peek()) |active_lifecycle_script_running_for_the_longest_amount_of_time| {
            if (this.cached_tick_for_slow_lifecycle_script_logging == this.event_loop.iterationNumber()) {
                return;
            }
            this.cached_tick_for_slow_lifecycle_script_logging = this.event_loop.iterationNumber();
            const current_time = bun.timespec.now().ns();
            const time_running = current_time -| active_lifecycle_script_running_for_the_longest_amount_of_time.started_at;
            const interval: u64 = if (log_level.isVerbose()) std.time.ns_per_s * 5 else std.time.ns_per_s * 30;
            if (time_running > interval and current_time -| this.last_reported_slow_lifecycle_script_at > interval) {
                this.last_reported_slow_lifecycle_script_at = current_time;
                const package_name = active_lifecycle_script_running_for_the_longest_amount_of_time.package_name;

                if (!(package_name.len > 1 and package_name[package_name.len - 1] == 's')) {
                    Output.warn("{s}'s postinstall cost you {}\n", .{
                        package_name,
                        bun.fmt.fmtDurationOneDecimal(time_running),
                    });
                } else {
                    Output.warn("{s}' postinstall cost you {}\n", .{
                        package_name,
                        bun.fmt.fmtDurationOneDecimal(time_running),
                    });
                }
                Output.flush();
            }
        }
    }

    pub const PackageUpdateInfo = struct {
        original_version_literal: string,
        is_alias: bool,
        original_version_string_buf: string = "",
        original_version: ?Semver.Version,
    };

    pub fn clearCachedItemsDependingOnLockfileBuffer(this: *PackageManager) void {
        this.root_package_id.id = null;
    }

    pub fn crash(this: *PackageManager) noreturn {
        if (this.options.log_level != .silent) {
            this.log.print(Output.errorWriter()) catch {};
        }
        Global.crash();
    }

    const TrackInstalledBin = union(enum) {
        none: void,
        pending: void,
        basename: []const u8,
    };

    // maybe rename to `PackageJSONCache` if we cache more than workspaces
    pub const WorkspacePackageJSONCache = struct {
        const js_ast = bun.JSAst;
        const Expr = js_ast.Expr;

        pub const MapEntry = struct {
            root: Expr,
            source: logger.Source,
            indentation: JSPrinter.Options.Indentation = .{},
        };

        pub const Map = bun.StringHashMapUnmanaged(MapEntry);

        pub const GetJSONOptions = struct {
            init_reset_store: bool = true,
            guess_indentation: bool = false,
        };

        pub const GetResult = union(enum) {
            entry: *MapEntry,
            read_err: anyerror,
            parse_err: anyerror,

            pub fn unwrap(this: GetResult) !*MapEntry {
                return switch (this) {
                    .entry => |entry| entry,
                    inline else => |err| err,
                };
            }
        };

        map: Map = .{},

        /// Given an absolute path to a workspace package.json, return the AST
        /// and contents of the file. If the package.json is not present in the
        /// cache, it will be read from disk and parsed, and stored in the cache.
        pub fn getWithPath(
            this: *@This(),
            allocator: std.mem.Allocator,
            log: *logger.Log,
            abs_package_json_path: anytype,
            comptime opts: GetJSONOptions,
        ) GetResult {
            bun.assertWithLocation(std.fs.path.isAbsolute(abs_package_json_path), @src());

            var buf: if (Environment.isWindows) bun.PathBuffer else void = undefined;
            const path = if (comptime !Environment.isWindows)
                abs_package_json_path
            else brk: {
                @memcpy(buf[0..abs_package_json_path.len], abs_package_json_path);
                bun.path.dangerouslyConvertPathToPosixInPlace(u8, buf[0..abs_package_json_path.len]);
                break :brk buf[0..abs_package_json_path.len];
            };

            const entry = this.map.getOrPut(allocator, path) catch bun.outOfMemory();
            if (entry.found_existing) {
                return .{ .entry = entry.value_ptr };
            }

            const key = allocator.dupeZ(u8, path) catch bun.outOfMemory();
            entry.key_ptr.* = key;

            const source = &(bun.sys.File.toSource(key, allocator, .{}).unwrap() catch |err| {
                _ = this.map.remove(key);
                allocator.free(key);
                return .{ .read_err = err };
            });

            if (comptime opts.init_reset_store)
                initializeStore();

            const json = JSON.parsePackageJSONUTF8WithOpts(
                source,
                log,
                allocator,
                .{
                    .is_json = true,
                    .allow_comments = true,
                    .allow_trailing_commas = true,
                    .guess_indentation = opts.guess_indentation,
                },
            ) catch |err| {
                _ = this.map.remove(key);
                allocator.free(source.contents);
                allocator.free(key);
                bun.handleErrorReturnTrace(err, @errorReturnTrace());
                return .{ .parse_err = err };
            };

            entry.value_ptr.* = .{
                .root = json.root.deepClone(bun.default_allocator) catch bun.outOfMemory(),
                .source = source.*,
                .indentation = json.indentation,
            };

            return .{ .entry = entry.value_ptr };
        }

        /// source path is used as the key, needs to be absolute
        pub fn getWithSource(
            this: *@This(),
            allocator: std.mem.Allocator,
            log: *logger.Log,
            source: *const logger.Source,
            comptime opts: GetJSONOptions,
        ) GetResult {
            bun.assertWithLocation(std.fs.path.isAbsolute(source.path.text), @src());

            var buf: if (Environment.isWindows) bun.PathBuffer else void = undefined;
            const path = if (comptime !Environment.isWindows)
                source.path.text
            else brk: {
                @memcpy(buf[0..source.path.text.len], source.path.text);
                bun.path.dangerouslyConvertPathToPosixInPlace(u8, buf[0..source.path.text.len]);
                break :brk buf[0..source.path.text.len];
            };

            const entry = this.map.getOrPut(allocator, path) catch bun.outOfMemory();
            if (entry.found_existing) {
                return .{ .entry = entry.value_ptr };
            }

            if (comptime opts.init_reset_store)
                initializeStore();

            const json_result = JSON.parsePackageJSONUTF8WithOpts(
                source,
                log,
                allocator,
                .{
                    .is_json = true,
                    .allow_comments = true,
                    .allow_trailing_commas = true,
                    .guess_indentation = opts.guess_indentation,
                },
            );

            const json = json_result catch |err| {
                _ = this.map.remove(path);
                return .{ .parse_err = err };
            };

            entry.value_ptr.* = .{
                .root = json.root.deepClone(allocator) catch bun.outOfMemory(),
                .source = source.*,
                .indentation = json.indentation,
            };

            entry.key_ptr.* = allocator.dupe(u8, path) catch bun.outOfMemory();

            return .{ .entry = entry.value_ptr };
        }
    };

    pub var verbose_install = false;

    pub const PatchTaskQueue = bun.UnboundedQueue(PatchTask, .next);
    pub const AsyncNetworkTaskQueue = bun.UnboundedQueue(NetworkTask, .next);

    pub const ScriptRunEnvironment = struct {
        root_dir_info: *DirInfo,
        transpiler: bun.Transpiler,
    };

    const TimePasser = struct {
        pub var last_time: u64 = 0;
    };

    pub const LifecycleScriptTimeLog = struct {
        const Entry = struct {
            package_name: string,
            script_id: u8,

            // nanosecond duration
            duration: u64,
        };

        mutex: bun.Mutex = .{},
        list: std.ArrayListUnmanaged(Entry) = .{},

        pub fn appendConcurrent(log: *LifecycleScriptTimeLog, allocator: std.mem.Allocator, entry: Entry) void {
            log.mutex.lock();
            defer log.mutex.unlock();
            log.list.append(allocator, entry) catch bun.outOfMemory();
        }

        /// this can be called if .start was never called
        pub fn printAndDeinit(log: *LifecycleScriptTimeLog, allocator: std.mem.Allocator) void {
            if (Environment.isDebug) {
                if (!log.mutex.tryLock()) @panic("LifecycleScriptTimeLog.print is not intended to be thread-safe");
                log.mutex.unlock();
            }

            if (log.list.items.len > 0) {
                const longest: Entry = longest: {
                    var i: usize = 0;
                    var longest: u64 = log.list.items[0].duration;
                    for (log.list.items[1..], 1..) |item, j| {
                        if (item.duration > longest) {
                            i = j;
                            longest = item.duration;
                        }
                    }
                    break :longest log.list.items[i];
                };

                // extra \n will print a blank line after this one
                Output.warn("{s}'s {s} script took {}\n\n", .{
                    longest.package_name,
                    Lockfile.Scripts.names[longest.script_id],
                    bun.fmt.fmtDurationOneDecimal(longest.duration),
                });
                Output.flush();
            }
            log.list.deinit(allocator);
        }
    };

    pub fn hasEnoughTimePassedBetweenWaitingMessages() bool {
        const iter = get().event_loop.loop().iterationNumber();
        if (TimePasser.last_time < iter) {
            TimePasser.last_time = iter;
            return true;
        }

        return false;
    }

    pub fn configureEnvForScripts(this: *PackageManager, ctx: Command.Context, log_level: Options.LogLevel) !*transpiler.Transpiler {
        if (this.env_configure) |*env_configure| {
            return &env_configure.transpiler;
        }

        // We need to figure out the PATH and other environment variables
        // to do that, we re-use the code from bun run
        // this is expensive, it traverses the entire directory tree going up to the root
        // so we really only want to do it when strictly necessary
        this.env_configure = .{
            .root_dir_info = undefined,
            .transpiler = undefined,
        };
        const this_transpiler: *transpiler.Transpiler = &this.env_configure.?.transpiler;

        const root_dir_info = try RunCommand.configureEnvForRun(
            ctx,
            this_transpiler,
            this.env,
            log_level != .silent,
            false,
        );

        const init_cwd_entry = try this.env.map.getOrPutWithoutValue("INIT_CWD");
        if (!init_cwd_entry.found_existing) {
            init_cwd_entry.key_ptr.* = try ctx.allocator.dupe(u8, init_cwd_entry.key_ptr.*);
            init_cwd_entry.value_ptr.* = .{
                .value = try ctx.allocator.dupe(u8, strings.withoutTrailingSlash(FileSystem.instance.top_level_dir)),
                .conditional = false,
            };
        }

        this.env.loadCCachePath(this_transpiler.fs);

        {
            var node_path: bun.PathBuffer = undefined;
            if (this.env.getNodePath(this_transpiler.fs, &node_path)) |node_pathZ| {
                _ = try this.env.loadNodeJSConfig(this_transpiler.fs, bun.default_allocator.dupe(u8, node_pathZ) catch bun.outOfMemory());
            } else brk: {
                const current_path = this.env.get("PATH") orelse "";
                var PATH = try std.ArrayList(u8).initCapacity(bun.default_allocator, current_path.len);
                try PATH.appendSlice(current_path);
                var bun_path: string = "";
                RunCommand.createFakeTemporaryNodeExecutable(&PATH, &bun_path) catch break :brk;
                try this.env.map.put("PATH", PATH.items);
                _ = try this.env.loadNodeJSConfig(this_transpiler.fs, bun.default_allocator.dupe(u8, bun_path) catch bun.outOfMemory());
            }
        }

        this.env_configure.?.root_dir_info = root_dir_info;

        return this_transpiler;
    }

    pub fn httpProxy(this: *PackageManager, url: URL) ?URL {
        return this.env.getHttpProxyFor(url);
    }

    pub fn tlsRejectUnauthorized(this: *PackageManager) bool {
        return this.env.getTLSRejectUnauthorized();
    }

    pub fn computeIsContinuousIntegration(this: *PackageManager) bool {
        return this.env.isCI();
    }

    pub inline fn isContinuousIntegration(this: *PackageManager) bool {
        return this.ci_mode.get();
    }

    pub const WakeHandler = struct {
        // handler: fn (ctx: *anyopaque, pm: *PackageManager) void = undefined,
        // onDependencyError: fn (ctx: *anyopaque, Dependency, PackageID, anyerror) void = undefined,
        handler: *const anyopaque = undefined,
        onDependencyError: *const anyopaque = undefined,
        context: ?*anyopaque = null,

        pub inline fn getHandler(t: @This()) *const fn (ctx: *anyopaque, pm: *PackageManager) void {
            return bun.cast(*const fn (ctx: *anyopaque, pm: *PackageManager) void, t.handler);
        }

        pub inline fn getonDependencyError(t: @This()) *const fn (ctx: *anyopaque, Dependency, DependencyID, anyerror) void {
            return bun.cast(*const fn (ctx: *anyopaque, Dependency, DependencyID, anyerror) void, t.handler);
        }
    };

    pub fn failRootResolution(this: *PackageManager, dependency: *const Dependency, dependency_id: DependencyID, err: anyerror) void {
        if (this.onWake.context) |ctx| {
            this.onWake.getonDependencyError()(
                ctx,
                dependency.*,
                dependency_id,
                err,
            );
        }
    }

    pub fn wake(this: *PackageManager) void {
        if (this.onWake.context) |ctx| {
            this.onWake.getHandler()(ctx, this);
        }

        _ = this.wait_count.fetchAdd(1, .monotonic);
        this.event_loop.wakeup();
    }

    pub fn hasNoMorePendingLifecycleScripts(this: *PackageManager) bool {
        this.reportSlowLifecycleScripts();
        return this.pending_lifecycle_script_tasks.load(.monotonic) == 0;
    }

    pub fn tickLifecycleScripts(this: *PackageManager) void {
        this.event_loop.tickOnce(this);
    }

    pub fn sleepUntil(this: *PackageManager, closure: anytype, comptime isDoneFn: anytype) void {
        Output.flush();
        this.event_loop.tick(closure, isDoneFn);
    }

    pub fn sleep(this: *PackageManager) void {
        this.reportSlowLifecycleScripts();
        Output.flush();
        this.event_loop.tick(this, hasNoMorePendingLifecycleScripts);
    }

    const DependencyToEnqueue = union(enum) {
        pending: DependencyID,
        resolution: struct { package_id: PackageID, resolution: Resolution },
        not_found: void,
        failure: anyerror,
    };

    pub fn enqueueDependencyToRoot(
        this: *PackageManager,
        name: []const u8,
        version: *const Dependency.Version,
        version_buf: []const u8,
        behavior: Dependency.Behavior,
    ) DependencyToEnqueue {
        const dep_id = @as(DependencyID, @truncate(brk: {
            const str_buf = this.lockfile.buffers.string_bytes.items;
            for (this.lockfile.buffers.dependencies.items, 0..) |dep, id| {
                if (!strings.eqlLong(dep.name.slice(str_buf), name, true)) continue;
                if (!dep.version.eql(version, str_buf, version_buf)) continue;
                break :brk id;
            }

            var builder = this.lockfile.stringBuilder();
            const dummy = Dependency{
                .name = String.init(name, name),
                .name_hash = String.Builder.stringHash(name),
                .version = version.*,
                .behavior = behavior,
            };
            dummy.countWithDifferentBuffers(name, version_buf, @TypeOf(&builder), &builder);

            builder.allocate() catch |err| return .{ .failure = err };

            const dep = dummy.cloneWithDifferentBuffers(this, name, version_buf, @TypeOf(&builder), &builder) catch unreachable;
            builder.clamp();
            const index = this.lockfile.buffers.dependencies.items.len;
            this.lockfile.buffers.dependencies.append(this.allocator, dep) catch unreachable;
            this.lockfile.buffers.resolutions.append(this.allocator, invalid_package_id) catch unreachable;
            if (comptime Environment.allow_assert) bun.assert(this.lockfile.buffers.dependencies.items.len == this.lockfile.buffers.resolutions.items.len);
            break :brk index;
        }));

        if (this.lockfile.buffers.resolutions.items[dep_id] == invalid_package_id) {
            this.enqueueDependencyWithMainAndSuccessFn(
                dep_id,
                &this.lockfile.buffers.dependencies.items[dep_id],
                invalid_package_id,
                false,
                assignRootResolution,
                failRootResolution,
            ) catch |err| {
                return .{ .failure = err };
            };
        }

        const resolution_id = switch (this.lockfile.buffers.resolutions.items[dep_id]) {
            invalid_package_id => brk: {
                this.drainDependencyList();

                const Closure = struct {
                    // https://github.com/ziglang/zig/issues/19586
                    pub fn issue_19586_workaround() type {
                        return struct {
                            err: ?anyerror = null,
                            manager: *PackageManager,
                            pub fn isDone(closure: *@This()) bool {
                                const manager = closure.manager;
                                if (manager.pendingTaskCount() > 0) {
                                    manager.runTasks(
                                        void,
                                        {},
                                        .{
                                            .onExtract = {},
                                            .onResolve = {},
                                            .onPackageManifestError = {},
                                            .onPackageDownloadError = {},
                                        },
                                        false,
                                        manager.options.log_level,
                                    ) catch |err| {
                                        closure.err = err;
                                        return true;
                                    };

                                    if (PackageManager.verbose_install and manager.pendingTaskCount() > 0) {
                                        if (PackageManager.hasEnoughTimePassedBetweenWaitingMessages()) Output.prettyErrorln("<d>[PackageManager]<r> waiting for {d} tasks\n", .{closure.manager.pendingTaskCount()});
                                    }
                                }

                                return manager.pendingTaskCount() == 0;
                            }
                        };
                    }
                }.issue_19586_workaround();

                if (this.options.log_level.showProgress()) {
                    this.startProgressBarIfNone();
                }

                var closure = Closure{ .manager = this };
                this.sleepUntil(&closure, &Closure.isDone);

                if (this.options.log_level.showProgress()) {
                    this.endProgressBar();
                    Output.flush();
                }

                if (closure.err) |err| {
                    return .{ .failure = err };
                }

                break :brk this.lockfile.buffers.resolutions.items[dep_id];
            },
            // we managed to synchronously resolve the dependency
            else => |pkg_id| pkg_id,
        };

        if (resolution_id == invalid_package_id) {
            return .{
                .not_found = {},
            };
        }

        return .{
            .resolution = .{
                .resolution = this.lockfile.packages.items(.resolution)[resolution_id],
                .package_id = resolution_id,
            },
        };
    }

    pub fn globalLinkDir(this: *PackageManager) !std.fs.Dir {
        return this.global_link_dir orelse brk: {
            var global_dir = try Options.openGlobalDir(this.options.explicit_global_directory);
            this.global_dir = global_dir;
            this.global_link_dir = try global_dir.makeOpenPath("node_modules", .{});
            var buf: bun.PathBuffer = undefined;
            const _path = try bun.getFdPath(.fromStdDir(this.global_link_dir.?), &buf);
            this.global_link_dir_path = try Fs.FileSystem.DirnameStore.instance.append([]const u8, _path);
            break :brk this.global_link_dir.?;
        };
    }

    pub fn globalLinkDirPath(this: *PackageManager) ![]const u8 {
        _ = try this.globalLinkDir();
        return this.global_link_dir_path;
    }

    pub fn formatLaterVersionInCache(
        this: *PackageManager,
        package_name: string,
        name_hash: PackageNameHash,
        resolution: Resolution,
    ) ?Semver.Version.Formatter {
        switch (resolution.tag) {
            Resolution.Tag.npm => {
                if (resolution.value.npm.version.tag.hasPre())
                    // TODO:
                    return null;

                const manifest = this.manifests.byNameHash(
                    this,
                    this.scopeForPackageName(package_name),
                    name_hash,
                    .load_from_memory,
                ) orelse return null;

                if (manifest.findByDistTag("latest")) |*latest_version| {
                    if (latest_version.version.order(
                        resolution.value.npm.version,
                        manifest.string_buf,
                        this.lockfile.buffers.string_bytes.items,
                    ) != .gt) return null;
                    return latest_version.version.fmt(manifest.string_buf);
                }

                return null;
            },
            else => return null,
        }
    }

    pub fn ensurePreinstallStateListCapacity(this: *PackageManager, count: usize) void {
        if (this.preinstall_state.items.len >= count) {
            return;
        }

        const offset = this.preinstall_state.items.len;
        this.preinstall_state.ensureTotalCapacity(this.allocator, count) catch bun.outOfMemory();
        this.preinstall_state.expandToCapacity();
        @memset(this.preinstall_state.items[offset..], PreinstallState.unknown);
    }

    pub fn setPreinstallState(this: *PackageManager, package_id: PackageID, lockfile: *Lockfile, value: PreinstallState) void {
        this.ensurePreinstallStateListCapacity(lockfile.packages.len);
        this.preinstall_state.items[package_id] = value;
    }

    pub fn getPreinstallState(this: *PackageManager, package_id: PackageID) PreinstallState {
        if (package_id >= this.preinstall_state.items.len) {
            return PreinstallState.unknown;
        }
        return this.preinstall_state.items[package_id];
    }

    pub fn determinePreinstallState(
        manager: *PackageManager,
        pkg: Package,
        lockfile: *Lockfile,
        out_name_and_version_hash: *?u64,
        out_patchfile_hash: *?u64,
    ) PreinstallState {
        switch (manager.getPreinstallState(pkg.meta.id)) {
            .unknown => {

                // Do not automatically start downloading packages which are disabled
                // i.e. don't download all of esbuild's versions or SWCs
                if (pkg.isDisabled()) {
                    manager.setPreinstallState(pkg.meta.id, lockfile, .done);
                    return .done;
                }

                const patch_hash: ?u64 = brk: {
                    if (manager.lockfile.patched_dependencies.entries.len == 0) break :brk null;
                    var sfb = std.heap.stackFallback(1024, manager.lockfile.allocator);
                    const name_and_version = std.fmt.allocPrint(
                        sfb.get(),
                        "{s}@{}",
                        .{
                            pkg.name.slice(manager.lockfile.buffers.string_bytes.items),
                            pkg.resolution.fmt(manager.lockfile.buffers.string_bytes.items, .posix),
                        },
                    ) catch unreachable;
                    const name_and_version_hash = String.Builder.stringHash(name_and_version);
                    const patched_dep = manager.lockfile.patched_dependencies.get(name_and_version_hash) orelse break :brk null;
                    defer out_name_and_version_hash.* = name_and_version_hash;
                    if (patched_dep.patchfile_hash_is_null) {
                        manager.setPreinstallState(pkg.meta.id, manager.lockfile, .calc_patch_hash);
                        return .calc_patch_hash;
                    }
                    out_patchfile_hash.* = patched_dep.patchfileHash().?;
                    break :brk patched_dep.patchfileHash().?;
                };

                const folder_path = switch (pkg.resolution.tag) {
                    .git => manager.cachedGitFolderNamePrintAuto(&pkg.resolution.value.git, patch_hash),
                    .github => manager.cachedGitHubFolderNamePrintAuto(&pkg.resolution.value.github, patch_hash),
                    .npm => manager.cachedNPMPackageFolderName(lockfile.str(&pkg.name), pkg.resolution.value.npm.version, patch_hash),
                    .local_tarball => manager.cachedTarballFolderName(pkg.resolution.value.local_tarball, patch_hash),
                    .remote_tarball => manager.cachedTarballFolderName(pkg.resolution.value.remote_tarball, patch_hash),
                    else => "",
                };

                if (folder_path.len == 0) {
                    manager.setPreinstallState(pkg.meta.id, lockfile, .extract);
                    return .extract;
                }

                if (manager.isFolderInCache(folder_path)) {
                    manager.setPreinstallState(pkg.meta.id, lockfile, .done);
                    return .done;
                }

                // If the package is patched, then `folder_path` looks like:
                // is-even@1.0.0_patch_hash=abc8s6dedhsddfkahaldfjhlj
                //
                // If that's not in the cache, we need to put it there:
                // 1. extract the non-patched pkg in the cache
                // 2. copy non-patched pkg into temp dir
                // 3. apply patch to temp dir
                // 4. rename temp dir to `folder_path`
                if (patch_hash != null) {
                    const non_patched_path_ = folder_path[0 .. std.mem.indexOf(u8, folder_path, "_patch_hash=") orelse @panic("Expected folder path to contain `patch_hash=`, this is a bug in Bun. Please file a GitHub issue.")];
                    const non_patched_path = manager.lockfile.allocator.dupeZ(u8, non_patched_path_) catch bun.outOfMemory();
                    defer manager.lockfile.allocator.free(non_patched_path);
                    if (manager.isFolderInCache(non_patched_path)) {
                        manager.setPreinstallState(pkg.meta.id, manager.lockfile, .apply_patch);
                        // yay step 1 is already done for us
                        return .apply_patch;
                    }
                    // we need to extract non-patched pkg into the cache
                    manager.setPreinstallState(pkg.meta.id, lockfile, .extract);
                    return .extract;
                }

                manager.setPreinstallState(pkg.meta.id, lockfile, .extract);
                return .extract;
            },
            else => |val| return val,
        }
    }

    pub fn scopeForPackageName(this: *const PackageManager, name: string) *const Npm.Registry.Scope {
        if (name.len == 0 or name[0] != '@') return &this.options.scope;
        return this.options.registries.getPtr(
            Npm.Registry.Scope.hash(
                Npm.Registry.Scope.getName(name),
            ),
        ) orelse &this.options.scope;
    }

    pub fn setNodeName(
        this: *PackageManager,
        node: *Progress.Node,
        name: string,
        emoji: string,
        comptime is_first: bool,
    ) void {
        if (Output.isEmojiEnabled()) {
            if (is_first) {
                @memcpy(this.progress_name_buf[0..emoji.len], emoji);
                @memcpy(this.progress_name_buf[emoji.len..][0..name.len], name);
                node.name = this.progress_name_buf[0 .. emoji.len + name.len];
            } else {
                @memcpy(this.progress_name_buf[emoji.len..][0..name.len], name);
                node.name = this.progress_name_buf[0 .. emoji.len + name.len];
            }
        } else {
            @memcpy(this.progress_name_buf[0..name.len], name);
            node.name = this.progress_name_buf[0..name.len];
        }
    }

    pub var cached_package_folder_name_buf: bun.PathBuffer = undefined;

    pub inline fn getCacheDirectory(this: *PackageManager) std.fs.Dir {
        return this.cache_directory_ orelse brk: {
            this.cache_directory_ = this.ensureCacheDirectory();
            break :brk this.cache_directory_.?;
        };
    }

    pub inline fn getTemporaryDirectory(this: *PackageManager) std.fs.Dir {
        return this.temp_dir_ orelse brk: {
            this.temp_dir_ = this.ensureTemporaryDirectory();
            var pathbuf: bun.PathBuffer = undefined;
            const temp_dir_path = bun.getFdPathZ(.fromStdDir(this.temp_dir_.?), &pathbuf) catch Output.panic("Unable to read temporary directory path", .{});
            this.temp_dir_path = bun.default_allocator.dupeZ(u8, temp_dir_path) catch bun.outOfMemory();
            break :brk this.temp_dir_.?;
        };
    }

    noinline fn ensureCacheDirectory(this: *PackageManager) std.fs.Dir {
        loop: while (true) {
            if (this.options.enable.cache) {
                const cache_dir = fetchCacheDirectoryPath(this.env, &this.options);
                this.cache_directory_path = this.allocator.dupeZ(u8, cache_dir.path) catch bun.outOfMemory();

                return std.fs.cwd().makeOpenPath(cache_dir.path, .{}) catch {
                    this.options.enable.cache = false;
                    this.allocator.free(this.cache_directory_path);
                    continue :loop;
                };
            }

            this.cache_directory_path = this.allocator.dupeZ(u8, Path.joinAbsString(
                Fs.FileSystem.instance.top_level_dir,
                &.{
                    "node_modules",
                    ".cache",
                },
                .auto,
            )) catch bun.outOfMemory();

            return std.fs.cwd().makeOpenPath("node_modules/.cache", .{}) catch |err| {
                Output.prettyErrorln("<r><red>error<r>: bun is unable to write files: {s}", .{@errorName(err)});
                Global.crash();
            };
        }
        unreachable;
    }

    pub var using_fallback_temp_dir: bool = false;

    // We need a temporary directory that can be rename()
    // This is important for extracting files.
    //
    // However, we want it to be reused! Otherwise a cache is silly.
    //   Error RenameAcrossMountPoints moving react-is to cache dir:
    noinline fn ensureTemporaryDirectory(this: *PackageManager) std.fs.Dir {
        var cache_directory = this.getCacheDirectory();
        // The chosen tempdir must be on the same filesystem as the cache directory
        // This makes renameat() work
        this.temp_dir_name = Fs.FileSystem.RealFS.getDefaultTempDir();

        var tried_dot_tmp = false;
        var tempdir: std.fs.Dir = bun.MakePath.makeOpenPath(std.fs.cwd(), this.temp_dir_name, .{}) catch brk: {
            tried_dot_tmp = true;
            break :brk bun.MakePath.makeOpenPath(cache_directory, bun.pathLiteral(".tmp"), .{}) catch |err| {
                Output.prettyErrorln("<r><red>error<r>: bun is unable to access tempdir: {s}", .{@errorName(err)});
                Global.crash();
            };
        };
        var tmpbuf: bun.PathBuffer = undefined;
        const tmpname = Fs.FileSystem.instance.tmpname("hm", &tmpbuf, bun.fastRandom()) catch unreachable;
        var timer: std.time.Timer = if (this.options.log_level != .silent) std.time.Timer.start() catch unreachable else undefined;
        brk: while (true) {
            var file = tempdir.createFileZ(tmpname, .{ .truncate = true }) catch |err2| {
                if (!tried_dot_tmp) {
                    tried_dot_tmp = true;

                    tempdir = bun.MakePath.makeOpenPath(cache_directory, bun.pathLiteral(".tmp"), .{}) catch |err| {
                        Output.prettyErrorln("<r><red>error<r>: bun is unable to access tempdir: {s}", .{@errorName(err)});
                        Global.crash();
                    };

                    if (PackageManager.verbose_install) {
                        Output.prettyErrorln("<r><yellow>warn<r>: bun is unable to access tempdir: {s}, using fallback", .{@errorName(err2)});
                    }

                    continue :brk;
                }
                Output.prettyErrorln("<r><red>error<r>: {s} accessing temporary directory. Please set <b>$BUN_TMPDIR<r> or <b>$BUN_INSTALL<r>", .{
                    @errorName(err2),
                });
                Global.crash();
            };
            file.close();

            std.posix.renameatZ(tempdir.fd, tmpname, cache_directory.fd, tmpname) catch |err| {
                if (!tried_dot_tmp) {
                    tried_dot_tmp = true;
                    tempdir = cache_directory.makeOpenPath(".tmp", .{}) catch |err2| {
                        Output.prettyErrorln("<r><red>error<r>: bun is unable to write files to tempdir: {s}", .{@errorName(err2)});
                        Global.crash();
                    };

                    if (PackageManager.verbose_install) {
                        Output.prettyErrorln("<r><d>info<r>: cannot move files from tempdir: {s}, using fallback", .{@errorName(err)});
                    }

                    continue :brk;
                }

                Output.prettyErrorln("<r><red>error<r>: {s} accessing temporary directory. Please set <b>$BUN_TMPDIR<r> or <b>$BUN_INSTALL<r>", .{
                    @errorName(err),
                });
                Global.crash();
            };
            cache_directory.deleteFileZ(tmpname) catch {};
            break;
        }
        if (tried_dot_tmp) {
            using_fallback_temp_dir = true;
        }
        if (this.options.log_level != .silent) {
            const elapsed = timer.read();
            if (elapsed > std.time.ns_per_ms * 100) {
                var path_buf: bun.PathBuffer = undefined;
                const cache_dir_path = bun.getFdPath(.fromStdDir(cache_directory), &path_buf) catch "it";
                Output.prettyErrorln(
                    "<r><yellow>warn<r>: Slow filesystem detected. If {s} is a network drive, consider setting $BUN_INSTALL_CACHE_DIR to a local folder.",
                    .{cache_dir_path},
                );
            }
        }

        return tempdir;
    }

    pub fn ensureTempNodeGypScript(this: *PackageManager) !void {
        if (this.node_gyp_tempdir_name.len > 0) return;

        const tempdir = this.getTemporaryDirectory();
        var path_buf: bun.PathBuffer = undefined;
        const node_gyp_tempdir_name = bun.span(try Fs.FileSystem.instance.tmpname("node-gyp", &path_buf, 12345));

        // used later for adding to path for scripts
        this.node_gyp_tempdir_name = try this.allocator.dupe(u8, node_gyp_tempdir_name);

        var node_gyp_tempdir = tempdir.makeOpenPath(this.node_gyp_tempdir_name, .{}) catch |err| {
            if (err == error.EEXIST) {
                // it should not exist
                Output.prettyErrorln("<r><red>error<r>: node-gyp tempdir already exists", .{});
                Global.crash();
            }
            Output.prettyErrorln("<r><red>error<r>: <b><red>{s}<r> creating node-gyp tempdir", .{@errorName(err)});
            Global.crash();
        };
        defer node_gyp_tempdir.close();

        const file_name = switch (Environment.os) {
            else => "node-gyp",
            .windows => "node-gyp.cmd",
        };
        const mode = switch (Environment.os) {
            else => 0o755,
            .windows => 0, // windows does not have an executable bit
        };

        var node_gyp_file = node_gyp_tempdir.createFile(file_name, .{ .mode = mode }) catch |err| {
            Output.prettyErrorln("<r><red>error<r>: <b><red>{s}<r> creating node-gyp tempdir", .{@errorName(err)});
            Global.crash();
        };
        defer node_gyp_file.close();

        const content = switch (Environment.os) {
            .windows =>
            \\if not defined npm_config_node_gyp (
            \\  bun x --silent node-gyp %*
            \\) else (
            \\  node "%npm_config_node_gyp%" %*
            \\)
            \\
            ,
            else =>
            \\#!/bin/sh
            \\if [ "x$npm_config_node_gyp" = "x" ]; then
            \\  bun x --silent node-gyp $@
            \\else
            \\  "$npm_config_node_gyp" $@
            \\fi
            \\
            ,
        };

        node_gyp_file.writeAll(content) catch |err| {
            Output.prettyErrorln("<r><red>error<r>: <b><red>{s}<r> writing to " ++ file_name ++ " file", .{@errorName(err)});
            Global.crash();
        };

        // Add our node-gyp tempdir to the path
        const existing_path = this.env.get("PATH") orelse "";
        var PATH = try std.ArrayList(u8).initCapacity(bun.default_allocator, existing_path.len + 1 + this.temp_dir_name.len + 1 + this.node_gyp_tempdir_name.len);
        try PATH.appendSlice(existing_path);
        if (existing_path.len > 0 and existing_path[existing_path.len - 1] != std.fs.path.delimiter)
            try PATH.append(std.fs.path.delimiter);
        try PATH.appendSlice(strings.withoutTrailingSlash(this.temp_dir_name));
        try PATH.append(std.fs.path.sep);
        try PATH.appendSlice(this.node_gyp_tempdir_name);
        try this.env.map.put("PATH", PATH.items);

        const npm_config_node_gyp = try std.fmt.bufPrint(&path_buf, "{s}{s}{s}{s}{s}", .{
            strings.withoutTrailingSlash(this.temp_dir_name),
            std.fs.path.sep_str,
            strings.withoutTrailingSlash(this.node_gyp_tempdir_name),
            std.fs.path.sep_str,
            file_name,
        });

        const node_gyp_abs_dir = std.fs.path.dirname(npm_config_node_gyp).?;
        try this.env.map.putAllocKeyAndValue(this.allocator, "BUN_WHICH_IGNORE_CWD", node_gyp_abs_dir);
    }

    const Holder = struct {
        pub var ptr: *PackageManager = undefined;
    };

    pub fn allocatePackageManager() void {
        Holder.ptr = bun.default_allocator.create(PackageManager) catch bun.outOfMemory();
    }

    pub fn get() *PackageManager {
        return Holder.ptr;
    }

    pub fn getNetworkTask(this: *PackageManager) *NetworkTask {
        return this.preallocated_network_tasks.get();
    }

    pub fn allocGitHubURL(this: *const PackageManager, repository: *const Repository) string {
        var github_api_url: string = "https://api.github.com";
        if (this.env.get("GITHUB_API_URL")) |url| {
            if (url.len > 0) {
                github_api_url = url;
            }
        }

        const owner = this.lockfile.str(&repository.owner);
        const repo = this.lockfile.str(&repository.repo);
        const committish = this.lockfile.str(&repository.committish);

        return std.fmt.allocPrint(
            this.allocator,
            "{s}/repos/{s}/{s}{s}tarball/{s}",
            .{
                strings.withoutTrailingSlash(github_api_url),
                owner,
                repo,
                // repo might be empty if dep is https://github.com/... style
                if (repo.len > 0) "/" else "",
                committish,
            },
        ) catch unreachable;
    }

    pub fn cachedGitFolderNamePrint(buf: []u8, resolved: string, patch_hash: ?u64) stringZ {
        return std.fmt.bufPrintZ(buf, "@G@{s}{}", .{ resolved, PatchHashFmt{ .hash = patch_hash } }) catch unreachable;
    }

    pub fn cachedGitFolderName(this: *const PackageManager, repository: *const Repository, patch_hash: ?u64) stringZ {
        return cachedGitFolderNamePrint(&cached_package_folder_name_buf, this.lockfile.str(&repository.resolved), patch_hash);
    }

    pub const PatchHashFmt = struct {
        hash: ?u64 = null,

        pub fn format(this: *const PatchHashFmt, comptime _: []const u8, _: std.fmt.FormatOptions, writer: anytype) !void {
            if (this.hash) |h| {
                try writer.print("_patch_hash={x}", .{h});
            }
        }
    };

    pub const CacheVersion = struct {
        pub const current = 1;
        pub const Formatter = struct {
            version_number: ?usize = null,

            pub fn format(this: *const @This(), comptime _: []const u8, _: std.fmt.FormatOptions, writer: anytype) !void {
                if (this.version_number) |version| {
                    try writer.print("@@@{d}", .{version});
                }
            }
        };
    };

    pub fn cachedGitFolderNamePrintAuto(this: *const PackageManager, repository: *const Repository, patch_hash: ?u64) stringZ {
        if (!repository.resolved.isEmpty()) {
            return this.cachedGitFolderName(repository, patch_hash);
        }

        if (!repository.repo.isEmpty() and !repository.committish.isEmpty()) {
            const string_buf = this.lockfile.buffers.string_bytes.items;
            return std.fmt.bufPrintZ(
                &cached_package_folder_name_buf,
                "@G@{any}{}{}",
                .{
                    repository.committish.fmt(string_buf),
                    CacheVersion.Formatter{ .version_number = CacheVersion.current },
                    PatchHashFmt{ .hash = patch_hash },
                },
            ) catch unreachable;
        }

        return "";
    }

    pub fn cachedGitHubFolderNamePrint(buf: []u8, resolved: string, patch_hash: ?u64) stringZ {
        return std.fmt.bufPrintZ(buf, "@GH@{s}{}{}", .{
            resolved,
            CacheVersion.Formatter{ .version_number = CacheVersion.current },
            PatchHashFmt{ .hash = patch_hash },
        }) catch unreachable;
    }

    pub fn cachedGitHubFolderName(this: *const PackageManager, repository: *const Repository, patch_hash: ?u64) stringZ {
        return cachedGitHubFolderNamePrint(&cached_package_folder_name_buf, this.lockfile.str(&repository.resolved), patch_hash);
    }

    fn cachedGitHubFolderNamePrintGuess(buf: []u8, string_buf: []const u8, repository: *const Repository, patch_hash: ?u64) stringZ {
        return std.fmt.bufPrintZ(
            buf,
            "@GH@{any}-{any}-{any}{}{}",
            .{
                repository.owner.fmt(string_buf),
                repository.repo.fmt(string_buf),
                repository.committish.fmt(string_buf),
                CacheVersion.Formatter{ .version_number = CacheVersion.current },
                PatchHashFmt{ .hash = patch_hash },
            },
        ) catch unreachable;
    }

    pub fn cachedGitHubFolderNamePrintAuto(this: *const PackageManager, repository: *const Repository, patch_hash: ?u64) stringZ {
        if (!repository.resolved.isEmpty()) {
            return this.cachedGitHubFolderName(repository, patch_hash);
        }

        if (!repository.owner.isEmpty() and !repository.repo.isEmpty() and !repository.committish.isEmpty()) {
            return cachedGitHubFolderNamePrintGuess(&cached_package_folder_name_buf, this.lockfile.buffers.string_bytes.items, repository, patch_hash);
        }

        return "";
    }

    // TODO: normalize to alphanumeric
    pub fn cachedNPMPackageFolderNamePrint(this: *const PackageManager, buf: []u8, name: string, version: Semver.Version, patch_hash: ?u64) stringZ {
        const scope = this.scopeForPackageName(name);

        if (scope.name.len == 0 and !this.options.did_override_default_scope) {
            const include_version_number = true;
            return cachedNPMPackageFolderPrintBasename(buf, name, version, patch_hash, include_version_number);
        }

        const include_version_number = false;
        const basename = cachedNPMPackageFolderPrintBasename(buf, name, version, null, include_version_number);

        const spanned = bun.span(basename);
        const available = buf[spanned.len..];
        var end: []u8 = undefined;
        if (scope.url.hostname.len > 32 or available.len < 64) {
            const visible_hostname = scope.url.hostname[0..@min(scope.url.hostname.len, 12)];
            end = std.fmt.bufPrint(available, "@@{s}__{any}{}{}", .{
                visible_hostname,
                bun.fmt.hexIntLower(String.Builder.stringHash(scope.url.href)),
                CacheVersion.Formatter{ .version_number = CacheVersion.current },
                PatchHashFmt{ .hash = patch_hash },
            }) catch unreachable;
        } else {
            end = std.fmt.bufPrint(available, "@@{s}{}{}", .{
                scope.url.hostname,
                CacheVersion.Formatter{ .version_number = CacheVersion.current },
                PatchHashFmt{ .hash = patch_hash },
            }) catch unreachable;
        }

        buf[spanned.len + end.len] = 0;
        const result: [:0]u8 = buf[0 .. spanned.len + end.len :0];
        return result;
    }

    pub fn cachedNPMPackageFolderName(this: *const PackageManager, name: string, version: Semver.Version, patch_hash: ?u64) stringZ {
        return this.cachedNPMPackageFolderNamePrint(&cached_package_folder_name_buf, name, version, patch_hash);
    }

    // TODO: normalize to alphanumeric
    pub fn cachedNPMPackageFolderPrintBasename(
        buf: []u8,
        name: string,
        version: Semver.Version,
        patch_hash: ?u64,
        include_cache_version: bool,
    ) stringZ {
        if (version.tag.hasPre()) {
            if (version.tag.hasBuild()) {
                return std.fmt.bufPrintZ(
                    buf,
                    "{s}@{d}.{d}.{d}-{any}+{any}{}{}",
                    .{
                        name,
                        version.major,
                        version.minor,
                        version.patch,
                        bun.fmt.hexIntLower(version.tag.pre.hash),
                        bun.fmt.hexIntUpper(version.tag.build.hash),
                        CacheVersion.Formatter{ .version_number = if (include_cache_version) CacheVersion.current else null },
                        PatchHashFmt{ .hash = patch_hash },
                    },
                ) catch unreachable;
            }
            return std.fmt.bufPrintZ(
                buf,
                "{s}@{d}.{d}.{d}-{any}{}{}",
                .{
                    name,
                    version.major,
                    version.minor,
                    version.patch,
                    bun.fmt.hexIntLower(version.tag.pre.hash),
                    CacheVersion.Formatter{ .version_number = if (include_cache_version) CacheVersion.current else null },
                    PatchHashFmt{ .hash = patch_hash },
                },
            ) catch unreachable;
        }
        if (version.tag.hasBuild()) {
            return std.fmt.bufPrintZ(
                buf,
                "{s}@{d}.{d}.{d}+{any}{}{}",
                .{
                    name,
                    version.major,
                    version.minor,
                    version.patch,
                    bun.fmt.hexIntUpper(version.tag.build.hash),
                    CacheVersion.Formatter{ .version_number = if (include_cache_version) CacheVersion.current else null },
                    PatchHashFmt{ .hash = patch_hash },
                },
            ) catch unreachable;
        }
        return std.fmt.bufPrintZ(buf, "{s}@{d}.{d}.{d}{}{}", .{
            name,
            version.major,
            version.minor,
            version.patch,
            CacheVersion.Formatter{ .version_number = if (include_cache_version) CacheVersion.current else null },
            PatchHashFmt{ .hash = patch_hash },
        }) catch unreachable;
    }

    pub fn cachedTarballFolderNamePrint(buf: []u8, url: string, patch_hash: ?u64) stringZ {
        return std.fmt.bufPrintZ(buf, "@T@{any}{}{}", .{
            bun.fmt.hexIntLower(String.Builder.stringHash(url)),
            CacheVersion.Formatter{ .version_number = CacheVersion.current },
            PatchHashFmt{ .hash = patch_hash },
        }) catch unreachable;
    }

    pub fn cachedTarballFolderName(this: *const PackageManager, url: String, patch_hash: ?u64) stringZ {
        return cachedTarballFolderNamePrint(&cached_package_folder_name_buf, this.lockfile.str(&url), patch_hash);
    }

    pub fn isFolderInCache(this: *PackageManager, folder_path: stringZ) bool {
        return bun.sys.directoryExistsAt(.fromStdDir(this.getCacheDirectory()), folder_path).unwrap() catch false;
    }

    pub fn pathForCachedNPMPath(
        this: *PackageManager,
        buf: *bun.PathBuffer,
        package_name: []const u8,
        version: Semver.Version,
    ) ![]u8 {
        var cache_path_buf: bun.PathBuffer = undefined;

        const cache_path = this.cachedNPMPackageFolderNamePrint(&cache_path_buf, package_name, version, null);

        if (comptime Environment.allow_assert) {
            bun.assertWithLocation(cache_path[package_name.len] == '@', @src());
        }

        cache_path_buf[package_name.len] = std.fs.path.sep;

        const cache_dir: bun.FD = .fromStdDir(this.getCacheDirectory());

        if (comptime Environment.isWindows) {
            var path_buf: bun.PathBuffer = undefined;
            const joined = bun.path.joinAbsStringBufZ(this.cache_directory_path, &path_buf, &[_]string{cache_path}, .windows);
            return bun.sys.readlink(joined, buf).unwrap() catch |err| {
                _ = bun.sys.unlink(joined);
                return err;
            };
        }

        return cache_dir.readlinkat(cache_path, buf).unwrap() catch |err| {
            // if we run into an error, delete the symlink
            // so that we don't repeatedly try to read it
            _ = cache_dir.unlinkat(cache_path);
            return err;
        };
    }

    pub fn pathForResolution(
        this: *PackageManager,
        package_id: PackageID,
        resolution: Resolution,
        buf: *bun.PathBuffer,
    ) ![]u8 {
        // const folder_name = this.cachedNPMPackageFolderName(name, version);
        switch (resolution.tag) {
            .npm => {
                const npm = resolution.value.npm;
                const package_name_ = this.lockfile.packages.items(.name)[package_id];
                const package_name = this.lockfile.str(&package_name_);

                return this.pathForCachedNPMPath(buf, package_name, npm.version);
            },
            else => return "",
        }
    }

    /// this is copy pasted from `installPackageWithNameAndResolution()`
    /// it's not great to do this
    pub fn computeCacheDirAndSubpath(
        manager: *PackageManager,
        pkg_name: string,
        resolution: *const Resolution,
        folder_path_buf: *bun.PathBuffer,
        patch_hash: ?u64,
    ) struct { cache_dir: std.fs.Dir, cache_dir_subpath: stringZ } {
        const name = pkg_name;
        const buf = manager.lockfile.buffers.string_bytes.items;
        var cache_dir = std.fs.cwd();
        var cache_dir_subpath: stringZ = "";

        switch (resolution.tag) {
            .npm => {
                cache_dir_subpath = manager.cachedNPMPackageFolderName(name, resolution.value.npm.version, patch_hash);
                cache_dir = manager.getCacheDirectory();
            },
            .git => {
                cache_dir_subpath = manager.cachedGitFolderName(
                    &resolution.value.git,
                    patch_hash,
                );
                cache_dir = manager.getCacheDirectory();
            },
            .github => {
                cache_dir_subpath = manager.cachedGitHubFolderName(&resolution.value.github, patch_hash);
                cache_dir = manager.getCacheDirectory();
            },
            .folder => {
                const folder = resolution.value.folder.slice(buf);
                // Handle when a package depends on itself via file:
                // example:
                //   "mineflayer": "file:."
                if (folder.len == 0 or (folder.len == 1 and folder[0] == '.')) {
                    cache_dir_subpath = ".";
                } else {
                    @memcpy(folder_path_buf[0..folder.len], folder);
                    folder_path_buf[folder.len] = 0;
                    cache_dir_subpath = folder_path_buf[0..folder.len :0];
                }
                cache_dir = std.fs.cwd();
            },
            .local_tarball => {
                cache_dir_subpath = manager.cachedTarballFolderName(resolution.value.local_tarball, patch_hash);
                cache_dir = manager.getCacheDirectory();
            },
            .remote_tarball => {
                cache_dir_subpath = manager.cachedTarballFolderName(resolution.value.remote_tarball, patch_hash);
                cache_dir = manager.getCacheDirectory();
            },
            .workspace => {
                const folder = resolution.value.workspace.slice(buf);
                // Handle when a package depends on itself
                if (folder.len == 0 or (folder.len == 1 and folder[0] == '.')) {
                    cache_dir_subpath = ".";
                } else {
                    @memcpy(folder_path_buf[0..folder.len], folder);
                    folder_path_buf[folder.len] = 0;
                    cache_dir_subpath = folder_path_buf[0..folder.len :0];
                }
                cache_dir = std.fs.cwd();
            },
            .symlink => {
                const directory = manager.globalLinkDir() catch |err| {
                    const fmt = "\n<r><red>error:<r> unable to access global directory while installing <b>{s}<r>: {s}\n";
                    const args = .{ name, @errorName(err) };

                    Output.prettyErrorln(fmt, args);

                    Global.exit(1);
                };

                const folder = resolution.value.symlink.slice(buf);

                if (folder.len == 0 or (folder.len == 1 and folder[0] == '.')) {
                    cache_dir_subpath = ".";
                    cache_dir = std.fs.cwd();
                } else {
                    const global_link_dir = manager.globalLinkDirPath() catch unreachable;
                    var ptr = folder_path_buf;
                    var remain: []u8 = folder_path_buf[0..];
                    @memcpy(ptr[0..global_link_dir.len], global_link_dir);
                    remain = remain[global_link_dir.len..];
                    if (global_link_dir[global_link_dir.len - 1] != std.fs.path.sep) {
                        remain[0] = std.fs.path.sep;
                        remain = remain[1..];
                    }
                    @memcpy(remain[0..folder.len], folder);
                    remain = remain[folder.len..];
                    remain[0] = 0;
                    const len = @intFromPtr(remain.ptr) - @intFromPtr(ptr);
                    cache_dir_subpath = folder_path_buf[0..len :0];
                    cache_dir = directory;
                }
            },
            else => {},
        }

        return .{
            .cache_dir = cache_dir,
            .cache_dir_subpath = cache_dir_subpath,
        };
    }

    pub fn getInstalledVersionsFromDiskCache(this: *PackageManager, tags_buf: *std.ArrayList(u8), package_name: []const u8, allocator: std.mem.Allocator) !std.ArrayList(Semver.Version) {
        var list = std.ArrayList(Semver.Version).init(allocator);
        var dir = this.getCacheDirectory().openDir(package_name, .{
            .iterate = true,
        }) catch |err| switch (err) {
            error.FileNotFound, error.NotDir, error.AccessDenied, error.DeviceBusy => return list,
            else => return err,
        };
        defer dir.close();
        var iter = dir.iterate();

        while (try iter.next()) |entry| {
            if (entry.kind != .directory and entry.kind != .sym_link) continue;
            const name = entry.name;
            const sliced = SlicedString.init(name, name);
            const parsed = Semver.Version.parse(sliced);
            if (!parsed.valid or parsed.wildcard != .none) continue;
            // not handling OOM
            // TODO: wildcard
            var version = parsed.version.min();
            const total = version.tag.build.len() + version.tag.pre.len();
            if (total > 0) {
                tags_buf.ensureUnusedCapacity(total) catch unreachable;
                var available = tags_buf.items.ptr[tags_buf.items.len..tags_buf.capacity];
                const new_version = version.cloneInto(name, &available);
                tags_buf.items.len += total;
                version = new_version;
            }

            list.append(version) catch unreachable;
        }

        return list;
    }

    pub fn resolveFromDiskCache(this: *PackageManager, package_name: []const u8, version: Dependency.Version) ?PackageID {
        if (version.tag != .npm) {
            // only npm supported right now
            // tags are more ambiguous
            return null;
        }

        var arena = bun.ArenaAllocator.init(this.allocator);
        defer arena.deinit();
        const arena_alloc = arena.allocator();
        var stack_fallback = std.heap.stackFallback(4096, arena_alloc);
        const allocator = stack_fallback.get();
        var tags_buf = std.ArrayList(u8).init(allocator);
        const installed_versions = this.getInstalledVersionsFromDiskCache(&tags_buf, package_name, allocator) catch |err| {
            Output.debug("error getting installed versions from disk cache: {s}", .{bun.span(@errorName(err))});
            return null;
        };

        // TODO: make this fewer passes
        std.sort.pdq(
            Semver.Version,
            installed_versions.items,
            @as([]const u8, tags_buf.items),
            Semver.Version.sortGt,
        );
        for (installed_versions.items) |installed_version| {
            if (version.value.npm.version.satisfies(installed_version, this.lockfile.buffers.string_bytes.items, tags_buf.items)) {
                var buf: bun.PathBuffer = undefined;
                const npm_package_path = this.pathForCachedNPMPath(&buf, package_name, installed_version) catch |err| {
                    Output.debug("error getting path for cached npm path: {s}", .{bun.span(@errorName(err))});
                    return null;
                };
                const dependency = Dependency.Version{
                    .tag = .npm,
                    .value = .{
                        .npm = .{
                            .name = String.init(package_name, package_name),
                            .version = Semver.Query.Group.from(installed_version),
                        },
                    },
                };
                switch (FolderResolution.getOrPut(.{ .cache_folder = npm_package_path }, dependency, ".", this)) {
                    .new_package_id => |id| {
                        this.enqueueDependencyList(this.lockfile.packages.items(.dependencies)[id]);
                        return id;
                    },
                    .package_id => |id| {
                        this.enqueueDependencyList(this.lockfile.packages.items(.dependencies)[id]);
                        return id;
                    },
                    .err => |err| {
                        Output.debug("error getting or putting folder resolution: {s}", .{bun.span(@errorName(err))});
                        return null;
                    },
                }
            }
        }

        return null;
    }

    const ResolvedPackageResult = struct {
        package: Lockfile.Package,

        /// Is this the first time we've seen this package?
        is_first_time: bool = false,

        task: ?union(enum) {
            /// Pending network task to schedule
            network_task: *NetworkTask,

            /// Apply patch task or calc patch hash task
            patch_task: *PatchTask,
        } = null,
    };

    fn getOrPutResolvedPackageWithFindResult(
        this: *PackageManager,
        name_hash: PackageNameHash,
        name: String,
        dependency: *const Dependency,
        version: Dependency.Version,
        dependency_id: DependencyID,
        behavior: Behavior,
        manifest: *const Npm.PackageManifest,
        find_result: Npm.PackageManifest.FindResult,
        install_peer: bool,
        comptime successFn: SuccessFn,
    ) !?ResolvedPackageResult {
        const should_update = this.to_update and
            // If updating, only update packages in the current workspace
            this.lockfile.isRootDependency(this, dependency_id) and
            // no need to do a look up if update requests are empty (`bun update` with no args)
            (this.update_requests.len == 0 or
                this.updating_packages.contains(dependency.name.slice(this.lockfile.buffers.string_bytes.items)));

        // Was this package already allocated? Let's reuse the existing one.
        if (this.lockfile.getPackageID(
            name_hash,
            if (should_update) null else version,
            &.{
                .tag = .npm,
                .value = .{
                    .npm = .{
                        .version = find_result.version,
                        .url = find_result.package.tarball_url.value,
                    },
                },
            },
        )) |id| {
            successFn(this, dependency_id, id);
            return .{
                .package = this.lockfile.packages.get(id),
                .is_first_time = false,
            };
        } else if (behavior.isPeer() and !install_peer) {
            return null;
        }

        // appendPackage sets the PackageID on the package
        const package = try this.lockfile.appendPackage(try Lockfile.Package.fromNPM(
            this,
            this.allocator,
            this.lockfile,
            this.log,
            manifest,
            find_result.version,
            find_result.package,
            manifest.string_buf,
            Features.npm,
        ));

        if (comptime Environment.allow_assert) bun.assert(package.meta.id != invalid_package_id);
        defer successFn(this, dependency_id, package.meta.id);

        // non-null if the package is in "patchedDependencies"
        var name_and_version_hash: ?u64 = null;
        var patchfile_hash: ?u64 = null;

        return switch (this.determinePreinstallState(
            package,
            this.lockfile,
            &name_and_version_hash,
            &patchfile_hash,
        )) {
            // Is this package already in the cache?
            // We don't need to download the tarball, but we should enqueue dependencies
            .done => .{ .package = package, .is_first_time = true },
            // Do we need to download the tarball?
            .extract => extract: {
                const task_id = Task.Id.forNPMPackage(this.lockfile.str(&name), package.resolution.value.npm.version);
                bun.debugAssert(!this.network_dedupe_map.contains(task_id));

                break :extract .{
                    .package = package,
                    .is_first_time = true,
                    .task = .{
                        .network_task = try this.generateNetworkTaskForTarball(
                            task_id,
                            manifest.str(&find_result.package.tarball_url),
                            dependency.behavior.isRequired(),
                            dependency_id,
                            package,
                            name_and_version_hash,
                            // its npm.
                            .allow_authorization,
                        ) orelse unreachable,
                    },
                };
            },
            .calc_patch_hash => .{
                .package = package,
                .is_first_time = true,
                .task = .{
                    .patch_task = PatchTask.newCalcPatchHash(
                        this,
                        name_and_version_hash.?,
                        .{
                            .pkg_id = package.meta.id,
                            .dependency_id = dependency_id,
                            .url = this.allocator.dupe(u8, manifest.str(&find_result.package.tarball_url)) catch bun.outOfMemory(),
                        },
                    ),
                },
            },
            .apply_patch => .{
                .package = package,
                .is_first_time = true,
                .task = .{
                    .patch_task = PatchTask.newApplyPatchHash(
                        this,
                        package.meta.id,
                        patchfile_hash.?,
                        name_and_version_hash.?,
                    ),
                },
            },
            else => unreachable,
        };
    }

    pub fn hasCreatedNetworkTask(this: *PackageManager, task_id: u64, is_required: bool) bool {
        const gpe = this.network_dedupe_map.getOrPut(task_id) catch bun.outOfMemory();

        // if there's an existing network task that is optional, we want to make it non-optional if this one would be required
        gpe.value_ptr.is_required = if (!gpe.found_existing)
            is_required
        else
            gpe.value_ptr.is_required or is_required;

        return gpe.found_existing;
    }

    pub fn isNetworkTaskRequired(this: *const PackageManager, task_id: u64) bool {
        return (this.network_dedupe_map.get(task_id) orelse return true).is_required;
    }

    pub fn generateNetworkTaskForTarball(
        this: *PackageManager,
        task_id: u64,
        url: string,
        is_required: bool,
        dependency_id: DependencyID,
        package: Lockfile.Package,
        patch_name_and_version_hash: ?u64,
        authorization: NetworkTask.Authorization,
    ) NetworkTask.ForTarballError!?*NetworkTask {
        if (this.hasCreatedNetworkTask(task_id, is_required)) {
            return null;
        }

        var network_task = this.getNetworkTask();

        network_task.* = .{
            .task_id = task_id,
            .callback = undefined,
            .allocator = this.allocator,
            .package_manager = this,
            .apply_patch_task = if (patch_name_and_version_hash) |h| brk: {
                const patch_hash = this.lockfile.patched_dependencies.get(h).?.patchfileHash().?;
                const task = PatchTask.newApplyPatchHash(this, package.meta.id, patch_hash, h);
                task.callback.apply.task_id = task_id;
                break :brk task;
            } else null,
        };

        const scope = this.scopeForPackageName(this.lockfile.str(&package.name));

        try network_task.forTarball(
            this.allocator,
            &.{
                .package_manager = this,
                .name = strings.StringOrTinyString.initAppendIfNeeded(
                    this.lockfile.str(&package.name),
                    *FileSystem.FilenameStore,
                    FileSystem.FilenameStore.instance,
                ) catch bun.outOfMemory(),
                .resolution = package.resolution,
                .cache_dir = this.getCacheDirectory(),
                .temp_dir = this.getTemporaryDirectory(),
                .dependency_id = dependency_id,
                .integrity = package.meta.integrity,
                .url = strings.StringOrTinyString.initAppendIfNeeded(
                    url,
                    *FileSystem.FilenameStore,
                    FileSystem.FilenameStore.instance,
                ) catch bun.outOfMemory(),
            },
            scope,
            authorization,
        );

        return network_task;
    }

    pub fn enqueueNetworkTask(this: *PackageManager, task: *NetworkTask) void {
        if (this.network_task_fifo.writableLength() == 0) {
            this.flushNetworkQueue();
        }

        this.network_task_fifo.writeItemAssumeCapacity(task);
    }

    pub fn enqueuePatchTask(this: *PackageManager, task: *PatchTask) void {
        debug("Enqueue patch task: 0x{x} {s}", .{ @intFromPtr(task), @tagName(task.callback) });
        if (this.patch_task_fifo.writableLength() == 0) {
            this.flushPatchTaskQueue();
        }

        this.patch_task_fifo.writeItemAssumeCapacity(task);
    }

    /// We need to calculate all the patchfile hashes at the beginning so we don't run into problems with stale hashes
    pub fn enqueuePatchTaskPre(this: *PackageManager, task: *PatchTask) void {
        debug("Enqueue patch task pre: 0x{x} {s}", .{ @intFromPtr(task), @tagName(task.callback) });
        task.pre = true;
        if (this.patch_task_fifo.writableLength() == 0) {
            this.flushPatchTaskQueue();
        }

        this.patch_task_fifo.writeItemAssumeCapacity(task);
        _ = this.pending_pre_calc_hashes.fetchAdd(1, .monotonic);
    }

    const SuccessFn = *const fn (*PackageManager, DependencyID, PackageID) void;
    const FailFn = *const fn (*PackageManager, *const Dependency, PackageID, anyerror) void;
    fn assignResolution(this: *PackageManager, dependency_id: DependencyID, package_id: PackageID) void {
        const buffers = &this.lockfile.buffers;
        if (comptime Environment.allow_assert) {
            bun.assert(dependency_id < buffers.resolutions.items.len);
            bun.assert(package_id < this.lockfile.packages.len);
            // bun.assert(buffers.resolutions.items[dependency_id] == invalid_package_id);
        }
        buffers.resolutions.items[dependency_id] = package_id;
        const string_buf = buffers.string_bytes.items;
        var dep = &buffers.dependencies.items[dependency_id];
        if (dep.name.isEmpty() or strings.eql(dep.name.slice(string_buf), dep.version.literal.slice(string_buf))) {
            dep.name = this.lockfile.packages.items(.name)[package_id];
            dep.name_hash = this.lockfile.packages.items(.name_hash)[package_id];
        }
    }

    fn assignRootResolution(this: *PackageManager, dependency_id: DependencyID, package_id: PackageID) void {
        const buffers = &this.lockfile.buffers;
        if (comptime Environment.allow_assert) {
            bun.assert(dependency_id < buffers.resolutions.items.len);
            bun.assert(package_id < this.lockfile.packages.len);
            bun.assert(buffers.resolutions.items[dependency_id] == invalid_package_id);
        }
        buffers.resolutions.items[dependency_id] = package_id;
        const string_buf = buffers.string_bytes.items;
        var dep = &buffers.dependencies.items[dependency_id];
        if (dep.name.isEmpty() or strings.eql(dep.name.slice(string_buf), dep.version.literal.slice(string_buf))) {
            dep.name = this.lockfile.packages.items(.name)[package_id];
            dep.name_hash = this.lockfile.packages.items(.name_hash)[package_id];
        }
    }

    fn resolutionSatisfiesDependency(this: *PackageManager, resolution: Resolution, dependency: Dependency.Version) bool {
        const buf = this.lockfile.buffers.string_bytes.items;
        if (resolution.tag == .npm and dependency.tag == .npm) {
            return dependency.value.npm.version.satisfies(resolution.value.npm.version, buf, buf);
        }

        if (resolution.tag == .git and dependency.tag == .git) {
            return resolution.value.git.eql(&dependency.value.git, buf, buf);
        }

        if (resolution.tag == .github and dependency.tag == .github) {
            return resolution.value.github.eql(&dependency.value.github, buf, buf);
        }

        return false;
    }

    fn getOrPutResolvedPackage(
        this: *PackageManager,
        name_hash: PackageNameHash,
        name: String,
        dependency: *const Dependency,
        version: Dependency.Version,
        behavior: Behavior,
        dependency_id: DependencyID,
        resolution: PackageID,
        install_peer: bool,
        comptime successFn: SuccessFn,
    ) !?ResolvedPackageResult {
        if (install_peer and behavior.isPeer()) {
            if (this.lockfile.package_index.get(name_hash)) |index| {
                const resolutions: []Resolution = this.lockfile.packages.items(.resolution);
                switch (index) {
                    .id => |existing_id| {
                        if (existing_id < resolutions.len) {
                            const existing_resolution = resolutions[existing_id];
                            if (this.resolutionSatisfiesDependency(existing_resolution, version)) {
                                successFn(this, dependency_id, existing_id);
                                return .{
                                    // we must fetch it from the packages array again, incase the package array mutates the value in the `successFn`
                                    .package = this.lockfile.packages.get(existing_id),
                                };
                            }

                            const res_tag = resolutions[existing_id].tag;
                            const ver_tag = version.tag;
                            if ((res_tag == .npm and ver_tag == .npm) or (res_tag == .git and ver_tag == .git) or (res_tag == .github and ver_tag == .github)) {
                                const existing_package = this.lockfile.packages.get(existing_id);
                                this.log.addWarningFmt(
                                    null,
                                    logger.Loc.Empty,
                                    this.allocator,
                                    "incorrect peer dependency \"{}@{}\"",
                                    .{
                                        existing_package.name.fmt(this.lockfile.buffers.string_bytes.items),
                                        existing_package.resolution.fmt(this.lockfile.buffers.string_bytes.items, .auto),
                                    },
                                ) catch unreachable;
                                successFn(this, dependency_id, existing_id);
                                return .{
                                    // we must fetch it from the packages array again, incase the package array mutates the value in the `successFn`
                                    .package = this.lockfile.packages.get(existing_id),
                                };
                            }
                        }
                    },
                    .ids => |list| {
                        for (list.items) |existing_id| {
                            if (existing_id < resolutions.len) {
                                const existing_resolution = resolutions[existing_id];
                                if (this.resolutionSatisfiesDependency(existing_resolution, version)) {
                                    successFn(this, dependency_id, existing_id);
                                    return .{
                                        .package = this.lockfile.packages.get(existing_id),
                                    };
                                }
                            }
                        }

                        if (list.items[0] < resolutions.len) {
                            const res_tag = resolutions[list.items[0]].tag;
                            const ver_tag = version.tag;
                            if ((res_tag == .npm and ver_tag == .npm) or (res_tag == .git and ver_tag == .git) or (res_tag == .github and ver_tag == .github)) {
                                const existing_package_id = list.items[0];
                                const existing_package = this.lockfile.packages.get(existing_package_id);
                                this.log.addWarningFmt(
                                    null,
                                    logger.Loc.Empty,
                                    this.allocator,
                                    "incorrect peer dependency \"{}@{}\"",
                                    .{
                                        existing_package.name.fmt(this.lockfile.buffers.string_bytes.items),
                                        existing_package.resolution.fmt(this.lockfile.buffers.string_bytes.items, .auto),
                                    },
                                ) catch unreachable;
                                successFn(this, dependency_id, list.items[0]);
                                return .{
                                    // we must fetch it from the packages array again, incase the package array mutates the value in the `successFn`
                                    .package = this.lockfile.packages.get(existing_package_id),
                                };
                            }
                        }
                    },
                }
            }
        }

        if (resolution < this.lockfile.packages.len) {
            return .{ .package = this.lockfile.packages.get(resolution) };
        }

        switch (version.tag) {
            .npm, .dist_tag => {
                resolve_from_workspace: {
                    if (version.tag == .npm) {
                        const workspace_path = if (this.lockfile.workspace_paths.count() > 0) this.lockfile.workspace_paths.get(name_hash) else null;
                        const workspace_version = this.lockfile.workspace_versions.get(name_hash);
                        const buf = this.lockfile.buffers.string_bytes.items;
                        if (this.options.link_workspace_packages and
                            (((workspace_version != null and version.value.npm.version.satisfies(workspace_version.?, buf, buf)) or
                                // https://github.com/oven-sh/bun/pull/10899#issuecomment-2099609419
                                // if the workspace doesn't have a version, it can still be used if
                                // dependency version is wildcard
                                (workspace_path != null and version.value.npm.version.@"is *"()))))
                        {
                            const root_package = this.lockfile.rootPackage() orelse break :resolve_from_workspace;
                            const root_dependencies = root_package.dependencies.get(this.lockfile.buffers.dependencies.items);
                            const root_resolutions = root_package.resolutions.get(this.lockfile.buffers.resolutions.items);

                            for (root_dependencies, root_resolutions) |root_dep, workspace_package_id| {
                                if (workspace_package_id != invalid_package_id and root_dep.version.tag == .workspace and root_dep.name_hash == name_hash) {
                                    // make sure verifyResolutions sees this resolution as a valid package id
                                    successFn(this, dependency_id, workspace_package_id);
                                    return .{
                                        .package = this.lockfile.packages.get(workspace_package_id),
                                        .is_first_time = false,
                                    };
                                }
                            }
                        }
                    }
                }

                // Resolve the version from the loaded NPM manifest
                const name_str = this.lockfile.str(&name);
                const manifest = this.manifests.byNameHash(
                    this,
                    this.scopeForPackageName(name_str),
                    name_hash,
                    .load_from_memory_fallback_to_disk,
                ) orelse return null; // manifest might still be downloading. This feels unreliable.
                const find_result: Npm.PackageManifest.FindResult = switch (version.tag) {
                    .dist_tag => manifest.findByDistTag(this.lockfile.str(&version.value.dist_tag.tag)),
                    .npm => manifest.findBestVersion(version.value.npm.version, this.lockfile.buffers.string_bytes.items),
                    else => unreachable,
                } orelse {
                    resolve_workspace_from_dist_tag: {
                        // choose a workspace for a dist_tag only if a version was not found
                        if (version.tag == .dist_tag) {
                            const workspace_path = if (this.lockfile.workspace_paths.count() > 0) this.lockfile.workspace_paths.get(name_hash) else null;
                            if (workspace_path != null) {
                                const root_package = this.lockfile.rootPackage() orelse break :resolve_workspace_from_dist_tag;
                                const root_dependencies = root_package.dependencies.get(this.lockfile.buffers.dependencies.items);
                                const root_resolutions = root_package.resolutions.get(this.lockfile.buffers.resolutions.items);

                                for (root_dependencies, root_resolutions) |root_dep, workspace_package_id| {
                                    if (workspace_package_id != invalid_package_id and root_dep.version.tag == .workspace and root_dep.name_hash == name_hash) {
                                        // make sure verifyResolutions sees this resolution as a valid package id
                                        successFn(this, dependency_id, workspace_package_id);
                                        return .{
                                            .package = this.lockfile.packages.get(workspace_package_id),
                                            .is_first_time = false,
                                        };
                                    }
                                }
                            }
                        }
                    }

                    if (behavior.isPeer()) {
                        return null;
                    }

                    return switch (version.tag) {
                        .npm => error.NoMatchingVersion,
                        .dist_tag => error.DistTagNotFound,
                        else => unreachable,
                    };
                };

                return try this.getOrPutResolvedPackageWithFindResult(
                    name_hash,
                    name,
                    dependency,
                    version,
                    dependency_id,
                    behavior,
                    manifest,
                    find_result,
                    install_peer,
                    successFn,
                );
            },

            .folder => {
                const res: FolderResolution = res: {
                    if (this.lockfile.isWorkspaceDependency(dependency_id)) {
                        // relative to cwd
                        const folder_path = this.lockfile.str(&version.value.folder);
                        var buf2: bun.PathBuffer = undefined;
                        const folder_path_abs = if (std.fs.path.isAbsolute(folder_path)) folder_path else blk: {
                            break :blk Path.joinAbsStringBuf(
                                FileSystem.instance.top_level_dir,
                                &buf2,
                                &.{folder_path},
                                .auto,
                            );
                            // break :blk Path.joinAbsStringBuf(
                            //     strings.withoutSuffixComptime(this.original_package_json_path, "package.json"),
                            //     &buf2,
                            //     &[_]string{folder_path},
                            //     .auto,
                            // );
                        };
                        break :res FolderResolution.getOrPut(.{ .relative = .folder }, version, folder_path_abs, this);
                    }

                    // transitive folder dependencies do not have their dependencies resolved
                    var name_slice = this.lockfile.str(&name);
                    var folder_path = this.lockfile.str(&version.value.folder);
                    var package = Lockfile.Package{};

                    {
                        // only need name and path
                        var builder = this.lockfile.stringBuilder();

                        builder.count(name_slice);
                        builder.count(folder_path);

                        builder.allocate() catch bun.outOfMemory();

                        name_slice = this.lockfile.str(&name);
                        folder_path = this.lockfile.str(&version.value.folder);

                        package.name = builder.append(String, name_slice);
                        package.name_hash = name_hash;

                        package.resolution = Resolution.init(.{
                            .folder = builder.append(String, folder_path),
                        });

                        package.scripts.filled = true;
                        package.meta.setHasInstallScript(false);

                        builder.clamp();
                    }

                    // these are always new
                    package = this.lockfile.appendPackage(package) catch bun.outOfMemory();

                    break :res .{
                        .new_package_id = package.meta.id,
                    };
                };

                switch (res) {
                    .err => |err| return err,
                    .package_id => |package_id| {
                        successFn(this, dependency_id, package_id);
                        return .{ .package = this.lockfile.packages.get(package_id) };
                    },

                    .new_package_id => |package_id| {
                        successFn(this, dependency_id, package_id);
                        return .{ .package = this.lockfile.packages.get(package_id), .is_first_time = true };
                    },
                }
            },
            .workspace => {
                // package name hash should be used to find workspace path from map
                const workspace_path_raw: *const String = this.lockfile.workspace_paths.getPtr(name_hash) orelse &version.value.workspace;
                const workspace_path = this.lockfile.str(workspace_path_raw);
                var buf2: bun.PathBuffer = undefined;
                const workspace_path_u8 = if (std.fs.path.isAbsolute(workspace_path)) workspace_path else blk: {
                    break :blk Path.joinAbsStringBuf(FileSystem.instance.top_level_dir, &buf2, &[_]string{workspace_path}, .auto);
                };

                const res = FolderResolution.getOrPut(.{ .relative = .workspace }, version, workspace_path_u8, this);

                switch (res) {
                    .err => |err| return err,
                    .package_id => |package_id| {
                        successFn(this, dependency_id, package_id);
                        return .{ .package = this.lockfile.packages.get(package_id) };
                    },

                    .new_package_id => |package_id| {
                        successFn(this, dependency_id, package_id);
                        return .{ .package = this.lockfile.packages.get(package_id), .is_first_time = true };
                    },
                }
            },
            .symlink => {
                const res = FolderResolution.getOrPut(.{ .global = try this.globalLinkDirPath() }, version, this.lockfile.str(&version.value.symlink), this);

                switch (res) {
                    .err => |err| return err,
                    .package_id => |package_id| {
                        successFn(this, dependency_id, package_id);
                        return .{ .package = this.lockfile.packages.get(package_id) };
                    },

                    .new_package_id => |package_id| {
                        successFn(this, dependency_id, package_id);
                        return .{ .package = this.lockfile.packages.get(package_id), .is_first_time = true };
                    },
                }
            },

            else => return null,
        }
    }

    fn enqueueParseNPMPackage(
        this: *PackageManager,
        task_id: u64,
        name: strings.StringOrTinyString,
        network_task: *NetworkTask,
    ) *ThreadPool.Task {
        var task = this.preallocated_resolve_tasks.get();
        task.* = Task{
            .package_manager = this,
            .log = logger.Log.init(this.allocator),
            .tag = Task.Tag.package_manifest,
            .request = .{
                .package_manifest = .{
                    .network = network_task,
                    .name = name,
                },
            },
            .id = task_id,
            .data = undefined,
        };
        return &task.threadpool_task;
    }

    fn enqueueExtractNPMPackage(
        this: *PackageManager,
        tarball: *const ExtractTarball,
        network_task: *NetworkTask,
    ) *ThreadPool.Task {
        var task = this.preallocated_resolve_tasks.get();
        task.* = Task{
            .package_manager = this,
            .log = logger.Log.init(this.allocator),
            .tag = Task.Tag.extract,
            .request = .{
                .extract = .{
                    .network = network_task,
                    .tarball = tarball.*,
                },
            },
            .id = network_task.task_id,
            .data = undefined,
        };
        task.request.extract.tarball.skip_verify = !this.options.do.verify_integrity;
        return &task.threadpool_task;
    }

    fn enqueueGitClone(
        this: *PackageManager,
        task_id: u64,
        name: string,
        repository: *const Repository,
        dep_id: DependencyID,
        dependency: *const Dependency,
        res: *const Resolution,
        /// if patched then we need to do apply step after network task is done
        patch_name_and_version_hash: ?u64,
    ) *ThreadPool.Task {
        var task = this.preallocated_resolve_tasks.get();
        task.* = Task{
            .package_manager = this,
            .log = logger.Log.init(this.allocator),
            .tag = Task.Tag.git_clone,
            .request = .{
                .git_clone = .{
                    .name = strings.StringOrTinyString.initAppendIfNeeded(
                        name,
                        *FileSystem.FilenameStore,
                        FileSystem.FilenameStore.instance,
                    ) catch unreachable,
                    .url = strings.StringOrTinyString.initAppendIfNeeded(
                        this.lockfile.str(&repository.repo),
                        *FileSystem.FilenameStore,
                        FileSystem.FilenameStore.instance,
                    ) catch unreachable,
                    .env = Repository.shared_env.get(this.allocator, this.env),
                    .dep_id = dep_id,
                    .res = res.*,
                },
            },
            .id = task_id,
            .apply_patch_task = if (patch_name_and_version_hash) |h| brk: {
                const dep = dependency;
                const pkg_id = switch (this.lockfile.package_index.get(dep.name_hash) orelse @panic("Package not found")) {
                    .id => |p| p,
                    .ids => |ps| ps.items[0], // TODO is this correct
                };
                const patch_hash = this.lockfile.patched_dependencies.get(h).?.patchfileHash().?;
                const pt = PatchTask.newApplyPatchHash(this, pkg_id, patch_hash, h);
                pt.callback.apply.task_id = task_id;
                break :brk pt;
            } else null,
            .data = undefined,
        };
        return &task.threadpool_task;
    }

    fn enqueueGitCheckout(
        this: *PackageManager,
        task_id: u64,
        dir: bun.FileDescriptor,
        dependency_id: DependencyID,
        name: string,
        resolution: Resolution,
        resolved: string,
        /// if patched then we need to do apply step after network task is done
        patch_name_and_version_hash: ?u64,
    ) *ThreadPool.Task {
        var task = this.preallocated_resolve_tasks.get();
        task.* = Task{
            .package_manager = this,
            .log = logger.Log.init(this.allocator),
            .tag = Task.Tag.git_checkout,
            .request = .{
                .git_checkout = .{
                    .repo_dir = dir,
                    .resolution = resolution,
                    .dependency_id = dependency_id,
                    .name = strings.StringOrTinyString.initAppendIfNeeded(
                        name,
                        *FileSystem.FilenameStore,
                        FileSystem.FilenameStore.instance,
                    ) catch unreachable,
                    .url = strings.StringOrTinyString.initAppendIfNeeded(
                        this.lockfile.str(&resolution.value.git.repo),
                        *FileSystem.FilenameStore,
                        FileSystem.FilenameStore.instance,
                    ) catch unreachable,
                    .resolved = strings.StringOrTinyString.initAppendIfNeeded(
                        resolved,
                        *FileSystem.FilenameStore,
                        FileSystem.FilenameStore.instance,
                    ) catch unreachable,
                    .env = Repository.shared_env.get(this.allocator, this.env),
                },
            },
            .apply_patch_task = if (patch_name_and_version_hash) |h| brk: {
                const dep = this.lockfile.buffers.dependencies.items[dependency_id];
                const pkg_id = switch (this.lockfile.package_index.get(dep.name_hash) orelse @panic("Package not found")) {
                    .id => |p| p,
                    .ids => |ps| ps.items[0], // TODO is this correct
                };
                const patch_hash = this.lockfile.patched_dependencies.get(h).?.patchfileHash().?;
                const pt = PatchTask.newApplyPatchHash(this, pkg_id, patch_hash, h);
                pt.callback.apply.task_id = task_id;
                break :brk pt;
            } else null,
            .id = task_id,
            .data = undefined,
        };
        return &task.threadpool_task;
    }

    fn enqueueLocalTarball(
        this: *PackageManager,
        task_id: u64,
        dependency_id: DependencyID,
        name: string,
        path: string,
        resolution: Resolution,
    ) *ThreadPool.Task {
        var task = this.preallocated_resolve_tasks.get();
        task.* = Task{
            .package_manager = this,
            .log = logger.Log.init(this.allocator),
            .tag = Task.Tag.local_tarball,
            .request = .{
                .local_tarball = .{
                    .tarball = .{
                        .package_manager = this,
                        .name = strings.StringOrTinyString.initAppendIfNeeded(
                            name,
                            *FileSystem.FilenameStore,
                            FileSystem.FilenameStore.instance,
                        ) catch unreachable,
                        .resolution = resolution,
                        .cache_dir = this.getCacheDirectory(),
                        .temp_dir = this.getTemporaryDirectory(),
                        .dependency_id = dependency_id,
                        .url = strings.StringOrTinyString.initAppendIfNeeded(
                            path,
                            *FileSystem.FilenameStore,
                            FileSystem.FilenameStore.instance,
                        ) catch unreachable,
                    },
                },
            },
            .id = task_id,
            .data = undefined,
        };
        return &task.threadpool_task;
    }

    pub fn updateLockfileIfNeeded(
        manager: *PackageManager,
        load_result: Lockfile.LoadResult,
    ) !void {
        if (load_result == .ok and load_result.ok.serializer_result.packages_need_update) {
            const slice = manager.lockfile.packages.slice();
            for (slice.items(.meta)) |*meta| {
                // these are possibly updated later, but need to make sure non are zero
                meta.setHasInstallScript(false);
            }
        }

        return;
    }

    pub fn writeYarnLock(this: *PackageManager) !void {
        var printer = Lockfile.Printer{
            .lockfile = this.lockfile,
            .options = this.options,
        };

        var tmpname_buf: [512]u8 = undefined;
        tmpname_buf[0..8].* = "tmplock-".*;
        var tmpfile = FileSystem.RealFS.Tmpfile{};
        var secret: [32]u8 = undefined;
        std.mem.writeInt(u64, secret[0..8], @as(u64, @intCast(std.time.milliTimestamp())), .little);
        var base64_bytes: [64]u8 = undefined;
        std.crypto.random.bytes(&base64_bytes);

        const tmpname__ = std.fmt.bufPrint(tmpname_buf[8..], "{s}", .{std.fmt.fmtSliceHexLower(&base64_bytes)}) catch unreachable;
        tmpname_buf[tmpname__.len + 8] = 0;
        const tmpname = tmpname_buf[0 .. tmpname__.len + 8 :0];

        tmpfile.create(&FileSystem.instance.fs, tmpname) catch |err| {
            Output.prettyErrorln("<r><red>error:<r> failed to create tmpfile: {s}", .{@errorName(err)});
            Global.crash();
        };

        var file = tmpfile.file();
        const file_writer = file.writer();
        var buffered_writer = std.io.BufferedWriter(std.heap.page_size_min, @TypeOf(file_writer)){
            .unbuffered_writer = file_writer,
        };
        const writer = buffered_writer.writer();
        try Lockfile.Printer.Yarn.print(&printer, @TypeOf(writer), writer);
        try buffered_writer.flush();

        if (comptime Environment.isPosix) {
            _ = bun.c.fchmod(
                tmpfile.fd.cast(),
                // chmod 666,
                0o0000040 | 0o0000004 | 0o0000002 | 0o0000400 | 0o0000200 | 0o0000020,
            );
        }

        try tmpfile.promoteToCWD(tmpname, "yarn.lock");
    }

    fn enqueueDependencyWithMain(
        this: *PackageManager,
        id: DependencyID,
        /// This must be a *const to prevent UB
        dependency: *const Dependency,
        resolution: PackageID,
        install_peer: bool,
    ) !void {
        return this.enqueueDependencyWithMainAndSuccessFn(
            id,
            dependency,
            resolution,
            install_peer,
            assignResolution,
            null,
        );
    }

    const debug = Output.scoped(.PackageManager, true);

    fn updateNameAndNameHashFromVersionReplacement(
        lockfile: *const Lockfile,
        original_name: String,
        original_name_hash: PackageNameHash,
        new_version: Dependency.Version,
    ) struct { String, PackageNameHash } {
        return switch (new_version.tag) {
            // only get name hash for npm and dist_tag. git, github, tarball don't have names until after extracting tarball
            .dist_tag => .{ new_version.value.dist_tag.name, String.Builder.stringHash(lockfile.str(&new_version.value.dist_tag.name)) },
            .npm => .{ new_version.value.npm.name, String.Builder.stringHash(lockfile.str(&new_version.value.npm.name)) },
            .git => .{ new_version.value.git.package_name, original_name_hash },
            .github => .{ new_version.value.github.package_name, original_name_hash },
            .tarball => .{ new_version.value.tarball.package_name, original_name_hash },
            else => .{ original_name, original_name_hash },
        };
    }

    /// Q: "What do we do with a dependency in a package.json?"
    /// A: "We enqueue it!"
    fn enqueueDependencyWithMainAndSuccessFn(
        this: *PackageManager,
        id: DependencyID,
        /// This must be a *const to prevent UB
        dependency: *const Dependency,
        resolution: PackageID,
        install_peer: bool,
        comptime successFn: SuccessFn,
        comptime failFn: ?FailFn,
    ) !void {
        if (dependency.behavior.isOptionalPeer()) return;

        var name = dependency.realname();

        var name_hash = switch (dependency.version.tag) {
            .dist_tag, .git, .github, .npm, .tarball, .workspace => String.Builder.stringHash(this.lockfile.str(&name)),
            else => dependency.name_hash,
        };

        const version = version: {
            if (dependency.version.tag == .npm) {
                if (this.known_npm_aliases.get(name_hash)) |aliased| {
                    const group = dependency.version.value.npm.version;
                    const buf = this.lockfile.buffers.string_bytes.items;
                    var curr_list: ?*const Semver.Query.List = &aliased.value.npm.version.head;
                    while (curr_list) |queries| {
                        var curr: ?*const Semver.Query = &queries.head;
                        while (curr) |query| {
                            if (group.satisfies(query.range.left.version, buf, buf) or group.satisfies(query.range.right.version, buf, buf)) {
                                name = aliased.value.npm.name;
                                name_hash = String.Builder.stringHash(this.lockfile.str(&name));
                                break :version aliased;
                            }
                            curr = query.next;
                        }
                        curr_list = queries.next;
                    }

                    // fallthrough. a package that matches the name of an alias but does not match
                    // the version should be enqueued as a normal npm dependency, overrides allowed
                }
            }

            // allow overriding all dependencies unless the dependency is coming directly from an alias, "npm:<this dep>" or
            // if it's a workspaceOnly dependency
            if (!dependency.behavior.isWorkspaceOnly() and (dependency.version.tag != .npm or !dependency.version.value.npm.is_alias)) {
                if (this.lockfile.overrides.get(name_hash)) |new| {
                    debug("override: {s} -> {s}", .{ this.lockfile.str(&dependency.version.literal), this.lockfile.str(&new.literal) });

                    name, name_hash = updateNameAndNameHashFromVersionReplacement(this.lockfile, name, name_hash, new);

                    if (new.tag == .catalog) {
                        if (this.lockfile.catalogs.get(this.lockfile, new.value.catalog, name)) |catalog_dep| {
                            name, name_hash = updateNameAndNameHashFromVersionReplacement(this.lockfile, name, name_hash, catalog_dep.version);
                            break :version catalog_dep.version;
                        }
                    }

                    // `name_hash` stays the same
                    break :version new;
                }

                if (dependency.version.tag == .catalog) {
                    if (this.lockfile.catalogs.get(this.lockfile, dependency.version.value.catalog, name)) |catalog_dep| {
                        name, name_hash = updateNameAndNameHashFromVersionReplacement(this.lockfile, name, name_hash, catalog_dep.version);

                        break :version catalog_dep.version;
                    }
                }
            }

            // explicit copy here due to `dependency.version` becoming undefined
            // when `getOrPutResolvedPackageWithFindResult` is called and resizes the list.
            break :version Dependency.Version{
                .literal = dependency.version.literal,
                .tag = dependency.version.tag,
                .value = dependency.version.value,
            };
        };
        var loaded_manifest: ?Npm.PackageManifest = null;

        switch (version.tag) {
            .dist_tag, .folder, .npm => {
                retry_from_manifests_ptr: while (true) {
                    var resolve_result_ = this.getOrPutResolvedPackage(
                        name_hash,
                        name,
                        dependency,
                        version,
                        dependency.behavior,
                        id,
                        resolution,
                        install_peer,
                        successFn,
                    );

                    retry_with_new_resolve_result: while (true) {
                        const resolve_result = resolve_result_ catch |err| {
                            switch (err) {
                                error.DistTagNotFound => {
                                    if (dependency.behavior.isRequired()) {
                                        if (failFn) |fail| {
                                            fail(
                                                this,
                                                dependency,
                                                id,
                                                err,
                                            );
                                        } else {
                                            this.log.addErrorFmt(
                                                null,
                                                logger.Loc.Empty,
                                                this.allocator,
                                                "Package \"{s}\" with tag \"{s}\" not found, but package exists",
                                                .{
                                                    this.lockfile.str(&name),
                                                    this.lockfile.str(&version.value.dist_tag.tag),
                                                },
                                            ) catch unreachable;
                                        }
                                    }

                                    return;
                                },
                                error.NoMatchingVersion => {
                                    if (dependency.behavior.isRequired()) {
                                        if (failFn) |fail| {
                                            fail(
                                                this,
                                                dependency,
                                                id,
                                                err,
                                            );
                                        } else {
                                            this.log.addErrorFmt(
                                                null,
                                                logger.Loc.Empty,
                                                this.allocator,
                                                "No version matching \"{s}\" found for specifier \"{s}\" (but package exists)",
                                                .{
                                                    this.lockfile.str(&version.literal),
                                                    this.lockfile.str(&name),
                                                },
                                            ) catch unreachable;
                                        }
                                    }
                                    return;
                                },
                                else => {
                                    if (failFn) |fail| {
                                        fail(
                                            this,
                                            dependency,
                                            id,
                                            err,
                                        );
                                        return;
                                    }

                                    return err;
                                },
                            }
                        };

                        if (resolve_result) |result| {
                            // First time?
                            if (result.is_first_time) {
                                if (PackageManager.verbose_install) {
                                    const label: string = this.lockfile.str(&version.literal);

                                    Output.prettyErrorln("   -> \"{s}\": \"{s}\" -> {s}@{}", .{
                                        this.lockfile.str(&result.package.name),
                                        label,
                                        this.lockfile.str(&result.package.name),
                                        result.package.resolution.fmt(this.lockfile.buffers.string_bytes.items, .auto),
                                    });
                                }
                                // Resolve dependencies first
                                if (result.package.dependencies.len > 0) {
                                    try this.lockfile.scratch.dependency_list_queue.writeItem(result.package.dependencies);
                                }
                            }

                            if (result.task != null) {
                                switch (result.task.?) {
                                    .network_task => |network_task| {
                                        if (this.getPreinstallState(result.package.meta.id) == .extract) {
                                            this.setPreinstallState(result.package.meta.id, this.lockfile, .extracting);
                                            this.enqueueNetworkTask(network_task);
                                        }
                                    },
                                    .patch_task => |patch_task| {
                                        if (patch_task.callback == .calc_hash and this.getPreinstallState(result.package.meta.id) == .calc_patch_hash) {
                                            this.setPreinstallState(result.package.meta.id, this.lockfile, .calcing_patch_hash);
                                            this.enqueuePatchTask(patch_task);
                                        } else if (patch_task.callback == .apply and this.getPreinstallState(result.package.meta.id) == .apply_patch) {
                                            this.setPreinstallState(result.package.meta.id, this.lockfile, .applying_patch);
                                            this.enqueuePatchTask(patch_task);
                                        }
                                    },
                                }
                            }

                            if (comptime Environment.allow_assert)
                                debug(
                                    "enqueueDependency({d}, {s}, {s}, {s}) = {d}",
                                    .{
                                        id,
                                        @tagName(version.tag),
                                        this.lockfile.str(&name),
                                        this.lockfile.str(&version.literal),
                                        result.package.meta.id,
                                    },
                                );
                        } else if (version.tag.isNPM()) {
                            const name_str = this.lockfile.str(&name);
                            const task_id = Task.Id.forManifest(name_str);

                            if (comptime Environment.allow_assert) bun.assert(task_id != 0);

                            if (comptime Environment.allow_assert)
                                debug(
                                    "enqueueDependency({d}, {s}, {s}, {s}) = task {d}",
                                    .{
                                        id,
                                        @tagName(version.tag),
                                        this.lockfile.str(&name),
                                        this.lockfile.str(&version.literal),
                                        task_id,
                                    },
                                );

                            if (!dependency.behavior.isPeer() or install_peer) {
                                if (!this.hasCreatedNetworkTask(task_id, dependency.behavior.isRequired())) {
                                    if (this.options.enable.manifest_cache) {
                                        var expired = false;
                                        if (this.manifests.byNameHashAllowExpired(
                                            this,
                                            this.scopeForPackageName(name_str),
                                            name_hash,
                                            &expired,
                                            .load_from_memory_fallback_to_disk,
                                        )) |manifest| {
                                            loaded_manifest = manifest.*;

                                            // If it's an exact package version already living in the cache
                                            // We can skip the network request, even if it's beyond the caching period
                                            if (version.tag == .npm and version.value.npm.version.isExact()) {
                                                if (loaded_manifest.?.findByVersion(version.value.npm.version.head.head.range.left.version)) |find_result| {
                                                    if (this.getOrPutResolvedPackageWithFindResult(
                                                        name_hash,
                                                        name,
                                                        dependency,
                                                        version,
                                                        id,
                                                        dependency.behavior,
                                                        &loaded_manifest.?,
                                                        find_result,
                                                        install_peer,
                                                        successFn,
                                                    ) catch null) |new_resolve_result| {
                                                        resolve_result_ = new_resolve_result;
                                                        _ = this.network_dedupe_map.remove(task_id);
                                                        continue :retry_with_new_resolve_result;
                                                    }
                                                }
                                            }

                                            // Was it recent enough to just load it without the network call?
                                            if (this.options.enable.manifest_cache_control and !expired) {
                                                _ = this.network_dedupe_map.remove(task_id);
                                                continue :retry_from_manifests_ptr;
                                            }
                                        }
                                    }

                                    if (PackageManager.verbose_install) {
                                        Output.prettyErrorln("Enqueue package manifest for download: {s}", .{name_str});
                                    }

                                    var network_task = this.getNetworkTask();
                                    network_task.* = .{
                                        .package_manager = this,
                                        .callback = undefined,
                                        .task_id = task_id,
                                        .allocator = this.allocator,
                                    };
                                    try network_task.forManifest(
                                        name_str,
                                        this.allocator,
                                        this.scopeForPackageName(name_str),
                                        if (loaded_manifest) |*manifest| manifest else null,
                                        dependency.behavior.isOptional(),
                                    );
                                    this.enqueueNetworkTask(network_task);
                                }
                            } else {
                                try this.peer_dependencies.writeItem(id);
                                return;
                            }

                            var manifest_entry_parse = try this.task_queue.getOrPutContext(this.allocator, task_id, .{});
                            if (!manifest_entry_parse.found_existing) {
                                manifest_entry_parse.value_ptr.* = TaskCallbackList{};
                            }

                            const callback_tag = comptime if (successFn == assignRootResolution) "root_dependency" else "dependency";
                            try manifest_entry_parse.value_ptr.append(this.allocator, @unionInit(TaskCallbackContext, callback_tag, id));
                        }
                        return;
                    }
                }
                return;
            },
            .git => {
                const dep = &version.value.git;
                const res = Resolution{
                    .tag = .git,
                    .value = .{
                        .git = dep.*,
                    },
                };

                // First: see if we already loaded the git package in-memory
                if (this.lockfile.getPackageID(name_hash, null, &res)) |pkg_id| {
                    successFn(this, id, pkg_id);
                    return;
                }

                const alias = this.lockfile.str(&dependency.name);
                const url = this.lockfile.str(&dep.repo);
                const clone_id = Task.Id.forGitClone(url);
                const ctx = @unionInit(
                    TaskCallbackContext,
                    if (successFn == assignRootResolution) "root_dependency" else "dependency",
                    id,
                );

                if (comptime Environment.allow_assert)
                    debug(
                        "enqueueDependency({d}, {s}, {s}, {s}) = {s}",
                        .{
                            id,
                            @tagName(version.tag),
                            this.lockfile.str(&name),
                            this.lockfile.str(&version.literal),
                            url,
                        },
                    );

                if (this.git_repositories.get(clone_id)) |repo_fd| {
                    const resolved = try Repository.findCommit(
                        this.allocator,
                        this.env,
                        this.log,
                        repo_fd.stdDir(),
                        alias,
                        this.lockfile.str(&dep.committish),
                        clone_id,
                    );
                    const checkout_id = Task.Id.forGitCheckout(url, resolved);

                    var entry = this.task_queue.getOrPutContext(this.allocator, checkout_id, .{}) catch unreachable;
                    if (!entry.found_existing) entry.value_ptr.* = .{};
                    if (this.lockfile.buffers.resolutions.items[id] == invalid_package_id) {
                        try entry.value_ptr.append(this.allocator, ctx);
                    }

                    if (dependency.behavior.isPeer()) {
                        if (!install_peer) {
                            try this.peer_dependencies.writeItem(id);
                            return;
                        }
                    }

                    if (this.hasCreatedNetworkTask(checkout_id, dependency.behavior.isRequired())) return;

                    this.task_batch.push(ThreadPool.Batch.from(this.enqueueGitCheckout(
                        checkout_id,
                        repo_fd,
                        id,
                        alias,
                        res,
                        resolved,
                        null,
                    )));
                } else {
                    var entry = this.task_queue.getOrPutContext(this.allocator, clone_id, .{}) catch unreachable;
                    if (!entry.found_existing) entry.value_ptr.* = .{};
                    try entry.value_ptr.append(this.allocator, ctx);

                    if (dependency.behavior.isPeer()) {
                        if (!install_peer) {
                            try this.peer_dependencies.writeItem(id);
                            return;
                        }
                    }

                    if (this.hasCreatedNetworkTask(clone_id, dependency.behavior.isRequired())) return;

                    this.task_batch.push(ThreadPool.Batch.from(this.enqueueGitClone(clone_id, alias, dep, id, dependency, &res, null)));
                }
            },
            .github => {
                const dep = &version.value.github;
                const res = Resolution{
                    .tag = .github,
                    .value = .{
                        .github = dep.*,
                    },
                };

                // First: see if we already loaded the github package in-memory
                if (this.lockfile.getPackageID(name_hash, null, &res)) |pkg_id| {
                    successFn(this, id, pkg_id);
                    return;
                }

                const url = this.allocGitHubURL(dep);
                defer this.allocator.free(url);
                const task_id = Task.Id.forTarball(url);
                var entry = this.task_queue.getOrPutContext(this.allocator, task_id, .{}) catch unreachable;
                if (!entry.found_existing) {
                    entry.value_ptr.* = TaskCallbackList{};
                }

                if (comptime Environment.allow_assert)
                    debug(
                        "enqueueDependency({d}, {s}, {s}, {s}) = {s}",
                        .{
                            id,
                            @tagName(version.tag),
                            this.lockfile.str(&name),
                            this.lockfile.str(&version.literal),
                            url,
                        },
                    );

                const callback_tag = comptime if (successFn == assignRootResolution) "root_dependency" else "dependency";
                try entry.value_ptr.append(this.allocator, @unionInit(TaskCallbackContext, callback_tag, id));

                if (dependency.behavior.isPeer()) {
                    if (!install_peer) {
                        try this.peer_dependencies.writeItem(id);
                        return;
                    }
                }

                if (try this.generateNetworkTaskForTarball(
                    task_id,
                    url,
                    dependency.behavior.isRequired(),
                    id,
                    .{
                        .name = dependency.name,
                        .name_hash = dependency.name_hash,
                        .resolution = res,
                    },
                    null,
                    .no_authorization,
                )) |network_task| {
                    this.enqueueNetworkTask(network_task);
                }
            },
            inline .symlink, .workspace => |dependency_tag| {
                const _result = this.getOrPutResolvedPackage(
                    name_hash,
                    name,
                    dependency,
                    version,
                    dependency.behavior,
                    id,
                    resolution,
                    install_peer,
                    successFn,
                ) catch |err| brk: {
                    if (err == error.MissingPackageJSON) {
                        break :brk @as(?ResolvedPackageResult, null);
                    }

                    return err;
                };

                const workspace_not_found_fmt =
                    \\Workspace dependency "{[name]s}" not found
                    \\
                    \\Searched in <b>{[search_path]}<r>
                    \\
                    \\Workspace documentation: https://bun.sh/docs/install/workspaces
                    \\
                ;
                const link_not_found_fmt =
                    \\Package "{[name]s}" is not linked
                    \\
                    \\To install a linked package:
                    \\   <cyan>bun link my-pkg-name-from-package-json<r>
                    \\
                    \\Tip: the package name is from package.json, which can differ from the folder name.
                    \\
                ;
                if (_result) |result| {
                    // First time?
                    if (result.is_first_time) {
                        if (PackageManager.verbose_install) {
                            const label: string = this.lockfile.str(&version.literal);

                            Output.prettyErrorln("   -> \"{s}\": \"{s}\" -> {s}@{}", .{
                                this.lockfile.str(&result.package.name),
                                label,
                                this.lockfile.str(&result.package.name),
                                result.package.resolution.fmt(this.lockfile.buffers.string_bytes.items, .auto),
                            });
                        }
                        // We shouldn't see any dependencies
                        if (result.package.dependencies.len > 0) {
                            try this.lockfile.scratch.dependency_list_queue.writeItem(result.package.dependencies);
                        }
                    }

                    // should not trigger a network call
                    if (comptime Environment.allow_assert) bun.assert(result.task == null);

                    if (comptime Environment.allow_assert)
                        debug(
                            "enqueueDependency({d}, {s}, {s}, {s}) = {d}",
                            .{
                                id,
                                @tagName(version.tag),
                                this.lockfile.str(&name),
                                this.lockfile.str(&version.literal),
                                result.package.meta.id,
                            },
                        );
                } else if (dependency.behavior.isRequired()) {
                    if (comptime dependency_tag == .workspace) {
                        this.log.addErrorFmt(
                            null,
                            logger.Loc.Empty,
                            this.allocator,
                            workspace_not_found_fmt,
                            .{
                                .name = this.lockfile.str(&name),
                                .search_path = FolderResolution.PackageWorkspaceSearchPathFormatter{ .manager = this, .version = version },
                            },
                        ) catch unreachable;
                    } else {
                        this.log.addErrorFmt(
                            null,
                            logger.Loc.Empty,
                            this.allocator,
                            link_not_found_fmt,
                            .{
                                .name = this.lockfile.str(&name),
                            },
                        ) catch unreachable;
                    }
                } else if (this.options.log_level.isVerbose()) {
                    if (comptime dependency_tag == .workspace) {
                        this.log.addWarningFmt(
                            null,
                            logger.Loc.Empty,
                            this.allocator,
                            workspace_not_found_fmt,
                            .{
                                .name = this.lockfile.str(&name),
                                .search_path = FolderResolution.PackageWorkspaceSearchPathFormatter{ .manager = this, .version = version },
                            },
                        ) catch unreachable;
                    } else {
                        this.log.addWarningFmt(
                            null,
                            logger.Loc.Empty,
                            this.allocator,
                            link_not_found_fmt,
                            .{
                                .name = this.lockfile.str(&name),
                            },
                        ) catch unreachable;
                    }
                }
            },
            .tarball => {
                const res: Resolution = switch (version.value.tarball.uri) {
                    .local => |path| .{
                        .tag = .local_tarball,
                        .value = .{
                            .local_tarball = path,
                        },
                    },
                    .remote => |url| .{
                        .tag = .remote_tarball,
                        .value = .{
                            .remote_tarball = url,
                        },
                    },
                };

                // First: see if we already loaded the tarball package in-memory
                if (this.lockfile.getPackageID(name_hash, null, &res)) |pkg_id| {
                    successFn(this, id, pkg_id);
                    return;
                }

                const url = switch (version.value.tarball.uri) {
                    .local => |path| this.lockfile.str(&path),
                    .remote => |url| this.lockfile.str(&url),
                };
                const task_id = Task.Id.forTarball(url);
                var entry = this.task_queue.getOrPutContext(this.allocator, task_id, .{}) catch unreachable;
                if (!entry.found_existing) {
                    entry.value_ptr.* = TaskCallbackList{};
                }

                if (comptime Environment.allow_assert)
                    debug(
                        "enqueueDependency({d}, {s}, {s}, {s}) = {s}",
                        .{
                            id,
                            @tagName(version.tag),
                            this.lockfile.str(&name),
                            this.lockfile.str(&version.literal),
                            url,
                        },
                    );

                const callback_tag = comptime if (successFn == assignRootResolution) "root_dependency" else "dependency";
                try entry.value_ptr.append(this.allocator, @unionInit(TaskCallbackContext, callback_tag, id));

                if (dependency.behavior.isPeer()) {
                    if (!install_peer) {
                        try this.peer_dependencies.writeItem(id);
                        return;
                    }
                }

                switch (version.value.tarball.uri) {
                    .local => {
                        if (this.hasCreatedNetworkTask(task_id, dependency.behavior.isRequired())) return;

                        this.task_batch.push(ThreadPool.Batch.from(this.enqueueLocalTarball(
                            task_id,
                            id,
                            this.lockfile.str(&dependency.name),
                            url,
                            res,
                        )));
                    },
                    .remote => {
                        if (try this.generateNetworkTaskForTarball(
                            task_id,
                            url,
                            dependency.behavior.isRequired(),
                            id,
                            .{
                                .name = dependency.name,
                                .name_hash = dependency.name_hash,
                                .resolution = res,
                            },
                            null,
                            .no_authorization,
                        )) |network_task| {
                            this.enqueueNetworkTask(network_task);
                        }
                    },
                }
            },
            else => {},
        }
    }

    pub fn flushNetworkQueue(this: *PackageManager) void {
        var network = &this.network_task_fifo;

        while (network.readItem()) |network_task| {
            network_task.schedule(if (network_task.callback == .extract) &this.network_tarball_batch else &this.network_resolve_batch);
        }
    }

    fn flushPatchTaskQueue(this: *PackageManager) void {
        var patch_task_fifo = &this.patch_task_fifo;

        while (patch_task_fifo.readItem()) |patch_task| {
            patch_task.schedule(if (patch_task.callback == .apply) &this.patch_apply_batch else &this.patch_calc_hash_batch);
        }
    }

    fn doFlushDependencyQueue(this: *PackageManager) void {
        var lockfile = this.lockfile;
        var dependency_queue = &lockfile.scratch.dependency_list_queue;

        while (dependency_queue.readItem()) |dependencies_list| {
            var i: u32 = dependencies_list.off;
            const end = dependencies_list.off + dependencies_list.len;
            while (i < end) : (i += 1) {
                const dependency = lockfile.buffers.dependencies.items[i];
                this.enqueueDependencyWithMain(
                    i,
                    &dependency,
                    lockfile.buffers.resolutions.items[i],
                    false,
                ) catch {};
            }
        }

        this.flushNetworkQueue();
    }
    pub fn flushDependencyQueue(this: *PackageManager) void {
        var last_count = this.total_tasks;
        while (true) : (last_count = this.total_tasks) {
            this.flushNetworkQueue();
            this.doFlushDependencyQueue();
            this.flushNetworkQueue();
            this.flushPatchTaskQueue();

            if (this.total_tasks == last_count) break;
        }
    }

    pub fn scheduleTasks(manager: *PackageManager) usize {
        const count = manager.task_batch.len + manager.network_resolve_batch.len + manager.network_tarball_batch.len + manager.patch_apply_batch.len + manager.patch_calc_hash_batch.len;

        _ = manager.incrementPendingTasks(@truncate(count));
        manager.thread_pool.schedule(manager.patch_apply_batch);
        manager.thread_pool.schedule(manager.patch_calc_hash_batch);
        manager.thread_pool.schedule(manager.task_batch);
        manager.network_resolve_batch.push(manager.network_tarball_batch);
        HTTP.http_thread.schedule(manager.network_resolve_batch);
        manager.task_batch = .{};
        manager.network_tarball_batch = .{};
        manager.network_resolve_batch = .{};
        manager.patch_apply_batch = .{};
        manager.patch_calc_hash_batch = .{};
        return count;
    }

    pub fn enqueueDependencyList(
        this: *PackageManager,
        dependencies_list: Lockfile.DependencySlice,
    ) void {
        this.task_queue.ensureUnusedCapacity(this.allocator, dependencies_list.len) catch unreachable;
        const lockfile = this.lockfile;

        // Step 1. Go through main dependencies
        var begin = dependencies_list.off;
        const end = dependencies_list.off +| dependencies_list.len;

        // if dependency is peer and is going to be installed
        // through "dependencies", skip it
        if (end - begin > 1 and lockfile.buffers.dependencies.items[0].behavior.isPeer()) {
            var peer_i: usize = 0;
            var peer = &lockfile.buffers.dependencies.items[peer_i];
            while (peer.behavior.isPeer()) {
                var dep_i: usize = end - 1;
                var dep = lockfile.buffers.dependencies.items[dep_i];
                while (!dep.behavior.isPeer()) {
                    if (!dep.behavior.isDev()) {
                        if (peer.name_hash == dep.name_hash) {
                            peer.* = lockfile.buffers.dependencies.items[begin];
                            begin += 1;
                            break;
                        }
                    }
                    dep_i -= 1;
                    dep = lockfile.buffers.dependencies.items[dep_i];
                }
                peer_i += 1;
                if (peer_i == end) break;
                peer = &lockfile.buffers.dependencies.items[peer_i];
            }
        }

        var i = begin;

        // we have to be very careful with pointers here
        while (i < end) : (i += 1) {
            const dependency = lockfile.buffers.dependencies.items[i];
            const resolution = lockfile.buffers.resolutions.items[i];
            this.enqueueDependencyWithMain(
                i,
                &dependency,
                resolution,
                false,
            ) catch |err| {
                const note = .{
                    .fmt = "error occurred while resolving {}",
                    .args = .{bun.fmt.fmtPath(u8, lockfile.str(&dependency.realname()), .{
                        .path_sep = switch (dependency.version.tag) {
                            .folder => .auto,
                            else => .any,
                        },
                    })},
                };

                if (dependency.behavior.isOptional() or dependency.behavior.isPeer())
                    this.log.addWarningWithNote(null, .{}, this.allocator, @errorName(err), note.fmt, note.args) catch unreachable
                else
                    this.log.addZigErrorWithNote(this.allocator, err, note.fmt, note.args) catch unreachable;

                continue;
            };
        }

        this.drainDependencyList();
    }

    pub fn drainDependencyList(this: *PackageManager) void {
        // Step 2. If there were cached dependencies, go through all of those but don't download the devDependencies for them.
        this.flushDependencyQueue();

        if (PackageManager.verbose_install) Output.flush();

        // It's only network requests here because we don't store tarballs.
        _ = this.scheduleTasks();
    }

    fn processDependencyListItem(
        this: *PackageManager,
        item: TaskCallbackContext,
        any_root: ?*bool,
        install_peer: bool,
    ) !void {
        switch (item) {
            .dependency => |dependency_id| {
                const dependency = this.lockfile.buffers.dependencies.items[dependency_id];
                const resolution = this.lockfile.buffers.resolutions.items[dependency_id];

                try this.enqueueDependencyWithMain(
                    dependency_id,
                    &dependency,
                    resolution,
                    install_peer,
                );
            },
            .root_dependency => |dependency_id| {
                const dependency = this.lockfile.buffers.dependencies.items[dependency_id];
                const resolution = this.lockfile.buffers.resolutions.items[dependency_id];

                try this.enqueueDependencyWithMainAndSuccessFn(
                    dependency_id,
                    &dependency,
                    resolution,
                    install_peer,
                    assignRootResolution,
                    failRootResolution,
                );
                if (any_root) |ptr| {
                    const new_resolution_id = this.lockfile.buffers.resolutions.items[dependency_id];
                    if (new_resolution_id != resolution) {
                        ptr.* = true;
                    }
                }
            },
            else => {},
        }
    }

    fn processPeerDependencyList(
        this: *PackageManager,
    ) !void {
        while (this.peer_dependencies.readItem()) |peer_dependency_id| {
            const dependency = this.lockfile.buffers.dependencies.items[peer_dependency_id];
            const resolution = this.lockfile.buffers.resolutions.items[peer_dependency_id];

            try this.enqueueDependencyWithMain(
                peer_dependency_id,
                &dependency,
                resolution,
                true,
            );
        }
    }

    fn processDependencyList(
        this: *PackageManager,
        dep_list: TaskCallbackList,
        comptime Context: type,
        ctx: Context,
        comptime callbacks: anytype,
        install_peer: bool,
    ) !void {
        if (dep_list.items.len > 0) {
            var dependency_list = dep_list;
            var any_root = false;
            for (dependency_list.items) |item| {
                try this.processDependencyListItem(item, &any_root, install_peer);
            }

            if (comptime @TypeOf(callbacks) != void and @TypeOf(callbacks.onResolve) != void) {
                if (any_root) {
                    callbacks.onResolve(ctx);
                }
            }

            dependency_list.deinit(this.allocator);
        }
    }

    pub const GitResolver = struct {
        resolved: string,
        resolution: *const Resolution,
        dep_id: DependencyID,
        new_name: []u8 = "",

        pub fn count(this: @This(), comptime Builder: type, builder: Builder, _: JSAst.Expr) void {
            builder.count(this.resolved);
        }

        pub fn resolve(this: @This(), comptime Builder: type, builder: Builder, _: JSAst.Expr) !Resolution {
            var resolution = this.resolution.*;
            resolution.value.github.resolved = builder.append(String, this.resolved);
            return resolution;
        }

        pub fn checkBundledDependencies() bool {
            return true;
        }
    };

    const TarballResolver = struct {
        url: string,
        resolution: *const Resolution,

        pub fn count(this: @This(), comptime Builder: type, builder: Builder, _: JSAst.Expr) void {
            builder.count(this.url);
        }

        pub fn resolve(this: @This(), comptime Builder: type, builder: Builder, _: JSAst.Expr) !Resolution {
            var resolution = this.resolution.*;
            switch (resolution.tag) {
                .local_tarball => {
                    resolution.value.local_tarball = builder.append(String, this.url);
                },
                .remote_tarball => {
                    resolution.value.remote_tarball = builder.append(String, this.url);
                },
                else => unreachable,
            }
            return resolution;
        }

        pub fn checkBundledDependencies() bool {
            return true;
        }
    };

    /// Returns true if we need to drain dependencies
    fn processExtractedTarballPackage(
        manager: *PackageManager,
        package_id: *PackageID,
        dep_id: DependencyID,
        resolution: *const Resolution,
        data: *const ExtractData,
        log_level: Options.LogLevel,
    ) ?Lockfile.Package {
        switch (resolution.tag) {
            .git, .github => {
                var package = package: {
                    var resolver = GitResolver{
                        .resolved = data.resolved,
                        .resolution = resolution,
                        .dep_id = dep_id,
                    };

                    var pkg = Lockfile.Package{};
                    if (data.json) |json| {
                        const package_json_source = &logger.Source.initPathString(
                            json.path,
                            json.buf,
                        );

                        pkg.parse(
                            manager.lockfile,
                            manager,
                            manager.allocator,
                            manager.log,
                            package_json_source,
                            GitResolver,
                            &resolver,
                            Features.npm,
                        ) catch |err| {
                            if (log_level != .silent) {
                                const string_buf = manager.lockfile.buffers.string_bytes.items;
                                Output.err(err, "failed to parse package.json for <b>{}<r>", .{
                                    resolution.fmtURL(string_buf),
                                });
                            }
                            Global.crash();
                        };

                        const has_scripts = pkg.scripts.hasAny() or brk: {
                            const dir = std.fs.path.dirname(json.path) orelse "";
                            const binding_dot_gyp_path = Path.joinAbsStringZ(
                                dir,
                                &[_]string{"binding.gyp"},
                                .auto,
                            );

                            break :brk Syscall.exists(binding_dot_gyp_path);
                        };

                        pkg.meta.setHasInstallScript(has_scripts);
                        break :package pkg;
                    }

                    // package.json doesn't exist, no dependencies to worry about but we need to decide on a name for the dependency
                    var repo = switch (resolution.tag) {
                        .git => resolution.value.git,
                        .github => resolution.value.github,
                        else => unreachable,
                    };

                    const new_name = Repository.createDependencyNameFromVersionLiteral(manager.allocator, &repo, manager.lockfile, dep_id);
                    defer manager.allocator.free(new_name);

                    {
                        var builder = manager.lockfile.stringBuilder();

                        builder.count(new_name);
                        resolver.count(*Lockfile.StringBuilder, &builder, undefined);

                        builder.allocate() catch bun.outOfMemory();

                        const name = builder.append(ExternalString, new_name);
                        pkg.name = name.value;
                        pkg.name_hash = name.hash;

                        pkg.resolution = resolver.resolve(*Lockfile.StringBuilder, &builder, undefined) catch unreachable;
                    }

                    break :package pkg;
                };

                package = manager.lockfile.appendPackage(package) catch unreachable;
                package_id.* = package.meta.id;

                if (package.dependencies.len > 0) {
                    manager.lockfile.scratch.dependency_list_queue.writeItem(package.dependencies) catch bun.outOfMemory();
                }

                return package;
            },
            .local_tarball, .remote_tarball => {
                const json = data.json.?;
                const package_json_source = &logger.Source.initPathString(
                    json.path,
                    json.buf,
                );
                var package = Lockfile.Package{};

                var resolver: TarballResolver = .{
                    .url = data.url,
                    .resolution = resolution,
                };

                package.parse(
                    manager.lockfile,
                    manager,
                    manager.allocator,
                    manager.log,
                    package_json_source,
                    TarballResolver,
                    &resolver,
                    Features.npm,
                ) catch |err| {
                    if (log_level != .silent) {
                        const string_buf = manager.lockfile.buffers.string_bytes.items;
                        Output.prettyErrorln("<r><red>error:<r> expected package.json in <b>{any}<r> to be a JSON file: {s}\n", .{
                            resolution.fmtURL(string_buf),
                            @errorName(err),
                        });
                    }
                    Global.crash();
                };

                const has_scripts = package.scripts.hasAny() or brk: {
                    const dir = std.fs.path.dirname(json.path) orelse "";
                    const binding_dot_gyp_path = Path.joinAbsStringZ(
                        dir,
                        &[_]string{"binding.gyp"},
                        .auto,
                    );

                    break :brk Syscall.exists(binding_dot_gyp_path);
                };

                package.meta.setHasInstallScript(has_scripts);

                package = manager.lockfile.appendPackage(package) catch unreachable;
                package_id.* = package.meta.id;

                if (package.dependencies.len > 0) {
                    manager.lockfile.scratch.dependency_list_queue.writeItem(package.dependencies) catch bun.outOfMemory();
                }

                return package;
            },
            else => if (data.json.?.buf.len > 0) {
                const json = data.json.?;
                const package_json_source = &logger.Source.initPathString(
                    json.path,
                    json.buf,
                );
                initializeStore();
                const json_root = JSON.parsePackageJSONUTF8(
                    package_json_source,
                    manager.log,
                    manager.allocator,
                ) catch |err| {
                    if (log_level != .silent) {
                        const string_buf = manager.lockfile.buffers.string_bytes.items;
                        Output.prettyErrorln("<r><red>error:<r> expected package.json in <b>{any}<r> to be a JSON file: {s}\n", .{
                            resolution.fmtURL(string_buf),
                            @errorName(err),
                        });
                    }
                    Global.crash();
                };
                var builder = manager.lockfile.stringBuilder();
                Lockfile.Package.Scripts.parseCount(manager.allocator, &builder, json_root);
                builder.allocate() catch unreachable;
                if (comptime Environment.allow_assert) bun.assert(package_id.* != invalid_package_id);
                var scripts = manager.lockfile.packages.items(.scripts)[package_id.*];
                scripts.parseAlloc(manager.allocator, &builder, json_root);
                scripts.filled = true;
            },
        }

        return null;
    }

    const CacheDir = struct { path: string, is_node_modules: bool };
    pub fn fetchCacheDirectoryPath(env: *DotEnv.Loader, options: ?*const Options) CacheDir {
        if (env.get("BUN_INSTALL_CACHE_DIR")) |dir| {
            return CacheDir{ .path = Fs.FileSystem.instance.abs(&[_]string{dir}), .is_node_modules = false };
        }

        if (options) |opts| {
            if (opts.cache_directory.len > 0) {
                return CacheDir{ .path = Fs.FileSystem.instance.abs(&[_]string{opts.cache_directory}), .is_node_modules = false };
            }
        }

        if (env.get("BUN_INSTALL")) |dir| {
            var parts = [_]string{ dir, "install/", "cache/" };
            return CacheDir{ .path = Fs.FileSystem.instance.abs(&parts), .is_node_modules = false };
        }

        if (env.get("XDG_CACHE_HOME")) |dir| {
            var parts = [_]string{ dir, ".bun/", "install/", "cache/" };
            return CacheDir{ .path = Fs.FileSystem.instance.abs(&parts), .is_node_modules = false };
        }

        if (env.get(bun.DotEnv.home_env)) |dir| {
            var parts = [_]string{ dir, ".bun/", "install/", "cache/" };
            return CacheDir{ .path = Fs.FileSystem.instance.abs(&parts), .is_node_modules = false };
        }

        var fallback_parts = [_]string{"node_modules/.bun-cache"};
        return CacheDir{ .is_node_modules = true, .path = Fs.FileSystem.instance.abs(&fallback_parts) };
    }

    pub fn runTasks(
        manager: *PackageManager,
        comptime ExtractCompletionContext: type,
        extract_ctx: ExtractCompletionContext,
        comptime callbacks: anytype,
        install_peer: bool,
        log_level: Options.LogLevel,
    ) anyerror!void {
        var has_updated_this_run = false;
        var has_network_error = false;

        var timestamp_this_tick: ?u32 = null;

        defer {
            manager.drainDependencyList();

            if (log_level.showProgress()) {
                manager.startProgressBarIfNone();

                if (@hasField(@TypeOf(callbacks), "progress_bar") and callbacks.progress_bar == true) {
                    const completed_items = manager.total_tasks - manager.pendingTaskCount();
                    if (completed_items != manager.downloads_node.?.unprotected_completed_items or has_updated_this_run) {
                        manager.downloads_node.?.setCompletedItems(completed_items);
                        manager.downloads_node.?.setEstimatedTotalItems(manager.total_tasks);
                    }
                }
                manager.downloads_node.?.activate();
                manager.progress.maybeRefresh();
            }
        }

        var patch_tasks_batch = manager.patch_task_queue.popBatch();
        var patch_tasks_iter = patch_tasks_batch.iterator();
        while (patch_tasks_iter.next()) |ptask| {
            if (comptime Environment.allow_assert) bun.assert(manager.pendingTaskCount() > 0);
            _ = manager.decrementPendingTasks();
            defer ptask.deinit();
            try ptask.runFromMainThread(manager, log_level);
            if (ptask.callback == .apply) {
                if (ptask.callback.apply.logger.errors == 0) {
                    if (comptime @TypeOf(callbacks.onExtract) != void) {
                        if (ptask.callback.apply.task_id) |task_id| {
                            _ = task_id; // autofix

                        } else if (ExtractCompletionContext == *PackageInstaller) {
                            if (ptask.callback.apply.install_context) |*ctx| {
                                var installer: *PackageInstaller = extract_ctx;
                                const path = ctx.path;
                                ctx.path = std.ArrayList(u8).init(bun.default_allocator);
                                installer.node_modules.path = path;
                                installer.current_tree_id = ctx.tree_id;
                                const pkg_id = ptask.callback.apply.pkg_id;
                                const resolution = &manager.lockfile.packages.items(.resolution)[pkg_id];

                                installer.installPackageWithNameAndResolution(
                                    ctx.dependency_id,
                                    pkg_id,
                                    log_level,
                                    ptask.callback.apply.pkgname,
                                    resolution,
                                    false,
                                    false,
                                );
                            }
                        }
                    }
                }
            }
        }

        var network_tasks_batch = manager.async_network_task_queue.popBatch();
        var network_tasks_iter = network_tasks_batch.iterator();
        while (network_tasks_iter.next()) |task| {
            if (comptime Environment.allow_assert) bun.assert(manager.pendingTaskCount() > 0);
            _ = manager.decrementPendingTasks();
            // We cannot free the network task at the end of this scope.
            // It may continue to be referenced in a future task.

            switch (task.callback) {
                .package_manifest => |*manifest_req| {
                    const name = manifest_req.name;
                    if (log_level.showProgress()) {
                        if (!has_updated_this_run) {
                            manager.setNodeName(manager.downloads_node.?, name.slice(), ProgressStrings.download_emoji, true);
                            has_updated_this_run = true;
                        }
                    }

                    if (!has_network_error and task.response.metadata == null) {
                        has_network_error = true;
                        const min = manager.options.min_simultaneous_requests;
                        const max = AsyncHTTP.max_simultaneous_requests.load(.monotonic);
                        if (max > min) {
                            AsyncHTTP.max_simultaneous_requests.store(@max(min, max / 2), .monotonic);
                        }
                    }

                    // Handle retry-able errors.
                    if (task.response.metadata == null or task.response.metadata.?.response.status_code > 499) {
                        const err = task.response.fail orelse error.HTTPError;

                        if (task.retried < manager.options.max_retry_count) {
                            task.retried += 1;
                            manager.enqueueNetworkTask(task);

                            if (manager.options.log_level.isVerbose()) {
                                manager.log.addWarningFmt(
                                    null,
                                    logger.Loc.Empty,
                                    manager.allocator,
                                    "{s} downloading package manifest <b>{s}<r>. Retry {d}/{d}...",
                                    .{ bun.span(@errorName(err)), name.slice(), task.retried, manager.options.max_retry_count },
                                ) catch unreachable;
                            }

                            continue;
                        }
                    }

                    const metadata = task.response.metadata orelse {
                        // Handle non-retry-able errors.
                        const err = task.response.fail orelse error.HTTPError;

                        if (@TypeOf(callbacks.onPackageManifestError) != void) {
                            callbacks.onPackageManifestError(
                                extract_ctx,
                                name.slice(),
                                err,
                                task.url_buf,
                            );
                        } else {
                            const fmt = "{s} downloading package manifest <b>{s}<r>";
                            if (manager.isNetworkTaskRequired(task.task_id)) {
                                manager.log.addErrorFmt(
                                    null,
                                    logger.Loc.Empty,
                                    manager.allocator,
                                    fmt,
                                    .{ @errorName(err), name.slice() },
                                ) catch bun.outOfMemory();
                            } else {
                                manager.log.addWarningFmt(
                                    null,
                                    logger.Loc.Empty,
                                    manager.allocator,
                                    fmt,
                                    .{ @errorName(err), name.slice() },
                                ) catch bun.outOfMemory();
                            }

                            if (manager.subcommand != .remove) {
                                for (manager.update_requests) |*request| {
                                    if (strings.eql(request.name, name.slice())) {
                                        request.failed = true;
                                        manager.options.do.save_lockfile = false;
                                        manager.options.do.save_yarn_lock = false;
                                        manager.options.do.install_packages = false;
                                    }
                                }
                            }
                        }

                        continue;
                    };
                    const response = metadata.response;

                    if (response.status_code > 399) {
                        if (@TypeOf(callbacks.onPackageManifestError) != void) {
                            const err: PackageManifestError = switch (response.status_code) {
                                400 => error.PackageManifestHTTP400,
                                401 => error.PackageManifestHTTP401,
                                402 => error.PackageManifestHTTP402,
                                403 => error.PackageManifestHTTP403,
                                404 => error.PackageManifestHTTP404,
                                405...499 => error.PackageManifestHTTP4xx,
                                else => error.PackageManifestHTTP5xx,
                            };

                            callbacks.onPackageManifestError(
                                extract_ctx,
                                name.slice(),
                                err,
                                task.url_buf,
                            );

                            continue;
                        }

                        if (manager.isNetworkTaskRequired(task.task_id)) {
                            manager.log.addErrorFmt(
                                null,
                                logger.Loc.Empty,
                                manager.allocator,
                                "<r><red><b>GET<r><red> {s}<d> - {d}<r>",
                                .{ metadata.url, response.status_code },
                            ) catch bun.outOfMemory();
                        } else {
                            manager.log.addWarningFmt(
                                null,
                                logger.Loc.Empty,
                                manager.allocator,
                                "<r><yellow><b>GET<r><yellow> {s}<d> - {d}<r>",
                                .{ metadata.url, response.status_code },
                            ) catch bun.outOfMemory();
                        }
                        if (manager.subcommand != .remove) {
                            for (manager.update_requests) |*request| {
                                if (strings.eql(request.name, name.slice())) {
                                    request.failed = true;
                                    manager.options.do.save_lockfile = false;
                                    manager.options.do.save_yarn_lock = false;
                                    manager.options.do.install_packages = false;
                                }
                            }
                        }

                        continue;
                    }

                    if (log_level.isVerbose()) {
                        Output.prettyError("    ", .{});
                        Output.printElapsed(@as(f64, @floatFromInt(task.unsafe_http_client.elapsed)) / std.time.ns_per_ms);
                        Output.prettyError("\n<d>Downloaded <r><green>{s}<r> versions\n", .{name.slice()});
                        Output.flush();
                    }

                    if (response.status_code == 304) {
                        // The HTTP request was cached
                        if (manifest_req.loaded_manifest) |manifest| {
                            const entry = try manager.manifests.hash_map.getOrPut(manager.allocator, manifest.pkg.name.hash);
                            entry.value_ptr.* = .{ .manifest = manifest };

                            if (timestamp_this_tick == null) {
                                timestamp_this_tick = @as(u32, @truncate(@as(u64, @intCast(@max(0, std.time.timestamp()))))) +| 300;
                            }

                            entry.value_ptr.manifest.pkg.public_max_age = timestamp_this_tick.?;

                            if (manager.options.enable.manifest_cache) {
                                Npm.PackageManifest.Serializer.saveAsync(
                                    &entry.value_ptr.manifest,
                                    manager.scopeForPackageName(name.slice()),
                                    manager.getTemporaryDirectory(),
                                    manager.getCacheDirectory(),
                                );
                            }

                            if (@hasField(@TypeOf(callbacks), "manifests_only") and callbacks.manifests_only) {
                                continue;
                            }

                            const dependency_list_entry = manager.task_queue.getEntry(task.task_id).?;

                            const dependency_list = dependency_list_entry.value_ptr.*;
                            dependency_list_entry.value_ptr.* = .{};

                            try manager.processDependencyList(
                                dependency_list,
                                ExtractCompletionContext,
                                extract_ctx,
                                callbacks,
                                install_peer,
                            );

                            continue;
                        }
                    }

                    manager.task_batch.push(ThreadPool.Batch.from(manager.enqueueParseNPMPackage(task.task_id, name, task)));
                },
                .extract => |*extract| {
                    if (!has_network_error and task.response.metadata == null) {
                        has_network_error = true;
                        const min = manager.options.min_simultaneous_requests;
                        const max = AsyncHTTP.max_simultaneous_requests.load(.monotonic);
                        if (max > min) {
                            AsyncHTTP.max_simultaneous_requests.store(@max(min, max / 2), .monotonic);
                        }
                    }

                    if (task.response.metadata == null or task.response.metadata.?.response.status_code > 499) {
                        const err = task.response.fail orelse error.TarballFailedToDownload;

                        if (task.retried < manager.options.max_retry_count) {
                            task.retried += 1;
                            manager.enqueueNetworkTask(task);

                            if (manager.options.log_level.isVerbose()) {
                                manager.log.addWarningFmt(
                                    null,
                                    logger.Loc.Empty,
                                    manager.allocator,
                                    "<r><yellow>warn:<r> {s} downloading tarball <b>{s}@{s}<r>. Retrying {d}/{d}...",
                                    .{
                                        bun.span(@errorName(err)),
                                        extract.name.slice(),
                                        extract.resolution.fmt(manager.lockfile.buffers.string_bytes.items, .auto),
                                        task.retried,
                                        manager.options.max_retry_count,
                                    },
                                ) catch unreachable;
                            }

                            continue;
                        }
                    }

                    const metadata = task.response.metadata orelse {
                        const err = task.response.fail orelse error.TarballFailedToDownload;

                        if (@TypeOf(callbacks.onPackageDownloadError) != void) {
                            const package_id = manager.lockfile.buffers.resolutions.items[extract.dependency_id];
                            callbacks.onPackageDownloadError(
                                extract_ctx,
                                package_id,
                                extract.name.slice(),
                                &extract.resolution,
                                err,
                                task.url_buf,
                            );
                            continue;
                        }

                        const fmt = "{s} downloading tarball <b>{s}@{s}<r>";
                        if (manager.isNetworkTaskRequired(task.task_id)) {
                            manager.log.addErrorFmt(
                                null,
                                logger.Loc.Empty,
                                manager.allocator,
                                fmt,
                                .{
                                    @errorName(err),
                                    extract.name.slice(),
                                    extract.resolution.fmt(manager.lockfile.buffers.string_bytes.items, .auto),
                                },
                            ) catch bun.outOfMemory();
                        } else {
                            manager.log.addWarningFmt(
                                null,
                                logger.Loc.Empty,
                                manager.allocator,
                                fmt,
                                .{
                                    @errorName(err),
                                    extract.name.slice(),
                                    extract.resolution.fmt(manager.lockfile.buffers.string_bytes.items, .auto),
                                },
                            ) catch bun.outOfMemory();
                        }
                        if (manager.subcommand != .remove) {
                            for (manager.update_requests) |*request| {
                                if (strings.eql(request.name, extract.name.slice())) {
                                    request.failed = true;
                                    manager.options.do.save_lockfile = false;
                                    manager.options.do.save_yarn_lock = false;
                                    manager.options.do.install_packages = false;
                                }
                            }
                        }

                        continue;
                    };

                    const response = metadata.response;

                    if (response.status_code > 399) {
                        if (@TypeOf(callbacks.onPackageDownloadError) != void) {
                            const err = switch (response.status_code) {
                                400 => error.TarballHTTP400,
                                401 => error.TarballHTTP401,
                                402 => error.TarballHTTP402,
                                403 => error.TarballHTTP403,
                                404 => error.TarballHTTP404,
                                405...499 => error.TarballHTTP4xx,
                                else => error.TarballHTTP5xx,
                            };
                            const package_id = manager.lockfile.buffers.resolutions.items[extract.dependency_id];

                            callbacks.onPackageDownloadError(
                                extract_ctx,
                                package_id,
                                extract.name.slice(),
                                &extract.resolution,
                                err,
                                task.url_buf,
                            );
                            continue;
                        }

                        if (manager.isNetworkTaskRequired(task.task_id)) {
                            manager.log.addErrorFmt(
                                null,
                                logger.Loc.Empty,
                                manager.allocator,
                                "<r><red><b>GET<r><red> {s}<d> - {d}<r>",
                                .{
                                    metadata.url,
                                    response.status_code,
                                },
                            ) catch bun.outOfMemory();
                        } else {
                            manager.log.addWarningFmt(
                                null,
                                logger.Loc.Empty,
                                manager.allocator,
                                "<r><yellow><b>GET<r><yellow> {s}<d> - {d}<r>",
                                .{
                                    metadata.url,
                                    response.status_code,
                                },
                            ) catch bun.outOfMemory();
                        }
                        if (manager.subcommand != .remove) {
                            for (manager.update_requests) |*request| {
                                if (strings.eql(request.name, extract.name.slice())) {
                                    request.failed = true;
                                    manager.options.do.save_lockfile = false;
                                    manager.options.do.save_yarn_lock = false;
                                    manager.options.do.install_packages = false;
                                }
                            }
                        }

                        continue;
                    }

                    if (log_level.isVerbose()) {
                        Output.prettyError("    ", .{});
                        Output.printElapsed(@as(f64, @floatCast(@as(f64, @floatFromInt(task.unsafe_http_client.elapsed)) / std.time.ns_per_ms)));
                        Output.prettyError("<d> Downloaded <r><green>{s}<r> tarball\n", .{extract.name.slice()});
                        Output.flush();
                    }

                    if (log_level.showProgress()) {
                        if (!has_updated_this_run) {
                            manager.setNodeName(manager.downloads_node.?, extract.name.slice(), ProgressStrings.extract_emoji, true);
                            has_updated_this_run = true;
                        }
                    }

                    manager.task_batch.push(ThreadPool.Batch.from(manager.enqueueExtractNPMPackage(extract, task)));
                },
                else => unreachable,
            }
        }

        var resolve_tasks_batch = manager.resolve_tasks.popBatch();
        var resolve_tasks_iter = resolve_tasks_batch.iterator();
        while (resolve_tasks_iter.next()) |task| {
            if (comptime Environment.allow_assert) bun.assert(manager.pendingTaskCount() > 0);
            defer manager.preallocated_resolve_tasks.put(task);
            _ = manager.decrementPendingTasks();

            if (task.log.msgs.items.len > 0) {
                try task.log.print(Output.errorWriter());
                if (task.log.errors > 0) {
                    manager.any_failed_to_install = true;
                }
                task.log.deinit();
            }

            switch (task.tag) {
                .package_manifest => {
                    defer manager.preallocated_network_tasks.put(task.request.package_manifest.network);
                    if (task.status == .fail) {
                        const name = task.request.package_manifest.name;
                        const err = task.err orelse error.Failed;

                        if (@TypeOf(callbacks.onPackageManifestError) != void) {
                            callbacks.onPackageManifestError(
                                extract_ctx,
                                name.slice(),
                                err,
                                task.request.package_manifest.network.url_buf,
                            );
                        } else {
                            manager.log.addErrorFmt(
                                null,
                                logger.Loc.Empty,
                                manager.allocator,
                                "{s} parsing package manifest for <b>{s}<r>",
                                .{
                                    @errorName(err),
                                    name.slice(),
                                },
                            ) catch bun.outOfMemory();
                        }

                        continue;
                    }
                    const manifest = &task.data.package_manifest;

                    try manager.manifests.insert(manifest.pkg.name.hash, manifest);

                    if (@hasField(@TypeOf(callbacks), "manifests_only") and callbacks.manifests_only) {
                        continue;
                    }

                    const dependency_list_entry = manager.task_queue.getEntry(task.id).?;
                    const dependency_list = dependency_list_entry.value_ptr.*;
                    dependency_list_entry.value_ptr.* = .{};

                    try manager.processDependencyList(dependency_list, ExtractCompletionContext, extract_ctx, callbacks, install_peer);

                    if (log_level.showProgress()) {
                        if (!has_updated_this_run) {
                            manager.setNodeName(manager.downloads_node.?, manifest.name(), ProgressStrings.download_emoji, true);
                            has_updated_this_run = true;
                        }
                    }
                },
                .extract, .local_tarball => {
                    defer {
                        switch (task.tag) {
                            .extract => manager.preallocated_network_tasks.put(task.request.extract.network),
                            else => {},
                        }
                    }

                    const tarball = switch (task.tag) {
                        .extract => &task.request.extract.tarball,
                        .local_tarball => &task.request.local_tarball.tarball,
                        else => unreachable,
                    };
                    const dependency_id = tarball.dependency_id;
                    var package_id = manager.lockfile.buffers.resolutions.items[dependency_id];
                    const alias = tarball.name.slice();
                    const resolution = &tarball.resolution;

                    if (task.status == .fail) {
                        const err = task.err orelse error.TarballFailedToExtract;

                        if (@TypeOf(callbacks.onPackageDownloadError) != void) {
                            callbacks.onPackageDownloadError(
                                extract_ctx,
                                package_id,
                                alias,
                                resolution,
                                err,
                                switch (task.tag) {
                                    .extract => task.request.extract.network.url_buf,
                                    .local_tarball => task.request.local_tarball.tarball.url.slice(),
                                    else => unreachable,
                                },
                            );
                        } else {
                            manager.log.addErrorFmt(
                                null,
                                logger.Loc.Empty,
                                manager.allocator,
                                "{s} extracting tarball from <b>{s}<r>",
                                .{
                                    @errorName(err),
                                    alias,
                                },
                            ) catch bun.outOfMemory();
                        }
                        continue;
                    }

                    manager.extracted_count += 1;
                    bun.Analytics.Features.extracted_packages += 1;

                    if (comptime @TypeOf(callbacks.onExtract) != void and ExtractCompletionContext == *PackageInstaller) {
                        extract_ctx.fixCachedLockfilePackageSlices();
                        callbacks.onExtract(
                            extract_ctx,
                            dependency_id,
                            &task.data.extract,
                            log_level,
                        );
                    } else if (manager.processExtractedTarballPackage(&package_id, dependency_id, resolution, &task.data.extract, log_level)) |pkg| handle_pkg: {
                        // In the middle of an install, you could end up needing to downlaod the github tarball for a dependency
                        // We need to make sure we resolve the dependencies first before calling the onExtract callback
                        // TODO: move this into a separate function
                        var any_root = false;
                        var dependency_list_entry = manager.task_queue.getEntry(task.id) orelse break :handle_pkg;
                        var dependency_list = dependency_list_entry.value_ptr.*;
                        dependency_list_entry.value_ptr.* = .{};

                        defer {
                            dependency_list.deinit(manager.allocator);
                            if (comptime @TypeOf(callbacks) != void and @TypeOf(callbacks.onResolve) != void) {
                                if (any_root) {
                                    callbacks.onResolve(extract_ctx);
                                }
                            }
                        }

                        for (dependency_list.items) |dep| {
                            switch (dep) {
                                .dependency, .root_dependency => |id| {
                                    var version = &manager.lockfile.buffers.dependencies.items[id].version;
                                    switch (version.tag) {
                                        .git => {
                                            version.value.git.package_name = pkg.name;
                                        },
                                        .github => {
                                            version.value.github.package_name = pkg.name;
                                        },
                                        .tarball => {
                                            version.value.tarball.package_name = pkg.name;
                                        },

                                        // `else` is reachable if this package is from `overrides`. Version in `lockfile.buffer.dependencies`
                                        // will still have the original.
                                        else => {},
                                    }
                                    try manager.processDependencyListItem(dep, &any_root, install_peer);
                                },
                                else => {
                                    // if it's a node_module folder to install, handle that after we process all the dependencies within the onExtract callback.
                                    dependency_list_entry.value_ptr.append(manager.allocator, dep) catch unreachable;
                                },
                            }
                        }
                    } else if (manager.task_queue.getEntry(Task.Id.forManifest(
                        manager.lockfile.str(&manager.lockfile.packages.items(.name)[package_id]),
                    ))) |dependency_list_entry| {
                        // Peer dependencies do not initiate any downloads of their own, thus need to be resolved here instead
                        const dependency_list = dependency_list_entry.value_ptr.*;
                        dependency_list_entry.value_ptr.* = .{};

                        try manager.processDependencyList(dependency_list, void, {}, {}, install_peer);
                    }

                    manager.setPreinstallState(package_id, manager.lockfile, .done);

                    if (comptime @TypeOf(callbacks.onExtract) != void and ExtractCompletionContext != *PackageInstaller) {
                        // handled *PackageInstaller above
                        callbacks.onExtract(extract_ctx, dependency_id, &task.data.extract, log_level);
                    }

                    if (log_level.showProgress()) {
                        if (!has_updated_this_run) {
                            manager.setNodeName(manager.downloads_node.?, alias, ProgressStrings.extract_emoji, true);
                            has_updated_this_run = true;
                        }
                    }
                },
                .git_clone => {
                    const clone = &task.request.git_clone;
                    const repo_fd = task.data.git_clone;
                    const name = clone.name.slice();
                    const url = clone.url.slice();

                    manager.git_repositories.put(manager.allocator, task.id, repo_fd) catch unreachable;

                    if (task.status == .fail) {
                        const err = task.err orelse error.Failed;

                        if (@TypeOf(callbacks.onPackageManifestError) != void) {
                            callbacks.onPackageManifestError(
                                extract_ctx,
                                name,
                                err,
                                url,
                            );
                        } else if (log_level != .silent) {
                            manager.log.addErrorFmt(
                                null,
                                logger.Loc.Empty,
                                manager.allocator,
                                "{s} cloning repository for <b>{s}<r>",
                                .{
                                    @errorName(err),
                                    name,
                                },
                            ) catch bun.outOfMemory();
                        }
                        continue;
                    }

                    if (comptime @TypeOf(callbacks.onExtract) != void and ExtractCompletionContext == *PackageInstaller) {
                        // Installing!
                        // this dependency might be something other than a git dependency! only need the name and
                        // behavior, use the resolution from the task.
                        const dep_id = clone.dep_id;
                        const dep = manager.lockfile.buffers.dependencies.items[dep_id];
                        const dep_name = dep.name.slice(manager.lockfile.buffers.string_bytes.items);

                        const git = clone.res.value.git;
                        const committish = git.committish.slice(manager.lockfile.buffers.string_bytes.items);
                        const repo = git.repo.slice(manager.lockfile.buffers.string_bytes.items);

                        const resolved = try Repository.findCommit(
                            manager.allocator,
                            manager.env,
                            manager.log,
                            task.data.git_clone.stdDir(),
                            dep_name,
                            committish,
                            task.id,
                        );

                        const checkout_id = Task.Id.forGitCheckout(repo, resolved);

                        if (manager.hasCreatedNetworkTask(checkout_id, dep.behavior.isRequired())) continue;

                        manager.task_batch.push(ThreadPool.Batch.from(manager.enqueueGitCheckout(
                            checkout_id,
                            repo_fd,
                            dep_id,
                            dep_name,
                            clone.res,
                            resolved,
                            null,
                        )));
                    } else {
                        // Resolving!
                        const dependency_list_entry = manager.task_queue.getEntry(task.id).?;
                        const dependency_list = dependency_list_entry.value_ptr.*;
                        dependency_list_entry.value_ptr.* = .{};

                        try manager.processDependencyList(dependency_list, ExtractCompletionContext, extract_ctx, callbacks, install_peer);
                    }

                    if (log_level.showProgress()) {
                        if (!has_updated_this_run) {
                            manager.setNodeName(manager.downloads_node.?, name, ProgressStrings.download_emoji, true);
                            has_updated_this_run = true;
                        }
                    }
                },
                .git_checkout => {
                    const git_checkout = &task.request.git_checkout;
                    const alias = &git_checkout.name;
                    const resolution = &git_checkout.resolution;
                    var package_id: PackageID = invalid_package_id;

                    if (task.status == .fail) {
                        const err = task.err orelse error.Failed;

                        manager.log.addErrorFmt(
                            null,
                            logger.Loc.Empty,
                            manager.allocator,
                            "{s} checking out repository for <b>{s}<r>",
                            .{
                                @errorName(err),
                                alias.slice(),
                            },
                        ) catch bun.outOfMemory();

                        continue;
                    }

                    if (comptime @TypeOf(callbacks.onExtract) != void and ExtractCompletionContext == *PackageInstaller) {
                        // We've populated the cache, package already exists in memory. Call the package installer callback
                        // and don't enqueue dependencies

                        // TODO(dylan-conway) most likely don't need to call this now that the package isn't appended, but
                        // keeping just in case for now
                        extract_ctx.fixCachedLockfilePackageSlices();

                        callbacks.onExtract(
                            extract_ctx,
                            git_checkout.dependency_id,
                            &task.data.git_checkout,
                            log_level,
                        );
                    } else if (manager.processExtractedTarballPackage(
                        &package_id,
                        git_checkout.dependency_id,
                        resolution,
                        &task.data.git_checkout,
                        log_level,
                    )) |pkg| handle_pkg: {
                        var any_root = false;
                        var dependency_list_entry = manager.task_queue.getEntry(task.id) orelse break :handle_pkg;
                        var dependency_list = dependency_list_entry.value_ptr.*;
                        dependency_list_entry.value_ptr.* = .{};

                        defer {
                            dependency_list.deinit(manager.allocator);
                            if (comptime @TypeOf(callbacks) != void and @TypeOf(callbacks.onResolve) != void) {
                                if (any_root) {
                                    callbacks.onResolve(extract_ctx);
                                }
                            }
                        }

                        for (dependency_list.items) |dep| {
                            switch (dep) {
                                .dependency, .root_dependency => |id| {
                                    var repo = &manager.lockfile.buffers.dependencies.items[id].version.value.git;
                                    repo.resolved = pkg.resolution.value.git.resolved;
                                    repo.package_name = pkg.name;
                                    try manager.processDependencyListItem(dep, &any_root, install_peer);
                                },
                                else => {
                                    // if it's a node_module folder to install, handle that after we process all the dependencies within the onExtract callback.
                                    dependency_list_entry.value_ptr.append(manager.allocator, dep) catch unreachable;
                                },
                            }
                        }

                        if (comptime @TypeOf(callbacks.onExtract) != void) {
                            callbacks.onExtract(
                                extract_ctx,
                                git_checkout.dependency_id,
                                &task.data.git_checkout,
                                log_level,
                            );
                        }
                    }

                    if (log_level.showProgress()) {
                        if (!has_updated_this_run) {
                            manager.setNodeName(manager.downloads_node.?, alias.slice(), ProgressStrings.download_emoji, true);
                            has_updated_this_run = true;
                        }
                    }
                },
            }
        }
    }

    pub const ProgressStrings = struct {
        pub const download_no_emoji_ = "Resolving";
        const download_no_emoji: string = download_no_emoji_ ++ "\n";
        const download_with_emoji: string = download_emoji ++ download_no_emoji_;
        pub const download_emoji: string = "  🔍 ";

        pub const extract_no_emoji_ = "Resolving & extracting";
        const extract_no_emoji: string = extract_no_emoji_ ++ "\n";
        const extract_with_emoji: string = extract_emoji ++ extract_no_emoji_;
        pub const extract_emoji: string = "  🚚 ";

        pub const install_no_emoji_ = "Installing";
        const install_no_emoji: string = install_no_emoji_ ++ "\n";
        const install_with_emoji: string = install_emoji ++ install_no_emoji_;
        pub const install_emoji: string = "  📦 ";

        pub const save_no_emoji_ = "Saving lockfile";
        const save_no_emoji: string = save_no_emoji_;
        const save_with_emoji: string = save_emoji ++ save_no_emoji_;
        pub const save_emoji: string = "  🔒 ";

        pub const script_no_emoji_ = "Running script";
        const script_no_emoji: string = script_no_emoji_ ++ "\n";
        const script_with_emoji: string = script_emoji ++ script_no_emoji_;
        pub const script_emoji: string = "  ⚙️  ";

        pub inline fn download() string {
            return if (Output.isEmojiEnabled()) download_with_emoji else download_no_emoji;
        }

        pub inline fn save() string {
            return if (Output.isEmojiEnabled()) save_with_emoji else save_no_emoji;
        }

        pub inline fn extract() string {
            return if (Output.isEmojiEnabled()) extract_with_emoji else extract_no_emoji;
        }

        pub inline fn install() string {
            return if (Output.isEmojiEnabled()) install_with_emoji else install_no_emoji;
        }

        pub inline fn script() string {
            return if (Output.isEmojiEnabled()) script_with_emoji else script_no_emoji;
        }
    };

    // Corresponds to possible commands from the CLI.
    pub const Subcommand = enum {
        install,
        update,
        pm,
        add,
        remove,
        link,
        unlink,
        patch,
        @"patch-commit",
        outdated,
        pack,
        publish,
        audit,
        info,

        // bin,
        // hash,
        // @"hash-print",
        // @"hash-string",
        // cache,
        // @"default-trusted",
        // untrusted,
        // trust,
        // ls,
        // migrate,

        pub fn canGloballyInstallPackages(this: Subcommand) bool {
            return switch (this) {
                .install, .update, .add => true,
                else => false,
            };
        }

        pub fn supportsWorkspaceFiltering(this: Subcommand) bool {
            return switch (this) {
                .outdated => true,
                .install => true,
                // .pack => true,
                // .add => true,
                else => false,
            };
        }

        pub fn supportsJsonOutput(this: Subcommand) bool {
            return switch (this) {
                .audit,
                .pm,
                .info,
                => true,
                else => false,
            };
        }

        // TODO: make all subcommands find root and chdir
        pub fn shouldChdirToRoot(this: Subcommand) bool {
            return switch (this) {
                .link => false,
                else => true,
            };
        }
    };

    fn httpThreadOnInitError(err: HTTP.InitError, opts: HTTP.HTTPThread.InitOpts) noreturn {
        switch (err) {
            error.LoadCAFile => {
                var normalizer: bun.path.PosixToWinNormalizer = .{};
                const normalized = normalizer.resolveZ(FileSystem.instance.top_level_dir, opts.abs_ca_file_name);
                if (!bun.sys.existsZ(normalized)) {
                    Output.err("HTTPThread", "could not find CA file: '{s}'", .{opts.abs_ca_file_name});
                } else {
                    Output.err("HTTPThread", "invalid CA file: '{s}'", .{opts.abs_ca_file_name});
                }
            },
            error.InvalidCAFile => {
                Output.err("HTTPThread", "invalid CA file: '{s}'", .{opts.abs_ca_file_name});
            },
            error.InvalidCA => {
                Output.err("HTTPThread", "the CA is invalid", .{});
            },
            error.FailedToOpenSocket => {
                Output.errGeneric("failed to start HTTP client thread", .{});
            },
        }
        Global.crash();
    }

    pub fn init(
        ctx: Command.Context,
        cli: CommandLineArguments,
        subcommand: Subcommand,
    ) !struct { *PackageManager, string } {
        if (cli.global) {
            var explicit_global_dir: string = "";
            if (ctx.install) |opts| {
                explicit_global_dir = opts.global_dir orelse explicit_global_dir;
            }
            var global_dir = try Options.openGlobalDir(explicit_global_dir);
            try global_dir.setAsCwd();
        }

        var fs = try Fs.FileSystem.init(null);
        const top_level_dir_no_trailing_slash = strings.withoutTrailingSlash(fs.top_level_dir);
        if (comptime Environment.isWindows) {
            _ = Path.pathToPosixBuf(u8, top_level_dir_no_trailing_slash, &cwd_buf);
        } else {
            @memcpy(cwd_buf[0..top_level_dir_no_trailing_slash.len], top_level_dir_no_trailing_slash);
        }

        var original_package_json_path_buf = std.ArrayListUnmanaged(u8).initCapacity(ctx.allocator, top_level_dir_no_trailing_slash.len + "/package.json".len + 1) catch bun.outOfMemory();
        original_package_json_path_buf.appendSliceAssumeCapacity(top_level_dir_no_trailing_slash);
        original_package_json_path_buf.appendSliceAssumeCapacity(std.fs.path.sep_str ++ "package.json");
        original_package_json_path_buf.appendAssumeCapacity(0);

        var original_package_json_path: stringZ = original_package_json_path_buf.items[0 .. top_level_dir_no_trailing_slash.len + "/package.json".len :0];
        const original_cwd = strings.withoutSuffixComptime(original_package_json_path, std.fs.path.sep_str ++ "package.json");
        const original_cwd_clone = ctx.allocator.dupe(u8, original_cwd) catch bun.outOfMemory();

        var workspace_names = Package.WorkspaceMap.init(ctx.allocator);
        var workspace_package_json_cache: WorkspacePackageJSONCache = .{
            .map = .{},
        };

        var workspace_name_hash: ?PackageNameHash = null;
        var root_package_json_name_at_time_of_init: []const u8 = "";

        // Step 1. Find the nearest package.json directory
        //
        // We will walk up from the cwd, trying to find the nearest package.json file.
        const root_package_json_file = root_package_json_file: {
            var this_cwd: string = original_cwd;
            var created_package_json = false;
            const child_json = child: {
                // if we are only doing `bun install` (no args), then we can open as read_only
                // in all other cases we will need to write new data later.
                // this is relevant because it allows us to succeed an install if package.json
                // is readable but not writable
                //
                // probably wont matter as if package.json isn't writable, it's likely that
                // the underlying directory and node_modules isn't either.
                const need_write = subcommand != .install or cli.positionals.len > 1;

                while (true) {
                    var package_json_path_buf: bun.PathBuffer = undefined;
                    @memcpy(package_json_path_buf[0..this_cwd.len], this_cwd);
                    package_json_path_buf[this_cwd.len..package_json_path_buf.len][0.."/package.json".len].* = "/package.json".*;
                    package_json_path_buf[this_cwd.len + "/package.json".len] = 0;
                    const package_json_path = package_json_path_buf[0 .. this_cwd.len + "/package.json".len :0];

                    break :child std.fs.cwd().openFileZ(
                        package_json_path,
                        .{ .mode = if (need_write) .read_write else .read_only },
                    ) catch |err| switch (err) {
                        error.FileNotFound => {
                            if (std.fs.path.dirname(this_cwd)) |parent| {
                                this_cwd = strings.withoutTrailingSlash(parent);
                                continue;
                            } else {
                                break;
                            }
                        },
                        error.AccessDenied => {
                            Output.err("EACCES", "Permission denied while opening \"{s}\"", .{
                                package_json_path,
                            });
                            if (need_write) {
                                Output.note("package.json must be writable to add packages", .{});
                            } else {
                                Output.note("package.json is missing read permissions, or is owned by another user", .{});
                            }
                            Global.crash();
                        },
                        else => {
                            Output.err(err, "could not open \"{s}\"", .{
                                package_json_path,
                            });
                            return err;
                        },
                    };
                }

                if (subcommand == .install) {
                    if (cli.positionals.len > 1) {
                        // this is `bun add <package>`.
                        //
                        // create the package json instead of return error. this works around
                        // a zig bug where continuing control flow through a catch seems to
                        // cause a segfault the second time `PackageManager.init` is called after
                        // switching to the add command.
                        this_cwd = original_cwd;
                        created_package_json = true;
                        break :child try attemptToCreatePackageJSONAndOpen();
                    }
                }
                return error.MissingPackageJSON;
            };

            bun.assertWithLocation(strings.eqlLong(original_package_json_path_buf.items[0..this_cwd.len], this_cwd, true), @src());
            original_package_json_path_buf.items.len = this_cwd.len;
            original_package_json_path_buf.appendSliceAssumeCapacity(std.fs.path.sep_str ++ "package.json");
            original_package_json_path_buf.appendAssumeCapacity(0);

            original_package_json_path = original_package_json_path_buf.items[0 .. this_cwd.len + "/package.json".len :0];
            const child_cwd = strings.withoutSuffixComptime(original_package_json_path, std.fs.path.sep_str ++ "package.json");

            // Check if this is a workspace; if so, use root package
            var found = false;
            if (subcommand.shouldChdirToRoot()) {
                if (!created_package_json) {
                    while (std.fs.path.dirname(this_cwd)) |parent| : (this_cwd = parent) {
                        const parent_without_trailing_slash = strings.withoutTrailingSlash(parent);
                        var parent_path_buf: bun.PathBuffer = undefined;
                        @memcpy(parent_path_buf[0..parent_without_trailing_slash.len], parent_without_trailing_slash);
                        parent_path_buf[parent_without_trailing_slash.len..parent_path_buf.len][0.."/package.json".len].* = "/package.json".*;
                        parent_path_buf[parent_without_trailing_slash.len + "/package.json".len] = 0;

                        const json_file = std.fs.cwd().openFileZ(
                            parent_path_buf[0 .. parent_without_trailing_slash.len + "/package.json".len :0].ptr,
                            .{ .mode = .read_write },
                        ) catch {
                            continue;
                        };
                        defer if (!found) json_file.close();
                        const json_stat_size = try json_file.getEndPos();
                        const json_buf = try ctx.allocator.alloc(u8, json_stat_size + 64);
                        defer ctx.allocator.free(json_buf);
                        const json_len = try json_file.preadAll(json_buf, 0);
                        const json_path = try bun.getFdPath(.fromStdFile(json_file), &package_json_cwd_buf);
                        const json_source = logger.Source.initPathString(json_path, json_buf[0..json_len]);
                        initializeStore();
                        const json = try JSON.parsePackageJSONUTF8(&json_source, ctx.log, ctx.allocator);
                        if (subcommand == .pm) {
                            if (json.getStringCloned(ctx.allocator, "name") catch null) |name| {
                                root_package_json_name_at_time_of_init = name;
                            }
                        }

                        if (json.asProperty("workspaces")) |prop| {
                            const json_array = switch (prop.expr.data) {
                                .e_array => |arr| arr,
                                .e_object => |obj| if (obj.get("packages")) |packages| switch (packages.data) {
                                    .e_array => |arr| arr,
                                    else => break,
                                } else break,
                                else => break,
                            };
                            var log = logger.Log.init(ctx.allocator);
                            defer log.deinit();
                            _ = workspace_names.processNamesArray(
                                ctx.allocator,
                                &workspace_package_json_cache,
                                &log,
                                json_array,
                                &json_source,
                                prop.loc,
                                null,
                            ) catch break;

                            for (workspace_names.keys(), workspace_names.values()) |path, entry| {
                                const child_path = if (std.fs.path.isAbsolute(path))
                                    child_cwd
                                else
                                    bun.path.relativeNormalized(json_source.path.name.dir, child_cwd, .auto, true);

                                const maybe_workspace_path = if (comptime Environment.isWindows) brk: {
                                    @memcpy(parent_path_buf[0..child_path.len], child_path);
                                    bun.path.dangerouslyConvertPathToPosixInPlace(u8, parent_path_buf[0..child_path.len]);
                                    break :brk parent_path_buf[0..child_path.len];
                                } else child_path;

                                if (strings.eqlLong(maybe_workspace_path, path, true)) {
                                    fs.top_level_dir = try bun.default_allocator.dupeZ(u8, parent);
                                    found = true;
                                    child_json.close();
                                    if (comptime Environment.isWindows) {
                                        try json_file.seekTo(0);
                                    }
                                    workspace_name_hash = String.Builder.stringHash(entry.name);
                                    break :root_package_json_file json_file;
                                }
                            }

                            break;
                        }
                    }
                }
            }

            fs.top_level_dir = try bun.default_allocator.dupeZ(u8, child_cwd);
            break :root_package_json_file child_json;
        };

        try bun.sys.chdir(fs.top_level_dir, fs.top_level_dir).unwrap();
        try BunArguments.loadConfig(ctx.allocator, cli.config, ctx, .InstallCommand);
        bun.copy(u8, &cwd_buf, fs.top_level_dir);
        cwd_buf[fs.top_level_dir.len] = 0;
        fs.top_level_dir = cwd_buf[0..fs.top_level_dir.len :0];
        package_json_cwd = try bun.getFdPath(.fromStdFile(root_package_json_file), &package_json_cwd_buf);

        const entries_option = try fs.fs.readDirectory(fs.top_level_dir, null, 0, true);

        var env: *DotEnv.Loader = brk: {
            const map = try ctx.allocator.create(DotEnv.Map);
            map.* = DotEnv.Map.init(ctx.allocator);

            const loader = try ctx.allocator.create(DotEnv.Loader);
            loader.* = DotEnv.Loader.init(map, ctx.allocator);
            break :brk loader;
        };

        env.loadProcess();
        try env.load(entries_option.entries, &[_][]u8{}, .production, false);

        initializeStore();
        if (bun.getenvZ("XDG_CONFIG_HOME") orelse bun.getenvZ(bun.DotEnv.home_env)) |data_dir| {
            var buf: bun.PathBuffer = undefined;
            var parts = [_]string{
                "./.npmrc",
            };

            bun.ini.loadNpmrcConfig(ctx.allocator, ctx.install orelse brk: {
                const install_ = ctx.allocator.create(Api.BunInstall) catch bun.outOfMemory();
                install_.* = std.mem.zeroes(Api.BunInstall);
                ctx.install = install_;
                break :brk install_;
            }, env, true, &[_][:0]const u8{ Path.joinAbsStringBufZ(
                data_dir,
                &buf,
                &parts,
                .auto,
            ), ".npmrc" });
        } else {
            bun.ini.loadNpmrcConfig(ctx.allocator, ctx.install orelse brk: {
                const install_ = ctx.allocator.create(Api.BunInstall) catch bun.outOfMemory();
                install_.* = std.mem.zeroes(Api.BunInstall);
                ctx.install = install_;
                break :brk install_;
            }, env, true, &[_][:0]const u8{".npmrc"});
        }
        const cpu_count = bun.getThreadCount();

        const options = Options{
            .global = cli.global,
            .max_concurrent_lifecycle_scripts = cli.concurrent_scripts orelse cpu_count * 2,
        };

        if (env.get("BUN_INSTALL_VERBOSE") != null) {
            PackageManager.verbose_install = true;
        }

        if (env.get("BUN_FEATURE_FLAG_FORCE_WAITER_THREAD") != null) {
            bun.spawn.process.WaiterThread.setShouldUseWaiterThread();
        }

        if (PackageManager.verbose_install) {
            Output.prettyErrorln("Cache Dir: {s}", .{options.cache_directory});
            Output.flush();
        }

        workspace_names.map.deinit();

        PackageManager.allocatePackageManager();
        const manager = PackageManager.get();
        // var progress = Progress{};
        // var node = progress.start(name: []const u8, estimated_total_items: usize)
        manager.* = PackageManager{
            .preallocated_network_tasks = .init(bun.default_allocator),
            .preallocated_resolve_tasks = .init(bun.default_allocator),
            .options = options,
            .active_lifecycle_scripts = .{
                .context = manager,
            },
            .network_task_fifo = NetworkQueue.init(),
            .patch_task_fifo = PatchTaskFifo.init(),
            .allocator = ctx.allocator,
            .log = ctx.log,
            .root_dir = entries_option.entries,
            .env = env,
            .cpu_count = cpu_count,
            .thread_pool = ThreadPool.init(.{
                .max_threads = cpu_count,
            }),
            .resolve_tasks = .{},
            .lockfile = undefined,
            .root_package_json_file = root_package_json_file,
            // .progress
            .event_loop = .{
                .mini = JSC.MiniEventLoop.init(bun.default_allocator),
            },
            .original_package_json_path = original_package_json_path,
            .workspace_package_json_cache = workspace_package_json_cache,
            .workspace_name_hash = workspace_name_hash,
            .subcommand = subcommand,
            .root_package_json_name_at_time_of_init = root_package_json_name_at_time_of_init,
        };
        manager.event_loop.loop().internal_loop_data.setParentEventLoop(bun.JSC.EventLoopHandle.init(&manager.event_loop));
        manager.lockfile = try ctx.allocator.create(Lockfile);
        JSC.MiniEventLoop.global = &manager.event_loop.mini;
        if (!manager.options.enable.cache) {
            manager.options.enable.manifest_cache = false;
            manager.options.enable.manifest_cache_control = false;
        }

        if (env.get("BUN_MANIFEST_CACHE")) |manifest_cache| {
            if (strings.eqlComptime(manifest_cache, "1")) {
                manager.options.enable.manifest_cache = true;
                manager.options.enable.manifest_cache_control = false;
            } else if (strings.eqlComptime(manifest_cache, "2")) {
                manager.options.enable.manifest_cache = true;
                manager.options.enable.manifest_cache_control = true;
            } else {
                manager.options.enable.manifest_cache = false;
                manager.options.enable.manifest_cache_control = false;
            }
        }

        try manager.options.load(
            ctx.allocator,
            ctx.log,
            env,
            cli,
            ctx.install,
            subcommand,
        );

        var ca: []stringZ = &.{};
        if (manager.options.ca.len > 0) {
            ca = try manager.allocator.alloc(stringZ, manager.options.ca.len);
            for (ca, manager.options.ca) |*z, s| {
                z.* = try manager.allocator.dupeZ(u8, s);
            }
        }

        var abs_ca_file_name: stringZ = &.{};
        if (manager.options.ca_file_name.len > 0) {
            // resolve with original cwd
            if (std.fs.path.isAbsolute(manager.options.ca_file_name)) {
                abs_ca_file_name = try manager.allocator.dupeZ(u8, manager.options.ca_file_name);
            } else {
                var path_buf: bun.PathBuffer = undefined;
                abs_ca_file_name = try manager.allocator.dupeZ(u8, bun.path.joinAbsStringBuf(
                    original_cwd_clone,
                    &path_buf,
                    &.{manager.options.ca_file_name},
                    .auto,
                ));
            }
        }

        AsyncHTTP.max_simultaneous_requests.store(brk: {
            if (cli.network_concurrency) |network_concurrency| {
                break :brk @max(network_concurrency, 1);
            }

            // If any HTTP proxy is set, use a diferent limit
            if (env.has("http_proxy") or env.has("https_proxy") or env.has("HTTPS_PROXY") or env.has("HTTP_PROXY")) {
                break :brk default_max_simultaneous_requests_for_bun_install_for_proxies;
            }

            break :brk default_max_simultaneous_requests_for_bun_install;
        }, .monotonic);

        HTTP.HTTPThread.init(&.{
            .ca = ca,
            .abs_ca_file_name = abs_ca_file_name,
            .onInitError = &httpThreadOnInitError,
        });

        manager.timestamp_for_manifest_cache_control = brk: {
            if (comptime bun.Environment.allow_assert) {
                if (env.get("BUN_CONFIG_MANIFEST_CACHE_CONTROL_TIMESTAMP")) |cache_control| {
                    if (std.fmt.parseInt(u32, cache_control, 10)) |int| {
                        break :brk int;
                    } else |_| {}
                }
            }

            break :brk @truncate(@as(u64, @intCast(@max(std.time.timestamp(), 0))));
        };
        return .{
            manager,
            original_cwd_clone,
        };
    }

    pub fn initWithRuntime(
        log: *logger.Log,
        bun_install: ?*Api.BunInstall,
        allocator: std.mem.Allocator,
        cli: CommandLineArguments,
        env: *DotEnv.Loader,
    ) *PackageManager {
        init_with_runtime_once.call(.{
            log,
            bun_install,
            allocator,
            cli,
            env,
        });
        return PackageManager.get();
    }

    var init_with_runtime_once = bun.once(initWithRuntimeOnce);

    pub fn initWithRuntimeOnce(
        log: *logger.Log,
        bun_install: ?*Api.BunInstall,
        allocator: std.mem.Allocator,
        cli: CommandLineArguments,
        env: *DotEnv.Loader,
    ) void {
        if (env.get("BUN_INSTALL_VERBOSE") != null) {
            PackageManager.verbose_install = true;
        }

        const cpu_count = bun.getThreadCount();
        PackageManager.allocatePackageManager();
        const manager = PackageManager.get();
        var root_dir = Fs.FileSystem.instance.fs.readDirectory(
            Fs.FileSystem.instance.top_level_dir,
            null,
            0,
            true,
        ) catch |err| {
            Output.err(err, "failed to read root directory: '{s}'", .{Fs.FileSystem.instance.top_level_dir});
            @panic("Failed to initialize package manager");
        };

        // var progress = Progress{};
        // var node = progress.start(name: []const u8, estimated_total_items: usize)
        const top_level_dir_no_trailing_slash = strings.withoutTrailingSlash(Fs.FileSystem.instance.top_level_dir);
        var original_package_json_path = allocator.allocSentinel(u8, top_level_dir_no_trailing_slash.len + "/package.json".len, 0) catch bun.outOfMemory();
        @memcpy(original_package_json_path[0..top_level_dir_no_trailing_slash.len], top_level_dir_no_trailing_slash);
        @memcpy(original_package_json_path[top_level_dir_no_trailing_slash.len..][0.."/package.json".len], "/package.json");

        manager.* = PackageManager{
            .preallocated_network_tasks = .init(bun.default_allocator),
            .preallocated_resolve_tasks = .init(bun.default_allocator),
            .options = .{
                .max_concurrent_lifecycle_scripts = cli.concurrent_scripts orelse cpu_count * 2,
            },
            .active_lifecycle_scripts = .{
                .context = manager,
            },
            .network_task_fifo = NetworkQueue.init(),
            .allocator = allocator,
            .log = log,
            .root_dir = root_dir.entries,
            .env = env,
            .cpu_count = cpu_count,
            .thread_pool = ThreadPool.init(.{
                .max_threads = cpu_count,
            }),
            .lockfile = undefined,
            .root_package_json_file = undefined,
            .event_loop = .{
                .js = JSC.VirtualMachine.get().eventLoop(),
            },
            .original_package_json_path = original_package_json_path[0..original_package_json_path.len :0],
            .subcommand = .install,
        };
        manager.lockfile = allocator.create(Lockfile) catch bun.outOfMemory();

        if (Output.enable_ansi_colors_stderr) {
            manager.progress = Progress{};
            manager.progress.supports_ansi_escape_codes = Output.enable_ansi_colors_stderr;
            manager.root_progress_node = manager.progress.start("", 0);
        } else {
            manager.options.log_level = .default_no_progress;
        }

        if (!manager.options.enable.cache) {
            manager.options.enable.manifest_cache = false;
            manager.options.enable.manifest_cache_control = false;
        }

        if (env.get("BUN_MANIFEST_CACHE")) |manifest_cache| {
            if (strings.eqlComptime(manifest_cache, "1")) {
                manager.options.enable.manifest_cache = true;
                manager.options.enable.manifest_cache_control = false;
            } else if (strings.eqlComptime(manifest_cache, "2")) {
                manager.options.enable.manifest_cache = true;
                manager.options.enable.manifest_cache_control = true;
            } else {
                manager.options.enable.manifest_cache = false;
                manager.options.enable.manifest_cache_control = false;
            }
        }

        manager.options.load(
            allocator,
            log,
            env,
            cli,
            bun_install,
            .install,
        ) catch |err| {
            switch (err) {
                error.OutOfMemory => bun.outOfMemory(),
            }
        };

        manager.timestamp_for_manifest_cache_control = @as(
            u32,
            @truncate(@as(
                u64,
                @intCast(@max(
                    std.time.timestamp(),
                    0,
                )),
            )),
            // When using "bun install", we check for updates with a 300 second cache.
            // When using bun, we only do staleness checks once per day
        ) -| std.time.s_per_day;

        if (root_dir.entries.hasComptimeQuery("bun.lockb")) {
            switch (manager.lockfile.loadFromCwd(
                manager,
                allocator,
                log,
                true,
            )) {
                .ok => |load| manager.lockfile = load.lockfile,
                else => manager.lockfile.initEmpty(allocator),
            }
        } else {
            manager.lockfile.initEmpty(allocator);
        }
    }

    fn attemptToCreatePackageJSONAndOpen() !std.fs.File {
        const package_json_file = std.fs.cwd().createFileZ("package.json", .{ .read = true }) catch |err| {
            Output.prettyErrorln("<r><red>error:<r> {s} create package.json", .{@errorName(err)});
            Global.crash();
        };

        try package_json_file.pwriteAll("{\"dependencies\": {}}", 0);

        return package_json_file;
    }

    fn attemptToCreatePackageJSON() !void {
        var file = try attemptToCreatePackageJSONAndOpen();
        file.close();
    }

    // parse dependency of positional arg string (may include name@version for example)
    // get the precise version from the lockfile (there may be multiple)
    // copy the contents into a temp folder
    pub fn patch(ctx: Command.Context) !void {
        try updatePackageJSONAndInstallCatchError(ctx, .patch);
    }

    pub fn patchCommit(ctx: Command.Context) !void {
        try updatePackageJSONAndInstallCatchError(ctx, .@"patch-commit");
    }

    pub fn update(ctx: Command.Context) !void {
        try updatePackageJSONAndInstallCatchError(ctx, .update);
    }

    pub fn add(ctx: Command.Context) !void {
        try updatePackageJSONAndInstallCatchError(ctx, .add);
    }

    pub fn remove(ctx: Command.Context) !void {
        try updatePackageJSONAndInstallCatchError(ctx, .remove);
    }

    pub fn updatePackageJSONAndInstallCatchError(
        ctx: Command.Context,
        subcommand: Subcommand,
    ) !void {
        updatePackageJSONAndInstall(ctx, subcommand) catch |err| {
            switch (err) {
                error.InstallFailed,
                error.InvalidPackageJSON,
                => {
                    const log = &bun.CLI.Cli.log_;
                    log.print(bun.Output.errorWriter()) catch {};
                    bun.Global.exit(1);
                    return;
                },
                else => return err,
            }
        };
    }

    pub const CommandLineArguments = @import("./PackageManager/CommandLineArguments.zig");

    pub fn link(ctx: Command.Context) !void {
        const cli = try CommandLineArguments.parse(ctx.allocator, .link);
        var manager, const original_cwd = PackageManager.init(ctx, cli, .link) catch |err| brk: {
            if (err == error.MissingPackageJSON) {
                try attemptToCreatePackageJSON();
                break :brk try PackageManager.init(ctx, cli, .link);
            }

            return err;
        };
        defer ctx.allocator.free(original_cwd);

        if (manager.options.shouldPrintCommandName()) {
            Output.prettyln("<r><b>bun link <r><d>v" ++ Global.package_json_version_with_sha ++ "<r>\n", .{});
            Output.flush();
        }

        if (manager.options.positionals.len == 1) {
            // bun link

            var lockfile: Lockfile = undefined;
            var name: string = "";
            var package = Lockfile.Package{};

            // Step 1. parse the nearest package.json file
            {
                const package_json_source = &(bun.sys.File.toSource(manager.original_package_json_path, ctx.allocator, .{}).unwrap() catch |err| {
                    Output.errGeneric("failed to read \"{s}\" for linking: {s}", .{ manager.original_package_json_path, @errorName(err) });
                    Global.crash();
                });
                lockfile.initEmpty(ctx.allocator);

                var resolver: void = {};
                try package.parse(&lockfile, manager, ctx.allocator, manager.log, package_json_source, void, &resolver, Features.folder);
                name = lockfile.str(&package.name);
                if (name.len == 0) {
                    if (manager.options.log_level != .silent) {
                        Output.prettyErrorln("<r><red>error:<r> package.json missing \"name\" <d>in \"{s}\"<r>", .{package_json_source.path.text});
                    }
                    Global.crash();
                } else if (!strings.isNPMPackageName(name)) {
                    if (manager.options.log_level != .silent) {
                        Output.prettyErrorln("<r><red>error:<r> invalid package.json name \"{s}\" <d>in \"{any}\"<r>", .{
                            name,
                            package_json_source.path.text,
                        });
                    }
                    Global.crash();
                }
            }

            // Step 2. Setup the global directory
            var node_modules: std.fs.Dir = brk: {
                Bin.Linker.ensureUmask();
                var explicit_global_dir: string = "";
                if (ctx.install) |install_| {
                    explicit_global_dir = install_.global_dir orelse explicit_global_dir;
                }
                manager.global_dir = try Options.openGlobalDir(explicit_global_dir);

                try manager.setupGlobalDir(ctx);

                break :brk manager.global_dir.?.makeOpenPath("node_modules", .{}) catch |err| {
                    if (manager.options.log_level != .silent)
                        Output.prettyErrorln("<r><red>error:<r> failed to create node_modules in global dir due to error {s}", .{@errorName(err)});
                    Global.crash();
                };
            };

            // Step 3a. symlink to the node_modules folder
            {
                // delete it if it exists
                node_modules.deleteTree(name) catch {};

                // create scope if specified
                if (name[0] == '@') {
                    if (strings.indexOfChar(name, '/')) |i| {
                        node_modules.makeDir(name[0..i]) catch |err| brk: {
                            if (err == error.PathAlreadyExists) break :brk;
                            if (manager.options.log_level != .silent)
                                Output.prettyErrorln("<r><red>error:<r> failed to create scope in global dir due to error {s}", .{@errorName(err)});
                            Global.crash();
                        };
                    }
                }

                if (comptime Environment.isWindows) {
                    // create the junction
                    const top_level = Fs.FileSystem.instance.topLevelDirWithoutTrailingSlash();
                    var link_path_buf: bun.PathBuffer = undefined;
                    @memcpy(
                        link_path_buf[0..top_level.len],
                        top_level,
                    );
                    link_path_buf[top_level.len] = 0;
                    const link_path = link_path_buf[0..top_level.len :0];
                    const global_path = try manager.globalLinkDirPath();
                    const dest_path = Path.joinAbsStringZ(global_path, &.{name}, .windows);
                    switch (bun.sys.sys_uv.symlinkUV(
                        link_path,
                        dest_path,
                        bun.windows.libuv.UV_FS_SYMLINK_JUNCTION,
                    )) {
                        .err => |err| {
                            Output.prettyErrorln("<r><red>error:<r> failed to create junction to node_modules in global dir due to error {}", .{err});
                            Global.crash();
                        },
                        .result => {},
                    }
                } else {
                    // create the symlink
                    node_modules.symLink(Fs.FileSystem.instance.topLevelDirWithoutTrailingSlash(), name, .{ .is_directory = true }) catch |err| {
                        if (manager.options.log_level != .silent)
                            Output.prettyErrorln("<r><red>error:<r> failed to create symlink to node_modules in global dir due to error {s}", .{@errorName(err)});
                        Global.crash();
                    };
                }
            }

            // Step 3b. Link any global bins
            if (package.bin.tag != .none) {
                var link_target_buf: bun.PathBuffer = undefined;
                var link_dest_buf: bun.PathBuffer = undefined;
                var link_rel_buf: bun.PathBuffer = undefined;
                var node_modules_path_buf: bun.PathBuffer = undefined;
                var bin_linker = Bin.Linker{
                    .bin = package.bin,
                    .node_modules = .fromStdDir(node_modules),
                    .node_modules_path = bun.getFdPath(.fromStdDir(node_modules), &node_modules_path_buf) catch |err| {
                        if (manager.options.log_level != .silent) {
                            Output.err(err, "failed to link binary", .{});
                        }
                        Global.crash();
                    },
                    .global_bin_path = manager.options.bin_path,

                    // .destination_dir_subpath = destination_dir_subpath,
                    .package_name = strings.StringOrTinyString.init(name),
                    .string_buf = lockfile.buffers.string_bytes.items,
                    .extern_string_buf = lockfile.buffers.extern_strings.items,
                    .seen = null,
                    .abs_target_buf = &link_target_buf,
                    .abs_dest_buf = &link_dest_buf,
                    .rel_buf = &link_rel_buf,
                };
                bin_linker.link(true);

                if (bin_linker.err) |err| {
                    if (manager.options.log_level != .silent)
                        Output.prettyErrorln("<r><red>error:<r> failed to link bin due to error {s}", .{@errorName(err)});
                    Global.crash();
                }
            }

            Output.flush();

            // Done
            if (manager.options.log_level != .silent)
                Output.prettyln(
                    \\<r><green>Success!<r> Registered "{[name]s}"
                    \\
                    \\To use {[name]s} in a project, run:
                    \\  <cyan>bun link {[name]s}<r>
                    \\
                    \\Or add it in dependencies in your package.json file:
                    \\  <cyan>"{[name]s}": "link:{[name]s}"<r>
                    \\
                ,
                    .{
                        .name = name,
                    },
                );

            Output.flush();
            Global.exit(0);
        } else {
            // bun link lodash
            try manager.updatePackageJSONAndInstallWithManager(ctx, original_cwd);
        }
    }

    pub fn unlink(ctx: Command.Context) !void {
        const cli = try PackageManager.CommandLineArguments.parse(ctx.allocator, .unlink);
        var manager, const original_cwd = PackageManager.init(ctx, cli, .unlink) catch |err| brk: {
            if (err == error.MissingPackageJSON) {
                try attemptToCreatePackageJSON();
                break :brk try PackageManager.init(ctx, cli, .unlink);
            }

            return err;
        };
        defer ctx.allocator.free(original_cwd);

        if (manager.options.shouldPrintCommandName()) {
            Output.prettyln("<r><b>bun unlink <r><d>v" ++ Global.package_json_version_with_sha ++ "<r>\n", .{});
            Output.flush();
        }

        if (manager.options.positionals.len == 1) {
            // bun unlink

            var lockfile: Lockfile = undefined;
            var name: string = "";
            var package = Lockfile.Package{};

            // Step 1. parse the nearest package.json file
            {
                const package_json_source = &(bun.sys.File.toSource(manager.original_package_json_path, ctx.allocator, .{}).unwrap() catch |err| {
                    Output.errGeneric("failed to read \"{s}\" for unlinking: {s}", .{ manager.original_package_json_path, @errorName(err) });
                    Global.crash();
                });
                lockfile.initEmpty(ctx.allocator);

                var resolver: void = {};
                try package.parse(&lockfile, manager, ctx.allocator, manager.log, package_json_source, void, &resolver, Features.folder);
                name = lockfile.str(&package.name);
                if (name.len == 0) {
                    if (manager.options.log_level != .silent) {
                        Output.prettyErrorln("<r><red>error:<r> package.json missing \"name\" <d>in \"{s}\"<r>", .{package_json_source.path.text});
                    }
                    Global.crash();
                } else if (!strings.isNPMPackageName(name)) {
                    if (manager.options.log_level != .silent) {
                        Output.prettyErrorln("<r><red>error:<r> invalid package.json name \"{s}\" <d>in \"{s}\"<r>", .{
                            name,
                            package_json_source.path.text,
                        });
                    }
                    Global.crash();
                }
            }

            switch (Syscall.lstat(Path.joinAbsStringZ(try manager.globalLinkDirPath(), &.{name}, .auto))) {
                .result => |stat| {
                    if (!bun.S.ISLNK(@intCast(stat.mode))) {
                        Output.prettyErrorln("<r><green>success:<r> package \"{s}\" is not globally linked, so there's nothing to do.", .{name});
                        Global.exit(0);
                    }
                },
                .err => {
                    Output.prettyErrorln("<r><green>success:<r> package \"{s}\" is not globally linked, so there's nothing to do.", .{name});
                    Global.exit(0);
                },
            }

            // Step 2. Setup the global directory
            var node_modules: std.fs.Dir = brk: {
                Bin.Linker.ensureUmask();
                var explicit_global_dir: string = "";
                if (ctx.install) |install_| {
                    explicit_global_dir = install_.global_dir orelse explicit_global_dir;
                }
                manager.global_dir = try Options.openGlobalDir(explicit_global_dir);

                try manager.setupGlobalDir(ctx);

                break :brk manager.global_dir.?.makeOpenPath("node_modules", .{}) catch |err| {
                    if (manager.options.log_level != .silent)
                        Output.prettyErrorln("<r><red>error:<r> failed to create node_modules in global dir due to error {s}", .{@errorName(err)});
                    Global.crash();
                };
            };

            // Step 3b. Link any global bins
            if (package.bin.tag != .none) {
                var link_target_buf: bun.PathBuffer = undefined;
                var link_dest_buf: bun.PathBuffer = undefined;
                var link_rel_buf: bun.PathBuffer = undefined;
                var node_modules_path_buf: bun.PathBuffer = undefined;

                var bin_linker = Bin.Linker{
                    .bin = package.bin,
                    .node_modules = .fromStdDir(node_modules),
                    .node_modules_path = bun.getFdPath(.fromStdDir(node_modules), &node_modules_path_buf) catch |err| {
                        if (manager.options.log_level != .silent) {
                            Output.err(err, "failed to link binary", .{});
                        }
                        Global.crash();
                    },
                    .global_bin_path = manager.options.bin_path,
                    .package_name = strings.StringOrTinyString.init(name),
                    .string_buf = lockfile.buffers.string_bytes.items,
                    .extern_string_buf = lockfile.buffers.extern_strings.items,
                    .seen = null,
                    .abs_target_buf = &link_target_buf,
                    .abs_dest_buf = &link_dest_buf,
                    .rel_buf = &link_rel_buf,
                };
                bin_linker.unlink(true);
            }

            // delete it if it exists
            node_modules.deleteTree(name) catch |err| {
                if (manager.options.log_level != .silent)
                    Output.prettyErrorln("<r><red>error:<r> failed to unlink package in global dir due to error {s}", .{@errorName(err)});
                Global.crash();
            };

            Output.prettyln("<r><green>success:<r> unlinked package \"{s}\"", .{name});
            Global.exit(0);
        } else {
            Output.prettyln("<r><red>error:<r> bun unlink {{packageName}} not implemented yet", .{});
            Global.crash();
        }
    }

    pub const PackageJSONEditor = @import("./PackageManager/PackageJSONEditor.zig");

    pub const UpdateRequest = struct {
        name: string = "",
        name_hash: PackageNameHash = 0,
        version: Dependency.Version = .{},
        version_buf: []const u8 = "",
        package_id: PackageID = invalid_package_id,
        is_aliased: bool = false,
        failed: bool = false,
        // This must be cloned to handle when the AST store resets
        e_string: ?*JSAst.E.String = null,

        pub const Array = std.ArrayListUnmanaged(UpdateRequest);

        pub inline fn matches(this: PackageManager.UpdateRequest, dependency: Dependency, string_buf: []const u8) bool {
            return this.name_hash == if (this.name.len == 0)
                String.Builder.stringHash(dependency.version.literal.slice(string_buf))
            else
                dependency.name_hash;
        }

        /// It is incorrect to call this function before Lockfile.cleanWithLogger() because
        /// resolved_name should be populated if possible.
        ///
        /// `this` needs to be a pointer! If `this` is a copy and the name returned from
        /// resolved_name is inlined, you will return a pointer to stack memory.
        pub fn getResolvedName(this: *const UpdateRequest, lockfile: *const Lockfile) string {
            return if (this.is_aliased)
                this.name
            else if (this.package_id == invalid_package_id)
                this.version.literal.slice(this.version_buf)
            else
                lockfile.packages.items(.name)[this.package_id].slice(this.version_buf);
        }

        pub fn fromJS(globalThis: *JSC.JSGlobalObject, input: JSC.JSValue) bun.JSError!JSC.JSValue {
            var arena = std.heap.ArenaAllocator.init(bun.default_allocator);
            defer arena.deinit();
            var stack = std.heap.stackFallback(1024, arena.allocator());
            const allocator = stack.get();
            var all_positionals = std.ArrayList([]const u8).init(allocator);

            var log = logger.Log.init(allocator);

            if (input.isString()) {
                var input_str = input.toSliceCloneWithAllocator(
                    globalThis,
                    allocator,
                ) orelse return .zero;
                if (input_str.len > 0)
                    try all_positionals.append(input_str.slice());
            } else if (input.isArray()) {
                var iter = try input.arrayIterator(globalThis);
                while (try iter.next()) |item| {
                    const slice = item.toSliceCloneWithAllocator(globalThis, allocator) orelse return .zero;
                    if (globalThis.hasException()) return .zero;
                    if (slice.len == 0) continue;
                    try all_positionals.append(slice.slice());
                }
                if (globalThis.hasException()) return .zero;
            } else {
                return .js_undefined;
            }

            if (all_positionals.items.len == 0) {
                return .js_undefined;
            }

            var array = Array{};

            const update_requests = parseWithError(allocator, null, &log, all_positionals.items, &array, .add, false) catch {
                return globalThis.throwValue(try log.toJS(globalThis, bun.default_allocator, "Failed to parse dependencies"));
            };
            if (update_requests.len == 0) return .js_undefined;

            if (log.msgs.items.len > 0) {
                return globalThis.throwValue(try log.toJS(globalThis, bun.default_allocator, "Failed to parse dependencies"));
            }

            if (update_requests[0].failed) {
                return globalThis.throw("Failed to parse dependencies", .{});
            }

            var object = JSC.JSValue.createEmptyObject(globalThis, 2);
            var name_str = bun.String.init(update_requests[0].name);
            object.put(globalThis, "name", name_str.transferToJS(globalThis));
            object.put(globalThis, "version", try update_requests[0].version.toJS(update_requests[0].version_buf, globalThis));
            return object;
        }

        pub fn parse(
            allocator: std.mem.Allocator,
            pm: ?*PackageManager,
            log: *logger.Log,
            positionals: []const string,
            update_requests: *Array,
            subcommand: Subcommand,
        ) []UpdateRequest {
            return parseWithError(allocator, pm, log, positionals, update_requests, subcommand, true) catch Global.crash();
        }

        fn parseWithError(
            allocator: std.mem.Allocator,
            pm: ?*PackageManager,
            log: *logger.Log,
            positionals: []const string,
            update_requests: *Array,
            subcommand: Subcommand,
            fatal: bool,
        ) ![]UpdateRequest {
            // first one is always either:
            // add
            // remove
            outer: for (positionals) |positional| {
                var input: []u8 = bun.default_allocator.dupe(u8, std.mem.trim(u8, positional, " \n\r\t")) catch bun.outOfMemory();
                {
                    var temp: [2048]u8 = undefined;
                    const len = std.mem.replace(u8, input, "\\\\", "/", &temp);
                    bun.path.platformToPosixInPlace(u8, &temp);
                    const input2 = temp[0 .. input.len - len];
                    @memcpy(input[0..input2.len], input2);
                    input.len = input2.len;
                }
                switch (subcommand) {
                    .link, .unlink => if (!strings.hasPrefixComptime(input, "link:")) {
                        input = std.fmt.allocPrint(allocator, "{0s}@link:{0s}", .{input}) catch unreachable;
                    },
                    else => {},
                }

                var value = input;
                var alias: ?string = null;
                if (!Dependency.isTarball(input) and strings.isNPMPackageName(input)) {
                    alias = input;
                    value = input[input.len..];
                } else if (input.len > 1) {
                    if (strings.indexOfChar(input[1..], '@')) |at| {
                        const name = input[0 .. at + 1];
                        if (strings.isNPMPackageName(name)) {
                            alias = name;
                            value = input[at + 2 ..];
                        }
                    }
                }

                const placeholder = String.from("@@@");
                var version = Dependency.parseWithOptionalTag(
                    allocator,
                    if (alias) |name| String.init(input, name) else placeholder,
                    if (alias) |name| String.Builder.stringHash(name) else null,
                    value,
                    null,
                    &SlicedString.init(input, value),
                    log,
                    pm,
                ) orelse {
                    if (fatal) {
                        Output.errGeneric("unrecognised dependency format: {s}", .{
                            positional,
                        });
                    } else {
                        log.addErrorFmt(null, logger.Loc.Empty, allocator, "unrecognised dependency format: {s}", .{
                            positional,
                        }) catch bun.outOfMemory();
                    }

                    return error.UnrecognizedDependencyFormat;
                };
                if (alias != null and version.tag == .git) {
                    if (Dependency.parseWithOptionalTag(
                        allocator,
                        placeholder,
                        null,
                        input,
                        null,
                        &SlicedString.init(input, input),
                        log,
                        pm,
                    )) |ver| {
                        alias = null;
                        version = ver;
                    }
                }
                if (switch (version.tag) {
                    .dist_tag => version.value.dist_tag.name.eql(placeholder, input, input),
                    .npm => version.value.npm.name.eql(placeholder, input, input),
                    else => false,
                }) {
                    if (fatal) {
                        Output.errGeneric("unrecognised dependency format: {s}", .{
                            positional,
                        });
                    } else {
                        log.addErrorFmt(null, logger.Loc.Empty, allocator, "unrecognised dependency format: {s}", .{
                            positional,
                        }) catch bun.outOfMemory();
                    }

                    return error.UnrecognizedDependencyFormat;
                }

                var request = UpdateRequest{
                    .version = version,
                    .version_buf = input,
                };
                if (alias) |name| {
                    request.is_aliased = true;
                    request.name = allocator.dupe(u8, name) catch unreachable;
                    request.name_hash = String.Builder.stringHash(name);
                } else if (version.tag == .github and version.value.github.committish.isEmpty()) {
                    request.name_hash = String.Builder.stringHash(version.literal.slice(input));
                } else {
                    request.name_hash = String.Builder.stringHash(version.literal.slice(input));
                }

                for (update_requests.items) |*prev| {
                    if (prev.name_hash == request.name_hash and request.name.len == prev.name.len) continue :outer;
                }
                update_requests.append(allocator, request) catch bun.outOfMemory();
            }

            return update_requests.items;
        }
    };

    fn updatePackageJSONAndInstall(
        ctx: Command.Context,
        subcommand: Subcommand,
    ) !void {
        var cli = switch (subcommand) {
            inline else => |cmd| try PackageManager.CommandLineArguments.parse(ctx.allocator, cmd),
        };

        // The way this works:
        // 1. Run the bundler on source files
        // 2. Rewrite positional arguments to act identically to the developer
        //    typing in the dependency names
        // 3. Run the install command
        if (cli.analyze) {
            const Analyzer = struct {
                ctx: Command.Context,
                cli: *PackageManager.CommandLineArguments,
                subcommand: Subcommand,
                pub fn onAnalyze(
                    this: *@This(),
                    result: *bun.bundle_v2.BundleV2.DependenciesScanner.Result,
                ) anyerror!void {
                    // TODO: add separate argument that makes it so positionals[1..] is not done and instead the positionals are passed
                    var positionals = bun.default_allocator.alloc(string, result.dependencies.keys().len + 1) catch bun.outOfMemory();
                    positionals[0] = "add";
                    bun.copy(string, positionals[1..], result.dependencies.keys());
                    this.cli.positionals = positionals;

                    try updatePackageJSONAndInstallAndCLI(this.ctx, this.subcommand, this.cli.*);

                    Global.exit(0);
                }
            };
            var analyzer = Analyzer{
                .ctx = ctx,
                .cli = &cli,
                .subcommand = subcommand,
            };
            var fetcher = bun.bundle_v2.BundleV2.DependenciesScanner{
                .ctx = &analyzer,
                .entry_points = cli.positionals[1..],
                .onFetch = @ptrCast(&Analyzer.onAnalyze),
            };

            // This runs the bundler.
            try bun.CLI.BuildCommand.exec(bun.CLI.Command.get(), &fetcher);
            return;
        }

        return updatePackageJSONAndInstallAndCLI(ctx, subcommand, cli);
    }

    fn updatePackageJSONAndInstallAndCLI(
        ctx: Command.Context,
        subcommand: Subcommand,
        cli: CommandLineArguments,
    ) !void {
        var manager, const original_cwd = init(ctx, cli, subcommand) catch |err| brk: {
            if (err == error.MissingPackageJSON) {
                switch (subcommand) {
                    .update => {
                        Output.prettyErrorln("<r>No package.json, so nothing to update", .{});
                        Global.crash();
                    },
                    .remove => {
                        Output.prettyErrorln("<r>No package.json, so nothing to remove", .{});
                        Global.crash();
                    },
                    .patch, .@"patch-commit" => {
                        Output.prettyErrorln("<r>No package.json, so nothing to patch", .{});
                        Global.crash();
                    },
                    else => {
                        try attemptToCreatePackageJSON();
                        break :brk try PackageManager.init(ctx, cli, subcommand);
                    },
                }
            }

            return err;
        };
        defer ctx.allocator.free(original_cwd);

        if (manager.options.shouldPrintCommandName()) {
            Output.prettyln("<r><b>bun {s} <r><d>v" ++ Global.package_json_version_with_sha ++ "<r>\n", .{@tagName(subcommand)});
            Output.flush();
        }

        // When you run `bun add -g <pkg>` or `bun install -g <pkg>` and the global bin dir is not in $PATH
        // We should tell the user to add it to $PATH so they don't get confused.
        if (subcommand.canGloballyInstallPackages()) {
            if (manager.options.global and manager.options.log_level != .silent) {
                manager.track_installed_bin = .{ .pending = {} };
            }
        }

        try manager.updatePackageJSONAndInstallWithManager(ctx, original_cwd);

        if (manager.options.patch_features == .patch) {
            try manager.preparePatch();
        }

        if (manager.any_failed_to_install) {
            Global.exit(1);
        }

        // Check if we need to print a warning like:
        //
        // > warn: To run "vite", add the global bin folder to $PATH:
        // >
        // > fish_add_path "/private/tmp/test"
        //
        if (subcommand.canGloballyInstallPackages()) {
            if (manager.options.global) {
                if (manager.options.bin_path.len > 0 and manager.track_installed_bin == .basename) {
                    const needs_to_print = if (bun.getenvZ("PATH")) |PATH|
                        // This is not perfect
                        //
                        // If you already have a different binary of the same
                        // name, it will not detect that case.
                        //
                        // The problem is there are too many edgecases with filesystem paths.
                        //
                        // We want to veer towards false negative than false
                        // positive. It would be annoying if this message
                        // appears unnecessarily. It's kind of okay if it doesn't appear
                        // when it should.
                        //
                        // If you set BUN_INSTALL_BIN to "/tmp/woo" on macOS and
                        // we just checked for "/tmp/woo" in $PATH, it would
                        // incorrectly print a warning because /tmp/ on macOS is
                        // aliased to /private/tmp/
                        //
                        // Another scenario is case-insensitive filesystems. If you
                        // have a binary called "esbuild" in /tmp/TeST and you
                        // install esbuild, it will not detect that case if we naively
                        // just checked for "esbuild" in $PATH where "$PATH" is /tmp/test
                        bun.which(
                            &package_json_cwd_buf,
                            PATH,
                            bun.fs.FileSystem.instance.top_level_dir,
                            manager.track_installed_bin.basename,
                        ) == null
                    else
                        true;

                    if (needs_to_print) {
                        const MoreInstructions = struct {
                            shell: bun.CLI.ShellCompletions.Shell = .unknown,
                            folder: []const u8,

                            // Convert "/Users/Jarred Sumner" => "/Users/Jarred\ Sumner"
                            const ShellPathFormatter = struct {
                                folder: []const u8,

                                pub fn format(instructions: @This(), comptime _: []const u8, _: std.fmt.FormatOptions, writer: anytype) !void {
                                    var remaining = instructions.folder;
                                    while (bun.strings.indexOfChar(remaining, ' ')) |space| {
                                        try writer.print(
                                            "{}",
                                            .{bun.fmt.fmtPath(u8, remaining[0..space], .{
                                                .escape_backslashes = true,
                                                .path_sep = if (Environment.isWindows) .windows else .posix,
                                            })},
                                        );
                                        try writer.writeAll("\\ ");
                                        remaining = remaining[@min(space + 1, remaining.len)..];
                                    }

                                    try writer.print(
                                        "{}",
                                        .{bun.fmt.fmtPath(u8, remaining, .{
                                            .escape_backslashes = true,
                                            .path_sep = if (Environment.isWindows) .windows else .posix,
                                        })},
                                    );
                                }
                            };

                            pub fn format(instructions: @This(), comptime _: []const u8, _: std.fmt.FormatOptions, writer: anytype) !void {
                                const path = ShellPathFormatter{ .folder = instructions.folder };
                                switch (instructions.shell) {
                                    .unknown => {
                                        // Unfortunately really difficult to do this in one line on PowerShell.
                                        try writer.print("{}", .{path});
                                    },
                                    .bash => {
                                        try writer.print("export PATH=\"{}:$PATH\"", .{path});
                                    },
                                    .zsh => {
                                        try writer.print("export PATH=\"{}:$PATH\"", .{path});
                                    },
                                    .fish => {
                                        // Regular quotes will do here.
                                        try writer.print("fish_add_path {}", .{bun.fmt.quote(instructions.folder)});
                                    },
                                    .pwsh => {
                                        try writer.print("$env:PATH += \";{}\"", .{path});
                                    },
                                }
                            }
                        };

                        Output.prettyError("\n", .{});

                        Output.warn(
                            \\To run {}, add the global bin folder to $PATH:
                            \\
                            \\<cyan>{}<r>
                            \\
                        ,
                            .{
                                bun.fmt.quote(manager.track_installed_bin.basename),
                                MoreInstructions{ .shell = bun.CLI.ShellCompletions.Shell.fromEnv([]const u8, bun.getenvZ("SHELL") orelse ""), .folder = manager.options.bin_path },
                            },
                        );
                        Output.flush();
                    }
                }
            }
        }
    }

    fn updatePackageJSONAndInstallWithManager(
        manager: *PackageManager,
        ctx: Command.Context,
        original_cwd: string,
    ) !void {
        var update_requests = UpdateRequest.Array.initCapacity(manager.allocator, 64) catch bun.outOfMemory();
        defer update_requests.deinit(manager.allocator);

        if (manager.options.positionals.len <= 1) {
            switch (manager.subcommand) {
                .add => {
                    Output.errGeneric("no package specified to add", .{});
                    Output.flush();
                    PackageManager.CommandLineArguments.printHelp(.add);

                    Global.exit(0);
                },
                .remove => {
                    Output.errGeneric("no package specified to remove", .{});
                    Output.flush();
                    PackageManager.CommandLineArguments.printHelp(.remove);

                    Global.exit(0);
                },
                else => {},
            }
        }

        return try updatePackageJSONAndInstallWithManagerWithUpdatesAndUpdateRequests(
            manager,
            ctx,
            original_cwd,
            manager.options.positionals[1..],
            &update_requests,
        );
    }

    fn updatePackageJSONAndInstallWithManagerWithUpdatesAndUpdateRequests(
        manager: *PackageManager,
        ctx: Command.Context,
        original_cwd: string,
        positionals: []const string,
        update_requests: *UpdateRequest.Array,
    ) !void {
        var updates: []UpdateRequest = if (manager.subcommand == .@"patch-commit" or manager.subcommand == .patch)
            &[_]UpdateRequest{}
        else
            UpdateRequest.parse(ctx.allocator, manager, ctx.log, positionals, update_requests, manager.subcommand);
        try manager.updatePackageJSONAndInstallWithManagerWithUpdates(
            ctx,
            &updates,
            manager.subcommand,
            original_cwd,
        );
    }
    fn updatePackageJSONAndInstallWithManagerWithUpdates(
        manager: *PackageManager,
        ctx: Command.Context,
        updates: *[]UpdateRequest,
        subcommand: Subcommand,
        original_cwd: string,
    ) !void {
        const log_level = manager.options.log_level;
        if (manager.log.errors > 0) {
            if (log_level != .silent) {
                manager.log.print(Output.errorWriter()) catch {};
            }
            Global.crash();
        }

        var current_package_json = switch (manager.workspace_package_json_cache.getWithPath(
            manager.allocator,
            manager.log,
            manager.original_package_json_path,
            .{
                .guess_indentation = true,
            },
        )) {
            .parse_err => |err| {
                manager.log.print(Output.errorWriter()) catch {};
                Output.errGeneric("failed to parse package.json \"{s}\": {s}", .{
                    manager.original_package_json_path,
                    @errorName(err),
                });
                Global.crash();
            },
            .read_err => |err| {
                Output.errGeneric("failed to read package.json \"{s}\": {s}", .{
                    manager.original_package_json_path,
                    @errorName(err),
                });
                Global.crash();
            },
            .entry => |entry| entry,
        };
        const current_package_json_indent = current_package_json.indentation;

        // If there originally was a newline at the end of their package.json, preserve it
        // so that we don't cause unnecessary diffs in their git history.
        // https://github.com/oven-sh/bun/issues/1375
        const preserve_trailing_newline_at_eof_for_package_json = current_package_json.source.contents.len > 0 and
            current_package_json.source.contents[current_package_json.source.contents.len - 1] == '\n';

        if (subcommand == .remove) {
            if (current_package_json.root.data != .e_object) {
                Output.errGeneric("package.json is not an Object {{}}, so there's nothing to {s}!", .{@tagName(subcommand)});
                Global.crash();
            } else if (current_package_json.root.data.e_object.properties.len == 0) {
                Output.errGeneric("package.json is empty {{}}, so there's nothing to {s}!", .{@tagName(subcommand)});
                Global.crash();
            } else if (current_package_json.root.asProperty("devDependencies") == null and
                current_package_json.root.asProperty("dependencies") == null and
                current_package_json.root.asProperty("optionalDependencies") == null and
                current_package_json.root.asProperty("peerDependencies") == null)
            {
                Output.prettyErrorln("package.json doesn't have dependencies, there's nothing to {s}!", .{@tagName(subcommand)});
                Global.exit(0);
            }
        }

        const dependency_list = if (manager.options.update.development)
            "devDependencies"
        else if (manager.options.update.optional)
            "optionalDependencies"
        else if (manager.options.update.peer)
            "peerDependencies"
        else
            "dependencies";
        var any_changes = false;

        var not_in_workspace_root: ?PatchCommitResult = null;
        switch (subcommand) {
            .remove => {
                // if we're removing, they don't have to specify where it is installed in the dependencies list
                // they can even put it multiple times and we will just remove all of them
                for (updates.*) |request| {
                    inline for ([_]string{ "dependencies", "devDependencies", "optionalDependencies", "peerDependencies" }) |list| {
                        if (current_package_json.root.asProperty(list)) |query| {
                            if (query.expr.data == .e_object) {
                                var dependencies = query.expr.data.e_object.properties.slice();
                                var i: usize = 0;
                                var new_len = dependencies.len;
                                while (i < dependencies.len) : (i += 1) {
                                    if (dependencies[i].key.?.data == .e_string) {
                                        if (dependencies[i].key.?.data.e_string.eql(string, request.name)) {
                                            if (new_len > 1) {
                                                dependencies[i] = dependencies[new_len - 1];
                                                new_len -= 1;
                                            } else {
                                                new_len = 0;
                                            }

                                            any_changes = true;
                                        }
                                    }
                                }

                                const changed = new_len != dependencies.len;
                                if (changed) {
                                    query.expr.data.e_object.properties.len = @as(u32, @truncate(new_len));

                                    // If the dependencies list is now empty, remove it from the package.json
                                    // since we're swapRemove, we have to re-sort it
                                    if (query.expr.data.e_object.properties.len == 0) {
                                        var arraylist = current_package_json.root.data.e_object.properties.list();
                                        _ = arraylist.swapRemove(query.i);
                                        current_package_json.root.data.e_object.properties.update(arraylist);
                                        current_package_json.root.data.e_object.packageJSONSort();
                                    } else {
                                        var obj = query.expr.data.e_object;
                                        obj.alphabetizeProperties();
                                    }
                                }
                            }
                        }
                    }
                }
            },

            .link, .add, .update => {
                // `bun update <package>` is basically the same as `bun add <package>`, except
                // update will not exceed the current dependency range if it exists

                if (updates.len != 0) {
                    try PackageJSONEditor.edit(
                        manager,
                        updates,
                        &current_package_json.root,
                        dependency_list,
                        .{
                            .exact_versions = manager.options.enable.exact_versions,
                            .before_install = true,
                        },
                    );
                } else if (subcommand == .update) {
                    try PackageJSONEditor.editUpdateNoArgs(
                        manager,
                        &current_package_json.root,
                        .{
                            .exact_versions = true,
                            .before_install = true,
                        },
                    );
                }
            },
            else => {
                if (manager.options.patch_features == .commit) {
                    var pathbuf: bun.PathBuffer = undefined;
                    if (try manager.doPatchCommit(&pathbuf, log_level)) |stuff| {
                        // we're inside a workspace package, we need to edit the
                        // root json, not the `current_package_json`
                        if (stuff.not_in_workspace_root) {
                            not_in_workspace_root = stuff;
                        } else {
                            try PackageJSONEditor.editPatchedDependencies(
                                manager,
                                &current_package_json.root,
                                stuff.patch_key,
                                stuff.patchfile_path,
                            );
                        }
                    }
                }
            },
        }

        manager.to_update = subcommand == .update;

        {
            // Incase it's a pointer to self. Avoid RLS.
            const cloned = updates.*;
            manager.update_requests = cloned;
        }

        var buffer_writer = JSPrinter.BufferWriter.init(manager.allocator);
        try buffer_writer.buffer.list.ensureTotalCapacity(manager.allocator, current_package_json.source.contents.len + 1);
        buffer_writer.append_newline = preserve_trailing_newline_at_eof_for_package_json;
        var package_json_writer = JSPrinter.BufferPrinter.init(buffer_writer);

        var written = JSPrinter.printJSON(
            @TypeOf(&package_json_writer),
            &package_json_writer,
            current_package_json.root,
            &current_package_json.source,
            .{
                .indent = current_package_json_indent,
                .mangled_props = null,
            },
        ) catch |err| {
            Output.prettyErrorln("package.json failed to write due to error {s}", .{@errorName(err)});
            Global.crash();
        };

        // There are various tradeoffs with how we commit updates when you run `bun add` or `bun remove`
        // The one we chose here is to effectively pretend a human did:
        // 1. "bun add react@latest"
        // 2. open lockfile, find what react resolved to
        // 3. open package.json
        // 4. replace "react" : "latest" with "react" : "^16.2.0"
        // 5. save package.json
        // The Smarter™ approach is you resolve ahead of time and write to disk once!
        // But, turns out that's slower in any case where more than one package has to be resolved (most of the time!)
        // Concurrent network requests are faster than doing one and then waiting until the next batch
        var new_package_json_source = try manager.allocator.dupe(u8, package_json_writer.ctx.writtenWithoutTrailingZero());
        current_package_json.source.contents = new_package_json_source;

        // may or may not be the package json we are editing
        const top_level_dir_without_trailing_slash = strings.withoutTrailingSlash(FileSystem.instance.top_level_dir);

        var root_package_json_path_buf: bun.PathBuffer = undefined;
        const root_package_json_source, const root_package_json_path = brk: {
            @memcpy(root_package_json_path_buf[0..top_level_dir_without_trailing_slash.len], top_level_dir_without_trailing_slash);
            @memcpy(root_package_json_path_buf[top_level_dir_without_trailing_slash.len..][0.."/package.json".len], "/package.json");
            const root_package_json_path = root_package_json_path_buf[0 .. top_level_dir_without_trailing_slash.len + "/package.json".len];
            root_package_json_path_buf[root_package_json_path.len] = 0;

            // The lifetime of this pointer is only valid until the next call to `getWithPath`, which can happen after this scope.
            // https://github.com/oven-sh/bun/issues/12288
            const root_package_json = switch (manager.workspace_package_json_cache.getWithPath(
                manager.allocator,
                manager.log,
                root_package_json_path,
                .{
                    .guess_indentation = true,
                },
            )) {
                .parse_err => |err| {
                    manager.log.print(Output.errorWriter()) catch {};
                    Output.errGeneric("failed to parse package.json \"{s}\": {s}", .{
                        root_package_json_path,
                        @errorName(err),
                    });
                    Global.crash();
                },
                .read_err => |err| {
                    Output.errGeneric("failed to read package.json \"{s}\": {s}", .{
                        manager.original_package_json_path,
                        @errorName(err),
                    });
                    Global.crash();
                },
                .entry => |entry| entry,
            };

            if (not_in_workspace_root) |stuff| {
                try PackageJSONEditor.editPatchedDependencies(
                    manager,
                    &root_package_json.root,
                    stuff.patch_key,
                    stuff.patchfile_path,
                );
                var buffer_writer2 = JSPrinter.BufferWriter.init(manager.allocator);
                try buffer_writer2.buffer.list.ensureTotalCapacity(manager.allocator, root_package_json.source.contents.len + 1);
                buffer_writer2.append_newline = preserve_trailing_newline_at_eof_for_package_json;
                var package_json_writer2 = JSPrinter.BufferPrinter.init(buffer_writer2);

                _ = JSPrinter.printJSON(
                    @TypeOf(&package_json_writer2),
                    &package_json_writer2,
                    root_package_json.root,
                    &root_package_json.source,
                    .{
                        .indent = root_package_json.indentation,
                        .mangled_props = null,
                    },
                ) catch |err| {
                    Output.prettyErrorln("package.json failed to write due to error {s}", .{@errorName(err)});
                    Global.crash();
                };
                root_package_json.source.contents = try manager.allocator.dupe(u8, package_json_writer2.ctx.writtenWithoutTrailingZero());
            }

            break :brk .{ root_package_json.source.contents, root_package_json_path_buf[0..root_package_json_path.len :0] };
        };

        try manager.installWithManager(ctx, root_package_json_source, original_cwd);

        if (subcommand == .update or subcommand == .add or subcommand == .link) {
            for (updates.*) |request| {
                if (request.failed) {
                    Global.exit(1);
                    return;
                }
            }

            const source = &logger.Source.initPathString("package.json", new_package_json_source);

            // Now, we _re_ parse our in-memory edited package.json
            // so we can commit the version we changed from the lockfile
            var new_package_json = JSON.parsePackageJSONUTF8(source, manager.log, manager.allocator) catch |err| {
                Output.prettyErrorln("package.json failed to parse due to error {s}", .{@errorName(err)});
                Global.crash();
            };

            if (updates.len == 0) {
                try PackageJSONEditor.editUpdateNoArgs(
                    manager,
                    &new_package_json,
                    .{
                        .exact_versions = manager.options.enable.exact_versions,
                    },
                );
            } else {
                try PackageJSONEditor.edit(
                    manager,
                    updates,
                    &new_package_json,
                    dependency_list,
                    .{
                        .exact_versions = manager.options.enable.exact_versions,
                        .add_trusted_dependencies = manager.options.do.trust_dependencies_from_args,
                    },
                );
            }
            var buffer_writer_two = JSPrinter.BufferWriter.init(manager.allocator);
            try buffer_writer_two.buffer.list.ensureTotalCapacity(manager.allocator, source.contents.len + 1);
            buffer_writer_two.append_newline =
                preserve_trailing_newline_at_eof_for_package_json;
            var package_json_writer_two = JSPrinter.BufferPrinter.init(buffer_writer_two);

            written = JSPrinter.printJSON(
                @TypeOf(&package_json_writer_two),
                &package_json_writer_two,
                new_package_json,
                source,
                .{
                    .indent = current_package_json_indent,
                    .mangled_props = null,
                },
            ) catch |err| {
                Output.prettyErrorln("package.json failed to write due to error {s}", .{@errorName(err)});
                Global.crash();
            };

            new_package_json_source = try manager.allocator.dupe(u8, package_json_writer_two.ctx.writtenWithoutTrailingZero());
        }

        if (manager.options.do.write_package_json) {
            const source, const path = if (manager.options.patch_features == .commit)
                .{ root_package_json_source, root_package_json_path }
            else
                .{ new_package_json_source, manager.original_package_json_path };

            // Now that we've run the install step
            // We can save our in-memory package.json to disk
            const workspace_package_json_file = (try bun.sys.File.openat(
                .cwd(),
                path,
                bun.O.RDWR,
                0,
            ).unwrap()).handle.stdFile();

            try workspace_package_json_file.pwriteAll(source, 0);
            std.posix.ftruncate(workspace_package_json_file.handle, source.len) catch {};
            workspace_package_json_file.close();

            if (subcommand == .remove) {
                if (!any_changes) {
                    Global.exit(0);
                    return;
                }

                var cwd = std.fs.cwd();
                // This is not exactly correct
                var node_modules_buf: bun.PathBuffer = undefined;
                bun.copy(u8, &node_modules_buf, "node_modules" ++ std.fs.path.sep_str);
                const offset_buf = node_modules_buf["node_modules/".len..];
                const name_hashes = manager.lockfile.packages.items(.name_hash);
                for (updates.*) |request| {
                    // If the package no longer exists in the updated lockfile, delete the directory
                    // This is not thorough.
                    // It does not handle nested dependencies
                    // This is a quick & dirty cleanup intended for when deleting top-level dependencies
                    if (std.mem.indexOfScalar(PackageNameHash, name_hashes, String.Builder.stringHash(request.name)) == null) {
                        bun.copy(u8, offset_buf, request.name);
                        cwd.deleteTree(node_modules_buf[0 .. "node_modules/".len + request.name.len]) catch {};
                    }
                }

                // This is where we clean dangling symlinks
                // This could be slow if there are a lot of symlinks
                if (bun.openDir(cwd, manager.options.bin_path)) |node_modules_bin_handle| {
                    var node_modules_bin: std.fs.Dir = node_modules_bin_handle;
                    defer node_modules_bin.close();
                    var iter: std.fs.Dir.Iterator = node_modules_bin.iterate();
                    iterator: while (iter.next() catch null) |entry| {
                        switch (entry.kind) {
                            std.fs.Dir.Entry.Kind.sym_link => {

                                // any symlinks which we are unable to open are assumed to be dangling
                                // note that using access won't work here, because access doesn't resolve symlinks
                                bun.copy(u8, &node_modules_buf, entry.name);
                                node_modules_buf[entry.name.len] = 0;
                                const buf: [:0]u8 = node_modules_buf[0..entry.name.len :0];

                                var file = node_modules_bin.openFileZ(buf, .{ .mode = .read_only }) catch {
                                    node_modules_bin.deleteFileZ(buf) catch {};
                                    continue :iterator;
                                };

                                file.close();
                            },
                            else => {},
                        }
                    }
                } else |err| {
                    if (err != error.ENOENT) {
                        Output.err(err, "while reading node_modules/.bin", .{});
                        Global.crash();
                    }
                }
            }
        }
    }

    fn nodeModulesFolderForDependencyIDs(iterator: *Lockfile.Tree.Iterator(.node_modules), ids: []const IdPair) !?Lockfile.Tree.Iterator(.node_modules).Next {
        while (iterator.next(null)) |node_modules| {
            for (ids) |id| {
                _ = std.mem.indexOfScalar(DependencyID, node_modules.dependencies, id[0]) orelse continue;
                return node_modules;
            }
        }
        return null;
    }

    fn nodeModulesFolderForDependencyID(iterator: *Lockfile.Tree.Iterator(.node_modules), dependency_id: DependencyID) !?Lockfile.Tree.Iterator(.node_modules).Next {
        while (iterator.next(null)) |node_modules| {
            _ = std.mem.indexOfScalar(DependencyID, node_modules.dependencies, dependency_id) orelse continue;
            return node_modules;
        }

        return null;
    }

    const IdPair = struct { DependencyID, PackageID };

    fn pkgInfoForNameAndVersion(
        lockfile: *Lockfile,
        iterator: *Lockfile.Tree.Iterator(.node_modules),
        pkg_maybe_version_to_patch: []const u8,
        name: []const u8,
        version: ?[]const u8,
    ) struct { PackageID, Lockfile.Tree.Iterator(.node_modules).Next } {
        var sfb = std.heap.stackFallback(@sizeOf(IdPair) * 4, lockfile.allocator);
        var pairs = std.ArrayList(IdPair).initCapacity(sfb.get(), 8) catch bun.outOfMemory();
        defer pairs.deinit();

        const name_hash = String.Builder.stringHash(name);

        const strbuf = lockfile.buffers.string_bytes.items;

        var buf: [1024]u8 = undefined;
        const dependencies = lockfile.buffers.dependencies.items;

        for (dependencies, 0..) |dep, dep_id| {
            if (dep.name_hash != name_hash) continue;
            const pkg_id = lockfile.buffers.resolutions.items[dep_id];
            if (pkg_id == invalid_package_id) continue;
            const pkg = lockfile.packages.get(pkg_id);
            if (version) |v| {
                const label = std.fmt.bufPrint(buf[0..], "{}", .{pkg.resolution.fmt(strbuf, .posix)}) catch @panic("Resolution name too long");
                if (std.mem.eql(u8, label, v)) {
                    pairs.append(.{ @intCast(dep_id), pkg_id }) catch bun.outOfMemory();
                }
            } else {
                pairs.append(.{ @intCast(dep_id), pkg_id }) catch bun.outOfMemory();
            }
        }

        if (pairs.items.len == 0) {
            Output.prettyErrorln("\n<r><red>error<r>: package <b>{s}<r> not found<r>", .{pkg_maybe_version_to_patch});
            Global.crash();
            return;
        }

        // user supplied a version e.g. `is-even@1.0.0`
        if (version != null) {
            if (pairs.items.len == 1) {
                const dep_id, const pkg_id = pairs.items[0];
                const folder = (try nodeModulesFolderForDependencyID(iterator, dep_id)) orelse {
                    Output.prettyError(
                        "<r><red>error<r>: could not find the folder for <b>{s}<r> in node_modules<r>\n<r>",
                        .{pkg_maybe_version_to_patch},
                    );
                    Global.crash();
                };
                return .{
                    pkg_id,
                    folder,
                };
            }

            // we found multiple dependents of the supplied pkg + version
            // the final package in the node_modules might be hoisted
            // so we are going to try looking for each dep id in node_modules
            _, const pkg_id = pairs.items[0];
            const folder = (try nodeModulesFolderForDependencyIDs(iterator, pairs.items)) orelse {
                Output.prettyError(
                    "<r><red>error<r>: could not find the folder for <b>{s}<r> in node_modules<r>\n<r>",
                    .{pkg_maybe_version_to_patch},
                );
                Global.crash();
            };

            return .{
                pkg_id,
                folder,
            };
        }

        // Otherwise the user did not supply a version, just the pkg name

        // Only one match, let's use it
        if (pairs.items.len == 1) {
            const dep_id, const pkg_id = pairs.items[0];
            const folder = (try nodeModulesFolderForDependencyID(iterator, dep_id)) orelse {
                Output.prettyError(
                    "<r><red>error<r>: could not find the folder for <b>{s}<r> in node_modules<r>\n<r>",
                    .{pkg_maybe_version_to_patch},
                );
                Global.crash();
            };
            return .{
                pkg_id,
                folder,
            };
        }

        // Otherwise we have multiple matches
        //
        // There are two cases:
        // a) the multiple matches are all the same underlying package (this happens because there could be multiple dependents of the same package)
        // b) the matches are actually different packages, we'll prompt the user to select which one

        _, const pkg_id = pairs.items[0];
        const count = count: {
            var count: u32 = 0;
            for (pairs.items) |pair| {
                if (pair[1] == pkg_id) count += 1;
            }
            break :count count;
        };

        // Disambiguate case a) from b)
        if (count == pairs.items.len) {
            // It may be hoisted, so we'll try the first one that matches
            const folder = (try nodeModulesFolderForDependencyIDs(iterator, pairs.items)) orelse {
                Output.prettyError(
                    "<r><red>error<r>: could not find the folder for <b>{s}<r> in node_modules<r>\n<r>",
                    .{pkg_maybe_version_to_patch},
                );
                Global.crash();
            };
            return .{
                pkg_id,
                folder,
            };
        }

        Output.prettyErrorln(
            "\n<r><red>error<r>: Found multiple versions of <b>{s}<r>, please specify a precise version from the following list:<r>\n",
            .{name},
        );
        var i: usize = 0;
        while (i < pairs.items.len) : (i += 1) {
            _, const pkgid = pairs.items[i];
            if (pkgid == invalid_package_id)
                continue;

            const pkg = lockfile.packages.get(pkgid);

            Output.prettyError("  {s}@<blue>{}<r>\n", .{ pkg.name.slice(strbuf), pkg.resolution.fmt(strbuf, .posix) });

            if (i + 1 < pairs.items.len) {
                for (pairs.items[i + 1 ..]) |*p| {
                    if (p[1] == pkgid) {
                        p[1] = invalid_package_id;
                    }
                }
            }
        }
        Global.crash();
    }

    const PatchArgKind = enum {
        path,
        name_and_version,

        pub fn fromArg(argument: []const u8) PatchArgKind {
            if (bun.strings.containsComptime(argument, "node_modules/")) return .path;
            if (bun.Environment.isWindows and bun.strings.hasPrefix(argument, "node_modules\\")) return .path;
            return .name_and_version;
        }
    };

    fn pathArgumentRelativeToRootWorkspacePackage(manager: *PackageManager, lockfile: *const Lockfile, argument: []const u8) ?[]const u8 {
        const workspace_package_id = manager.root_package_id.get(lockfile, manager.workspace_name_hash);
        if (workspace_package_id == 0) return null;
        const workspace_res = lockfile.packages.items(.resolution)[workspace_package_id];
        const rel_path: []const u8 = workspace_res.value.workspace.slice(lockfile.buffers.string_bytes.items);
        return bun.default_allocator.dupe(u8, bun.path.join(&[_][]const u8{ rel_path, argument }, .posix)) catch bun.outOfMemory();
    }

    /// 1. Arg is either:
    ///   - name and possibly version (e.g. "is-even" or "is-even@1.0.0")
    ///   - path to package in node_modules
    /// 2. Calculate cache dir for package
    /// 3. Overwrite the input package with the one from the cache (cuz it could be hardlinked)
    /// 4. Print to user
    fn preparePatch(manager: *PackageManager) !void {
        const strbuf = manager.lockfile.buffers.string_bytes.items;
        var argument = manager.options.positionals[1];

        const arg_kind: PatchArgKind = PatchArgKind.fromArg(argument);

        var folder_path_buf: bun.PathBuffer = undefined;
        var iterator = Lockfile.Tree.Iterator(.node_modules).init(manager.lockfile);
        var resolution_buf: [1024]u8 = undefined;

        var win_normalizer: if (bun.Environment.isWindows) bun.PathBuffer else struct {} = undefined;

        const not_in_workspace_root = manager.root_package_id.get(manager.lockfile, manager.workspace_name_hash) != 0;
        var free_argument = false;
        argument = if (arg_kind == .path and
            not_in_workspace_root and
            (!bun.path.Platform.posix.isAbsolute(argument) or (bun.Environment.isWindows and !bun.path.Platform.windows.isAbsolute(argument))))
        brk: {
            if (pathArgumentRelativeToRootWorkspacePackage(manager, manager.lockfile, argument)) |rel_path| {
                free_argument = true;
                break :brk rel_path;
            }
            break :brk argument;
        } else argument;
        defer if (free_argument) manager.allocator.free(argument);

        const cache_dir: std.fs.Dir, const cache_dir_subpath: []const u8, const module_folder: []const u8, const pkg_name: []const u8 = switch (arg_kind) {
            .path => brk: {
                var lockfile = manager.lockfile;

                const package_json_source: *const logger.Source = &src: {
                    const package_json_path = bun.path.joinZ(&[_][]const u8{ argument, "package.json" }, .auto);

                    switch (bun.sys.File.toSource(package_json_path, manager.allocator, .{})) {
                        .result => |s| break :src s,
                        .err => |e| {
                            Output.err(e, "failed to read {s}", .{bun.fmt.quote(package_json_path)});
                            Global.crash();
                        },
                    }
                };
                defer manager.allocator.free(package_json_source.contents);

                initializeStore();
                const json = JSON.parsePackageJSONUTF8(package_json_source, manager.log, manager.allocator) catch |err| {
                    manager.log.print(Output.errorWriter()) catch {};
                    Output.prettyErrorln("<r><red>{s}<r> parsing package.json in <b>\"{s}\"<r>", .{ @errorName(err), package_json_source.path.prettyDir() });
                    Global.crash();
                };

                const version = version: {
                    if (json.asProperty("version")) |v| {
                        if (v.expr.asString(manager.allocator)) |s| break :version s;
                    }
                    Output.prettyError(
                        "<r><red>error<r>: invalid package.json, missing or invalid property \"version\": {s}<r>\n",
                        .{package_json_source.path.text},
                    );
                    Global.crash();
                };

                var resolver: void = {};
                var package = Lockfile.Package{};
                try package.parseWithJSON(lockfile, manager, manager.allocator, manager.log, package_json_source, json, void, &resolver, Features.folder);

                const name = lockfile.str(&package.name);
                const actual_package = switch (lockfile.package_index.get(package.name_hash) orelse {
                    Output.prettyError(
                        "<r><red>error<r>: failed to find package in lockfile package index, this is a bug in Bun. Please file a GitHub issue.<r>\n",
                        .{},
                    );
                    Global.crash();
                }) {
                    .id => |id| lockfile.packages.get(id),
                    .ids => |ids| id: {
                        for (ids.items) |id| {
                            const pkg = lockfile.packages.get(id);
                            const resolution_label = std.fmt.bufPrint(&resolution_buf, "{}", .{pkg.resolution.fmt(lockfile.buffers.string_bytes.items, .posix)}) catch unreachable;
                            if (std.mem.eql(u8, resolution_label, version)) {
                                break :id pkg;
                            }
                        }
                        Output.prettyError("<r><red>error<r>: could not find package with name:<r> {s}\n<r>", .{
                            package.name.slice(lockfile.buffers.string_bytes.items),
                        });
                        Global.crash();
                    },
                };

                const existing_patchfile_hash = existing_patchfile_hash: {
                    var __sfb = std.heap.stackFallback(1024, manager.allocator);
                    const allocator = __sfb.get();
                    const name_and_version = std.fmt.allocPrint(allocator, "{s}@{}", .{ name, actual_package.resolution.fmt(strbuf, .posix) }) catch unreachable;
                    defer allocator.free(name_and_version);
                    const name_and_version_hash = String.Builder.stringHash(name_and_version);
                    if (lockfile.patched_dependencies.get(name_and_version_hash)) |patched_dep| {
                        if (patched_dep.patchfileHash()) |hash| break :existing_patchfile_hash hash;
                    }
                    break :existing_patchfile_hash null;
                };

                const cache_result = manager.computeCacheDirAndSubpath(
                    name,
                    &actual_package.resolution,
                    &folder_path_buf,
                    existing_patchfile_hash,
                );
                const cache_dir = cache_result.cache_dir;
                const cache_dir_subpath = cache_result.cache_dir_subpath;

                const buf = if (comptime bun.Environment.isWindows) bun.path.pathToPosixBuf(u8, argument, win_normalizer[0..]) else argument;

                break :brk .{
                    cache_dir,
                    cache_dir_subpath,
                    buf,
                    name,
                };
            },
            .name_and_version => brk: {
                const pkg_maybe_version_to_patch = argument;
                const name, const version = Dependency.splitNameAndMaybeVersion(pkg_maybe_version_to_patch);
                const pkg_id, const folder = pkgInfoForNameAndVersion(manager.lockfile, &iterator, pkg_maybe_version_to_patch, name, version);

                const pkg = manager.lockfile.packages.get(pkg_id);
                const pkg_name = pkg.name.slice(strbuf);

                const existing_patchfile_hash = existing_patchfile_hash: {
                    var __sfb = std.heap.stackFallback(1024, manager.allocator);
                    const sfballoc = __sfb.get();
                    const name_and_version = std.fmt.allocPrint(sfballoc, "{s}@{}", .{ name, pkg.resolution.fmt(strbuf, .posix) }) catch unreachable;
                    defer sfballoc.free(name_and_version);
                    const name_and_version_hash = String.Builder.stringHash(name_and_version);
                    if (manager.lockfile.patched_dependencies.get(name_and_version_hash)) |patched_dep| {
                        if (patched_dep.patchfileHash()) |hash| break :existing_patchfile_hash hash;
                    }
                    break :existing_patchfile_hash null;
                };

                const cache_result = manager.computeCacheDirAndSubpath(
                    pkg_name,
                    &pkg.resolution,
                    &folder_path_buf,
                    existing_patchfile_hash,
                );

                const cache_dir = cache_result.cache_dir;
                const cache_dir_subpath = cache_result.cache_dir_subpath;

                const module_folder_ = bun.path.join(&[_][]const u8{ folder.relative_path, name }, .auto);
                const buf = if (comptime bun.Environment.isWindows) bun.path.pathToPosixBuf(u8, module_folder_, win_normalizer[0..]) else module_folder_;

                break :brk .{
                    cache_dir,
                    cache_dir_subpath,
                    buf,
                    pkg_name,
                };
            },
        };

        // The package may be installed using the hard link method,
        // meaning that changes to the folder will also change the package in the cache.
        //
        // So we will overwrite the folder by directly copying the package in cache into it
        manager.overwritePackageInNodeModulesFolder(cache_dir, cache_dir_subpath, module_folder) catch |e| {
            Output.prettyError(
                "<r><red>error<r>: error overwriting folder in node_modules: {s}\n<r>",
                .{@errorName(e)},
            );
            Global.crash();
        };

        if (not_in_workspace_root) {
            var bufn: bun.PathBuffer = undefined;
            Output.pretty("\nTo patch <b>{s}<r>, edit the following folder:\n\n  <cyan>{s}<r>\n", .{ pkg_name, bun.path.joinStringBuf(bufn[0..], &[_][]const u8{ bun.fs.FileSystem.instance.topLevelDirWithoutTrailingSlash(), module_folder }, .posix) });
            Output.pretty("\nOnce you're done with your changes, run:\n\n  <cyan>bun patch --commit '{s}'<r>\n", .{bun.path.joinStringBuf(bufn[0..], &[_][]const u8{ bun.fs.FileSystem.instance.topLevelDirWithoutTrailingSlash(), module_folder }, .posix)});
        } else {
            Output.pretty("\nTo patch <b>{s}<r>, edit the following folder:\n\n  <cyan>{s}<r>\n", .{ pkg_name, module_folder });
            Output.pretty("\nOnce you're done with your changes, run:\n\n  <cyan>bun patch --commit '{s}'<r>\n", .{module_folder});
        }

        return;
    }

    fn overwritePackageInNodeModulesFolder(
        manager: *PackageManager,
        cache_dir: std.fs.Dir,
        cache_dir_subpath: []const u8,
        node_modules_folder_path: []const u8,
    ) !void {
        var node_modules_folder = try std.fs.cwd().openDir(node_modules_folder_path, .{ .iterate = true });
        defer node_modules_folder.close();

        const IGNORED_PATHS: []const bun.OSPathSlice = &[_][]const bun.OSPathChar{
            bun.OSPathLiteral("node_modules"),
            bun.OSPathLiteral(".git"),
            bun.OSPathLiteral("CMakeFiles"),
        };

        const FileCopier = struct {
            pub fn copy(
                destination_dir_: std.fs.Dir,
                walker: *Walker,
                in_dir: if (bun.Environment.isWindows) []const u16 else void,
                out_dir: if (bun.Environment.isWindows) []const u16 else void,
                buf1: if (bun.Environment.isWindows) []u16 else void,
                buf2: if (bun.Environment.isWindows) []u16 else void,
                tmpdir_in_node_modules: if (bun.Environment.isWindows) std.fs.Dir else void,
            ) !u32 {
                var real_file_count: u32 = 0;

                var copy_file_state: bun.CopyFileState = .{};
                var pathbuf: bun.PathBuffer = undefined;
                var pathbuf2: bun.PathBuffer = undefined;
                // _ = pathbuf; // autofix

                while (try walker.next()) |entry| {
                    if (entry.kind != .file) continue;
                    real_file_count += 1;
                    const openFile = std.fs.Dir.openFile;
                    const createFile = std.fs.Dir.createFile;

                    // 1. rename original file in node_modules to tmp_dir_in_node_modules
                    // 2. create the file again
                    // 3. copy cache flie to the newly re-created file
                    // 4. profit
                    if (comptime bun.Environment.isWindows) {
                        var tmpbuf: [1024]u8 = undefined;
                        const basename = bun.strings.fromWPath(pathbuf2[0..], entry.basename);
                        const tmpname = bun.span(bun.fs.FileSystem.instance.tmpname(basename, tmpbuf[0..], bun.fastRandom()) catch |e| {
                            Output.prettyError("<r><red>error<r>: copying file {s}", .{@errorName(e)});
                            Global.crash();
                        });

                        const entrypath = bun.strings.fromWPath(pathbuf[0..], entry.path);
                        pathbuf[entrypath.len] = 0;
                        const entrypathZ = pathbuf[0..entrypath.len :0];

                        if (bun.sys.renameatConcurrently(
                            .fromStdDir(destination_dir_),
                            entrypathZ,
                            .fromStdDir(tmpdir_in_node_modules),
                            tmpname,
                            .{ .move_fallback = true },
                        ).asErr()) |e| {
                            Output.prettyError("<r><red>error<r>: copying file {}", .{e});
                            Global.crash();
                        }

                        var outfile = createFile(destination_dir_, entrypath, .{}) catch |e| {
                            Output.prettyError("<r><red>error<r>: failed to create file {s} ({s})", .{ entrypath, @errorName(e) });
                            Global.crash();
                        };
                        outfile.close();

                        const infile_path = bun.path.joinStringBufWZ(buf1, &[_][]const u16{ in_dir, entry.path }, .auto);
                        const outfile_path = bun.path.joinStringBufWZ(buf2, &[_][]const u16{ out_dir, entry.path }, .auto);

                        bun.copyFileWithState(infile_path, outfile_path, &copy_file_state).unwrap() catch |err| {
                            Output.prettyError("<r><red>{s}<r>: copying file {}", .{ @errorName(err), bun.fmt.fmtOSPath(entry.path, .{}) });
                            Global.crash();
                        };
                    } else if (comptime Environment.isPosix) {
                        var in_file = try openFile(entry.dir, entry.basename, .{ .mode = .read_only });
                        defer in_file.close();

                        @memcpy(pathbuf[0..entry.path.len], entry.path);
                        pathbuf[entry.path.len] = 0;

                        if (bun.sys.unlinkat(
                            .fromStdDir(destination_dir_),
                            pathbuf[0..entry.path.len :0],
                        ).asErr()) |e| {
                            Output.prettyError("<r><red>error<r>: copying file {}", .{e.withPath(entry.path)});
                            Global.crash();
                        }

                        var outfile = try createFile(destination_dir_, entry.path, .{});
                        defer outfile.close();

                        const stat = in_file.stat() catch continue;
                        _ = bun.c.fchmod(outfile.handle, @intCast(stat.mode));

                        bun.copyFileWithState(.fromStdFile(in_file), .fromStdFile(outfile), &copy_file_state).unwrap() catch |err| {
                            Output.prettyError("<r><red>{s}<r>: copying file {}", .{ @errorName(err), bun.fmt.fmtOSPath(entry.path, .{}) });
                            Global.crash();
                        };
                    }
                }

                return real_file_count;
            }
        };

        var pkg_in_cache_dir = try cache_dir.openDir(cache_dir_subpath, .{ .iterate = true });
        defer pkg_in_cache_dir.close();
        var walker = Walker.walk(pkg_in_cache_dir, manager.allocator, &.{}, IGNORED_PATHS) catch bun.outOfMemory();
        defer walker.deinit();

        var buf1: if (bun.Environment.isWindows) bun.WPathBuffer else void = undefined;
        var buf2: if (bun.Environment.isWindows) bun.WPathBuffer else void = undefined;
        var in_dir: if (bun.Environment.isWindows) []const u16 else void = undefined;
        var out_dir: if (bun.Environment.isWindows) []const u16 else void = undefined;

        if (comptime bun.Environment.isWindows) {
            const inlen = bun.windows.GetFinalPathNameByHandleW(pkg_in_cache_dir.fd, &buf1, buf1.len, 0);
            if (inlen == 0) {
                const e = bun.windows.Win32Error.get();
                const err = if (e.toSystemErrno()) |sys_err| bun.errnoToZigErr(sys_err) else error.Unexpected;
                Output.prettyError("<r><red>error<r>: copying file {}", .{err});
                Global.crash();
            }
            in_dir = buf1[0..inlen];
            const outlen = bun.windows.GetFinalPathNameByHandleW(node_modules_folder.fd, &buf2, buf2.len, 0);
            if (outlen == 0) {
                const e = bun.windows.Win32Error.get();
                const err = if (e.toSystemErrno()) |sys_err| bun.errnoToZigErr(sys_err) else error.Unexpected;
                Output.prettyError("<r><red>error<r>: copying file {}", .{err});
                Global.crash();
            }
            out_dir = buf2[0..outlen];
            var tmpbuf: [1024]u8 = undefined;
            const tmpname = bun.span(bun.fs.FileSystem.instance.tmpname("tffbp", tmpbuf[0..], bun.fastRandom()) catch |e| {
                Output.prettyError("<r><red>error<r>: copying file {s}", .{@errorName(e)});
                Global.crash();
            });
            const temp_folder_in_node_modules = try node_modules_folder.makeOpenPath(tmpname, .{});
            defer {
                node_modules_folder.deleteTree(tmpname) catch {};
            }
            _ = try FileCopier.copy(
                node_modules_folder,
                &walker,
                in_dir,
                out_dir,
                &buf1,
                &buf2,
                temp_folder_in_node_modules,
            );
        } else if (Environment.isPosix) {
            _ = try FileCopier.copy(
                node_modules_folder,
                &walker,
                {},
                {},
                {},
                {},
                {},
            );
        }
    }

    const PatchCommitResult = struct {
        patch_key: []const u8,
        patchfile_path: []const u8,
        not_in_workspace_root: bool = false,
    };

    /// - Arg is the dir containing the package with changes OR name and version
    /// - Get the patch file contents by running git diff on the temp dir and the original package dir
    /// - Write the patch file to $PATCHES_DIR/$PKG_NAME_AND_VERSION.patch
    /// - Update "patchedDependencies" in package.json
    /// - Run install to install newly patched pkg
    fn doPatchCommit(
        manager: *PackageManager,
        pathbuf: *bun.PathBuffer,
        log_level: Options.LogLevel,
    ) !?PatchCommitResult {
        var folder_path_buf: bun.PathBuffer = undefined;
        var lockfile: *Lockfile = try manager.allocator.create(Lockfile);
        defer lockfile.deinit();
        switch (lockfile.loadFromCwd(manager, manager.allocator, manager.log, true)) {
            .not_found => {
                Output.errGeneric("Cannot find lockfile. Install packages with `<cyan>bun install<r>` before patching them.", .{});
                Global.crash();
            },
            .err => |cause| {
                if (log_level != .silent) {
                    switch (cause.step) {
                        .open_file => Output.prettyError("<r><red>error<r> opening lockfile:<r> {s}\n<r>", .{
                            @errorName(cause.value),
                        }),
                        .parse_file => Output.prettyError("<r><red>error<r> parsing lockfile:<r> {s}\n<r>", .{
                            @errorName(cause.value),
                        }),
                        .read_file => Output.prettyError("<r><red>error<r> reading lockfile:<r> {s}\n<r>", .{
                            @errorName(cause.value),
                        }),
                        .migrating => Output.prettyError("<r><red>error<r> migrating lockfile:<r> {s}\n<r>", .{
                            @errorName(cause.value),
                        }),
                    }

                    if (manager.options.enable.fail_early) {
                        Output.prettyError("<b><red>failed to load lockfile<r>\n", .{});
                    } else {
                        Output.prettyError("<b><red>ignoring lockfile<r>\n", .{});
                    }

                    Output.flush();
                }
                Global.crash();
            },
            .ok => {},
        }

        var argument = manager.options.positionals[1];
        const arg_kind: PatchArgKind = PatchArgKind.fromArg(argument);

        const not_in_workspace_root = manager.root_package_id.get(lockfile, manager.workspace_name_hash) != 0;
        var free_argument = false;
        argument = if (arg_kind == .path and
            not_in_workspace_root and
            (!bun.path.Platform.posix.isAbsolute(argument) or (bun.Environment.isWindows and !bun.path.Platform.windows.isAbsolute(argument))))
        brk: {
            if (pathArgumentRelativeToRootWorkspacePackage(manager, lockfile, argument)) |rel_path| {
                free_argument = true;
                break :brk rel_path;
            }
            break :brk argument;
        } else argument;
        defer if (free_argument) manager.allocator.free(argument);

        // Attempt to open the existing node_modules folder
        var root_node_modules = switch (bun.sys.openatOSPath(bun.FD.cwd(), bun.OSPathLiteral("node_modules"), bun.O.DIRECTORY | bun.O.RDONLY, 0o755)) {
            .result => |fd| std.fs.Dir{ .fd = fd.cast() },
            .err => |e| {
                Output.prettyError(
                    "<r><red>error<r>: failed to open root <b>node_modules<r> folder: {}<r>\n",
                    .{e},
                );
                Global.crash();
            },
        };
        defer root_node_modules.close();

        var iterator = Lockfile.Tree.Iterator(.node_modules).init(lockfile);
        var resolution_buf: [1024]u8 = undefined;
        const _cache_dir: std.fs.Dir, const _cache_dir_subpath: stringZ, const _changes_dir: []const u8, const _pkg: Package = switch (arg_kind) {
            .path => result: {
                const package_json_source: *const logger.Source = &brk: {
                    const package_json_path = bun.path.joinZ(&[_][]const u8{ argument, "package.json" }, .auto);

                    switch (bun.sys.File.toSource(package_json_path, manager.allocator, .{})) {
                        .result => |s| break :brk s,
                        .err => |e| {
                            Output.err(e, "failed to read {s}", .{bun.fmt.quote(package_json_path)});
                            Global.crash();
                        },
                    }
                };
                defer manager.allocator.free(package_json_source.contents);

                initializeStore();
                const json = JSON.parsePackageJSONUTF8(package_json_source, manager.log, manager.allocator) catch |err| {
                    manager.log.print(Output.errorWriter()) catch {};
                    Output.prettyErrorln("<r><red>{s}<r> parsing package.json in <b>\"{s}\"<r>", .{ @errorName(err), package_json_source.path.prettyDir() });
                    Global.crash();
                };

                const version = version: {
                    if (json.asProperty("version")) |v| {
                        if (v.expr.asString(manager.allocator)) |s| break :version s;
                    }
                    Output.prettyError(
                        "<r><red>error<r>: invalid package.json, missing or invalid property \"version\": {s}<r>\n",
                        .{package_json_source.path.text},
                    );
                    Global.crash();
                };

                var resolver: void = {};
                var package = Lockfile.Package{};
                try package.parseWithJSON(lockfile, manager, manager.allocator, manager.log, package_json_source, json, void, &resolver, Features.folder);

                const name = lockfile.str(&package.name);
                const actual_package = switch (lockfile.package_index.get(package.name_hash) orelse {
                    Output.prettyError(
                        "<r><red>error<r>: failed to find package in lockfile package index, this is a bug in Bun. Please file a GitHub issue.<r>\n",
                        .{},
                    );
                    Global.crash();
                }) {
                    .id => |id| lockfile.packages.get(id),
                    .ids => |ids| brk: {
                        for (ids.items) |id| {
                            const pkg = lockfile.packages.get(id);
                            const resolution_label = std.fmt.bufPrint(&resolution_buf, "{}", .{pkg.resolution.fmt(lockfile.buffers.string_bytes.items, .posix)}) catch unreachable;
                            if (std.mem.eql(u8, resolution_label, version)) {
                                break :brk pkg;
                            }
                        }
                        Output.prettyError("<r><red>error<r>: could not find package with name:<r> {s}\n<r>", .{
                            package.name.slice(lockfile.buffers.string_bytes.items),
                        });
                        Global.crash();
                    },
                };

                const cache_result = manager.computeCacheDirAndSubpath(
                    name,
                    &actual_package.resolution,
                    &folder_path_buf,
                    null,
                );
                const cache_dir = cache_result.cache_dir;
                const cache_dir_subpath = cache_result.cache_dir_subpath;

                const changes_dir = argument;

                break :result .{ cache_dir, cache_dir_subpath, changes_dir, actual_package };
            },
            .name_and_version => brk: {
                const name, const version = Dependency.splitNameAndMaybeVersion(argument);
                const pkg_id, const node_modules = pkgInfoForNameAndVersion(lockfile, &iterator, argument, name, version);

                const changes_dir = bun.path.joinZBuf(pathbuf[0..], &[_][]const u8{
                    node_modules.relative_path,
                    name,
                }, .auto);
                const pkg = lockfile.packages.get(pkg_id);

                const cache_result = manager.computeCacheDirAndSubpath(
                    pkg.name.slice(lockfile.buffers.string_bytes.items),
                    &pkg.resolution,
                    &folder_path_buf,
                    null,
                );
                const cache_dir = cache_result.cache_dir;
                const cache_dir_subpath = cache_result.cache_dir_subpath;
                break :brk .{ cache_dir, cache_dir_subpath, changes_dir, pkg };
            },
        };

        // zls
        const cache_dir: std.fs.Dir = _cache_dir;
        const cache_dir_subpath: stringZ = _cache_dir_subpath;
        const changes_dir: []const u8 = _changes_dir;
        const pkg: Package = _pkg;

        const name = pkg.name.slice(lockfile.buffers.string_bytes.items);
        const resolution_label = std.fmt.bufPrint(&resolution_buf, "{s}@{}", .{ name, pkg.resolution.fmt(lockfile.buffers.string_bytes.items, .posix) }) catch unreachable;

        const patchfile_contents = brk: {
            const new_folder = changes_dir;
            var buf2: bun.PathBuffer = undefined;
            var buf3: bun.PathBuffer = undefined;
            const old_folder = old_folder: {
                const cache_dir_path = switch (bun.sys.getFdPath(.fromStdDir(cache_dir), &buf2)) {
                    .result => |s| s,
                    .err => |e| {
                        Output.err(e, "failed to read from cache", .{});
                        Global.crash();
                    },
                };
                break :old_folder bun.path.join(&[_][]const u8{
                    cache_dir_path,
                    cache_dir_subpath,
                }, .posix);
            };

            const random_tempdir = bun.span(bun.fs.FileSystem.instance.tmpname("node_modules_tmp", buf2[0..], bun.fastRandom()) catch |e| {
                Output.err(e, "failed to make tempdir", .{});
                Global.crash();
            });

            // If the package has nested a node_modules folder, we don't want this to
            // appear in the patch file when we run git diff.
            //
            // There isn't an option to exclude it with `git diff --no-index`, so we
            // will `rename()` it out and back again.
            const has_nested_node_modules = has_nested_node_modules: {
                var new_folder_handle = std.fs.cwd().openDir(new_folder, .{}) catch |e| {
                    Output.err(e, "failed to open directory <b>{s}<r>", .{new_folder});
                    Global.crash();
                };
                defer new_folder_handle.close();

                if (bun.sys.renameatConcurrently(
                    .fromStdDir(new_folder_handle),
                    "node_modules",
                    .fromStdDir(root_node_modules),
                    random_tempdir,
                    .{ .move_fallback = true },
                ).asErr()) |_| break :has_nested_node_modules false;

                break :has_nested_node_modules true;
            };

            const patch_tag_tmpname = bun.span(bun.fs.FileSystem.instance.tmpname("patch_tmp", buf3[0..], bun.fastRandom()) catch |e| {
                Output.err(e, "failed to make tempdir", .{});
                Global.crash();
            });

            var bunpatchtagbuf: BuntagHashBuf = undefined;
            // If the package was already patched then it might have a ".bun-tag-XXXXXXXX"
            // we need to rename this out and back too.
            const bun_patch_tag: ?[:0]const u8 = has_bun_patch_tag: {
                const name_and_version_hash = String.Builder.stringHash(resolution_label);
                const patch_tag = patch_tag: {
                    if (lockfile.patched_dependencies.get(name_and_version_hash)) |patchdep| {
                        if (patchdep.patchfileHash()) |hash| {
                            break :patch_tag buntaghashbuf_make(&bunpatchtagbuf, hash);
                        }
                    }
                    break :has_bun_patch_tag null;
                };
                var new_folder_handle = std.fs.cwd().openDir(new_folder, .{}) catch |e| {
                    Output.err(e, "failed to open directory <b>{s}<r>", .{new_folder});
                    Global.crash();
                };
                defer new_folder_handle.close();

                if (bun.sys.renameatConcurrently(
                    .fromStdDir(new_folder_handle),
                    patch_tag,
                    .fromStdDir(root_node_modules),
                    patch_tag_tmpname,
                    .{ .move_fallback = true },
                ).asErr()) |e| {
                    Output.warn("failed renaming the bun patch tag, this may cause issues: {}", .{e});
                    break :has_bun_patch_tag null;
                }
                break :has_bun_patch_tag patch_tag;
            };
            defer {
                if (has_nested_node_modules or bun_patch_tag != null) {
                    var new_folder_handle = std.fs.cwd().openDir(new_folder, .{}) catch |e| {
                        Output.prettyError(
                            "<r><red>error<r>: failed to open directory <b>{s}<r> {s}<r>\n",
                            .{ new_folder, @errorName(e) },
                        );
                        Global.crash();
                    };
                    defer new_folder_handle.close();

                    if (has_nested_node_modules) {
                        if (bun.sys.renameatConcurrently(
                            .fromStdDir(root_node_modules),
                            random_tempdir,
                            .fromStdDir(new_folder_handle),
                            "node_modules",
                            .{ .move_fallback = true },
                        ).asErr()) |e| {
                            Output.warn("failed renaming nested node_modules folder, this may cause issues: {}", .{e});
                        }
                    }

                    if (bun_patch_tag) |patch_tag| {
                        if (bun.sys.renameatConcurrently(
                            .fromStdDir(root_node_modules),
                            patch_tag_tmpname,
                            .fromStdDir(new_folder_handle),
                            patch_tag,
                            .{ .move_fallback = true },
                        ).asErr()) |e| {
                            Output.warn("failed renaming the bun patch tag, this may cause issues: {}", .{e});
                        }
                    }
                }
            }

            var cwdbuf: bun.PathBuffer = undefined;
            const cwd = switch (bun.sys.getcwdZ(&cwdbuf)) {
                .result => |fd| fd,
                .err => |e| {
                    Output.prettyError(
                        "<r><red>error<r>: failed to get cwd path {}<r>\n",
                        .{e},
                    );
                    Global.crash();
                },
            };
            var gitbuf: bun.PathBuffer = undefined;
            const git = bun.which(&gitbuf, bun.getenvZ("PATH") orelse "", cwd, "git") orelse {
                Output.prettyError(
                    "<r><red>error<r>: git must be installed to use `bun patch --commit` <r>\n",
                    .{},
                );
                Global.crash();
            };
            const paths = bun.patch.gitDiffPreprocessPaths(bun.default_allocator, old_folder, new_folder, false);
            const opts = bun.patch.spawnOpts(paths[0], paths[1], cwd, git, &manager.event_loop);

            var spawn_result = switch (bun.spawnSync(&opts) catch |e| {
                Output.prettyError(
                    "<r><red>error<r>: failed to make diff {s}<r>\n",
                    .{@errorName(e)},
                );
                Global.crash();
            }) {
                .result => |r| r,
                .err => |e| {
                    Output.prettyError(
                        "<r><red>error<r>: failed to make diff {}<r>\n",
                        .{e},
                    );
                    Global.crash();
                },
            };

            const contents = switch (bun.patch.diffPostProcess(&spawn_result, paths[0], paths[1]) catch |e| {
                Output.prettyError(
                    "<r><red>error<r>: failed to make diff {s}<r>\n",
                    .{@errorName(e)},
                );
                Global.crash();
            }) {
                .result => |stdout| stdout,
                .err => |stderr| {
                    defer stderr.deinit();
                    const Truncate = struct {
                        stderr: std.ArrayList(u8),

                        pub fn format(
                            this: *const @This(),
                            comptime _: []const u8,
                            _: std.fmt.FormatOptions,
                            writer: anytype,
                        ) !void {
                            const truncate_stderr = this.stderr.items.len > 256;
                            if (truncate_stderr) {
                                try writer.print("{s}... ({d} more bytes)", .{ this.stderr.items[0..256], this.stderr.items.len - 256 });
                            } else try writer.print("{s}", .{this.stderr.items[0..]});
                        }
                    };
                    Output.prettyError(
                        "<r><red>error<r>: failed to make diff {}<r>\n",
                        .{
                            Truncate{ .stderr = stderr },
                        },
                    );
                    Global.crash();
                },
            };

            if (contents.items.len == 0) {
                Output.pretty("\n<r>No changes detected, comparing <red>{s}<r> to <green>{s}<r>\n", .{ old_folder, new_folder });
                Output.flush();
                contents.deinit();
                return null;
            }

            break :brk contents;
        };
        defer patchfile_contents.deinit();

        // write the patch contents to temp file then rename
        var tmpname_buf: [1024]u8 = undefined;
        const tempfile_name = bun.span(try bun.fs.FileSystem.instance.tmpname("tmp", &tmpname_buf, bun.fastRandom()));
        const tmpdir = manager.getTemporaryDirectory();
        const tmpfd = switch (bun.sys.openat(
            .fromStdDir(tmpdir),
            tempfile_name,
            bun.O.RDWR | bun.O.CREAT,
            0o666,
        )) {
            .result => |fd| fd,
            .err => |e| {
                Output.err(e, "failed to open temp file", .{});
                Global.crash();
            },
        };
        defer tmpfd.close();

        if (bun.sys.File.writeAll(.{ .handle = tmpfd }, patchfile_contents.items).asErr()) |e| {
            Output.err(e, "failed to write patch to temp file", .{});
            Global.crash();
        }

        @memcpy(resolution_buf[resolution_label.len .. resolution_label.len + ".patch".len], ".patch");
        var patch_filename: []const u8 = resolution_buf[0 .. resolution_label.len + ".patch".len];
        var deinit = false;
        if (escapePatchFilename(manager.allocator, patch_filename)) |escaped| {
            deinit = true;
            patch_filename = escaped;
        }
        defer if (deinit) manager.allocator.free(patch_filename);

        const path_in_patches_dir = bun.path.joinZ(
            &[_][]const u8{
                manager.options.patch_features.commit.patches_dir,
                patch_filename,
            },
            .posix,
        );

        var nodefs = bun.JSC.Node.fs.NodeFS{};
        const args = bun.JSC.Node.fs.Arguments.Mkdir{
            .path = .{ .string = bun.PathString.init(manager.options.patch_features.commit.patches_dir) },
        };
        if (nodefs.mkdirRecursive(args).asErr()) |e| {
            Output.err(e, "failed to make patches dir {}", .{bun.fmt.quote(args.path.slice())});
            Global.crash();
        }

        // rename to patches dir
        if (bun.sys.renameatConcurrently(
            .fromStdDir(tmpdir),
            tempfile_name,
            bun.FD.cwd(),
            path_in_patches_dir,
            .{ .move_fallback = true },
        ).asErr()) |e| {
            Output.err(e, "failed renaming patch file to patches dir", .{});
            Global.crash();
        }

        const patch_key = std.fmt.allocPrint(manager.allocator, "{s}", .{resolution_label}) catch bun.outOfMemory();
        const patchfile_path = manager.allocator.dupe(u8, path_in_patches_dir) catch bun.outOfMemory();
        _ = bun.sys.unlink(bun.path.joinZ(&[_][]const u8{ changes_dir, ".bun-patch-tag" }, .auto));

        return .{
            .patch_key = patch_key,
            .patchfile_path = patchfile_path,
            .not_in_workspace_root = not_in_workspace_root,
        };
    }

    fn patchCommitGetVersion(
        buf: *[1024]u8,
        patch_tag_path: [:0]const u8,
    ) bun.sys.Maybe(string) {
        const patch_tag_fd = switch (bun.sys.open(patch_tag_path, bun.O.RDONLY, 0)) {
            .result => |fd| fd,
            .err => |e| return .{ .err = e },
        };
        defer {
            patch_tag_fd.close();
            // we actually need to delete this
            _ = bun.sys.unlink(patch_tag_path);
        }

        const version = switch (bun.sys.File.readFillBuf(.{ .handle = patch_tag_fd }, buf[0..])) {
            .result => |v| v,
            .err => |e| return .{ .err = e },
        };

        // maybe if someone opens it in their editor and hits save a newline will be inserted,
        // so trim that off
        return .{ .result = std.mem.trimRight(u8, version, " \n\r\t") };
    }

    fn escapePatchFilename(allocator: std.mem.Allocator, name: []const u8) ?[]const u8 {
        const EscapeVal = enum {
            @"/",
            @"\\",
            @" ",
            @"\n",
            @"\r",
            @"\t",
            // @".",
            other,

            pub fn escaped(this: @This()) ?[]const u8 {
                return switch (this) {
                    .@"/" => "%2F",
                    .@"\\" => "%5c",
                    .@" " => "%20",
                    .@"\n" => "%0A",
                    .@"\r" => "%0D",
                    .@"\t" => "%09",
                    // .@"." => "%2E",
                    .other => null,
                };
            }
        };
        const ESCAPE_TABLE: [256]EscapeVal = comptime brk: {
            var table: [256]EscapeVal = [_]EscapeVal{.other} ** 256;
            const ty = @typeInfo(EscapeVal);
            for (ty.@"enum".fields) |field| {
                if (field.name.len == 1) {
                    const c = field.name[0];
                    table[c] = @enumFromInt(field.value);
                }
            }
            break :brk table;
        };
        var count: usize = 0;
        for (name) |c| count += if (ESCAPE_TABLE[c].escaped()) |e| e.len else 1;
        if (count == name.len) return null;
        var buf = allocator.alloc(u8, count) catch bun.outOfMemory();
        var i: usize = 0;
        for (name) |c| {
            const e = ESCAPE_TABLE[c].escaped() orelse &[_]u8{c};
            @memcpy(buf[i..][0..e.len], e);
            i += e.len;
        }
        return buf;
    }

    var cwd_buf: bun.PathBuffer = undefined;
    var package_json_cwd_buf: bun.PathBuffer = undefined;
    pub var package_json_cwd: string = "";

    pub fn install(ctx: Command.Context) !void {
        var cli = try CommandLineArguments.parse(ctx.allocator, .install);

        // The way this works:
        // 1. Run the bundler on source files
        // 2. Rewrite positional arguments to act identically to the developer
        //    typing in the dependency names
        // 3. Run the install command
        if (cli.analyze) {
            const Analyzer = struct {
                ctx: Command.Context,
                cli: *CommandLineArguments,
                pub fn onAnalyze(this: *@This(), result: *bun.bundle_v2.BundleV2.DependenciesScanner.Result) anyerror!void {
                    // TODO: add separate argument that makes it so positionals[1..] is not done     and instead the positionals are passed
                    var positionals = bun.default_allocator.alloc(string, result.dependencies.keys().len + 1) catch bun.outOfMemory();
                    positionals[0] = "install";
                    bun.copy(string, positionals[1..], result.dependencies.keys());
                    this.cli.positionals = positionals;

                    try installWithCLI(this.ctx, this.cli.*);

                    Global.exit(0);
                }
            };
            var analyzer = Analyzer{
                .ctx = ctx,
                .cli = &cli,
            };

            var fetcher = bun.bundle_v2.BundleV2.DependenciesScanner{
                .ctx = &analyzer,
                .entry_points = cli.positionals[1..],
                .onFetch = @ptrCast(&Analyzer.onAnalyze),
            };

            try bun.CLI.BuildCommand.exec(bun.CLI.Command.get(), &fetcher);
            return;
        }

        return installWithCLI(ctx, cli);
    }

    pub fn installWithCLI(ctx: Command.Context, cli: CommandLineArguments) !void {
        const subcommand: Subcommand = if (cli.positionals.len > 1) .add else .install;

        // TODO(dylan-conway): print `bun install <version>` or `bun add <version>` before logs from `init`.
        // and cleanup install/add subcommand usage
        var manager, const original_cwd = try init(ctx, cli, .install);

        // switch to `bun add <package>`
        if (subcommand == .add) {
            manager.subcommand = .add;
            if (manager.options.shouldPrintCommandName()) {
                Output.prettyln("<r><b>bun add <r><d>v" ++ Global.package_json_version_with_sha ++ "<r>\n", .{});
                Output.flush();
            }
            return manager.updatePackageJSONAndInstallWithManager(ctx, original_cwd);
        }

        if (manager.options.shouldPrintCommandName()) {
            Output.prettyln("<r><b>bun install <r><d>v" ++ Global.package_json_version_with_sha ++ "<r>\n", .{});
            Output.flush();
        }

        const package_json_contents = manager.root_package_json_file.readToEndAlloc(ctx.allocator, std.math.maxInt(usize)) catch |err| {
            if (manager.options.log_level != .silent) {
                Output.prettyErrorln("<r><red>{s} reading package.json<r> :(", .{@errorName(err)});
                Output.flush();
            }
            return;
        };

        try manager.installWithManager(ctx, package_json_contents, original_cwd);

        if (manager.any_failed_to_install) {
            Global.exit(1);
        }
    }

    pub const PackageInstaller = @import("./PackageInstaller.zig").PackageInstaller;

    pub inline fn pendingTaskCount(manager: *const PackageManager) u32 {
        return manager.pending_tasks.load(.monotonic);
    }

    pub inline fn incrementPendingTasks(manager: *PackageManager, count: u32) u32 {
        manager.total_tasks += count;
        return manager.pending_tasks.fetchAdd(count, .monotonic);
    }

    pub inline fn decrementPendingTasks(manager: *PackageManager) u32 {
        return manager.pending_tasks.fetchSub(1, .monotonic);
    }

    pub fn setupGlobalDir(manager: *PackageManager, ctx: Command.Context) !void {
        manager.options.global_bin_dir = try Options.openGlobalBinDir(ctx.install);
        var out_buffer: bun.PathBuffer = undefined;
        const result = try bun.getFdPathZ(.fromStdDir(manager.options.global_bin_dir), &out_buffer);
        const path = try FileSystem.instance.dirname_store.append([:0]u8, result);
        manager.options.bin_path = path.ptr[0..path.len :0];
    }

    pub fn startProgressBarIfNone(manager: *PackageManager) void {
        if (manager.downloads_node == null) {
            manager.startProgressBar();
        }
    }
    pub fn startProgressBar(manager: *PackageManager) void {
        manager.progress.supports_ansi_escape_codes = Output.enable_ansi_colors_stderr;
        manager.downloads_node = manager.progress.start(ProgressStrings.download(), 0);
        manager.setNodeName(manager.downloads_node.?, ProgressStrings.download_no_emoji_, ProgressStrings.download_emoji, true);
        manager.downloads_node.?.setEstimatedTotalItems(manager.total_tasks + manager.extracted_count);
        manager.downloads_node.?.setCompletedItems(manager.total_tasks - manager.pendingTaskCount());
        manager.downloads_node.?.activate();
        manager.progress.refresh();
    }

    pub fn endProgressBar(manager: *PackageManager) void {
        var downloads_node = manager.downloads_node orelse return;
        downloads_node.setEstimatedTotalItems(downloads_node.unprotected_estimated_total_items);
        downloads_node.setCompletedItems(downloads_node.unprotected_estimated_total_items);
        manager.progress.refresh();
        manager.progress.root.end();
        manager.progress = .{};
        manager.downloads_node = null;
    }

    pub fn loadRootLifecycleScripts(this: *PackageManager, root_package: Package) void {
        const binding_dot_gyp_path = Path.joinAbsStringZ(
            Fs.FileSystem.instance.top_level_dir,
            &[_]string{"binding.gyp"},
            .auto,
        );

        const buf = this.lockfile.buffers.string_bytes.items;
        // need to clone because this is a copy before Lockfile.cleanWithLogger
        const name = root_package.name.slice(buf);
        const top_level_dir_without_trailing_slash = strings.withoutTrailingSlash(FileSystem.instance.top_level_dir);

        if (root_package.scripts.hasAny()) {
            const add_node_gyp_rebuild_script = root_package.scripts.install.isEmpty() and root_package.scripts.preinstall.isEmpty() and Syscall.exists(binding_dot_gyp_path);

            this.root_lifecycle_scripts = root_package.scripts.createList(
                this.lockfile,
                buf,
                top_level_dir_without_trailing_slash,
                name,
                .root,
                add_node_gyp_rebuild_script,
            );
        } else {
            if (Syscall.exists(binding_dot_gyp_path)) {
                // no scripts exist but auto node gyp script needs to be added
                this.root_lifecycle_scripts = root_package.scripts.createList(
                    this.lockfile,
                    buf,
                    top_level_dir_without_trailing_slash,
                    name,
                    .root,
                    true,
                );
            }
        }
    }

    fn installWithManager(
        manager: *PackageManager,
        ctx: Command.Context,
        root_package_json_contents: string,
        original_cwd: string,
    ) !void {
        const log_level = manager.options.log_level;

        // Start resolving DNS for the default registry immediately.
        // Unless you're behind a proxy.
        if (!manager.env.hasHTTPProxy()) {
            // And don't try to resolve DNS if it's an IP address.
            if (manager.options.scope.url.hostname.len > 0 and !manager.options.scope.url.isIPAddress()) {
                var hostname_stack = std.heap.stackFallback(512, ctx.allocator);
                const allocator = hostname_stack.get();
                const hostname = try allocator.dupeZ(u8, manager.options.scope.url.hostname);
                defer allocator.free(hostname);
                bun.dns.internal.prefetch(manager.event_loop.loop(), hostname, manager.options.scope.url.getPortAuto());
            }
        }

        var load_result: Lockfile.LoadResult = if (manager.options.do.load_lockfile)
            manager.lockfile.loadFromCwd(
                manager,
                manager.allocator,
                manager.log,
                true,
            )
        else
            .{ .not_found = {} };

        try manager.updateLockfileIfNeeded(load_result);

        var root = Lockfile.Package{};
        var needs_new_lockfile = load_result != .ok or
            (load_result.ok.lockfile.buffers.dependencies.items.len == 0 and manager.update_requests.len > 0);

        manager.options.enable.force_save_lockfile = manager.options.enable.force_save_lockfile or
            (load_result == .ok and
                // if migrated always save a new lockfile
                (load_result.ok.was_migrated or

                    // if loaded from binary and save-text-lockfile is passed
                    (load_result.ok.format == .binary and
                        manager.options.save_text_lockfile orelse false)));

        // this defaults to false
        // but we force allowing updates to the lockfile when you do bun add
        var had_any_diffs = false;
        manager.progress = .{};

        // Step 2. Parse the package.json file
        const root_package_json_source = &logger.Source.initPathString(package_json_cwd, root_package_json_contents);

        switch (load_result) {
            .err => |cause| {
                if (log_level != .silent) {
                    switch (cause.step) {
                        .open_file => Output.err(cause.value, "failed to open lockfile: '{s}'", .{
                            cause.lockfile_path,
                        }),
                        .parse_file => Output.err(cause.value, "failed to parse lockfile: '{s}'", .{
                            cause.lockfile_path,
                        }),
                        .read_file => Output.err(cause.value, "failed to read lockfile: '{s}'", .{
                            cause.lockfile_path,
                        }),
                        .migrating => Output.err(cause.value, "failed to migrate lockfile: '{s}'", .{
                            cause.lockfile_path,
                        }),
                    }

                    if (!manager.options.enable.fail_early) {
                        Output.printErrorln("", .{});
                        Output.warn("Ignoring lockfile", .{});
                    }

                    if (ctx.log.errors > 0) {
                        try manager.log.print(Output.errorWriter());
                        manager.log.reset();
                    }
                    Output.flush();
                }

                if (manager.options.enable.fail_early) Global.crash();
            },
            .ok => {
                if (manager.subcommand == .update) {
                    // existing lockfile, get the original version is updating
                    const lockfile = manager.lockfile;
                    const packages = lockfile.packages.slice();
                    const resolutions = packages.items(.resolution);
                    const workspace_package_id = manager.root_package_id.get(lockfile, manager.workspace_name_hash);
                    const workspace_dep_list = packages.items(.dependencies)[workspace_package_id];
                    const workspace_res_list = packages.items(.resolutions)[workspace_package_id];
                    const workspace_deps = workspace_dep_list.get(lockfile.buffers.dependencies.items);
                    const workspace_package_ids = workspace_res_list.get(lockfile.buffers.resolutions.items);
                    for (workspace_deps, workspace_package_ids) |dep, package_id| {
                        if (dep.version.tag != .npm and dep.version.tag != .dist_tag) continue;
                        if (package_id == invalid_package_id) continue;

                        if (manager.updating_packages.getPtr(dep.name.slice(lockfile.buffers.string_bytes.items))) |entry_ptr| {
                            const original_resolution: Resolution = resolutions[package_id];
                            // Just in case check if the resolution is `npm`. It should always be `npm` because the dependency version
                            // is `npm` or `dist_tag`.
                            if (original_resolution.tag != .npm) continue;

                            var original = original_resolution.value.npm.version;
                            const tag_total = original.tag.pre.len() + original.tag.build.len();
                            if (tag_total > 0) {
                                // clone because don't know if lockfile buffer will reallocate
                                const tag_buf = manager.allocator.alloc(u8, tag_total) catch bun.outOfMemory();
                                var ptr = tag_buf;
                                original.tag = original_resolution.value.npm.version.tag.cloneInto(
                                    lockfile.buffers.string_bytes.items,
                                    &ptr,
                                );

                                entry_ptr.original_version_string_buf = tag_buf;
                            }

                            entry_ptr.original_version = original;
                        }
                    }
                }
                differ: {
                    root = load_result.ok.lockfile.rootPackage() orelse {
                        needs_new_lockfile = true;
                        break :differ;
                    };

                    if (root.dependencies.len == 0) {
                        needs_new_lockfile = true;
                    }

                    if (needs_new_lockfile) break :differ;

                    var lockfile: Lockfile = undefined;
                    lockfile.initEmpty(manager.allocator);
                    var maybe_root = Lockfile.Package{};

                    var resolver: void = {};
                    try maybe_root.parse(
                        &lockfile,
                        manager,
                        manager.allocator,
                        manager.log,
                        root_package_json_source,
                        void,
                        &resolver,
                        Features.main,
                    );
                    const mapping = try manager.lockfile.allocator.alloc(PackageID, maybe_root.dependencies.len);
                    @memset(mapping, invalid_package_id);

                    manager.summary = try Package.Diff.generate(
                        manager,
                        manager.allocator,
                        manager.log,
                        manager.lockfile,
                        &lockfile,
                        &root,
                        &maybe_root,
                        if (manager.to_update) manager.update_requests else null,
                        mapping,
                    );

                    had_any_diffs = manager.summary.hasDiffs();

                    if (!had_any_diffs) {
                        // always grab latest scripts for root package
                        var builder_ = manager.lockfile.stringBuilder();
                        var builder = &builder_;

                        maybe_root.scripts.count(lockfile.buffers.string_bytes.items, *Lockfile.StringBuilder, builder);
                        try builder.allocate();
                        manager.lockfile.packages.items(.scripts)[0] = maybe_root.scripts.clone(
                            lockfile.buffers.string_bytes.items,
                            *Lockfile.StringBuilder,
                            builder,
                        );
                        builder.clamp();
                    } else {
                        var builder_ = manager.lockfile.stringBuilder();
                        // ensure we use one pointer to reference it instead of creating new ones and potentially aliasing
                        var builder = &builder_;
                        // If you changed packages, we will copy over the new package from the new lockfile
                        const new_dependencies = maybe_root.dependencies.get(lockfile.buffers.dependencies.items);

                        for (new_dependencies) |new_dep| {
                            new_dep.count(lockfile.buffers.string_bytes.items, *Lockfile.StringBuilder, builder);
                        }

                        for (lockfile.workspace_paths.values()) |path| builder.count(path.slice(lockfile.buffers.string_bytes.items));
                        for (lockfile.workspace_versions.values()) |version| version.count(lockfile.buffers.string_bytes.items, *Lockfile.StringBuilder, builder);
                        for (lockfile.patched_dependencies.values()) |patch_dep| builder.count(patch_dep.path.slice(lockfile.buffers.string_bytes.items));

                        lockfile.overrides.count(&lockfile, builder);
                        lockfile.catalogs.count(&lockfile, builder);
                        maybe_root.scripts.count(lockfile.buffers.string_bytes.items, *Lockfile.StringBuilder, builder);

                        const off = @as(u32, @truncate(manager.lockfile.buffers.dependencies.items.len));
                        const len = @as(u32, @truncate(new_dependencies.len));
                        var packages = manager.lockfile.packages.slice();
                        var dep_lists = packages.items(.dependencies);
                        var resolution_lists = packages.items(.resolutions);
                        const old_resolutions_list = resolution_lists[0];
                        dep_lists[0] = .{ .off = off, .len = len };
                        resolution_lists[0] = .{ .off = off, .len = len };
                        try builder.allocate();

                        const all_name_hashes: []PackageNameHash = brk: {
                            if (!manager.summary.overrides_changed) break :brk &.{};
                            const hashes_len = manager.lockfile.overrides.map.entries.len + lockfile.overrides.map.entries.len;
                            if (hashes_len == 0) break :brk &.{};
                            var all_name_hashes = try bun.default_allocator.alloc(PackageNameHash, hashes_len);
                            @memcpy(all_name_hashes[0..manager.lockfile.overrides.map.entries.len], manager.lockfile.overrides.map.keys());
                            @memcpy(all_name_hashes[manager.lockfile.overrides.map.entries.len..], lockfile.overrides.map.keys());
                            var i = manager.lockfile.overrides.map.entries.len;
                            while (i < all_name_hashes.len) {
                                if (std.mem.indexOfScalar(PackageNameHash, all_name_hashes[0..i], all_name_hashes[i]) != null) {
                                    all_name_hashes[i] = all_name_hashes[all_name_hashes.len - 1];
                                    all_name_hashes.len -= 1;
                                } else {
                                    i += 1;
                                }
                            }
                            break :brk all_name_hashes;
                        };

                        manager.lockfile.overrides = try lockfile.overrides.clone(manager, &lockfile, manager.lockfile, builder);
                        manager.lockfile.catalogs = try lockfile.catalogs.clone(manager, &lockfile, manager.lockfile, builder);

                        manager.lockfile.trusted_dependencies = if (lockfile.trusted_dependencies) |trusted_dependencies|
                            try trusted_dependencies.clone(manager.lockfile.allocator)
                        else
                            null;

                        try manager.lockfile.buffers.dependencies.ensureUnusedCapacity(manager.lockfile.allocator, len);
                        try manager.lockfile.buffers.resolutions.ensureUnusedCapacity(manager.lockfile.allocator, len);

                        const old_resolutions = old_resolutions_list.get(manager.lockfile.buffers.resolutions.items);

                        var dependencies = manager.lockfile.buffers.dependencies.items.ptr[off .. off + len];
                        var resolutions = manager.lockfile.buffers.resolutions.items.ptr[off .. off + len];

                        // It is too easy to accidentally undefined memory
                        @memset(resolutions, invalid_package_id);
                        @memset(dependencies, Dependency{});

                        manager.lockfile.buffers.dependencies.items = manager.lockfile.buffers.dependencies.items.ptr[0 .. off + len];
                        manager.lockfile.buffers.resolutions.items = manager.lockfile.buffers.resolutions.items.ptr[0 .. off + len];

                        for (new_dependencies, 0..) |new_dep, i| {
                            dependencies[i] = try new_dep.clone(manager, lockfile.buffers.string_bytes.items, *Lockfile.StringBuilder, builder);
                            if (mapping[i] != invalid_package_id) {
                                resolutions[i] = old_resolutions[mapping[i]];
                            }
                        }

                        manager.lockfile.packages.items(.scripts)[0] = maybe_root.scripts.clone(
                            lockfile.buffers.string_bytes.items,
                            *Lockfile.StringBuilder,
                            builder,
                        );

                        // Update workspace paths
                        try manager.lockfile.workspace_paths.ensureTotalCapacity(manager.lockfile.allocator, lockfile.workspace_paths.entries.len);
                        {
                            manager.lockfile.workspace_paths.clearRetainingCapacity();
                            var iter = lockfile.workspace_paths.iterator();
                            while (iter.next()) |entry| {
                                // The string offsets will be wrong so fix them
                                const path = entry.value_ptr.slice(lockfile.buffers.string_bytes.items);
                                const str = builder.append(String, path);
                                manager.lockfile.workspace_paths.putAssumeCapacity(entry.key_ptr.*, str);
                            }
                        }

                        // Update workspace versions
                        try manager.lockfile.workspace_versions.ensureTotalCapacity(manager.lockfile.allocator, lockfile.workspace_versions.entries.len);
                        {
                            manager.lockfile.workspace_versions.clearRetainingCapacity();
                            var iter = lockfile.workspace_versions.iterator();
                            while (iter.next()) |entry| {
                                // Copy version string offsets
                                const version = entry.value_ptr.append(lockfile.buffers.string_bytes.items, *Lockfile.StringBuilder, builder);
                                manager.lockfile.workspace_versions.putAssumeCapacity(entry.key_ptr.*, version);
                            }
                        }

                        // Update patched dependencies
                        {
                            var iter = lockfile.patched_dependencies.iterator();
                            while (iter.next()) |entry| {
                                const pkg_name_and_version_hash = entry.key_ptr.*;
                                bun.debugAssert(entry.value_ptr.patchfile_hash_is_null);
                                const gop = try manager.lockfile.patched_dependencies.getOrPut(manager.lockfile.allocator, pkg_name_and_version_hash);
                                if (!gop.found_existing) {
                                    gop.value_ptr.* = .{
                                        .path = builder.append(String, entry.value_ptr.*.path.slice(lockfile.buffers.string_bytes.items)),
                                    };
                                    gop.value_ptr.setPatchfileHash(null);
                                    // gop.value_ptr.path = gop.value_ptr.path;
                                } else if (!bun.strings.eql(
                                    gop.value_ptr.path.slice(manager.lockfile.buffers.string_bytes.items),
                                    entry.value_ptr.path.slice(lockfile.buffers.string_bytes.items),
                                )) {
                                    gop.value_ptr.path = builder.append(String, entry.value_ptr.*.path.slice(lockfile.buffers.string_bytes.items));
                                    gop.value_ptr.setPatchfileHash(null);
                                }
                            }

                            var count: usize = 0;
                            iter = manager.lockfile.patched_dependencies.iterator();
                            while (iter.next()) |entry| {
                                if (!lockfile.patched_dependencies.contains(entry.key_ptr.*)) {
                                    count += 1;
                                }
                            }
                            if (count > 0) {
                                try manager.patched_dependencies_to_remove.ensureTotalCapacity(manager.allocator, count);
                                iter = manager.lockfile.patched_dependencies.iterator();
                                while (iter.next()) |entry| {
                                    if (!lockfile.patched_dependencies.contains(entry.key_ptr.*)) {
                                        try manager.patched_dependencies_to_remove.put(manager.allocator, entry.key_ptr.*, {});
                                    }
                                }
                                for (manager.patched_dependencies_to_remove.keys()) |hash| {
                                    _ = manager.lockfile.patched_dependencies.orderedRemove(hash);
                                }
                            }
                        }

                        builder.clamp();

                        if (manager.summary.overrides_changed and all_name_hashes.len > 0) {
                            for (manager.lockfile.buffers.dependencies.items, 0..) |*dependency, dependency_i| {
                                if (std.mem.indexOfScalar(PackageNameHash, all_name_hashes, dependency.name_hash)) |_| {
                                    manager.lockfile.buffers.resolutions.items[dependency_i] = invalid_package_id;
                                    try manager.enqueueDependencyWithMain(
                                        @truncate(dependency_i),
                                        dependency,
                                        invalid_package_id,
                                        false,
                                    );
                                }
                            }
                        }

                        if (manager.summary.catalogs_changed) {
                            for (manager.lockfile.buffers.dependencies.items, 0..) |*dep, _dep_id| {
                                const dep_id: DependencyID = @intCast(_dep_id);
                                if (dep.version.tag != .catalog) continue;

                                manager.lockfile.buffers.resolutions.items[dep_id] = invalid_package_id;
                                try manager.enqueueDependencyWithMain(
                                    dep_id,
                                    dep,
                                    invalid_package_id,
                                    false,
                                );
                            }
                        }

                        // Split this into two passes because the below may allocate memory or invalidate pointers
                        if (manager.summary.add > 0 or manager.summary.update > 0) {
                            const changes = @as(PackageID, @truncate(mapping.len));
                            var counter_i: PackageID = 0;

                            _ = manager.getCacheDirectory();
                            _ = manager.getTemporaryDirectory();

                            while (counter_i < changes) : (counter_i += 1) {
                                if (mapping[counter_i] == invalid_package_id) {
                                    const dependency_i = counter_i + off;
                                    const dependency = manager.lockfile.buffers.dependencies.items[dependency_i];
                                    try manager.enqueueDependencyWithMain(
                                        dependency_i,
                                        &dependency,
                                        manager.lockfile.buffers.resolutions.items[dependency_i],
                                        false,
                                    );
                                }
                            }
                        }

                        if (manager.summary.update > 0) root.scripts = .{};
                    }
                }
            },
            else => {},
        }

        if (needs_new_lockfile) {
            root = .{};
            manager.lockfile.initEmpty(manager.allocator);

            if (manager.options.enable.frozen_lockfile and load_result != .not_found) {
                if (log_level != .silent) {
                    Output.prettyErrorln("<r><red>error<r>: lockfile had changes, but lockfile is frozen", .{});
                }
                Global.crash();
            }

            var resolver: void = {};
            try root.parse(
                manager.lockfile,
                manager,
                manager.allocator,
                manager.log,
                root_package_json_source,
                void,
                &resolver,
                Features.main,
            );

            root = try manager.lockfile.appendPackage(root);

            if (root.dependencies.len > 0) {
                _ = manager.getCacheDirectory();
                _ = manager.getTemporaryDirectory();
            }
            {
                var iter = manager.lockfile.patched_dependencies.iterator();
                while (iter.next()) |entry| manager.enqueuePatchTaskPre(PatchTask.newCalcPatchHash(manager, entry.key_ptr.*, null));
            }
            manager.enqueueDependencyList(root.dependencies);
        } else {
            {
                var iter = manager.lockfile.patched_dependencies.iterator();
                while (iter.next()) |entry| manager.enqueuePatchTaskPre(PatchTask.newCalcPatchHash(manager, entry.key_ptr.*, null));
            }
            // Anything that needs to be downloaded from an update needs to be scheduled here
            manager.drainDependencyList();
        }

        if (manager.pendingTaskCount() > 0 or manager.peer_dependencies.readableLength() > 0) {
            if (root.dependencies.len > 0) {
                _ = manager.getCacheDirectory();
                _ = manager.getTemporaryDirectory();
            }

            if (log_level.showProgress()) {
                manager.startProgressBar();
            } else if (log_level != .silent) {
                Output.prettyErrorln("Resolving dependencies", .{});
                Output.flush();
            }

            const runAndWaitFn = struct {
                pub fn runAndWaitFn(comptime check_peers: bool, comptime only_pre_patch: bool) *const fn (*PackageManager) anyerror!void {
                    return struct {
                        manager: *PackageManager,
                        err: ?anyerror = null,
                        pub fn isDone(closure: *@This()) bool {
                            var this = closure.manager;
                            if (comptime check_peers)
                                this.processPeerDependencyList() catch |err| {
                                    closure.err = err;
                                    return true;
                                };

                            this.drainDependencyList();

                            this.runTasks(
                                *PackageManager,
                                this,
                                .{
                                    .onExtract = {},
                                    .onPatch = {},
                                    .onResolve = {},
                                    .onPackageManifestError = {},
                                    .onPackageDownloadError = {},
                                    .progress_bar = true,
                                },
                                check_peers,
                                this.options.log_level,
                            ) catch |err| {
                                closure.err = err;
                                return true;
                            };

                            if (comptime check_peers) {
                                if (this.peer_dependencies.readableLength() > 0) {
                                    return false;
                                }
                            }

                            if (comptime only_pre_patch) {
                                const pending_patch = this.pending_pre_calc_hashes.load(.monotonic);
                                return pending_patch == 0;
                            }

                            const pending_tasks = this.pendingTaskCount();

                            if (PackageManager.verbose_install and pending_tasks > 0) {
                                if (PackageManager.hasEnoughTimePassedBetweenWaitingMessages()) Output.prettyErrorln("<d>[PackageManager]<r> waiting for {d} tasks\n", .{pending_tasks});
                            }

                            return pending_tasks == 0;
                        }

                        pub fn runAndWait(this: *PackageManager) !void {
                            var closure = @This(){
                                .manager = this,
                            };

                            this.sleepUntil(&closure, &@This().isDone);

                            if (closure.err) |err| {
                                return err;
                            }
                        }
                    }.runAndWait;
                }
            }.runAndWaitFn;

            const waitForCalcingPatchHashes = runAndWaitFn(false, true);
            const waitForEverythingExceptPeers = runAndWaitFn(false, false);
            const waitForPeers = runAndWaitFn(true, false);

            if (manager.lockfile.patched_dependencies.entries.len > 0) {
                try waitForCalcingPatchHashes(manager);
            }

            if (manager.pendingTaskCount() > 0) {
                try waitForEverythingExceptPeers(manager);
            }

            try waitForPeers(manager);

            if (log_level.showProgress()) {
                manager.endProgressBar();
            } else if (log_level != .silent) {
                Output.prettyErrorln("Resolved, downloaded and extracted [{d}]", .{manager.total_tasks});
                Output.flush();
            }
        }

        const had_errors_before_cleaning_lockfile = manager.log.hasErrors();
        try manager.log.print(Output.errorWriter());
        manager.log.reset();

        // This operation doesn't perform any I/O, so it should be relatively cheap.
        const lockfile_before_clean = manager.lockfile;

        manager.lockfile = try manager.lockfile.cleanWithLogger(
            manager,
            manager.update_requests,
            manager.log,
            manager.options.enable.exact_versions,
            log_level,
        );

        if (manager.lockfile.packages.len > 0) {
            root = manager.lockfile.packages.get(0);
        }

        if (manager.lockfile.packages.len > 0) {
            for (manager.update_requests) |request| {
                // prevent redundant errors
                if (request.failed) {
                    return error.InstallFailed;
                }
            }
            manager.verifyResolutions(log_level);
        }

        // append scripts to lockfile before generating new metahash
        manager.loadRootLifecycleScripts(root);
        defer {
            if (manager.root_lifecycle_scripts) |root_scripts| {
                manager.allocator.free(root_scripts.package_name);
            }
        }

        if (manager.root_lifecycle_scripts) |root_scripts| {
            root_scripts.appendToLockfile(manager.lockfile);
        }
        {
            const packages = manager.lockfile.packages.slice();
            for (packages.items(.resolution), packages.items(.meta), packages.items(.scripts)) |resolution, meta, scripts| {
                if (resolution.tag == .workspace) {
                    if (meta.hasInstallScript()) {
                        if (scripts.hasAny()) {
                            const first_index, _, const entries = scripts.getScriptEntries(
                                manager.lockfile,
                                manager.lockfile.buffers.string_bytes.items,
                                .workspace,
                                false,
                            );

                            if (comptime Environment.allow_assert) {
                                bun.assert(first_index != -1);
                            }

                            if (first_index != -1) {
                                inline for (entries, 0..) |maybe_entry, i| {
                                    if (maybe_entry) |entry| {
                                        @field(manager.lockfile.scripts, Lockfile.Scripts.names[i]).append(
                                            manager.lockfile.allocator,
                                            entry,
                                        ) catch bun.outOfMemory();
                                    }
                                }
                            }
                        } else {
                            const first_index, _, const entries = scripts.getScriptEntries(
                                manager.lockfile,
                                manager.lockfile.buffers.string_bytes.items,
                                .workspace,
                                true,
                            );

                            if (comptime Environment.allow_assert) {
                                bun.assert(first_index != -1);
                            }

                            inline for (entries, 0..) |maybe_entry, i| {
                                if (maybe_entry) |entry| {
                                    @field(manager.lockfile.scripts, Lockfile.Scripts.names[i]).append(
                                        manager.lockfile.allocator,
                                        entry,
                                    ) catch bun.outOfMemory();
                                }
                            }
                        }
                    }
                }
            }
        }

        if (manager.options.global) {
            try manager.setupGlobalDir(ctx);
        }

        const packages_len_before_install = manager.lockfile.packages.len;

        if (manager.options.enable.frozen_lockfile and load_result != .not_found) frozen_lockfile: {
            if (load_result.loadedFromTextLockfile()) {
                if (manager.lockfile.eql(lockfile_before_clean, packages_len_before_install, manager.allocator) catch bun.outOfMemory()) {
                    break :frozen_lockfile;
                }
            } else {
                if (!(manager.lockfile.hasMetaHashChanged(PackageManager.verbose_install or manager.options.do.print_meta_hash_string, packages_len_before_install) catch false)) {
                    break :frozen_lockfile;
                }
            }

            if (log_level != .silent) {
                Output.prettyErrorln("<r><red>error<r><d>:<r> lockfile had changes, but lockfile is frozen", .{});
                Output.note("try re-running without <d>--frozen-lockfile<r> and commit the updated lockfile", .{});
            }
            Global.crash();
        }

        const lockfile_before_install = manager.lockfile;

        const save_format = load_result.saveFormat(&manager.options);

        if (manager.options.lockfile_only) {
            // save the lockfile and exit. make sure metahash is generated for binary lockfile

            manager.lockfile.meta_hash = try manager.lockfile.generateMetaHash(
                PackageManager.verbose_install or manager.options.do.print_meta_hash_string,
                packages_len_before_install,
            );

            try manager.saveLockfile(&load_result, save_format, had_any_diffs, lockfile_before_install, packages_len_before_install, log_level);

            if (manager.options.do.summary) {
                // TODO(dylan-conway): packages aren't installed but we can still print
                // added/removed/updated direct dependencies.
                Output.pretty("\nSaved <green>{s}<r> ({d} package{s}) ", .{
                    switch (save_format) {
                        .text => "bun.lock",
                        .binary => "bun.lockb",
                    },
                    manager.lockfile.packages.len,
                    if (manager.lockfile.packages.len == 1) "" else "s",
                });
                Output.printStartEndStdout(ctx.start_time, std.time.nanoTimestamp());
                Output.pretty("\n", .{});
            }
            Output.flush();
            return;
        }

        var path_buf: bun.PathBuffer = undefined;
        var workspace_filters: std.ArrayListUnmanaged(WorkspaceFilter) = .{};
        // only populated when subcommand is `.install`
        if (manager.subcommand == .install and manager.options.filter_patterns.len > 0) {
            try workspace_filters.ensureUnusedCapacity(manager.allocator, manager.options.filter_patterns.len);
            for (manager.options.filter_patterns) |pattern| {
                try workspace_filters.append(manager.allocator, try WorkspaceFilter.init(manager.allocator, pattern, original_cwd, &path_buf));
            }
        }
        defer workspace_filters.deinit(manager.allocator);

        var install_root_dependencies = workspace_filters.items.len == 0;
        if (!install_root_dependencies) {
            const pkg_names = manager.lockfile.packages.items(.name);

            const abs_root_path = abs_root_path: {
                if (comptime !Environment.isWindows) {
                    break :abs_root_path strings.withoutTrailingSlash(FileSystem.instance.top_level_dir);
                }

                var abs_path = Path.pathToPosixBuf(u8, FileSystem.instance.top_level_dir, &path_buf);
                break :abs_root_path strings.withoutTrailingSlash(abs_path[Path.windowsVolumeNameLen(abs_path)[0]..]);
            };

            for (workspace_filters.items) |filter| {
                const pattern, const path_or_name = switch (filter) {
                    .name => |pattern| .{ pattern, pkg_names[0].slice(manager.lockfile.buffers.string_bytes.items) },
                    .path => |pattern| .{ pattern, abs_root_path },
                    .all => {
                        install_root_dependencies = true;
                        continue;
                    },
                };

                switch (bun.glob.walk.matchImpl(manager.allocator, pattern, path_or_name)) {
                    .match, .negate_match => install_root_dependencies = true,

                    .negate_no_match => {
                        // always skip if a pattern specifically says "!<name>"
                        install_root_dependencies = false;
                        break;
                    },

                    .no_match => {},
                }
            }
        }

        var install_summary = PackageInstall.Summary{};
        if (manager.options.do.install_packages) {
            install_summary = try @import("./hoisted_install.zig").installHoistedPackages(
                manager,
                ctx,
                workspace_filters.items,
                install_root_dependencies,
                log_level,
            );
        }

        if (log_level != .silent) {
            try manager.log.print(Output.errorWriter());
        }
        if (had_errors_before_cleaning_lockfile or manager.log.hasErrors()) Global.crash();

        const did_meta_hash_change =
            // If the lockfile was frozen, we already checked it
            !manager.options.enable.frozen_lockfile and
            if (load_result.loadedFromTextLockfile())
                !try manager.lockfile.eql(lockfile_before_clean, packages_len_before_install, manager.allocator)
            else
                try manager.lockfile.hasMetaHashChanged(
                    PackageManager.verbose_install or manager.options.do.print_meta_hash_string,
                    @min(packages_len_before_install, manager.lockfile.packages.len),
                );

        // It's unnecessary work to re-save the lockfile if there are no changes
        const should_save_lockfile =
            (load_result == .ok and ((load_result.ok.format == .binary and save_format == .text) or

                // make sure old versions are updated
                load_result.ok.format == .text and save_format == .text and manager.lockfile.text_lockfile_version != TextLockfile.Version.current)) or

            // check `save_lockfile` after checking if loaded from binary and save format is text
            // because `save_lockfile` is set to false for `--frozen-lockfile`
            (manager.options.do.save_lockfile and
                (did_meta_hash_change or
                    had_any_diffs or
                    manager.update_requests.len > 0 or
                    (load_result == .ok and load_result.ok.serializer_result.packages_need_update) or
                    manager.lockfile.isEmpty() or
                    manager.options.enable.force_save_lockfile));

        if (should_save_lockfile) {
            try manager.saveLockfile(&load_result, save_format, had_any_diffs, lockfile_before_install, packages_len_before_install, log_level);
        }

        if (needs_new_lockfile) {
            manager.summary.add = @as(u32, @truncate(manager.lockfile.packages.len));
        }

        if (manager.options.do.save_yarn_lock) {
            var node: *Progress.Node = undefined;
            if (log_level.showProgress()) {
                manager.progress.supports_ansi_escape_codes = Output.enable_ansi_colors_stderr;
                node = manager.progress.start("Saving yarn.lock", 0);
                manager.progress.refresh();
            } else if (log_level != .silent) {
                Output.prettyErrorln("Saved yarn.lock", .{});
                Output.flush();
            }

            try manager.writeYarnLock();
            if (log_level.showProgress()) {
                node.completeOne();
                manager.progress.refresh();
                manager.progress.root.end();
                manager.progress = .{};
            }
        }

        if (manager.options.do.run_scripts and install_root_dependencies and !manager.options.global) {
            if (manager.root_lifecycle_scripts) |scripts| {
                if (comptime Environment.allow_assert) {
                    bun.assert(scripts.total > 0);
                }

                if (log_level != .silent) {
                    Output.printError("\n", .{});
                    Output.flush();
                }
                // root lifecycle scripts can run now that all dependencies are installed, dependency scripts
                // have finished, and lockfiles have been saved
                const optional = false;
                const output_in_foreground = true;
                try manager.spawnPackageLifecycleScripts(ctx, scripts, optional, output_in_foreground);

                while (manager.pending_lifecycle_script_tasks.load(.monotonic) > 0) {
                    manager.reportSlowLifecycleScripts();

                    manager.sleep();
                }
            }
        }

        if (log_level != .silent) {
            try manager.printInstallSummary(ctx, &install_summary, did_meta_hash_change, log_level);
        }

        if (install_summary.fail > 0) {
            manager.any_failed_to_install = true;
        }

        Output.flush();
    }

    fn printInstallSummary(
        this: *PackageManager,
        ctx: Command.Context,
        install_summary: *const PackageInstall.Summary,
        did_meta_hash_change: bool,
        log_level: Options.LogLevel,
    ) !void {
        var printed_timestamp = false;
        if (this.options.do.summary) {
            var printer = Lockfile.Printer{
                .lockfile = this.lockfile,
                .options = this.options,
                .updates = this.update_requests,
                .successfully_installed = install_summary.successfully_installed,
            };

            switch (Output.enable_ansi_colors) {
                inline else => |enable_ansi_colors| {
                    try Lockfile.Printer.Tree.print(&printer, this, Output.WriterType, Output.writer(), enable_ansi_colors, log_level);
                },
            }

            if (!did_meta_hash_change) {
                this.summary.remove = 0;
                this.summary.add = 0;
                this.summary.update = 0;
            }

            if (install_summary.success > 0) {
                // it's confusing when it shows 3 packages and says it installed 1
                const pkgs_installed = @max(
                    install_summary.success,
                    @as(
                        u32,
                        @truncate(this.update_requests.len),
                    ),
                );
                Output.pretty("<green>{d}<r> package{s}<r> installed ", .{ pkgs_installed, if (pkgs_installed == 1) "" else "s" });
                Output.printStartEndStdout(ctx.start_time, std.time.nanoTimestamp());
                printed_timestamp = true;
                printBlockedPackagesInfo(install_summary, this.options.global);

                if (this.summary.remove > 0) {
                    Output.pretty("Removed: <cyan>{d}<r>\n", .{this.summary.remove});
                }
            } else if (this.summary.remove > 0) {
                if (this.subcommand == .remove) {
                    for (this.update_requests) |request| {
                        Output.prettyln("<r><red>-<r> {s}", .{request.name});
                    }
                }

                Output.pretty("<r><b>{d}<r> package{s} removed ", .{ this.summary.remove, if (this.summary.remove == 1) "" else "s" });
                Output.printStartEndStdout(ctx.start_time, std.time.nanoTimestamp());
                printed_timestamp = true;
                printBlockedPackagesInfo(install_summary, this.options.global);
            } else if (install_summary.skipped > 0 and install_summary.fail == 0 and this.update_requests.len == 0) {
                const count = @as(PackageID, @truncate(this.lockfile.packages.len));
                if (count != install_summary.skipped) {
                    if (!this.options.enable.only_missing) {
                        Output.pretty("Checked <green>{d} install{s}<r> across {d} package{s} <d>(no changes)<r> ", .{
                            install_summary.skipped,
                            if (install_summary.skipped == 1) "" else "s",
                            count,
                            if (count == 1) "" else "s",
                        });
                        Output.printStartEndStdout(ctx.start_time, std.time.nanoTimestamp());
                    }
                    printed_timestamp = true;
                    printBlockedPackagesInfo(install_summary, this.options.global);
                } else {
                    Output.pretty("<r><green>Done<r>! Checked {d} package{s}<r> <d>(no changes)<r> ", .{
                        install_summary.skipped,
                        if (install_summary.skipped == 1) "" else "s",
                    });
                    Output.printStartEndStdout(ctx.start_time, std.time.nanoTimestamp());
                    printed_timestamp = true;
                    printBlockedPackagesInfo(install_summary, this.options.global);
                }
            }

            if (install_summary.fail > 0) {
                Output.prettyln("<r>Failed to install <red><b>{d}<r> package{s}\n", .{ install_summary.fail, if (install_summary.fail == 1) "" else "s" });
                Output.flush();
            }
        }

        if (this.options.do.summary) {
            if (!printed_timestamp) {
                Output.printStartEndStdout(ctx.start_time, std.time.nanoTimestamp());
                Output.prettyln("<d> done<r>", .{});
                printed_timestamp = true;
            }
        }
    }

    fn saveLockfile(
        this: *PackageManager,
        load_result: *const Lockfile.LoadResult,
        save_format: Lockfile.LoadResult.LockfileFormat,
        had_any_diffs: bool,
        // TODO(dylan-conway): this and `packages_len_before_install` can most likely be deleted
        // now that git dependnecies don't append to lockfile during installation.
        lockfile_before_install: *const Lockfile,
        packages_len_before_install: usize,
        log_level: Options.LogLevel,
    ) OOM!void {
        if (this.lockfile.isEmpty()) {
            if (!this.options.dry_run) delete: {
                const delete_format = switch (load_result.*) {
                    .not_found => break :delete,
                    .err => |err| err.format,
                    .ok => |ok| ok.format,
                };

                bun.sys.unlinkat(
                    FD.cwd(),
                    if (delete_format == .text) comptime bun.OSPathLiteral("bun.lock") else comptime bun.OSPathLiteral("bun.lockb"),
                ).unwrap() catch |err| {
                    // we don't care
                    if (err == error.ENOENT) {
                        if (had_any_diffs) return;
                        break :delete;
                    }

                    if (log_level != .silent) {
                        Output.err(err, "failed to delete empty lockfile", .{});
                    }
                    return;
                };
            }
            if (!this.options.global) {
                if (log_level != .silent) {
                    switch (this.subcommand) {
                        .remove => Output.prettyErrorln("\npackage.json has no dependencies! Deleted empty lockfile", .{}),
                        else => Output.prettyErrorln("No packages! Deleted empty lockfile", .{}),
                    }
                }
            }

            return;
        }

        var save_node: *Progress.Node = undefined;

        if (log_level.showProgress()) {
            this.progress.supports_ansi_escape_codes = Output.enable_ansi_colors_stderr;
            save_node = this.progress.start(ProgressStrings.save(), 0);
            save_node.activate();

            this.progress.refresh();
        }

        this.lockfile.saveToDisk(load_result, &this.options);

        // delete binary lockfile if saving text lockfile
        if (save_format == .text and load_result.loadedFromBinaryLockfile()) {
            _ = bun.sys.unlinkat(FD.cwd(), comptime bun.OSPathLiteral("bun.lockb"));
        }

        if (comptime Environment.allow_assert) {
            if (load_result.* != .not_found) {
                if (load_result.loadedFromTextLockfile()) {
                    if (!try this.lockfile.eql(lockfile_before_install, packages_len_before_install, this.allocator)) {
                        Output.panic("Lockfile non-deterministic after saving", .{});
                    }
                } else {
                    if (this.lockfile.hasMetaHashChanged(false, packages_len_before_install) catch false) {
                        Output.panic("Lockfile metahash non-deterministic after saving", .{});
                    }
                }
            }
        }

        if (log_level.showProgress()) {
            save_node.end();
            this.progress.refresh();
            this.progress.root.end();
            this.progress = .{};
        } else if (log_level != .silent) {
            Output.prettyErrorln("Saved lockfile", .{});
            Output.flush();
        }
    }

    fn printBlockedPackagesInfo(summary: *const PackageInstall.Summary, global: bool) void {
        const packages_count = summary.packages_with_blocked_scripts.count();
        var scripts_count: usize = 0;
        for (summary.packages_with_blocked_scripts.values()) |count| scripts_count += count;

        if (comptime Environment.allow_assert) {
            // if packages_count is greater than 0, scripts_count must also be greater than 0.
            bun.assert(packages_count == 0 or scripts_count > 0);
            // if scripts_count is 1, it's only possible for packages_count to be 1.
            bun.assert(scripts_count != 1 or packages_count == 1);
        }

        if (packages_count > 0) {
            Output.prettyln("\n\n<d>Blocked {d} postinstall{s}. Run `bun pm {s}untrusted` for details.<r>\n", .{
                scripts_count,
                if (scripts_count > 1) "s" else "",
                if (global) "-g " else "",
            });
        } else {
            Output.pretty("<r>\n", .{});
        }
    }

    pub fn verifyResolutions(this: *PackageManager, log_level: PackageManager.Options.LogLevel) void {
        const lockfile = this.lockfile;
        const resolutions_lists: []const Lockfile.DependencyIDSlice = lockfile.packages.items(.resolutions);
        const dependency_lists: []const Lockfile.DependencySlice = lockfile.packages.items(.dependencies);
        const pkg_resolutions = lockfile.packages.items(.resolution);
        const dependencies_buffer = lockfile.buffers.dependencies.items;
        const resolutions_buffer = lockfile.buffers.resolutions.items;
        const end: PackageID = @truncate(lockfile.packages.len);

        var any_failed = false;
        const string_buf = lockfile.buffers.string_bytes.items;

        for (resolutions_lists, dependency_lists, 0..) |resolution_list, dependency_list, parent_id| {
            for (resolution_list.get(resolutions_buffer), dependency_list.get(dependencies_buffer)) |package_id, failed_dep| {
                if (package_id < end) continue;

                // TODO lockfile rewrite: remove this and make non-optional peer dependencies error if they did not resolve.
                //      Need to keep this for now because old lockfiles might have a peer dependency without the optional flag set.
                if (failed_dep.behavior.isPeer()) continue;

                const features = switch (pkg_resolutions[parent_id].tag) {
                    .root, .workspace, .folder => this.options.local_package_features,
                    else => this.options.remote_package_features,
                };
                // even if optional dependencies are enabled, it's still allowed to fail
                if (failed_dep.behavior.optional or !failed_dep.behavior.isEnabled(features)) continue;

                if (log_level != .silent) {
                    if (failed_dep.name.isEmpty() or strings.eqlLong(failed_dep.name.slice(string_buf), failed_dep.version.literal.slice(string_buf), true)) {
                        Output.errGeneric("<b>{}<r><d> failed to resolve<r>", .{
                            failed_dep.version.literal.fmt(string_buf),
                        });
                    } else {
                        Output.errGeneric("<b>{s}<r><d>@<b>{}<r><d> failed to resolve<r>", .{
                            failed_dep.name.slice(string_buf),
                            failed_dep.version.literal.fmt(string_buf),
                        });
                    }
                }
                // track this so we can log each failure instead of just the first
                any_failed = true;
            }
        }

        if (any_failed) this.crash();
    }

    const EnqueueTarballForDownloadError = NetworkTask.ForTarballError;

    pub fn enqueueTarballForDownload(
        this: *PackageManager,
        dependency_id: DependencyID,
        package_id: PackageID,
        url: string,
        task_context: TaskCallbackContext,
        patch_name_and_version_hash: ?u64,
    ) EnqueueTarballForDownloadError!void {
        const task_id = Task.Id.forTarball(url);
        var task_queue = try this.task_queue.getOrPut(this.allocator, task_id);
        if (!task_queue.found_existing) {
            task_queue.value_ptr.* = .{};
        }

        try task_queue.value_ptr.append(
            this.allocator,
            task_context,
        );

        if (task_queue.found_existing) return;

        if (try this.generateNetworkTaskForTarball(
            task_id,
            url,
            this.lockfile.buffers.dependencies.items[dependency_id].behavior.isRequired(),
            dependency_id,
            this.lockfile.packages.get(package_id),
            patch_name_and_version_hash,
            .no_authorization,
        )) |task| {
            task.schedule(&this.network_tarball_batch);
            if (this.network_tarball_batch.len > 0) {
                _ = this.scheduleTasks();
            }
        }
    }

    pub fn enqueueTarballForReading(
        this: *PackageManager,
        dependency_id: DependencyID,
        alias: string,
        resolution: *const Resolution,
        task_context: TaskCallbackContext,
    ) void {
        const path = this.lockfile.str(&resolution.value.local_tarball);
        const task_id = Task.Id.forTarball(path);
        var task_queue = this.task_queue.getOrPut(this.allocator, task_id) catch unreachable;
        if (!task_queue.found_existing) {
            task_queue.value_ptr.* = .{};
        }

        task_queue.value_ptr.append(
            this.allocator,
            task_context,
        ) catch unreachable;

        if (task_queue.found_existing) return;

        this.task_batch.push(ThreadPool.Batch.from(this.enqueueLocalTarball(
            task_id,
            dependency_id,
            alias,
            path,
            resolution.*,
        )));
    }

    pub fn enqueueGitForCheckout(
        this: *PackageManager,
        dependency_id: DependencyID,
        alias: string,
        resolution: *const Resolution,
        task_context: TaskCallbackContext,
        patch_name_and_version_hash: ?u64,
    ) void {
        const repository = &resolution.value.git;
        const url = this.lockfile.str(&repository.repo);
        const clone_id = Task.Id.forGitClone(url);
        const resolved = this.lockfile.str(&repository.resolved);
        const checkout_id = Task.Id.forGitCheckout(url, resolved);
        var checkout_queue = this.task_queue.getOrPut(this.allocator, checkout_id) catch unreachable;
        if (!checkout_queue.found_existing) {
            checkout_queue.value_ptr.* = .{};
        }

        checkout_queue.value_ptr.append(
            this.allocator,
            task_context,
        ) catch unreachable;

        if (checkout_queue.found_existing) return;

        if (this.git_repositories.get(clone_id)) |repo_fd| {
            this.task_batch.push(ThreadPool.Batch.from(this.enqueueGitCheckout(checkout_id, repo_fd, dependency_id, alias, resolution.*, resolved, patch_name_and_version_hash)));
        } else {
            var clone_queue = this.task_queue.getOrPut(this.allocator, clone_id) catch unreachable;
            if (!clone_queue.found_existing) {
                clone_queue.value_ptr.* = .{};
            }

            clone_queue.value_ptr.append(
                this.allocator,
                .{ .dependency = dependency_id },
            ) catch unreachable;

            if (clone_queue.found_existing) return;

            this.task_batch.push(ThreadPool.Batch.from(this.enqueueGitClone(
                clone_id,
                alias,
                repository,
                dependency_id,
                &this.lockfile.buffers.dependencies.items[dependency_id],
                resolution,
                null,
            )));
        }
    }

    const EnqueuePackageForDownloadError = NetworkTask.ForTarballError;

    pub fn enqueuePackageForDownload(
        this: *PackageManager,
        name: []const u8,
        dependency_id: DependencyID,
        package_id: PackageID,
        version: bun.Semver.Version,
        url: []const u8,
        task_context: TaskCallbackContext,
        patch_name_and_version_hash: ?u64,
    ) EnqueuePackageForDownloadError!void {
        const task_id = Task.Id.forNPMPackage(name, version);
        var task_queue = try this.task_queue.getOrPut(this.allocator, task_id);
        if (!task_queue.found_existing) {
            task_queue.value_ptr.* = .{};
        }

        try task_queue.value_ptr.append(
            this.allocator,
            task_context,
        );

        if (task_queue.found_existing) return;

        const is_required = this.lockfile.buffers.dependencies.items[dependency_id].behavior.isRequired();

        if (try this.generateNetworkTaskForTarball(
            task_id,
            url,
            is_required,
            dependency_id,
            this.lockfile.packages.get(package_id),
            patch_name_and_version_hash,
            .allow_authorization,
        )) |task| {
            task.schedule(&this.network_tarball_batch);
            if (this.network_tarball_batch.len > 0) {
                _ = this.scheduleTasks();
            }
        }
    }

    pub fn spawnPackageLifecycleScripts(
        this: *PackageManager,
        ctx: Command.Context,
        list: Lockfile.Package.Scripts.List,
        optional: bool,
        foreground: bool,
    ) !void {
        const log_level = this.options.log_level;
        var any_scripts = false;
        for (list.items) |maybe_item| {
            if (maybe_item != null) {
                any_scripts = true;
                break;
            }
        }
        if (!any_scripts) {
            return;
        }

        try this.ensureTempNodeGypScript();

        const cwd = list.cwd;
        const this_transpiler = try this.configureEnvForScripts(ctx, log_level);
        const original_path = this_transpiler.env.get("PATH") orelse "";

        var PATH = try std.ArrayList(u8).initCapacity(bun.default_allocator, original_path.len + 1 + "node_modules/.bin".len + cwd.len + 1);
        var current_dir: ?*DirInfo = this_transpiler.resolver.readDirInfo(cwd) catch null;
        bun.assert(current_dir != null);
        while (current_dir) |dir| {
            if (PATH.items.len > 0 and PATH.items[PATH.items.len - 1] != std.fs.path.delimiter) {
                try PATH.append(std.fs.path.delimiter);
            }
            try PATH.appendSlice(strings.withoutTrailingSlash(dir.abs_path));
            if (!(dir.abs_path.len == 1 and dir.abs_path[0] == std.fs.path.sep)) {
                try PATH.append(std.fs.path.sep);
            }
            try PATH.appendSlice(this.options.bin_path);
            current_dir = dir.getParent();
        }

        if (original_path.len > 0) {
            if (PATH.items.len > 0 and PATH.items[PATH.items.len - 1] != std.fs.path.delimiter) {
                try PATH.append(std.fs.path.delimiter);
            }

            try PATH.appendSlice(original_path);
        }

        this_transpiler.env.map.put("PATH", PATH.items) catch unreachable;

        const envp = try this_transpiler.env.map.createNullDelimitedEnvMap(this.allocator);
        try this_transpiler.env.map.put("PATH", original_path);
        PATH.deinit();

        try LifecycleScriptSubprocess.spawnPackageScripts(this, list, envp, optional, log_level, foreground);
    }
};

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
