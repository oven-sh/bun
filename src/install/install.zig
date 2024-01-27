const bun = @import("root").bun;
const string = bun.string;
const Output = bun.Output;
const Global = bun.Global;
const Environment = bun.Environment;
const strings = bun.strings;
const MutableString = bun.MutableString;
const stringZ = bun.stringZ;
const default_allocator = bun.default_allocator;
const C = bun.C;
const std = @import("std");
const uws = @import("../deps/uws.zig");
const JSC = bun.JSC;
const DirInfo = @import("../resolver/dir_info.zig");

const JSLexer = bun.js_lexer;
const logger = bun.logger;

const js_parser = bun.js_parser;
const json_parser = bun.JSON;
const JSPrinter = bun.js_printer;

const linker = @import("../linker.zig");

const sync = @import("../sync.zig");
const Api = @import("../api/schema.zig").Api;
const Path = bun.path;
const configureTransformOptionsForBun = @import("../bun.js/config.zig").configureTransformOptionsForBun;
const Command = @import("../cli.zig").Command;
const BunArguments = @import("../cli.zig").Arguments;
const bundler = bun.bundler;

const DotEnv = @import("../env_loader.zig");
const which = @import("../which.zig").which;
const Run = @import("../bun_js.zig").Run;
const Fs = @import("../fs.zig");
const FileSystem = Fs.FileSystem;
const Lock = @import("../lock.zig").Lock;
const URL = @import("../url.zig").URL;
const HTTP = bun.http;
const AsyncHTTP = HTTP.AsyncHTTP;
const HTTPChannel = HTTP.HTTPChannel;

const HeaderBuilder = HTTP.HeaderBuilder;

const Integrity = @import("./integrity.zig").Integrity;
const clap = bun.clap;
const ExtractTarball = @import("./extract_tarball.zig");
const Npm = @import("./npm.zig");
const Bitset = bun.bit_set.DynamicBitSetUnmanaged;
const z_allocator = @import("../memory_allocator.zig").z_allocator;
const Syscall = bun.sys;
const RunCommand = @import("../cli/run_command.zig").RunCommand;
const PackageManagerCommand = @import("../cli/package_manager_command.zig").PackageManagerCommand;
threadlocal var initialized_store = false;
const Futex = @import("../futex.zig");

pub const Lockfile = @import("./lockfile.zig");

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
    JSAst.Expr.Data.Store.create(default_allocator);
    JSAst.Stmt.Data.Store.create(default_allocator);
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
        var mini_store = bun.default_allocator.create(MiniStore) catch @panic("OOM");
        mini_store.* = .{
            .heap = bun.MimallocArena.init() catch @panic("OOM"),
            .memory_allocator = undefined,
        };
        mini_store.memory_allocator = .{ .allocator = mini_store.heap.allocator() };
        mini_store.memory_allocator.reset();
        MiniStore.instance = mini_store;
        mini_store.memory_allocator.push();
    } else {
        var mini_store = MiniStore.instance.?;
        if (mini_store.memory_allocator.stack_allocator.fixed_buffer_allocator.end_index >= mini_store.memory_allocator.stack_allocator.fixed_buffer_allocator.buffer.len -| 1) {
            mini_store.heap.reset();
            mini_store.memory_allocator.allocator = mini_store.heap.allocator();
        }
        mini_store.memory_allocator.reset();
        mini_store.memory_allocator.push();
    }
}

const IdentityContext = @import("../identity_context.zig").IdentityContext;
const ArrayIdentityContext = @import("../identity_context.zig").ArrayIdentityContext;
const NetworkQueue = std.fifo.LinearFifo(*NetworkTask, .{ .Static = 32 });
const Semver = @import("./semver.zig");
const ExternalString = Semver.ExternalString;
const String = Semver.String;
const GlobalStringBuilder = @import("../string_builder.zig");
const SlicedString = Semver.SlicedString;
const Repository = @import("./repository.zig").Repository;
const Bin = @import("./bin.zig").Bin;
const Dependency = @import("./dependency.zig");
const Behavior = @import("./dependency.zig").Behavior;
const FolderResolution = @import("./resolvers/folder_resolver.zig").FolderResolution;

pub fn ExternalSlice(comptime Type: type) type {
    return ExternalSliceAligned(Type, null);
}

pub fn ExternalSliceAligned(comptime Type: type, comptime alignment_: ?u29) type {
    return extern struct {
        pub const alignment = alignment_ orelse @alignOf(*Type);
        pub const Slice = @This();

        pub const Child: type = Type;

        off: u32 = 0,
        len: u32 = 0,

        pub inline fn contains(this: Slice, id: u32) bool {
            return id >= this.off and id < (this.len + this.off);
        }

        pub inline fn get(this: Slice, in: []const Type) []const Type {
            if (comptime Environment.allow_assert) {
                std.debug.assert(this.off + this.len <= in.len);
            }
            // it should be impossible to address this out of bounds due to the minimum here
            return in.ptr[this.off..@min(in.len, this.off + this.len)];
        }

        pub inline fn mut(this: Slice, in: []Type) []Type {
            if (comptime Environment.allow_assert) {
                std.debug.assert(this.off + this.len <= in.len);
            }
            return in.ptr[this.off..@min(in.len, this.off + this.len)];
        }

        pub fn init(buf: []const Type, in: []const Type) Slice {
            // if (comptime Environment.allow_assert) {
            //     std.debug.assert(@intFromPtr(buf.ptr) <= @intFromPtr(in.ptr));
            //     std.debug.assert((@intFromPtr(in.ptr) + in.len) <= (@intFromPtr(buf.ptr) + buf.len));
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
pub const invalid_package_id = std.math.maxInt(PackageID);

pub const ExternalStringList = ExternalSlice(ExternalString);
pub const VersionSlice = ExternalSlice(Semver.Version);

pub const ExternalStringMap = extern struct {
    name: ExternalStringList = .{},
    value: ExternalStringList = .{},
};

pub const PackageNameHash = u64; // Use String.Builder.stringHash to compute this

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

const NetworkTask = struct {
    http: AsyncHTTP = undefined,
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

    pub fn notify(this: *NetworkTask, _: anytype) void {
        defer this.package_manager.wake();
        this.package_manager.network_channel.writeItem(this) catch {};
    }

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

    // The first time this happened!
    //
    // "peerDependencies": {
    //   "@ianvs/prettier-plugin-sort-imports": "*",
    //   "prettier-plugin-twig-melody": "*"
    // },
    // "peerDependenciesMeta": {
    //   "@ianvs/prettier-plugin-sort-imports": {
    //     "optional": true
    //   },
    // Example case ^
    // `@ianvs/prettier-plugin-sort-imports` is peer and also optional but was not marked optional because
    // the offset would be 0 and the current loop index is also 0.
    // const invalidate_manifest_cache_because_optional_peer_dependencies_were_not_marked_as_optional_if_the_optional_peer_dependency_offset_was_equal_to_the_current_index = 1697871350;
    // ----
    // The second time this happened!
    //
    // pre-release sorting when the number of segments between dots were different, was sorted incorrectly
    // so we must invalidate the manifest cache once again.
    //
    // example:
    //
    //  1.0.0-pre.a.b > 1.0.0-pre.a
    //  before ordering said the left was smaller than the right
    //
    // const invalidate_manifest_cache_because_prerelease_segments_were_sorted_incorrectly_sometimes = 1697871350;
    //
    // ----
    // The third time this happened!
    //
    // pre-release sorting bug again! If part of the pre-release segment is a number, and the other pre-release part is a string,
    // it would order them incorrectly by comparing them as strings.
    //
    // example:
    //
    // 1.0.0-alpha.22 < 1.0.0-alpha.1beta
    // before: false
    // after: true
    //
    const invalidate_manifest_cache_because_prerelease_segments_were_sorted_incorrectly_sometimes = 1702425477;

    pub fn forManifest(
        this: *NetworkTask,
        name: string,
        allocator: std.mem.Allocator,
        scope: *const Npm.Registry.Scope,
        loaded_manifest: ?Npm.PackageManifest,
        warn_on_error: bool,
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
                const msg = .{
                    .fmt = "Failed to join registry {} and package {} URLs",
                    .args = .{ bun.fmt.QuotedFormatter{ .text = scope.url.href }, bun.fmt.QuotedFormatter{ .text = name } },
                };

                if (warn_on_error)
                    this.package_manager.log.addWarningFmt(null, .{}, allocator, msg.fmt, msg.args) catch unreachable
                else
                    this.package_manager.log.addErrorFmt(null, .{}, allocator, msg.fmt, msg.args) catch unreachable;

                return error.InvalidURL;
            }
            // This actually duplicates the string! So we defer deref the WTF managed one above.
            break :blk try tmp.toOwnedSlice(allocator);
        };

        var last_modified: string = "";
        var etag: string = "";
        if (loaded_manifest) |manifest| {
            if (manifest.pkg.public_max_age > invalidate_manifest_cache_because_prerelease_segments_were_sorted_incorrectly_sometimes) {
                last_modified = manifest.pkg.last_modified.slice(manifest.string_buf);
                etag = manifest.pkg.etag.slice(manifest.string_buf);
            }
        }

        var header_builder = HeaderBuilder{};

        countAuth(&header_builder, scope);

        if (etag.len != 0) {
            header_builder.count("If-None-Match", etag);
        } else if (last_modified.len != 0) {
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
        this.http = AsyncHTTP.init(
            allocator,
            .GET,
            url,
            header_builder.entries,
            header_builder.content.ptr.?[0..header_builder.content.len],
            &this.response_buffer,
            "",
            0,
            this.getCompletionCallback(),
            this.package_manager.httpProxy(url),
            null,
            HTTP.FetchRedirect.follow,
            null,
        );
        this.http.client.reject_unauthorized = this.package_manager.tlsRejectUnauthorized();

        if (PackageManager.verbose_install) {
            this.http.client.verbose = true;
        }

        this.callback = .{
            .package_manifest = .{
                .name = try strings.StringOrTinyString.initAppendIfNeeded(name, *FileSystem.FilenameStore, &FileSystem.FilenameStore.instance),
                .loaded_manifest = loaded_manifest,
            },
        };

        if (PackageManager.verbose_install) {
            this.http.verbose = true;
            this.http.client.verbose = true;
        }

        // Incase the ETag causes invalidation, we fallback to the last modified date.
        if (last_modified.len != 0) {
            this.http.client.force_last_modified = true;
            this.http.client.if_modified_since = last_modified;
        }
    }

    pub fn getCompletionCallback(this: *NetworkTask) HTTP.HTTPClientResult.Callback {
        return HTTP.HTTPClientResult.Callback.New(*NetworkTask, notify).init(this);
    }

    pub fn schedule(this: *NetworkTask, batch: *ThreadPool.Batch) void {
        this.http.schedule(this.allocator, batch);
    }

    pub fn forTarball(
        this: *NetworkTask,
        allocator: std.mem.Allocator,
        tarball: ExtractTarball,
        scope: *const Npm.Registry.Scope,
    ) !void {
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

        this.response_buffer = try MutableString.init(allocator, 0);
        this.allocator = allocator;

        var header_builder = HeaderBuilder{};

        countAuth(&header_builder, scope);

        var header_buf: string = "";
        if (header_builder.header_count > 0) {
            try header_builder.allocate(allocator);

            appendAuth(&header_builder, scope);

            header_buf = header_builder.content.ptr.?[0..header_builder.content.len];
        }

        const url = URL.parse(this.url_buf);

        this.http = AsyncHTTP.init(
            allocator,
            .GET,
            url,
            header_builder.entries,
            header_buf,
            &this.response_buffer,
            "",
            0,
            this.getCompletionCallback(),
            this.package_manager.httpProxy(url),
            null,
            HTTP.FetchRedirect.follow,
            null,
        );
        this.http.client.reject_unauthorized = this.package_manager.tlsRejectUnauthorized();
        if (PackageManager.verbose_install) {
            this.http.client.verbose = true;
        }

        this.callback = .{ .extract = tarball };
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

pub const PreinstallState = enum(u2) {
    unknown = 0,
    done = 1,
    extract = 2,
    extracting = 3,
};

/// Schedule long-running callbacks for a task
/// Slow stuff is broken into tasks, each can run independently without locks
const Task = struct {
    tag: Tag,
    request: Request,
    data: Data,
    status: Status = Status.waiting,
    threadpool_task: ThreadPool.Task = ThreadPool.Task{ .callback = &callback },
    log: logger.Log,
    id: u64,
    err: ?anyerror = null,
    package_manager: *PackageManager,

    /// An ID that lets us register a callback without keeping the same pointer around
    pub const Id = struct {
        pub fn forNPMPackage(package_name: string, package_version: Semver.Version) u64 {
            var hasher = bun.Wyhash.init(0);
            hasher.update(package_name);
            hasher.update("@");
            hasher.update(std.mem.asBytes(&package_version));
            return @as(u64, 0 << 61) | @as(u64, @as(u61, @truncate(hasher.final())));
        }

        pub fn forBinLink(package_id: PackageID) u64 {
            const hash = bun.Wyhash.hash(0, std.mem.asBytes(&package_id));
            return @as(u64, 1 << 61) | @as(u64, @as(u61, @truncate(hash)));
        }

        pub fn forManifest(name: string) u64 {
            return @as(u64, 2 << 61) | @as(u64, @as(u61, @truncate(bun.Wyhash.hash(0, name))));
        }

        pub fn forTarball(url: string) u64 {
            var hasher = bun.Wyhash.init(0);
            hasher.update(url);
            return @as(u64, 3 << 61) | @as(u64, @as(u61, @truncate(hasher.final())));
        }

        pub fn forGitClone(url: string) u64 {
            var hasher = bun.Wyhash.init(0);
            hasher.update(url);
            return @as(u64, 4 << 61) | @as(u64, @as(u61, @truncate(hasher.final())));
        }

        pub fn forGitCheckout(url: string, resolved: string) u64 {
            var hasher = bun.Wyhash.init(0);
            hasher.update(url);
            hasher.update("@");
            hasher.update(resolved);
            return @as(u64, 5 << 61) | @as(u64, @as(u61, @truncate(hasher.final())));
        }
    };

    pub fn callback(task: *ThreadPool.Task) void {
        Output.Source.configureThread();
        defer Output.flush();

        var this = @fieldParentPtr(Task, "threadpool_task", task);

        defer this.package_manager.wake();

        switch (this.tag) {
            .package_manifest => {
                const allocator = bun.default_allocator;
                const body = this.request.package_manifest.network.response_buffer.move();

                defer {
                    this.package_manager.resolve_tasks.writeItem(this.*) catch unreachable;
                    bun.default_allocator.free(body);
                }
                const package_manifest = Npm.Registry.getPackageMetadata(
                    allocator,
                    this.request.package_manifest.network.http.response.?,
                    body,
                    &this.log,
                    this.request.package_manifest.name.slice(),
                    this.request.package_manifest.network.callback.package_manifest.loaded_manifest,
                    this.package_manager,
                ) catch |err| {
                    if (comptime Environment.isDebug) {
                        if (@errorReturnTrace()) |trace| {
                            std.debug.dumpStackTrace(trace.*);
                        }
                    }
                    this.err = err;
                    this.status = Status.fail;
                    this.data = .{ .package_manifest = .{} };
                    return;
                };

                switch (package_manifest) {
                    .cached => unreachable,
                    .fresh => |manifest| {
                        this.status = Status.success;
                        this.data = .{ .package_manifest = manifest };
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
                    this.package_manager.resolve_tasks.writeItem(this.*) catch unreachable;
                    bun.default_allocator.free(bytes);
                }

                const result = this.request.extract.tarball.run(
                    bytes,
                ) catch |err| {
                    if (comptime Environment.isDebug) {
                        if (@errorReturnTrace()) |trace| {
                            std.debug.dumpStackTrace(trace.*);
                        }
                    }

                    this.err = err;
                    this.status = Status.fail;
                    this.data = .{ .extract = .{} };
                    return;
                };

                this.data = .{ .extract = result };
                this.status = Status.success;
            },
            .git_clone => {
                const manager = this.package_manager;
                const name = this.request.git_clone.name.slice();
                const url = this.request.git_clone.url.slice();
                const dir = brk: {
                    if (Repository.tryHTTPS(url)) |https| break :brk Repository.download(
                        manager.allocator,
                        manager.env,
                        manager.log,
                        manager.getCacheDirectory(),
                        this.id,
                        name,
                        https,
                    ) catch null;
                    break :brk null;
                } orelse Repository.download(
                    manager.allocator,
                    manager.env,
                    manager.log,
                    manager.getCacheDirectory(),
                    this.id,
                    name,
                    url,
                ) catch |err| {
                    this.err = err;
                    this.status = Status.fail;
                    this.data = .{ .git_clone = bun.invalid_fd };
                    manager.resolve_tasks.writeItem(this.*) catch unreachable;
                    return;
                };

                manager.git_repositories.put(manager.allocator, this.id, bun.toFD(dir.fd)) catch unreachable;
                this.data = .{
                    .git_clone = bun.toFD(dir.fd),
                };
                this.status = Status.success;
                manager.resolve_tasks.writeItem(this.*) catch unreachable;
            },
            .git_checkout => {
                const manager = this.package_manager;
                const data = Repository.checkout(
                    manager.allocator,
                    manager.env,
                    manager.log,
                    manager.getCacheDirectory(),
                    this.request.git_checkout.repo_dir.asDir(),
                    this.request.git_checkout.name.slice(),
                    this.request.git_checkout.url.slice(),
                    this.request.git_checkout.resolved.slice(),
                ) catch |err| {
                    this.err = err;
                    this.status = Status.fail;
                    this.data = .{ .git_checkout = .{} };
                    manager.resolve_tasks.writeItem(this.*) catch unreachable;
                    return;
                };

                this.data = .{
                    .git_checkout = data,
                };
                this.status = Status.success;
                manager.resolve_tasks.writeItem(this.*) catch unreachable;
            },
            .local_tarball => {
                const result = readAndExtract(
                    this.package_manager.allocator,
                    this.request.local_tarball.tarball,
                ) catch |err| {
                    if (comptime Environment.isDebug) {
                        if (@errorReturnTrace()) |trace| {
                            std.debug.dumpStackTrace(trace.*);
                        }
                    }

                    this.err = err;
                    this.status = Status.fail;
                    this.data = .{ .extract = .{} };
                    this.package_manager.resolve_tasks.writeItem(this.*) catch unreachable;
                    return;
                };

                this.data = .{ .extract = result };
                this.status = Status.success;
                this.package_manager.resolve_tasks.writeItem(this.*) catch unreachable;
            },
        }
    }

    fn readAndExtract(allocator: std.mem.Allocator, tarball: ExtractTarball) !ExtractData {
        const file = try std.fs.cwd().openFile(tarball.url.slice(), .{ .mode = .read_only });
        defer file.close();
        const bytes = try file.readToEndAlloc(allocator, std.math.maxInt(usize));
        defer allocator.free(bytes);
        return tarball.run(bytes);
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
        },
        git_checkout: struct {
            repo_dir: bun.FileDescriptor,
            dependency_id: DependencyID,
            name: strings.StringOrTinyString,
            url: strings.StringOrTinyString,
            resolved: strings.StringOrTinyString,
            resolution: Resolution,
        },
        local_tarball: struct {
            tarball: ExtractTarball,
        },
    };
};

pub const ExtractData = struct {
    url: string = "",
    resolved: string = "",
    json_path: string = "",
    json_buf: []u8 = "",
    json_len: usize = 0,
};

pub const PackageInstall = struct {
    cache_dir: std.fs.Dir,
    destination_dir: std.fs.Dir,
    cache_dir_subpath: stringZ = "",
    destination_dir_subpath: stringZ = "",
    destination_dir_subpath_buf: []u8,

    allocator: std.mem.Allocator,

    progress: *Progress,

    package_name: string,
    package_version: string,
    file_count: u32 = 0,

    pub const Summary = struct {
        fail: u32 = 0,
        success: u32 = 0,
        skipped: u32 = 0,
        successfully_installed: ?Bitset = null,
    };

    pub const Method = enum {
        clonefile,

        /// Slower than clonefile
        clonefile_each_dir,

        /// On macOS, slow.
        /// On Linux, fast.
        hardlink,

        /// Slowest if single-threaded
        /// Note that copyfile does technically support recursion
        /// But I suspect it is slower in practice than manually doing it because:
        /// - it adds syscalls
        /// - it runs in userspace
        /// - it reads each dir twice incase the first pass modifies it
        copyfile,

        /// Used for file: when file: points to a parent directory
        /// example: "file:../"
        symlink,

        const BackendSupport = std.EnumArray(Method, bool);
        pub const map = std.ComptimeStringMap(Method, .{
            .{ "clonefile", Method.clonefile },
            .{ "clonefile_each_dir", Method.clonefile_each_dir },
            .{ "hardlink", Method.hardlink },
            .{ "copyfile", Method.copyfile },
            .{ "symlink", Method.symlink },
        });

        pub const macOS = BackendSupport.initDefault(false, .{
            .clonefile = true,
            .clonefile_each_dir = true,
            .hardlink = true,
            .copyfile = true,
            .symlink = true,
        });

        pub const linux = BackendSupport.initDefault(false, .{
            .hardlink = true,
            .copyfile = true,
            .symlink = true,
        });

        pub const windows = BackendSupport.initDefault(false, .{
            .hardlink = true,
            .copyfile = true,
        });

        pub inline fn isSupported(this: Method) bool {
            if (comptime Environment.isMac) return macOS.get(this);
            if (comptime Environment.isLinux) return linux.get(this);
            if (comptime Environment.isWindows) return windows.get(this);

            return false;
        }
    };

    // 1. verify that .bun-tag exists (was it installed from bun?)
    // 2. check .bun-tag against the resolved version
    fn verifyGitResolution(this: *PackageInstall, repo: *const Repository, buf: []const u8) bool {
        const allocator = this.allocator;

        var total: usize = 0;
        var read: usize = 0;

        bun.copy(u8, this.destination_dir_subpath_buf[this.destination_dir_subpath.len..], std.fs.path.sep_str ++ ".bun-tag");
        this.destination_dir_subpath_buf[this.destination_dir_subpath.len + std.fs.path.sep_str.len + ".bun-tag".len] = 0;
        const bun_tag_path: [:0]u8 = this.destination_dir_subpath_buf[0 .. this.destination_dir_subpath.len + std.fs.path.sep_str.len + ".bun-tag".len :0];
        defer this.destination_dir_subpath_buf[this.destination_dir_subpath.len] = 0;
        const bun_tag_file = this.destination_dir.openFileZ(bun_tag_path, .{ .mode = .read_only }) catch return false;
        defer bun_tag_file.close();

        var body_pool = Npm.Registry.BodyPool.get(allocator);
        var mutable: MutableString = body_pool.data;
        defer {
            body_pool.data = mutable;
            Npm.Registry.BodyPool.release(body_pool);
        }

        mutable.reset();

        mutable.list.expandToCapacity();

        // this file is pretty small
        read = bun_tag_file.read(mutable.list.items[total..]) catch return false;
        var remain = mutable.list.items[@min(total, read)..];
        if (read > 0 and remain.len < 1024) {
            mutable.growBy(4096) catch return false;
            mutable.list.expandToCapacity();
        }

        // never read more than 2048 bytes. it should never be 2048 bytes.
        while (read > 0 and total < 2048) : (read = bun_tag_file.read(remain) catch return false) {
            total += read;

            mutable.list.expandToCapacity();
            remain = mutable.list.items[total..];

            if (remain.len < 1024) {
                mutable.growBy(4096) catch return false;
            }
            mutable.list.expandToCapacity();
            remain = mutable.list.items[total..];
        }

        mutable.list.expandToCapacity();

        return strings.eqlLong(repo.resolved.slice(buf), mutable.list.items[0..total], true);
    }

    pub fn verify(
        this: *PackageInstall,
        resolution: *const Resolution,
        buf: []const u8,
    ) bool {
        return switch (resolution.tag) {
            .git => this.verifyGitResolution(&resolution.value.git, buf),
            .github => this.verifyGitResolution(&resolution.value.github, buf),
            else => this.verifyPackageJSONNameAndVersion(),
        };
    }

    fn verifyPackageJSONNameAndVersion(this: *PackageInstall) bool {
        const allocator = this.allocator;
        var total: usize = 0;
        var read: usize = 0;

        bun.copy(u8, this.destination_dir_subpath_buf[this.destination_dir_subpath.len..], std.fs.path.sep_str ++ "package.json");
        this.destination_dir_subpath_buf[this.destination_dir_subpath.len + std.fs.path.sep_str.len + "package.json".len] = 0;
        const package_json_path: [:0]u8 = this.destination_dir_subpath_buf[0 .. this.destination_dir_subpath.len + std.fs.path.sep_str.len + "package.json".len :0];
        defer this.destination_dir_subpath_buf[this.destination_dir_subpath.len] = 0;

        var package_json_file = this.destination_dir.openFileZ(package_json_path, .{ .mode = .read_only }) catch return false;
        defer package_json_file.close();

        var body_pool = Npm.Registry.BodyPool.get(allocator);
        var mutable: MutableString = body_pool.data;
        defer {
            body_pool.data = mutable;
            Npm.Registry.BodyPool.release(body_pool);
        }

        mutable.reset();
        mutable.list.expandToCapacity();

        // Heuristic: most package.jsons will be less than 2048 bytes.
        read = package_json_file.read(mutable.list.items[total..]) catch return false;
        var remain = mutable.list.items[@min(total, read)..];
        if (read > 0 and remain.len < 1024) {
            mutable.growBy(4096) catch return false;
            mutable.list.expandToCapacity();
        }

        while (read > 0) : (read = package_json_file.read(remain) catch return false) {
            total += read;

            mutable.list.expandToCapacity();
            remain = mutable.list.items[total..];

            if (remain.len < 1024) {
                mutable.growBy(4096) catch return false;
            }
            mutable.list.expandToCapacity();
            remain = mutable.list.items[total..];
        }

        // If it's not long enough to have {"name": "foo", "version": "1.2.0"}, there's no way it's valid
        if (total < "{\"name\":\"\",\"version\":\"\"}".len + this.package_name.len + this.package_version.len) return false;

        const source = logger.Source.initPathString(bun.span(package_json_path), mutable.list.items[0..total]);
        var log = logger.Log.init(allocator);
        defer log.deinit();

        initializeStore();

        var package_json_checker = json_parser.PackageJSONVersionChecker.init(allocator, &source, &log) catch return false;
        _ = package_json_checker.parseExpr() catch return false;
        if (!package_json_checker.has_found_name or !package_json_checker.has_found_version or log.errors > 0) return false;

        // Version is more likely to not match than name, so we check it first.
        return strings.eql(package_json_checker.found_version, this.package_version) and
            strings.eql(package_json_checker.found_name, this.package_name);
    }

    pub const Result = union(Tag) {
        success: void,
        fail: struct {
            err: anyerror,
            step: Step,

            pub inline fn isPackageMissingFromCache(this: @This()) bool {
                return (this.err == error.FileNotFound or this.err == error.ENOENT) and this.step == .opening_cache_dir;
            }
        },
        pending: void,
        skip: void,

        pub const Tag = enum {
            success,
            fail,
            pending,
            skip,
        };
    };

    pub const Step = enum {
        copyfile,
        opening_cache_dir,
        copying_files,
        linking,
    };

    var supported_method: Method = if (Environment.isMac)
        Method.clonefile
    else
        Method.hardlink;

    fn installWithClonefileEachDir(this: *PackageInstall) !Result {
        const Walker = @import("../walker_skippable.zig");

        var cached_package_dir = bun.openDir(this.cache_dir, this.cache_dir_subpath) catch |err| return Result{
            .fail = .{ .err = err, .step = .opening_cache_dir },
        };
        defer cached_package_dir.close();
        var walker_ = Walker.walk(
            cached_package_dir,
            this.allocator,
            &[_]bun.OSPathSlice{},
            &[_]bun.OSPathSlice{},
        ) catch |err| return Result{
            .fail = .{ .err = err, .step = .opening_cache_dir },
        };
        defer walker_.deinit();

        const FileCopier = struct {
            pub fn copy(
                destination_dir_: std.fs.Dir,
                walker: *Walker,
            ) !u32 {
                var real_file_count: u32 = 0;
                var stackpath: [bun.MAX_PATH_BYTES]u8 = undefined;
                while (try walker.next()) |entry| {
                    switch (entry.kind) {
                        .directory => {
                            std.os.mkdirat(destination_dir_.fd, entry.path, 0o755) catch {};
                        },
                        .file => {
                            bun.copy(u8, &stackpath, entry.path);
                            stackpath[entry.path.len] = 0;
                            const path: [:0]u8 = stackpath[0..entry.path.len :0];
                            const basename: [:0]u8 = stackpath[entry.path.len - entry.basename.len .. entry.path.len :0];
                            switch (C.clonefileat(
                                entry.dir.fd,
                                basename,
                                destination_dir_.fd,
                                path,
                                0,
                            )) {
                                0 => {},
                                else => |errno| switch (std.os.errno(errno)) {
                                    .XDEV => return error.NotSupported, // not same file system
                                    .OPNOTSUPP => return error.NotSupported,
                                    .NOENT => return error.FileNotFound,
                                    // sometimes the downlowded npm package has already node_modules with it, so just ignore exist error here
                                    .EXIST => {},
                                    .ACCES => return error.AccessDenied,
                                    else => return error.Unexpected,
                                },
                            }

                            real_file_count += 1;
                        },
                        else => {},
                    }
                }

                return real_file_count;
            }
        };

        var subdir = this.destination_dir.makeOpenPath(bun.span(this.destination_dir_subpath), .{}) catch |err| return Result{
            .fail = .{ .err = err, .step = .opening_cache_dir },
        };

        defer subdir.close();

        this.file_count = FileCopier.copy(
            subdir,
            &walker_,
        ) catch |err| return Result{
            .fail = .{ .err = err, .step = .copying_files },
        };

        return Result{
            .success = {},
        };
    }

    // https://www.unix.com/man-page/mojave/2/fclonefileat/
    fn installWithClonefile(this: *PackageInstall) !Result {
        if (comptime !Environment.isMac) @compileError("clonefileat() is macOS only.");

        if (this.destination_dir_subpath[0] == '@') {
            if (strings.indexOfCharZ(this.destination_dir_subpath, std.fs.path.sep)) |slash| {
                this.destination_dir_subpath_buf[slash] = 0;
                const subdir = this.destination_dir_subpath_buf[0..slash :0];
                this.destination_dir.makeDirZ(subdir) catch {};
                this.destination_dir_subpath_buf[slash] = std.fs.path.sep;
            }
        }

        return switch (C.clonefileat(
            this.cache_dir.fd,
            this.cache_dir_subpath,
            this.destination_dir.fd,
            this.destination_dir_subpath,
            0,
        )) {
            0 => .{ .success = {} },
            else => |errno| switch (std.os.errno(errno)) {
                .XDEV => error.NotSupported, // not same file system
                .OPNOTSUPP => error.NotSupported,
                .NOENT => error.FileNotFound,
                // We first try to delete the directory
                // But, this can happen if this package contains a node_modules folder
                // We want to continue installing as many packages as we can, so we shouldn't block while downloading
                // We use the slow path in this case
                .EXIST => try this.installWithClonefileEachDir(),
                .ACCES => return error.AccessDenied,
                else => error.Unexpected,
            },
        };
    }
    fn installWithCopyfile(this: *PackageInstall) Result {
        const Walker = @import("../walker_skippable.zig");

        var cached_package_dir = bun.openDir(this.cache_dir, this.cache_dir_subpath) catch |err| return Result{
            .fail = .{ .err = err, .step = .opening_cache_dir },
        };
        defer cached_package_dir.close();
        var walker_ = Walker.walk(
            cached_package_dir,
            this.allocator,
            &[_]bun.OSPathSlice{},
            &[_]bun.OSPathSlice{},
        ) catch |err| return Result{
            .fail = .{ .err = err, .step = .opening_cache_dir },
        };
        defer walker_.deinit();

        const FileCopier = struct {
            pub fn copy(
                destination_dir_: std.fs.Dir,
                walker: *Walker,
                progress_: *Progress,
            ) !u32 {
                var real_file_count: u32 = 0;

                var in_buf: if (Environment.isWindows) bun.OSPathBuffer else void = undefined;
                var out_buf: if (Environment.isWindows) bun.OSPathBuffer else void = undefined;

                while (try walker.next()) |entry| {
                    if (entry.kind != .file) continue;
                    real_file_count += 1;

                    const createFile = if (comptime Environment.isWindows) std.fs.Dir.createFileW else std.fs.Dir.createFile;

                    var outfile = createFile(destination_dir_, entry.path, .{}) catch brk: {
                        if (bun.Dirname.dirname(bun.OSPathChar, entry.path)) |entry_dirname| {
                            bun.MakePath.makePath(bun.OSPathChar, destination_dir_, entry_dirname) catch {};
                        }
                        break :brk createFile(destination_dir_, entry.path, .{}) catch |err| {
                            progress_.root.end();

                            progress_.refresh();

                            Output.prettyErrorln("<r><red>{s}<r>: copying file {}", .{ @errorName(err), bun.fmt.fmtOSPath(entry.path) });
                            Global.crash();
                        };
                    };
                    defer outfile.close();

                    const openFile = if (comptime Environment.isWindows) std.fs.Dir.openFileW else std.fs.Dir.openFile;

                    var in_file = try openFile(entry.dir, entry.basename, .{ .mode = .read_only });
                    defer in_file.close();

                    if (comptime Environment.isWindows) {
                        const in_path = bun.getFdPathW(in_file.handle, &in_buf) catch @panic("Failed to copyfile");
                        in_buf[in_path.len] = 0;
                        const in = in_buf[0..in_path.len :0];

                        const out_path = bun.getFdPathW(outfile.handle, &out_buf) catch @panic("Failed to copyfile");
                        out_buf[out_path.len] = 0;
                        const out = out_buf[0..out_path.len :0];

                        bun.copyFile(in, out) catch |err| {
                            progress_.root.end();

                            progress_.refresh();

                            Output.prettyError("<r><red>{s}<r>: copying file {}", .{ @errorName(err), bun.fmt.fmtOSPath(entry.path) });
                            Global.crash();
                        };
                    } else {
                        if (comptime Environment.isPosix) {
                            const stat = in_file.stat() catch continue;
                            _ = C.fchmod(outfile.handle, @intCast(stat.mode));
                        }

                        bun.copyFile(in_file.handle, outfile.handle) catch |err| {
                            progress_.root.end();

                            progress_.refresh();

                            Output.prettyError("<r><red>{s}<r>: copying file {}", .{ @errorName(err), bun.fmt.fmtOSPath(entry.path) });
                            Global.crash();
                        };
                    }
                }

                return real_file_count;
            }
        };

        var subdir = this.destination_dir.makeOpenPath(bun.span(this.destination_dir_subpath), .{}) catch |err| return Result{
            .fail = .{ .err = err, .step = .opening_cache_dir },
        };

        defer subdir.close();

        this.file_count = FileCopier.copy(subdir, &walker_, this.progress) catch |err| return Result{
            .fail = .{ .err = err, .step = .copying_files },
        };

        return Result{
            .success = {},
        };
    }

    fn installWithHardlink(this: *PackageInstall) !Result {
        const Walker = @import("../walker_skippable.zig");

        var cached_package_dir = bun.openDir(this.cache_dir, this.cache_dir_subpath) catch |err| return Result{
            .fail = .{ .err = err, .step = .opening_cache_dir },
        };
        defer cached_package_dir.close();
        var walker_ = Walker.walk(
            cached_package_dir,
            this.allocator,
            &[_]bun.OSPathSlice{},
            &[_]bun.OSPathSlice{bun.OSPathLiteral("node_modules")},
        ) catch |err| return Result{
            .fail = .{ .err = err, .step = .opening_cache_dir },
        };
        defer walker_.deinit();

        var subdir = this.destination_dir.makeOpenPath(bun.span(this.destination_dir_subpath), .{}) catch |err| return Result{
            .fail = .{ .err = err, .step = .opening_cache_dir },
        };

        defer subdir.close();

        var buf: if (Environment.isWindows) bun.WPathBuffer else [0]u16 = undefined;
        var buf2: if (Environment.isWindows) bun.WPathBuffer else [0]u16 = undefined;
        var to_copy_buf: []u16 = undefined;
        var to_copy_buf2: []u16 = undefined;
        if (comptime Environment.isWindows) {
            var fd_path_buf: bun.PathBuffer = undefined;

            // buf[0] = '\\';
            // buf[1] = '\\';
            // buf[2] = '?';
            // buf[3] = '\\';
            // const dest_path = try bun.getFdPath(subdir.fd, &fd_path_buf);
            // strings.copyU8IntoU16(buf[4..], dest_path);
            // buf[dest_path.len + 4] = '\\';
            // to_copy_buf = buf[dest_path.len + 5 ..];

            // buf2[0] = '\\';
            // buf2[1] = '\\';
            // buf2[2] = '?';
            // buf2[3] = '\\';
            // const cache_path = try bun.getFdPath(cached_package_dir.fd, &fd_path_buf);
            // strings.copyU8IntoU16(buf2[4..], cache_path);
            // buf2[cache_path.len + 4] = '\\';
            // to_copy_buf2 = buf2[cache_path.len + 5 ..];

            // TODO(dylan-conway): find out why //?/ isn't working
            const dest_path = try bun.getFdPath(subdir.fd, &fd_path_buf);
            strings.copyU8IntoU16(&buf, dest_path);
            buf[dest_path.len] = '\\';
            to_copy_buf = buf[dest_path.len + 1 ..];

            const cache_path = try bun.getFdPath(cached_package_dir.fd, &fd_path_buf);
            strings.copyU8IntoU16(&buf2, cache_path);
            buf2[cache_path.len] = '\\';
            to_copy_buf2 = buf2[cache_path.len + 1 ..];
        }

        const FileCopier = struct {
            pub fn copy(
                destination_dir: std.fs.Dir,
                walker: *Walker,
                to_copy_into1: if (Environment.isWindows) []u16 else void,
                head1: if (Environment.isWindows) []u16 else void,
                to_copy_into2: if (Environment.isWindows) []u16 else void,
                head2: if (Environment.isWindows) []u16 else void,
            ) !u32 {
                var real_file_count: u32 = 0;
                while (try walker.next()) |entry| {
                    switch (entry.kind) {
                        .directory => {
                            const mkdirat = if (comptime Environment.isWindows) std.os.mkdiratW else std.os.mkdirat;
                            mkdirat(destination_dir.fd, entry.path, 0o755) catch {};
                        },
                        .file => {
                            if (comptime Environment.isWindows) {
                                if (entry.path.len > to_copy_into1.len or entry.path.len > to_copy_into2.len) {
                                    return error.NameTooLong;
                                }

                                @memcpy(to_copy_into1[0..entry.path.len], entry.path);
                                head1[entry.path.len + (head1.len - to_copy_into1.len)] = 0;
                                const dest: [:0]u16 = head1[0 .. entry.path.len + head1.len - to_copy_into1.len :0];

                                @memcpy(to_copy_into2[0..entry.path.len], entry.path);
                                head2[entry.path.len + (head1.len - to_copy_into2.len)] = 0;
                                const src: [:0]u16 = head2[0 .. entry.path.len + head2.len - to_copy_into2.len :0];

                                // Windows limits hardlinks to 1023 per file
                                if (bun.windows.CreateHardLinkW(dest, src, null) == 0) {
                                    if (bun.windows.CopyFileW(src, dest, 0) == 0) {
                                        if (bun.windows.Win32Error.get().toSystemErrno()) |_| {
                                            // TODO: make this better
                                            return error.FailedToCopyFile;
                                        }

                                        return error.FailedToCopyFile;
                                    }
                                }
                            } else {
                                std.os.linkat(entry.dir.fd, entry.basename, destination_dir.fd, entry.path, 0) catch |err| {
                                    if (err != error.PathAlreadyExists) {
                                        return err;
                                    }

                                    std.os.unlinkat(destination_dir.fd, entry.path, 0) catch {};
                                    try std.os.linkat(entry.dir.fd, entry.basename, destination_dir.fd, entry.path, 0);
                                };
                            }

                            real_file_count += 1;
                        },
                        else => {},
                    }
                }

                return real_file_count;
            }
        };

        this.file_count = FileCopier.copy(
            subdir,
            &walker_,
            if (Environment.isWindows) to_copy_buf else void{},
            if (Environment.isWindows) &buf else void{},
            if (Environment.isWindows) to_copy_buf2 else void{},
            if (Environment.isWindows) &buf2 else void{},
        ) catch |err| {
            if (comptime Environment.isWindows) {
                if (err == error.FailedToCopyFile) {
                    return Result{
                        .fail = .{ .err = err, .step = .copying_files },
                    };
                }
            } else if (err == error.NotSameFileSystem or err == error.ENXIO) {
                return err;
            }

            return Result{
                .fail = .{ .err = err, .step = .copying_files },
            };
        };

        return Result{
            .success = {},
        };
    }

    fn installWithSymlink(this: *PackageInstall) !Result {
        const Walker = @import("../walker_skippable.zig");

        var cached_package_dir = bun.openDir(this.cache_dir, this.cache_dir_subpath) catch |err| return Result{
            .fail = .{ .err = err, .step = .opening_cache_dir },
        };
        defer cached_package_dir.close();
        var walker_ = Walker.walk(
            cached_package_dir,
            this.allocator,
            &[_]bun.OSPathSlice{},
            &[_]bun.OSPathSlice{
                bun.OSPathLiteral("node_modules"),
                bun.OSPathLiteral(".git"),
            },
        ) catch |err| return Result{
            .fail = .{ .err = err, .step = .opening_cache_dir },
        };
        defer walker_.deinit();

        const FileCopier = struct {
            pub fn copy(
                dest_dir_fd: bun.FileDescriptor,
                cache_dir_fd: bun.FileDescriptor,
                walker: *Walker,
            ) !u32 {
                var real_file_count: u32 = 0;
                var buf: [bun.MAX_PATH_BYTES]u8 = undefined;
                const cache_dir_path = try bun.getFdPath(cache_dir_fd, &buf);

                var remain = buf[cache_dir_path.len..];
                var cache_dir_offset = cache_dir_path.len;
                if (cache_dir_path.len > 0 and cache_dir_path[cache_dir_path.len - 1] != std.fs.path.sep) {
                    remain[0] = std.fs.path.sep;
                    cache_dir_offset += 1;
                    remain = remain[1..];
                }
                var dest_buf: [bun.MAX_PATH_BYTES]u8 = undefined;
                const dest_base = try bun.getFdPath(dest_dir_fd, &dest_buf);
                var dest_remaining = dest_buf[dest_base.len..];
                var dest_dir_offset = dest_base.len;
                if (dest_base.len > 0 and dest_buf[dest_base.len - 1] != std.fs.path.sep) {
                    dest_remaining[0] = std.fs.path.sep;
                    dest_remaining = dest_remaining[1..];
                    dest_dir_offset += 1;
                }

                while (try walker.next()) |entry| {
                    switch (entry.kind) {
                        // directories are created
                        .directory => {
                            std.os.mkdirat(dest_dir_fd.cast(), entry.path, 0o755) catch {};
                        },
                        // but each file in the directory is a symlink
                        .file => {
                            @memcpy(remain[0..entry.path.len], entry.path);
                            remain[entry.path.len] = 0;
                            const from_path = buf[0 .. cache_dir_offset + entry.path.len :0];

                            @memcpy(dest_remaining[0..entry.path.len], entry.path);
                            dest_remaining[entry.path.len] = 0;
                            const to_path = dest_buf[0 .. dest_dir_offset + entry.path.len :0];

                            try std.os.symlinkZ(from_path, to_path);

                            real_file_count += 1;
                        },
                        else => {},
                    }
                }

                return real_file_count;
            }
        };

        var subdir = this.destination_dir.makeOpenPath(bun.span(this.destination_dir_subpath), .{}) catch |err| return Result{
            .fail = .{ .err = err, .step = .opening_cache_dir },
        };

        defer subdir.close();

        this.file_count = FileCopier.copy(
            bun.toFD(subdir.fd),
            bun.toFD(cached_package_dir.fd),
            &walker_,
        ) catch |err|
            return Result{
            .fail = .{
                .err = err,
                .step = .copying_files,
            },
        };

        return Result{
            .success = {},
        };
    }

    pub fn uninstall(this: *PackageInstall) void {
        this.destination_dir.deleteTree(bun.span(this.destination_dir_subpath)) catch {};
    }

    pub fn uninstallBeforeInstall(this: *PackageInstall) void {
        // TODO(dylan-conway): depth first package installation to allow lifecycle scripts to start earlier
        //
        // if (this.install_order == .depth_first) {
        //     var subpath_dir = this.destination_dir.open(this.destination_dir_subpath, .{}) catch return;
        //     defer subpath_dir.close();
        //     var iter = subpath_dir.iterateAssumeFirstIteration();
        //     while (iter.next() catch null) |entry| {
        //         // skip node_modules because installation is depth first
        //         if (entry.kind != .directory or !strings.eqlComptime(entry.name, "node_modules")) {
        //             this.destination_dir.deleteTree(entry.name) catch {};
        //         }
        //     }
        // } else {
        //     this.destination_dir.deleteTree(bun.span(this.destination_dir_subpath)) catch {};
        // }

        this.destination_dir.deleteTree(bun.span(this.destination_dir_subpath)) catch {};
    }

    pub fn isDanglingSymlink(path: [:0]const u8) bool {
        if (comptime Environment.isLinux) {
            const rc = Syscall.system.open(path, @as(u32, std.os.O.PATH | 0), @as(u32, 0));
            switch (Syscall.getErrno(rc)) {
                .SUCCESS => {
                    _ = Syscall.system.close(@intCast(rc));
                    return false;
                },
                else => return true,
            }
        } else if (comptime Environment.isWindows) {
            switch (bun.sys.sys_uv.open(path, 0, 0)) {
                .err => {
                    return true;
                },
                .result => |fd| {
                    _ = bun.sys.close(fd);
                    return false;
                },
            }
        } else {
            const rc = Syscall.system.open(path, @as(u32, 0), @as(u32, 0));
            switch (Syscall.getErrno(rc)) {
                .SUCCESS => {
                    _ = Syscall.system.close(rc);
                    return false;
                },
                else => return true,
            }
        }
    }

    pub fn isDanglingWindowsBinLink(node_mod_fd: bun.FileDescriptor, path: []const u16, temp_buffer: []u8) bool {
        const WinBinLinkingShim = @import("./windows-shim/BinLinkingShim.zig");
        const bin_path = bin_path: {
            const fd = bun.sys.openatWindows(node_mod_fd, path, std.os.O.RDONLY).unwrap() catch return true;
            defer _ = bun.sys.close(fd);
            const size = fd.asFile().readAll(temp_buffer) catch return true;
            const decoded = WinBinLinkingShim.looseDecode(temp_buffer[0..size]) orelse return true;
            std.debug.assert(decoded.flags.isValid()); // looseDecode ensures valid flags
            break :bin_path decoded.bin_path;
        };

        {
            const fd = bun.sys.openatWindows(node_mod_fd, bin_path, std.os.O.RDONLY).unwrap() catch return true;
            _ = bun.sys.close(fd);
        }

        return false;
    }

    pub fn installFromLink(this: *PackageInstall, skip_delete: bool) Result {
        const dest_path = this.destination_dir_subpath;
        // If this fails, we don't care.
        // we'll catch it the next error
        if (!skip_delete and !strings.eqlComptime(dest_path, ".")) this.uninstallBeforeInstall();

        const subdir = std.fs.path.dirname(dest_path);
        var dest_dir = if (subdir) |dir| brk: {
            break :brk this.destination_dir.makeOpenPath(dir, .{}) catch |err| return Result{
                .fail = .{
                    .err = err,
                    .step = .linking,
                },
            };
        } else this.destination_dir;
        defer {
            if (subdir != null) dest_dir.close();
        }

        var dest_buf: [bun.MAX_PATH_BYTES]u8 = undefined;
        const dest_dir_path = dest_dir.realpath(".", &dest_buf) catch |err| return Result{
            .fail = .{
                .err = err,
                .step = .linking,
            },
        };
        // cache_dir_subpath in here is actually the full path to the symlink pointing to the linked package
        const symlinked_path = this.cache_dir_subpath;
        var to_buf: [bun.MAX_PATH_BYTES]u8 = undefined;
        const to_path = this.cache_dir.realpath(symlinked_path, &to_buf) catch |err| return Result{
            .fail = .{
                .err = err,
                .step = .linking,
            },
        };

        const dest = std.fs.path.basename(dest_path);
        if (comptime Environment.isWindows) {
            var dest_buf2: bun.PathBuffer = undefined;
            const dest_z = bun.path.joinAbsStringBufZ(
                dest_dir_path,
                &dest_buf2,
                &.{
                    dest,
                },
                .windows,
            );

            to_buf[to_path.len] = 0;
            const to_path_z = to_buf[0..to_path.len :0];

            // https://github.com/npm/cli/blob/162c82e845d410ede643466f9f8af78a312296cc/workspaces/arborist/lib/arborist/reify.js#L738
            // https://github.com/npm/cli/commit/0e58e6f6b8f0cd62294642a502c17561aaf46553
            switch (bun.sys.sys_uv.symlinkUV(to_path_z, dest_z, bun.windows.libuv.UV_FS_SYMLINK_JUNCTION)) {
                .err => |err| {
                    return Result{
                        .fail = .{
                            .err = bun.errnoToZigErr(err.errno),
                            .step = .linking,
                        },
                    };
                },
                .result => {},
            }
        } else {
            const target = Path.relative(dest_dir_path, to_path);
            std.os.symlinkat(target, dest_dir.fd, dest) catch |err| return Result{
                .fail = .{
                    .err = err,
                    .step = .linking,
                },
            };
        }

        if (isDanglingSymlink(symlinked_path)) return Result{
            .fail = .{
                .err = error.DanglingSymlink,
                .step = .linking,
            },
        };

        return Result{
            .success = {},
        };
    }

    pub fn install(this: *PackageInstall, skip_delete: bool) Result {

        // If this fails, we don't care.
        // we'll catch it the next error
        if (!skip_delete and !strings.eqlComptime(this.destination_dir_subpath, ".")) this.uninstallBeforeInstall();

        var supported_method_to_use = if (strings.eqlComptime(this.cache_dir_subpath, ".") or strings.hasPrefixComptime(this.cache_dir_subpath, ".."))
            Method.symlink
        else
            supported_method;

        switch (supported_method_to_use) {
            .clonefile => {
                if (comptime Environment.isMac) {

                    // First, attempt to use clonefile
                    // if that fails due to ENOTSUP, mark it as unsupported and then fall back to copyfile
                    if (this.installWithClonefile()) |result| {
                        return result;
                    } else |err| {
                        switch (err) {
                            error.NotSupported => {
                                supported_method = .copyfile;
                                supported_method_to_use = .copyfile;
                            },
                            error.FileNotFound => return Result{
                                .fail = .{ .err = error.FileNotFound, .step = .opening_cache_dir },
                            },
                            else => return Result{
                                .fail = .{ .err = err, .step = .copying_files },
                            },
                        }
                    }
                }
            },
            .clonefile_each_dir => {
                if (comptime Environment.isMac) {
                    if (this.installWithClonefileEachDir()) |result| {
                        return result;
                    } else |err| {
                        switch (err) {
                            error.NotSupported => {
                                supported_method = .copyfile;
                                supported_method_to_use = .copyfile;
                            },
                            error.FileNotFound => return Result{
                                .fail = .{ .err = error.FileNotFound, .step = .opening_cache_dir },
                            },
                            else => return Result{
                                .fail = .{ .err = err, .step = .copying_files },
                            },
                        }
                    }
                }
            },
            .hardlink => {
                if (this.installWithHardlink()) |result| {
                    return result;
                } else |err| outer: {
                    if (comptime !Environment.isWindows) {
                        if (err == error.NotSameFileSystem) {
                            supported_method = .copyfile;
                            supported_method_to_use = .copyfile;
                            break :outer;
                        }
                    }

                    switch (err) {
                        error.FileNotFound => return Result{
                            .fail = .{ .err = error.FileNotFound, .step = .opening_cache_dir },
                        },
                        else => return Result{
                            .fail = .{ .err = err, .step = .copying_files },
                        },
                    }
                }
            },
            .symlink => {
                if (comptime Environment.isWindows) {
                    supported_method_to_use = .copyfile;
                } else {
                    if (this.installWithSymlink()) |result| {
                        return result;
                    } else |err| {
                        switch (err) {
                            error.FileNotFound => return Result{
                                .fail = .{ .err = error.FileNotFound, .step = .opening_cache_dir },
                            },
                            else => return Result{
                                .fail = .{ .err = err, .step = .copying_files },
                            },
                        }
                    }
                }
            },
            else => {},
        }

        if (supported_method_to_use != .copyfile) return Result{
            .success = {},
        };

        // TODO: linux io_uring
        return this.installWithCopyfile();
    }
};

pub const Resolution = @import("./resolution.zig").Resolution;
const Progress = std.Progress;
const TaggedPointer = @import("../tagged_pointer.zig");
const TaskCallbackContext = union(Tag) {
    dependency: DependencyID,
    node_modules_folder: struct {
        fd: bun.FileDescriptor,
        tree_id: Lockfile.Tree.Id,
        node_modules_folder_path: std.ArrayList(u8),
    },
    root_dependency: DependencyID,
    root_request_id: PackageID,
    pub const Tag = enum {
        dependency,
        node_modules_folder,
        root_dependency,
        root_request_id,
    };
};

const TaskCallbackList = std.ArrayListUnmanaged(TaskCallbackContext);
const TaskDependencyQueue = std.HashMapUnmanaged(u64, TaskCallbackList, IdentityContext(u64), 80);

// Windows seems to stack overflow in debug builds due to the size of these allocations.
const TaskChannel = sync.Channel(Task, .{ .Static = 4096 / (if (Environment.isWindows) 16 else 1) });
const NetworkChannel = sync.Channel(*NetworkTask, .{ .Static = 8192 / (if (Environment.isWindows) 16 else 1) });

const ThreadPool = bun.ThreadPool;
const PackageManifestMap = std.HashMapUnmanaged(PackageNameHash, Npm.PackageManifest, IdentityContext(PackageNameHash), 80);
const RepositoryMap = std.HashMapUnmanaged(u64, bun.FileDescriptor, IdentityContext(u64), 80);
const NpmAliasMap = std.HashMapUnmanaged(PackageNameHash, Dependency.Version, IdentityContext(u64), 80);

pub const CacheLevel = struct {
    use_cache_control_headers: bool,
    use_etag: bool,
    use_last_modified: bool,
};
const Waker = if (Environment.isPosix) bun.Async.Waker else *bun.uws.UVLoop;

const Waiter = struct {
    onWait: *const fn (this: *anyopaque) anyerror!usize,
    onWake: *const fn (this: *anyopaque) void,
    ctx: *anyopaque,

    pub fn init(
        ctx: anytype,
        comptime onWait: *const fn (this: @TypeOf(ctx)) anyerror!usize,
        comptime onWake: *const fn (this: @TypeOf(ctx)) void,
    ) Waiter {
        return Waiter{
            .ctx = @ptrCast(ctx),
            .onWait = @alignCast(@ptrCast(@as(*const anyopaque, @ptrCast(onWait)))),
            .onWake = @alignCast(@ptrCast(@as(*const anyopaque, @ptrCast(onWake)))),
        };
    }

    pub fn wait(this: *Waiter) !usize {
        return this.onWait(this.ctx);
    }

    pub fn wake(this: *Waiter) void {
        this.onWake(this.ctx);
    }

    pub fn fromUWSLoop(loop: *uws.Loop) Waiter {
        const Handlers = struct {
            fn onWait(uws_loop: *uws.Loop) !usize {
                uws_loop.run();
                return 0;
            }

            fn onWake(uws_loop: *uws.Loop) void {
                uws_loop.wakeup();
            }
        };

        return Waiter.init(
            loop,
            Handlers.onWait,
            Handlers.onWake,
        );
    }
};

// We can't know all the packages we need until we've downloaded all the packages
// The easy way would be:
// 1. Download all packages, parsing their dependencies and enqueuing all dependencies for resolution
// 2.
pub const PackageManager = struct {
    cache_directory_: ?std.fs.Dir = null,

    // TODO(dylan-conway): remove this field when we move away from `std.ChildProcess` in repository.zig
    cache_directory_path: string = "",
    temp_dir_: ?std.fs.Dir = null,
    temp_dir_name: string = "",
    root_dir: *Fs.FileSystem.DirEntry,
    allocator: std.mem.Allocator,
    log: *logger.Log,
    resolve_tasks: TaskChannel,
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
    package_json_updates: []UpdateRequest = &[_]UpdateRequest{},

    // used for looking up workspaces that aren't loaded into Lockfile.workspace_paths
    workspaces: std.StringArrayHashMap(Semver.Version),

    // progress bar stuff when not stack allocated
    root_progress_node: *std.Progress.Node = undefined,

    to_remove: []const UpdateRequest = &[_]UpdateRequest{},
    to_update: bool = false,

    root_package_json_file: std.fs.File,
    root_dependency_list: Lockfile.DependencySlice = .{},

    thread_pool: ThreadPool,
    task_batch: ThreadPool.Batch = .{},
    task_queue: TaskDependencyQueue = .{},

    manifests: PackageManifestMap = .{},
    folders: FolderResolution.Map = .{},
    git_repositories: RepositoryMap = .{},

    network_dedupe_map: NetworkTaskQueue = .{},
    network_channel: NetworkChannel = NetworkChannel.init(),
    network_tarball_batch: ThreadPool.Batch = .{},
    network_resolve_batch: ThreadPool.Batch = .{},
    network_task_fifo: NetworkQueue = undefined,
    preallocated_network_tasks: PreallocatedNetworkTasks = .{ .buffer = undefined, .len = 0 },
    pending_tasks: u32 = 0,
    total_tasks: u32 = 0,

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

    /// Do not use directly outside of wait or wake
    uws_event_loop: *uws.Loop,

    file_poll_store: bun.Async.FilePoll.Store,

    // name hash from alias package name -> aliased package dependency version info
    known_npm_aliases: NpmAliasMap = .{},

    const PreallocatedNetworkTasks = std.BoundedArray(NetworkTask, 1024);
    const NetworkTaskQueue = std.HashMapUnmanaged(u64, void, IdentityContext(u64), 80);
    pub var verbose_install = false;

    pub const ScriptRunEnvironment = struct {
        root_dir_info: *DirInfo,
        bundler: bundler.Bundler,
    };

    const PackageDedupeList = std.HashMapUnmanaged(
        u32,
        void,
        IdentityContext(u32),
        80,
    );

    const TimePasser = struct {
        pub var last_time: c_longlong = -1;
    };

    pub const LifecycleScriptTimeLog = struct {
        const Entry = struct {
            package_name: []const u8,
            script_id: u8,

            // nanosecond duration
            duration: u64,
        };

        mutex: std.Thread.Mutex = .{},
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
        const iter = instance.uws_event_loop.iterationNumber();
        if (TimePasser.last_time < iter) {
            TimePasser.last_time = iter;
            return true;
        }

        return false;
    }

    pub fn configureEnvForScripts(this: *PackageManager, ctx: Command.Context, log_level: Options.LogLevel) !*bundler.Bundler {
        if (this.env_configure) |*env_configure| {
            return &env_configure.bundler;
        }

        // We need to figure out the PATH and other environment variables
        // to do that, we re-use the code from bun run
        // this is expensive, it traverses the entire directory tree going up to the root
        // so we really only want to do it when strictly necessary
        this.env_configure = .{
            .root_dir_info = undefined,
            .bundler = undefined,
        };
        const this_bundler: *bundler.Bundler = &this.env_configure.?.bundler;

        const root_dir_info = try RunCommand.configureEnvForRun(
            ctx,
            this_bundler,
            this.env,
            log_level != .silent,
        );

        const init_cwd_gop = try this.env.map.getOrPutWithoutValue("INIT_CWD");
        if (!init_cwd_gop.found_existing) {
            init_cwd_gop.key_ptr.* = try ctx.allocator.dupe(u8, init_cwd_gop.key_ptr.*);
            init_cwd_gop.value_ptr.* = .{
                .value = try ctx.allocator.dupe(u8, FileSystem.instance.top_level_dir),
                .conditional = false,
            };
        }

        this.env.loadCCachePath(this_bundler.fs);

        {
            var node_path: [bun.MAX_PATH_BYTES]u8 = undefined;
            if (this.env.getNodePath(this_bundler.fs, &node_path)) |node_pathZ| {
                _ = try this.env.loadNodeJSConfig(this_bundler.fs, bun.default_allocator.dupe(u8, node_pathZ) catch bun.outOfMemory());
            } else brk: {
                const current_path = this.env.get("PATH") orelse "";
                var PATH = try std.ArrayList(u8).initCapacity(bun.default_allocator, current_path.len);
                try PATH.appendSlice(current_path);
                var bun_path: string = "";
                RunCommand.createFakeTemporaryNodeExecutable(&PATH, &bun_path) catch break :brk;
                try this.env.map.put("PATH", PATH.items);
                _ = try this.env.loadNodeJSConfig(this_bundler.fs, bun.default_allocator.dupe(u8, RunCommand.bun_node_dir) catch bun.outOfMemory());
            }
        }

        this.env_configure.?.root_dir_info = root_dir_info;

        return this_bundler;
    }

    pub fn httpProxy(this: *PackageManager, url: URL) ?URL {
        return this.env.getHttpProxy(url);
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

        _ = this.wait_count.fetchAdd(1, .Monotonic);
        this.uws_event_loop.wakeup();
    }

    pub fn tickLifecycleScripts(this: *PackageManager) void {
        if (this.pending_lifecycle_script_tasks.load(.Monotonic) > 0) {
            this.uws_event_loop.tickWithoutIdle();
        }
    }

    pub fn sleep(this: *PackageManager) void {
        if (this.wait_count.swap(0, .Monotonic) > 0) {
            this.tickLifecycleScripts();
            return;
        }
        Output.flush();
        this.uws_event_loop.tick();
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

            const dep = dummy.cloneWithDifferentBuffers(name, version_buf, @TypeOf(&builder), &builder) catch unreachable;
            builder.clamp();
            const index = this.lockfile.buffers.dependencies.items.len;
            this.lockfile.buffers.dependencies.append(this.allocator, dep) catch unreachable;
            this.lockfile.buffers.resolutions.append(this.allocator, invalid_package_id) catch unreachable;
            if (comptime Environment.allow_assert) std.debug.assert(this.lockfile.buffers.dependencies.items.len == this.lockfile.buffers.resolutions.items.len);
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

                switch (this.options.log_level) {
                    inline else => |log_level| {
                        if (log_level.showProgress()) this.startProgressBarIfNone();
                        while (this.pending_tasks > 0) {
                            this.runTasks(
                                void,
                                {},
                                .{
                                    .onExtract = {},
                                    .onResolve = {},
                                    .onPackageManifestError = {},
                                    .onPackageDownloadError = {},
                                },
                                false,
                                log_level,
                            ) catch |err| {
                                return .{ .failure = err };
                            };

                            if (PackageManager.verbose_install and this.pending_tasks > 0) {
                                if (PackageManager.hasEnoughTimePassedBetweenWaitingMessages()) Output.prettyErrorln("<d>[PackageManager]<r> waiting for {d} tasks\n", .{PackageManager.instance.pending_tasks});
                            }

                            if (this.pending_tasks > 0)
                                this.sleep();
                        }
                    },
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
            var buf: [bun.MAX_PATH_BYTES]u8 = undefined;
            const _path = try bun.getFdPath(this.global_link_dir.?.fd, &buf);
            this.global_link_dir_path = try Fs.FileSystem.DirnameStore.instance.append([]const u8, _path);
            break :brk this.global_link_dir.?;
        };
    }

    pub fn globalLinkDirPath(this: *PackageManager) ![]const u8 {
        _ = try this.globalLinkDir();
        return this.global_link_dir_path;
    }

    fn ensurePreinstallStateListCapacity(this: *PackageManager, count: usize) !void {
        if (this.preinstall_state.items.len >= count) {
            return;
        }

        const offset = this.preinstall_state.items.len;
        try this.preinstall_state.ensureTotalCapacity(this.allocator, count);
        this.preinstall_state.expandToCapacity();
        @memset(this.preinstall_state.items[offset..], PreinstallState.unknown);
    }

    pub fn formatLaterVersionInCache(
        this: *PackageManager,
        name: []const u8,
        name_hash: PackageNameHash,
        resolution: Resolution,
    ) ?Semver.Version.Formatter {
        switch (resolution.tag) {
            Resolution.Tag.npm => {
                if (resolution.value.npm.version.tag.hasPre())
                    // TODO:
                    return null;

                // We skip this in CI because we don't want any performance impact in an environment you'll probably never use
                // and it makes tests more consistent
                if (this.isContinuousIntegration())
                    return null;

                const manifest: *const Npm.PackageManifest = this.manifests.getPtr(name_hash) orelse brk: {
                    if (Npm.PackageManifest.Serializer.load(this.allocator, this.getCacheDirectory(), name) catch null) |manifest_| {
                        this.manifests.put(this.allocator, name_hash, manifest_) catch return null;
                        break :brk this.manifests.getPtr(name_hash).?;
                    }

                    return null;
                };

                if (manifest.findByDistTag("latest")) |latest_version| {
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

    pub fn setPreinstallState(this: *PackageManager, package_id: PackageID, lockfile: *Lockfile, value: PreinstallState) void {
        this.ensurePreinstallStateListCapacity(lockfile.packages.len) catch return;
        this.preinstall_state.items[package_id] = value;
    }

    pub fn getPreinstallState(this: *PackageManager, package_id: PackageID, _: *Lockfile) PreinstallState {
        if (package_id >= this.preinstall_state.items.len) {
            return PreinstallState.unknown;
        }
        return this.preinstall_state.items[package_id];
    }
    pub fn determinePreinstallState(manager: *PackageManager, this: Package, lockfile: *Lockfile) PreinstallState {
        switch (manager.getPreinstallState(this.meta.id, lockfile)) {
            .unknown => {

                // Do not automatically start downloading packages which are disabled
                // i.e. don't download all of esbuild's versions or SWCs
                if (this.isDisabled()) {
                    manager.setPreinstallState(this.meta.id, lockfile, .done);
                    return .done;
                }

                const folder_path = switch (this.resolution.tag) {
                    .git => manager.cachedGitFolderNamePrintAuto(&this.resolution.value.git),
                    .github => manager.cachedGitHubFolderNamePrintAuto(&this.resolution.value.github),
                    .npm => manager.cachedNPMPackageFolderName(lockfile.str(&this.name), this.resolution.value.npm.version),
                    .local_tarball => manager.cachedTarballFolderName(this.resolution.value.local_tarball),
                    .remote_tarball => manager.cachedTarballFolderName(this.resolution.value.remote_tarball),
                    else => "",
                };

                if (folder_path.len == 0) {
                    manager.setPreinstallState(this.meta.id, lockfile, .extract);
                    return .extract;
                }

                if (manager.isFolderInCache(folder_path)) {
                    manager.setPreinstallState(this.meta.id, lockfile, .done);
                    return .done;
                }

                manager.setPreinstallState(this.meta.id, lockfile, .extract);
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

    var cached_package_folder_name_buf: [bun.MAX_PATH_BYTES]u8 = undefined;

    pub inline fn getCacheDirectory(this: *PackageManager) std.fs.Dir {
        return this.cache_directory_ orelse brk: {
            this.cache_directory_ = this.ensureCacheDirectory();
            break :brk this.cache_directory_.?;
        };
    }

    pub inline fn getTemporaryDirectory(this: *PackageManager) std.fs.Dir {
        return this.temp_dir_ orelse brk: {
            this.temp_dir_ = this.ensureTemporaryDirectory();
            break :brk this.temp_dir_.?;
        };
    }

    noinline fn ensureCacheDirectory(this: *PackageManager) std.fs.Dir {
        loop: while (true) {
            if (this.options.enable.cache) {
                const cache_dir = fetchCacheDirectoryPath(this.env);
                this.cache_directory_path = this.allocator.dupe(u8, cache_dir.path) catch bun.outOfMemory();

                return std.fs.cwd().makeOpenPath(cache_dir.path, .{}) catch {
                    this.options.enable.cache = false;
                    this.allocator.free(this.cache_directory_path);
                    continue :loop;
                };
            }

            this.cache_directory_path = this.allocator.dupe(u8, Path.joinAbsString(
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
        var tempdir: std.fs.Dir = std.fs.cwd().makeOpenPath(this.temp_dir_name, .{}) catch brk: {
            tried_dot_tmp = true;
            break :brk cache_directory.makeOpenPath(".tmp", .{}) catch |err| {
                Output.prettyErrorln("<r><red>error<r>: bun is unable to access tempdir: {s}", .{@errorName(err)});
                Global.crash();
            };
        };
        var tmpbuf: [bun.MAX_PATH_BYTES]u8 = undefined;
        const tmpname = Fs.FileSystem.instance.tmpname("hm", &tmpbuf, 999) catch unreachable;
        var timer: std.time.Timer = if (this.options.log_level != .silent) std.time.Timer.start() catch unreachable else undefined;
        brk: while (true) {
            _ = tempdir.createFileZ(tmpname, .{ .truncate = true }) catch |err2| {
                if (!tried_dot_tmp) {
                    tried_dot_tmp = true;

                    tempdir = cache_directory.makeOpenPath(".tmp", .{}) catch |err| {
                        Output.prettyErrorln("<r><red>error<r>: bun is unable to access tempdir: {s}", .{@errorName(err)});
                        Global.crash();
                    };
                    continue :brk;
                }
                Output.prettyErrorln("<r><red>error<r>: {s} accessing temporary directory. Please set <b>$BUN_TMPDIR<r> or <b>$BUN_INSTALL<r>", .{
                    @errorName(err2),
                });
                Global.crash();
            };

            std.os.renameatZ(tempdir.fd, tmpname, cache_directory.fd, tmpname) catch |err| {
                if (!tried_dot_tmp) {
                    tried_dot_tmp = true;
                    tempdir = cache_directory.makeOpenPath(".tmp", .{}) catch |err2| {
                        Output.prettyErrorln("<r><red>error<r>: bun is unable to write files to tempdir: {s}", .{@errorName(err2)});
                        Global.crash();
                    };
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
        if (this.options.log_level != .silent) {
            const elapsed = timer.read();
            if (elapsed > std.time.ns_per_ms * 100) {
                var path_buf: [bun.MAX_PATH_BYTES]u8 = undefined;
                const cache_dir_path = bun.getFdPath(cache_directory.fd, &path_buf) catch "it";
                Output.prettyErrorln(
                    "<r><yellow>warn<r>: Slow filesystem detected. If {s} is a network drive, consider setting $BUN_INSTALL_CACHE_DIR to a local folder.",
                    .{cache_dir_path},
                );
            }
        }

        return tempdir;
    }

    pub fn ensureTempNodeGypScript(this: *PackageManager) !void {
        if (comptime Environment.isWindows) {
            @panic("TODO: command prompt version of temp node-gyp script");
        }

        if (this.node_gyp_tempdir_name.len > 0) return;

        const tempdir = this.getTemporaryDirectory();
        var path_buf: [bun.MAX_PATH_BYTES]u8 = undefined;
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

        var node_gyp_file = node_gyp_tempdir.createFile("node-gyp", .{ .mode = 0o777 }) catch |err| {
            Output.prettyErrorln("<r><red>error<r>: <b><red>{s}<r> creating node-gyp tempdir", .{@errorName(err)});
            Global.crash();
        };
        defer node_gyp_file.close();

        var bytes: string = "#!/usr/bin/env node\nrequire(\"child_process\").spawnSync(\"bun\",[\"x\",\"node-gyp\",...process.argv.slice(2)],{stdio:\"inherit\"})";
        var index: usize = 0;
        while (index < bytes.len) {
            switch (bun.sys.write(bun.toFD(node_gyp_file.handle), bytes[index..])) {
                .result => |written| {
                    index += written;
                },
                .err => |err| {
                    Output.prettyErrorln("<r><red>error<r>: <b><red>{s}<r> writing to node-gyp file", .{@tagName(err.getErrno())});
                    Global.crash();
                },
            }
        }

        // Add our node-gyp tempdir to the path
        const existing_path = this.env.get("PATH") orelse "";
        var PATH = try std.ArrayList(u8).initCapacity(bun.default_allocator, existing_path.len + 1 + this.node_gyp_tempdir_name.len);
        try PATH.appendSlice(existing_path);
        if (existing_path.len > 0 and existing_path[existing_path.len - 1] != std.fs.path.delimiter)
            try PATH.append(std.fs.path.delimiter);
        try PATH.appendSlice(strings.withoutTrailingSlash(this.temp_dir_name));
        try PATH.append(std.fs.path.sep);
        try PATH.appendSlice(this.node_gyp_tempdir_name);
        try this.env.map.put("PATH", PATH.items);

        const node_gyp_abs_dir = try bun.fmt.bufPrint(&path_buf, "{s}" ++ .{std.fs.path.sep} ++ "{s}", .{
            strings.withoutTrailingSlash(this.temp_dir_name),
            strings.withoutTrailingSlash(this.node_gyp_tempdir_name),
        });
        try this.env.map.putAllocKeyAndValue(this.allocator, "BUN_WHICH_IGNORE_CWD", node_gyp_abs_dir);

        path_buf[node_gyp_abs_dir.len] = std.fs.path.sep;
        @memcpy(path_buf[node_gyp_abs_dir.len + 1 ..][0.."node-gyp".len], "node-gyp");
        const npm_config_node_gyp = path_buf[0 .. node_gyp_abs_dir.len + 1 + "node-gyp".len];
        try this.env.map.putAllocKeyAndValue(this.allocator, "npm_config_node_gyp", npm_config_node_gyp);
    }

    pub var instance: PackageManager = undefined;

    pub fn getNetworkTask(this: *PackageManager) *NetworkTask {
        if (this.preallocated_network_tasks.len + 1 < this.preallocated_network_tasks.buffer.len) {
            const len = this.preallocated_network_tasks.len;
            this.preallocated_network_tasks.len += 1;
            return &this.preallocated_network_tasks.buffer[len];
        }

        return this.allocator.create(NetworkTask) catch @panic("Memory allocation failure creating NetworkTask!");
    }

    fn allocGitHubURL(this: *const PackageManager, repository: *const Repository) string {
        var github_api_url: string = "https://api.github.com";
        if (this.env.map.get("GITHUB_API_URL")) |url| {
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

    pub fn cachedGitFolderNamePrint(buf: []u8, resolved: string) stringZ {
        return std.fmt.bufPrintZ(buf, "@G@{s}", .{resolved}) catch unreachable;
    }

    pub fn cachedGitFolderName(this: *const PackageManager, repository: *const Repository) stringZ {
        return cachedGitFolderNamePrint(&cached_package_folder_name_buf, this.lockfile.str(&repository.resolved));
    }

    pub fn cachedGitFolderNamePrintAuto(this: *const PackageManager, repository: *const Repository) stringZ {
        if (!repository.resolved.isEmpty()) {
            return this.cachedGitFolderName(repository);
        }

        if (!repository.repo.isEmpty() and !repository.committish.isEmpty()) {
            const string_buf = this.lockfile.buffers.string_bytes.items;
            return std.fmt.bufPrintZ(
                &cached_package_folder_name_buf,
                "@G@{any}",
                .{repository.committish.fmt(string_buf)},
            ) catch unreachable;
        }

        return "";
    }

    pub fn cachedGitHubFolderNamePrint(buf: []u8, resolved: string) stringZ {
        return std.fmt.bufPrintZ(buf, "@GH@{s}", .{resolved}) catch unreachable;
    }

    pub fn cachedGitHubFolderName(this: *const PackageManager, repository: *const Repository) stringZ {
        return cachedGitHubFolderNamePrint(&cached_package_folder_name_buf, this.lockfile.str(&repository.resolved));
    }

    fn cachedGitHubFolderNamePrintGuess(buf: []u8, string_buf: []const u8, repository: *const Repository) stringZ {
        return std.fmt.bufPrintZ(
            buf,
            "@GH@{any}-{any}-{any}",
            .{
                repository.owner.fmt(string_buf),
                repository.repo.fmt(string_buf),
                repository.committish.fmt(string_buf),
            },
        ) catch unreachable;
    }

    pub fn cachedGitHubFolderNamePrintAuto(this: *const PackageManager, repository: *const Repository) stringZ {
        if (!repository.resolved.isEmpty()) {
            return this.cachedGitHubFolderName(repository);
        }

        if (!repository.owner.isEmpty() and !repository.repo.isEmpty() and !repository.committish.isEmpty()) {
            return cachedGitHubFolderNamePrintGuess(&cached_package_folder_name_buf, this.lockfile.buffers.string_bytes.items, repository);
        }

        return "";
    }

    // TODO: normalize to alphanumeric
    pub fn cachedNPMPackageFolderNamePrint(this: *const PackageManager, buf: []u8, name: string, version: Semver.Version) stringZ {
        const scope = this.scopeForPackageName(name);

        const basename = cachedNPMPackageFolderPrintBasename(buf, name, version);

        if (scope.name.len == 0 and !this.options.did_override_default_scope) {
            return basename;
        }

        const spanned = bun.span(basename);
        const available = buf[spanned.len..];
        var end: []u8 = undefined;
        if (scope.url.hostname.len > 32 or available.len < 64) {
            const visible_hostname = scope.url.hostname[0..@min(scope.url.hostname.len, 12)];
            end = std.fmt.bufPrint(available, "@@{s}__{any}", .{ visible_hostname, bun.fmt.hexIntLower(String.Builder.stringHash(scope.url.href)) }) catch unreachable;
        } else {
            end = std.fmt.bufPrint(available, "@@{s}", .{scope.url.hostname}) catch unreachable;
        }

        buf[spanned.len + end.len] = 0;
        const result: [:0]u8 = buf[0 .. spanned.len + end.len :0];
        return result;
    }

    pub fn cachedNPMPackageFolderBasename(name: string, version: Semver.Version) stringZ {
        return cachedNPMPackageFolderPrintBasename(&cached_package_folder_name_buf, name, version);
    }

    pub fn cachedNPMPackageFolderName(this: *const PackageManager, name: string, version: Semver.Version) stringZ {
        return this.cachedNPMPackageFolderNamePrint(&cached_package_folder_name_buf, name, version);
    }

    // TODO: normalize to alphanumeric
    pub fn cachedNPMPackageFolderPrintBasename(buf: []u8, name: string, version: Semver.Version) stringZ {
        if (version.tag.hasPre()) {
            if (version.tag.hasBuild()) {
                return std.fmt.bufPrintZ(
                    buf,
                    "{s}@{d}.{d}.{d}-{any}+{any}",
                    .{
                        name,
                        version.major,
                        version.minor,
                        version.patch,
                        bun.fmt.hexIntLower(version.tag.pre.hash),
                        bun.fmt.hexIntUpper(version.tag.build.hash),
                    },
                ) catch unreachable;
            }
            return std.fmt.bufPrintZ(
                buf,
                "{s}@{d}.{d}.{d}-{any}",
                .{
                    name,
                    version.major,
                    version.minor,
                    version.patch,
                    bun.fmt.hexIntLower(version.tag.pre.hash),
                },
            ) catch unreachable;
        }
        if (version.tag.hasBuild()) {
            return std.fmt.bufPrintZ(
                buf,
                "{s}@{d}.{d}.{d}+{any}",
                .{
                    name,
                    version.major,
                    version.minor,
                    version.patch,
                    bun.fmt.hexIntUpper(version.tag.build.hash),
                },
            ) catch unreachable;
        }
        return std.fmt.bufPrintZ(buf, "{s}@{d}.{d}.{d}", .{
            name,
            version.major,
            version.minor,
            version.patch,
        }) catch unreachable;
    }

    pub fn cachedTarballFolderNamePrint(buf: []u8, url: string) stringZ {
        return std.fmt.bufPrintZ(buf, "@T@{any}", .{bun.fmt.hexIntLower(String.Builder.stringHash(url))}) catch unreachable;
    }

    pub fn cachedTarballFolderName(this: *const PackageManager, url: String) stringZ {
        return cachedTarballFolderNamePrint(&cached_package_folder_name_buf, this.lockfile.str(&url));
    }

    pub fn isFolderInCache(this: *PackageManager, folder_path: stringZ) bool {
        // TODO: is this slow?
        var dir = this.getCacheDirectory().openDirZ(folder_path, .{}) catch return false;
        dir.close();
        return true;
    }

    pub fn pathForCachedNPMPath(
        this: *PackageManager,
        buf: *[bun.MAX_PATH_BYTES]u8,
        package_name: []const u8,
        npm: Semver.Version,
    ) ![]u8 {
        var package_name_version_buf: [bun.MAX_PATH_BYTES]u8 = undefined;

        const subpath = std.fmt.bufPrintZ(
            &package_name_version_buf,
            "{s}" ++ std.fs.path.sep_str ++ "{any}",
            .{
                package_name,
                npm.fmt(this.lockfile.buffers.string_bytes.items),
            },
        ) catch unreachable;
        return this.getCacheDirectory().readLink(
            subpath,
            buf,
        ) catch |err| {
            // if we run into an error, delete the symlink
            // so that we don't repeatedly try to read it
            std.os.unlinkat(this.getCacheDirectory().fd, subpath, 0) catch {};
            return err;
        };
    }

    pub fn pathForResolution(
        this: *PackageManager,
        package_id: PackageID,
        resolution: Resolution,
        buf: *[bun.MAX_PATH_BYTES]u8,
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

        var arena = @import("root").bun.ArenaAllocator.init(this.allocator);
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
                var buf: [bun.MAX_PATH_BYTES]u8 = undefined;
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

        /// Pending network task to schedule
        network_task: ?*NetworkTask = null,
    };

    fn getOrPutResolvedPackageWithFindResult(
        this: *PackageManager,
        name_hash: PackageNameHash,
        name: String,
        version: Dependency.Version,
        dependency_id: DependencyID,
        behavior: Behavior,
        manifest: *const Npm.PackageManifest,
        find_result: Npm.PackageManifest.FindResult,
        install_peer: bool,
        comptime successFn: SuccessFn,
    ) !?ResolvedPackageResult {

        // Was this package already allocated? Let's reuse the existing one.
        if (this.lockfile.getPackageID(
            name_hash,
            if (this.to_update) null else version,
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
            this.allocator,
            this.lockfile,
            this.log,
            manifest,
            find_result.version,
            find_result.package,
            manifest.string_buf,
            Features.npm,
        ));

        if (comptime Environment.allow_assert) std.debug.assert(package.meta.id != invalid_package_id);
        defer successFn(this, dependency_id, package.meta.id);

        return switch (this.determinePreinstallState(package, this.lockfile)) {
            // Is this package already in the cache?
            // We don't need to download the tarball, but we should enqueue dependencies
            .done => .{ .package = package, .is_first_time = true },
            // Do we need to download the tarball?
            .extract => .{
                .package = package,
                .is_first_time = true,
                .network_task = try this.generateNetworkTaskForTarball(
                    Task.Id.forNPMPackage(
                        this.lockfile.str(&name),
                        package.resolution.value.npm.version,
                    ),
                    manifest.str(&find_result.package.tarball_url),
                    dependency_id,
                    package,
                ) orelse unreachable,
            },
            else => unreachable,
        };
    }

    pub fn generateNetworkTaskForTarball(
        this: *PackageManager,
        task_id: u64,
        url: string,
        dependency_id: DependencyID,
        package: Lockfile.Package,
    ) !?*NetworkTask {
        const dedupe_entry = try this.network_dedupe_map.getOrPut(this.allocator, task_id);
        if (dedupe_entry.found_existing) {
            return null;
        }

        var network_task = this.getNetworkTask();

        network_task.* = .{
            .task_id = task_id,
            .callback = undefined,
            .allocator = this.allocator,
            .package_manager = this,
        };

        const scope = this.scopeForPackageName(this.lockfile.str(&package.name));

        try network_task.forTarball(
            this.allocator,
            .{
                .package_manager = &PackageManager.instance, // https://github.com/ziglang/zig/issues/14005
                .name = try strings.StringOrTinyString.initAppendIfNeeded(
                    this.lockfile.str(&package.name),
                    *FileSystem.FilenameStore,
                    &FileSystem.FilenameStore.instance,
                ),
                .resolution = package.resolution,
                .cache_dir = this.getCacheDirectory(),
                .temp_dir = this.getTemporaryDirectory(),
                .dependency_id = dependency_id,
                .integrity = package.meta.integrity,
                .url = try strings.StringOrTinyString.initAppendIfNeeded(
                    url,
                    *FileSystem.FilenameStore,
                    &FileSystem.FilenameStore.instance,
                ),
            },
            scope,
        );

        return network_task;
    }

    fn enqueueNetworkTask(this: *PackageManager, task: *NetworkTask) void {
        if (this.network_task_fifo.writableLength() == 0) {
            this.flushNetworkQueue();
        }

        this.network_task_fifo.writeItemAssumeCapacity(task);
    }

    const SuccessFn = *const fn (*PackageManager, DependencyID, PackageID) void;
    const FailFn = *const fn (*PackageManager, *const Dependency, PackageID, anyerror) void;
    fn assignResolution(this: *PackageManager, dependency_id: DependencyID, package_id: PackageID) void {
        const buffers = &this.lockfile.buffers;
        if (comptime Environment.allow_assert) {
            std.debug.assert(dependency_id < buffers.resolutions.items.len);
            std.debug.assert(package_id < this.lockfile.packages.len);
            // std.debug.assert(buffers.resolutions.items[dependency_id] == invalid_package_id);
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
            std.debug.assert(dependency_id < buffers.resolutions.items.len);
            std.debug.assert(package_id < this.lockfile.packages.len);
            std.debug.assert(buffers.resolutions.items[dependency_id] == invalid_package_id);
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
                    .PackageID => |existing_id| {
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
                                        existing_package.resolution.fmt(this.lockfile.buffers.string_bytes.items),
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
                    .PackageIDMultiple => |list| {
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
                                        existing_package.resolution.fmt(this.lockfile.buffers.string_bytes.items),
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
                if (version.tag == .npm) {
                    if (this.lockfile.workspace_versions.count() > 0) resolve_from_workspace: {
                        if (this.lockfile.workspace_versions.get(name_hash)) |workspace_version| {
                            const buf = this.lockfile.buffers.string_bytes.items;
                            if (version.value.npm.version.satisfies(workspace_version, buf, buf)) {
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
                }

                // Resolve the version from the loaded NPM manifest
                const manifest = this.manifests.getPtr(name_hash) orelse return null; // manifest might still be downloading. This feels unreliable.
                const find_result: Npm.PackageManifest.FindResult = switch (version.tag) {
                    .dist_tag => manifest.findByDistTag(this.lockfile.str(&version.value.dist_tag.tag)),
                    .npm => manifest.findBestVersion(version.value.npm.version, this.lockfile.buffers.string_bytes.items),
                    else => unreachable,
                } orelse return if (behavior.isPeer()) null else switch (version.tag) {
                    .npm => error.NoMatchingVersion,
                    .dist_tag => error.DistTagNotFound,
                    else => unreachable,
                };

                return try this.getOrPutResolvedPackageWithFindResult(
                    name_hash,
                    name,
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
                // relative to cwd
                const res = FolderResolution.getOrPut(.{ .relative = .folder }, version, this.lockfile.str(&version.value.folder), this);

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
                const workspace_path: *const String = this.lockfile.workspace_paths.getPtr(@truncate(name_hash)) orelse &version.value.workspace;

                const res = FolderResolution.getOrPut(.{ .relative = .workspace }, version, this.lockfile.str(workspace_path), this);

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
        var task = this.allocator.create(Task) catch unreachable;
        task.* = Task{
            .package_manager = &PackageManager.instance, // https://github.com/ziglang/zig/issues/14005
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
        tarball: ExtractTarball,
        network_task: *NetworkTask,
    ) *ThreadPool.Task {
        var task = this.allocator.create(Task) catch unreachable;
        task.* = Task{
            .package_manager = &PackageManager.instance, // https://github.com/ziglang/zig/issues/14005
            .log = logger.Log.init(this.allocator),
            .tag = Task.Tag.extract,
            .request = .{
                .extract = .{
                    .network = network_task,
                    .tarball = tarball,
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
    ) *ThreadPool.Task {
        var task = this.allocator.create(Task) catch unreachable;
        task.* = Task{
            .package_manager = &PackageManager.instance, // https://github.com/ziglang/zig/issues/14005
            .log = logger.Log.init(this.allocator),
            .tag = Task.Tag.git_clone,
            .request = .{
                .git_clone = .{
                    .name = strings.StringOrTinyString.initAppendIfNeeded(
                        name,
                        *FileSystem.FilenameStore,
                        &FileSystem.FilenameStore.instance,
                    ) catch unreachable,
                    .url = strings.StringOrTinyString.initAppendIfNeeded(
                        this.lockfile.str(&repository.repo),
                        *FileSystem.FilenameStore,
                        &FileSystem.FilenameStore.instance,
                    ) catch unreachable,
                },
            },
            .id = task_id,
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
    ) *ThreadPool.Task {
        var task = this.allocator.create(Task) catch unreachable;
        task.* = Task{
            .package_manager = &PackageManager.instance, // https://github.com/ziglang/zig/issues/14005
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
                        &FileSystem.FilenameStore.instance,
                    ) catch unreachable,
                    .url = strings.StringOrTinyString.initAppendIfNeeded(
                        this.lockfile.str(&resolution.value.git.repo),
                        *FileSystem.FilenameStore,
                        &FileSystem.FilenameStore.instance,
                    ) catch unreachable,
                    .resolved = strings.StringOrTinyString.initAppendIfNeeded(
                        resolved,
                        *FileSystem.FilenameStore,
                        &FileSystem.FilenameStore.instance,
                    ) catch unreachable,
                },
            },
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
        var task = this.allocator.create(Task) catch unreachable;
        task.* = Task{
            .package_manager = &PackageManager.instance, // https://github.com/ziglang/zig/issues/14005
            .log = logger.Log.init(this.allocator),
            .tag = Task.Tag.local_tarball,
            .request = .{
                .local_tarball = .{
                    .tarball = .{
                        .package_manager = &PackageManager.instance, // https://github.com/ziglang/zig/issues/14005
                        .name = strings.StringOrTinyString.initAppendIfNeeded(
                            name,
                            *FileSystem.FilenameStore,
                            &FileSystem.FilenameStore.instance,
                        ) catch unreachable,
                        .resolution = resolution,
                        .cache_dir = this.getCacheDirectory(),
                        .temp_dir = this.getTemporaryDirectory(),
                        .dependency_id = dependency_id,
                        .url = strings.StringOrTinyString.initAppendIfNeeded(
                            path,
                            *FileSystem.FilenameStore,
                            &FileSystem.FilenameStore.instance,
                        ) catch unreachable,
                    },
                },
            },
            .id = task_id,
            .data = undefined,
        };
        return &task.threadpool_task;
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
        var buffered_writer = std.io.BufferedWriter(std.mem.page_size, @TypeOf(file_writer)){
            .unbuffered_writer = file_writer,
        };
        const writer = buffered_writer.writer();
        try Lockfile.Printer.Yarn.print(&printer, @TypeOf(writer), writer);
        try buffered_writer.flush();

        if (comptime Environment.isPosix) {
            _ = C.fchmod(
                tmpfile.fd.cast(),
                // chmod 666,
                0o0000040 | 0o0000004 | 0o0000002 | 0o0000400 | 0o0000200 | 0o0000020,
            );
        }

        try tmpfile.promoteToCWD(tmpname, "yarn.lock");
    }

    pub fn isRootDependency(this: *const PackageManager, id: DependencyID) bool {
        return this.root_dependency_list.contains(id);
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

            // allow overriding all dependencies unless the dependency is coming directly from an alias, "npm:<this dep>"
            if (dependency.version.tag != .npm or !dependency.version.value.npm.is_alias and this.lockfile.hasOverrides()) {
                if (this.lockfile.overrides.get(name_hash)) |new| {
                    debug("override: {s} -> {s}", .{ this.lockfile.str(&dependency.version.literal), this.lockfile.str(&new.literal) });
                    name = switch (new.tag) {
                        .dist_tag => new.value.dist_tag.name,
                        .git => new.value.git.package_name,
                        .github => new.value.github.package_name,
                        .npm => new.value.npm.name,
                        .tarball => new.value.tarball.package_name,
                        else => name,
                    };
                    name_hash = String.Builder.stringHash(this.lockfile.str(&name));
                    break :version new;
                }
            }

            // explicit copy here due to `dependency.version` becoming undefined
            // when `getOrPutResolvedPackageWithFindResult` is called and resizes the list.
            break :version Dependency.Version{
                .literal = dependency.version.literal,
                .tag = dependency.version.tag,
                .value = dependency.version.value,
            };
            // break :version dependency.version;
        };
        var loaded_manifest: ?Npm.PackageManifest = null;

        switch (version.tag) {
            .dist_tag, .folder, .npm => {
                retry_from_manifests_ptr: while (true) {
                    var resolve_result_ = this.getOrPutResolvedPackage(
                        name_hash,
                        name,
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
                                                "package \"{s}\" with tag \"{s}\" not found, but package exists",
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
                                        result.package.resolution.fmt(this.lockfile.buffers.string_bytes.items),
                                    });
                                }
                                // Resolve dependencies first
                                if (result.package.dependencies.len > 0) {
                                    try this.lockfile.scratch.dependency_list_queue.writeItem(result.package.dependencies);
                                }
                            }

                            if (result.network_task) |network_task| {
                                if (this.getPreinstallState(result.package.meta.id, this.lockfile) == .extract) {
                                    this.setPreinstallState(result.package.meta.id, this.lockfile, .extracting);
                                    this.enqueueNetworkTask(network_task);
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

                            if (comptime Environment.allow_assert) std.debug.assert(task_id != 0);

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
                                const network_entry = try this.network_dedupe_map.getOrPutContext(this.allocator, task_id, .{});
                                if (!network_entry.found_existing) {
                                    if (this.options.enable.manifest_cache) {
                                        if (Npm.PackageManifest.Serializer.load(this.allocator, this.getCacheDirectory(), name_str) catch null) |manifest_| {
                                            const manifest: Npm.PackageManifest = manifest_;
                                            loaded_manifest = manifest;

                                            if (this.options.enable.manifest_cache_control and manifest.pkg.public_max_age > this.timestamp_for_manifest_cache_control) {
                                                try this.manifests.put(this.allocator, manifest.pkg.name.hash, manifest);
                                            }

                                            // If it's an exact package version already living in the cache
                                            // We can skip the network request, even if it's beyond the caching period
                                            if (version.tag == .npm and version.value.npm.version.isExact()) {
                                                if (loaded_manifest.?.findByVersion(version.value.npm.version.head.head.range.left.version)) |find_result| {
                                                    if (this.getOrPutResolvedPackageWithFindResult(
                                                        name_hash,
                                                        name,
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
                                            if (this.options.enable.manifest_cache_control and manifest.pkg.public_max_age > this.timestamp_for_manifest_cache_control) {
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
                                        .package_manager = &PackageManager.instance, // https://github.com/ziglang/zig/issues/14005
                                        .callback = undefined,
                                        .task_id = task_id,
                                        .allocator = this.allocator,
                                    };
                                    try network_task.forManifest(
                                        name_str,
                                        this.allocator,
                                        this.scopeForPackageName(name_str),
                                        loaded_manifest,
                                        dependency.behavior.isOptional() or !this.options.do.install_peer_dependencies,
                                    );
                                    this.enqueueNetworkTask(network_task);
                                }
                            } else {
                                if (this.options.do.install_peer_dependencies and !dependency.behavior.isOptionalPeer()) {
                                    try this.peer_dependencies.writeItem(id);
                                }
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
                        repo_fd.asDir(),
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
                            if (this.options.do.install_peer_dependencies and !dependency.behavior.isOptionalPeer()) {
                                try this.peer_dependencies.writeItem(id);
                            }
                            return;
                        }
                    }

                    const network_entry = try this.network_dedupe_map.getOrPutContext(this.allocator, checkout_id, .{});
                    if (network_entry.found_existing) return;

                    this.task_batch.push(ThreadPool.Batch.from(this.enqueueGitCheckout(
                        checkout_id,
                        repo_fd,
                        id,
                        alias,
                        res,
                        resolved,
                    )));
                } else {
                    var entry = this.task_queue.getOrPutContext(this.allocator, clone_id, .{}) catch unreachable;
                    if (!entry.found_existing) entry.value_ptr.* = .{};
                    try entry.value_ptr.append(this.allocator, ctx);

                    if (dependency.behavior.isPeer()) return;

                    const network_entry = try this.network_dedupe_map.getOrPutContext(this.allocator, clone_id, .{});
                    if (network_entry.found_existing) return;

                    this.task_batch.push(ThreadPool.Batch.from(this.enqueueGitClone(clone_id, alias, dep)));
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
                        if (this.options.do.install_peer_dependencies and !dependency.behavior.isOptionalPeer()) {
                            try this.peer_dependencies.writeItem(id);
                        }
                        return;
                    }
                }

                if (try this.generateNetworkTaskForTarball(task_id, url, id, .{
                    .name = dependency.name,
                    .name_hash = dependency.name_hash,
                    .resolution = res,
                })) |network_task| {
                    this.enqueueNetworkTask(network_task);
                }
            },
            inline .symlink, .workspace => |dependency_tag| {
                const _result = this.getOrPutResolvedPackage(
                    name_hash,
                    name,
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
                    \\workspace dependency "{[name]s}" not found
                    \\
                    \\Searched in <b>{[search_path]}<r>
                    \\
                    \\Workspace documentation: https://bun.sh/docs/install/workspaces
                    \\
                ;
                const link_not_found_fmt =
                    \\package "{[name]s}" is not linked
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
                                result.package.resolution.fmt(this.lockfile.buffers.string_bytes.items),
                            });
                        }
                        // We shouldn't see any dependencies
                        if (result.package.dependencies.len > 0) {
                            try this.lockfile.scratch.dependency_list_queue.writeItem(result.package.dependencies);
                        }
                    }

                    // should not trigger a network call
                    if (comptime Environment.allow_assert) std.debug.assert(result.network_task == null);

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
                        if (this.options.do.install_peer_dependencies and !dependency.behavior.isOptionalPeer()) {
                            try this.peer_dependencies.writeItem(id);
                        }
                        return;
                    }
                }

                switch (version.value.tarball.uri) {
                    .local => {
                        const network_entry = try this.network_dedupe_map.getOrPutContext(this.allocator, task_id, .{});
                        if (network_entry.found_existing) return;

                        this.task_batch.push(ThreadPool.Batch.from(this.enqueueLocalTarball(
                            task_id,
                            id,
                            this.lockfile.str(&dependency.name),
                            url,
                            res,
                        )));
                    },
                    .remote => {
                        if (try this.generateNetworkTaskForTarball(task_id, url, id, .{
                            .name = dependency.name,
                            .name_hash = dependency.name_hash,
                            .resolution = res,
                        })) |network_task| {
                            this.enqueueNetworkTask(network_task);
                        }
                    },
                }
            },
            else => {},
        }
    }

    fn flushNetworkQueue(this: *PackageManager) void {
        var network = &this.network_task_fifo;

        while (network.readItem()) |network_task| {
            network_task.schedule(if (network_task.callback == .extract) &this.network_tarball_batch else &this.network_resolve_batch);
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

            if (this.total_tasks == last_count) break;
        }
    }

    pub fn scheduleTasks(manager: *PackageManager) usize {
        const count = manager.task_batch.len + manager.network_resolve_batch.len + manager.network_tarball_batch.len;

        manager.pending_tasks += @as(u32, @truncate(count));
        manager.total_tasks += @as(u32, @truncate(count));
        manager.thread_pool.schedule(manager.task_batch);
        manager.network_resolve_batch.push(manager.network_tarball_batch);
        HTTP.http_thread.schedule(manager.network_resolve_batch);
        manager.task_batch = .{};
        manager.network_tarball_batch = .{};
        manager.network_resolve_batch = .{};
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
                    .fmt = "error occured while resolving {s}",
                    .args = .{
                        lockfile.str(&dependency.realname()),
                    },
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

    const GitResolver = struct {
        resolved: string,
        resolution: Resolution,

        pub fn count(this: @This(), comptime Builder: type, builder: Builder, _: JSAst.Expr) void {
            builder.count(this.resolved);
        }

        pub fn resolve(this: @This(), comptime Builder: type, builder: Builder, _: JSAst.Expr) !Resolution {
            var resolution = this.resolution;
            resolution.value.github.resolved = builder.append(String, this.resolved);
            return resolution;
        }
    };

    const TarballResolver = struct {
        url: string,
        resolution: Resolution,

        pub fn count(this: @This(), comptime Builder: type, builder: Builder, _: JSAst.Expr) void {
            builder.count(this.url);
        }

        pub fn resolve(this: @This(), comptime Builder: type, builder: Builder, _: JSAst.Expr) !Resolution {
            var resolution = this.resolution;
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
    };

    /// Returns true if we need to drain dependencies
    fn processExtractedTarballPackage(
        manager: *PackageManager,
        package_id: *PackageID,
        resolution: Resolution,
        data: ExtractData,
        comptime log_level: Options.LogLevel,
    ) ?Lockfile.Package {
        switch (resolution.tag) {
            .git, .github => {
                const package_json_source = logger.Source.initPathString(
                    data.json_path,
                    data.json_buf[0..data.json_len],
                );
                var package = Lockfile.Package{};

                package.parse(
                    manager.lockfile,
                    manager.allocator,
                    manager.log,
                    package_json_source,
                    GitResolver,
                    GitResolver{
                        .resolved = data.resolved,
                        .resolution = resolution,
                    },
                    Features.npm,
                ) catch |err| {
                    if (comptime log_level != .silent) {
                        const string_buf = manager.lockfile.buffers.string_bytes.items;
                        Output.prettyErrorln("<r><red>error:<r> expected package.json in <b>{any}<r> to be a JSON file: {s}\n", .{
                            resolution.fmtURL(&manager.options, string_buf),
                            @errorName(err),
                        });
                    }
                    Global.crash();
                };

                package = manager.lockfile.appendPackage(package) catch unreachable;
                package_id.* = package.meta.id;

                if (package.dependencies.len > 0) {
                    manager.lockfile.scratch.dependency_list_queue.writeItem(package.dependencies) catch unreachable;
                }

                return package;
            },
            .local_tarball, .remote_tarball => {
                const package_json_source = logger.Source.initPathString(
                    data.json_path,
                    data.json_buf[0..data.json_len],
                );
                var package = Lockfile.Package{};

                package.parse(
                    manager.lockfile,
                    manager.allocator,
                    manager.log,
                    package_json_source,
                    TarballResolver,
                    TarballResolver{
                        .url = data.url,
                        .resolution = resolution,
                    },
                    Features.npm,
                ) catch |err| {
                    if (comptime log_level != .silent) {
                        const string_buf = manager.lockfile.buffers.string_bytes.items;
                        Output.prettyErrorln("<r><red>error:<r> expected package.json in <b>{any}<r> to be a JSON file: {s}\n", .{
                            resolution.fmtURL(&manager.options, string_buf),
                            @errorName(err),
                        });
                    }
                    Global.crash();
                };

                package = manager.lockfile.appendPackage(package) catch unreachable;
                package_id.* = package.meta.id;

                if (package.dependencies.len > 0) {
                    manager.lockfile.scratch.dependency_list_queue.writeItem(package.dependencies) catch unreachable;
                }

                return package;
            },
            else => if (data.json_len > 0) {
                const package_json_source = logger.Source.initPathString(
                    data.json_path,
                    data.json_buf[0..data.json_len],
                );
                initializeStore();
                const json = json_parser.ParseJSONUTF8(
                    &package_json_source,
                    manager.log,
                    manager.allocator,
                ) catch |err| {
                    if (comptime log_level != .silent) {
                        const string_buf = manager.lockfile.buffers.string_bytes.items;
                        Output.prettyErrorln("<r><red>error:<r> expected package.json in <b>{any}<r> to be a JSON file: {s}\n", .{
                            resolution.fmtURL(&manager.options, string_buf),
                            @errorName(err),
                        });
                    }
                    Global.crash();
                };
                var builder = manager.lockfile.stringBuilder();
                Lockfile.Package.Scripts.parseCount(manager.allocator, &builder, json);
                builder.allocate() catch unreachable;
                if (comptime Environment.allow_assert) std.debug.assert(package_id.* != invalid_package_id);
                var scripts = manager.lockfile.packages.items(.scripts)[package_id.*];
                scripts.parseAlloc(manager.allocator, &builder, json);
                scripts.filled = true;
            },
        }

        return null;
    }

    const CacheDir = struct { path: string, is_node_modules: bool };
    pub fn fetchCacheDirectoryPath(env: *DotEnv.Loader) CacheDir {
        if (env.map.get("BUN_INSTALL_CACHE_DIR")) |dir| {
            return CacheDir{ .path = dir, .is_node_modules = false };
        }

        if (env.map.get("BUN_INSTALL")) |dir| {
            var parts = [_]string{ dir, "install/", "cache/" };
            return CacheDir{ .path = Fs.FileSystem.instance.abs(&parts), .is_node_modules = false };
        }

        if (env.map.get("XDG_CACHE_HOME")) |dir| {
            var parts = [_]string{ dir, ".bun/", "install/", "cache/" };
            return CacheDir{ .path = Fs.FileSystem.instance.abs(&parts), .is_node_modules = false };
        }

        if (env.map.get(bun.DotEnv.home_env)) |dir| {
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
        comptime log_level: Options.LogLevel,
    ) anyerror!void {
        var has_updated_this_run = false;
        var has_network_error = false;

        var timestamp_this_tick: ?u32 = null;

        while (manager.network_channel.tryReadItem() catch null) |task_| {
            var task: *NetworkTask = task_;
            if (comptime Environment.allow_assert) std.debug.assert(manager.pending_tasks > 0);
            manager.pending_tasks -|= 1;

            switch (task.callback) {
                .package_manifest => |manifest_req| {
                    const name = manifest_req.name;
                    if (comptime log_level.showProgress()) {
                        if (!has_updated_this_run) {
                            manager.setNodeName(manager.downloads_node.?, name.slice(), ProgressStrings.download_emoji, true);
                            has_updated_this_run = true;
                        }
                    }

                    const response = task.http.response orelse {
                        const err = task.http.err orelse error.HTTPError;

                        if (task.retried < manager.options.max_retry_count) {
                            task.retried += 1;
                            if (!has_network_error) {
                                has_network_error = true;
                                const min = manager.options.min_simultaneous_requests;
                                const max = AsyncHTTP.max_simultaneous_requests.load(.Monotonic);
                                if (max > min) {
                                    AsyncHTTP.max_simultaneous_requests.store(@max(min, max / 2), .Monotonic);
                                }
                            }
                            manager.enqueueNetworkTask(task);

                            if (manager.options.log_level.isVerbose()) {
                                manager.log.addWarningFmt(
                                    null,
                                    logger.Loc.Empty,
                                    manager.allocator,
                                    "<r><yellow>warn:<r> {s} downloading package manifest <b>{s}<r>",
                                    .{ bun.span(@errorName(err)), name.slice() },
                                ) catch unreachable;
                            }
                        } else if (@TypeOf(callbacks.onPackageManifestError) != void) {
                            callbacks.onPackageManifestError(
                                extract_ctx,
                                name.slice(),
                                err,
                                task.url_buf,
                            );
                        } else if (comptime log_level != .silent) {
                            const fmt = "\n<r><red>error<r>: {s} downloading package manifest <b>{s}<r>\n";
                            const args = .{ bun.span(@errorName(err)), name.slice() };
                            if (comptime log_level.showProgress()) {
                                Output.prettyWithPrinterFn(fmt, args, Progress.log, &manager.progress);
                            } else {
                                Output.prettyErrorln(
                                    fmt,
                                    args,
                                );
                                Output.flush();
                            }
                        }
                        continue;
                    };

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
                        } else {
                            switch (response.status_code) {
                                404 => {
                                    if (comptime log_level != .silent) {
                                        const fmt = "\n<r><red>error<r>: package <b>\"{s}\"<r> not found <d>{}{s} 404<r>\n";
                                        const args = .{
                                            name.slice(),
                                            task.http.url.displayHost(),
                                            task.http.url.pathname,
                                        };

                                        if (comptime log_level.showProgress()) {
                                            Output.prettyWithPrinterFn(fmt, args, Progress.log, &manager.progress);
                                        } else {
                                            Output.prettyErrorln(fmt, args);
                                            Output.flush();
                                        }
                                    }
                                },
                                401 => {
                                    if (comptime log_level != .silent) {
                                        const fmt = "\n<r><red>error<r>: unauthorized <b>\"{s}\"<r> <d>{}{s} 401<r>\n";
                                        const args = .{
                                            name.slice(),
                                            task.http.url.displayHost(),
                                            task.http.url.pathname,
                                        };

                                        if (comptime log_level.showProgress()) {
                                            Output.prettyWithPrinterFn(fmt, args, Progress.log, &manager.progress);
                                        } else {
                                            Output.prettyErrorln(fmt, args);
                                            Output.flush();
                                        }
                                    }
                                },
                                403 => {
                                    if (comptime log_level != .silent) {
                                        const fmt = "\n<r><red>error<r>: forbidden while loading <b>\"{s}\"<r><d> 403<r>\n";
                                        const args = .{
                                            name.slice(),
                                        };

                                        if (comptime log_level.showProgress()) {
                                            Output.prettyWithPrinterFn(fmt, args, Progress.log, &manager.progress);
                                        } else {
                                            Output.prettyErrorln(fmt, args);
                                            Output.flush();
                                        }
                                    }
                                },
                                else => {
                                    if (comptime log_level != .silent) {
                                        const fmt = "\n<r><red><b>GET<r><red> {s}<d> - {d}<r>\n";
                                        const args = .{
                                            task.http.client.url.href,
                                            response.status_code,
                                        };

                                        if (comptime log_level.showProgress()) {
                                            Output.prettyWithPrinterFn(fmt, args, Progress.log, &manager.progress);
                                        } else {
                                            Output.prettyErrorln(fmt, args);
                                            Output.flush();
                                        }
                                    }
                                },
                            }
                        }
                        for (manager.package_json_updates) |*request| {
                            if (strings.eql(request.name, name.slice())) {
                                request.failed = true;
                                manager.options.do.save_lockfile = false;
                                manager.options.do.save_yarn_lock = false;
                                manager.options.do.install_packages = false;
                            }
                        }

                        continue;
                    }

                    if (comptime log_level.isVerbose()) {
                        Output.prettyError("    ", .{});
                        Output.printElapsed(@as(f64, @floatFromInt(task.http.elapsed)) / std.time.ns_per_ms);
                        Output.prettyError("\n <d>Downloaded <r><green>{s}<r> versions\n", .{name.slice()});
                        Output.flush();
                    }

                    if (response.status_code == 304) {
                        // The HTTP request was cached
                        if (manifest_req.loaded_manifest) |manifest| {
                            const entry = try manager.manifests.getOrPut(manager.allocator, manifest.pkg.name.hash);
                            entry.value_ptr.* = manifest;

                            if (timestamp_this_tick == null) {
                                timestamp_this_tick = @as(u32, @truncate(@as(u64, @intCast(@max(0, std.time.timestamp()))))) +| 300;
                            }

                            entry.value_ptr.*.pkg.public_max_age = timestamp_this_tick.?;
                            {
                                Npm.PackageManifest.Serializer.save(entry.value_ptr, manager.getTemporaryDirectory(), manager.getCacheDirectory()) catch {};
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
                .extract => |extract| {
                    const response = task.http.response orelse {
                        const err = task.http.err orelse error.TarballFailedToDownload;

                        if (task.retried < manager.options.max_retry_count) {
                            task.retried += 1;
                            if (!has_network_error) {
                                has_network_error = true;
                                const min = manager.options.min_simultaneous_requests;
                                const max = AsyncHTTP.max_simultaneous_requests.load(.Monotonic);
                                if (max > min) {
                                    AsyncHTTP.max_simultaneous_requests.store(@max(min, max / 2), .Monotonic);
                                }
                            }
                            manager.enqueueNetworkTask(task);

                            if (manager.options.log_level.isVerbose()) {
                                manager.log.addWarningFmt(
                                    null,
                                    logger.Loc.Empty,
                                    manager.allocator,
                                    "<r><yellow>warn:<r> {s} downloading tarball <b>{s}@{s}<r>",
                                    .{
                                        bun.span(@errorName(err)),
                                        extract.name.slice(),
                                        extract.resolution.fmt(manager.lockfile.buffers.string_bytes.items),
                                    },
                                ) catch unreachable;
                            }
                        } else if (@TypeOf(callbacks.onPackageDownloadError) != void) {
                            const package_id = manager.lockfile.buffers.resolutions.items[extract.dependency_id];
                            callbacks.onPackageDownloadError(
                                extract_ctx,
                                package_id,
                                extract.name.slice(),
                                extract.resolution,
                                err,
                                task.url_buf,
                            );
                        } else if (comptime log_level != .silent) {
                            const fmt = "\n<r><red>error<r>: {s} downloading tarball <b>{s}@{s}<r>\n";
                            const args = .{
                                bun.span(@errorName(err)),
                                extract.name.slice(),
                                extract.resolution.fmt(manager.lockfile.buffers.string_bytes.items),
                            };
                            if (comptime log_level.showProgress()) {
                                Output.prettyWithPrinterFn(fmt, args, Progress.log, &manager.progress);
                            } else {
                                Output.prettyErrorln(fmt, args);
                                Output.flush();
                            }
                        }

                        continue;
                    };

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
                                extract.resolution,
                                err,
                                task.url_buf,
                            );
                        } else if (comptime log_level != .silent) {
                            const fmt = "\n<r><red><b>GET<r><red> {s}<d> - {d}<r>\n";
                            const args = .{
                                task.http.client.url.href,
                                response.status_code,
                            };

                            if (comptime log_level.showProgress()) {
                                Output.prettyWithPrinterFn(fmt, args, Progress.log, &manager.progress);
                            } else {
                                Output.prettyErrorln(
                                    fmt,
                                    args,
                                );
                                Output.flush();
                            }
                        }

                        continue;
                    }

                    if (comptime log_level.isVerbose()) {
                        Output.prettyError("    ", .{});
                        Output.printElapsed(@as(f64, @floatCast(@as(f64, @floatFromInt(task.http.elapsed)) / std.time.ns_per_ms)));
                        Output.prettyError(" <d>Downloaded <r><green>{s}<r> tarball\n", .{extract.name.slice()});
                        Output.flush();
                    }

                    if (comptime log_level.showProgress()) {
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

        while (manager.resolve_tasks.tryReadItem() catch null) |task_| {
            if (comptime Environment.allow_assert) std.debug.assert(manager.pending_tasks > 0);
            manager.pending_tasks -|= 1;

            var task: Task = task_;
            if (task.log.msgs.items.len > 0) {
                switch (Output.enable_ansi_colors) {
                    inline else => |enable_ansi_colors| {
                        try task.log.printForLogLevelWithEnableAnsiColors(Output.errorWriter(), enable_ansi_colors);
                    },
                }
            }

            switch (task.tag) {
                .package_manifest => {
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
                        } else if (comptime log_level != .silent) {
                            const fmt = "\n<r><red>error<r>: {s} parsing package manifest for <b>{s}<r>";
                            const error_name: string = @errorName(err);

                            const args = .{ error_name, name.slice() };
                            if (comptime log_level.showProgress()) {
                                Output.prettyWithPrinterFn(fmt, args, Progress.log, &manager.progress);
                            } else {
                                Output.prettyErrorln(
                                    fmt,
                                    args,
                                );
                                Output.flush();
                            }
                        }
                        continue;
                    }
                    const manifest = task.data.package_manifest;
                    _ = try manager.manifests.getOrPutValue(manager.allocator, manifest.pkg.name.hash, manifest);

                    const dependency_list_entry = manager.task_queue.getEntry(task.id).?;
                    const dependency_list = dependency_list_entry.value_ptr.*;
                    dependency_list_entry.value_ptr.* = .{};

                    try manager.processDependencyList(dependency_list, ExtractCompletionContext, extract_ctx, callbacks, install_peer);

                    if (comptime log_level.showProgress()) {
                        if (!has_updated_this_run) {
                            manager.setNodeName(manager.downloads_node.?, manifest.name(), ProgressStrings.download_emoji, true);
                            has_updated_this_run = true;
                        }
                    }
                },
                .extract, .local_tarball => {
                    const tarball = switch (task.tag) {
                        .extract => task.request.extract.tarball,
                        .local_tarball => task.request.local_tarball.tarball,
                        else => unreachable,
                    };
                    const dependency_id = tarball.dependency_id;
                    var package_id = manager.lockfile.buffers.resolutions.items[dependency_id];
                    const alias = tarball.name.slice();
                    const resolution = tarball.resolution;

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
                        } else if (comptime log_level != .silent) {
                            const fmt = "<r><red>error<r>: {s} extracting tarball for <b>{s}<r>";
                            const args = .{
                                @errorName(err),
                                alias,
                            };
                            if (comptime log_level.showProgress()) {
                                Output.prettyWithPrinterFn(fmt, args, Progress.log, &manager.progress);
                            } else {
                                Output.prettyErrorln(fmt, args);
                                Output.flush();
                            }
                        }
                        continue;
                    }
                    manager.extracted_count += 1;
                    bun.Analytics.Features.extracted_packages = true;

                    // GitHub and tarball URL dependencies are not fully resolved until after the tarball is downloaded & extracted.
                    if (manager.processExtractedTarballPackage(&package_id, resolution, task.data.extract, comptime log_level)) |pkg| brk: {
                        // In the middle of an install, you could end up needing to downlaod the github tarball for a dependency
                        // We need to make sure we resolve the dependencies first before calling the onExtract callback
                        // TODO: move this into a separate function
                        var any_root = false;
                        var dependency_list_entry = manager.task_queue.getEntry(task.id) orelse break :brk;
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
                                        .github => {
                                            version.value.github.package_name = pkg.name;
                                        },
                                        .tarball => {
                                            version.value.tarball.package_name = pkg.name;
                                        },
                                        else => unreachable,
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

                    if (comptime @TypeOf(callbacks.onExtract) != void) {
                        if (ExtractCompletionContext == *PackageInstaller) {
                            extract_ctx.fixCachedLockfilePackageSlices();
                        }
                        callbacks.onExtract(extract_ctx, dependency_id, task.data.extract, comptime log_level);
                    }

                    if (comptime log_level.showProgress()) {
                        if (!has_updated_this_run) {
                            manager.setNodeName(manager.downloads_node.?, alias, ProgressStrings.extract_emoji, true);
                            has_updated_this_run = true;
                        }
                    }
                },
                .git_clone => {
                    const name = task.request.git_clone.name;

                    if (task.status == .fail) {
                        const err = task.err orelse error.Failed;

                        if (@TypeOf(callbacks.onPackageManifestError) != void) {
                            callbacks.onPackageManifestError(
                                extract_ctx,
                                name.slice(),
                                err,
                                task.request.git_clone.url.slice(),
                            );
                        } else if (comptime log_level != .silent) {
                            const fmt = "\n<r><red>error<r>: {s} cloning repository for <b>{s}<r>";
                            const error_name = @errorName(err);

                            const args = .{ error_name, name.slice() };
                            if (comptime log_level.showProgress()) {
                                Output.prettyWithPrinterFn(fmt, args, Progress.log, &manager.progress);
                            } else {
                                Output.prettyErrorln(
                                    fmt,
                                    args,
                                );
                                Output.flush();
                            }
                        }
                        continue;
                    }

                    const dependency_list_entry = manager.task_queue.getEntry(task.id).?;
                    const dependency_list = dependency_list_entry.value_ptr.*;
                    dependency_list_entry.value_ptr.* = .{};

                    try manager.processDependencyList(dependency_list, ExtractCompletionContext, extract_ctx, callbacks, install_peer);

                    if (comptime log_level.showProgress()) {
                        if (!has_updated_this_run) {
                            manager.setNodeName(manager.downloads_node.?, name.slice(), ProgressStrings.download_emoji, true);
                            has_updated_this_run = true;
                        }
                    }
                },
                .git_checkout => {
                    const alias = task.request.git_checkout.name;
                    var package_id: PackageID = invalid_package_id;

                    if (task.status == .fail) {
                        const err = task.err orelse error.Failed;

                        if (comptime log_level != .silent) {
                            const fmt = "\n<r><red>error<r>: {s} checking out repository for <b>{s}<r>";
                            const error_name = @errorName(err);

                            const args = .{ error_name, alias.slice() };
                            if (comptime log_level.showProgress()) {
                                Output.prettyWithPrinterFn(fmt, args, Progress.log, &manager.progress);
                            } else {
                                Output.prettyErrorln(
                                    fmt,
                                    args,
                                );
                                Output.flush();
                            }
                        }
                        continue;
                    }

                    if (manager.processExtractedTarballPackage(
                        &package_id,
                        task.request.git_checkout.resolution,
                        task.data.git_checkout,
                        comptime log_level,
                    )) |pkg| brk: {
                        var any_root = false;
                        var dependency_list_entry = manager.task_queue.getEntry(task.id) orelse break :brk;
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
                    }

                    if (comptime @TypeOf(callbacks.onExtract) != void) {
                        if (ExtractCompletionContext == *PackageInstaller) {
                            extract_ctx.fixCachedLockfilePackageSlices();
                        }
                        callbacks.onExtract(
                            extract_ctx,
                            task.request.git_checkout.dependency_id,
                            task.data.git_checkout,
                            comptime log_level,
                        );
                    }

                    if (comptime log_level.showProgress()) {
                        if (!has_updated_this_run) {
                            manager.setNodeName(manager.downloads_node.?, alias.slice(), ProgressStrings.download_emoji, true);
                            has_updated_this_run = true;
                        }
                    }
                },
            }
        }

        manager.drainDependencyList();

        if (comptime log_level.showProgress()) {
            if (@hasField(@TypeOf(callbacks), "progress_bar") and callbacks.progress_bar == true) {
                const completed_items = manager.total_tasks - manager.pending_tasks;
                if (completed_items != manager.downloads_node.?.unprotected_completed_items or has_updated_this_run) {
                    manager.downloads_node.?.setCompletedItems(completed_items);
                    manager.downloads_node.?.setEstimatedTotalItems(manager.total_tasks);
                }
            }
            manager.downloads_node.?.activate();
            manager.progress.maybeRefresh();
        }
    }

    pub const Options = struct {
        log_level: LogLevel = .default,
        global: bool = false,

        global_bin_dir: std.fs.Dir = bun.invalid_fd.asDir(),
        explicit_global_directory: string = "",
        /// destination directory to link bins into
        // must be a variable due to global installs and bunx
        bin_path: stringZ = bun.pathLiteral("node_modules/.bin"),

        lockfile_path: stringZ = Lockfile.default_filename,
        did_override_default_scope: bool = false,
        scope: Npm.Registry.Scope = undefined,

        registries: Npm.Registry.Map = .{},
        cache_directory: string = "",
        enable: Enable = .{},
        do: Do = .{},
        positionals: []const string = &[_]string{},
        update: Update = .{},
        dry_run: bool = false,
        remote_package_features: Features = .{
            .optional_dependencies = true,
        },
        local_package_features: Features = .{
            .dev_dependencies = true,
            .workspaces = true,
        },
        // The idea here is:
        // 1. package has a platform-specific binary to install
        // 2. To prevent downloading & installing incompatible versions, they stick the "real" one in optionalDependencies
        // 3. The real one we want to link is in another package
        // 4. Therefore, we remap the "bin" specified in the real package
        //    to the target package which is the one which is:
        //      1. In optionalDependencies
        //      2. Has a platform and/or os specified, which evaluates to not disabled
        native_bin_link_allowlist: []const PackageNameHash = &default_native_bin_link_allowlist,
        max_retry_count: u16 = 5,
        min_simultaneous_requests: usize = 4,

        max_concurrent_lifecycle_scripts: usize,

        pub fn shouldPrintCommandName(this: *const Options) bool {
            return this.log_level != .silent and this.do.summary;
        }

        pub fn isBinPathInPATH(this: *const Options) bool {
            // must be absolute
            if (this.bin_path[0] != std.fs.path.sep) return false;
            var tokenizer = std.mem.split(bun.getenvZ("PATH") orelse "", ":");
            const spanned = bun.span(this.bin_path);
            while (tokenizer.next()) |token| {
                if (strings.eql(token, spanned)) return true;
            }
            return false;
        }

        const default_native_bin_link_allowlist = [_]PackageNameHash{
            String.Builder.stringHash("esbuild"),
            String.Builder.stringHash("turbo"),
            String.Builder.stringHash("bun"),
            String.Builder.stringHash("rome"),
            String.Builder.stringHash("zig"),
            String.Builder.stringHash("@oven-sh/zig"),
        };

        pub const LogLevel = enum {
            default,
            verbose,
            silent,
            default_no_progress,
            verbose_no_progress,

            pub inline fn isVerbose(this: LogLevel) bool {
                return switch (this) {
                    .verbose_no_progress, .verbose => true,
                    else => false,
                };
            }
            pub inline fn showProgress(this: LogLevel) bool {
                return switch (this) {
                    .default, .verbose => true,
                    else => false,
                };
            }
        };

        pub const Update = struct {
            development: bool = false,
            optional: bool = false,
        };

        pub fn openGlobalDir(explicit_global_dir: string) !std.fs.Dir {
            if (bun.getenvZ("BUN_INSTALL_GLOBAL_DIR")) |home_dir| {
                return try std.fs.cwd().makeOpenPath(home_dir, .{});
            }

            if (explicit_global_dir.len > 0) {
                return try std.fs.cwd().makeOpenPath(explicit_global_dir, .{});
            }

            if (bun.getenvZ("BUN_INSTALL")) |home_dir| {
                var buf: [bun.MAX_PATH_BYTES]u8 = undefined;
                var parts = [_]string{ "install", "global" };
                const path = Path.joinAbsStringBuf(home_dir, &buf, &parts, .auto);
                return try std.fs.cwd().makeOpenPath(path, .{});
            }

            if (!Environment.isWindows) {
                if (bun.getenvZ("XDG_CACHE_HOME") orelse bun.getenvZ("HOME")) |home_dir| {
                    var buf: [bun.MAX_PATH_BYTES]u8 = undefined;
                    var parts = [_]string{ ".bun", "install", "global" };
                    const path = Path.joinAbsStringBuf(home_dir, &buf, &parts, .auto);
                    return try std.fs.cwd().makeOpenPath(path, .{});
                }
            } else {
                if (bun.getenvZ("USERPROFILE")) |home_dir| {
                    var buf: [bun.MAX_PATH_BYTES]u8 = undefined;
                    var parts = [_]string{ ".bun", "install", "global" };
                    const path = Path.joinAbsStringBuf(home_dir, &buf, &parts, .auto);
                    return try std.fs.cwd().makeOpenPath(path, .{});
                }
            }

            return error.@"No global directory found";
        }

        pub fn openGlobalBinDir(opts_: ?*const Api.BunInstall) !std.fs.Dir {
            if (bun.getenvZ("BUN_INSTALL_BIN")) |home_dir| {
                return try std.fs.cwd().makeOpenPath(home_dir, .{});
            }

            if (opts_) |opts| {
                if (opts.global_bin_dir) |home_dir| {
                    if (home_dir.len > 0) {
                        return try std.fs.cwd().makeOpenPath(home_dir, .{});
                    }
                }
            }

            if (bun.getenvZ("BUN_INSTALL")) |home_dir| {
                var buf: [bun.MAX_PATH_BYTES]u8 = undefined;
                var parts = [_]string{
                    "bin",
                };
                const path = Path.joinAbsStringBuf(home_dir, &buf, &parts, .auto);
                return try std.fs.cwd().makeOpenPath(path, .{});
            }

            if (bun.getenvZ("XDG_CACHE_HOME") orelse bun.getenvZ(bun.DotEnv.home_env)) |home_dir| {
                var buf: [bun.MAX_PATH_BYTES]u8 = undefined;
                var parts = [_]string{
                    ".bun",
                    "bin",
                };
                const path = Path.joinAbsStringBuf(home_dir, &buf, &parts, .auto);
                return try std.fs.cwd().makeOpenPath(path, .{});
            }

            return error.@"Missing global bin directory: try setting $BUN_INSTALL";
        }

        pub fn load(
            this: *Options,
            allocator: std.mem.Allocator,
            log: *logger.Log,
            env: *DotEnv.Loader,
            cli_: ?CommandLineArguments,
            bun_install_: ?*Api.BunInstall,
            subcommand: Subcommand,
        ) !void {
            var base = Api.NpmRegistry{
                .url = "",
                .username = "",
                .password = "",
                .token = "",
            };
            if (bun_install_) |bun_install| {
                if (bun_install.default_registry) |registry| {
                    base = registry;
                }
            }
            if (base.url.len == 0) base.url = Npm.Registry.default_url;
            this.scope = try Npm.Registry.Scope.fromAPI("", base, allocator, env);
            defer {
                this.did_override_default_scope = !strings.eqlComptime(this.scope.url.href, Npm.Registry.default_url);
            }
            if (bun_install_) |bun_install| {
                if (bun_install.scoped) |scoped| {
                    for (scoped.scopes, 0..) |name, i| {
                        var registry = scoped.registries[i];
                        if (registry.url.len == 0) registry.url = base.url;
                        try this.registries.put(allocator, Npm.Registry.Scope.hash(name), try Npm.Registry.Scope.fromAPI(name, registry, allocator, env));
                    }
                }

                if (bun_install.disable_cache orelse false) {
                    this.enable.cache = false;
                }

                if (bun_install.disable_manifest_cache orelse false) {
                    this.enable.manifest_cache = false;
                }

                if (bun_install.force orelse false) {
                    this.enable.manifest_cache_control = false;
                    this.enable.force_install = true;
                }

                if (bun_install.native_bin_links.len > 0) {
                    var buf = try allocator.alloc(u64, bun_install.native_bin_links.len);
                    for (bun_install.native_bin_links, 0..) |name, i| {
                        buf[i] = String.Builder.stringHash(name);
                    }
                    this.native_bin_link_allowlist = buf;
                }

                if (bun_install.save_yarn_lockfile orelse false) {
                    this.do.save_yarn_lock = true;
                }

                if (bun_install.save_lockfile) |save_lockfile| {
                    this.do.save_lockfile = save_lockfile;
                    this.enable.force_save_lockfile = true;
                }

                if (bun_install.save_dev) |save| {
                    this.local_package_features.dev_dependencies = save;
                }

                if (bun_install.save_peer) |save| {
                    this.do.install_peer_dependencies = save;
                    this.remote_package_features.peer_dependencies = save;
                }

                if (bun_install.exact) |exact| {
                    this.enable.exact_versions = exact;
                }

                if (bun_install.production) |production| {
                    if (production) {
                        this.local_package_features.dev_dependencies = false;
                        this.enable.fail_early = true;
                        this.enable.frozen_lockfile = true;
                        this.enable.force_save_lockfile = false;
                    }
                }

                if (bun_install.frozen_lockfile) |frozen_lockfile| {
                    if (frozen_lockfile) {
                        this.enable.frozen_lockfile = true;
                    }
                }

                if (bun_install.concurrent_scripts) |jobs| {
                    this.max_concurrent_lifecycle_scripts = jobs;
                }

                if (bun_install.save_optional) |save| {
                    this.remote_package_features.optional_dependencies = save;
                    this.local_package_features.optional_dependencies = save;
                }

                this.explicit_global_directory = bun_install.global_dir orelse this.explicit_global_directory;
            }

            const default_disable_progress_bar: bool = brk: {
                if (env.get("BUN_INSTALL_PROGRESS")) |prog| {
                    break :brk strings.eqlComptime(prog, "0");
                }

                if (env.isCI()) {
                    break :brk true;
                }

                break :brk Output.stderr_descriptor_type != .terminal;
            };

            // technically, npm_config is case in-sensitive
            // load_registry:
            {
                const registry_keys = [_]string{
                    "BUN_CONFIG_REGISTRY",
                    "NPM_CONFIG_REGISTRY",
                    "npm_config_registry",
                };
                var did_set = false;

                inline for (registry_keys) |registry_key| {
                    if (!did_set) {
                        if (env.map.get(registry_key)) |registry_| {
                            if (registry_.len > 0 and
                                (strings.startsWith(registry_, "https://") or
                                strings.startsWith(registry_, "http://")))
                            {
                                const prev_scope = this.scope;
                                var api_registry = std.mem.zeroes(Api.NpmRegistry);
                                api_registry.url = registry_;
                                api_registry.token = prev_scope.token;
                                this.scope = try Npm.Registry.Scope.fromAPI("", api_registry, allocator, env);
                                did_set = true;
                            }
                        }
                    }
                }
            }

            {
                const token_keys = [_]string{
                    "BUN_CONFIG_TOKEN",
                    "NPM_CONFIG_token",
                    "npm_config_token",
                };
                var did_set = false;

                inline for (token_keys) |registry_key| {
                    if (!did_set) {
                        if (env.map.get(registry_key)) |registry_| {
                            if (registry_.len > 0) {
                                this.scope.token = registry_;
                                did_set = true;
                                // stage1 bug: break inside inline is broken
                                // break :load_registry;
                            }
                        }
                    }
                }
            }

            if (cli_) |cli| {
                if (cli.registry.len > 0 and strings.startsWith(cli.registry, "https://") or
                    strings.startsWith(cli.registry, "http://"))
                {
                    this.scope.url = URL.parse(cli.registry);
                }

                if (cli.exact) {
                    this.enable.exact_versions = true;
                }

                if (cli.token.len > 0) {
                    this.scope.token = cli.token;
                }
            }

            if (env.map.get("BUN_CONFIG_YARN_LOCKFILE") != null) {
                this.do.save_yarn_lock = true;
            }

            if (env.map.get("BUN_CONFIG_HTTP_RETRY_COUNT")) |retry_count| {
                if (std.fmt.parseInt(u16, retry_count, 10)) |int| this.max_retry_count = int else |_| {}
            }

            if (env.map.get("BUN_CONFIG_LINK_NATIVE_BINS")) |native_packages| {
                const len = std.mem.count(u8, native_packages, " ");
                if (len > 0) {
                    var all = try allocator.alloc(PackageNameHash, this.native_bin_link_allowlist.len + len);
                    bun.copy(PackageNameHash, all, this.native_bin_link_allowlist);
                    var remain = all[this.native_bin_link_allowlist.len..];
                    var splitter = std.mem.split(u8, native_packages, " ");
                    var i: usize = 0;
                    while (splitter.next()) |name| {
                        remain[i] = String.Builder.stringHash(name);
                        i += 1;
                    }
                    this.native_bin_link_allowlist = all;
                }
            }

            // if (env.map.get("BUN_CONFIG_NO_DEDUPLICATE") != null) {
            //     this.enable.deduplicate_packages = false;
            // }

            AsyncHTTP.loadEnv(allocator, log, env);

            if (env.map.get("BUN_CONFIG_SKIP_SAVE_LOCKFILE")) |check_bool| {
                this.do.save_lockfile = strings.eqlComptime(check_bool, "0");
            }

            if (env.map.get("BUN_CONFIG_SKIP_LOAD_LOCKFILE")) |check_bool| {
                this.do.load_lockfile = strings.eqlComptime(check_bool, "0");
            }

            if (env.map.get("BUN_CONFIG_SKIP_INSTALL_PACKAGES")) |check_bool| {
                this.do.install_packages = strings.eqlComptime(check_bool, "0");
            }

            if (env.map.get("BUN_CONFIG_NO_VERIFY")) |check_bool| {
                this.do.verify_integrity = !strings.eqlComptime(check_bool, "0");
            }

            // Update should never read from manifest cache
            if (subcommand == .update) {
                this.enable.manifest_cache = false;
                this.enable.manifest_cache_control = false;
            }

            if (cli_) |cli| {
                if (cli.no_save) {
                    this.do.save_lockfile = false;
                    this.do.write_package_json = false;
                }

                if (cli.dry_run) {
                    this.do.install_packages = false;
                    this.dry_run = true;
                    this.do.write_package_json = false;
                    this.do.save_lockfile = false;
                }

                if (cli.no_summary) {
                    this.do.summary = false;
                }

                if (cli.no_cache) {
                    this.enable.manifest_cache = false;
                    this.enable.manifest_cache_control = false;
                }

                // if (cli.no_dedupe) {
                //     this.enable.deduplicate_packages = false;
                // }

                if (cli.omit.dev) {
                    this.local_package_features.dev_dependencies = false;
                }

                if (cli.global or cli.ignore_scripts) {
                    this.do.run_scripts = false;
                }

                this.local_package_features.optional_dependencies = !cli.omit.optional;

                const disable_progress_bar = default_disable_progress_bar or cli.no_progress;

                if (cli.verbose) {
                    this.log_level = if (disable_progress_bar) LogLevel.verbose_no_progress else LogLevel.verbose;
                    PackageManager.verbose_install = true;
                } else if (cli.silent) {
                    this.log_level = .silent;
                    PackageManager.verbose_install = false;
                } else {
                    this.log_level = if (disable_progress_bar) LogLevel.default_no_progress else LogLevel.default;
                    PackageManager.verbose_install = false;
                }

                if (cli.no_verify) {
                    this.do.verify_integrity = false;
                }

                if (cli.yarn) {
                    this.do.save_yarn_lock = true;
                }

                if (cli.link_native_bins.len > 0) {
                    var all = try allocator.alloc(PackageNameHash, this.native_bin_link_allowlist.len + cli.link_native_bins.len);
                    bun.copy(PackageNameHash, all, this.native_bin_link_allowlist);
                    var remain = all[this.native_bin_link_allowlist.len..];
                    for (cli.link_native_bins, 0..) |name, i| {
                        remain[i] = String.Builder.stringHash(name);
                    }
                    this.native_bin_link_allowlist = all;
                }

                if (cli.backend) |backend| {
                    PackageInstall.supported_method = backend;
                }

                if (cli.positionals.len > 0) {
                    this.positionals = cli.positionals;
                }

                if (cli.production) {
                    this.local_package_features.dev_dependencies = false;
                    this.enable.fail_early = true;
                    this.enable.frozen_lockfile = true;
                }

                if (cli.frozen_lockfile) {
                    this.enable.frozen_lockfile = true;
                }

                if (cli.force) {
                    this.enable.manifest_cache_control = false;
                    this.enable.force_install = true;
                    this.enable.force_save_lockfile = true;
                }

                this.update.development = cli.development;
                if (!this.update.development) this.update.optional = cli.optional;
            } else {
                this.log_level = if (default_disable_progress_bar) LogLevel.default_no_progress else LogLevel.default;
                PackageManager.verbose_install = false;
            }
        }

        pub const Do = struct {
            save_lockfile: bool = true,
            load_lockfile: bool = true,
            install_packages: bool = true,
            write_package_json: bool = true,
            run_scripts: bool = true,
            save_yarn_lock: bool = false,
            print_meta_hash_string: bool = false,
            verify_integrity: bool = true,
            summary: bool = true,
            install_peer_dependencies: bool = true,
        };

        pub const Enable = struct {
            manifest_cache: bool = true,
            manifest_cache_control: bool = true,
            cache: bool = true,
            fail_early: bool = false,
            frozen_lockfile: bool = false,

            /// Disabled because it doesn't actually reduce the number of packages we end up installing
            /// Probably need to be a little smarter
            deduplicate_packages: bool = false,

            // Don't save the lockfile unless there were actual changes
            // unless...
            force_save_lockfile: bool = false,

            force_install: bool = false,

            exact_versions: bool = false,
        };
    };

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

    const PackageJSONEditor = struct {
        pub fn edit(
            allocator: std.mem.Allocator,
            updates: []UpdateRequest,
            current_package_json: *JSAst.Expr,
            dependency_list: string,
            exact_versions: bool,
        ) !void {
            const G = JSAst.G;

            var remaining = updates.len;
            var replacing: usize = 0;

            // There are three possible scenarios here
            // 1. There is no "dependencies" (or equivalent list) or it is empty
            // 2. There is a "dependencies" (or equivalent list), but the package name already exists in a separate list
            // 3. There is a "dependencies" (or equivalent list), and the package name exists in multiple lists
            ast_modifier: {
                // Try to use the existing spot in the dependencies list if possible
                for (updates) |*request| {
                    inline for ([_]string{ "dependencies", "devDependencies", "optionalDependencies" }) |list| {
                        if (current_package_json.asProperty(list)) |query| {
                            if (query.expr.data == .e_object) {
                                if (query.expr.asProperty(
                                    if (request.is_aliased)
                                        request.name
                                    else
                                        request.version.literal.slice(request.version_buf),
                                )) |value| {
                                    if (value.expr.data == .e_string) {
                                        if (!request.resolved_name.isEmpty() and strings.eql(list, dependency_list)) {
                                            replacing += 1;
                                        } else {
                                            request.e_string = value.expr.data.e_string;
                                            remaining -= 1;
                                        }
                                    }
                                    break;
                                } else {
                                    if (request.version.tag == .github or request.version.tag == .git) {
                                        for (query.expr.data.e_object.properties.slice()) |item| {
                                            if (item.value) |v| {
                                                const url = request.version.literal.slice(request.version_buf);
                                                if (v.data == .e_string and v.data.e_string.eql(string, url)) {
                                                    request.e_string = v.data.e_string;
                                                    remaining -= 1;
                                                    break;
                                                }
                                            }
                                        }
                                    }
                                }
                            }
                        }
                    }
                }

                if (remaining == 0)
                    break :ast_modifier;

                var dependencies: []G.Property = &[_]G.Property{};
                if (current_package_json.asProperty(dependency_list)) |query| {
                    if (query.expr.data == .e_object) {
                        dependencies = query.expr.data.e_object.properties.slice();
                    }
                }

                var new_dependencies = try allocator.alloc(G.Property, dependencies.len + remaining - replacing);
                bun.copy(G.Property, new_dependencies, dependencies);
                @memset(new_dependencies[dependencies.len..], G.Property{});

                outer: for (updates) |*request| {
                    if (request.e_string != null) continue;
                    defer if (comptime Environment.allow_assert) std.debug.assert(request.e_string != null);

                    var k: usize = 0;
                    while (k < new_dependencies.len) : (k += 1) {
                        if (new_dependencies[k].key) |key| {
                            if (!request.is_aliased and !request.resolved_name.isEmpty() and key.data.e_string.eql(
                                string,
                                request.resolved_name.slice(request.version_buf),
                            )) {
                                // This actually is a duplicate which we did not
                                // pick up before dependency resolution.
                                // For this case, we'll just swap remove it.
                                if (new_dependencies.len > 1) {
                                    new_dependencies[k] = new_dependencies[new_dependencies.len - 1];
                                    new_dependencies = new_dependencies[0 .. new_dependencies.len - 1];
                                } else {
                                    new_dependencies = &[_]G.Property{};
                                }
                                continue;
                            }
                            if (key.data.e_string.eql(
                                string,
                                if (request.is_aliased)
                                    request.name
                                else
                                    request.version.literal.slice(request.version_buf),
                            )) {
                                if (request.resolved_name.isEmpty()) {
                                    // This actually is a duplicate like "react"
                                    // appearing in both "dependencies" and "optionalDependencies".
                                    // For this case, we'll just swap remove it
                                    if (new_dependencies.len > 1) {
                                        new_dependencies[k] = new_dependencies[new_dependencies.len - 1];
                                        new_dependencies = new_dependencies[0 .. new_dependencies.len - 1];
                                    } else {
                                        new_dependencies = &[_]G.Property{};
                                    }
                                    continue;
                                }
                                new_dependencies[k].key = null;
                            }
                        }

                        if (new_dependencies[k].key == null) {
                            new_dependencies[k].key = try JSAst.Expr.init(
                                JSAst.E.String,
                                JSAst.E.String{
                                    .data = try allocator.dupe(u8, if (request.is_aliased)
                                        request.name
                                    else if (request.resolved_name.isEmpty())
                                        request.version.literal.slice(request.version_buf)
                                    else
                                        request.resolved_name.slice(request.version_buf)),
                                },
                                logger.Loc.Empty,
                            ).clone(allocator);

                            new_dependencies[k].value = try JSAst.Expr.init(
                                JSAst.E.String,
                                JSAst.E.String{
                                    // we set it later
                                    .data = "",
                                },
                                logger.Loc.Empty,
                            ).clone(allocator);
                            request.e_string = new_dependencies[k].value.?.data.e_string;
                            if (request.is_aliased) continue :outer;
                        }
                    }
                }

                var needs_new_dependency_list = true;
                const dependencies_object: JSAst.Expr = brk: {
                    if (current_package_json.asProperty(dependency_list)) |query| {
                        if (query.expr.data == .e_object) {
                            needs_new_dependency_list = false;

                            break :brk query.expr;
                        }
                    }

                    break :brk JSAst.Expr.init(
                        JSAst.E.Object,
                        JSAst.E.Object{
                            .properties = JSAst.G.Property.List.init(new_dependencies),
                        },
                        logger.Loc.Empty,
                    );
                };

                dependencies_object.data.e_object.properties = JSAst.G.Property.List.init(new_dependencies);
                if (new_dependencies.len > 1)
                    dependencies_object.data.e_object.alphabetizeProperties();

                if (current_package_json.data != .e_object or current_package_json.data.e_object.properties.len == 0) {
                    var root_properties = try allocator.alloc(JSAst.G.Property, 1);
                    root_properties[0] = JSAst.G.Property{
                        .key = JSAst.Expr.init(
                            JSAst.E.String,
                            JSAst.E.String{
                                .data = dependency_list,
                            },
                            logger.Loc.Empty,
                        ),
                        .value = dependencies_object,
                    };
                    current_package_json.* = JSAst.Expr.init(JSAst.E.Object, JSAst.E.Object{ .properties = JSAst.G.Property.List.init(root_properties) }, logger.Loc.Empty);
                } else if (needs_new_dependency_list) {
                    var root_properties = try allocator.alloc(JSAst.G.Property, current_package_json.data.e_object.properties.len + 1);
                    bun.copy(JSAst.G.Property, root_properties, current_package_json.data.e_object.properties.slice());
                    root_properties[root_properties.len - 1] = .{
                        .key = JSAst.Expr.init(
                            JSAst.E.String,
                            JSAst.E.String{
                                .data = dependency_list,
                            },
                            logger.Loc.Empty,
                        ),
                        .value = dependencies_object,
                    };
                    current_package_json.* = JSAst.Expr.init(
                        JSAst.E.Object,
                        JSAst.E.Object{
                            .properties = JSAst.G.Property.List.init(root_properties),
                        },
                        logger.Loc.Empty,
                    );
                }
            }

            for (updates) |*request| {
                if (request.e_string) |e_string| {
                    e_string.data = switch (request.resolution.tag) {
                        .npm => if (request.version.tag == .dist_tag and request.version.literal.isEmpty())
                            switch (exact_versions) {
                                false => std.fmt.allocPrint(allocator, "^{}", .{
                                    request.resolution.value.npm.version.fmt(request.version_buf),
                                }) catch unreachable,
                                true => std.fmt.allocPrint(allocator, "{}", .{
                                    request.resolution.value.npm.version.fmt(request.version_buf),
                                }) catch unreachable,
                            }
                        else
                            null,
                        .uninitialized => switch (request.version.tag) {
                            .uninitialized => try allocator.dupe(u8, latest),
                            else => null,
                        },
                        else => null,
                    } orelse try allocator.dupe(u8, request.version.literal.slice(request.version_buf));
                }
            }
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
    };

    pub fn init(ctx: Command.Context, comptime subcommand: Subcommand) !*PackageManager {
        const cli = try CommandLineArguments.parse(ctx.allocator, subcommand);

        var _ctx = ctx;
        return initWithCLI(&_ctx, cli, subcommand);
    }

    fn initWithCLI(
        ctx: *Command.Context,
        cli: CommandLineArguments,
        comptime subcommand: Subcommand,
    ) !*PackageManager {
        // assume that spawning a thread will take a lil so we do that asap
        try HTTP.HTTPThread.init();

        if (cli.global) {
            var explicit_global_dir: string = "";
            if (ctx.install) |opts| {
                explicit_global_dir = opts.global_dir orelse explicit_global_dir;
            }
            var global_dir = try Options.openGlobalDir(explicit_global_dir);
            try global_dir.setAsCwd();
        }

        var fs = try Fs.FileSystem.init(null);
        const original_cwd = strings.withoutTrailingSlash(fs.top_level_dir);

        bun.copy(u8, &cwd_buf, original_cwd);

        var workspace_names = Package.WorkspaceMap.init(ctx.allocator);

        // Step 1. Find the nearest package.json directory
        //
        // We will walk up from the cwd, trying to find the nearest package.json file.
        const package_json_file = brk: {
            var this_cwd = original_cwd;
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
                    const this_cwd_without_trailing_slash = strings.withoutTrailingSlash(this_cwd);
                    var buf2: [bun.MAX_PATH_BYTES + 1]u8 = undefined;
                    @memcpy(buf2[0..this_cwd_without_trailing_slash.len], this_cwd_without_trailing_slash);
                    buf2[this_cwd_without_trailing_slash.len..buf2.len][0.."/package.json".len].* = "/package.json".*;
                    buf2[this_cwd_without_trailing_slash.len + "/package.json".len] = 0;

                    break :child std.fs.cwd().openFileZ(
                        buf2[0 .. this_cwd_without_trailing_slash.len + "/package.json".len :0].ptr,
                        .{ .mode = if (need_write) .read_write else .read_only },
                    ) catch |err| switch (err) {
                        error.FileNotFound => {
                            if (std.fs.path.dirname(this_cwd)) |parent| {
                                this_cwd = parent;
                                continue;
                            } else {
                                break;
                            }
                        },
                        error.AccessDenied => {
                            Output.err("EACCES", "Permission denied while opening \"{s}\"", .{
                                buf2[0 .. this_cwd_without_trailing_slash.len + "/package.json".len],
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
                                buf2[0 .. this_cwd_without_trailing_slash.len + "/package.json".len],
                            });
                            return err;
                        },
                    };
                }

                if (comptime subcommand == .install) {
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

            const child_cwd = this_cwd;
            // Check if this is a workspace; if so, use root package
            var found = false;
            if (comptime subcommand != .link) {
                if (!created_package_json) {
                    while (std.fs.path.dirname(this_cwd)) |parent| : (this_cwd = parent) {
                        const parent_without_trailing_slash = strings.withoutTrailingSlash(parent);
                        var buf2: [bun.MAX_PATH_BYTES + 1]u8 = undefined;
                        @memcpy(buf2[0..parent_without_trailing_slash.len], parent_without_trailing_slash);
                        buf2[parent_without_trailing_slash.len..buf2.len][0.."/package.json".len].* = "/package.json".*;
                        buf2[parent_without_trailing_slash.len + "/package.json".len] = 0;

                        const json_file = std.fs.cwd().openFileZ(
                            buf2[0 .. parent_without_trailing_slash.len + "/package.json".len :0].ptr,
                            .{ .mode = .read_write },
                        ) catch {
                            continue;
                        };
                        defer if (!found) json_file.close();
                        const json_stat_size = try json_file.getEndPos();
                        const json_buf = try ctx.allocator.alloc(u8, json_stat_size + 64);
                        defer ctx.allocator.free(json_buf);
                        const json_len = try json_file.preadAll(json_buf, 0);
                        const json_path = try bun.getFdPath(json_file.handle, &package_json_cwd_buf);
                        const json_source = logger.Source.initPathString(json_path, json_buf[0..json_len]);
                        initializeStore();
                        const json = try json_parser.ParseJSONUTF8(&json_source, ctx.log, ctx.allocator);
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
                            const workspace_packages_count = Package.processWorkspaceNamesArray(
                                &workspace_names,
                                ctx.allocator,
                                &log,
                                json_array,
                                &json_source,
                                prop.loc,
                                null,
                            ) catch break;
                            _ = workspace_packages_count;
                            for (workspace_names.keys()) |path| {
                                if (strings.eql(child_cwd, path)) {
                                    fs.top_level_dir = parent;
                                    if (comptime subcommand == .install) {
                                        found = true;
                                        child_json.close();
                                        try json_file.seekTo(0);
                                        break :brk json_file;
                                    } else {
                                        break :brk child_json;
                                    }
                                }
                            }
                            break;
                        }
                    }
                }
            }

            fs.top_level_dir = child_cwd;
            break :brk child_json;
        };

        try bun.sys.chdir(fs.top_level_dir).unwrap();
        try BunArguments.loadConfig(ctx.allocator, cli.config, ctx, .InstallCommand);
        bun.copy(u8, &cwd_buf, fs.top_level_dir);
        cwd_buf[fs.top_level_dir.len] = '/';
        cwd_buf[fs.top_level_dir.len + 1] = 0;
        fs.top_level_dir = cwd_buf[0 .. fs.top_level_dir.len + 1];
        package_json_cwd = try bun.getFdPath(package_json_file.handle, &package_json_cwd_buf);

        const entries_option = try fs.fs.readDirectory(fs.top_level_dir, null, 0, true);

        var env: *DotEnv.Loader = brk: {
            const map = try ctx.allocator.create(DotEnv.Map);
            map.* = DotEnv.Map.init(ctx.allocator);

            const loader = try ctx.allocator.create(DotEnv.Loader);
            loader.* = DotEnv.Loader.init(map, ctx.allocator);
            break :brk loader;
        };

        env.loadProcess();
        try env.load(entries_option.entries, &[_][]u8{}, .production);

        var cpu_count = @as(u32, @truncate(((try std.Thread.getCpuCount()) + 1)));

        if (env.map.get("GOMAXPROCS")) |max_procs| {
            if (std.fmt.parseInt(u32, max_procs, 10)) |cpu_count_| {
                cpu_count = @min(cpu_count, cpu_count_);
            } else |_| {}
        }

        const options = Options{
            .global = cli.global,
            .max_concurrent_lifecycle_scripts = cli.concurrent_scripts orelse cpu_count * 2,
        };

        if (env.map.get("BUN_INSTALL_VERBOSE") != null) {
            PackageManager.verbose_install = true;
        }

        if (env.map.get("BUN_FEATURE_FLAG_FORCE_WAITER_THREAD") != null) {
            JSC.Subprocess.WaiterThread.setShouldUseWaiterThread();
        }

        if (PackageManager.verbose_install) {
            Output.prettyErrorln("Cache Dir: {s}", .{options.cache_directory});
            Output.flush();
        }

        var workspaces = std.StringArrayHashMap(Semver.Version).init(ctx.allocator);
        for (workspace_names.values()) |entry| {
            if (entry.version) |version_string| {
                const sliced_version = SlicedString.init(version_string, version_string);
                const result = Semver.Version.parse(sliced_version);
                if (result.valid and result.wildcard == .none) {
                    try workspaces.put(entry.name, result.version.min());
                    continue;
                }
            }
        }

        workspace_names.map.deinit();

        var manager = &instance;
        // var progress = Progress{};
        // var node = progress.start(name: []const u8, estimated_total_items: usize)
        manager.* = PackageManager{
            .options = options,
            .network_task_fifo = NetworkQueue.init(),
            .allocator = ctx.allocator,
            .log = ctx.log,
            .root_dir = entries_option.entries,
            .env = env,
            .cpu_count = cpu_count,
            .thread_pool = ThreadPool.init(.{
                .max_threads = cpu_count,
            }),
            .resolve_tasks = TaskChannel.init(),
            .lockfile = undefined,
            .root_package_json_file = package_json_file,
            .workspaces = workspaces,
            // .progress
            .uws_event_loop = uws.Loop.get(),
            .file_poll_store = bun.Async.FilePoll.Store.init(ctx.allocator),
        };
        manager.lockfile = try ctx.allocator.create(Lockfile);

        if (!manager.options.enable.cache) {
            manager.options.enable.manifest_cache = false;
            manager.options.enable.manifest_cache_control = false;
        }

        if (env.map.get("BUN_MANIFEST_CACHE")) |manifest_cache| {
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

        manager.timestamp_for_manifest_cache_control = brk: {
            if (comptime bun.Environment.allow_assert) {
                if (env.map.get("BUN_CONFIG_MANIFEST_CACHE_CONTROL_TIMESTAMP")) |cache_control| {
                    if (std.fmt.parseInt(u32, cache_control, 10)) |int| {
                        break :brk int;
                    } else |_| {}
                }
            }

            break :brk @as(u32, @truncate(@as(u64, @intCast(@max(std.time.timestamp(), 0)))));
        };
        return manager;
    }

    pub fn initWithRuntime(
        log: *logger.Log,
        bun_install: ?*Api.BunInstall,
        allocator: std.mem.Allocator,
        cli: CommandLineArguments,
        env: *DotEnv.Loader,
    ) !*PackageManager {
        if (env.map.get("BUN_INSTALL_VERBOSE") != null) {
            PackageManager.verbose_install = true;
        }

        var cpu_count = @as(u32, @truncate(((try std.Thread.getCpuCount()) + 1)));

        if (env.map.get("GOMAXPROCS")) |max_procs| {
            if (std.fmt.parseInt(u32, max_procs, 10)) |cpu_count_| {
                cpu_count = @min(cpu_count, cpu_count_);
            } else |_| {}
        }

        var manager = &instance;
        var root_dir = try Fs.FileSystem.instance.fs.readDirectory(
            Fs.FileSystem.instance.top_level_dir,
            null,
            0,
            true,
        );
        // var progress = Progress{};
        // var node = progress.start(name: []const u8, estimated_total_items: usize)
        manager.* = PackageManager{
            .options = .{
                .max_concurrent_lifecycle_scripts = cli.concurrent_scripts orelse cpu_count * 2,
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
            .resolve_tasks = TaskChannel.init(),
            .lockfile = undefined,
            .root_package_json_file = undefined,
            .uws_event_loop = uws.Loop.get(),
            .file_poll_store = bun.Async.FilePoll.Store.init(allocator),
            .workspaces = std.StringArrayHashMap(Semver.Version).init(allocator),
        };
        manager.lockfile = try allocator.create(Lockfile);

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

        if (env.map.get("BUN_MANIFEST_CACHE")) |manifest_cache| {
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
            allocator,
            log,
            env,
            cli,
            bun_install,
            .install,
        );

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
            var buf: [bun.MAX_PATH_BYTES]u8 = undefined;
            var parts = [_]string{
                "./bun.lockb",
            };
            const lockfile_path = Path.joinAbsStringBuf(
                Fs.FileSystem.instance.top_level_dir,
                &buf,
                &parts,
                .auto,
            );
            buf[lockfile_path.len] = 0;
            const lockfile_path_z = buf[0..lockfile_path.len :0];

            switch (manager.lockfile.loadFromDisk(
                allocator,
                log,
                lockfile_path_z,
            )) {
                .ok => |load| manager.lockfile = load.lockfile,
                else => try manager.lockfile.initEmpty(allocator),
            }
        } else {
            try manager.lockfile.initEmpty(allocator);
        }

        return manager;
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

    pub inline fn update(ctx: Command.Context) !void {
        try updatePackageJSONAndInstall(ctx, .update, .update);
    }

    pub inline fn add(ctx: Command.Context) !void {
        try updatePackageJSONAndInstall(ctx, .add, .add);
    }

    pub inline fn remove(ctx: Command.Context) !void {
        try updatePackageJSONAndInstall(ctx, .remove, .remove);
    }

    pub inline fn link(ctx: Command.Context) !void {
        var manager = PackageManager.init(ctx, .link) catch |err| brk: {
            if (err == error.MissingPackageJSON) {
                try attemptToCreatePackageJSON();
                break :brk try PackageManager.init(ctx, .link);
            }

            return err;
        };

        if (manager.options.shouldPrintCommandName()) {
            Output.prettyErrorln("<r><b>bun link <r><d>v" ++ Global.package_json_version_with_sha ++ "<r>\n", .{});
            Output.flush();
        }

        if (manager.options.positionals.len == 1) {
            // bun link

            var lockfile: Lockfile = undefined;
            var name: string = "";
            var package = Lockfile.Package{};

            // Step 1. parse the nearest package.json file
            {
                const current_package_json_stat_size = try manager.root_package_json_file.getEndPos();
                var current_package_json_buf = try ctx.allocator.alloc(u8, current_package_json_stat_size + 64);
                const current_package_json_contents_len = try manager.root_package_json_file.preadAll(
                    current_package_json_buf,
                    0,
                );

                const package_json_source = logger.Source.initPathString(
                    package_json_cwd,
                    current_package_json_buf[0..current_package_json_contents_len],
                );
                try lockfile.initEmpty(ctx.allocator);

                try package.parseMain(&lockfile, ctx.allocator, manager.log, package_json_source, Features.folder);
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

                try manager.setupGlobalDir(&ctx);

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
                var bin_linker = Bin.Linker{
                    .bin = package.bin,
                    .package_installed_node_modules = bun.toFD(node_modules.fd),
                    .global_bin_path = manager.options.bin_path,
                    .global_bin_dir = manager.options.global_bin_dir,

                    // .destination_dir_subpath = destination_dir_subpath,
                    .root_node_modules_folder = bun.toFD(node_modules.fd),
                    .package_name = strings.StringOrTinyString.init(name),
                    .string_buf = lockfile.buffers.string_bytes.items,
                    .extern_string_buf = lockfile.buffers.extern_strings.items,
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
            switch (manager.options.log_level) {
                inline else => |log_level| try manager.updatePackageJSONAndInstallWithManager(ctx, .link, log_level),
            }
        }
    }

    pub inline fn unlink(ctx: Command.Context) !void {
        var manager = PackageManager.init(ctx, .unlink) catch |err| brk: {
            if (err == error.MissingPackageJSON) {
                try attemptToCreatePackageJSON();
                break :brk try PackageManager.init(ctx, .unlink);
            }

            return err;
        };

        if (manager.options.shouldPrintCommandName()) {
            Output.prettyErrorln("<r><b>bun unlink <r><d>v" ++ Global.package_json_version_with_sha ++ "<r>\n", .{});
            Output.flush();
        }

        if (manager.options.positionals.len == 1) {
            // bun unlink

            var lockfile: Lockfile = undefined;
            var name: string = "";
            var package = Lockfile.Package{};

            // Step 1. parse the nearest package.json file
            {
                const current_package_json_stat_size = try manager.root_package_json_file.getEndPos();
                var current_package_json_buf = try ctx.allocator.alloc(u8, current_package_json_stat_size + 64);
                const current_package_json_contents_len = try manager.root_package_json_file.preadAll(
                    current_package_json_buf,
                    0,
                );

                const package_json_source = logger.Source.initPathString(
                    package_json_cwd,
                    current_package_json_buf[0..current_package_json_contents_len],
                );
                try lockfile.initEmpty(ctx.allocator);

                try package.parseMain(&lockfile, ctx.allocator, manager.log, package_json_source, Features.folder);
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

                try manager.setupGlobalDir(&ctx);

                break :brk manager.global_dir.?.makeOpenPath("node_modules", .{}) catch |err| {
                    if (manager.options.log_level != .silent)
                        Output.prettyErrorln("<r><red>error:<r> failed to create node_modules in global dir due to error {s}", .{@errorName(err)});
                    Global.crash();
                };
            };

            // Step 3b. Link any global bins
            if (package.bin.tag != .none) {
                var bin_linker = Bin.Linker{
                    .bin = package.bin,
                    .package_installed_node_modules = bun.toFD(node_modules.fd),
                    .global_bin_path = manager.options.bin_path,
                    .global_bin_dir = manager.options.global_bin_dir,

                    // .destination_dir_subpath = destination_dir_subpath,
                    .root_node_modules_folder = bun.toFD(node_modules.fd),
                    .package_name = strings.StringOrTinyString.init(name),
                    .string_buf = lockfile.buffers.string_bytes.items,
                    .extern_string_buf = lockfile.buffers.extern_strings.items,
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

    const ParamType = clap.Param(clap.Help);
    const platform_specific_backend_label = if (Environment.isMac)
        "Possible values: \"clonefile\" (default), \"hardlink\", \"symlink\", \"copyfile\""
    else
        "Possible values: \"hardlink\" (default), \"symlink\", \"copyfile\"";

    const install_params_ = [_]ParamType{
        clap.parseParam("-c, --config <STR>?                   Specify path to config file (bunfig.toml)") catch unreachable,
        clap.parseParam("-y, --yarn                            Write a yarn.lock file (yarn v1)") catch unreachable,
        clap.parseParam("-p, --production                      Don't install devDependencies") catch unreachable,
        clap.parseParam("--no-save                             Don't update package.json or save a lockfile") catch unreachable,
        clap.parseParam("--save                                Save to package.json (true by default)") catch unreachable,
        clap.parseParam("--dry-run                             Don't install anything") catch unreachable,
        clap.parseParam("--frozen-lockfile                     Disallow changes to lockfile") catch unreachable,
        clap.parseParam("-f, --force                           Always request the latest versions from the registry & reinstall all dependencies") catch unreachable,
        clap.parseParam("--cache-dir <PATH>                    Store & load cached data from a specific directory path") catch unreachable,
        clap.parseParam("--no-cache                            Ignore manifest cache entirely") catch unreachable,
        clap.parseParam("--silent                              Don't log anything") catch unreachable,
        clap.parseParam("--verbose                             Excessively verbose logging") catch unreachable,
        clap.parseParam("--no-progress                         Disable the progress bar") catch unreachable,
        clap.parseParam("--no-summary                          Don't print a summary") catch unreachable,
        clap.parseParam("--no-verify                           Skip verifying integrity of newly downloaded packages") catch unreachable,
        clap.parseParam("--ignore-scripts                      Skip lifecycle scripts in the project's package.json (dependency scripts are never run)") catch unreachable,
        clap.parseParam("-g, --global                          Install globally") catch unreachable,
        clap.parseParam("--cwd <STR>                           Set a specific cwd") catch unreachable,
        clap.parseParam("--backend <STR>                       Platform-specific optimizations for installing dependencies. " ++ platform_specific_backend_label) catch unreachable,
        clap.parseParam("--link-native-bins <STR>...           Link \"bin\" from a matching platform-specific \"optionalDependencies\" instead. Default: esbuild, turbo") catch unreachable,
        clap.parseParam("--concurrent-scripts <NUM>            Maximum number of concurrent jobs for lifecycle scripts (default 5)") catch unreachable,
        // clap.parseParam("--omit <STR>...                    Skip installing dependencies of a certain type. \"dev\", \"optional\", or \"peer\"") catch unreachable,
        // clap.parseParam("--no-dedupe                        Disable automatic downgrading of dependencies that would otherwise cause unnecessary duplicate package versions ($BUN_CONFIG_NO_DEDUPLICATE)") catch unreachable,
        clap.parseParam("-h, --help                            Print this help menu") catch unreachable,
    };

    pub const install_params = install_params_ ++ [_]ParamType{
        clap.parseParam("-d, --dev                 Add dependency to \"devDependencies\"") catch unreachable,
        clap.parseParam("-D, --development") catch unreachable,
        clap.parseParam("--optional                        Add dependency to \"optionalDependencies\"") catch unreachable,
        clap.parseParam("-E, --exact                  Add the exact version instead of the ^range") catch unreachable,
        clap.parseParam("<POS> ...                         ") catch unreachable,
    };

    pub const update_params = install_params_ ++ [_]ParamType{
        clap.parseParam("<POS> ...                         \"name\" of packages to update") catch unreachable,
    };

    pub const pm_params = install_params_ ++ [_]ParamType{
        clap.parseParam("-a, --all") catch unreachable,
        clap.parseParam("<POS> ...                         ") catch unreachable,
    };

    pub const add_params = install_params_ ++ [_]ParamType{
        clap.parseParam("-d, --dev                 Add dependency to \"devDependencies\"") catch unreachable,
        clap.parseParam("-D, --development") catch unreachable,
        clap.parseParam("--optional                        Add dependency to \"optionalDependencies\"") catch unreachable,
        clap.parseParam("-E, --exact                  Add the exact version instead of the ^range") catch unreachable,
        clap.parseParam("<POS> ...                         \"name\" or \"name@version\" of package(s) to install") catch unreachable,
    };

    pub const remove_params = install_params_ ++ [_]ParamType{
        clap.parseParam("<POS> ...                         \"name\" of package(s) to remove from package.json") catch unreachable,
    };

    pub const link_params = install_params_ ++ [_]ParamType{
        clap.parseParam("<POS> ...                         \"name\" install package as a link") catch unreachable,
    };

    pub const unlink_params = install_params_ ++ [_]ParamType{
        clap.parseParam("<POS> ...                         \"name\" uninstall package as a link") catch unreachable,
    };

    pub const CommandLineArguments = struct {
        registry: string = "",
        cache_dir: string = "",
        lockfile: string = "",
        token: string = "",
        global: bool = false,
        config: ?string = null,

        backend: ?PackageInstall.Method = null,

        positionals: []const string = &[_]string{},

        yarn: bool = false,
        production: bool = false,
        frozen_lockfile: bool = false,
        no_save: bool = false,
        dry_run: bool = false,
        force: bool = false,
        no_dedupe: bool = false,
        no_cache: bool = false,
        silent: bool = false,
        verbose: bool = false,
        no_progress: bool = false,
        no_verify: bool = false,
        ignore_scripts: bool = false,
        no_summary: bool = false,

        link_native_bins: []const string = &[_]string{},

        development: bool = false,
        optional: bool = false,

        no_optional: bool = false,
        omit: Omit = Omit{},

        exact: bool = false,

        concurrent_scripts: ?usize = null,

        const Omit = struct {
            dev: bool = false,
            optional: bool = true,
            peer: bool = false,

            pub inline fn toFeatures(this: Omit) Features {
                return .{
                    .dev_dependencies = this.dev,
                    .optional_dependencies = this.optional,
                    .peer_dependencies = this.peer,
                };
            }
        };

        pub fn printHelp(comptime subcommand: Subcommand) void {
            switch (subcommand) {
                // fall back to HelpCommand.printWithReason
                Subcommand.install => {
                    const intro_text =
                        \\<b>Usage<r>: <b><green>bun install<r> <cyan>[flags]<r> [...\<pkg\>]
                        \\<b>Alias: <b>bun i<r>
                        \\  Install the dependencies listed in package.json
                    ;
                    const outro_text =
                        \\<b>Examples:<r>
                        \\  <d>Install the dependencies for the current project<r>
                        \\  <b><green>bun install<r>
                        \\
                        \\  <d>Skip devDependencies<r>
                        \\  <b><green>bun install --production<r>
                        \\
                        \\Full documentation is available at <magenta>https://bun.sh/docs/cli/install<r>
                    ;
                    Output.pretty("\n" ++ intro_text, .{});
                    Output.flush();
                    Output.pretty("\n\n<b>Flags:<r>", .{});
                    Output.flush();
                    clap.simpleHelp(&PackageManager.install_params);
                    Output.pretty("\n\n" ++ outro_text ++ "\n", .{});
                    Output.flush();
                },
                Subcommand.update => {
                    const intro_text =
                        \\<b>Usage<r>: <b><green>bun update<r> <cyan>[flags]<r>
                        \\  Update all dependencies to most recent versions within the version range in package.json
                        \\
                    ;
                    const outro_text =
                        \\<b>Examples:<r>
                        \\  <d>Update all dependencies:<r>
                        \\  <b><green>bun update<r>
                        \\
                        \\Full documentation is available at <magenta>https://bun.sh/docs/cli/update<r>
                    ;
                    Output.pretty("\n" ++ intro_text, .{});
                    Output.flush();
                    Output.pretty("\n<b>Flags:<r>", .{});
                    Output.flush();
                    clap.simpleHelp(&PackageManager.update_params);
                    Output.pretty("\n\n" ++ outro_text ++ "\n", .{});
                    Output.flush();
                },
                Subcommand.pm => {
                    PackageManagerCommand.printHelp();
                },
                Subcommand.add => {
                    const intro_text =
                        \\<b>Usage<r>: <b><green>bun add<r> <cyan>[flags]<r> \<pkg\> [...\<pkg\>]
                        \\<b>Alias: <b>bun a<r>
                    ;
                    const outro_text =
                        \\<b>Examples:<r>
                        \\  <d>Add a dependency from the npm registry<r>
                        \\  <b><green>bun add zod<r>
                        \\  <b><green>bun add zod@next<r>
                        \\  <b><green>bun add zod@3.0.0<r>
                        \\
                        \\  <d>Add a dev, optional, or peer dependency <r>
                        \\  <b><green>bun add -d typescript<r>
                        \\  <b><green>bun add -o lodash<r>
                        \\  <b><green>bun add --peer esbuild<r>
                        \\
                        \\Full documentation is available at <magenta>https://bun.sh/docs/cli/add<r>
                    ;
                    Output.pretty("\n" ++ intro_text, .{});
                    Output.flush();
                    Output.pretty("\n\n<b>Flags:<r>", .{});
                    Output.flush();
                    clap.simpleHelp(&PackageManager.add_params);
                    Output.pretty("\n\n" ++ outro_text ++ "\n", .{});
                    Output.flush();
                },
                Subcommand.remove => {
                    const intro_text =
                        \\<b>Usage<r>: <b><green>bun remove<r> <cyan>[flags]<r> \<pkg\> [...\<pkg\>]
                        \\<b>Alias: <b>bun r<r>
                        \\  Remove a package from package.json and uninstall from node_modules
                        \\
                    ;
                    const outro_text =
                        \\<b>Examples:<r>
                        \\  <d>Remove a dependency<r>
                        \\  <b><green>bun remove ts-node<r>
                        \\
                        \\Full documentation is available at <magenta>https://bun.sh/docs/cli/remove<r>
                    ;
                    Output.pretty("\n" ++ intro_text, .{});
                    Output.flush();
                    Output.pretty("\n<b>Flags:<r>", .{});
                    Output.flush();
                    clap.simpleHelp(&PackageManager.remove_params);
                    Output.pretty("\n\n" ++ outro_text ++ "\n", .{});
                    Output.flush();
                },
                Subcommand.link => {
                    const intro_text =
                        \\<b>Usage<r>: <b><green>bun link<r> <cyan>[flags]<r> [\<package\>]
                        \\
                    ;
                    const outro_text =
                        \\<b>Examples:<r>
                        \\  <d>Register the current directory as a linkable package.<r>
                        \\  <d>Directory should contain a package.json.<r>
                        \\  <b><green>bun link<r>
                        \\
                        \\  <d>Add a previously-registered linkable package as a dependency of the current project.<r>
                        \\  <b><green>bun link \<package\><r>
                        \\
                        \\Full documentation is available at <magenta>https://bun.sh/docs/cli/link<r>
                    ;
                    Output.pretty("\n" ++ intro_text, .{});
                    Output.flush();
                    Output.pretty("\n<b>Flags:<r>", .{});
                    Output.flush();
                    clap.simpleHelp(&PackageManager.link_params);
                    Output.pretty("\n\n" ++ outro_text ++ "\n", .{});
                    Output.flush();
                },
                Subcommand.unlink => {
                    const intro_text =
                        \\<b>Usage<r>: <b><green>bun unlink<r> <cyan>[flags]<r>
                    ;

                    const outro_text =
                        \\<b>Examples:<r>
                        \\  <d>Unregister the current directory as a linkable package.<r>
                        \\  <b><green>bun unlink<r>
                        \\
                        \\Full documentation is available at <magenta>https://bun.sh/docs/cli/unlink<r>
                    ;

                    Output.pretty("\n" ++ intro_text ++ "\n", .{});
                    Output.flush();
                    Output.pretty("\n<b>Flags:<r>", .{});
                    Output.flush();
                    clap.simpleHelp(&PackageManager.unlink_params);
                    Output.pretty("\n\n" ++ outro_text ++ "\n", .{});
                    Output.flush();
                },
            }
        }

        pub fn parse(allocator: std.mem.Allocator, comptime subcommand: Subcommand) !CommandLineArguments {
            Output.is_verbose = Output.isVerbose();

            const params: []const ParamType = &switch (subcommand) {
                .install => install_params,
                .update => update_params,
                .pm => pm_params,
                .add => add_params,
                .remove => remove_params,
                .link => link_params,
                .unlink => unlink_params,
            };

            var diag = clap.Diagnostic{};

            var args = clap.parse(clap.Help, params, .{
                .diagnostic = &diag,
                .allocator = allocator,
            }) catch |err| {
                clap.help(Output.errorWriter(), params) catch {};
                Output.errorWriter().writeAll("\n") catch {};
                diag.report(Output.errorWriter(), err) catch {};
                return err;
            };

            if (args.flag("--help")) {
                printHelp(subcommand);
                Global.exit(0);
            }

            var cli = CommandLineArguments{};
            cli.yarn = args.flag("--yarn");
            cli.production = args.flag("--production");
            cli.frozen_lockfile = args.flag("--frozen-lockfile");
            cli.no_progress = args.flag("--no-progress");
            cli.dry_run = args.flag("--dry-run");
            cli.global = args.flag("--global");
            cli.force = args.flag("--force");
            cli.no_verify = args.flag("--no-verify");
            // cli.no_dedupe = args.flag("--no-dedupe");
            cli.no_cache = args.flag("--no-cache");
            cli.silent = args.flag("--silent");
            cli.verbose = args.flag("--verbose") or Output.is_verbose;
            cli.ignore_scripts = args.flag("--ignore-scripts");
            cli.no_summary = args.flag("--no-summary");

            // link and unlink default to not saving, all others default to
            // saving.
            if (comptime subcommand == .link or subcommand == .unlink) {
                cli.no_save = !args.flag("--save");
            } else {
                cli.no_save = args.flag("--no-save");
            }

            if (args.option("--config")) |opt| {
                cli.config = opt;
            }

            cli.link_native_bins = args.options("--link-native-bins");

            if (comptime subcommand == .add or subcommand == .install) {
                cli.development = args.flag("--development") or args.flag("--dev");
                cli.optional = args.flag("--optional");
                cli.exact = args.flag("--exact");
            }

            if (args.option("--concurrent-scripts")) |concurrency| {
                // var buf: []
                cli.concurrent_scripts = std.fmt.parseInt(usize, concurrency, 10) catch null;
            }

            // for (args.options("--omit")) |omit| {
            //     if (strings.eqlComptime(omit, "dev")) {
            //         cli.omit.dev = true;
            //     } else if (strings.eqlComptime(omit, "optional")) {
            //         cli.omit.optional = true;
            //     } else if (strings.eqlComptime(omit, "peer")) {
            //         cli.omit.peer = true;
            //     } else {
            //         Output.prettyErrorln("<b>error<r><d>:<r> Invalid argument <b>\"--omit\"<r> must be one of <cyan>\"dev\"<r>, <cyan>\"optional\"<r>, or <cyan>\"peer\"<r>. ", .{});
            //         Global.crash();
            //     }
            // }

            if (args.option("--cwd")) |cwd_| {
                var buf: [bun.MAX_PATH_BYTES]u8 = undefined;
                var buf2: [bun.MAX_PATH_BYTES]u8 = undefined;
                var final_path: [:0]u8 = undefined;
                if (cwd_.len > 0 and cwd_[0] == '.') {
                    const cwd = try bun.getcwd(&buf);
                    var parts = [_]string{cwd_};
                    const path_ = Path.joinAbsStringBuf(cwd, &buf2, &parts, .auto);
                    buf2[path_.len] = 0;
                    final_path = buf2[0..path_.len :0];
                } else {
                    bun.copy(u8, &buf, cwd_);
                    buf[cwd_.len] = 0;
                    final_path = buf[0..cwd_.len :0];
                }
                try bun.sys.chdir(final_path).unwrap();
            }

            const specified_backend: ?PackageInstall.Method = brk: {
                if (args.option("--backend")) |backend_| {
                    break :brk PackageInstall.Method.map.get(backend_);
                }
                break :brk null;
            };

            if (specified_backend) |backend| {
                if (backend.isSupported()) {
                    cli.backend = backend;
                }
            }

            cli.positionals = args.positionals();

            return cli;
        }
    };
    const latest: string = "latest";

    pub const UpdateRequest = struct {
        name: string = "",
        name_hash: PackageNameHash = 0,
        version: Dependency.Version = .{},
        version_buf: []const u8 = "",
        resolution: Resolution = .{},
        resolved_name: String = .{},
        is_aliased: bool = false,
        failed: bool = false,
        // This must be cloned to handle when the AST store resets
        e_string: ?*JSAst.E.String = null,

        pub const Array = std.BoundedArray(UpdateRequest, 64);

        pub inline fn matches(this: PackageManager.UpdateRequest, dependency: Dependency, string_buf: []const u8) bool {
            return this.name_hash == if (this.name.len == 0)
                String.Builder.stringHash(dependency.version.literal.slice(string_buf))
            else
                dependency.name_hash;
        }

        pub fn parse(
            allocator: std.mem.Allocator,
            log: *logger.Log,
            positionals: []const string,
            update_requests: *Array,
            op: Lockfile.Package.Diff.Op,
        ) []UpdateRequest {
            // first one is always either:
            // add
            // remove
            outer: for (positionals) |positional| {
                var input = std.mem.trim(u8, positional, " \n\r\t");
                switch (op) {
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
                ) orelse {
                    Output.prettyErrorln("<r><red>error<r><d>:<r> unrecognised dependency format: {s}", .{
                        positional,
                    });
                    Global.crash();
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
                    Output.prettyErrorln("<r><red>error<r><d>:<r> unrecognised dependency format: {s}", .{
                        positional,
                    });
                    Global.crash();
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

                for (update_requests.constSlice()) |*prev| {
                    if (prev.name_hash == request.name_hash and request.name.len == prev.name.len) continue :outer;
                }
                update_requests.append(request) catch break;
            }

            return update_requests.slice();
        }
    };

    fn updatePackageJSONAndInstall(
        ctx: Command.Context,
        comptime op: Lockfile.Package.Diff.Op,
        comptime subcommand: Subcommand,
    ) !void {
        var manager = init(ctx, subcommand) catch |err| brk: {
            if (err == error.MissingPackageJSON) {
                switch (op) {
                    .update => {
                        Output.prettyErrorln("<r>No package.json, so nothing to update\n", .{});
                        Global.crash();
                    },
                    .remove => {
                        Output.prettyErrorln("<r>No package.json, so nothing to remove\n", .{});
                        Global.crash();
                    },
                    else => {
                        try attemptToCreatePackageJSON();
                        break :brk try PackageManager.init(ctx, subcommand);
                    },
                }
            }

            return err;
        };

        if (manager.options.shouldPrintCommandName()) {
            Output.prettyErrorln("<r><b>bun " ++ @tagName(op) ++ " <r><d>v" ++ Global.package_json_version_with_sha ++ "<r>\n", .{});
            Output.flush();
        }

        switch (manager.options.log_level) {
            inline else => |log_level| try manager.updatePackageJSONAndInstallWithManager(ctx, op, log_level),
        }
    }

    fn updatePackageJSONAndInstallWithManager(
        manager: *PackageManager,
        ctx: Command.Context,
        comptime op: Lockfile.Package.Diff.Op,
        comptime log_level: Options.LogLevel,
    ) !void {
        var update_requests = try UpdateRequest.Array.init(0);

        if (manager.options.positionals.len <= 1) {
            const examples_to_print: [3]string = undefined;
            _ = examples_to_print;

            const off = @as(u64, @intCast(std.time.milliTimestamp()));
            _ = off;

            switch (op) {
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

        const updates = UpdateRequest.parse(ctx.allocator, ctx.log, manager.options.positionals[1..], &update_requests, op);
        try manager.updatePackageJSONAndInstallWithManagerWithUpdates(
            ctx,
            updates,
            false,
            op,
            log_level,
        );
    }

    fn updatePackageJSONAndInstallWithManagerWithUpdates(
        manager: *PackageManager,
        ctx: Command.Context,
        updates: []UpdateRequest,
        auto_free: bool,
        comptime op: Lockfile.Package.Diff.Op,
        comptime log_level: Options.LogLevel,
    ) !void {
        if (ctx.log.errors > 0) {
            if (comptime log_level != .silent) {
                switch (Output.enable_ansi_colors) {
                    inline else => |enable_ansi_colors| {
                        ctx.log.printForLogLevelWithEnableAnsiColors(Output.errorWriter(), enable_ansi_colors) catch {};
                    },
                }
            }
            Global.crash();
        }

        const current_package_json_stat_size = try manager.root_package_json_file.getEndPos();
        var current_package_json_buf = try ctx.allocator.alloc(u8, current_package_json_stat_size + 64);
        const current_package_json_contents_len = try manager.root_package_json_file.preadAll(
            current_package_json_buf,
            0,
        );

        const package_json_source = logger.Source.initPathString(
            package_json_cwd,
            current_package_json_buf[0..current_package_json_contents_len],
        );

        // If there originally was a newline at the end of their package.json, preserve it
        // so that we don't cause unnecessary diffs in their git history.
        // https://github.com/oven-sh/bun/issues/1375
        const preserve_trailing_newline_at_eof_for_package_json = current_package_json_contents_len > 0 and
            current_package_json_buf[current_package_json_contents_len - 1] == '\n';

        initializeStore();
        var current_package_json = json_parser.ParseJSONUTF8(&package_json_source, ctx.log, manager.allocator) catch |err| {
            switch (Output.enable_ansi_colors) {
                inline else => |enable_ansi_colors| {
                    ctx.log.printForLogLevelWithEnableAnsiColors(Output.errorWriter(), enable_ansi_colors) catch {};
                },
            }

            if (err == error.ParserError and ctx.log.errors > 0) {
                Output.prettyErrorln("error: Failed to parse package.json", .{});
                Global.crash();
            }

            Output.panic("<r><red>{s}<r> parsing package.json<r>", .{
                @errorName(err),
            });
        };

        if (op == .remove) {
            if (current_package_json.data != .e_object) {
                Output.prettyErrorln("<red>error<r><d>:<r> package.json is not an Object {{}}, so there's nothing to remove!", .{});
                Global.crash();
            } else if (current_package_json.data.e_object.properties.len == 0) {
                Output.prettyErrorln("<red>error<r><d>:<r> package.json is empty {{}}, so there's nothing to remove!", .{});
                Global.crash();
            } else if (current_package_json.asProperty("devDependencies") == null and
                current_package_json.asProperty("dependencies") == null and
                current_package_json.asProperty("optionalDependencies") == null and
                current_package_json.asProperty("peerDependencies") == null)
            {
                Output.prettyErrorln("package.json doesn't have dependencies, there's nothing to remove!", .{});
                Global.exit(0);
            }
        }

        const dependency_list = if (manager.options.update.development)
            "devDependencies"
        else if (manager.options.update.optional)
            "optionalDependencies"
        else
            "dependencies";
        var any_changes = false;

        switch (op) {
            .remove => {
                // if we're removing, they don't have to specify where it is installed in the dependencies list
                // they can even put it multiple times and we will just remove all of them
                for (updates) |request| {
                    inline for ([_]string{ "dependencies", "devDependencies", "optionalDependencies", "peerDependencies" }) |list| {
                        if (current_package_json.asProperty(list)) |query| {
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
                                        var arraylist = current_package_json.data.e_object.properties.list();
                                        _ = arraylist.swapRemove(query.i);
                                        current_package_json.data.e_object.properties.update(arraylist);
                                        current_package_json.data.e_object.packageJSONSort();
                                    } else {
                                        var obj = query.expr.data.e_object;
                                        obj.alphabetizeProperties();
                                    }
                                }
                            }
                        }
                    }
                }

                manager.to_remove = updates;
            },
            .link, .add => {
                try PackageJSONEditor.edit(
                    ctx.allocator,
                    updates,
                    &current_package_json,
                    dependency_list,
                    manager.options.enable.exact_versions,
                );
                manager.package_json_updates = updates;
            },
            .update => {
                manager.package_json_updates = updates;
                manager.to_update = true;
            },
            else => {},
        }

        var buffer_writer = try JSPrinter.BufferWriter.init(ctx.allocator);
        try buffer_writer.buffer.list.ensureTotalCapacity(ctx.allocator, current_package_json_buf.len + 1);
        buffer_writer.append_newline = preserve_trailing_newline_at_eof_for_package_json;
        var package_json_writer = JSPrinter.BufferPrinter.init(buffer_writer);

        var written = JSPrinter.printJSON(@TypeOf(&package_json_writer), &package_json_writer, current_package_json, &package_json_source) catch |err| {
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
        var new_package_json_source = try ctx.allocator.dupe(u8, package_json_writer.ctx.writtenWithoutTrailingZero());

        // Do not free the old package.json AST nodes
        const old_ast_nodes = JSAst.Expr.Data.Store.toOwnedSlice();
        // haha unless
        defer if (auto_free) bun.default_allocator.free(old_ast_nodes);

        try manager.installWithManager(ctx, new_package_json_source, log_level);

        if (op == .update or op == .add or op == .link) {
            for (manager.package_json_updates) |request| {
                if (request.failed) {
                    Global.exit(1);
                    return;
                }
            }

            const source = logger.Source.initPathString("package.json", new_package_json_source);

            // Now, we _re_ parse our in-memory edited package.json
            // so we can commit the version we changed from the lockfile
            current_package_json = json_parser.ParseJSONUTF8(&source, ctx.log, manager.allocator) catch |err| {
                Output.prettyErrorln("<red>error<r><d>:<r> package.json failed to parse due to error {s}", .{@errorName(err)});
                Global.exit(1);
                return;
            };

            try PackageJSONEditor.edit(
                ctx.allocator,
                updates,
                &current_package_json,
                dependency_list,
                manager.options.enable.exact_versions,
            );
            var buffer_writer_two = try JSPrinter.BufferWriter.init(ctx.allocator);
            try buffer_writer_two.buffer.list.ensureTotalCapacity(ctx.allocator, new_package_json_source.len + 1);
            buffer_writer_two.append_newline =
                preserve_trailing_newline_at_eof_for_package_json;
            var package_json_writer_two = JSPrinter.BufferPrinter.init(buffer_writer_two);

            written = JSPrinter.printJSON(
                @TypeOf(&package_json_writer_two),
                &package_json_writer_two,
                current_package_json,
                &source,
            ) catch |err| {
                Output.prettyErrorln("package.json failed to write due to error {s}", .{@errorName(err)});
                Global.crash();
            };

            new_package_json_source = try ctx.allocator.dupe(u8, package_json_writer_two.ctx.writtenWithoutTrailingZero());
        }

        if (manager.options.do.write_package_json) {
            // Now that we've run the install step
            // We can save our in-memory package.json to disk
            try manager.root_package_json_file.pwriteAll(new_package_json_source, 0);
            std.os.ftruncate(manager.root_package_json_file.handle, new_package_json_source.len) catch {};
            manager.root_package_json_file.close();

            if (op == .remove) {
                if (!any_changes) {
                    Global.exit(0);
                    return;
                }

                var cwd = std.fs.cwd();
                // This is not exactly correct
                var node_modules_buf: [bun.MAX_PATH_BYTES]u8 = undefined;
                bun.copy(u8, &node_modules_buf, "node_modules" ++ std.fs.path.sep_str);
                const offset_buf = node_modules_buf["node_modules/".len..];
                const name_hashes = manager.lockfile.packages.items(.name_hash);
                for (updates) |request| {
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

    var cwd_buf: [bun.MAX_PATH_BYTES]u8 = undefined;
    var package_json_cwd_buf: [bun.MAX_PATH_BYTES]u8 = undefined;
    var package_json_cwd: string = "";

    pub inline fn install(ctx: Command.Context) !void {
        var manager = try init(ctx, .install);

        // switch to `bun add <package>`
        if (manager.options.positionals.len > 1) {
            if (manager.options.shouldPrintCommandName()) {
                Output.prettyErrorln("<r><b>bun add <r><d>v" ++ Global.package_json_version_with_sha ++ "<r>\n", .{});
                Output.flush();
            }
            return try switch (manager.options.log_level) {
                inline else => |log_level| manager.updatePackageJSONAndInstallWithManager(ctx, .add, log_level),
            };
        }

        if (manager.options.shouldPrintCommandName()) {
            Output.prettyErrorln("<r><b>bun install <r><d>v" ++ Global.package_json_version_with_sha ++ "<r>\n", .{});
            Output.flush();
        }

        const package_json_contents = manager.root_package_json_file.readToEndAlloc(ctx.allocator, std.math.maxInt(usize)) catch |err| {
            if (manager.options.log_level != .silent) {
                Output.prettyErrorln("<r><red>{s} reading package.json<r> :(", .{@errorName(err)});
                Output.flush();
            }
            return;
        };

        try switch (manager.options.log_level) {
            inline else => |log_level| manager.installWithManager(ctx, package_json_contents, log_level),
        };
    }

    pub const PackageInstaller = struct {
        manager: *PackageManager,
        lockfile: *Lockfile,
        progress: *std.Progress,

        // relative paths from `nextNodeModulesFolder` will be copied into this list.
        node_modules_folder_path: std.ArrayList(u8),
        node_modules_folder: std.fs.Dir,

        skip_verify_installed_version_number: bool,
        skip_delete: bool,
        force_install: bool,
        root_node_modules_folder: std.fs.Dir,
        summary: *PackageInstall.Summary,
        options: *const PackageManager.Options,
        metas: []const Lockfile.Package.Meta,
        names: []const String,
        bins: []const Bin,
        resolutions: []Resolution,
        node: *Progress.Node,
        global_bin_dir: std.fs.Dir,
        destination_dir_subpath_buf: [bun.MAX_PATH_BYTES]u8 = undefined,
        folder_path_buf: [bun.MAX_PATH_BYTES]u8 = undefined,
        successfully_installed: Bitset,
        tree_iterator: *Lockfile.Tree.Iterator,
        command_ctx: Command.Context,
        current_tree_id: Lockfile.Tree.Id = Lockfile.Tree.invalid_id,

        // fields used for running lifecycle scripts when it's safe
        //
        /// set of completed tree ids
        completed_trees: Bitset,
        /// tree id to number of successfully installed deps for id. when count == tree.dependencies.len, mark as complete above
        tree_install_counts: []usize,
        /// the tree ids a tree depends on before it can run the lifecycle scripts of it's immediate dependencies
        tree_ids_to_trees_the_id_depends_on: Bitset.List,
        pending_lifecycle_scripts: std.ArrayListUnmanaged(struct {
            list: Lockfile.Package.Scripts.List,
            tree_id: Lockfile.Tree.Id,
        }) = .{},

        /// Increments the number of installed packages for a tree id and runs available scripts
        /// if the tree is finished.
        pub fn incrementTreeInstallCount(this: *PackageInstaller, tree_id: Lockfile.Tree.Id, comptime log_level: Options.LogLevel) void {
            if (comptime Environment.isWindows) {
                return bun.todo(@src(), {});
            }
            if (comptime Environment.allow_assert) {
                std.debug.assert(tree_id != Lockfile.Tree.invalid_id);
            }

            const trees = this.lockfile.buffers.trees.items;
            const current_count = this.tree_install_counts[tree_id];
            const max = trees[tree_id].dependencies.len;

            if (current_count == std.math.maxInt(usize)) {
                if (comptime Environment.allow_assert)
                    Output.panic("Installed more packages than expected for tree id: {d}. Expected: {d}", .{ tree_id, max });

                return;
            }

            const is_not_done = current_count + 1 < max;

            this.tree_install_counts[tree_id] = if (is_not_done) current_count + 1 else std.math.maxInt(usize);

            if (!is_not_done) {
                this.completed_trees.set(tree_id);
                this.runAvailableScripts(log_level);
            }
        }

        pub fn runAvailableScripts(this: *PackageInstaller, comptime log_level: Options.LogLevel) void {
            if (comptime Environment.isWindows) {
                return bun.todo(@src(), {});
            }
            var i: usize = this.pending_lifecycle_scripts.items.len;
            while (i > 0) {
                i -= 1;
                const entry = this.pending_lifecycle_scripts.items[i];
                const name = entry.list.first().package_name;
                const tree_id = entry.tree_id;
                if (this.canRunScripts(tree_id)) {
                    _ = this.pending_lifecycle_scripts.swapRemove(i);
                    this.manager.spawnPackageLifecycleScripts(this.command_ctx, entry.list, log_level) catch |err| {
                        if (comptime log_level != .silent) {
                            const fmt = "\n<r><red>error:<r> failed to spawn life-cycle scripts for <b>{s}<r>: {s}\n";
                            const args = .{ name, @errorName(err) };

                            if (comptime log_level.showProgress()) {
                                switch (Output.enable_ansi_colors) {
                                    inline else => |enable_ansi_colors| {
                                        this.progress.log(comptime Output.prettyFmt(fmt, enable_ansi_colors), args);
                                    },
                                }
                            } else {
                                Output.prettyErrorln(fmt, args);
                            }
                        }

                        if (this.manager.options.enable.fail_early) {
                            Global.exit(1);
                        }

                        Output.flush();
                        this.summary.fail += 1;
                    };
                }
            }
        }

        pub fn completeRemainingScripts(this: *PackageInstaller, comptime log_level: Options.LogLevel) void {
            if (comptime Environment.isWindows) {
                return bun.todo(@src(), {});
            }
            for (this.pending_lifecycle_scripts.items) |entry| {
                const package_name = entry.list.first().package_name;
                while (LifecycleScriptSubprocess.alive_count.load(.Monotonic) >= this.manager.options.max_concurrent_lifecycle_scripts) {
                    if (PackageManager.verbose_install) {
                        if (PackageManager.hasEnoughTimePassedBetweenWaitingMessages()) Output.prettyErrorln("<d>[PackageManager]<r> waiting for {d} scripts\n", .{LifecycleScriptSubprocess.alive_count.load(.Monotonic)});
                    }

                    PackageManager.instance.sleep();
                }

                this.manager.spawnPackageLifecycleScripts(this.command_ctx, entry.list, log_level) catch |err| {
                    if (comptime log_level != .silent) {
                        const fmt = "\n<r><red>error:<r> failed to spawn life-cycle scripts for <b>{s}<r>: {s}\n";
                        const args = .{ package_name, @errorName(err) };

                        if (comptime log_level.showProgress()) {
                            switch (Output.enable_ansi_colors) {
                                inline else => |enable_ansi_colors| {
                                    this.progress.log(comptime Output.prettyFmt(fmt, enable_ansi_colors), args);
                                },
                            }
                        } else {
                            Output.prettyErrorln(fmt, args);
                        }
                    }

                    if (this.manager.options.enable.fail_early) {
                        Global.exit(1);
                    }

                    Output.flush();
                    this.summary.fail += 1;
                };
            }

            while (this.manager.pending_lifecycle_script_tasks.load(.Monotonic) > 0) {
                if (PackageManager.verbose_install) {
                    if (PackageManager.hasEnoughTimePassedBetweenWaitingMessages()) Output.prettyErrorln("<d>[PackageManager]<r> waiting for {d} scripts\n", .{LifecycleScriptSubprocess.alive_count.load(.Monotonic)});
                }

                if (comptime log_level.showProgress()) {
                    if (this.manager.scripts_node) |scripts_node| {
                        scripts_node.activate();
                        this.manager.progress.refresh();
                    }
                }

                PackageManager.instance.sleep();
            }
        }

        /// Check if a tree is ready to start running lifecycle scripts
        pub fn canRunScripts(this: *PackageInstaller, scripts_tree_id: Lockfile.Tree.Id) bool {
            const deps = this.tree_ids_to_trees_the_id_depends_on.at(scripts_tree_id);
            return (deps.subsetOf(this.completed_trees) or
                deps.eql(this.completed_trees)) and
                LifecycleScriptSubprocess.alive_count.load(.Monotonic) < this.manager.options.max_concurrent_lifecycle_scripts;
        }

        pub fn printTreeDeps(this: *PackageInstaller) void {
            for (this.tree_ids_to_trees_the_id_depends_on, 0..) |deps, j| {
                std.debug.print("tree #{d:3}: ", .{j});
                for (0..this.lockfile.buffers.trees.items.len) |tree_id| {
                    std.debug.print("{d} ", .{@intFromBool(deps.isSet(tree_id))});
                }
                std.debug.print("\n", .{});
            }
        }

        pub fn deinit(this: *PackageInstaller) void {
            const allocator = this.manager.allocator;
            this.pending_lifecycle_scripts.deinit(this.manager.allocator);
            this.completed_trees.deinit(allocator);
            allocator.free(this.tree_install_counts);
            this.tree_ids_to_trees_the_id_depends_on.deinit(allocator);
            this.node_modules_folder_path.deinit();
        }

        /// Call when you mutate the length of `lockfile.packages`
        pub fn fixCachedLockfilePackageSlices(this: *PackageInstaller) void {
            var packages = this.lockfile.packages.slice();
            this.metas = packages.items(.meta);
            this.names = packages.items(.name);
            this.bins = packages.items(.bin);
            this.resolutions = packages.items(.resolution);
            this.tree_iterator.reload(this.lockfile);
        }

        /// Install versions of a package which are waiting on a network request
        pub fn installEnqueuedPackages(
            this: *PackageInstaller,
            dependency_id: DependencyID,
            data: ExtractData,
            comptime log_level: Options.LogLevel,
        ) void {
            const package_id = this.lockfile.buffers.resolutions.items[dependency_id];
            const name = this.lockfile.str(&this.names[package_id]);
            const resolution = &this.resolutions[package_id];
            const task_id = switch (resolution.tag) {
                .git => Task.Id.forGitCheckout(data.url, data.resolved),
                .github => Task.Id.forTarball(data.url),
                .local_tarball => Task.Id.forTarball(this.lockfile.str(&resolution.value.local_tarball)),
                .remote_tarball => Task.Id.forTarball(this.lockfile.str(&resolution.value.remote_tarball)),
                .npm => Task.Id.forNPMPackage(name, resolution.value.npm.version),
                else => unreachable,
            };
            if (this.manager.task_queue.fetchRemove(task_id)) |removed| {
                var callbacks = removed.value;
                defer callbacks.deinit(this.manager.allocator);

                const prev_node_modules_folder = this.node_modules_folder;
                defer this.node_modules_folder = prev_node_modules_folder;
                const prev_tree_id = this.current_tree_id;
                defer this.current_tree_id = prev_tree_id;
                const prev_node_modules_folder_path = this.node_modules_folder_path;
                defer this.node_modules_folder_path = prev_node_modules_folder_path;
                for (callbacks.items) |cb| {
                    this.node_modules_folder = cb.node_modules_folder.fd.asDir();
                    this.current_tree_id = cb.node_modules_folder.tree_id;
                    this.node_modules_folder_path = cb.node_modules_folder.node_modules_folder_path;
                    this.installPackageWithNameAndResolution(dependency_id, package_id, log_level, name, resolution);
                    cb.node_modules_folder.node_modules_folder_path.deinit();
                }
            }
        }

        fn installPackageWithNameAndResolution(
            this: *PackageInstaller,
            dependency_id: PackageID,
            package_id: PackageID,
            comptime log_level: Options.LogLevel,
            name: string,
            resolution: *const Resolution,
        ) void {
            const buf = this.lockfile.buffers.string_bytes.items;

            const alias = this.lockfile.buffers.dependencies.items[dependency_id].name.slice(buf);
            const destination_dir_subpath: [:0]u8 = brk: {
                bun.copy(u8, &this.destination_dir_subpath_buf, alias);
                this.destination_dir_subpath_buf[alias.len] = 0;
                break :brk this.destination_dir_subpath_buf[0..alias.len :0];
            };

            var resolution_buf: [512]u8 = undefined;
            const extern_string_buf = this.lockfile.buffers.extern_strings.items;
            const resolution_label = std.fmt.bufPrint(&resolution_buf, "{}", .{resolution.fmt(buf)}) catch unreachable;
            var installer = PackageInstall{
                .progress = this.progress,
                .cache_dir = undefined,
                .cache_dir_subpath = undefined,
                .destination_dir = this.node_modules_folder,
                .destination_dir_subpath = destination_dir_subpath,
                .destination_dir_subpath_buf = &this.destination_dir_subpath_buf,
                .allocator = this.lockfile.allocator,
                .package_name = name,
                .package_version = resolution_label,
                // .install_order = this.tree_iterator.order,
            };

            switch (resolution.tag) {
                .npm => {
                    installer.cache_dir_subpath = this.manager.cachedNPMPackageFolderName(name, resolution.value.npm.version);
                    installer.cache_dir = this.manager.getCacheDirectory();
                },
                .git => {
                    installer.cache_dir_subpath = this.manager.cachedGitFolderName(&resolution.value.git);
                    installer.cache_dir = this.manager.getCacheDirectory();
                },
                .github => {
                    installer.cache_dir_subpath = this.manager.cachedGitHubFolderName(&resolution.value.github);
                    installer.cache_dir = this.manager.getCacheDirectory();
                },
                .folder => {
                    const folder = resolution.value.folder.slice(buf);
                    // Handle when a package depends on itself via file:
                    // example:
                    //   "mineflayer": "file:."
                    if (folder.len == 0 or (folder.len == 1 and folder[0] == '.')) {
                        installer.cache_dir_subpath = ".";
                    } else {
                        @memcpy(this.folder_path_buf[0..folder.len], folder);
                        this.folder_path_buf[folder.len] = 0;
                        installer.cache_dir_subpath = this.folder_path_buf[0..folder.len :0];
                    }
                    installer.cache_dir = std.fs.cwd();
                },
                .local_tarball => {
                    installer.cache_dir_subpath = this.manager.cachedTarballFolderName(resolution.value.local_tarball);
                    installer.cache_dir = this.manager.getCacheDirectory();
                },
                .remote_tarball => {
                    installer.cache_dir_subpath = this.manager.cachedTarballFolderName(resolution.value.remote_tarball);
                    installer.cache_dir = this.manager.getCacheDirectory();
                },
                .workspace => {
                    const folder = resolution.value.workspace.slice(buf);
                    // Handle when a package depends on itself
                    if (folder.len == 0 or (folder.len == 1 and folder[0] == '.')) {
                        installer.cache_dir_subpath = ".";
                    } else {
                        @memcpy(this.folder_path_buf[0..folder.len], folder);
                        this.folder_path_buf[folder.len] = 0;
                        installer.cache_dir_subpath = this.folder_path_buf[0..folder.len :0];
                    }
                    installer.cache_dir = std.fs.cwd();
                },
                .symlink => {
                    const directory = this.manager.globalLinkDir() catch |err| {
                        if (comptime log_level != .silent) {
                            const fmt = "\n<r><red>error:<r> unable to access global directory while installing <b>{s}<r>: {s}\n";
                            const args = .{ name, @errorName(err) };

                            if (comptime log_level.showProgress()) {
                                switch (Output.enable_ansi_colors) {
                                    inline else => |enable_ansi_colors| {
                                        this.progress.log(comptime Output.prettyFmt(fmt, enable_ansi_colors), args);
                                    },
                                }
                            } else {
                                Output.prettyErrorln(fmt, args);
                            }
                        }

                        if (this.manager.options.enable.fail_early) {
                            Global.exit(1);
                        }

                        Output.flush();
                        this.summary.fail += 1;
                        return;
                    };

                    const folder = resolution.value.symlink.slice(buf);

                    if (folder.len == 0 or (folder.len == 1 and folder[0] == '.')) {
                        installer.cache_dir_subpath = ".";
                        installer.cache_dir = std.fs.cwd();
                    } else {
                        const global_link_dir = this.manager.globalLinkDirPath() catch unreachable;
                        var ptr = &this.folder_path_buf;
                        var remain: []u8 = this.folder_path_buf[0..];
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
                        installer.cache_dir_subpath = this.folder_path_buf[0..len :0];
                        installer.cache_dir = directory;
                    }
                },
                else => return,
            }

            const needs_install = this.force_install or this.skip_verify_installed_version_number or !installer.verify(resolution, buf);
            this.summary.skipped += @intFromBool(!needs_install);

            if (needs_install) {
                const result: PackageInstall.Result = switch (resolution.tag) {
                    .symlink, .workspace => installer.installFromLink(this.skip_delete),
                    else => installer.install(this.skip_delete),
                };

                switch (result) {
                    .success => {
                        const is_duplicate = this.successfully_installed.isSet(package_id);
                        this.summary.success += @as(u32, @intFromBool(!is_duplicate));
                        this.successfully_installed.set(package_id);

                        if (comptime log_level.showProgress()) {
                            this.node.completeOne();
                        }

                        const bin = this.bins[package_id];
                        if (bin.tag != .none) {
                            const bin_task_id = Task.Id.forBinLink(package_id);
                            const task_queue = this.manager.task_queue.getOrPut(this.manager.allocator, bin_task_id) catch unreachable;
                            if (!task_queue.found_existing) {
                                var bin_linker = Bin.Linker{
                                    .bin = bin,
                                    .package_installed_node_modules = bun.toFD(this.node_modules_folder.fd),
                                    .global_bin_path = this.options.bin_path,
                                    .global_bin_dir = this.options.global_bin_dir,

                                    // .destination_dir_subpath = destination_dir_subpath,
                                    .root_node_modules_folder = bun.toFD(this.root_node_modules_folder.fd),
                                    .package_name = strings.StringOrTinyString.init(alias),
                                    .string_buf = buf,
                                    .extern_string_buf = extern_string_buf,
                                };

                                bin_linker.link(this.manager.options.global);
                                if (bin_linker.err) |err| {
                                    if (comptime log_level != .silent) {
                                        const fmt = "\n<r><red>error:<r> linking <b>{s}<r>: {s}\n";
                                        const args = .{ alias, @errorName(err) };

                                        if (comptime log_level.showProgress()) {
                                            switch (Output.enable_ansi_colors) {
                                                inline else => |enable_ansi_colors| {
                                                    this.progress.log(comptime Output.prettyFmt(fmt, enable_ansi_colors), args);
                                                },
                                            }
                                        } else {
                                            Output.prettyErrorln(fmt, args);
                                        }
                                    }

                                    if (this.manager.options.enable.fail_early) {
                                        installer.uninstall();
                                        Global.crash();
                                    }
                                }
                            }
                        }

                        if (resolution.tag == .workspace or this.lockfile.hasTrustedDependency(alias)) {
                            this.enqueuePackageScriptsToLockfile(
                                alias,
                                log_level,
                                package_id,
                                destination_dir_subpath,
                                resolution,
                            );
                        }

                        this.incrementTreeInstallCount(this.current_tree_id, log_level);
                    },
                    .fail => |cause| {
                        if (cause.isPackageMissingFromCache()) {
                            const context: TaskCallbackContext = .{
                                .node_modules_folder = .{
                                    .fd = bun.toFD(this.node_modules_folder.fd),
                                    .tree_id = this.current_tree_id,
                                    .node_modules_folder_path = this.node_modules_folder_path.clone() catch bun.outOfMemory(),
                                },
                            };
                            switch (resolution.tag) {
                                .git => {
                                    this.manager.enqueueGitForCheckout(
                                        dependency_id,
                                        alias,
                                        resolution,
                                        context,
                                    );
                                },
                                .github => {
                                    const url = this.manager.allocGitHubURL(&resolution.value.github);
                                    defer this.manager.allocator.free(url);
                                    this.manager.enqueueTarballForDownload(
                                        dependency_id,
                                        package_id,
                                        url,
                                        context,
                                    );
                                },
                                .local_tarball => {
                                    this.manager.enqueueTarballForReading(
                                        dependency_id,
                                        alias,
                                        resolution,
                                        context,
                                    );
                                },
                                .remote_tarball => {
                                    this.manager.enqueueTarballForDownload(
                                        dependency_id,
                                        package_id,
                                        resolution.value.remote_tarball.slice(buf),
                                        context,
                                    );
                                },
                                .npm => {
                                    if (comptime Environment.allow_assert) std.debug.assert(!resolution.value.npm.url.isEmpty());
                                    this.manager.enqueuePackageForDownload(
                                        name,
                                        dependency_id,
                                        package_id,
                                        resolution.value.npm.version,
                                        resolution.value.npm.url.slice(buf),
                                        context,
                                    );
                                },
                                else => {
                                    Output.prettyErrorln(
                                        "<r><red>error<r>: <b><red>{s}<r> installing <b>{s}<r>",
                                        .{ @errorName(cause.err), this.names[package_id].slice(buf) },
                                    );
                                    this.summary.fail += 1;
                                },
                            }
                        } else if (cause.err == error.DanglingSymlink) {
                            Output.prettyErrorln(
                                "<r><red>error<r>: <b>{s}<r> \"link:{s}\" not found (try running 'bun link' in the intended package's folder)<r>",
                                .{ @errorName(cause.err), this.names[package_id].slice(buf) },
                            );
                            this.summary.fail += 1;
                        } else if (cause.err == error.AccessDenied) {
                            // there are two states this can happen
                            // - Access Denied because node_modules/ is unwritable
                            // - Access Denied because this specific package is unwritable
                            // in the case of the former, the logs are extremely noisy, so we
                            // will exit early, otherwise set a flag to not re-stat
                            const Singleton = struct {
                                var node_modules_is_ok = false;
                            };
                            if (!Singleton.node_modules_is_ok) {
                                const stat = bun.sys.fstat(bun.toFD(this.node_modules_folder.fd)).unwrap() catch |err| {
                                    Output.err("EACCES", "Permission denied while installing <b>{s}<r>", .{
                                        this.names[package_id].slice(buf),
                                    });
                                    if (Environment.isDebug) {
                                        Output.err(err, "Failed to stat node_modules", .{});
                                    }
                                    Global.exit(1);
                                };

                                const is_writable = if (Environment.isWindows or stat.uid == bun.C.getuid())
                                    stat.mode & bun.S.IWUSR > 0
                                else if (stat.gid == bun.C.getgid())
                                    stat.mode & bun.S.IWGRP > 0
                                else
                                    stat.mode & bun.S.IWOTH > 0;

                                if (!is_writable) {
                                    Output.err("EACCES", "Permission denied while writing packages into node_modules.", .{});
                                    Global.exit(1);
                                }
                                Singleton.node_modules_is_ok = true;
                            }

                            Output.err("EACCES", "Permission denied while installing <b>{s}<r>", .{
                                this.names[package_id].slice(buf),
                            });

                            this.summary.fail += 1;
                        } else {
                            Output.prettyErrorln(
                                "<r><red>error<r>: <b><red>{s}<r> installing <b>{s}<r>",
                                .{ @errorName(cause.err), this.names[package_id].slice(buf) },
                            );
                            this.summary.fail += 1;
                        }
                    },
                    else => {},
                }
            } else {
                if (this.manager.summary.new_trusted_dependencies.contains(@truncate(String.Builder.stringHash(alias)))) {
                    // these are packages that are installed but haven't run lifecycle scripts because they weren't
                    // in `trustedDependencies`
                    this.enqueuePackageScriptsToLockfile(
                        alias,
                        log_level,
                        package_id,
                        destination_dir_subpath,
                        resolution,
                    );
                }

                this.incrementTreeInstallCount(this.current_tree_id, log_level);
            }
        }

        fn enqueuePackageScriptsToLockfile(
            this: *PackageInstaller,
            folder_name: string,
            comptime log_level: Options.LogLevel,
            package_id: PackageID,
            destination_dir_subpath: [:0]const u8,
            resolution: *const Resolution,
        ) void {
            const buf = this.lockfile.buffers.string_bytes.items;
            var scripts: Package.Scripts = this.lockfile.packages.items(.scripts)[package_id];
            var path_buf_to_use: [bun.MAX_PATH_BYTES * 2]u8 = undefined;

            if (scripts.hasAny()) {
                const add_node_gyp_rebuild_script = if (this.lockfile.hasTrustedDependency(folder_name) and
                    scripts.install.isEmpty() and
                    scripts.postinstall.isEmpty())
                brk: {
                    const binding_dot_gyp_path = Path.joinAbsStringZ(
                        this.node_modules_folder_path.items,
                        &[_]string{ folder_name, "binding.gyp" },
                        .auto,
                    );

                    break :brk Syscall.exists(binding_dot_gyp_path);
                } else false;

                const cwd = Path.joinAbsStringBufZTrailingSlash(
                    this.node_modules_folder_path.items,
                    &path_buf_to_use,
                    &[_]string{destination_dir_subpath},
                    .auto,
                );

                if (scripts.enqueue(
                    this.lockfile,
                    buf,
                    cwd,
                    folder_name,
                    resolution.tag,
                    add_node_gyp_rebuild_script,
                )) |scripts_list| {
                    if (this.manager.options.do.run_scripts) {
                        this.manager.total_scripts += scripts_list.total;
                        if (this.manager.scripts_node) |scripts_node| {
                            this.manager.setNodeName(
                                scripts_node,
                                scripts_list.items[scripts_list.first_index].?.package_name,
                                PackageManager.ProgressStrings.script_emoji,
                                true,
                            );
                            scripts_node.setEstimatedTotalItems(scripts_node.unprotected_estimated_total_items + scripts_list.total);
                        }
                        this.pending_lifecycle_scripts.append(this.manager.allocator, .{
                            .list = scripts_list,
                            .tree_id = this.current_tree_id,
                        }) catch bun.outOfMemory();
                    }
                }
            } else if (!scripts.filled) {
                const scripts_list = scripts.enqueueFromPackageJSON(
                    this.manager.log,
                    this.lockfile,
                    this.node_modules_folder,
                    this.node_modules_folder_path.items,
                    destination_dir_subpath,
                    folder_name,
                    resolution,
                ) catch |err| {
                    if (comptime log_level != .silent) {
                        const fmt = "\n<r><red>error:<r> failed to parse life-cycle scripts for <b>{s}<r>: {s}\n";
                        const args = .{ folder_name, @errorName(err) };

                        if (comptime log_level.showProgress()) {
                            switch (Output.enable_ansi_colors) {
                                inline else => |enable_ansi_colors| {
                                    this.progress.log(comptime Output.prettyFmt(fmt, enable_ansi_colors), args);
                                },
                            }
                        } else {
                            Output.prettyErrorln(fmt, args);
                        }
                    }

                    if (this.manager.options.enable.fail_early) {
                        Global.exit(1);
                    }

                    Output.flush();
                    this.summary.fail += 1;
                    return;
                };

                if (this.manager.options.do.run_scripts) {
                    if (scripts_list) |list| {
                        this.manager.total_scripts += list.total;
                        if (this.manager.scripts_node) |scripts_node| {
                            this.manager.setNodeName(
                                scripts_node,
                                list.items[list.first_index].?.package_name,
                                PackageManager.ProgressStrings.script_emoji,
                                true,
                            );
                            scripts_node.setEstimatedTotalItems(scripts_node.unprotected_estimated_total_items + list.total);
                        }
                        this.pending_lifecycle_scripts.append(this.manager.allocator, .{
                            .list = list,
                            .tree_id = this.current_tree_id,
                        }) catch bun.outOfMemory();
                    }
                }
            }
        }

        pub fn installPackage(
            this: *PackageInstaller,
            dependency_id: DependencyID,
            comptime log_level: Options.LogLevel,
        ) void {
            const package_id = this.lockfile.buffers.resolutions.items[dependency_id];
            const meta = &this.metas[package_id];

            if (meta.isDisabled()) {
                if (comptime log_level.showProgress()) {
                    this.node.completeOne();
                }
                this.incrementTreeInstallCount(this.current_tree_id, log_level);
                return;
            }

            const name = this.lockfile.str(&this.names[package_id]);
            const resolution = &this.resolutions[package_id];

            this.installPackageWithNameAndResolution(dependency_id, package_id, log_level, name, resolution);
        }
    };

    pub fn enqueueGitForCheckout(
        this: *PackageManager,
        dependency_id: DependencyID,
        alias: string,
        resolution: *const Resolution,
        task_context: TaskCallbackContext,
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
            this.task_batch.push(ThreadPool.Batch.from(this.enqueueGitCheckout(
                checkout_id,
                repo_fd,
                dependency_id,
                alias,
                resolution.*,
                resolved,
            )));
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

            this.task_batch.push(ThreadPool.Batch.from(this.enqueueGitClone(clone_id, alias, repository)));
        }
    }

    pub fn enqueuePackageForDownload(
        this: *PackageManager,
        name: []const u8,
        dependency_id: DependencyID,
        package_id: PackageID,
        version: Semver.Version,
        url: []const u8,
        task_context: TaskCallbackContext,
    ) void {
        const task_id = Task.Id.forNPMPackage(name, version);
        var task_queue = this.task_queue.getOrPut(this.allocator, task_id) catch unreachable;
        if (!task_queue.found_existing) {
            task_queue.value_ptr.* = .{};
        }

        task_queue.value_ptr.append(
            this.allocator,
            task_context,
        ) catch unreachable;

        if (task_queue.found_existing) return;

        if (this.generateNetworkTaskForTarball(
            task_id,
            url,
            dependency_id,
            this.lockfile.packages.get(package_id),
        ) catch unreachable) |task| {
            task.schedule(&this.network_tarball_batch);
            if (this.network_tarball_batch.len > 0) {
                _ = this.scheduleTasks();
            }
        }
    }

    pub fn enqueueTarballForDownload(
        this: *PackageManager,
        dependency_id: DependencyID,
        package_id: PackageID,
        url: string,
        task_context: TaskCallbackContext,
    ) void {
        const task_id = Task.Id.forTarball(url);
        var task_queue = this.task_queue.getOrPut(this.allocator, task_id) catch unreachable;
        if (!task_queue.found_existing) {
            task_queue.value_ptr.* = .{};
        }

        task_queue.value_ptr.append(
            this.allocator,
            task_context,
        ) catch unreachable;

        if (task_queue.found_existing) return;

        if (this.generateNetworkTaskForTarball(
            task_id,
            url,
            dependency_id,
            this.lockfile.packages.get(package_id),
        ) catch unreachable) |task| {
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

    pub fn installPackages(
        this: *PackageManager,
        ctx: Command.Context,
        comptime log_level: PackageManager.Options.LogLevel,
    ) !PackageInstall.Summary {
        const original_lockfile = this.lockfile;
        defer this.lockfile = original_lockfile;
        if (!this.options.local_package_features.dev_dependencies) {
            this.lockfile = try this.lockfile.maybeCloneFilteringRootPackages(
                this.options.local_package_features,
                this.options.enable.exact_versions,
            );
        }

        const root_lifecycle_scripts_count = brk: {
            if (this.options.do.run_scripts and
                this.options.do.install_packages and
                this.root_lifecycle_scripts != null)
            {
                var counter: usize = 0;

                for (this.root_lifecycle_scripts.?.items) |item| {
                    if (item != null) counter += 1;
                }

                this.total_scripts += counter;
                break :brk counter;
            }
            break :brk 0;
        };

        var root_node: *Progress.Node = undefined;
        var download_node: Progress.Node = undefined;
        var install_node: Progress.Node = undefined;
        var scripts_node: Progress.Node = undefined;
        const options = &this.options;
        var progress = &this.progress;

        if (comptime log_level.showProgress()) {
            root_node = progress.start("", 0);
            progress.supports_ansi_escape_codes = Output.enable_ansi_colors_stderr;
            download_node = root_node.start(ProgressStrings.download(), 0);

            install_node = root_node.start(ProgressStrings.install(), this.lockfile.packages.len);
            scripts_node = root_node.start(ProgressStrings.script(), root_lifecycle_scripts_count);
            this.downloads_node = &download_node;
            this.scripts_node = &scripts_node;
        }

        defer {
            if (comptime log_level.showProgress()) {
                progress.root.end();
                progress.* = .{};
            }
        }

        // If there was already a valid lockfile and so we did not resolve, i.e. there was zero network activity
        // the packages could still not be in the cache dir
        // this would be a common scenario in a CI environment
        // or if you just cloned a repo
        // we want to check lazily though
        // no need to download packages you've already installed!!
        var skip_verify_installed_version_number = false;
        const cwd = std.fs.cwd();
        const node_modules_folder = bun.openDir(cwd, "node_modules") catch brk: {
            skip_verify_installed_version_number = true;
            bun.sys.mkdir("node_modules", 0o755).unwrap() catch |err| {
                if (err != error.EEXIST) {
                    Output.prettyErrorln("<r><red>error<r>: <b><red>{s}<r> creating <b>node_modules<r> folder", .{@errorName(err)});
                    Global.crash();
                }
            };
            break :brk bun.openDir(cwd, "node_modules") catch |err| {
                Output.prettyErrorln("<r><red>error<r>: <b><red>{s}<r> opening <b>node_modules<r> folder", .{@errorName(err)});
                Global.crash();
            };
        };

        var skip_delete = skip_verify_installed_version_number;

        if (options.enable.force_install) {
            skip_verify_installed_version_number = true;
            skip_delete = false;

            // TODO(dylan-conway): depth first installation
            // var node_modules_iter = node_modules_folder.iterateAssumeFirstIteration();
            // defer node_modules_iter.reset();
            // while (try node_modules_iter.next()) |entry| {
            //     if (entry.kind != .directory or !strings.eqlComptime(entry.name, ".cache")) {
            //         node_modules_folder.deleteTree(entry.name) catch {};
            //     }
            // }
        }

        var summary = PackageInstall.Summary{};

        {
            var iterator = Lockfile.Tree.Iterator.init(this.lockfile);
            if (comptime Environment.isPosix) {
                Bin.Linker.ensureUmask();
            }
            var installer: PackageInstaller = brk: {
                // These slices potentially get resized during iteration
                // so we want to make sure they're not accessible to the rest of this function
                // to make mistakes harder
                var parts = this.lockfile.packages.slice();

                const completed_trees, const tree_ids_to_trees_the_id_depends_on, const tree_install_counts = trees: {
                    const trees = this.lockfile.buffers.trees.items;
                    const completed_trees = try Bitset.initEmpty(this.allocator, trees.len);
                    var tree_ids_to_trees_the_id_depends_on = try Bitset.List.initEmpty(this.allocator, trees.len, trees.len);

                    {
                        // For each tree id, traverse through it's parents and mark all visited tree
                        // ids as dependents for the current tree parent
                        var deps = try Bitset.initEmpty(this.allocator, trees.len);
                        defer deps.deinit(this.allocator);
                        for (trees) |_curr| {
                            var curr = _curr;
                            tree_ids_to_trees_the_id_depends_on.set(curr.id, curr.id);

                            while (curr.parent != Lockfile.Tree.invalid_id) {
                                deps.set(curr.id);
                                tree_ids_to_trees_the_id_depends_on.setUnion(curr.parent, deps);
                                curr = trees[curr.parent];
                            }

                            deps.setAll(false);
                        }
                    }

                    const tree_install_counts = try this.allocator.alloc(usize, trees.len);
                    @memset(tree_install_counts, 0);

                    if (comptime Environment.allow_assert) {
                        if (trees.len > 0) {
                            // last tree should not depend on another except for itself
                            std.debug.assert(tree_ids_to_trees_the_id_depends_on.at(trees.len - 1).count() == 1 and tree_ids_to_trees_the_id_depends_on.at(trees.len - 1).isSet(trees.len - 1));
                            // root tree should always depend on all trees
                            std.debug.assert(tree_ids_to_trees_the_id_depends_on.at(0).count() == trees.len);
                        }

                        // a tree should always depend on itself
                        for (0..trees.len) |j| {
                            std.debug.assert(tree_ids_to_trees_the_id_depends_on.at(j).isSet(j));
                        }
                    }

                    break :trees .{
                        completed_trees,
                        tree_ids_to_trees_the_id_depends_on,
                        tree_install_counts,
                    };
                };

                break :brk PackageInstaller{
                    .manager = this,
                    .options = &this.options,
                    .metas = parts.items(.meta),
                    .bins = parts.items(.bin),
                    .root_node_modules_folder = node_modules_folder,
                    .names = parts.items(.name),
                    .resolutions = parts.items(.resolution),
                    .lockfile = this.lockfile,
                    .node = &install_node,
                    .node_modules_folder = node_modules_folder,
                    .node_modules_folder_path = std.ArrayList(u8).fromOwnedSlice(
                        this.allocator,
                        try this.allocator.dupe(
                            u8,
                            strings.withoutTrailingSlash(FileSystem.instance.top_level_dir),
                        ),
                    ),
                    .progress = progress,
                    .skip_verify_installed_version_number = skip_verify_installed_version_number,
                    .skip_delete = skip_delete,
                    .summary = &summary,
                    .global_bin_dir = this.options.global_bin_dir,
                    .force_install = options.enable.force_install,
                    .successfully_installed = try Bitset.initEmpty(
                        this.allocator,
                        this.lockfile.packages.len,
                    ),
                    .tree_iterator = &iterator,
                    .command_ctx = ctx,
                    .tree_ids_to_trees_the_id_depends_on = tree_ids_to_trees_the_id_depends_on,
                    .completed_trees = completed_trees,
                    .tree_install_counts = tree_install_counts,
                };
            };

            try installer.node_modules_folder_path.append(std.fs.path.sep);

            // installer.printTreeDeps();

            defer installer.deinit();

            while (iterator.nextNodeModulesFolder(&installer.completed_trees)) |node_modules| {
                installer.node_modules_folder_path.items.len = strings.withoutTrailingSlash(FileSystem.instance.top_level_dir).len + 1;
                try installer.node_modules_folder_path.appendSlice(node_modules.relative_path);

                // We deliberately do not close this folder.
                // If the package hasn't been downloaded, we will need to install it later
                // We use this file descriptor to know where to put it.
                installer.node_modules_folder = bun.openDir(cwd, node_modules.relative_path) catch brk: {
                    // Avoid extra mkdir() syscall
                    //
                    // note: this will recursively delete any dangling symlinks
                    // in the next.js repo, it encounters a dangling symlink in node_modules/@next/codemod/node_modules/cheerio
                    try bun.makePath(cwd, bun.span(node_modules.relative_path));
                    break :brk try bun.openDir(cwd, node_modules.relative_path);
                };

                var remaining = node_modules.dependencies;

                installer.current_tree_id = node_modules.tree_id;

                if (comptime Environment.allow_assert) {
                    std.debug.assert(node_modules.dependencies.len == this.lockfile.buffers.trees.items[installer.current_tree_id].dependencies.len);
                }

                // cache line is 64 bytes on ARM64 and x64
                // PackageIDs are 4 bytes
                // Hence, we can fit up to 64 / 4 = 16 package IDs in a cache line
                const unroll_count = comptime 64 / @sizeOf(PackageID);

                while (remaining.len > unroll_count) {
                    comptime var i: usize = 0;
                    inline while (i < unroll_count) : (i += 1) {
                        installer.installPackage(remaining[i], comptime log_level);
                    }
                    remaining = remaining[unroll_count..];

                    // We want to minimize how often we call this function
                    // That's part of why we unroll this loop
                    if (this.pending_tasks > 0) {
                        try this.runTasks(
                            *PackageInstaller,
                            &installer,
                            .{
                                .onExtract = PackageInstaller.installEnqueuedPackages,
                                .onResolve = {},
                                .onPackageManifestError = {},
                                .onPackageDownloadError = {},
                            },
                            true,
                            log_level,
                        );
                        if (!installer.options.do.install_packages) return error.InstallFailed;
                    }

                    this.tickLifecycleScripts();
                }

                for (remaining) |dependency_id| {
                    installer.installPackage(dependency_id, log_level);
                }

                try this.runTasks(
                    *PackageInstaller,
                    &installer,
                    .{
                        .onExtract = PackageInstaller.installEnqueuedPackages,
                        .onResolve = {},
                        .onPackageManifestError = {},
                        .onPackageDownloadError = {},
                    },
                    true,
                    log_level,
                );
                if (!installer.options.do.install_packages) return error.InstallFailed;

                this.tickLifecycleScripts();
            }

            while (this.pending_tasks > 0 and installer.options.do.install_packages) {
                try this.runTasks(
                    *PackageInstaller,
                    &installer,
                    .{
                        .onExtract = PackageInstaller.installEnqueuedPackages,
                        .onResolve = {},
                        .onPackageManifestError = {},
                        .onPackageDownloadError = {},
                    },
                    true,
                    log_level,
                );

                if (PackageManager.verbose_install and PackageManager.instance.pending_tasks > 0) {
                    if (PackageManager.hasEnoughTimePassedBetweenWaitingMessages()) Output.prettyErrorln("<d>[PackageManager]<r> waiting for {d} tasks\n", .{PackageManager.instance.pending_tasks});
                }

                if (this.pending_tasks > 0)
                    this.sleep()
                else
                    this.tickLifecycleScripts();
            } else {
                this.tickLifecycleScripts();
            }

            this.finished_installing.store(true, .Monotonic);
            if (comptime log_level.showProgress()) {
                scripts_node.activate();
            }

            if (!installer.options.do.install_packages) return error.InstallFailed;

            summary.successfully_installed = installer.successfully_installed;

            installer.completeRemainingScripts(log_level);

            if (root_lifecycle_scripts_count > 0) {
                // root lifecycle scripts can run now that all dependencies are installed
                // and their lifecycle script have finished
                try this.spawnPackageLifecycleScripts(ctx, this.root_lifecycle_scripts.?, log_level);
            }

            while (this.pending_lifecycle_script_tasks.load(.Monotonic) > 0) {
                if (PackageManager.verbose_install) {
                    if (PackageManager.hasEnoughTimePassedBetweenWaitingMessages()) Output.prettyErrorln("<d>[PackageManager]<r> waiting for {d} scripts\n", .{this.pending_lifecycle_script_tasks.load(.Monotonic)});
                }

                PackageManager.instance.sleep();
            }

            if (comptime log_level.showProgress()) {
                scripts_node.end();
            }
        }

        return summary;
    }

    pub fn setupGlobalDir(manager: *PackageManager, ctx: *const Command.Context) !void {
        manager.options.global_bin_dir = try Options.openGlobalBinDir(ctx.install);
        var out_buffer: [bun.MAX_PATH_BYTES]u8 = undefined;
        const result = try bun.getFdPath(manager.options.global_bin_dir.fd, &out_buffer);
        out_buffer[result.len] = 0;
        const result_: [:0]u8 = out_buffer[0..result.len :0];
        manager.options.bin_path = bun.cstring(try FileSystem.instance.dirname_store.append([:0]u8, result_));
    }

    pub fn startProgressBarIfNone(manager: *PackageManager) void {
        if (manager.downloads_node == null) {
            manager.startProgressBar();
        }
    }
    pub fn startProgressBar(manager: *PackageManager) void {
        manager.downloads_node = manager.progress.start(ProgressStrings.download(), 0);
        manager.progress.supports_ansi_escape_codes = Output.enable_ansi_colors_stderr;
        manager.setNodeName(manager.downloads_node.?, ProgressStrings.download_no_emoji_, ProgressStrings.download_emoji, true);
        manager.downloads_node.?.setEstimatedTotalItems(manager.total_tasks + manager.extracted_count);
        manager.downloads_node.?.setCompletedItems(manager.total_tasks - manager.pending_tasks);
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

    fn installWithManager(
        manager: *PackageManager,
        ctx: Command.Context,
        package_json_contents: string,
        comptime log_level: Options.LogLevel,
    ) !void {
        // sleep off for maximum network throughput

        var load_lockfile_result: Lockfile.LoadFromDiskResult = if (manager.options.do.load_lockfile)
            manager.lockfile.loadFromDisk(
                ctx.allocator,
                ctx.log,
                manager.options.lockfile_path,
            )
        else
            .{ .not_found = {} };

        var root = Lockfile.Package{};
        var needs_new_lockfile = load_lockfile_result != .ok or
            (load_lockfile_result.ok.lockfile.buffers.dependencies.items.len == 0 and manager.package_json_updates.len > 0);

        manager.options.enable.force_save_lockfile = manager.options.enable.force_save_lockfile or (load_lockfile_result == .ok and load_lockfile_result.ok.was_migrated);

        // this defaults to false
        // but we force allowing updates to the lockfile when you do bun add
        var had_any_diffs = false;
        manager.progress = .{};

        // Step 2. Parse the package.json file
        const package_json_source = logger.Source.initPathString(package_json_cwd, package_json_contents);

        switch (load_lockfile_result) {
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

                    if (ctx.log.errors > 0) {
                        switch (Output.enable_ansi_colors) {
                            inline else => |enable_ansi_colors| {
                                try manager.log.printForLogLevelWithEnableAnsiColors(Output.errorWriter(), enable_ansi_colors);
                            },
                        }
                    }
                    Output.flush();
                }

                if (manager.options.enable.fail_early) Global.crash();
            },
            .ok => {
                differ: {
                    root = load_lockfile_result.ok.lockfile.rootPackage() orelse {
                        needs_new_lockfile = true;
                        break :differ;
                    };

                    if (root.dependencies.len == 0) {
                        needs_new_lockfile = true;
                    }

                    if (needs_new_lockfile) break :differ;

                    var lockfile: Lockfile = undefined;
                    try lockfile.initEmpty(ctx.allocator);
                    var maybe_root = Lockfile.Package{};

                    try maybe_root.parseMain(
                        &lockfile,
                        ctx.allocator,
                        ctx.log,
                        package_json_source,
                        Features.main,
                    );
                    const mapping = try manager.lockfile.allocator.alloc(PackageID, maybe_root.dependencies.len);
                    @memset(mapping, invalid_package_id);

                    manager.summary = try Package.Diff.generate(
                        ctx.allocator,
                        ctx.log,
                        manager.lockfile,
                        &lockfile,
                        &root,
                        &maybe_root,
                        if (manager.to_update) manager.package_json_updates else null,
                        mapping,
                    );

                    had_any_diffs = had_any_diffs or manager.summary.hasDiffs();

                    if (manager.summary.new_trusted_dependencies.count() > 0) {
                        needs_new_lockfile = true;
                    }

                    if (had_any_diffs) {
                        var builder_ = manager.lockfile.stringBuilder();
                        // ensure we use one pointer to reference it instead of creating new ones and potentially aliasing
                        var builder = &builder_;
                        // If you changed packages, we will copy over the new package from the new lockfile
                        const new_dependencies = maybe_root.dependencies.get(lockfile.buffers.dependencies.items);

                        for (new_dependencies) |new_dep| {
                            new_dep.count(lockfile.buffers.string_bytes.items, *Lockfile.StringBuilder, builder);
                        }

                        lockfile.overrides.count(&lockfile, builder);

                        maybe_root.scripts.count(lockfile.buffers.string_bytes.items, *Lockfile.StringBuilder, builder);

                        const off = @as(u32, @truncate(manager.lockfile.buffers.dependencies.items.len));
                        const len = @as(u32, @truncate(new_dependencies.len));
                        var packages = manager.lockfile.packages.slice();
                        var dep_lists = packages.items(.dependencies);
                        var resolution_lists = packages.items(.resolutions);
                        const old_resolutions_list = resolution_lists[0];
                        dep_lists[0] = .{ .off = off, .len = len };
                        resolution_lists[0] = .{ .off = off, .len = len };
                        manager.root_dependency_list = dep_lists[0];
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

                        manager.lockfile.overrides = try lockfile.overrides.clone(&lockfile, manager.lockfile, builder);

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
                            dependencies[i] = try new_dep.clone(lockfile.buffers.string_bytes.items, *Lockfile.StringBuilder, builder);
                            if (mapping[i] != invalid_package_id) {
                                resolutions[i] = old_resolutions[mapping[i]];
                            }
                        }

                        if (manager.summary.overrides_changed and all_name_hashes.len > 0) {
                            for (manager.lockfile.buffers.dependencies.items, 0..) |*dependency, dependency_i| {
                                if (std.mem.indexOfScalar(PackageNameHash, all_name_hashes, dependency.name_hash)) |_| {
                                    manager.lockfile.buffers.resolutions.items[dependency_i] = invalid_package_id;
                                    try manager.enqueueDependencyWithMain(
                                        @truncate(dependency_i),
                                        dependency,
                                        manager.lockfile.buffers.resolutions.items[dependency_i],
                                        false,
                                    );
                                }
                            }
                        }

                        manager.lockfile.packages.items(.scripts)[0] = maybe_root.scripts.clone(
                            lockfile.buffers.string_bytes.items,
                            *Lockfile.StringBuilder,
                            builder,
                        );

                        builder.clamp();

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
            try manager.lockfile.initEmpty(ctx.allocator);

            if (manager.options.enable.frozen_lockfile) {
                if (comptime log_level != .silent) {
                    Output.prettyErrorln("<r><red>error<r>: lockfile had changes, but lockfile is frozen", .{});
                }
                Global.crash();
            }

            try root.parseMain(
                manager.lockfile,
                ctx.allocator,
                ctx.log,
                package_json_source,
                Features.main,
            );

            root = try manager.lockfile.appendPackage(root);

            manager.root_dependency_list = root.dependencies;

            if (root.dependencies.len > 0) {
                _ = manager.getCacheDirectory();
                _ = manager.getTemporaryDirectory();
            }
            manager.enqueueDependencyList(root.dependencies);
        } else {
            // Anything that needs to be downloaded from an update needs to be scheduled here
            manager.drainDependencyList();
        }

        if (manager.pending_tasks > 0 or manager.peer_dependencies.readableLength() > 0) {
            if (root.dependencies.len > 0) {
                _ = manager.getCacheDirectory();
                _ = manager.getTemporaryDirectory();
            }

            if (comptime log_level.showProgress()) {
                manager.startProgressBar();
            } else if (comptime log_level != .silent) {
                Output.prettyErrorln(" Resolving dependencies", .{});
                Output.flush();
            }

            while (manager.pending_tasks > 0) {
                try manager.runTasks(
                    *PackageManager,
                    manager,
                    .{
                        .onExtract = {},
                        .onResolve = {},
                        .onPackageManifestError = {},
                        .onPackageDownloadError = {},
                        .progress_bar = true,
                    },
                    false,
                    log_level,
                );

                if (PackageManager.verbose_install and manager.pending_tasks > 0) {
                    if (PackageManager.hasEnoughTimePassedBetweenWaitingMessages()) Output.prettyErrorln("<d>[PackageManager]<r> waiting for {d} tasks\n", .{manager.pending_tasks});
                }

                if (manager.pending_tasks > 0)
                    manager.sleep();
            }

            if (manager.options.do.install_peer_dependencies) {
                while (manager.pending_tasks > 0 or manager.peer_dependencies.readableLength() > 0) {
                    try manager.processPeerDependencyList();

                    manager.drainDependencyList();

                    try manager.runTasks(
                        *PackageManager,
                        manager,
                        .{
                            .onExtract = {},
                            .onResolve = {},
                            .onPackageManifestError = {},
                            .onPackageDownloadError = {},
                            .progress_bar = true,
                        },
                        true,
                        log_level,
                    );

                    if (PackageManager.verbose_install and manager.pending_tasks > 0) {
                        if (PackageManager.hasEnoughTimePassedBetweenWaitingMessages()) Output.prettyErrorln("<d>[PackageManager]<r> waiting for {d} tasks\n", .{manager.pending_tasks});
                    }

                    if (manager.pending_tasks > 0)
                        manager.sleep();
                }
            }

            if (comptime log_level.showProgress()) {
                manager.endProgressBar();
            } else if (comptime log_level != .silent) {
                Output.prettyErrorln(" Resolved, downloaded and extracted [{d}]", .{manager.total_tasks});
                Output.flush();
            }
        }

        switch (Output.enable_ansi_colors) {
            inline else => |enable_ansi_colors| {
                try manager.log.printForLogLevelWithEnableAnsiColors(Output.errorWriter(), enable_ansi_colors);
            },
        }

        if (manager.log.hasErrors()) Global.crash();

        // This operation doesn't perform any I/O, so it should be relatively cheap.
        manager.lockfile = try manager.lockfile.cleanWithLogger(
            manager.package_json_updates,
            manager.log,
            manager.options.enable.exact_versions,
        );
        if (manager.lockfile.packages.len > 0) {
            root = manager.lockfile.packages.get(0);
        }

        if (manager.lockfile.packages.len > 0) {
            for (manager.package_json_updates) |request| {
                // prevent redundant errors
                if (request.failed) {
                    return error.InstallFailed;
                }
            }
            manager.root_dependency_list = manager.lockfile.packages.items(.dependencies)[0];
            manager.lockfile.verifyResolutions(manager.options.local_package_features, manager.options.remote_package_features, log_level);
        }

        const did_meta_hash_change = try manager.lockfile.hasMetaHashChanged(
            PackageManager.verbose_install or manager.options.do.print_meta_hash_string,
        );

        const should_save_lockfile = did_meta_hash_change or had_any_diffs or needs_new_lockfile or manager.package_json_updates.len > 0;

        if (manager.options.global) {
            try manager.setupGlobalDir(&ctx);
        }

        if (did_meta_hash_change and manager.options.enable.frozen_lockfile) {
            if (comptime log_level != .silent) {
                Output.prettyErrorln("<r><red>error<r><d>:<r> lockfile had changes, but lockfile is frozen", .{});
                Output.note("try re-running without <d>--frozen-lockfile<r> and commit the updated lockfile", .{});
            }
            Global.crash();
        }

        // It's unnecessary work to re-save the lockfile if there are no changes
        if (manager.options.do.save_lockfile and
            (should_save_lockfile or manager.lockfile.isEmpty() or manager.options.enable.force_save_lockfile))
        save: {
            if (manager.lockfile.isEmpty()) {
                if (!manager.options.dry_run) {
                    std.fs.cwd().deleteFileZ(manager.options.lockfile_path) catch |err| brk: {
                        // we don't care
                        if (err == error.FileNotFound) {
                            if (had_any_diffs) break :save;
                            break :brk;
                        }

                        if (log_level != .silent) Output.prettyErrorln("\n <red>error: {s} deleting empty lockfile", .{@errorName(err)});
                        break :save;
                    };
                }
                if (!manager.options.global) {
                    if (log_level != .silent) {
                        if (manager.to_remove.len > 0) {
                            Output.prettyErrorln("\npackage.json has no dependencies! Deleted empty lockfile", .{});
                        } else {
                            Output.prettyErrorln("No packages! Deleted empty lockfile", .{});
                        }
                    }
                }

                break :save;
            }

            var save_node: *Progress.Node = undefined;

            if (comptime log_level.showProgress()) {
                save_node = manager.progress.start(ProgressStrings.save(), 0);
                manager.progress.supports_ansi_escape_codes = Output.enable_ansi_colors_stderr;
                save_node.activate();

                manager.progress.refresh();
            }

            manager.lockfile.saveToDisk(manager.options.lockfile_path);

            if (comptime Environment.allow_assert) {
                if (manager.lockfile.hasMetaHashChanged(false) catch false) {
                    Output.panic("Lockfile metahash non-deterministic after saving", .{});
                }
            }

            if (comptime log_level.showProgress()) {
                save_node.end();
                manager.progress.refresh();
                manager.progress.root.end();
                manager.progress = .{};
            } else if (comptime log_level != .silent) {
                Output.prettyErrorln(" Saved lockfile", .{});
                Output.flush();
            }
        }

        const binding_dot_gyp_path = Path.joinAbsStringZ(
            Fs.FileSystem.instance.top_level_dir,
            &[_]string{"binding.gyp"},
            .auto,
        );
        if (root.scripts.hasAny()) {
            const add_node_gyp_rebuild_script = root.scripts.install.isEmpty() and root.scripts.postinstall.isEmpty() and Syscall.exists(binding_dot_gyp_path);

            manager.root_lifecycle_scripts = root.scripts.enqueue(
                manager.lockfile,
                manager.lockfile.buffers.string_bytes.items,
                strings.withoutTrailingSlash(FileSystem.instance.top_level_dir),
                root.name.slice(manager.lockfile.buffers.string_bytes.items),
                .root,
                add_node_gyp_rebuild_script,
            );
        } else {
            if (Syscall.exists(binding_dot_gyp_path)) {
                // no scripts exist but auto node gyp script needs to be added
                manager.root_lifecycle_scripts = root.scripts.enqueue(
                    manager.lockfile,
                    manager.lockfile.buffers.string_bytes.items,
                    strings.withoutTrailingSlash(FileSystem.instance.top_level_dir),
                    root.name.slice(manager.lockfile.buffers.string_bytes.items),
                    .root,
                    true,
                );
            }
        }

        var install_summary = PackageInstall.Summary{};
        if (manager.options.do.install_packages) {
            install_summary = try manager.installPackages(
                ctx,
                log_level,
            );
        }

        if (needs_new_lockfile) {
            manager.summary.add = @as(u32, @truncate(manager.lockfile.packages.len));
        }

        if (manager.options.do.save_yarn_lock) {
            var node: *Progress.Node = undefined;
            if (comptime log_level.showProgress()) {
                node = manager.progress.start("Saving yarn.lock", 0);
                manager.progress.supports_ansi_escape_codes = Output.enable_ansi_colors_stderr;
                manager.progress.refresh();
            } else if (comptime log_level != .silent) {
                Output.prettyErrorln(" Saved yarn.lock", .{});
                Output.flush();
            }

            try manager.writeYarnLock();
            if (comptime log_level.showProgress()) {
                node.completeOne();
                manager.progress.refresh();
                manager.progress.root.end();
                manager.progress = .{};
            }
        }

        var printed_timestamp = false;
        if (comptime log_level != .silent) {
            if (manager.options.do.summary) {
                var printer = Lockfile.Printer{
                    .lockfile = manager.lockfile,
                    .options = manager.options,
                    .updates = manager.package_json_updates,
                    .successfully_installed = install_summary.successfully_installed,
                };

                switch (Output.enable_ansi_colors) {
                    inline else => |enable_ansi_colors| {
                        try Lockfile.Printer.Tree.print(&printer, Output.WriterType, Output.writer(), enable_ansi_colors);
                    },
                }

                manager.lifecycle_script_time_log.printAndDeinit(manager.lockfile.allocator);

                if (!did_meta_hash_change) {
                    manager.summary.remove = 0;
                    manager.summary.add = 0;
                    manager.summary.update = 0;
                }

                if (install_summary.success > 0) {
                    // it's confusing when it shows 3 packages and says it installed 1
                    const pkgs_installed = @max(
                        install_summary.success,
                        @as(
                            u32,
                            @truncate(manager.package_json_updates.len),
                        ),
                    );
                    Output.pretty(" <green>{d}<r> package{s}<r> installed ", .{ pkgs_installed, if (pkgs_installed == 1) "" else "s" });
                    Output.printStartEndStdout(ctx.start_time, std.time.nanoTimestamp());
                    printed_timestamp = true;
                    Output.pretty("<r>\n", .{});

                    if (manager.summary.remove > 0) {
                        Output.pretty("  Removed: <cyan>{d}<r>\n", .{manager.summary.remove});
                    }
                } else if (manager.summary.remove > 0) {
                    if (manager.to_remove.len > 0) {
                        for (manager.to_remove) |request| {
                            Output.prettyln(" <r><red>-<r> {s}", .{request.name});
                        }
                    }

                    Output.pretty(" <r><b>{d}<r> package{s} removed ", .{ manager.summary.remove, if (manager.summary.remove == 1) "" else "s" });
                    Output.printStartEndStdout(ctx.start_time, std.time.nanoTimestamp());
                    printed_timestamp = true;
                    Output.pretty("<r>\n", .{});
                } else if (install_summary.skipped > 0 and install_summary.fail == 0 and manager.package_json_updates.len == 0) {
                    const count = @as(PackageID, @truncate(manager.lockfile.packages.len));
                    if (count != install_summary.skipped) {
                        Output.pretty("Checked <green>{d} install{s}<r> across {d} package{s} <d>(no changes)<r> ", .{
                            install_summary.skipped,
                            if (install_summary.skipped == 1) "" else "s",
                            count,
                            if (count == 1) "" else "s",
                        });
                        Output.printStartEndStdout(ctx.start_time, std.time.nanoTimestamp());
                        printed_timestamp = true;
                        Output.pretty("<r>\n", .{});
                    } else {
                        Output.pretty("<r> <green>Done<r>! Checked {d} package{s}<r> <d>(no changes)<r> ", .{
                            install_summary.skipped,
                            if (install_summary.skipped == 1) "" else "s",
                        });
                        Output.printStartEndStdout(ctx.start_time, std.time.nanoTimestamp());
                        printed_timestamp = true;
                        Output.pretty("<r>\n", .{});
                    }
                }

                if (install_summary.fail > 0) {
                    Output.prettyln("<r>Failed to install <red><b>{d}<r> package{s}\n", .{ install_summary.fail, if (install_summary.fail == 1) "" else "s" });
                    Output.flush();
                }
            }
        }

        if (comptime log_level != .silent) {
            if (manager.options.do.summary) {
                if (!printed_timestamp) {
                    Output.printStartEndStdout(ctx.start_time, std.time.nanoTimestamp());
                    Output.prettyln("<d> done<r>", .{});
                    printed_timestamp = true;
                }
            }
        }

        Output.flush();
    }

    pub fn spawnPackageLifecycleScripts(
        this: *PackageManager,
        ctx: Command.Context,
        list: Lockfile.Package.Scripts.List,
        comptime log_level: PackageManager.Options.LogLevel,
    ) !void {
        if (comptime Environment.isWindows) {
            return bun.todo(@src(), {});
        }
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

        const cwd = list.first().cwd;
        const this_bundler = try this.configureEnvForScripts(ctx, log_level);
        const original_path = this_bundler.env.map.get("PATH") orelse "";

        var PATH = try std.ArrayList(u8).initCapacity(bun.default_allocator, original_path.len + 1 + "node_modules/.bin".len + cwd.len + 1);
        var current_dir: ?*DirInfo = this_bundler.resolver.readDirInfo(cwd) catch null;
        std.debug.assert(current_dir != null);
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

        this_bundler.env.map.put("PATH", PATH.items) catch unreachable;

        const envp = try this_bundler.env.map.createNullDelimitedEnvMap(this.allocator);
        try this_bundler.env.map.put("PATH", original_path);
        PATH.deinit();

        try LifecycleScriptSubprocess.spawnPackageScripts(this, list, envp, log_level);
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

test "UpdateRequests.parse" {
    var log = logger.Log.init(default_allocator);
    var array = PackageManager.UpdateRequest.Array.init(0) catch unreachable;

    const updates: []const []const u8 = &.{
        "@bacon/name",
        "foo",
        "bar",
        "baz",
        "boo@1.0.0",
        "bing@latest",
        "github:bar/foo",
    };
    var reqs = PackageManager.UpdateRequest.parse(default_allocator, &log, updates, &array, .add);

    try std.testing.expectEqualStrings(reqs[0].name, "@bacon/name");
    try std.testing.expectEqualStrings(reqs[1].name, "foo");
    try std.testing.expectEqualStrings(reqs[2].name, "bar");
    try std.testing.expectEqualStrings(reqs[3].name, "baz");
    try std.testing.expectEqualStrings(reqs[4].name, "boo");
    try std.testing.expectEqualStrings(reqs[7].name, "github:bar/foo");
    try std.testing.expectEqual(reqs[4].version.tag, Dependency.Version.Tag.npm);
    try std.testing.expectEqualStrings(reqs[4].version.literal.slice("boo@1.0.0"), "1.0.0");
    try std.testing.expectEqual(reqs[5].version.tag, Dependency.Version.Tag.dist_tag);
    try std.testing.expectEqualStrings(reqs[5].version.literal.slice("bing@1.0.0"), "latest");
    try std.testing.expectEqual(updates.len, 7);
}

test "PackageManager.Options - default registry, default values" {
    const allocator = default_allocator;
    var log = logger.Log.init(allocator);
    defer log.deinit();
    var env = DotEnv.Loader.init(&DotEnv.Map.init(allocator), allocator);
    var options = PackageManager.Options{};

    try options.load(allocator, &log, &env, null, null);

    try std.testing.expectEqualStrings("", options.scope.name);
    try std.testing.expectEqualStrings("", options.scope.auth);
    try std.testing.expectEqualStrings(Npm.Registry.default_url, options.scope.url.href);
    try std.testing.expectEqualStrings("", options.scope.token);
}

test "PackageManager.Options - default registry, custom token" {
    const allocator = default_allocator;
    var log = logger.Log.init(allocator);
    defer log.deinit();
    var env = DotEnv.Loader.init(&DotEnv.Map.init(allocator), allocator);
    var install = Api.BunInstall{
        .default_registry = Api.NpmRegistry{
            .url = "",
            .username = "foo",
            .password = "bar",
            .token = "baz",
        },
        .native_bin_links = &.{},
    };
    var options = PackageManager.Options{};

    try options.load(allocator, &log, &env, null, &install);

    try std.testing.expectEqualStrings("", options.scope.name);
    try std.testing.expectEqualStrings("", options.scope.auth);
    try std.testing.expectEqualStrings(Npm.Registry.default_url, options.scope.url.href);
    try std.testing.expectEqualStrings("baz", options.scope.token);
}

test "PackageManager.Options - default registry, custom URL" {
    const allocator = default_allocator;
    var log = logger.Log.init(allocator);
    defer log.deinit();
    var env = DotEnv.Loader.init(&DotEnv.Map.init(allocator), allocator);
    var install = Api.BunInstall{
        .default_registry = Api.NpmRegistry{
            .url = "https://example.com/",
            .username = "foo",
            .password = "bar",
            .token = "",
        },
        .native_bin_links = &.{},
    };
    var options = PackageManager.Options{};

    try options.load(allocator, &log, &env, null, &install);

    try std.testing.expectEqualStrings("", options.scope.name);
    try std.testing.expectEqualStrings("Zm9vOmJhcg==", options.scope.auth);
    try std.testing.expectEqualStrings("https://example.com/", options.scope.url.href);
    try std.testing.expectEqualStrings("", options.scope.token);
}

test "PackageManager.Options - scoped registry" {
    const allocator = default_allocator;
    var log = logger.Log.init(allocator);
    defer log.deinit();
    var env = DotEnv.Loader.init(&DotEnv.Map.init(allocator), allocator);
    var install = Api.BunInstall{
        .scoped = Api.NpmRegistryMap{
            .scopes = &.{
                "foo",
            },
            .registries = &.{
                Api.NpmRegistry{
                    .url = "",
                    .username = "",
                    .password = "",
                    .token = "bar",
                },
            },
        },
        .native_bin_links = &.{},
    };
    var options = PackageManager.Options{};

    try options.load(allocator, &log, &env, null, &install);

    try std.testing.expectEqualStrings("", options.scope.name);
    try std.testing.expectEqualStrings("", options.scope.auth);
    try std.testing.expectEqualStrings(Npm.Registry.default_url, options.scope.url.href);
    try std.testing.expectEqualStrings("", options.scope.token);

    const scoped = options.registries.getPtr(Npm.Registry.Scope.hash(Npm.Registry.Scope.getName("foo")));

    try std.testing.expect(scoped != null);
    if (scoped) |scope| {
        try std.testing.expectEqualStrings("foo", scope.name);
        try std.testing.expectEqualStrings("", scope.auth);
        try std.testing.expectEqualStrings(Npm.Registry.default_url, scope.url.href);
        try std.testing.expectEqualStrings("bar", scope.token);
    }
}

test "PackageManager.Options - mixed default/scoped registry" {
    const allocator = default_allocator;
    var log = logger.Log.init(allocator);
    defer log.deinit();
    var env = DotEnv.Loader.init(&DotEnv.Map.init(allocator), allocator);
    var install = Api.BunInstall{
        .default_registry = Api.NpmRegistry{
            .url = "https://example.com/",
            .username = "",
            .password = "",
            .token = "foo",
        },
        .scoped = Api.NpmRegistryMap{
            .scopes = &.{
                "bar",
            },
            .registries = &.{
                Api.NpmRegistry{
                    .url = "",
                    .username = "baz",
                    .password = "moo",
                    .token = "",
                },
            },
        },
        .native_bin_links = &.{},
    };
    var options = PackageManager.Options{};

    try options.load(allocator, &log, &env, null, &install);

    try std.testing.expectEqualStrings("", options.scope.name);
    try std.testing.expectEqualStrings("", options.scope.auth);
    try std.testing.expectEqualStrings("https://example.com/", options.scope.url.href);
    try std.testing.expectEqualStrings("foo", options.scope.token);

    const scoped = options.registries.getPtr(Npm.Registry.Scope.hash(Npm.Registry.Scope.getName("bar")));

    try std.testing.expect(scoped != null);
    if (scoped) |scope| {
        try std.testing.expectEqualStrings("bar", scope.name);
        try std.testing.expectEqualStrings("YmF6Om1vbw==", scope.auth);
        try std.testing.expectEqualStrings("https://example.com/", scope.url.href);
        try std.testing.expectEqualStrings("", scope.token);
    }
}
