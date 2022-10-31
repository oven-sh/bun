const bun = @import("../global.zig");
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

const JSLexer = @import("../js_lexer.zig");
const logger = @import("../logger.zig");

const js_parser = @import("../js_parser.zig");
const json_parser = @import("../json_parser.zig");
const JSPrinter = @import("../js_printer.zig");

const linker = @import("../linker.zig");
const panicky = @import("../panic_handler.zig");
const sync = @import("../sync.zig");
const Api = @import("../api/schema.zig").Api;
const Path = @import("../resolver/resolve_path.zig");
const configureTransformOptionsForBun = @import("../bun.js/config.zig").configureTransformOptionsForBun;
const Command = @import("../cli.zig").Command;
const BunArguments = @import("../cli.zig").Arguments;
const bundler = @import("../bundler.zig");
const NodeModuleBundle = @import("../node_module_bundle.zig").NodeModuleBundle;
const DotEnv = @import("../env_loader.zig");
const which = @import("../which.zig").which;
const Run = @import("../bun_js.zig").Run;
const HeaderBuilder = @import("http").HeaderBuilder;
const Fs = @import("../fs.zig");
const FileSystem = Fs.FileSystem;
const Lock = @import("../lock.zig").Lock;
var path_buf: [bun.MAX_PATH_BYTES]u8 = undefined;
var path_buf2: [bun.MAX_PATH_BYTES]u8 = undefined;
const URL = @import("../url.zig").URL;
const AsyncHTTP = @import("http").AsyncHTTP;
const HTTPChannel = @import("http").HTTPChannel;
const NetworkThread = @import("http").NetworkThread;
const HTTP = @import("http");

const Integrity = @import("./integrity.zig").Integrity;
const clap = @import("clap");
const ExtractTarball = @import("./extract_tarball.zig");
const Npm = @import("./npm.zig");
const Bitset = @import("./bit_set.zig").DynamicBitSetUnmanaged;
const z_allocator = @import("../memory_allocator.zig").z_allocator;
const Syscall = @import("javascript_core").Node.Syscall;
const RunCommand = @import("../cli/run_command.zig").RunCommand;
threadlocal var initialized_store = false;
const Futex = @import("../futex.zig");

pub const Lockfile = @import("./lockfile.zig");

// these bytes are skipped
// so we just make it repeat bun bun bun bun bun bun bun bun bun
// because why not
pub const alignment_bytes_to_repeat_buffer = [_]u8{0} ** 144;

const JSAst = @import("../js_ast.zig");

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

const IdentityContext = @import("../identity_context.zig").IdentityContext;
const ArrayIdentityContext = @import("../identity_context.zig").ArrayIdentityContext;
const NetworkQueue = std.fifo.LinearFifo(*NetworkTask, .{ .Static = 32 });
const Semver = @import("./semver.zig");
const ExternalString = Semver.ExternalString;
const String = Semver.String;
const GlobalStringBuilder = @import("../string_builder.zig");
const SlicedString = Semver.SlicedString;
const Repository = @import("./repository.zig").Repository;
const StructBuilder = @import("../builder.zig");
const Bin = @import("./bin.zig").Bin;
const Dependency = @import("./dependency.zig");
const Behavior = @import("./dependency.zig").Behavior;
const FolderResolution = @import("./resolvers/folder_resolver.zig").FolderResolution;

pub const ExternalStringBuilder = StructBuilder.Builder(ExternalString);
pub const SmallExternalStringList = ExternalSlice(String);

pub fn ExternalSlice(comptime Type: type) type {
    return ExternalSliceAligned(Type, null);
}

pub fn ExternalSliceAligned(comptime Type: type, comptime alignment_: ?u29) type {
    return extern struct {
        const alignment = alignment_ orelse @alignOf(*Type);
        const Slice = @This();

        pub const Child: type = Type;

        off: u32 = 0,
        len: u32 = 0,

        pub inline fn contains(this: Slice, id: u32) bool {
            return id >= this.off and id < (this.len + this.off);
        }

        pub inline fn get(this: Slice, in: []const Type) []const Type {
            // it should be impossible to address this out of bounds due to the minimum here
            return in.ptr[this.off..@minimum(in.len, this.off + this.len)];
        }

        pub inline fn mut(this: Slice, in: []Type) []Type {
            return in.ptr[this.off..@minimum(in.len, this.off + this.len)];
        }

        pub fn init(buf: []const Type, in: []const Type) Slice {
            // if (comptime isDebug or isTest) {
            //     std.debug.assert(@ptrToInt(buf.ptr) <= @ptrToInt(in.ptr));
            //     std.debug.assert((@ptrToInt(in.ptr) + in.len) <= (@ptrToInt(buf.ptr) + buf.len));
            // }

            return Slice{
                .off = @truncate(u32, (@ptrToInt(in.ptr) - @ptrToInt(buf.ptr)) / @sizeOf(Type)),
                .len = @truncate(u32, in.len),
            };
        }
    };
}

pub const PackageID = u32;
pub const DependencyID = u32;
pub const PackageIDMultiple = [*:invalid_package_id]PackageID;
pub const invalid_package_id = std.math.maxInt(PackageID);

pub const ExternalStringList = ExternalSlice(ExternalString);
pub const VersionSlice = ExternalSlice(Semver.Version);

pub const ExternalStringMap = extern struct {
    name: ExternalStringList = ExternalStringList{},
    value: ExternalStringList = ExternalStringList{},

    pub const Small = extern struct {
        name: SmallExternalStringList = SmallExternalStringList{},
        value: SmallExternalStringList = SmallExternalStringList{},
    };
};

pub const PackageNameHash = u64;

pub const Aligner = struct {
    pub fn write(comptime Type: type, comptime Writer: type, writer: Writer, pos: usize) !usize {
        const to_write = skipAmount(Type, pos);

        var remainder: string = alignment_bytes_to_repeat_buffer[0..@minimum(to_write, alignment_bytes_to_repeat_buffer.len)];
        try writer.writeAll(remainder);

        return to_write;
    }

    pub inline fn skipAmount(comptime Type: type, pos: usize) usize {
        return std.mem.alignForward(pos, @alignOf(Type)) - pos;
    }
};

const NetworkTask = struct {
    http: AsyncHTTP = undefined,
    task_id: u64,
    url_buf: []const u8 = &[_]u8{},
    allocator: std.mem.Allocator,
    request_buffer: MutableString = undefined,
    response_buffer: MutableString = undefined,
    package_manager: *PackageManager = &PackageManager.instance,
    callback: union(Task.Tag) {
        package_manifest: struct {
            loaded_manifest: ?Npm.PackageManifest = null,
            name: strings.StringOrTinyString,
        },
        extract: ExtractTarball,
        binlink: void,
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

    pub fn forManifest(
        this: *NetworkTask,
        name: string,
        allocator: std.mem.Allocator,
        scope: *const Npm.Registry.Scope,
        loaded_manifest: ?Npm.PackageManifest,
    ) !void {
        const pathname: string = if (!strings.eqlComptime(scope.url.pathname, "/"))
            scope.url.pathname
        else
            @as(string, "");

        if (pathname.len > 0) {
            if (scope.url.getPort()) |port_number| {
                this.url_buf = try std.fmt.allocPrint(
                    allocator,
                    "{s}://{s}:{d}/{s}/{s}",
                    .{
                        scope.url.displayProtocol(),
                        scope.url.displayHostname(),
                        port_number,
                        pathname,
                        name,
                    },
                );
            } else {
                this.url_buf = try std.fmt.allocPrint(
                    allocator,
                    "{s}://{s}/{s}/{s}",
                    .{
                        scope.url.displayProtocol(),
                        scope.url.displayHostname(),
                        pathname,
                        name,
                    },
                );
            }
        } else {
            if (scope.url.getPort()) |port_number| {
                this.url_buf = try std.fmt.allocPrint(
                    allocator,
                    "{s}://{s}:{d}/{s}",
                    .{
                        scope.url.displayProtocol(),
                        scope.url.displayHostname(),
                        port_number,
                        name,
                    },
                );
            } else {
                this.url_buf = try std.fmt.allocPrint(
                    allocator,
                    "{s}://{s}/{s}",
                    .{
                        scope.url.displayProtocol(),
                        scope.url.displayHostname(),
                        name,
                    },
                );
            }
        }

        var last_modified: string = "";
        var etag: string = "";
        if (loaded_manifest) |manifest| {
            last_modified = manifest.pkg.last_modified.slice(manifest.string_buf);
            etag = manifest.pkg.etag.slice(manifest.string_buf);
        }

        var header_builder = HeaderBuilder{};

        if (scope.token.len > 0) {
            header_builder.count("Authorization", "");
            header_builder.content.cap += "Bearer ".len + scope.token.len;
        } else if (scope.auth.len > 0) {
            header_builder.count("Authorization", "");
            header_builder.content.cap += "Basic ".len + scope.auth.len;
        }

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

            if (scope.token.len > 0) {
                header_builder.appendFmt("Authorization", "Bearer {s}", .{scope.token});
            } else if (scope.auth.len > 0) {
                header_builder.appendFmt("Authorization", "Basic {s}", .{scope.auth});
            }

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
                    .name = .{ .offset = 0, .length = @truncate(u32, "Accept".len) },
                    .value = .{ .offset = "Accept".len, .length = @truncate(u32, default_headers_buf.len - "Accept".len) },
                },
            );
            header_builder.header_count = 1;
            header_builder.content = GlobalStringBuilder{ .ptr = @intToPtr([*]u8, @ptrToInt(std.mem.span(default_headers_buf).ptr)), .len = default_headers_buf.len, .cap = default_headers_buf.len };
        }

        this.response_buffer = try MutableString.init(allocator, 0);
        this.allocator = allocator;
        this.http = AsyncHTTP.init(
            allocator,
            .GET,
            URL.parse(this.url_buf),
            header_builder.entries,
            header_builder.content.ptr.?[0..header_builder.content.len],
            &this.response_buffer,
            "",
            0,
            this.getCompletionCallback(),
        );
        this.http.max_retry_count = this.package_manager.options.max_retry_count;
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
        if (tarball.url.len == 0) {
            this.url_buf = try ExtractTarball.buildURL(
                scope.url.href,
                tarball.name,
                tarball.resolution.value.npm.version,
                this.package_manager.lockfile.buffers.string_bytes.items,
            );
        } else {
            this.url_buf = tarball.url;
        }

        this.response_buffer = try MutableString.init(allocator, 0);
        this.allocator = allocator;

        var header_builder = HeaderBuilder{};

        if (scope.token.len > 0) {
            header_builder.count("Authorization", "");
            header_builder.content.cap += "Bearer ".len + scope.token.len;
        } else if (scope.auth.len > 0) {
            header_builder.count("Authorization", "");
            header_builder.content.cap += "Basic ".len + scope.auth.len;
        }

        var header_buf: string = "";
        if (header_builder.header_count > 0) {
            try header_builder.allocate(allocator);

            if (scope.token.len > 0) {
                header_builder.appendFmt("Authorization", "Bearer {s}", .{scope.token});
            } else if (scope.auth.len > 0) {
                header_builder.appendFmt("Authorization", "Basic {s}", .{scope.auth});
            }

            header_buf = header_builder.content.ptr.?[0..header_builder.content.len];
        }

        this.http = AsyncHTTP.init(
            allocator,
            .GET,
            URL.parse(this.url_buf),
            header_builder.entries,
            header_buf,
            &this.response_buffer,
            "",
            0,
            this.getCompletionCallback(),
        );
        this.http.max_retry_count = this.package_manager.options.max_retry_count;
        this.callback = .{ .extract = tarball };
    }
};

pub const Origin = enum(u8) {
    local = 0,
    npm = 1,
    tarball = 2,
};

pub const Features = struct {
    optional_dependencies: bool = false,
    dev_dependencies: bool = false,
    scripts: bool = false,
    peer_dependencies: bool = true,
    is_main: bool = false,
    dependencies: bool = true,

    check_for_duplicate_dependencies: bool = false,

    pub fn behavior(this: Features) Behavior {
        var out: u8 = 0;
        out |= @as(u8, @boolToInt(this.dependencies)) << 1;
        out |= @as(u8, @boolToInt(this.optional_dependencies)) << 2;
        out |= @as(u8, @boolToInt(this.dev_dependencies)) << 3;
        out |= @as(u8, @boolToInt(this.peer_dependencies)) << 4;
        return @intToEnum(Behavior, out);
    }

    pub const folder = Features{
        .optional_dependencies = true,
        .dev_dependencies = true,
        .scripts = false,
        .peer_dependencies = true,
        .is_main = false,
        .dependencies = true,
    };

    pub const link = Features{
        .optional_dependencies = false,
        .dev_dependencies = false,
        .scripts = false,
        .peer_dependencies = false,
        .is_main = false,
        .dependencies = false,
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
    threadpool_task: ThreadPool.Task = ThreadPool.Task{ .callback = callback },
    log: logger.Log,
    id: u64,
    err: ?anyerror = null,
    package_manager: *PackageManager = &PackageManager.instance,

    /// An ID that lets us register a callback without keeping the same pointer around
    pub const Id = struct {
        pub fn forNPMPackage(_: Task.Tag, package_name: string, package_version: Semver.Version) u64 {
            var hasher = std.hash.Wyhash.init(0);
            hasher.update(package_name);
            hasher.update("@");
            hasher.update(std.mem.asBytes(&package_version));
            return @as(u64, @truncate(u63, hasher.final())) | @as(u64, 1 << 63);
        }

        pub fn forBinLink(package_id: PackageID) u64 {
            const hash = std.hash.Wyhash.hash(0, std.mem.asBytes(&package_id));
            return @as(u64, @truncate(u62, hash)) | @as(u64, 1 << 62) | @as(u64, 1 << 63);
        }

        pub fn forManifest(
            _: Task.Tag,
            name: string,
        ) u64 {
            return @as(u64, @truncate(u63, std.hash.Wyhash.hash(0, name)));
        }
    };

    pub fn callback(task: *ThreadPool.Task) void {
        Output.Source.configureThread();
        defer Output.flush();

        var this = @fieldParentPtr(Task, "threadpool_task", task);

        defer this.package_manager.wake();

        switch (this.tag) {
            .package_manifest => {
                var allocator = this.package_manager.allocator;
                const package_manifest = Npm.Registry.getPackageMetadata(
                    allocator,
                    this.request.package_manifest.network.http.response.?,
                    this.request.package_manifest.network.response_buffer.toOwnedSliceLeaky(),
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
                    this.package_manager.resolve_tasks.writeItem(this.*) catch unreachable;
                    return;
                };

                this.data = .{ .package_manifest = .{} };

                switch (package_manifest) {
                    .cached => unreachable,
                    .fresh => |manifest| {
                        this.data = .{ .package_manifest = manifest };
                        this.status = Status.success;
                        this.package_manager.resolve_tasks.writeItem(this.*) catch unreachable;
                        return;
                    },
                    .not_found => {
                        this.log.addErrorFmt(null, logger.Loc.Empty, allocator, "404 - GET {s}", .{
                            this.request.package_manifest.name.slice(),
                        }) catch unreachable;
                        this.status = Status.fail;
                        this.package_manager.resolve_tasks.writeItem(this.*) catch unreachable;
                        return;
                    },
                }
            },
            .extract => {
                const result = this.request.extract.tarball.run(
                    this.request.extract.network.response_buffer.toOwnedSliceLeaky(),
                ) catch |err| {
                    if (comptime Environment.isDebug) {
                        if (@errorReturnTrace()) |trace| {
                            std.debug.dumpStackTrace(trace.*);
                        }
                    }

                    this.err = err;
                    this.status = Status.fail;
                    this.data = .{ .extract = "" };
                    this.package_manager.resolve_tasks.writeItem(this.*) catch unreachable;
                    return;
                };

                this.data = .{ .extract = result };
                this.status = Status.success;
                this.package_manager.resolve_tasks.writeItem(this.*) catch unreachable;
            },
            .binlink => {},
        }
    }

    pub const Tag = enum(u2) {
        package_manifest = 1,
        extract = 2,
        binlink = 3,
        // install = 3,
    };

    pub const Status = enum {
        waiting,
        success,
        fail,
    };

    pub const Data = union {
        package_manifest: Npm.PackageManifest,
        extract: string,
        binlink: bool,
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
        binlink: Bin.Linker,
        // install: PackageInstall,
    };
};

const PackageInstall = struct {
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

    threadlocal var package_json_checker: json_parser.PackageJSONVersionChecker = undefined;

    pub const Context = struct {
        metas: []const Lockfile.Package.Meta,
        names: []const String,
        resolutions: []const Resolution,
        string_buf: []const u8,
        channel: PackageInstall.Task.Channel = undefined,
        skip_verify: bool = false,
        progress: *Progress = undefined,
        cache_dir: std.fs.Dir = undefined,
        allocator: std.mem.Allocator,
    };

    pub const Task = struct {
        task: ThreadPool.Task = .{ .callback = callback },
        result: Result = Result{ .pending = void{} },
        package_install: PackageInstall = undefined,
        package_id: PackageID,
        ctx: *PackageInstall.Context,
        destination_dir: std.fs.Dir,

        pub const Channel = sync.Channel(*PackageInstall.Task, .{ .Static = 1024 });

        pub fn callback(task: *ThreadPool.Task) void {
            Output.Source.configureThread();
            defer Output.flush();

            var this: *PackageInstall.Task = @fieldParentPtr(PackageInstall.Task, "task", task);
            var ctx = this.ctx;

            var destination_dir_subpath_buf: [bun.MAX_PATH_BYTES]u8 = undefined;
            var cache_dir_subpath_buf: [bun.MAX_PATH_BYTES]u8 = undefined;
            const name = ctx.names[this.package_id].slice(ctx.string_buf);
            const resolution = ctx.resolutions[this.package_id];
            std.mem.copy(u8, &destination_dir_subpath_buf, name);
            destination_dir_subpath_buf[name.len] = 0;
            var destination_dir_subpath: [:0]u8 = destination_dir_subpath_buf[0..name.len :0];
            var resolution_buf: [512]u8 = undefined;
            var resolution_label = std.fmt.bufPrint(&resolution_buf, "{}", .{resolution.fmt(ctx.string_buf)}) catch unreachable;

            this.package_install = PackageInstall{
                .cache_dir = undefined,
                .cache_dir_subpath = undefined,
                .progress = ctx.progress,

                .destination_dir = this.destination_dir,
                .destination_dir_subpath = destination_dir_subpath,
                .destination_dir_subpath_buf = &destination_dir_subpath_buf,
                .allocator = ctx.allocator,
                .package_name = name,
                .package_version = resolution_label,
            };

            switch (resolution.tag) {
                .npm => {
                    this.package_install.cache_dir_subpath = this.manager.cachedNPMPackageFolderName(name, resolution.value.npm);
                    this.package_install.cache_dir = this.manager.getCacheDirectory();
                },
                .folder => {
                    var folder_buf = &cache_dir_subpath_buf;
                    const folder = resolution.value.folder.slice(ctx.string_buf);
                    std.mem.copy(u8, folder_buf, "../" ++ std.fs.path.sep_str);
                    std.mem.copy(u8, folder_buf["../".len..], folder);
                    folder_buf["../".len + folder.len] = 0;
                    this.package_install.cache_dir_subpath = folder_buf[0 .. "../".len + folder.len :0];
                    this.package_install.cache_dir = std.fs.cwd();
                },
                else => return,
            }

            const needs_install = ctx.skip_verify_installed_version_number or !this.package_install.verify();

            if (needs_install) {
                this.result = this.package_install.install(ctx.skip_verify_installed_version_number);
            } else {
                this.result = .{ .skip = .{} };
            }

            ctx.channel.writeItem(this) catch unreachable;
        }
    };

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

        pub inline fn isSupported(this: Method) bool {
            if (comptime Environment.isMac) return macOS.get(this);
            if (comptime Environment.isLinux) return linux.get(this);

            return false;
        }
    };

    pub fn verify(
        this: *PackageInstall,
    ) bool {
        var allocator = this.allocator;
        std.mem.copy(u8, this.destination_dir_subpath_buf[this.destination_dir_subpath.len..], std.fs.path.sep_str ++ "package.json");
        this.destination_dir_subpath_buf[this.destination_dir_subpath.len + std.fs.path.sep_str.len + "package.json".len] = 0;
        var package_json_path: [:0]u8 = this.destination_dir_subpath_buf[0 .. this.destination_dir_subpath.len + std.fs.path.sep_str.len + "package.json".len :0];
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
        var total: usize = 0;
        var read: usize = 0;
        mutable.list.expandToCapacity();

        // Heuristic: most package.jsons will be less than 2048 bytes.
        read = package_json_file.read(mutable.list.items[total..]) catch return false;
        var remain = mutable.list.items[@minimum(total, read)..];
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

        const source = logger.Source.initPathString(std.mem.span(package_json_path), mutable.list.items[0..total]);
        var log = logger.Log.init(allocator);
        defer log.deinit();

        initializeStore();

        package_json_checker = json_parser.PackageJSONVersionChecker.init(allocator, &source, &log) catch return false;
        _ = package_json_checker.parseExpr() catch return false;
        if (!package_json_checker.has_found_name or !package_json_checker.has_found_version or log.errors > 0) return false;

        // Version is more likely to not match than name, so we check it first.
        return strings.eql(package_json_checker.found_version, this.package_version) and
            strings.eql(package_json_checker.found_name, this.package_name);
    }

    pub const Result = union(Tag) {
        pending: void,
        success: void,
        skip: void,
        fail: struct {
            err: anyerror,
            step: Step = Step.clone,

            pub inline fn isPackageMissingFromCache(this: @This()) bool {
                return this.err == error.FileNotFound and this.step == .opening_cache_dir;
            }
        },

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

    const CloneFileError = error{
        NotSupported,
        Unexpected,
        FileNotFound,
    };

    var supported_method: Method = if (Environment.isMac)
        Method.clonefile
    else
        Method.hardlink;

    fn installWithClonefileEachDir(this: *PackageInstall) !Result {
        const Walker = @import("../walker_skippable.zig");

        var cached_package_dir = this.cache_dir.openDirZ(this.cache_dir_subpath, .{
            .iterate = true,
        }) catch |err| return Result{
            .fail = .{ .err = err, .step = .opening_cache_dir },
        };
        defer cached_package_dir.close();
        var walker_ = Walker.walk(
            cached_package_dir,
            this.allocator,
            &[_]string{},
            &[_]string{},
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
                        .Directory => {
                            std.os.mkdirat(destination_dir_.fd, entry.path, 0o755) catch {};
                        },
                        .File => {
                            std.mem.copy(u8, &stackpath, entry.path);
                            stackpath[entry.path.len] = 0;
                            var path: [:0]u8 = stackpath[0..entry.path.len :0];
                            var basename: [:0]u8 = stackpath[entry.path.len - entry.basename.len .. entry.path.len :0];
                            switch (C.clonefileat(
                                entry.dir.fd,
                                basename,
                                destination_dir_.fd,
                                path,
                                0,
                            )) {
                                0 => void{},
                                else => |errno| switch (std.os.errno(errno)) {
                                    .OPNOTSUPP => return error.NotSupported,
                                    .NOENT => return error.FileNotFound,
                                    // sometimes the downlowded npm package has already node_modules with it, so just ignore exist error here
                                    .EXIST => {},
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

        var subdir = this.destination_dir.makeOpenPath(std.mem.span(this.destination_dir_subpath), .{ .iterate = true }) catch |err| return Result{
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
            .success = void{},
        };
    }

    // https://www.unix.com/man-page/mojave/2/fclonefileat/
    fn installWithClonefile(this: *PackageInstall) CloneFileError!Result {
        if (comptime !Environment.isMac) @compileError("clonefileat() is macOS only.");

        if (this.package_name[0] == '@') {
            const current = std.mem.span(this.destination_dir_subpath);
            if (strings.indexOfChar(current, std.fs.path.sep)) |slash| {
                this.destination_dir_subpath_buf[slash] = 0;
                var subdir = this.destination_dir_subpath_buf[0..slash :0];
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
            0 => .{ .success = void{} },
            else => |errno| switch (std.os.errno(errno)) {
                .OPNOTSUPP => error.NotSupported,
                .NOENT => error.FileNotFound,
                // We first try to delete the directory
                // But, this can happen if this package contains a node_modules folder
                // We want to continue installing as many packages as we can, so we shouldn't block while downloading
                // We use the slow path in this case
                .EXIST => try this.installWithClonefileEachDir(),
                else => error.Unexpected,
            },
        };
    }
    fn installWithCopyfile(this: *PackageInstall) Result {
        const Walker = @import("../walker_skippable.zig");
        const CopyFile = @import("../copy_file.zig");

        var cached_package_dir = this.cache_dir.openDirZ(this.cache_dir_subpath, .{
            .iterate = true,
        }) catch |err| return Result{
            .fail = .{ .err = err, .step = .opening_cache_dir },
        };
        defer cached_package_dir.close();
        var walker_ = Walker.walk(
            cached_package_dir,
            this.allocator,
            &[_]string{},
            &[_]string{},
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
                while (try walker.next()) |entry| {
                    if (entry.kind != .File) continue;
                    real_file_count += 1;

                    var outfile = destination_dir_.createFile(entry.path, .{}) catch brk: {
                        if (std.fs.path.dirname(entry.path)) |entry_dirname| {
                            destination_dir_.makePath(entry_dirname) catch {};
                        }
                        break :brk destination_dir_.createFile(entry.path, .{}) catch |err| {
                            progress_.root.end();

                            progress_.refresh();

                            Output.prettyErrorln("<r><red>{s}<r>: copying file {s}", .{ @errorName(err), entry.path });
                            Global.exit(1);
                        };
                    };
                    defer outfile.close();

                    var infile = try entry.dir.openFile(entry.basename, .{ .mode = .read_only });
                    defer infile.close();

                    const stat = infile.stat() catch continue;
                    _ = C.fchmod(outfile.handle, stat.mode);

                    CopyFile.copy(infile.handle, outfile.handle) catch {
                        entry.dir.copyFile(entry.basename, destination_dir_, entry.path, .{}) catch |err| {
                            progress_.root.end();

                            progress_.refresh();

                            Output.prettyErrorln("<r><red>{s}<r>: copying file {s}", .{ @errorName(err), entry.path });
                            Global.exit(1);
                        };
                    };
                }

                return real_file_count;
            }
        };

        var subdir = this.destination_dir.makeOpenPath(std.mem.span(this.destination_dir_subpath), .{ .iterate = true }) catch |err| return Result{
            .fail = .{ .err = err, .step = .opening_cache_dir },
        };

        defer subdir.close();

        this.file_count = FileCopier.copy(subdir, &walker_, this.progress) catch |err| return Result{
            .fail = .{ .err = err, .step = .copying_files },
        };

        return Result{
            .success = void{},
        };
    }

    fn installWithHardlink(this: *PackageInstall) !Result {
        const Walker = @import("../walker_skippable.zig");

        var cached_package_dir = this.cache_dir.openDirZ(this.cache_dir_subpath, .{
            .iterate = true,
        }) catch |err| return Result{
            .fail = .{ .err = err, .step = .opening_cache_dir },
        };
        defer cached_package_dir.close();
        var walker_ = Walker.walk(
            cached_package_dir,
            this.allocator,
            &[_]string{},
            &[_]string{"node_modules"},
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
                while (try walker.next()) |entry| {
                    switch (entry.kind) {
                        .Directory => {
                            std.os.mkdirat(destination_dir_.fd, entry.path, 0o755) catch {};
                        },
                        .File => {
                            try std.os.linkat(entry.dir.fd, entry.basename, destination_dir_.fd, entry.path, 0);
                            real_file_count += 1;
                        },
                        else => {},
                    }
                }

                return real_file_count;
            }
        };

        var subdir = this.destination_dir.makeOpenPath(std.mem.span(this.destination_dir_subpath), .{ .iterate = true }) catch |err| return Result{
            .fail = .{ .err = err, .step = .opening_cache_dir },
        };

        defer subdir.close();

        this.file_count = FileCopier.copy(
            subdir,
            &walker_,
        ) catch |err| switch (err) {
            error.NotSameFileSystem => return err,
            else => return Result{
                .fail = .{ .err = err, .step = .copying_files },
            },
        };

        return Result{
            .success = void{},
        };
    }

    fn installWithSymlink(this: *PackageInstall) !Result {
        const Walker = @import("../walker_skippable.zig");

        var cached_package_dir = this.cache_dir.openDirZ(this.cache_dir_subpath, .{
            .iterate = true,
        }) catch |err| return Result{
            .fail = .{ .err = err, .step = .opening_cache_dir },
        };
        defer cached_package_dir.close();
        var walker_ = Walker.walk(
            cached_package_dir,
            this.allocator,
            &[_]string{},
            &[_]string{ "node_modules", ".git" },
        ) catch |err| return Result{
            .fail = .{ .err = err, .step = .opening_cache_dir },
        };
        defer walker_.deinit();

        const FileCopier = struct {
            pub fn copy(
                dest_dir_fd: std.os.fd_t,
                cache_dir_fd: std.os.fd_t,
                walker: *Walker,
            ) !u32 {
                var real_file_count: u32 = 0;
                var buf: [bun.MAX_PATH_BYTES]u8 = undefined;
                var cache_dir_path = try std.os.getFdPath(cache_dir_fd, &buf);

                var remain = buf[cache_dir_path.len..];
                var cache_dir_offset = cache_dir_path.len;
                if (cache_dir_path.len > 0 and cache_dir_path[cache_dir_path.len - 1] != std.fs.path.sep) {
                    remain[0] = std.fs.path.sep;
                    cache_dir_offset += 1;
                    remain = remain[1..];
                }
                var dest_buf: [bun.MAX_PATH_BYTES]u8 = undefined;
                var dest_base = try std.os.getFdPath(dest_dir_fd, &dest_buf);
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
                        .Directory => {
                            std.os.mkdirat(dest_dir_fd, entry.path, 0o755) catch {};
                        },
                        // but each file in the directory is a symlink
                        .File => {
                            @memcpy(remain.ptr, entry.path.ptr, entry.path.len);
                            remain[entry.path.len] = 0;
                            var from_path = buf[0 .. cache_dir_offset + entry.path.len :0];

                            @memcpy(dest_remaining.ptr, entry.path.ptr, entry.path.len);
                            dest_remaining[entry.path.len] = 0;
                            var to_path = dest_buf[0 .. dest_dir_offset + entry.path.len :0];

                            try std.os.symlinkZ(from_path, to_path);

                            real_file_count += 1;
                        },
                        else => {},
                    }
                }

                return real_file_count;
            }
        };

        var subdir = this.destination_dir.makeOpenPath(std.mem.span(this.destination_dir_subpath), .{ .iterate = true }) catch |err| return Result{
            .fail = .{ .err = err, .step = .opening_cache_dir },
        };

        defer subdir.close();

        this.file_count = FileCopier.copy(
            subdir.fd,
            cached_package_dir.fd,
            &walker_,
        ) catch |err|
            return Result{
            .fail = .{
                .err = err,
                .step = .copying_files,
            },
        };

        return Result{
            .success = void{},
        };
    }

    pub fn uninstall(this: *PackageInstall) !void {
        try this.destination_dir.deleteTree(std.mem.span(this.destination_dir_subpath));
    }

    fn isDanglingSymlink(path: [:0]const u8) bool {
        if (comptime Environment.isLinux) {
            const rc = Syscall.system.open(path, @as(u31, std.os.O.PATH | 0), @as(u31, 0));
            switch (Syscall.getErrno(rc)) {
                .SUCCESS => {
                    const fd = @intCast(std.os.fd_t, rc);
                    _ = Syscall.system.close(fd);
                    return false;
                },
                else => return true,
            }
        } else {
            const rc = Syscall.system.open(path, @as(u31, 0), @as(u31, 0));
            switch (Syscall.getErrno(rc)) {
                .SUCCESS => {
                    _ = Syscall.system.close(rc);
                    return false;
                },
                else => return true,
            }
        }
    }

    pub fn installFromLink(this: *PackageInstall, skip_delete: bool) Result {

        // If this fails, we don't care.
        // we'll catch it the next error
        if (!skip_delete and !strings.eqlComptime(this.destination_dir_subpath, ".")) this.uninstall() catch {};

        // cache_dir_subpath in here is actually the full path to the symlink pointing to the linked package
        const symlinked_path = this.cache_dir_subpath;

        std.os.symlinkatZ(symlinked_path, this.destination_dir.fd, this.destination_dir_subpath) catch |err| {
            return Result{
                .fail = .{
                    .err = err,
                    .step = .linking,
                },
            };
        };

        if (isDanglingSymlink(symlinked_path)) {
            return Result{
                .fail = .{
                    .err = error.DanglingSymlink,
                    .step = .linking,
                },
            };
        }

        return Result{
            .success = void{},
        };
    }

    pub fn install(this: *PackageInstall, skip_delete: bool) Result {

        // If this fails, we don't care.
        // we'll catch it the next error
        if (!skip_delete and !strings.eqlComptime(this.destination_dir_subpath, ".")) this.uninstall() catch {};

        const supported_method_to_use = if (strings.eqlComptime(this.cache_dir_subpath, ".") or strings.hasPrefixComptime(this.cache_dir_subpath, ".."))
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
                } else |err| {
                    switch (err) {
                        error.NotSameFileSystem => {
                            supported_method = .copyfile;
                        },
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
            },
            else => {},
        }

        if (supported_method_to_use != .copyfile) return Result{
            .success = void{},
        };

        // TODO: linux io_uring
        return this.installWithCopyfile();
    }
};

const Resolution = @import("./resolution.zig").Resolution;
const Progress = std.Progress;
const TaggedPointer = @import("../tagged_pointer.zig");
const TaskCallbackContext = union(Tag) {
    dependency: PackageID,
    request_id: PackageID,
    root_dependency: PackageID,
    root_request_id: PackageID,
    node_modules_folder: u32, // Really, this is a file descriptor
    root_node_modules_folder: u32, // Really, this is a file descriptor
    pub const Tag = enum {
        dependency,
        request_id,
        node_modules_folder,
        root_dependency,
        root_request_id,
        root_node_modules_folder,
    };
};

const TaskCallbackList = std.ArrayListUnmanaged(TaskCallbackContext);
const TaskDependencyQueue = std.HashMapUnmanaged(u64, TaskCallbackList, IdentityContext(u64), 80);
const TaskChannel = sync.Channel(Task, .{ .Static = 4096 });
const NetworkChannel = sync.Channel(*NetworkTask, .{ .Static = 8192 });
const ThreadPool = @import("thread_pool");
const PackageManifestMap = std.HashMapUnmanaged(PackageNameHash, Npm.PackageManifest, IdentityContext(PackageNameHash), 80);

pub const CacheLevel = struct {
    use_cache_control_headers: bool,
    use_etag: bool,
    use_last_modified: bool,
};
const AsyncIO = @import("io");
const Waker = AsyncIO.Waker;

// We can't know all the packages we need until we've downloaded all the packages
// The easy way would be:
// 1. Download all packages, parsing their dependencies and enqueuing all dependencies for resolution
// 2.
pub const PackageManager = struct {
    cache_directory_: ?std.fs.Dir = null,
    temp_dir_: ?std.fs.Dir = null,
    root_dir: *Fs.FileSystem.DirEntry,
    env_loader: *DotEnv.Loader,
    allocator: std.mem.Allocator,
    log: *logger.Log,
    resolve_tasks: TaskChannel,
    timestamp: u32 = 0,
    extracted_count: u32 = 0,
    default_features: Features = Features{},
    summary: Lockfile.Package.Diff.Summary = Lockfile.Package.Diff.Summary{},
    env: *DotEnv.Loader,
    progress: Progress = .{},
    downloads_node: ?*Progress.Node = null,
    progress_name_buf: [768]u8 = undefined,
    progress_name_buf_dynamic: []u8 = &[_]u8{},
    cpu_count: u32 = 0,
    package_json_updates: []UpdateRequest = &[_]UpdateRequest{},

    to_remove: []const UpdateRequest = &[_]UpdateRequest{},

    root_package_json_file: std.fs.File,
    root_dependency_list: Lockfile.DependencySlice = .{},

    /// Used to make "dependencies" optional in the main package
    /// Depended on packages have to explicitly list their dependencies
    dynamic_root_dependencies: ?std.ArrayList(Dependency.Pair) = null,

    thread_pool: ThreadPool,

    manifests: PackageManifestMap = PackageManifestMap{},
    folders: FolderResolution.Map = FolderResolution.Map{},

    task_queue: TaskDependencyQueue = .{},
    network_dedupe_map: NetworkTaskQueue = .{},
    network_channel: NetworkChannel = NetworkChannel.init(),
    network_tarball_batch: ThreadPool.Batch = ThreadPool.Batch{},
    network_resolve_batch: ThreadPool.Batch = ThreadPool.Batch{},
    network_task_fifo: NetworkQueue = undefined,
    preallocated_network_tasks: PreallocatedNetworkTasks = PreallocatedNetworkTasks{ .buffer = undefined, .len = 0 },
    pending_tasks: u32 = 0,
    total_tasks: u32 = 0,

    lockfile: *Lockfile = undefined,

    options: Options = Options{},
    preinstall_state: std.ArrayListUnmanaged(PreinstallState) = std.ArrayListUnmanaged(PreinstallState){},

    global_link_dir: ?std.fs.Dir = null,
    global_dir: ?std.fs.Dir = null,
    global_link_dir_path: string = "",
    waiter: Waker = undefined,
    wait_count: std.atomic.Atomic(usize) = std.atomic.Atomic(usize).init(0),

    const PreallocatedNetworkTasks = std.BoundedArray(NetworkTask, 1024);
    const NetworkTaskQueue = std.HashMapUnmanaged(u64, void, IdentityContext(u64), 80);
    const PackageIndex = std.AutoHashMapUnmanaged(u64, *Package);
    pub var verbose_install = false;

    const PackageDedupeList = std.HashMapUnmanaged(
        u32,
        void,
        IdentityContext(u32),
        80,
    );

    pub fn wake(this: *PackageManager) void {
        _ = this.wait_count.fetchAdd(1, .Monotonic);
        this.waiter.wake() catch {};
    }

    pub fn sleep(this: *PackageManager) void {
        if (this.wait_count.swap(0, .Monotonic) > 0) return;
        _ = this.waiter.wait() catch 0;
    }

    const DependencyToEnqueue = union(enum) {
        pending: PackageID,
        resolution: struct { package_id: PackageID, resolution: Resolution },
        not_found: void,
        failure: anyerror,
    };
    pub fn enqueueDependencyToRoot(
        this: *PackageManager,
        name: []const u8,
        version_buf: []const u8,
        version: Dependency.Version,
        behavior: Dependency.Behavior,
    ) DependencyToEnqueue {
        var root_deps = this.dynamicRootDependencies();
        const existing: []const Dependency.Pair = root_deps.items;
        var str_buf = this.lockfile.buffers.string_bytes.items;
        for (existing) |pair, i| {
            if (strings.eqlLong(this.lockfile.str(pair.dependency.name), name, true)) {
                if (pair.dependency.version.eql(version, str_buf, version_buf)) {
                    if (pair.resolution_id != invalid_package_id) {
                        return .{
                            .resolution = .{
                                .resolution = this.lockfile.packages.items(.resolution)[pair.resolution_id],
                                .package_id = pair.resolution_id,
                            },
                        };
                    }
                    return .{ .pending = @truncate(u32, i) };
                }
            }
        }

        var builder = this.lockfile.stringBuilder();
        const dependency = Dependency{
            .name = String.init(name, name),
            .name_hash = String.Builder.stringHash(name),
            .version = version,
            .behavior = behavior,
        };
        dependency.count(version_buf, @TypeOf(&builder), &builder);

        const cloned_dependency = dependency.clone(version_buf, @TypeOf(&builder), &builder) catch unreachable;
        builder.clamp();
        const index = @truncate(u32, root_deps.items.len);
        root_deps.append(
            .{
                .dependency = cloned_dependency,
            },
        ) catch unreachable;
        this.enqueueDependencyWithMainAndSuccessFn(
            0,
            cloned_dependency,
            index,
            true,
            assignRootResolution,
        ) catch |err| {
            root_deps.items.len = index;
            return .{ .failure = err };
        };

        const resolution_id = root_deps.items[index].resolution_id;
        // check if we managed to synchronously resolve the dependency
        if (resolution_id != invalid_package_id) {
            this.drainDependencyList();
            return .{
                .resolution = .{
                    .resolution = this.lockfile.packages.items(.resolution)[resolution_id],
                    .package_id = resolution_id,
                },
            };
        }

        return .{ .pending = index };
    }

    pub fn globalLinkDir(this: *PackageManager) !std.fs.Dir {
        return this.global_link_dir orelse brk: {
            var global_dir = try Options.openGlobalDir(this.options.explicit_global_directory);
            this.global_dir = global_dir;
            this.global_link_dir = try global_dir.makeOpenPath("node_modules", .{ .iterate = true });
            var buf: [bun.MAX_PATH_BYTES]u8 = undefined;
            const _path = try std.os.getFdPath(this.global_link_dir.?.fd, &buf);
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
        std.mem.set(PreinstallState, this.preinstall_state.items[offset..], PreinstallState.unknown);
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

                const folder_path = manager.cachedNPMPackageFolderName(this.name.slice(lockfile.buffers.string_bytes.items), this.resolution.value.npm.version);
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
                std.mem.copy(u8, &this.progress_name_buf, emoji);
                std.mem.copy(u8, this.progress_name_buf[emoji.len..], name);
                node.name = this.progress_name_buf[0 .. emoji.len + name.len];
            } else {
                std.mem.copy(u8, this.progress_name_buf[emoji.len..], name);
                node.name = this.progress_name_buf[0 .. emoji.len + name.len];
            }
        } else {
            std.mem.copy(u8, &this.progress_name_buf, name);
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
                const cache_dir = fetchCacheDirectoryPath(this.env_loader);
                return std.fs.cwd().makeOpenPath(cache_dir.path, .{ .iterate = true }) catch {
                    this.options.enable.cache = false;
                    continue :loop;
                };
            }

            return std.fs.cwd().makeOpenPath("node_modules/.cache", .{ .iterate = true }) catch |err| {
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
        const default_tempdir = Fs.FileSystem.RealFS.getDefaultTempDir();
        var tried_dot_tmp = false;
        var tempdir: std.fs.Dir = std.fs.cwd().makeOpenPath(default_tempdir, .{ .iterate = true }) catch brk: {
            tried_dot_tmp = true;
            break :brk cache_directory.makeOpenPath(".tmp", .{ .iterate = true }) catch |err| {
                Output.prettyErrorln("<r><red>error<r>: bun is unable to access tempdir: {s}", .{@errorName(err)});
                Global.crash();
            };
        };
        var tmpbuf: ["18446744073709551615".len + 8]u8 = undefined;
        const tmpname = Fs.FileSystem.instance.tmpname("hm", &tmpbuf, 999) catch unreachable;
        var timer: std.time.Timer = if (this.options.log_level != .silent) std.time.Timer.start() catch unreachable else undefined;
        brk: while (true) {
            _ = tempdir.createFileZ(tmpname, .{ .truncate = true }) catch |err2| {
                if (!tried_dot_tmp) {
                    tried_dot_tmp = true;

                    tempdir = cache_directory.makeOpenPath(".tmp", .{ .iterate = true }) catch |err| {
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
                    tempdir = cache_directory.makeOpenPath(".tmp", .{ .iterate = true }) catch |err2| {
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
                var cache_dir_path = std.os.getFdPath(cache_directory.fd, &path_buf) catch "it's";
                Output.prettyErrorln(
                    "<r><yellow>warn<r>: Slow filesystem detected. If {s} is a network drive, consider setting $BUN_INSTALL_CACHE_DIR to a local folder.",
                    .{cache_dir_path},
                );
            }
        }

        return tempdir;
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

    // TODO: normalize to alphanumeric
    pub fn cachedNPMPackageFolderNamePrint(this: *const PackageManager, buf: []u8, name: string, version: Semver.Version) stringZ {
        const scope = this.scopeForPackageName(name);

        const basename = cachedNPMPackageFolderPrintBasename(buf, name, version);

        if (scope.name.len == 0 and !this.options.did_override_default_scope) {
            return basename;
        }

        const spanned = std.mem.span(basename);
        var available = buf[spanned.len..];
        var end: []u8 = undefined;
        if (scope.url.hostname.len > 32 or available.len < 64) {
            const visible_hostname = scope.url.hostname[0..@minimum(scope.url.hostname.len, 12)];
            end = std.fmt.bufPrint(available, "@@{s}__{x}", .{ visible_hostname, String.Builder.stringHash(scope.url.href) }) catch unreachable;
        } else {
            end = std.fmt.bufPrint(available, "@@{s}", .{scope.url.hostname}) catch unreachable;
        }

        buf[spanned.len + end.len] = 0;
        var result: [:0]u8 = buf[0 .. spanned.len + end.len :0];
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
        if (!version.tag.hasPre() and !version.tag.hasBuild()) {
            return std.fmt.bufPrintZ(buf, "{s}@{d}.{d}.{d}", .{ name, version.major, version.minor, version.patch }) catch unreachable;
        } else if (version.tag.hasPre() and version.tag.hasBuild()) {
            return std.fmt.bufPrintZ(
                buf,
                "{s}@{d}.{d}.{d}-{x}+{X}",
                .{ name, version.major, version.minor, version.patch, version.tag.pre.hash, version.tag.build.hash },
            ) catch unreachable;
        } else if (version.tag.hasPre()) {
            return std.fmt.bufPrintZ(
                buf,
                "{s}@{d}.{d}.{d}-{x}",
                .{ name, version.major, version.minor, version.patch, version.tag.pre.hash },
            ) catch unreachable;
        } else if (version.tag.hasBuild()) {
            return std.fmt.bufPrintZ(
                buf,
                "{s}@{d}.{d}.{d}+{X}",
                .{ name, version.major, version.minor, version.patch, version.tag.build.hash },
            ) catch unreachable;
        } else {
            unreachable;
        }

        unreachable;
    }

    pub fn isFolderInCache(this: *PackageManager, folder_path: stringZ) bool {
        // TODO: is this slow?
        var dir = this.getCacheDirectory().openDirZ(folder_path, .{ .iterate = false }) catch return false;
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

        var subpath = std.fmt.bufPrintZ(
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
                const package_name = this.lockfile.str(package_name_);

                return this.pathForCachedNPMPath(buf, package_name, npm.version);
            },
            else => return "",
        }
    }

    pub fn getInstalledVersionsFromDiskCache(this: *PackageManager, tags_buf: *std.ArrayList(u8), package_name: []const u8, allocator: std.mem.Allocator) !std.ArrayList(Semver.Version) {
        var list = std.ArrayList(Semver.Version).init(allocator);
        var dir = this.getCacheDirectory().openDir(package_name, .{ .iterate = true }) catch |err| {
            switch (err) {
                error.FileNotFound, error.NotDir, error.AccessDenied, error.DeviceBusy => {
                    return list;
                },
                else => return err,
            }
        };
        defer dir.close();
        var iter = dir.iterate();

        while (try iter.next()) |entry| {
            if (entry.kind != .Directory and entry.kind != .SymLink) continue;
            const name = entry.name;
            var sliced = SlicedString.init(name, name);
            var parsed = Semver.Version.parse(sliced, allocator);
            if (!parsed.valid or parsed.wildcard != .none) continue;
            // not handling OOM
            // TODO: wildcard
            const total = parsed.version.tag.build.len() + parsed.version.tag.pre.len();
            if (total > 0) {
                tags_buf.ensureUnusedCapacity(total) catch unreachable;
                var available = tags_buf.items.ptr[tags_buf.items.len..tags_buf.capacity];
                const new_version = parsed.version.cloneInto(name, &available);
                tags_buf.items.len += total;
                parsed.version = new_version;
            }

            list.append(parsed.version) catch unreachable;
        }

        return list;
    }

    pub fn resolveFromDiskCache(this: *PackageManager, package_name: []const u8, version: Dependency.Version) ?PackageID {
        if (version.tag != .npm) {
            // only npm supported right now
            // tags are more ambiguous
            return null;
        }

        var arena = std.heap.ArenaAllocator.init(this.allocator);
        defer arena.deinit();
        var arena_alloc = arena.allocator();
        var stack_fallback = std.heap.stackFallback(4096, arena_alloc);
        var allocator = stack_fallback.get();
        var tags_buf = std.ArrayList(u8).init(allocator);
        var installed_versions = this.getInstalledVersionsFromDiskCache(&tags_buf, package_name, allocator) catch |err| {
            Output.debug("error getting installed versions from disk cache: {s}", .{std.mem.span(@errorName(err))});
            return null;
        };

        // TODO: make this fewer passes
        std.sort.sort(
            Semver.Version,
            installed_versions.items,
            @as([]const u8, tags_buf.items),
            Semver.Version.sortGt,
        );
        for (installed_versions.items) |installed_version| {
            if (version.value.npm.satisfies(installed_version)) {
                var buf: [bun.MAX_PATH_BYTES]u8 = undefined;
                var npm_package_path = this.pathForCachedNPMPath(&buf, package_name, installed_version) catch |err| {
                    Output.debug("error getting path for cached npm path: {s}", .{std.mem.span(@errorName(err))});
                    return null;
                };
                const dependency = Dependency.Version{
                    .tag = .npm,
                    .value = .{
                        .npm = Semver.Query.Group.from(installed_version),
                    },
                };
                switch (FolderResolution.getOrPut(.{ .cache_folder = npm_package_path }, dependency, ".", this)) {
                    .new_package_id => |id| {
                        this.enqueueDependencyList(this.lockfile.packages.items(.dependencies)[id], false);
                        return id;
                    },
                    .package_id => |id| {
                        this.enqueueDependencyList(this.lockfile.packages.items(.dependencies)[id], false);
                        return id;
                    },
                    .err => |err| {
                        Output.debug("error getting or putting folder resolution: {s}", .{std.mem.span(@errorName(err))});
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

    pub fn getOrPutResolvedPackageWithFindResult(
        this: *PackageManager,
        name_hash: PackageNameHash,
        name: String,
        version: Dependency.Version,
        dependency_id: PackageID,
        behavior: Behavior,
        manifest: *const Npm.PackageManifest,
        find_result: Npm.PackageManifest.FindResult,
        comptime successFn: SuccessFn,
    ) !?ResolvedPackageResult {

        // Was this package already allocated? Let's reuse the existing one.
        if (this.lockfile.getPackageID(
            name_hash,
            if (behavior.isPeer()) version else null,
            .{
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
            return ResolvedPackageResult{
                .package = this.lockfile.packages.get(id),
                .is_first_time = false,
            };
        }

        var package =
            try Lockfile.Package.fromNPM(
            this.allocator,
            this.lockfile,
            this.log,
            manifest,
            find_result.version,
            find_result.package,
            manifest.string_buf,
            Features.npm,
        );

        // appendPackage sets the PackageID on the package
        package = try this.lockfile.appendPackage(package);

        if (!behavior.isEnabled(if (this.isRootDependency(dependency_id))
            this.options.local_package_features
        else
            this.options.remote_package_features))
        {
            this.setPreinstallState(package.meta.id, this.lockfile, .done);
        }

        const preinstall = this.determinePreinstallState(package, this.lockfile);

        successFn(this, dependency_id, package.meta.id);

        if (comptime Environment.isDebug or Environment.isTest) std.debug.assert(package.meta.id != invalid_package_id);

        switch (preinstall) {
            // Is this package already in the cache?
            // We don't need to download the tarball, but we should enqueue dependencies
            .done => {
                return ResolvedPackageResult{ .package = package, .is_first_time = true };
            },

            // Do we need to download the tarball?
            .extract => {
                const task_id = Task.Id.forNPMPackage(
                    Task.Tag.extract,
                    name.slice(this.lockfile.buffers.string_bytes.items),
                    package.resolution.value.npm.version,
                );

                var network_task = (try this.generateNetworkTaskForTarball(task_id, manifest.str(find_result.package.tarball_url), package)).?;

                return ResolvedPackageResult{
                    .package = package,
                    .is_first_time = true,
                    .network_task = network_task,
                };
            },
            else => unreachable,
        }

        return ResolvedPackageResult{ .package = package };
    }

    pub fn generateNetworkTaskForTarball(this: *PackageManager, task_id: u64, url: string, package: Lockfile.Package) !?*NetworkTask {
        const dedupe_entry = try this.network_dedupe_map.getOrPut(this.allocator, task_id);
        if (dedupe_entry.found_existing) return null;

        var network_task = this.getNetworkTask();

        network_task.* = NetworkTask{
            .task_id = task_id,
            .callback = undefined,
            .allocator = this.allocator,
            .package_manager = this,
        };

        const scope = this.scopeForPackageName(this.lockfile.str(package.name));

        try network_task.forTarball(
            this.allocator,
            ExtractTarball{
                .name = if (package.name.len() >= strings.StringOrTinyString.Max)
                    strings.StringOrTinyString.init(
                        try FileSystem.FilenameStore.instance.append(
                            @TypeOf(this.lockfile.str(package.name)),
                            this.lockfile.str(package.name),
                        ),
                    )
                else
                    strings.StringOrTinyString.init(this.lockfile.str(package.name)),

                .resolution = package.resolution,
                .cache_dir = this.getCacheDirectory(),
                .temp_dir = this.getTemporaryDirectory(),
                .registry = scope.url.href,
                .package_id = package.meta.id,
                .integrity = package.meta.integrity,
                .url = url,
            },
            scope,
        );

        return network_task;
    }

    pub fn fetchVersionsForPackageName(
        this: *PackageManager,
        name: string,
        version: Dependency.Version,
        id: PackageID,
    ) !?Npm.PackageManifest {
        const task_id = Task.Id.forManifest(Task.Tag.package_manifest, name);
        var network_entry = try this.network_dedupe_map.getOrPutContext(this.allocator, task_id, .{});
        var loaded_manifest: ?Npm.PackageManifest = null;
        if (!network_entry.found_existing) {
            if (this.options.enable.manifest_cache) {
                if (this.manifests.get(std.hash.Wyhash.hash(0, name)) orelse (Npm.PackageManifest.Serializer.load(this.allocator, this.cache_directory, name) catch null)) |manifest_| {
                    const manifest: Npm.PackageManifest = manifest_;
                    loaded_manifest = manifest;

                    if (this.options.enable.manifest_cache_control and manifest.pkg.public_max_age > this.timestamp) {
                        try this.manifests.put(this.allocator, @truncate(PackageNameHash, manifest.pkg.name.hash), manifest);
                    }

                    // If it's an exact package version already living in the cache
                    // We can skip the network request, even if it's beyond the caching period
                    if (version.tag == .npm and version.value.npm.isExact()) {
                        if (loaded_manifest.?.findByVersion(version.value.npm.head.head.range.left.version) != null) {
                            return manifest;
                        }
                    }

                    // Was it recent enough to just load it without the network call?
                    if (this.options.enable.manifest_cache_control and manifest.pkg.public_max_age > this.timestamp) {
                        return manifest;
                    }
                }
            }

            if (PackageManager.verbose_install) {
                Output.prettyErrorln("Enqueue package manifest for download: {s}", .{name});
            }

            var network_task = this.getNetworkTask();
            network_task.* = NetworkTask{
                .callback = undefined,
                .task_id = task_id,
                .allocator = this.allocator,
                .package_manager = this,
            };
            try network_task.forManifest(name, this.allocator, this.scopeForPackageName(name), loaded_manifest);
            this.enqueueNetworkTask(network_task);
        }

        var manifest_entry_parse = try this.task_queue.getOrPutContext(this.allocator, task_id, .{});
        if (!manifest_entry_parse.found_existing) {
            manifest_entry_parse.value_ptr.* = TaskCallbackList{};
        }

        try manifest_entry_parse.value_ptr.append(this.allocator, TaskCallbackContext{ .request_id = id });
        return null;
    }

    fn enqueueNetworkTask(this: *PackageManager, task: *NetworkTask) void {
        if (this.network_task_fifo.writableLength() == 0) {
            this.flushNetworkQueue();
        }

        this.network_task_fifo.writeItemAssumeCapacity(task);
    }

    const SuccessFn = fn (*PackageManager, PackageID, PackageID) void;
    fn assignResolution(this: *PackageManager, dependency_id: PackageID, package_id: PackageID) void {
        this.lockfile.buffers.resolutions.items[dependency_id] = package_id;
    }

    fn assignRootResolution(this: *PackageManager, dependency_id: PackageID, package_id: PackageID) void {
        if (this.dynamic_root_dependencies) |*dynamic| {
            dynamic.items[dependency_id].resolution_id = package_id;
        } else {
            if (this.lockfile.buffers.resolutions.items.len > dependency_id) {
                this.lockfile.buffers.resolutions.items[dependency_id] = package_id;
            } else {
                // this means a bug
                bun.unreachablePanic("assignRootResolution: dependency_id: {d} out of bounds (package_id: {d})", .{ dependency_id, package_id });
            }
        }
    }

    pub fn getOrPutResolvedPackage(
        this: *PackageManager,
        name_hash: PackageNameHash,
        name: String,
        version: Dependency.Version,
        behavior: Behavior,
        dependency_id: PackageID,
        resolution: PackageID,
        comptime successFn: SuccessFn,
    ) !?ResolvedPackageResult {
        if (resolution < this.lockfile.packages.len) {
            return ResolvedPackageResult{ .package = this.lockfile.packages.get(resolution) };
        }

        switch (version.tag) {
            .npm, .dist_tag => {
                // Resolve the version from the loaded NPM manifest
                const manifest = this.manifests.getPtr(name_hash) orelse return null; // manifest might still be downloading. This feels unreliable.
                const find_result: Npm.PackageManifest.FindResult = switch (version.tag) {
                    .dist_tag => manifest.findByDistTag(this.lockfile.str(version.value.dist_tag)),
                    .npm => manifest.findBestVersion(version.value.npm),
                    else => unreachable,
                } orelse return switch (version.tag) {
                    .npm => error.NoMatchingVersion,
                    .dist_tag => error.DistTagNotFound,
                    else => unreachable,
                };

                return try getOrPutResolvedPackageWithFindResult(
                    this,
                    name_hash,
                    name,
                    version,
                    dependency_id,
                    behavior,
                    manifest,
                    find_result,
                    successFn,
                );
            },

            .folder => {
                // relative to cwd
                const res = FolderResolution.getOrPut(.{ .relative = void{} }, version, version.value.folder.slice(this.lockfile.buffers.string_bytes.items), this);

                switch (res) {
                    .err => |err| return err,
                    .package_id => |package_id| {
                        successFn(this, dependency_id, package_id);
                        return ResolvedPackageResult{ .package = this.lockfile.packages.get(package_id) };
                    },

                    .new_package_id => |package_id| {
                        successFn(this, dependency_id, package_id);
                        return ResolvedPackageResult{ .package = this.lockfile.packages.get(package_id), .is_first_time = true };
                    },
                }
            },
            .symlink => {
                const res = FolderResolution.getOrPut(.{ .global = try this.globalLinkDirPath() }, version, version.value.symlink.slice(this.lockfile.buffers.string_bytes.items), this);

                switch (res) {
                    .err => |err| return err,
                    .package_id => |package_id| {
                        this.lockfile.buffers.resolutions.items[dependency_id] = package_id;
                        return ResolvedPackageResult{ .package = this.lockfile.packages.get(package_id) };
                    },

                    .new_package_id => |package_id| {
                        this.lockfile.buffers.resolutions.items[dependency_id] = package_id;
                        return ResolvedPackageResult{ .package = this.lockfile.packages.get(package_id), .is_first_time = true };
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

    pub inline fn enqueueDependency(this: *PackageManager, id: u32, dependency: Dependency, resolution: PackageID) !void {
        return try this.enqueueDependencyWithMain(id, dependency, resolution, false);
    }

    pub inline fn enqueueMainDependency(this: *PackageManager, id: u32, dependency: Dependency, resolution: PackageID) !void {
        return try this.enqueueDependencyWithMain(id, dependency, resolution, true);
    }

    fn dynamicRootDependencies(this: *PackageManager) *std.ArrayList(Dependency.Pair) {
        if (this.dynamic_root_dependencies == null) {
            const root_deps = this.lockfile.rootPackage().?.dependencies.get(this.lockfile.buffers.dependencies.items);

            this.dynamic_root_dependencies = std.ArrayList(Dependency.Pair).initCapacity(this.allocator, root_deps.len) catch unreachable;
            this.dynamic_root_dependencies.?.items.len = root_deps.len;
            for (root_deps) |dep, i| {
                this.dynamic_root_dependencies.?.items[i] = .{
                    .dependency = dep,
                    .resolution_id = invalid_package_id,
                };
            }
        }

        return &this.dynamic_root_dependencies.?;
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
        std.mem.writeIntNative(u64, secret[0..8], @intCast(u64, std.time.milliTimestamp()));
        var rng = std.rand.Xoodoo.init(secret).random();
        var base64_bytes: [64]u8 = undefined;
        rng.bytes(&base64_bytes);

        const tmpname__ = std.fmt.bufPrint(tmpname_buf[8..], "{s}", .{std.fmt.fmtSliceHexLower(&base64_bytes)}) catch unreachable;
        tmpname_buf[tmpname__.len + 8] = 0;
        const tmpname = tmpname_buf[0 .. tmpname__.len + 8 :0];

        tmpfile.create(&FileSystem.instance.fs, tmpname) catch |err| {
            Output.prettyErrorln("<r><red>error:<r> failed to create tmpfile: {s}", .{@errorName(err)});
            Global.crash();
        };

        var file = tmpfile.file();
        var file_writer = file.writer();
        var buffered_writer = std.io.BufferedWriter(std.mem.page_size, @TypeOf(file_writer)){
            .unbuffered_writer = file_writer,
        };
        var writer = buffered_writer.writer();
        try Lockfile.Printer.Yarn.print(&printer, @TypeOf(writer), writer);
        try buffered_writer.flush();

        _ = C.fchmod(
            tmpfile.fd,
            // chmod 666,
            0000040 | 0000004 | 0000002 | 0000400 | 0000200 | 0000020,
        );

        try tmpfile.promote(tmpname, std.fs.cwd().fd, "yarn.lock");
    }

    pub fn isRootDependency(this: *const PackageManager, id: PackageID) bool {
        if (this.dynamic_root_dependencies) |*list| {
            const package = this.lockfile.packages.get(id);
            const deps: []const Dependency.Pair = list.items;
            for (deps) |*pair| {
                const dep = &pair.dependency;
                if (dep.name.len() == package.name.len() and dep.name_hash == package.name_hash) {
                    return true;
                }
            }
        }

        return this.root_dependency_list.contains(id);
    }

    fn enqueueDependencyWithMain(
        this: *PackageManager,
        id: u32,
        dependency: Dependency,
        resolution: PackageID,
        comptime is_main: bool,
    ) !void {
        return this.enqueueDependencyWithMainAndSuccessFn(
            id,
            dependency,
            resolution,
            is_main,
            assignResolution,
        );
    }

    pub fn enqueueDependencyWithMainAndSuccessFn(
        this: *PackageManager,
        id: u32,
        dependency: Dependency,
        resolution: PackageID,
        comptime is_main: bool,
        comptime successFn: SuccessFn,
    ) !void {
        const name = dependency.name;
        const name_hash = dependency.name_hash;
        const version: Dependency.Version = dependency.version;
        var loaded_manifest: ?Npm.PackageManifest = null;

        if (comptime !is_main) {
            // it might really be main
            if (!this.isRootDependency(id))
                if (!dependency.behavior.isEnabled(switch (dependency.version.tag) {
                    .folder => this.options.remote_package_features,
                    .dist_tag, .npm => this.options.remote_package_features,
                    else => Features{},
                }))
                    return;
        }

        switch (dependency.version.tag) {
            .folder, .npm, .dist_tag => {
                retry_from_manifests_ptr: while (true) {
                    var resolve_result_ = this.getOrPutResolvedPackage(
                        name_hash,
                        name,
                        version,
                        dependency.behavior,
                        id,
                        resolution,
                        successFn,
                    );

                    retry_with_new_resolve_result: while (true) {
                        const resolve_result = resolve_result_ catch |err| {
                            switch (err) {
                                error.DistTagNotFound => {
                                    if (dependency.behavior.isRequired()) {
                                        this.log.addErrorFmt(
                                            null,
                                            logger.Loc.Empty,
                                            this.allocator,
                                            "package \"{s}\" with tag \"{s}\" not found, but package exists",
                                            .{
                                                this.lockfile.str(name),
                                                this.lockfile.str(version.value.dist_tag),
                                            },
                                        ) catch unreachable;
                                    }

                                    return;
                                },
                                error.NoMatchingVersion => {
                                    if (dependency.behavior.isRequired()) {
                                        this.log.addErrorFmt(
                                            null,
                                            logger.Loc.Empty,
                                            this.allocator,
                                            "No version matching \"{s}\" found for specifier \"{s}\" (but package exists)",
                                            .{
                                                this.lockfile.str(version.literal),
                                                this.lockfile.str(name),
                                            },
                                        ) catch unreachable;
                                    }
                                    return;
                                },
                                else => return err,
                            }
                        };

                        if (resolve_result) |result| {

                            // First time?
                            if (result.is_first_time) {
                                if (PackageManager.verbose_install) {
                                    const label: string = this.lockfile.str(version.literal);

                                    Output.prettyErrorln("   -> \"{s}\": \"{s}\" -> {s}@{}", .{
                                        this.lockfile.str(result.package.name),
                                        label,
                                        this.lockfile.str(result.package.name),
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
                        } else if (!dependency.behavior.isPeer() and dependency.version.tag.isNPM()) {
                            const name_str = this.lockfile.str(name);
                            const task_id = Task.Id.forManifest(Task.Tag.package_manifest, name_str);
                            var network_entry = try this.network_dedupe_map.getOrPutContext(this.allocator, task_id, .{});
                            if (!network_entry.found_existing) {
                                if (this.options.enable.manifest_cache) {
                                    if (Npm.PackageManifest.Serializer.load(this.allocator, this.getCacheDirectory(), name_str) catch null) |manifest_| {
                                        const manifest: Npm.PackageManifest = manifest_;
                                        loaded_manifest = manifest;

                                        if (this.options.enable.manifest_cache_control and manifest.pkg.public_max_age > this.timestamp) {
                                            try this.manifests.put(this.allocator, @truncate(PackageNameHash, manifest.pkg.name.hash), manifest);
                                        }

                                        // If it's an exact package version already living in the cache
                                        // We can skip the network request, even if it's beyond the caching period
                                        if (dependency.version.tag == .npm and dependency.version.value.npm.isExact()) {
                                            if (loaded_manifest.?.findByVersion(dependency.version.value.npm.head.head.range.left.version)) |find_result| {
                                                if (this.getOrPutResolvedPackageWithFindResult(
                                                    name_hash,
                                                    name,
                                                    version,
                                                    id,
                                                    dependency.behavior,
                                                    &loaded_manifest.?,
                                                    find_result,
                                                    successFn,
                                                ) catch null) |new_resolve_result| {
                                                    resolve_result_ = new_resolve_result;
                                                    _ = this.network_dedupe_map.remove(task_id);
                                                    continue :retry_with_new_resolve_result;
                                                }
                                            }
                                        }

                                        // Was it recent enough to just load it without the network call?
                                        if (this.options.enable.manifest_cache_control and manifest.pkg.public_max_age > this.timestamp) {
                                            _ = this.network_dedupe_map.remove(task_id);
                                            continue :retry_from_manifests_ptr;
                                        }
                                    }
                                }

                                if (PackageManager.verbose_install) {
                                    Output.prettyErrorln("Enqueue package manifest for download: {s}", .{this.lockfile.str(name)});
                                }

                                var network_task = this.getNetworkTask();
                                network_task.* = NetworkTask{
                                    .callback = undefined,
                                    .task_id = task_id,
                                    .allocator = this.allocator,
                                };
                                try network_task.forManifest(
                                    this.lockfile.str(name),
                                    this.allocator,
                                    this.scopeForPackageName(this.lockfile.str(name)),
                                    loaded_manifest,
                                );
                                this.enqueueNetworkTask(network_task);
                            }

                            std.debug.assert(task_id != 0);

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
            .symlink => {
                const _result = this.getOrPutResolvedPackage(
                    name_hash,
                    name,
                    version,
                    dependency.behavior,
                    id,
                    resolution,
                    successFn,
                ) catch |err| brk: {
                    if (err == error.MissingPackageJSON) {
                        break :brk null;
                    }

                    return err;
                };

                const not_found_fmt =
                    \\package \"{[name]s}\" is not linked
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
                            const label: string = this.lockfile.str(version.literal);

                            Output.prettyErrorln("   -> \"{s}\": \"{s}\" -> {s}@{}", .{
                                this.lockfile.str(result.package.name),
                                label,
                                this.lockfile.str(result.package.name),
                                result.package.resolution.fmt(this.lockfile.buffers.string_bytes.items),
                            });
                        }
                        // We shouldn't see any dependencies
                        if (result.package.dependencies.len > 0) {
                            try this.lockfile.scratch.dependency_list_queue.writeItem(result.package.dependencies);
                        }
                    }

                    // should not trigger a network call
                    std.debug.assert(result.network_task == null);
                } else if (dependency.behavior.isRequired()) {
                    this.log.addErrorFmt(
                        null,
                        logger.Loc.Empty,
                        this.allocator,
                        not_found_fmt,
                        .{
                            .name = this.lockfile.str(name),
                        },
                    ) catch unreachable;
                } else if (this.options.log_level.isVerbose()) {
                    this.log.addWarningFmt(
                        null,
                        logger.Loc.Empty,
                        this.allocator,
                        not_found_fmt,
                        .{
                            .name = this.lockfile.str(name),
                        },
                    ) catch unreachable;
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

        this.flushNetworkQueue();

        while (dependency_queue.readItem()) |dependencies_list| {
            var i: u32 = dependencies_list.off;
            const end = dependencies_list.off + dependencies_list.len;
            while (i < end) : (i += 1) {
                this.enqueueDependencyWithMain(
                    i,
                    lockfile.buffers.dependencies.items[i],
                    lockfile.buffers.resolutions.items[i],
                    false,
                ) catch {};
            }

            this.flushNetworkQueue();
        }
    }
    pub fn flushDependencyQueue(this: *PackageManager) void {
        this.flushNetworkQueue();
        this.doFlushDependencyQueue();
        this.doFlushDependencyQueue();
        this.doFlushDependencyQueue();
        this.flushNetworkQueue();
    }

    pub fn scheduleNetworkTasks(manager: *PackageManager) usize {
        const count = manager.network_resolve_batch.len + manager.network_tarball_batch.len;

        manager.pending_tasks += @truncate(u32, count);
        manager.total_tasks += @truncate(u32, count);
        manager.network_resolve_batch.push(manager.network_tarball_batch);
        HTTP.http_thread.schedule(manager.network_resolve_batch);
        manager.network_tarball_batch = .{};
        manager.network_resolve_batch = .{};
        return count;
    }

    pub fn enqueueDependencyList(
        this: *PackageManager,
        dependencies_list: Lockfile.DependencySlice,
        comptime is_main: bool,
    ) void {
        this.task_queue.ensureUnusedCapacity(this.allocator, dependencies_list.len) catch unreachable;
        var lockfile = this.lockfile;

        // Step 1. Go through main dependencies
        {
            var i: u32 = dependencies_list.off;
            const end = dependencies_list.off + dependencies_list.len;
            // we have to be very careful with pointers here
            while (i < end) : (i += 1) {
                this.enqueueDependencyWithMain(
                    i,
                    lockfile.buffers.dependencies.items[i],
                    lockfile.buffers.resolutions.items[i],
                    is_main,
                ) catch {};
            }
        }

        this.drainDependencyList();
    }

    pub fn drainDependencyList(this: *PackageManager) void {
        // Step 2. If there were cached dependencies, go through all of those but don't download the devDependencies for them.
        this.flushDependencyQueue();

        if (PackageManager.verbose_install) Output.flush();

        // It's only network requests here because we don't store tarballs.
        const count = this.network_resolve_batch.len + this.network_tarball_batch.len;
        this.pending_tasks += @truncate(u32, count);
        this.total_tasks += @truncate(u32, count);
        this.network_resolve_batch.push(this.network_tarball_batch);
        HTTP.http_thread.schedule(this.network_resolve_batch);
        this.network_tarball_batch = .{};
        this.network_resolve_batch = .{};
    }

    fn processDependencyList(this: *PackageManager, dep_list: TaskCallbackList) !void {
        if (dep_list.items.len > 0) {
            var dependency_list = dep_list;
            for (dependency_list.items) |item| {
                switch (item) {
                    .dependency => |dependency_id| {
                        const dependency = this.lockfile.buffers.dependencies.items[dependency_id];
                        const resolution = this.lockfile.buffers.resolutions.items[dependency_id];

                        try this.enqueueDependency(
                            dependency_id,
                            dependency,
                            resolution,
                        );
                    },

                    .root_dependency => |dependency_id| {
                        const pair = this.dynamicRootDependencies().items[dependency_id];
                        const dependency = pair.dependency;

                        try this.enqueueDependencyWithMainAndSuccessFn(
                            dependency_id,
                            dependency,
                            dependency_id,
                            true,
                            assignRootResolution,
                        );

                        const new_resolution_id = this.dynamicRootDependencies().items[dependency_id].resolution_id;
                        if (new_resolution_id != pair.resolution_id) {
                            Output.debug("Resolved root dependency", .{});
                        }
                    },
                    else => unreachable,
                }
            }

            dependency_list.deinit(this.allocator);
        }
    }

    const CacheDir = struct { path: string, is_node_modules: bool };
    pub fn fetchCacheDirectoryPath(
        env_loader: *DotEnv.Loader,
    ) CacheDir {
        if (env_loader.map.get("BUN_INSTALL_CACHE_DIR")) |dir| {
            return CacheDir{ .path = dir, .is_node_modules = false };
        }

        if (env_loader.map.get("BUN_INSTALL")) |dir| {
            var parts = [_]string{ dir, "install/", "cache/" };
            return CacheDir{ .path = Fs.FileSystem.instance.abs(&parts), .is_node_modules = false };
        }

        if (env_loader.map.get("XDG_CACHE_HOME")) |dir| {
            var parts = [_]string{ dir, ".bun/", "install/", "cache/" };
            return CacheDir{ .path = Fs.FileSystem.instance.abs(&parts), .is_node_modules = false };
        }

        if (env_loader.map.get("HOME")) |dir| {
            var parts = [_]string{ dir, ".bun/", "install/", "cache/" };
            return CacheDir{ .path = Fs.FileSystem.instance.abs(&parts), .is_node_modules = false };
        }

        var fallback_parts = [_]string{"node_modules/.bun-cache"};
        return CacheDir{ .is_node_modules = true, .path = Fs.FileSystem.instance.abs(&fallback_parts) };
    }

    fn runTasks(
        manager: *PackageManager,
        comptime ExtractCompletionContext: type,
        extract_ctx: ExtractCompletionContext,
        comptime callback_fn: anytype,
        comptime log_level: Options.LogLevel,
    ) anyerror!void {
        var batch = ThreadPool.Batch{};
        var has_updated_this_run = false;

        while (manager.network_channel.tryReadItem() catch null) |task_| {
            var task: *NetworkTask = task_;
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
                        if (comptime log_level != .silent) {
                            const fmt = "\n<r><red>error<r>: {s} downloading package manifest <b>{s}<r>\n";
                            const error_name: string = if (task.http.err) |err| std.mem.span(@errorName(err)) else "failed";
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
                    };

                    if (response.status_code > 399) {
                        switch (response.status_code) {
                            404 => {
                                if (comptime log_level != .silent) {
                                    const fmt = "\n<r><red>error<r>: package <b>\"{s}\"<r> not found <d>{s}{s} 404<r>\n";
                                    const args = .{
                                        name.slice(),
                                        task.http.url.displayHostname(),
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
                                    const fmt = "\n<r><red>error<r>: unauthorized <b>\"{s}\"<r> <d>{s}{s} 401<r>\n";
                                    const args = .{
                                        name.slice(),
                                        task.http.url.displayHostname(),
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
                        for (manager.package_json_updates) |*update| {
                            if (strings.eql(update.name, name.slice())) {
                                update.failed = true;
                                manager.options.do.save_lockfile = false;
                                manager.options.do.save_yarn_lock = false;
                                manager.options.do.install_packages = false;
                            }
                        }

                        continue;
                    }

                    if (comptime log_level.isVerbose()) {
                        Output.prettyError("    ", .{});
                        Output.printElapsed(@floatCast(f64, @intToFloat(f128, task.http.elapsed) / std.time.ns_per_ms));
                        Output.prettyError("\n <d>Downloaded <r><green>{s}<r> versions\n", .{name.slice()});
                        Output.flush();
                    }

                    if (response.status_code == 304) {
                        // The HTTP request was cached
                        if (manifest_req.loaded_manifest) |manifest| {
                            var entry = try manager.manifests.getOrPut(manager.allocator, manifest.pkg.name.hash);
                            entry.value_ptr.* = manifest;
                            entry.value_ptr.*.pkg.public_max_age = @truncate(u32, @intCast(u64, @maximum(0, std.time.timestamp()))) + 300;
                            {
                                Npm.PackageManifest.Serializer.save(entry.value_ptr, manager.getTemporaryDirectory(), manager.getCacheDirectory()) catch {};
                            }

                            var dependency_list_entry = manager.task_queue.getEntry(task.task_id).?;

                            var dependency_list = dependency_list_entry.value_ptr.*;
                            dependency_list_entry.value_ptr.* = .{};

                            try manager.processDependencyList(dependency_list);

                            manager.flushDependencyQueue();
                            continue;
                        }
                    }

                    batch.push(ThreadPool.Batch.from(manager.enqueueParseNPMPackage(task.task_id, name, task)));
                },
                .extract => |extract| {
                    const response = task.http.response orelse {
                        const fmt = "\n<r><red>error<r>: {s} downloading tarball <b>{s}@{s}<r>\n";
                        const error_name: string = if (task.http.err) |err| std.mem.span(@errorName(err)) else "failed";
                        const args = .{ error_name, extract.name.slice(), extract.resolution.fmt(manager.lockfile.buffers.string_bytes.items) };

                        if (comptime log_level != .silent) {
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
                        if (comptime log_level != .silent) {
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
                        Output.printElapsed(@floatCast(f64, @intToFloat(f128, task.http.elapsed) / std.time.ns_per_ms));
                        Output.prettyError(" <d>Downloaded <r><green>{s}<r> tarball\n", .{extract.name.slice()});
                        Output.flush();
                    }

                    if (comptime log_level.showProgress()) {
                        if (!has_updated_this_run) {
                            manager.setNodeName(manager.downloads_node.?, extract.name.slice(), ProgressStrings.extract_emoji, true);
                            has_updated_this_run = true;
                        }
                    }

                    batch.push(ThreadPool.Batch.from(manager.enqueueExtractNPMPackage(extract, task)));
                },
                .binlink => {},
            }
        }

        while (manager.resolve_tasks.tryReadItem() catch null) |task_| {
            manager.pending_tasks -= 1;

            var task: Task = task_;
            if (task.log.msgs.items.len > 0) {
                if (Output.enable_ansi_colors) {
                    try task.log.printForLogLevelWithEnableAnsiColors(Output.errorWriter(), true);
                } else {
                    try task.log.printForLogLevelWithEnableAnsiColors(Output.errorWriter(), false);
                }
            }

            switch (task.tag) {
                .package_manifest => {
                    if (task.status == .fail) {
                        if (comptime log_level != .silent) {
                            const fmt = "\n<r><red>rerror<r>: {s} parsing package manifest for <b>{s}<r>";
                            const error_name: string = if (task.err != null) std.mem.span(@errorName(task.err.?)) else @as(string, "Failed");

                            const args = .{ error_name, task.request.package_manifest.name.slice() };
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
                    _ = try manager.manifests.getOrPutValue(manager.allocator, @truncate(PackageNameHash, manifest.pkg.name.hash), manifest);

                    var dependency_list_entry = manager.task_queue.getEntry(task.id).?;
                    var dependency_list = dependency_list_entry.value_ptr.*;
                    dependency_list_entry.value_ptr.* = .{};

                    try manager.processDependencyList(dependency_list);

                    if (comptime log_level.showProgress()) {
                        if (!has_updated_this_run) {
                            manager.setNodeName(manager.downloads_node.?, manifest.name(), ProgressStrings.download_emoji, true);
                            has_updated_this_run = true;
                        }
                    }
                },
                .extract => {
                    if (task.status == .fail) {
                        if (comptime log_level != .silent) {
                            const fmt = "<r><red>error<r>: {s} extracting tarball for <b>{s}<r>";
                            const error_name: string = if (task.err != null) std.mem.span(@errorName(task.err.?)) else @as(string, "Failed");
                            const args = .{
                                error_name,
                                task.request.extract.tarball.name.slice(),
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
                    const package_id = task.request.extract.tarball.package_id;
                    manager.extracted_count += 1;
                    manager.setPreinstallState(package_id, manager.lockfile, .done);

                    if (comptime ExtractCompletionContext != void) {
                        callback_fn(extract_ctx, package_id, comptime log_level);
                    }

                    if (comptime log_level.showProgress()) {
                        if (!has_updated_this_run) {
                            manager.setNodeName(manager.downloads_node.?, task.request.extract.tarball.name.slice(), ProgressStrings.extract_emoji, true);
                            has_updated_this_run = true;
                        }
                    }
                },
                .binlink => {},
            }
        }

        manager.flushDependencyQueue();

        {
            const count = batch.len + manager.network_resolve_batch.len + manager.network_tarball_batch.len;
            manager.pending_tasks += @truncate(u32, count);
            manager.total_tasks += @truncate(u32, count);
            manager.thread_pool.schedule(batch);
            manager.network_resolve_batch.push(manager.network_tarball_batch);
            HTTP.http_thread.schedule(manager.network_resolve_batch);
            manager.network_tarball_batch = .{};
            manager.network_resolve_batch = .{};

            if (comptime log_level.showProgress()) {
                if (comptime ExtractCompletionContext == void) {
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
    }

    pub const Options = struct {
        log_level: LogLevel = LogLevel.default,
        global: bool = false,

        global_bin_dir: std.fs.Dir = std.fs.Dir{ .fd = std.math.maxInt(std.os.fd_t) },
        explicit_global_directory: string = "",
        /// destination directory to link bins into
        // must be a variable due to global installs and bunx
        bin_path: stringZ = "node_modules/.bin",

        lockfile_path: stringZ = Lockfile.default_filename,
        save_lockfile_path: stringZ = Lockfile.default_filename,
        did_override_default_scope: bool = false,
        scope: Npm.Registry.Scope = .{
            .name = "",
            .token = "",
            .url = URL.parse("https://registry.npmjs.org/"),
        },

        registries: Npm.Registry.Map = Npm.Registry.Map{},
        cache_directory: string = "",
        enable: Enable = .{},
        do: Do = .{},
        positionals: []const string = &[_]string{},
        update: Update = Update{},
        dry_run: bool = false,
        remote_package_features: Features = Features{ .peer_dependencies = false },
        local_package_features: Features = Features{ .peer_dependencies = false, .dev_dependencies = true },
        allowed_install_scripts: []const PackageNameHash = &default_allowed_install_scripts,
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

        pub fn isBinPathInPATH(this: *const Options) bool {
            // must be absolute
            if (this.bin_path[0] != std.fs.path.sep) return false;
            var tokenizer = std.mem.split(std.os.getenvZ("PATH") orelse "", ":");
            const spanned = std.mem.span(this.bin_path);
            while (tokenizer.next()) |token| {
                if (strings.eql(token, spanned)) return true;
            }
            return false;
        }

        const default_native_bin_link_allowlist = [_]PackageNameHash{
            String.Builder.stringHash("esbuild"),
            String.Builder.stringHash("turbo"),
        };

        const install_scripts_package_count = 5;
        const default_allowed_install_scripts: [install_scripts_package_count]PackageNameHash = brk: {
            const names = std.mem.span(@embedFile("install-scripts-allowlist.txt"));
            var hashes: [install_scripts_package_count]PackageNameHash = undefined;
            var splitter = std.mem.split(u8, names, "\n");
            var i: usize = 0;
            while (splitter.next()) |item| {
                hashes[i] = String.Builder.stringHash(item);
                i += 1;
            }
            break :brk hashes;
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
            if (std.os.getenvZ("BUN_INSTALL_GLOBAL_DIR")) |home_dir| {
                return try std.fs.cwd().makeOpenPath(home_dir, .{ .iterate = true });
            }

            if (explicit_global_dir.len > 0) {
                return try std.fs.cwd().makeOpenPath(explicit_global_dir, .{ .iterate = true });
            }

            if (std.os.getenvZ("BUN_INSTALL")) |home_dir| {
                var buf: [bun.MAX_PATH_BYTES]u8 = undefined;
                var parts = [_]string{ "install", "global" };
                var path = Path.joinAbsStringBuf(home_dir, &buf, &parts, .auto);
                return try std.fs.cwd().makeOpenPath(path, .{ .iterate = true });
            }

            if (std.os.getenvZ("XDG_CACHE_HOME") orelse std.os.getenvZ("HOME")) |home_dir| {
                var buf: [bun.MAX_PATH_BYTES]u8 = undefined;
                var parts = [_]string{ ".bun", "install", "global" };
                var path = Path.joinAbsStringBuf(home_dir, &buf, &parts, .auto);
                return try std.fs.cwd().makeOpenPath(path, .{ .iterate = true });
            }

            return error.@"No global directory found";
        }

        pub fn openGlobalBinDir(opts_: ?*const Api.BunInstall) !std.fs.Dir {
            if (std.os.getenvZ("BUN_INSTALL_BIN")) |home_dir| {
                return try std.fs.cwd().makeOpenPath(home_dir, .{ .iterate = true });
            }

            if (opts_) |opts| {
                if (opts.global_bin_dir) |home_dir| {
                    if (home_dir.len > 0) {
                        return try std.fs.cwd().makeOpenPath(home_dir, .{ .iterate = true });
                    }
                }
            }

            if (std.os.getenvZ("BUN_INSTALL")) |home_dir| {
                var buf: [bun.MAX_PATH_BYTES]u8 = undefined;
                var parts = [_]string{
                    "bin",
                };
                var path = Path.joinAbsStringBuf(home_dir, &buf, &parts, .auto);
                return try std.fs.cwd().makeOpenPath(path, .{ .iterate = true });
            }

            if (std.os.getenvZ("XDG_CACHE_HOME") orelse std.os.getenvZ("HOME")) |home_dir| {
                var buf: [bun.MAX_PATH_BYTES]u8 = undefined;
                var parts = [_]string{
                    ".bun",
                    "bin",
                };
                var path = Path.joinAbsStringBuf(home_dir, &buf, &parts, .auto);
                return try std.fs.cwd().makeOpenPath(path, .{ .iterate = true });
            }

            return error.@"Missing global bin directory: try setting $BUN_INSTALL";
        }

        pub fn load(
            this: *Options,
            allocator: std.mem.Allocator,
            log: *logger.Log,
            env_loader: *DotEnv.Loader,
            cli_: ?CommandLineArguments,
            bun_install_: ?*Api.BunInstall,
        ) !void {
            this.save_lockfile_path = this.lockfile_path;

            defer {
                this.did_override_default_scope = !strings.eqlComptime(this.scope.url.href, "https://registry.npmjs.org/");
            }
            if (bun_install_) |bun_install| {
                if (bun_install.default_registry) |*registry| {
                    if (registry.url.len == 0) {
                        registry.url = "https://registry.npmjs.org/";
                    }

                    this.scope = try Npm.Registry.Scope.fromAPI("", registry.*, allocator, env_loader);
                }

                if (bun_install.scoped) |scoped| {
                    for (scoped.scopes) |name, i| {
                        try this.registries.put(allocator, Npm.Registry.Scope.hash(name), try Npm.Registry.Scope.fromAPI(name, scoped.registries[i], allocator, env_loader));
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
                    for (bun_install.native_bin_links) |name, i| {
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
                    this.remote_package_features.peer_dependencies = save;
                }

                if (bun_install.production) |production| {
                    if (production) {
                        this.local_package_features.dev_dependencies = false;
                        this.enable.fail_early = true;
                        this.enable.frozen_lockfile = true;
                        this.enable.force_save_lockfile = false;
                    }
                }

                if (bun_install.save_optional) |save| {
                    this.remote_package_features.optional_dependencies = save;
                    this.local_package_features.optional_dependencies = save;
                }

                if (bun_install.lockfile_path) |save| {
                    if (save.len > 0) {
                        this.lockfile_path = try allocator.dupeZ(u8, save);
                        this.save_lockfile_path = this.lockfile_path;
                    }
                }

                if (bun_install.save_lockfile_path) |save| {
                    if (save.len > 0) {
                        this.save_lockfile_path = try allocator.dupeZ(u8, save);
                    }
                }

                this.explicit_global_directory = bun_install.global_dir orelse this.explicit_global_directory;
            }

            const default_disable_progress_bar: bool = brk: {
                if (env_loader.get("BUN_INSTALL_PROGRESS")) |prog| {
                    break :brk strings.eqlComptime(prog, "0");
                }

                if (env_loader.isCI()) {
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
                        if (env_loader.map.get(registry_key)) |registry_| {
                            if (registry_.len > 0 and
                                (strings.startsWith(registry_, "https://") or
                                strings.startsWith(registry_, "http://")))
                            {
                                const prev_scope = this.scope;
                                var api_registry = std.mem.zeroes(Api.NpmRegistry);
                                api_registry.url = registry_;
                                api_registry.token = prev_scope.token;
                                this.scope = try Npm.Registry.Scope.fromAPI("", api_registry, allocator, env_loader);
                                did_set = true;
                                // stage1 bug: break inside inline is broken
                                // break :load_registry;
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
                        if (env_loader.map.get(registry_key)) |registry_| {
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

                if (cli.token.len > 0) {
                    this.scope.token = cli.token;
                }

                if (cli.lockfile.len > 0) {
                    this.lockfile_path = try allocator.dupeZ(u8, cli.lockfile);
                }
            }

            if (env_loader.map.get("BUN_CONFIG_LOCKFILE_SAVE_PATH")) |save_lockfile_path| {
                this.save_lockfile_path = try allocator.dupeZ(u8, save_lockfile_path);
            }

            if (env_loader.map.get("BUN_CONFIG_YARN_LOCKFILE") != null) {
                this.do.save_yarn_lock = true;
            }

            if (env_loader.map.get("BUN_CONFIG_HTTP_RETRY_COUNT")) |retry_count| {
                if (std.fmt.parseInt(i32, retry_count, 10)) |int| {
                    this.max_retry_count = @intCast(u16, @minimum(@maximum(int, 0), 65355));
                } else |_| {}
            }

            if (env_loader.map.get("BUN_CONFIG_LINK_NATIVE_BINS")) |native_packages| {
                const len = std.mem.count(u8, native_packages, " ");
                if (len > 0) {
                    var all = try allocator.alloc(PackageNameHash, this.native_bin_link_allowlist.len + len);
                    std.mem.copy(PackageNameHash, all, this.native_bin_link_allowlist);
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

            // if (env_loader.map.get("BUN_CONFIG_NO_DEDUPLICATE") != null) {
            //     this.enable.deduplicate_packages = false;
            // }

            if (env_loader.map.get("BUN_CONFIG_MAX_HTTP_REQUESTS")) |max_http_requests| {
                load: {
                    AsyncHTTP.max_simultaneous_requests = std.fmt.parseInt(u16, max_http_requests, 10) catch {
                        log.addErrorFmt(
                            null,
                            logger.Loc.Empty,
                            allocator,
                            "BUN_CONFIG_MAX_HTTP_REQUESTS value \"{s}\" is not a valid integer between 1 and 65535",
                            .{max_http_requests},
                        ) catch unreachable;
                        break :load;
                    };

                    if (AsyncHTTP.max_simultaneous_requests == 0) {
                        log.addWarningFmt(
                            null,
                            logger.Loc.Empty,
                            allocator,
                            "BUN_CONFIG_MAX_HTTP_REQUESTS value must be a number between 1 and 65535",
                            .{},
                        ) catch unreachable;
                        AsyncHTTP.max_simultaneous_requests = 255;
                    }
                }
            }

            if (env_loader.map.get("BUN_CONFIG_SKIP_SAVE_LOCKFILE")) |check_bool| {
                this.do.save_lockfile = strings.eqlComptime(check_bool, "0");
            }

            if (env_loader.map.get("BUN_CONFIG_SKIP_LOAD_LOCKFILE")) |check_bool| {
                this.do.load_lockfile = strings.eqlComptime(check_bool, "0");
            }

            if (env_loader.map.get("BUN_CONFIG_SKIP_INSTALL_PACKAGES")) |check_bool| {
                this.do.install_packages = strings.eqlComptime(check_bool, "0");
            }

            if (env_loader.map.get("BUN_CONFIG_NO_VERIFY")) |check_bool| {
                this.do.verify_integrity = !strings.eqlComptime(check_bool, "0");
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
                    std.mem.copy(PackageNameHash, all, this.native_bin_link_allowlist);
                    var remain = all[this.native_bin_link_allowlist.len..];
                    for (cli.link_native_bins) |name, i| {
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
        };
    };

    const ProgressStrings = struct {
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
    };

    const PackageJSONEditor = struct {
        pub fn edit(
            allocator: std.mem.Allocator,
            updates: []UpdateRequest,
            current_package_json: *JSAst.Expr,
            dependency_list: string,
        ) !void {
            const G = JSAst.G;

            var remaining: usize = updates.len;

            // There are three possible scenarios here
            // 1. There is no "dependencies" (or equivalent list) or it is empty
            // 2. There is a "dependencies" (or equivalent list), but the package name already exists in a separate list
            // 3. There is a "dependencies" (or equivalent list), and the package name exists in multiple lists
            ast_modifier: {
                // Try to use the existing spot in the dependencies list if possible
                for (updates) |update, i| {
                    outer: for (dependency_lists_to_check) |list| {
                        if (current_package_json.asProperty(list)) |query| {
                            if (query.expr.data == .e_object) {
                                if (query.expr.asProperty(update.name)) |value| {
                                    if (value.expr.data == .e_string) {
                                        updates[i].e_string = value.expr.data.e_string;
                                        remaining -= 1;
                                    }
                                    break :outer;
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

                var new_dependencies = try allocator.alloc(G.Property, dependencies.len + remaining);
                std.mem.copy(G.Property, new_dependencies, dependencies);
                std.mem.set(G.Property, new_dependencies[dependencies.len..], G.Property{});

                outer: for (updates) |update, j| {
                    if (update.e_string != null) continue;

                    var k: usize = 0;

                    while (k < new_dependencies.len) : (k += 1) {
                        if (new_dependencies[k].key == null) {
                            new_dependencies[k].key = JSAst.Expr.init(
                                JSAst.E.String,
                                JSAst.E.String{
                                    .data = update.name,
                                },
                                logger.Loc.Empty,
                            );

                            new_dependencies[k].value = JSAst.Expr.init(
                                JSAst.E.String,
                                JSAst.E.String{
                                    // we set it later
                                    .data = "",
                                },
                                logger.Loc.Empty,
                            );
                            updates[j].e_string = new_dependencies[k].value.?.data.e_string;
                            continue :outer;
                        }

                        // This actually is a duplicate
                        // like "react" appearing in both "dependencies" and "optionalDependencies"
                        // For this case, we'll just swap remove it
                        if (new_dependencies[k].key.?.data.e_string.eql(string, update.name)) {
                            if (new_dependencies.len > 1) {
                                new_dependencies[k] = new_dependencies[new_dependencies.len - 1];
                                new_dependencies = new_dependencies[0 .. new_dependencies.len - 1];
                            } else {
                                new_dependencies = &[_]G.Property{};
                            }
                        }
                    }
                }

                var needs_new_dependency_list = true;
                var dependencies_object: JSAst.Expr = undefined;
                if (current_package_json.asProperty(dependency_list)) |query| {
                    if (query.expr.data == .e_object) {
                        needs_new_dependency_list = false;

                        dependencies_object = query.expr;
                    }
                }

                if (needs_new_dependency_list) {
                    dependencies_object = JSAst.Expr.init(
                        JSAst.E.Object,
                        JSAst.E.Object{
                            .properties = JSAst.G.Property.List.init(new_dependencies),
                        },
                        logger.Loc.Empty,
                    );
                }

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
                    std.mem.copy(JSAst.G.Property, root_properties, current_package_json.data.e_object.properties.slice());
                    root_properties[root_properties.len - 1].key = JSAst.Expr.init(
                        JSAst.E.String,
                        JSAst.E.String{
                            .data = dependency_list,
                        },
                        logger.Loc.Empty,
                    );
                    root_properties[root_properties.len - 1].value = dependencies_object;
                    current_package_json.* = JSAst.Expr.init(JSAst.E.Object, JSAst.E.Object{ .properties = JSAst.G.Property.List.init(root_properties) }, logger.Loc.Empty);
                }

                dependencies_object.data.e_object.properties = JSAst.G.Property.List.init(new_dependencies);
                dependencies_object.data.e_object.packageJSONSort();
            }

            for (updates) |*update| {
                var str = update.e_string.?;

                if (update.version.tag == .uninitialized) {
                    str.data = latest;
                } else {
                    str.data = update.version.literal.slice(update.version_buf);
                }
            }
        }
    };

    pub fn init(
        ctx: Command.Context,
        package_json_file_: ?std.fs.File,
        comptime params: []const ParamType,
    ) !*PackageManager {
        return initMaybeInstall(ctx, package_json_file_, params, false);
    }

    pub fn initMaybeInstall(
        ctx: Command.Context,
        package_json_file_: ?std.fs.File,
        comptime params: []const ParamType,
        comptime is_install: bool,
    ) !*PackageManager {
        var _ctx = ctx;
        var cli = try CommandLineArguments.parse(ctx.allocator, params, &_ctx);

        if (comptime is_install) {
            if (cli.positionals.len > 1) {
                return error.SwitchToBunAdd;
            }
        }

        return try initWithCLI(_ctx, package_json_file_, cli);
    }

    pub fn initWithCLI(
        ctx: Command.Context,
        package_json_file_: ?std.fs.File,
        cli: CommandLineArguments,
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

        var fs = try Fs.FileSystem.init1(ctx.allocator, null);
        var original_cwd = std.mem.trimRight(u8, fs.top_level_dir, "/");

        std.mem.copy(u8, &cwd_buf, original_cwd);

        // Step 1. Find the nearest package.json directory
        //
        // We will walk up from the cwd, calling chdir on each directory until we find a package.json
        // If we fail to find one, we will report an error saying no packages to install
        var package_json_file: std.fs.File = undefined;

        if (package_json_file_) |file| {
            package_json_file = file;
        } else {

            // can't use orelse due to a stage1 bug
            package_json_file = std.fs.cwd().openFileZ("package.json", .{ .mode = .read_write }) catch brk: {
                var this_cwd = original_cwd;
                outer: while (std.fs.path.dirname(this_cwd)) |parent| {
                    cwd_buf[parent.len] = 0;
                    var chdir = cwd_buf[0..parent.len :0];

                    std.os.chdirZ(chdir) catch |err| {
                        Output.prettyErrorln("Error {s} while chdir - {s}", .{ @errorName(err), std.mem.span(chdir) });
                        Output.flush();
                        return err;
                    };

                    break :brk std.fs.cwd().openFileZ("package.json", .{ .mode = .read_write }) catch {
                        this_cwd = parent;
                        continue :outer;
                    };
                }

                std.mem.copy(u8, &cwd_buf, original_cwd);
                cwd_buf[original_cwd.len] = 0;
                var real_cwd: [:0]u8 = cwd_buf[0..original_cwd.len :0];
                std.os.chdirZ(real_cwd) catch {};

                return error.MissingPackageJSON;
            };
        }

        fs.top_level_dir = try std.os.getcwd(&cwd_buf);
        cwd_buf[fs.top_level_dir.len] = '/';
        cwd_buf[fs.top_level_dir.len + 1] = 0;
        fs.top_level_dir = cwd_buf[0 .. fs.top_level_dir.len + 1];
        std.mem.copy(u8, &package_json_cwd_buf, fs.top_level_dir);
        std.mem.copy(u8, package_json_cwd_buf[fs.top_level_dir.len..], "package.json");

        var entries_option = try fs.fs.readDirectory(fs.top_level_dir, null);
        var options = Options{
            .global = cli.global,
        };

        var env_loader: *DotEnv.Loader = brk: {
            var map = try ctx.allocator.create(DotEnv.Map);
            map.* = DotEnv.Map.init(ctx.allocator);

            var loader = try ctx.allocator.create(DotEnv.Loader);
            loader.* = DotEnv.Loader.init(map, ctx.allocator);
            break :brk loader;
        };

        env_loader.loadProcess();
        try env_loader.load(&fs.fs, &entries_option.entries, false);

        if (env_loader.map.get("BUN_INSTALL_VERBOSE") != null) {
            PackageManager.verbose_install = true;
        }

        if (PackageManager.verbose_install) {
            Output.prettyErrorln("Cache Dir: {s}", .{options.cache_directory});
            Output.flush();
        }

        var cpu_count = @truncate(u32, ((try std.Thread.getCpuCount()) + 1));

        if (env_loader.map.get("GOMAXPROCS")) |max_procs| {
            if (std.fmt.parseInt(u32, max_procs, 10)) |cpu_count_| {
                cpu_count = @minimum(cpu_count, cpu_count_);
            } else |_| {}
        }

        var manager = &instance;
        // var progress = Progress{};
        // var node = progress.start(name: []const u8, estimated_total_items: usize)
        manager.* = PackageManager{
            .options = options,
            .network_task_fifo = NetworkQueue.init(),
            .env_loader = env_loader,
            .allocator = ctx.allocator,
            .log = ctx.log,
            .root_dir = &entries_option.entries,
            .env = env_loader,
            .cpu_count = cpu_count,
            .thread_pool = ThreadPool.init(.{
                .max_threads = cpu_count,
            }),
            .resolve_tasks = TaskChannel.init(),
            .lockfile = undefined,
            .root_package_json_file = package_json_file,
            .waiter = try Waker.init(ctx.allocator),
            // .progress
        };
        manager.lockfile = try ctx.allocator.create(Lockfile);

        if (!manager.options.enable.cache) {
            manager.options.enable.manifest_cache = false;
            manager.options.enable.manifest_cache_control = false;
        }

        if (env_loader.map.get("BUN_MANIFEST_CACHE")) |manifest_cache| {
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
            env_loader,
            cli,
            ctx.install,
        );

        manager.timestamp = @truncate(u32, @intCast(u64, @maximum(std.time.timestamp(), 0)));
        return manager;
    }

    pub fn initWithRuntime(
        log: *logger.Log,
        allocator: std.mem.Allocator,
        cli: CommandLineArguments,
        env_loader: *DotEnv.Loader,
        main_file_name: []const u8,
    ) !*PackageManager {
        if (env_loader.map.get("BUN_INSTALL_VERBOSE") != null) {
            PackageManager.verbose_install = true;
        }

        var cpu_count = @truncate(u32, ((try std.Thread.getCpuCount()) + 1));

        if (env_loader.map.get("GOMAXPROCS")) |max_procs| {
            if (std.fmt.parseInt(u32, max_procs, 10)) |cpu_count_| {
                cpu_count = @minimum(cpu_count, cpu_count_);
            } else |_| {}
        }

        var manager = &instance;
        var root_dir = try Fs.FileSystem.instance.fs.readDirectory(
            Fs.FileSystem.instance.top_level_dir,
            null,
        );
        // var progress = Progress{};
        // var node = progress.start(name: []const u8, estimated_total_items: usize)
        manager.* = PackageManager{
            .options = .{},
            .network_task_fifo = NetworkQueue.init(),
            .env_loader = env_loader,
            .allocator = allocator,
            .log = log,
            .root_dir = &root_dir.entries,
            .env = env_loader,
            .cpu_count = cpu_count,
            .thread_pool = ThreadPool.init(.{
                .max_threads = cpu_count,
            }),
            .resolve_tasks = TaskChannel.init(),
            .lockfile = undefined,
            .root_package_json_file = undefined,
            .waiter = try Waker.init(allocator),
            // .progress
        };
        manager.lockfile = try allocator.create(Lockfile);

        if (!manager.options.enable.cache) {
            manager.options.enable.manifest_cache = false;
            manager.options.enable.manifest_cache_control = false;
        }

        if (env_loader.map.get("BUN_MANIFEST_CACHE")) |manifest_cache| {
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
            env_loader,
            cli,
            null,
        );

        manager.timestamp = @truncate(u32, @intCast(u64, @maximum(std.time.timestamp(), 0)));

        manager.lockfile = brk: {
            var buf: [bun.MAX_PATH_BYTES]u8 = undefined;

            if (main_file_name.len > 0) {
                const extlen = std.fs.path.extension(main_file_name);
                @memcpy(&buf, main_file_name.ptr, main_file_name.len - extlen.len);
                buf[main_file_name.len - extlen.len .. buf.len][0..".lockb".len].* = ".lockb".*;
                buf[main_file_name.len - extlen.len .. buf.len][".lockb".len] = 0;

                var lockfile_path = buf[0 .. main_file_name.len - extlen.len + ".lockb".len];
                buf[lockfile_path.len] = 0;
                var lockfile_path_z = std.meta.assumeSentinel(buf[0..lockfile_path.len], 0);
                const result = manager.lockfile.loadFromDisk(
                    allocator,
                    log,
                    lockfile_path_z,
                );

                if (result == .ok) {
                    break :brk result.ok;
                }
            }

            {
                var basedir = if (main_file_name.len > 0)
                    std.fs.path.dirname(main_file_name) orelse "/"
                else
                    FileSystem.instance.top_level_dir;

                var parts = [_]string{
                    basedir,
                    "bun.lockb",
                };
                var lockfile_path = Path.joinAbsStringBuf(
                    Fs.FileSystem.instance.top_level_dir,
                    &buf,
                    &parts,
                    .auto,
                );
                buf[lockfile_path.len] = 0;
                var lockfile_path_z = std.meta.assumeSentinel(buf[0..lockfile_path.len], 0);

                const result = manager.lockfile.loadFromDisk(
                    allocator,
                    log,
                    lockfile_path_z,
                );

                if (result == .ok) {
                    break :brk result.ok;
                }
            }

            try manager.lockfile.initEmpty(allocator);
            break :brk manager.lockfile;
        };

        return manager;
    }

    pub inline fn add(
        ctx: Command.Context,
    ) !void {
        try updatePackageJSONAndInstall(ctx, .add, &add_params);
    }

    pub inline fn remove(
        ctx: Command.Context,
    ) !void {
        try updatePackageJSONAndInstall(ctx, .remove, &remove_params);
    }

    pub inline fn link(
        ctx: Command.Context,
    ) !void {
        var manager = PackageManager.init(ctx, null, &link_params) catch |err| brk: {
            switch (err) {
                error.MissingPackageJSON => {
                    var package_json_file = std.fs.cwd().createFileZ("package.json", .{ .read = true }) catch |err2| {
                        Output.prettyErrorln("<r><red>error:<r> {s} create package.json", .{@errorName(err2)});
                        Global.crash();
                    };
                    try package_json_file.pwriteAll("{\"dependencies\": {}}", 0);

                    break :brk try PackageManager.init(ctx, package_json_file, &link_params);
                },
                else => return err,
            }

            unreachable;
        };

        if (manager.options.log_level != .silent) {
            Output.prettyErrorln("<r><b>bun link <r><d>v" ++ Global.package_json_version ++ "<r>\n", .{});
            Output.flush();
        }

        if (manager.options.positionals.len == 1) {
            // bun link

            var lockfile: Lockfile = undefined;
            var name: string = "";
            var package: Lockfile.Package = Lockfile.Package{};

            // Step 1. parse the nearest package.json file
            {
                var current_package_json_stat = try manager.root_package_json_file.stat();
                var current_package_json_buf = try ctx.allocator.alloc(u8, current_package_json_stat.size + 64);
                const current_package_json_contents_len = try manager.root_package_json_file.preadAll(
                    current_package_json_buf,
                    0,
                );

                const package_json_source = logger.Source.initPathString(
                    package_json_cwd_buf[0 .. FileSystem.instance.top_level_dir.len + "package.json".len],
                    current_package_json_buf[0..current_package_json_contents_len],
                );
                try lockfile.initEmpty(ctx.allocator);

                try Lockfile.Package.parseMain(&lockfile, &package, ctx.allocator, manager.log, package_json_source, Features.folder);
                name = lockfile.str(package.name);
                if (name.len == 0) {
                    if (manager.options.log_level != .silent)
                        Output.prettyErrorln("<r><red>error:<r> package.json missing \"name\" <d>in \"{s}\"<r>", .{package_json_source.path.text});
                    Global.crash();
                } else if (!strings.isNPMPackageName(name)) {
                    if (manager.options.log_level != .silent)
                        Output.prettyErrorln("<r><red>error:<r> invalid package.json name \"{s}\" <d>in \"{s}\"<r>", .{
                            name,
                            package_json_source.path.text,
                        });
                    Global.crash();
                }
            }

            // Step 2. Setup the global directory
            var node_modules: std.fs.Dir = brk: {
                Bin.Linker.umask = C.umask(0);
                var explicit_global_dir: string = "";
                if (ctx.install) |install_| {
                    explicit_global_dir = install_.global_dir orelse explicit_global_dir;
                }
                manager.global_dir = try Options.openGlobalDir(explicit_global_dir);

                try manager.setupGlobalDir(&ctx);

                break :brk manager.global_dir.?.makeOpenPath("node_modules", .{ .iterate = true }) catch |err| {
                    if (manager.options.log_level != .silent)
                        Output.prettyErrorln("<r><red>error:<r> failed to create node_modules in global dir due to error {s}", .{@errorName(err)});
                    Global.crash();
                };
            };

            // Step 3a. symlink to the node_modules folder
            {
                // delete it if it exists
                node_modules.deleteTree(name) catch {};

                // create the symlink
                node_modules.symLink(Fs.FileSystem.instance.topLevelDirWithoutTrailingSlash(), name, .{ .is_directory = true }) catch |err| {
                    if (manager.options.log_level != .silent)
                        Output.prettyErrorln("<r><red>error:<r> failed to create symlink to node_modules in global dir due to error {s}", .{@errorName(err)});
                    Global.crash();
                };
            }

            // Step 3b. Link any global bins
            if (package.bin.tag != .none) {
                var bin_linker = Bin.Linker{
                    .bin = package.bin,
                    .package_installed_node_modules = node_modules.fd,
                    .global_bin_path = manager.options.bin_path,
                    .global_bin_dir = manager.options.global_bin_dir,

                    // .destination_dir_subpath = destination_dir_subpath,
                    .root_node_modules_folder = node_modules.fd,
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
                    \\<r><green>Success!<r> Registered \"{[name]s}\"
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
                .default => try updatePackageJSONAndInstallWithManager(ctx, manager, .link, .default),
                .verbose => try updatePackageJSONAndInstallWithManager(ctx, manager, .link, .verbose),
                .silent => try updatePackageJSONAndInstallWithManager(ctx, manager, .link, .silent),
                .default_no_progress => try updatePackageJSONAndInstallWithManager(ctx, manager, .link, .default_no_progress),
                .verbose_no_progress => try updatePackageJSONAndInstallWithManager(ctx, manager, .link, .verbose_no_progress),
            }
        }
    }

    pub inline fn unlink(
        ctx: Command.Context,
    ) !void {
        var manager = PackageManager.init(ctx, null, &unlink_params) catch |err| brk: {
            switch (err) {
                error.MissingPackageJSON => {
                    var package_json_file = std.fs.cwd().createFileZ("package.json", .{ .read = true }) catch |err2| {
                        Output.prettyErrorln("<r><red>error:<r> {s} create package.json", .{@errorName(err2)});
                        Global.crash();
                    };
                    try package_json_file.pwriteAll("{\"dependencies\": {}}", 0);

                    break :brk try PackageManager.init(ctx, package_json_file, &unlink_params);
                },
                else => return err,
            }

            unreachable;
        };

        if (manager.options.log_level != .silent) {
            Output.prettyErrorln("<r><b>bun unlink <r><d>v" ++ Global.package_json_version ++ "<r>\n", .{});
            Output.flush();
        }

        if (manager.options.positionals.len == 1) {
            // bun unlink

            var lockfile: Lockfile = undefined;
            var name: string = "";
            var package: Lockfile.Package = Lockfile.Package{};

            // Step 1. parse the nearest package.json file
            {
                var current_package_json_stat = try manager.root_package_json_file.stat();
                var current_package_json_buf = try ctx.allocator.alloc(u8, current_package_json_stat.size + 64);
                const current_package_json_contents_len = try manager.root_package_json_file.preadAll(
                    current_package_json_buf,
                    0,
                );

                const package_json_source = logger.Source.initPathString(
                    package_json_cwd_buf[0 .. FileSystem.instance.top_level_dir.len + "package.json".len],
                    current_package_json_buf[0..current_package_json_contents_len],
                );
                try lockfile.initEmpty(ctx.allocator);

                try Lockfile.Package.parseMain(&lockfile, &package, ctx.allocator, manager.log, package_json_source, Features.folder);
                name = lockfile.str(package.name);
                if (name.len == 0) {
                    if (manager.options.log_level != .silent)
                        Output.prettyErrorln("<r><red>error:<r> package.json missing \"name\" <d>in \"{s}\"<r>", .{package_json_source.path.text});
                    Global.crash();
                } else if (!strings.isNPMPackageName(name)) {
                    if (manager.options.log_level != .silent)
                        Output.prettyErrorln("<r><red>error:<r> invalid package.json name \"{s}\" <d>in \"{s}\"<r>", .{
                            name,
                            package_json_source.path.text,
                        });
                    Global.crash();
                }
            }

            switch (Syscall.lstat(Path.joinAbsStringZ(try manager.globalLinkDirPath(), &.{name}, .auto))) {
                .result => |stat| {
                    if (!std.os.S.ISLNK(stat.mode)) {
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
                Bin.Linker.umask = C.umask(0);
                var explicit_global_dir: string = "";
                if (ctx.install) |install_| {
                    explicit_global_dir = install_.global_dir orelse explicit_global_dir;
                }
                manager.global_dir = try Options.openGlobalDir(explicit_global_dir);

                try manager.setupGlobalDir(&ctx);

                break :brk manager.global_dir.?.makeOpenPath("node_modules", .{ .iterate = true }) catch |err| {
                    if (manager.options.log_level != .silent)
                        Output.prettyErrorln("<r><red>error:<r> failed to create node_modules in global dir due to error {s}", .{@errorName(err)});
                    Global.crash();
                };
            };

            // Step 3b. Link any global bins
            if (package.bin.tag != .none) {
                var bin_linker = Bin.Linker{
                    .bin = package.bin,
                    .package_installed_node_modules = node_modules.fd,
                    .global_bin_path = manager.options.bin_path,
                    .global_bin_dir = manager.options.global_bin_dir,

                    // .destination_dir_subpath = destination_dir_subpath,
                    .root_node_modules_folder = node_modules.fd,
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
            Global.exit(1);
        }
    }

    const ParamType = clap.Param(clap.Help);
    const platform_specific_backend_label = if (Environment.isMac)
        "Possible values: \"clonefile\" (default), \"hardlink\", \"symlink\", \"copyfile\""
    else
        "Possible values: \"hardlink\" (default), \"symlink\", \"copyfile\"";

    pub const install_params_ = [_]ParamType{
        clap.parseParam("-c, --config <STR>?               Load config (bunfig.toml)") catch unreachable,
        clap.parseParam("-y, --yarn                        Write a yarn.lock file (yarn v1)") catch unreachable,
        clap.parseParam("-p, --production                  Don't install devDependencies") catch unreachable,
        clap.parseParam("--no-save                         Don't save a lockfile") catch unreachable,
        clap.parseParam("--dry-run                         Don't install anything") catch unreachable,
        clap.parseParam("--lockfile <PATH>                  Store & load a lockfile at a specific filepath") catch unreachable,
        clap.parseParam("-f, --force                       Always request the latest versions from the registry & reinstall all dependencies") catch unreachable,
        clap.parseParam("--cache-dir <PATH>                 Store & load cached data from a specific directory path") catch unreachable,
        clap.parseParam("--no-cache                        Ignore manifest cache entirely") catch unreachable,
        clap.parseParam("--silent                          Don't log anything") catch unreachable,
        clap.parseParam("--verbose                         Excessively verbose logging") catch unreachable,
        clap.parseParam("--no-progress                     Disable the progress bar") catch unreachable,
        clap.parseParam("--no-verify                       Skip verifying integrity of newly downloaded packages") catch unreachable,
        clap.parseParam("--ignore-scripts                  Skip lifecycle scripts in the project's package.json (dependency scripts are never run)") catch unreachable,
        clap.parseParam("-g, --global                      Install globally") catch unreachable,
        clap.parseParam("--cwd <STR>                       Set a specific cwd") catch unreachable,
        clap.parseParam("--backend <STR>                   Platform-specific optimizations for installing dependencies. " ++ platform_specific_backend_label) catch unreachable,
        clap.parseParam("--link-native-bins <STR>...       Link \"bin\" from a matching platform-specific \"optionalDependencies\" instead. Default: esbuild, turbo") catch unreachable,

        // clap.parseParam("--omit <STR>...                   Skip installing dependencies of a certain type. \"dev\", \"optional\", or \"peer\"") catch unreachable,
        // clap.parseParam("--no-dedupe                       Disable automatic downgrading of dependencies that would otherwise cause unnecessary duplicate package versions ($BUN_CONFIG_NO_DEDUPLICATE)") catch unreachable,

        clap.parseParam("--help                            Print this help menu") catch unreachable,
    };

    pub const install_params = install_params_ ++ [_]ParamType{
        clap.parseParam("<POS> ...                         ") catch unreachable,
    };

    pub const add_params = install_params_ ++ [_]ParamType{
        clap.parseParam("-d, --development                 Add dependency to \"devDependencies\"") catch unreachable,
        clap.parseParam("--optional                        Add dependency to \"optionalDependencies\"") catch unreachable,
        clap.parseParam("<POS> ...                         \"name\" or \"name@version\" of packages to install") catch unreachable,
    };

    pub const remove_params = install_params_ ++ [_]ParamType{
        clap.parseParam("<POS> ...                         \"name\" of packages to remove from package.json") catch unreachable,
    };

    pub const link_params = install_params_ ++ [_]ParamType{
        clap.parseParam("--save                            Save to package.json") catch unreachable,
        clap.parseParam("<POS> ...                         \"name\" install package as a link") catch unreachable,
    };

    pub const unlink_params = install_params_ ++ [_]ParamType{
        clap.parseParam("--save                            Save to package.json") catch unreachable,
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

        link_native_bins: []const string = &[_]string{},

        development: bool = false,
        optional: bool = false,

        no_optional: bool = false,
        omit: Omit = Omit{},

        const Omit = struct {
            dev: bool = false,
            optional: bool = true,
            peer: bool = false,

            pub inline fn toFeatures(this: Omit) Features {
                return Features{
                    .dev_dependencies = this.dev,
                    .optional_dependencies = this.optional,
                    .peer_dependencies = this.peer,
                };
            }
        };

        pub fn parse(
            allocator: std.mem.Allocator,
            comptime params: []const ParamType,
            ctx: *Command.Context,
        ) !CommandLineArguments {
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
                Output.prettyln("\n<b><magenta>bun<r> (package manager) flags:<r>\n\n", .{});
                Output.flush();

                clap.help(Output.writer(), params) catch {};

                Global.exit(0);
            }

            var cli = CommandLineArguments{};
            cli.yarn = args.flag("--yarn");
            cli.production = args.flag("--production");
            cli.no_save = args.flag("--no-save");
            cli.no_progress = args.flag("--no-progress");
            cli.dry_run = args.flag("--dry-run");
            cli.global = args.flag("--global");
            cli.force = args.flag("--force");
            cli.no_verify = args.flag("--no-verify");
            // cli.no_dedupe = args.flag("--no-dedupe");
            cli.no_cache = args.flag("--no-cache");
            cli.silent = args.flag("--silent");
            cli.verbose = args.flag("--verbose");
            cli.ignore_scripts = args.flag("--ignore-scripts");
            if (comptime @TypeOf(args).hasFlag("--save")) {
                cli.no_save = true;

                if (args.flag("--save")) {
                    cli.no_save = false;
                }
            }

            if (args.option("--config")) |opt| {
                cli.config = opt;
            }

            try BunArguments.loadConfig(allocator, cli.config, ctx, .InstallCommand);

            cli.link_native_bins = args.options("--link-native-bins");

            if (comptime params.len == add_params.len) {
                cli.development = args.flag("--development");
                cli.optional = args.flag("--optional");
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
            //         Global.exit(1);
            //     }
            // }

            if (args.option("--lockfile")) |lockfile| {
                cli.lockfile = lockfile;
            }

            if (args.option("--cwd")) |cwd_| {
                var buf: [bun.MAX_PATH_BYTES]u8 = undefined;
                var buf2: [bun.MAX_PATH_BYTES]u8 = undefined;
                var final_path: [:0]u8 = undefined;
                if (cwd_.len > 0 and cwd_[0] == '.') {
                    var cwd = try std.os.getcwd(&buf);
                    var parts = [_]string{cwd_};
                    var path_ = Path.joinAbsStringBuf(cwd, &buf2, &parts, .auto);
                    buf2[path_.len] = 0;
                    final_path = buf2[0..path_.len :0];
                } else {
                    std.mem.copy(u8, &buf, cwd_);
                    buf[cwd_.len] = 0;
                    final_path = buf[0..cwd_.len :0];
                }
                try std.os.chdirZ(final_path);
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
        resolved_version_buf: string = "",
        version: Dependency.Version = Dependency.Version{},
        version_buf: []const u8 = "",
        missing_version: bool = false,
        failed: bool = false,
        // This must be cloned to handle when the AST store resets
        e_string: ?*JSAst.E.String = null,

        pub const Array = std.BoundedArray(UpdateRequest, 64);

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
                var request = UpdateRequest{
                    .name = positional,
                };
                var unscoped_name = positional;
                request.name = unscoped_name;

                // request.name = "@package..." => unscoped_name = "package..."
                if (unscoped_name.len > 0 and unscoped_name[0] == '@') {
                    unscoped_name = unscoped_name[1..];
                }

                // if there is a semver in package name...
                if (std.mem.indexOfScalar(u8, unscoped_name, '@')) |i| {
                    // unscoped_name = "package@1.0.0" => request.name = "package"
                    request.name = unscoped_name[0..i];

                    // if package was scoped, put "@" back in request.name
                    if (unscoped_name.ptr != positional.ptr) {
                        request.name = positional[0 .. i + 1];
                    }

                    // unscoped_name = "package@1.0.0" => request.version_buf = "1.0.0"
                    if (unscoped_name.len > i + 1) request.version_buf = unscoped_name[i + 1 ..];
                }

                if (strings.hasPrefix("http://", request.name) or
                    strings.hasPrefix("https://", request.name))
                {
                    if (Output.isEmojiEnabled()) {
                        Output.prettyErrorln("<r>😢 <red>error<r><d>:<r> bun {s} http://url is not implemented yet.", .{
                            @tagName(op),
                        });
                    } else {
                        Output.prettyErrorln("<r><red>error<r><d>:<r> bun {s} http://url is not implemented yet.", .{
                            @tagName(op),
                        });
                    }

                    Global.exit(1);
                }

                request.name = std.mem.trim(u8, request.name, "\n\r\t");
                if (request.name.len == 0) continue;

                request.name_hash = String.Builder.stringHash(request.name);
                for (update_requests.constSlice()) |*prev| {
                    if (prev.name_hash == request.name_hash and request.name.len == prev.name.len) continue :outer;
                }

                request.version_buf = std.mem.trim(u8, request.version_buf, "\n\r\t");

                // https://github.com/npm/npm-package-arg/blob/fbaf2fd0b72a0f38e7c24260fd4504f4724c9466/npa.js#L330
                if (strings.hasPrefix("https://", request.version_buf) or
                    strings.hasPrefix("http://", request.version_buf))
                {
                    if (Output.isEmojiEnabled()) {
                        Output.prettyErrorln("<r>😢 <red>error<r><d>:<r> bun {s} http://url is not implemented yet.", .{
                            @tagName(op),
                        });
                    } else {
                        Output.prettyErrorln("<r><red>error<r><d>:<r> bun {s} http://url is not implemented yet.", .{
                            @tagName(op),
                        });
                    }

                    Global.exit(1);
                }

                if ((op == .link or op == .unlink) and !strings.hasPrefixComptime(request.version_buf, "link:")) {
                    request.version_buf = std.fmt.allocPrint(allocator, "link:{s}", .{request.name}) catch unreachable;
                }

                if (request.version_buf.len == 0) {
                    request.missing_version = true;
                } else {
                    const sliced = SlicedString.init(request.version_buf, request.version_buf);
                    request.version = Dependency.parse(allocator, request.version_buf, &sliced, log) orelse Dependency.Version{};
                }

                update_requests.append(request) catch break;
            }

            return update_requests.slice();
        }
    };

    fn updatePackageJSONAndInstall(
        ctx: Command.Context,
        comptime op: Lockfile.Package.Diff.Op,
        comptime params: []const ParamType,
    ) !void {
        var manager = PackageManager.init(ctx, null, params) catch |err| brk: {
            switch (err) {
                error.MissingPackageJSON => {
                    if (op == .add or op == .update) {
                        var package_json_file = std.fs.cwd().createFileZ("package.json", .{ .read = true }) catch |err2| {
                            Output.prettyErrorln("<r><red>error:<r> {s} create package.json", .{@errorName(err2)});
                            Global.crash();
                        };
                        try package_json_file.pwriteAll("{\"dependencies\": {}}", 0);

                        break :brk try PackageManager.init(ctx, package_json_file, params);
                    }

                    Output.prettyErrorln("<r>No package.json, so nothing to remove\n", .{});
                    Global.crash();
                },
                else => return err,
            }

            unreachable;
        };

        if (manager.options.log_level != .silent) {
            Output.prettyErrorln("<r><b>bun " ++ @tagName(op) ++ " <r><d>v" ++ Global.package_json_version ++ "<r>\n", .{});
            Output.flush();
        }

        switch (manager.options.log_level) {
            .default => try updatePackageJSONAndInstallWithManager(ctx, manager, op, .default),
            .verbose => try updatePackageJSONAndInstallWithManager(ctx, manager, op, .verbose),
            .silent => try updatePackageJSONAndInstallWithManager(ctx, manager, op, .silent),
            .default_no_progress => try updatePackageJSONAndInstallWithManager(ctx, manager, op, .default_no_progress),
            .verbose_no_progress => try updatePackageJSONAndInstallWithManager(ctx, manager, op, .verbose_no_progress),
        }
    }

    const dependency_lists_to_check = [_]string{
        "dependencies",
        "devDependencies",
        "optionalDependencies",
        "peerDependencies",
    };

    fn updatePackageJSONAndInstallWithManager(
        ctx: Command.Context,
        manager: *PackageManager,
        comptime op: Lockfile.Package.Diff.Op,
        comptime log_level: Options.LogLevel,
    ) !void {
        var update_requests = try UpdateRequest.Array.init(0);

        if (manager.options.positionals.len == 1) {
            var examples_to_print: [3]string = undefined;

            const off = @intCast(u64, std.time.milliTimestamp());

            switch (op) {
                .update, .add => {
                    const filler = @import("../cli.zig").HelpCommand.packages_to_add_filler;

                    examples_to_print[0] = filler[@intCast(usize, (off) % filler.len)];
                    examples_to_print[1] = filler[@intCast(usize, (off + 1) % filler.len)];
                    examples_to_print[2] = filler[@intCast(usize, (off + 2) % filler.len)];

                    Output.prettyErrorln(
                        \\
                        \\<r><b>Usage:<r>
                        \\
                        \\  bun add <r><cyan>package-name@version<r>
                        \\  bun add <r><cyan>package-name<r>
                        \\  bun add <r><cyan>package-name a-second-package<r>
                        \\
                        \\<r><b>Examples:<r>
                        \\
                        \\  bun add -g {s}
                        \\  bun add {s}
                        \\  bun add {s}
                        \\
                    , .{ examples_to_print[0], examples_to_print[1], examples_to_print[2] });

                    if (manager.options.global) {
                        Output.prettyErrorln(
                            \\
                            \\<d>Shorthand: <b>bun a -g<r>
                            \\
                        , .{});
                    } else {
                        Output.prettyErrorln(
                            \\
                            \\<d>Shorthand: <b>bun a<r>
                            \\
                        , .{});
                    }
                    Global.exit(0);
                },
                .remove => {
                    const filler = @import("../cli.zig").HelpCommand.packages_to_remove_filler;

                    examples_to_print[0] = filler[@intCast(usize, (off) % filler.len)];
                    examples_to_print[1] = filler[@intCast(usize, (off + 1) % filler.len)];
                    examples_to_print[2] = filler[@intCast(usize, (off + 2) % filler.len)];

                    Output.prettyErrorln(
                        \\
                        \\<r><b>Usage:<r>
                        \\
                        \\  bun remove <r><red>package-name<r>
                        \\  bun remove <r><red>package-name a-second-package<r>
                        \\
                        \\<r><b>Examples:<r>
                        \\
                        \\  bun remove {s} {s}
                        \\  bun remove {s}
                        \\
                    , .{
                        examples_to_print[0],
                        examples_to_print[1],
                        examples_to_print[2],
                    });
                    if (manager.options.global) {
                        Output.prettyErrorln(
                            \\
                            \\<d>Shorthand: <b>bun rm -g<r>
                            \\
                        , .{});
                    } else {
                        Output.prettyErrorln(
                            \\
                            \\<d>Shorthand: <b>bun rm<r>
                            \\
                        , .{});
                    }

                    Output.flush();

                    Global.exit(0);
                },
                else => {},
            }
        }

        var updates = UpdateRequest.parse(ctx.allocator, ctx.log, manager.options.positionals[1..], &update_requests, op);
        try updatePackageJSONAndInstallWithManagerWithUpdates(
            ctx,
            manager,
            updates,
            false,
            op,
            log_level,
        );
    }

    pub fn updatePackageJSONAndInstallWithManagerWithUpdates(
        ctx: Command.Context,
        manager: *PackageManager,
        updates: []UpdateRequest,
        auto_free: bool,
        comptime op: Lockfile.Package.Diff.Op,
        comptime log_level: Options.LogLevel,
    ) !void {
        if (ctx.log.errors > 0) {
            if (comptime log_level != .silent) {
                if (Output.enable_ansi_colors) {
                    ctx.log.printForLogLevelWithEnableAnsiColors(Output.errorWriter(), true) catch {};
                } else {
                    ctx.log.printForLogLevelWithEnableAnsiColors(Output.errorWriter(), false) catch {};
                }
            }

            Global.crash();
        }

        var current_package_json_stat = try manager.root_package_json_file.stat();
        var current_package_json_buf = try ctx.allocator.alloc(u8, current_package_json_stat.size + 64);
        const current_package_json_contents_len = try manager.root_package_json_file.preadAll(
            current_package_json_buf,
            0,
        );

        const package_json_source = logger.Source.initPathString(
            package_json_cwd_buf[0 .. FileSystem.instance.top_level_dir.len + "package.json".len],
            current_package_json_buf[0..current_package_json_contents_len],
        );

        // If there originally was a newline at the end of their package.json, preserve it
        // so that we don't cause unnecessary diffs in their git history.
        // https://github.com/oven-sh/bun/issues/1375
        const preserve_trailing_newline_at_eof_for_package_json = current_package_json_contents_len > 0 and
            current_package_json_buf[current_package_json_contents_len - 1] == '\n';

        initializeStore();
        var current_package_json = json_parser.ParseJSONUTF8(&package_json_source, ctx.log, manager.allocator) catch |err| {
            if (Output.enable_ansi_colors) {
                ctx.log.printForLogLevelWithEnableAnsiColors(Output.errorWriter(), true) catch {};
            } else {
                ctx.log.printForLogLevelWithEnableAnsiColors(Output.errorWriter(), false) catch {};
            }

            Output.panic("<r><red>{s}<r> parsing package.json<r>", .{
                @errorName(err),
            });
        };

        if (op == .remove) {
            if (current_package_json.data != .e_object) {
                Output.prettyErrorln("<red>error<r><d>:<r> package.json is not an Object {{}}, so there's nothing to remove!", .{});
                Global.exit(1);
                return;
            } else if (current_package_json.data.e_object.properties.len == 0) {
                Output.prettyErrorln("<red>error<r><d>:<r> package.json is empty {{}}, so there's nothing to remove!", .{});
                Global.exit(1);
                return;
            } else if (current_package_json.asProperty("devDependencies") == null and
                current_package_json.asProperty("dependencies") == null and
                current_package_json.asProperty("optionalDependencies") == null and
                current_package_json.asProperty("peerDependencies") == null)
            {
                Output.prettyErrorln("package.json doesn't have dependencies, there's nothing to remove!", .{});
                Global.exit(0);
                return;
            }
        }

        var any_changes = false;

        var dependency_list: string = "dependencies";
        if (manager.options.update.development) {
            dependency_list = "devDependencies";
        } else if (manager.options.update.optional) {
            dependency_list = "optionalDependencies";
        }

        switch (op) {
            .remove => {
                // if we're removing, they don't have to specify where it is installed in the dependencies list
                // they can even put it multiple times and we will just remove all of them
                for (updates) |update| {
                    inline for (dependency_lists_to_check) |list| {
                        if (current_package_json.asProperty(list)) |query| {
                            if (query.expr.data == .e_object) {
                                var dependencies = query.expr.data.e_object.properties.slice();
                                var i: usize = 0;
                                var new_len = dependencies.len;
                                while (i < dependencies.len) : (i += 1) {
                                    if (dependencies[i].key.?.data == .e_string) {
                                        if (dependencies[i].key.?.data.e_string.eql(string, update.name)) {
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
                                    query.expr.data.e_object.properties.len = @truncate(u32, new_len);

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

                if (!any_changes) {
                    Output.prettyErrorln("\n<red>error<r><d>:<r> \"<b>{s}<r>\" is not in a package.json file", .{updates[0].name});
                    Global.exit(1);
                    return;
                }
                manager.to_remove = updates;
            },
            .link, .add, .update => {
                try PackageJSONEditor.edit(ctx.allocator, updates, &current_package_json, dependency_list);
                manager.package_json_updates = updates;
            },
            else => {},
        }

        var buffer_writer = try JSPrinter.BufferWriter.init(ctx.allocator);
        try buffer_writer.buffer.list.ensureTotalCapacity(ctx.allocator, current_package_json_buf.len + 1);
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
        var old_ast_nodes = JSAst.Expr.Data.Store.toOwnedSlice();
        // haha unless
        defer if (auto_free) bun.default_allocator.free(old_ast_nodes);

        try installWithManager(ctx, manager, new_package_json_source, log_level);

        if (op == .update or op == .add or op == .link) {
            for (manager.package_json_updates) |update| {
                if (update.failed) {
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

            try PackageJSONEditor.edit(ctx.allocator, updates, &current_package_json, dependency_list);
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
                var cwd = std.fs.cwd();
                // This is not exactly correct
                var node_modules_buf: [bun.MAX_PATH_BYTES]u8 = undefined;
                std.mem.copy(u8, &node_modules_buf, "node_modules" ++ std.fs.path.sep_str);
                var offset_buf: []u8 = node_modules_buf["node_modules/".len..];
                const name_hashes = manager.lockfile.packages.items(.name_hash);
                for (updates) |update| {
                    // If the package no longer exists in the updated lockfile, delete the directory
                    // This is not thorough.
                    // It does not handle nested dependencies
                    // This is a quick & dirty cleanup intended for when deleting top-level dependencies
                    if (std.mem.indexOfScalar(PackageNameHash, name_hashes, String.Builder.stringHash(update.name)) == null) {
                        std.mem.copy(u8, offset_buf, update.name);
                        cwd.deleteTree(node_modules_buf[0 .. "node_modules/".len + update.name.len]) catch {};
                    }
                }

                // This is where we clean dangling symlinks
                // This could be slow if there are a lot of symlinks
                if (cwd.openDirZ(manager.options.bin_path, .{
                    .iterate = true,
                })) |node_modules_bin_| {
                    var node_modules_bin: std.fs.Dir = node_modules_bin_;
                    var iter: std.fs.Dir.Iterator = node_modules_bin.iterate();
                    iterator: while (iter.next() catch null) |entry| {
                        switch (entry.kind) {
                            std.fs.Dir.Entry.Kind.SymLink => {

                                // any symlinks which we are unable to open are assumed to be dangling
                                // note that using access won't work here, because access doesn't resolve symlinks
                                std.mem.copy(u8, &node_modules_buf, entry.name);
                                node_modules_buf[entry.name.len] = 0;
                                var buf: [:0]u8 = node_modules_buf[0..entry.name.len :0];

                                var file = node_modules_bin.openFileZ(buf, .{ .mode = .read_only }) catch {
                                    node_modules_bin.deleteFileZ(buf) catch {};
                                    continue :iterator;
                                };

                                file.close();
                            },
                            else => {},
                        }
                    }
                } else |_| {}
            }
        }
    }

    var cwd_buf: [bun.MAX_PATH_BYTES]u8 = undefined;
    var package_json_cwd_buf: [bun.MAX_PATH_BYTES]u8 = undefined;

    pub inline fn install(
        ctx: Command.Context,
    ) !void {
        var manager = PackageManager.initMaybeInstall(ctx, null, &install_params, true) catch |err| {
            if (err == error.SwitchToBunAdd) {
                return add(ctx);
            }

            return err;
        };

        if (manager.options.log_level != .silent) {
            Output.prettyErrorln("<r><b>bun install <r><d>v" ++ Global.package_json_version ++ "<r>\n", .{});
            Output.flush();
        }

        var package_json_contents = manager.root_package_json_file.readToEndAlloc(ctx.allocator, std.math.maxInt(usize)) catch |err| {
            if (manager.options.log_level != .silent) {
                Output.prettyErrorln("<r><red>{s} reading package.json<r> :(", .{@errorName(err)});
                Output.flush();
            }
            return;
        };

        try switch (manager.options.log_level) {
            .default => installWithManager(ctx, manager, package_json_contents, .default),
            .verbose => installWithManager(ctx, manager, package_json_contents, .verbose),
            .silent => installWithManager(ctx, manager, package_json_contents, .silent),
            .default_no_progress => installWithManager(ctx, manager, package_json_contents, .default_no_progress),
            .verbose_no_progress => installWithManager(ctx, manager, package_json_contents, .verbose_no_progress),
        };
    }

    pub const PackageInstaller = struct {
        manager: *PackageManager,
        lockfile: *Lockfile,
        progress: *std.Progress,
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
        has_created_bin: bool = false,
        global_bin_dir: std.fs.Dir,
        destination_dir_subpath_buf: [bun.MAX_PATH_BYTES]u8 = undefined,
        folder_path_buf: [bun.MAX_PATH_BYTES]u8 = undefined,
        install_count: usize = 0,
        successfully_installed: Bitset,

        // For linking native binaries, we only want to link after we've installed the companion dependencies
        // We don't want to introduce dependent callbacks like that for every single package
        // Since this will only be a handful, it's fine to just say "run this at the end"
        platform_binlinks: std.ArrayListUnmanaged(DeferredBinLink) = std.ArrayListUnmanaged(DeferredBinLink){},

        pub const DeferredBinLink = struct {
            package_id: PackageID,
            node_modules_folder: std.fs.Dir,
        };

        /// Install versions of a package which are waiting on a network request
        pub fn installEnqueuedPackages(
            this: *PackageInstaller,
            package_id: PackageID,
            comptime log_level: Options.LogLevel,
        ) void {
            const buf = this.lockfile.buffers.string_bytes.items;

            const name = this.names[package_id].slice(buf);
            const resolution = this.resolutions[package_id];

            if (this.manager.task_queue.fetchRemove(Task.Id.forNPMPackage(
                Task.Tag.extract,
                name,
                resolution.value.npm.version,
            ))) |removed| {
                var callbacks = removed.value;
                defer callbacks.deinit(this.manager.allocator);

                const prev_node_modules_folder = this.node_modules_folder;
                defer this.node_modules_folder = prev_node_modules_folder;
                for (callbacks.items) |cb| {
                    const node_modules_folder = cb.node_modules_folder;
                    this.node_modules_folder = std.fs.Dir{ .fd = @intCast(std.os.fd_t, node_modules_folder) };
                    this.installPackageWithNameAndResolution(package_id, log_level, name, resolution);
                }
            }
        }

        fn installPackageWithNameAndResolution(
            this: *PackageInstaller,
            package_id: PackageID,
            comptime log_level: Options.LogLevel,
            name: string,
            resolution: Resolution,
        ) void {
            std.mem.copy(u8, &this.destination_dir_subpath_buf, name);
            this.destination_dir_subpath_buf[name.len] = 0;
            var destination_dir_subpath: [:0]u8 = this.destination_dir_subpath_buf[0..name.len :0];
            var resolution_buf: [512]u8 = undefined;
            const buf = this.lockfile.buffers.string_bytes.items;
            const extern_string_buf = this.lockfile.buffers.extern_strings.items;
            var resolution_label = std.fmt.bufPrint(&resolution_buf, "{}", .{resolution.fmt(buf)}) catch unreachable;
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
            };

            switch (resolution.tag) {
                .npm => {
                    installer.cache_dir_subpath = this.manager.cachedNPMPackageFolderName(name, resolution.value.npm.version);
                    installer.cache_dir = this.manager.getCacheDirectory();
                },
                .folder => {
                    const folder = resolution.value.folder.slice(buf);
                    // Handle when a package depends on itself via file:
                    // example:
                    //   "mineflayer": "file:."
                    if (folder.len == 0 or (folder.len == 1 and folder[0] == '.')) {
                        installer.cache_dir_subpath = ".";
                        installer.cache_dir = std.fs.cwd();
                    } else {
                        @memcpy(&this.folder_path_buf, folder.ptr, folder.len);
                        this.folder_path_buf[folder.len] = 0;
                        installer.cache_dir_subpath = std.meta.assumeSentinel(this.folder_path_buf[0..folder.len], 0);
                        installer.cache_dir = std.fs.cwd();
                    }
                },
                .symlink => {
                    const directory = this.manager.globalLinkDir() catch |err| {
                        if (comptime log_level != .silent) {
                            const fmt = "\n<r><red>error:<r> unable to access global directory while installing <b>{s}<r>: {s}\n";
                            const args = .{ name, @errorName(err) };

                            if (comptime log_level.showProgress()) {
                                if (Output.enable_ansi_colors) {
                                    this.progress.log(comptime Output.prettyFmt(fmt, true), args);
                                } else {
                                    this.progress.log(comptime Output.prettyFmt(fmt, false), args);
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
                        @memcpy(ptr, global_link_dir.ptr, global_link_dir.len);
                        remain = remain[global_link_dir.len..];
                        if (global_link_dir[global_link_dir.len - 1] != std.fs.path.sep) {
                            remain[0] = std.fs.path.sep;
                            remain = remain[1..];
                        }
                        @memcpy(remain.ptr, folder.ptr, folder.len);
                        remain = remain[folder.len..];
                        remain[0] = 0;
                        const len = @ptrToInt(remain.ptr) - @ptrToInt(ptr);
                        installer.cache_dir_subpath = std.meta.assumeSentinel(
                            this.folder_path_buf[0..len :0],
                            0,
                        );
                        installer.cache_dir = directory;
                    }
                },
                else => return,
            }

            const needs_install = this.force_install or this.skip_verify_installed_version_number or !installer.verify();
            this.summary.skipped += @as(u32, @boolToInt(!needs_install));

            if (needs_install) {
                const result: PackageInstall.Result = switch (resolution.tag) {
                    .symlink => installer.installFromLink(this.skip_delete),
                    else => installer.install(this.skip_delete),
                };
                switch (result) {
                    .success => {
                        const is_duplicate = this.successfully_installed.isSet(package_id);
                        this.summary.success += @as(u32, @boolToInt(!is_duplicate));
                        this.successfully_installed.set(package_id);

                        if (comptime log_level.showProgress()) {
                            this.node.completeOne();
                        }

                        const bin = this.bins[package_id];
                        if (bin.tag != .none) {
                            if (!this.has_created_bin) {
                                Bin.Linker.umask = C.umask(0);
                                if (!this.options.global)
                                    this.node_modules_folder.makeDirZ(".bin") catch {};

                                this.has_created_bin = true;
                            }

                            const bin_task_id = Task.Id.forBinLink(package_id);
                            var task_queue = this.manager.task_queue.getOrPut(this.manager.allocator, bin_task_id) catch unreachable;
                            if (!task_queue.found_existing) {
                                run_bin_link: {
                                    if (std.mem.indexOfScalar(PackageNameHash, this.options.native_bin_link_allowlist, String.Builder.stringHash(name)) != null) {
                                        this.platform_binlinks.append(this.lockfile.allocator, .{
                                            .package_id = package_id,
                                            .node_modules_folder = this.node_modules_folder,
                                        }) catch unreachable;
                                        break :run_bin_link;
                                    }

                                    var bin_linker = Bin.Linker{
                                        .bin = bin,
                                        .package_installed_node_modules = this.node_modules_folder.fd,
                                        .global_bin_path = this.options.bin_path,
                                        .global_bin_dir = this.options.global_bin_dir,

                                        // .destination_dir_subpath = destination_dir_subpath,
                                        .root_node_modules_folder = this.root_node_modules_folder.fd,
                                        .package_name = strings.StringOrTinyString.init(name),
                                        .string_buf = buf,
                                        .extern_string_buf = extern_string_buf,
                                    };

                                    bin_linker.link(this.manager.options.global);
                                    if (bin_linker.err) |err| {
                                        if (comptime log_level != .silent) {
                                            const fmt = "\n<r><red>error:<r> linking <b>{s}<r>: {s}\n";
                                            const args = .{ name, @errorName(err) };

                                            if (comptime log_level.showProgress()) {
                                                if (Output.enable_ansi_colors) {
                                                    this.progress.log(comptime Output.prettyFmt(fmt, true), args);
                                                } else {
                                                    this.progress.log(comptime Output.prettyFmt(fmt, false), args);
                                                }
                                            } else {
                                                Output.prettyErrorln(fmt, args);
                                            }
                                        }

                                        if (this.manager.options.enable.fail_early) {
                                            installer.uninstall() catch {};
                                            Global.exit(1);
                                        }
                                    }
                                }
                            }
                        }
                    },
                    .fail => |cause| {
                        if (cause.isPackageMissingFromCache()) {
                            switch (resolution.tag) {
                                .npm => {
                                    std.debug.assert(resolution.value.npm.url.len() > 0);

                                    const task_id = Task.Id.forNPMPackage(Task.Tag.extract, name, resolution.value.npm.version);
                                    var task_queue = this.manager.task_queue.getOrPut(this.manager.allocator, task_id) catch unreachable;
                                    if (!task_queue.found_existing) {
                                        task_queue.value_ptr.* = .{};
                                    }

                                    task_queue.value_ptr.append(
                                        this.manager.allocator,
                                        .{
                                            .node_modules_folder = @intCast(u32, this.node_modules_folder.fd),
                                        },
                                    ) catch unreachable;

                                    if (!task_queue.found_existing) {
                                        if (this.manager.generateNetworkTaskForTarball(task_id, resolution.value.npm.url.slice(buf), this.lockfile.packages.get(package_id)) catch unreachable) |task| {
                                            task.schedule(&this.manager.network_tarball_batch);
                                            if (this.manager.network_tarball_batch.len > 0) {
                                                _ = this.manager.scheduleNetworkTasks();
                                            }
                                        }
                                    }
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
            }
        }

        pub fn installPackage(
            this: *PackageInstaller,
            package_id: PackageID,
            comptime log_level: Options.LogLevel,
        ) void {
            // const package_id = ctx.package_id;
            // const tree = ctx.trees[ctx.tree_id];
            const meta = &this.metas[package_id];

            if (meta.isDisabled()) {
                if (comptime log_level.showProgress()) {
                    this.node.completeOne();
                }
                return;
            }

            const buf = this.lockfile.buffers.string_bytes.items;
            const name = this.names[package_id].slice(buf);
            const resolution = this.resolutions[package_id];

            this.installPackageWithNameAndResolution(package_id, log_level, name, resolution);
        }
    };

    pub fn installPackages(
        this: *PackageManager,
        lockfile_: *Lockfile,
        comptime log_level: PackageManager.Options.LogLevel,
    ) !PackageInstall.Summary {
        var lockfile = lockfile_;
        if (!this.options.local_package_features.dev_dependencies) {
            lockfile = try lockfile.maybeCloneFilteringRootPackages(this.options.local_package_features);
        }

        var root_node: *Progress.Node = undefined;
        var download_node: Progress.Node = undefined;
        var install_node: Progress.Node = undefined;
        const options = &this.options;
        var progress = &this.progress;

        if (comptime log_level.showProgress()) {
            root_node = progress.start("", 0);
            progress.supports_ansi_escape_codes = Output.enable_ansi_colors_stderr;
            download_node = root_node.start(ProgressStrings.download(), 0);

            install_node = root_node.start(ProgressStrings.install(), lockfile.packages.len);
            this.downloads_node = &download_node;
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
        var node_modules_folder = std.fs.cwd().openDirZ("node_modules", .{ .iterate = true }) catch brk: {
            skip_verify_installed_version_number = true;
            std.fs.cwd().makeDirZ("node_modules") catch |err| {
                Output.prettyErrorln("<r><red>error<r>: <b><red>{s}<r> creating <b>node_modules<r> folder", .{@errorName(err)});
                Global.crash();
            };
            break :brk std.fs.cwd().openDirZ("node_modules", .{ .iterate = true }) catch |err| {
                Output.prettyErrorln("<r><red>error<r>: <b><red>{s}<r> opening <b>node_modules<r> folder", .{@errorName(err)});
                Global.crash();
            };
        };
        var skip_delete = skip_verify_installed_version_number;

        const force_install = options.enable.force_install;
        if (options.enable.force_install) {
            skip_verify_installed_version_number = true;
            skip_delete = false;
        }
        var summary = PackageInstall.Summary{};

        {
            var parts = lockfile.packages.slice();
            var metas = parts.items(.meta);
            var names = parts.items(.name);
            var dependency_lists: []const Lockfile.DependencySlice = parts.items(.dependencies);
            var dependencies = lockfile.buffers.dependencies.items;
            const resolutions_buffer: []const PackageID = lockfile.buffers.resolutions.items;
            const resolution_lists: []const Lockfile.PackageIDSlice = parts.items(.resolutions);
            var resolutions = parts.items(.resolution);

            var iterator = Lockfile.Tree.Iterator.init(
                lockfile.buffers.trees.items,
                lockfile.buffers.hoisted_packages.items,
                names,
                lockfile.buffers.string_bytes.items,
            );

            var installer = PackageInstaller{
                .manager = this,
                .options = &this.options,
                .metas = metas,
                .bins = parts.items(.bin),
                .root_node_modules_folder = node_modules_folder,
                .names = names,
                .resolutions = resolutions,
                .lockfile = lockfile,
                .node = &install_node,
                .node_modules_folder = node_modules_folder,
                .progress = progress,
                .skip_verify_installed_version_number = skip_verify_installed_version_number,
                .skip_delete = skip_delete,
                .summary = &summary,
                .global_bin_dir = this.options.global_bin_dir,
                .force_install = force_install,
                .install_count = lockfile.buffers.hoisted_packages.items.len,
                .successfully_installed = try Bitset.initEmpty(lockfile.packages.len, this.allocator),
            };

            const cwd = std.fs.cwd();

            while (iterator.nextNodeModulesFolder()) |node_modules| {
                try cwd.makePath(std.mem.span(node_modules.relative_path));
                // We deliberately do not close this folder.
                // If the package hasn't been downloaded, we will need to install it later
                // We use this file descriptor to know where to put it.
                var folder = try cwd.openDirZ(node_modules.relative_path, .{
                    .iterate = true,
                });

                installer.node_modules_folder = folder;

                var remaining = node_modules.packages;

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
                            PackageInstaller.installEnqueuedPackages,
                            log_level,
                        );
                        if (!installer.options.do.install_packages) return error.InstallFailed;
                    }
                }

                for (remaining) |package_id| {
                    installer.installPackage(@truncate(PackageID, package_id), log_level);
                }

                try this.runTasks(
                    *PackageInstaller,
                    &installer,
                    PackageInstaller.installEnqueuedPackages,
                    log_level,
                );
                if (!installer.options.do.install_packages) return error.InstallFailed;
            }

            while (this.pending_tasks > 0 and installer.options.do.install_packages) : (this.sleep()) {
                try this.runTasks(
                    *PackageInstaller,
                    &installer,
                    PackageInstaller.installEnqueuedPackages,
                    log_level,
                );
            }

            if (!installer.options.do.install_packages) return error.InstallFailed;

            summary.successfully_installed = installer.successfully_installed;
            outer: for (installer.platform_binlinks.items) |deferred| {
                const package_id = deferred.package_id;
                const folder = deferred.node_modules_folder;

                const package_dependencies: []const Dependency = dependency_lists[package_id].get(dependencies);
                const package_resolutions: []const PackageID = resolution_lists[package_id].get(resolutions_buffer);
                const original_bin: Bin = installer.bins[package_id];

                for (package_dependencies) |_, i| {
                    const resolved_id = package_resolutions[i];
                    if (resolved_id >= names.len) continue;
                    const meta: Lockfile.Package.Meta = metas[resolved_id];

                    // This is specifically for platform-specific binaries
                    if (meta.os == .all and meta.arch == .all) continue;

                    // Don't attempt to link incompatible binaries
                    if (meta.isDisabled()) continue;

                    const name: string = installer.names[resolved_id].slice(lockfile.buffers.string_bytes.items);

                    if (!installer.has_created_bin) {
                        if (!this.options.global) {
                            node_modules_folder.makeDirZ(".bin") catch {};
                        }
                        Bin.Linker.umask = C.umask(0);
                        installer.has_created_bin = true;
                    }

                    var bin_linker = Bin.Linker{
                        .bin = original_bin,
                        .package_installed_node_modules = folder.fd,
                        .root_node_modules_folder = node_modules_folder.fd,
                        .global_bin_path = this.options.bin_path,
                        .global_bin_dir = this.options.global_bin_dir,

                        .package_name = strings.StringOrTinyString.init(name),
                        .string_buf = lockfile.buffers.string_bytes.items,
                        .extern_string_buf = lockfile.buffers.extern_strings.items,
                    };

                    bin_linker.link(this.options.global);

                    if (bin_linker.err) |err| {
                        if (comptime log_level != .silent) {
                            const fmt = "\n<r><red>error:<r> linking <b>{s}<r>: {s}\n";
                            const args = .{ name, @errorName(err) };

                            if (comptime log_level.showProgress()) {
                                if (Output.enable_ansi_colors) {
                                    this.progress.log(comptime Output.prettyFmt(fmt, true), args);
                                } else {
                                    this.progress.log(comptime Output.prettyFmt(fmt, false), args);
                                }
                            } else {
                                Output.prettyErrorln(fmt, args);
                            }
                        }

                        if (this.options.enable.fail_early) {
                            Global.exit(1);
                        }
                    }

                    continue :outer;
                }

                if (comptime log_level != .silent) {
                    const fmt = "\n<r><yellow>warn:<r> no compatible binaries found for <b>{s}<r>\n";
                    const args = .{names[package_id].slice(lockfile.buffers.string_bytes.items)};

                    if (comptime log_level.showProgress()) {
                        if (Output.enable_ansi_colors) {
                            this.progress.log(comptime Output.prettyFmt(fmt, true), args);
                        } else {
                            this.progress.log(comptime Output.prettyFmt(fmt, false), args);
                        }
                    } else {
                        Output.prettyErrorln(fmt, args);
                    }
                }
            }
        }

        return summary;
    }

    pub fn setupGlobalDir(manager: *PackageManager, ctx: *const Command.Context) !void {
        manager.options.global_bin_dir = try Options.openGlobalBinDir(ctx.install);
        var out_buffer: [bun.MAX_PATH_BYTES]u8 = undefined;
        var result = try std.os.getFdPath(manager.options.global_bin_dir.fd, &out_buffer);
        out_buffer[result.len] = 0;
        var result_: [:0]u8 = out_buffer[0..result.len :0];
        manager.options.bin_path = std.meta.assumeSentinel(try FileSystem.instance.dirname_store.append([:0]u8, result_), 0);
    }

    fn installWithManager(
        ctx: Command.Context,
        manager: *PackageManager,
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
            Lockfile.LoadFromDiskResult{ .not_found = .{} };

        var root = Lockfile.Package{};
        var maybe_root: Lockfile.Package = undefined;

        var needs_new_lockfile = load_lockfile_result != .ok or (load_lockfile_result.ok.buffers.dependencies.items.len == 0 and manager.package_json_updates.len > 0);

        // this defaults to false
        // but we force allowing updates to the lockfile when you do bun add
        var had_any_diffs = false;
        manager.progress = .{};

        // Step 2. Parse the package.json file
        //
        var package_json_source = logger.Source.initPathString(
            package_json_cwd_buf[0 .. FileSystem.instance.top_level_dir.len + "package.json".len],
            package_json_contents,
        );

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
                    }

                    if (manager.options.enable.fail_early) {
                        Output.prettyError("<b><red>failed to load lockfile<r>\n", .{});
                    } else {
                        Output.prettyError("<b><red>ignoring lockfile<r>\n", .{});
                    }

                    if (ctx.log.errors > 0) {
                        if (Output.enable_ansi_colors) {
                            try manager.log.printForLogLevelWithEnableAnsiColors(Output.errorWriter(), true);
                        } else {
                            try manager.log.printForLogLevelWithEnableAnsiColors(Output.errorWriter(), false);
                        }
                    }
                    Output.flush();
                }

                if (manager.options.enable.fail_early) Global.exit(1);
            },
            .ok => {
                differ: {
                    root = load_lockfile_result.ok.rootPackage() orelse {
                        needs_new_lockfile = true;
                        break :differ;
                    };

                    if (root.dependencies.len == 0) {
                        needs_new_lockfile = true;
                    }

                    if (needs_new_lockfile) break :differ;

                    var lockfile: Lockfile = undefined;
                    try lockfile.initEmpty(ctx.allocator);
                    maybe_root = Lockfile.Package{};

                    try Lockfile.Package.parseMain(
                        &lockfile,
                        &maybe_root,
                        ctx.allocator,
                        ctx.log,
                        package_json_source,
                        Features{
                            .optional_dependencies = true,
                            .dev_dependencies = true,
                            .is_main = true,
                            .check_for_duplicate_dependencies = true,
                            .peer_dependencies = false,
                            .scripts = true,
                        },
                    );
                    manager.lockfile.scripts = lockfile.scripts;
                    var mapping = try manager.lockfile.allocator.alloc(PackageID, maybe_root.dependencies.len);
                    std.mem.set(PackageID, mapping, invalid_package_id);

                    manager.summary = try Package.Diff.generate(
                        ctx.allocator,
                        manager.lockfile,
                        &lockfile,
                        &root,
                        &maybe_root,
                        mapping,
                    );

                    const sum = manager.summary.add + manager.summary.remove + manager.summary.update;
                    had_any_diffs = had_any_diffs or sum > 0;

                    if (manager.options.enable.frozen_lockfile and had_any_diffs) {
                        if (log_level != .silent) {
                            Output.prettyErrorln("<r><red>error<r>: lockfile had changes, but lockfile is frozen", .{});
                        }

                        Global.exit(1);
                    }

                    // If you changed packages, we will copy over the new package from the new lockfile
                    const new_dependencies = maybe_root.dependencies.get(lockfile.buffers.dependencies.items);

                    if (had_any_diffs) {
                        var builder_ = manager.lockfile.stringBuilder();
                        // ensure we use one pointer to reference it instead of creating new ones and potentially aliasing
                        var builder = &builder_;

                        for (new_dependencies) |new_dep| {
                            new_dep.count(lockfile.buffers.string_bytes.items, *Lockfile.StringBuilder, builder);
                        }

                        const off = @truncate(u32, manager.lockfile.buffers.dependencies.items.len);
                        const len = @truncate(u32, new_dependencies.len);
                        var packages = manager.lockfile.packages.slice();
                        var dep_lists = packages.items(.dependencies);
                        var resolution_lists = packages.items(.resolutions);
                        const old_resolutions_list = resolution_lists[0];
                        dep_lists[0] = .{ .off = off, .len = len };
                        resolution_lists[0] = .{ .off = off, .len = len };
                        manager.root_dependency_list = dep_lists[0];
                        try builder.allocate();

                        try manager.lockfile.buffers.dependencies.ensureUnusedCapacity(manager.lockfile.allocator, len);
                        try manager.lockfile.buffers.resolutions.ensureUnusedCapacity(manager.lockfile.allocator, len);

                        var old_resolutions = old_resolutions_list.get(manager.lockfile.buffers.resolutions.items);

                        var dependencies = manager.lockfile.buffers.dependencies.items.ptr[off .. off + len];
                        var resolutions = manager.lockfile.buffers.resolutions.items.ptr[off .. off + len];

                        // It is too easy to accidentally undefined memory
                        std.mem.set(PackageID, resolutions, invalid_package_id);
                        std.mem.set(Dependency, dependencies, Dependency{});

                        manager.lockfile.buffers.dependencies.items = manager.lockfile.buffers.dependencies.items.ptr[0 .. off + len];
                        manager.lockfile.buffers.resolutions.items = manager.lockfile.buffers.resolutions.items.ptr[0 .. off + len];

                        for (new_dependencies) |new_dep, i| {
                            dependencies[i] = try new_dep.clone(lockfile.buffers.string_bytes.items, *Lockfile.StringBuilder, builder);
                            if (mapping[i] != invalid_package_id) {
                                resolutions[i] = old_resolutions[mapping[i]];
                            }
                        }

                        builder.clamp();

                        // Split this into two passes because the below may allocate memory or invalidate pointers
                        if (manager.summary.add > 0 or manager.summary.update > 0) {
                            var remaining = mapping;
                            var dependency_i: PackageID = off;
                            const changes = @truncate(PackageID, mapping.len);

                            _ = manager.getCacheDirectory();
                            _ = manager.getTemporaryDirectory();
                            var counter_i: PackageID = 0;
                            while (counter_i < changes) : (counter_i += 1) {
                                if (remaining[counter_i] == invalid_package_id) {
                                    dependency_i = counter_i + off;
                                    try manager.enqueueDependencyWithMain(
                                        dependency_i,
                                        manager.lockfile.buffers.dependencies.items[dependency_i],
                                        manager.lockfile.buffers.resolutions.items[dependency_i],
                                        true,
                                    );
                                }
                            }
                        }
                    }
                }
            },
            else => {},
        }

        if (needs_new_lockfile) {
            root = Lockfile.Package{};
            try manager.lockfile.initEmpty(ctx.allocator);

            if (manager.options.enable.frozen_lockfile) {
                if (log_level != .silent) {
                    Output.prettyErrorln("<r><red>error<r>: lockfile had changes, but lockfile is frozen", .{});
                }

                Global.exit(1);
            }

            try Lockfile.Package.parseMain(
                manager.lockfile,
                &root,
                ctx.allocator,
                ctx.log,
                package_json_source,
                Features{
                    .optional_dependencies = true,
                    .dev_dependencies = true,
                    .is_main = true,
                    .check_for_duplicate_dependencies = true,
                    .peer_dependencies = false,
                    .scripts = true,
                },
            );

            root = try manager.lockfile.appendPackage(root);

            manager.root_dependency_list = root.dependencies;

            if (root.dependencies.len > 0) {
                _ = manager.getCacheDirectory();
                _ = manager.getTemporaryDirectory();
            }
            manager.enqueueDependencyList(
                root.dependencies,
                true,
            );
        }

        manager.flushDependencyQueue();

        // Anything that needs to be downloaded from an update needs to be scheduled here
        _ = manager.scheduleNetworkTasks();

        if (manager.pending_tasks > 0) {
            if (root.dependencies.len > 0) {
                _ = manager.getCacheDirectory();
                _ = manager.getTemporaryDirectory();
            }

            if (comptime log_level.showProgress()) {
                manager.downloads_node = manager.progress.start(ProgressStrings.download(), 0);
                manager.progress.supports_ansi_escape_codes = Output.enable_ansi_colors_stderr;
                manager.setNodeName(manager.downloads_node.?, ProgressStrings.download_no_emoji_, ProgressStrings.download_emoji, true);
                manager.downloads_node.?.setEstimatedTotalItems(manager.total_tasks + manager.extracted_count);
                manager.downloads_node.?.setCompletedItems(manager.total_tasks - manager.pending_tasks);
                manager.downloads_node.?.activate();
                manager.progress.refresh();
            } else if (comptime log_level != .silent) {
                Output.prettyErrorln(" Resolving dependencies", .{});
                Output.flush();
            }

            {
                while (manager.pending_tasks > 0) : (manager.sleep()) {
                    try manager.runTasks(void, void{}, null, log_level);
                }
            }

            if (comptime log_level.showProgress()) {
                manager.downloads_node.?.setEstimatedTotalItems(manager.downloads_node.?.unprotected_estimated_total_items);
                manager.downloads_node.?.setCompletedItems(manager.downloads_node.?.unprotected_estimated_total_items);
                manager.progress.refresh();
                manager.progress.root.end();
                manager.progress = .{};
                manager.downloads_node = null;
            } else if (comptime log_level != .silent) {
                Output.prettyErrorln(" Resolved, downloaded and extracted [{d}]", .{manager.total_tasks});
                Output.flush();
            }
        }

        if (Output.enable_ansi_colors) {
            try manager.log.printForLogLevelWithEnableAnsiColors(Output.errorWriter(), true);
        } else {
            try manager.log.printForLogLevelWithEnableAnsiColors(Output.errorWriter(), false);
        }

        if (manager.log.errors > 0) {
            Global.exit(1);
        }

        const needs_clean_lockfile = had_any_diffs or needs_new_lockfile or manager.package_json_updates.len > 0;
        var did_meta_hash_change = needs_clean_lockfile;
        if (needs_clean_lockfile) {
            manager.lockfile = try manager.lockfile.clean(manager.package_json_updates);
        }

        if (manager.lockfile.packages.len > 0) {
            for (manager.package_json_updates) |update| {
                // prevent redundant errors
                if (update.failed) {
                    return error.InstallFailed;
                }
            }
            manager.root_dependency_list = manager.lockfile.packages.items(.dependencies)[0];
            manager.lockfile.verifyResolutions(manager.options.local_package_features, manager.options.remote_package_features, log_level);
        }

        if (needs_clean_lockfile or manager.options.enable.force_save_lockfile) {
            did_meta_hash_change = try manager.lockfile.hasMetaHashChanged(
                PackageManager.verbose_install or manager.options.do.print_meta_hash_string,
            );
        }

        if (manager.options.global) {
            try manager.setupGlobalDir(&ctx);
        }

        // We don't always save the lockfile.
        // This is for two reasons.
        // 1. It's unnecessary work if there are no changes
        // 2. There is a determinism issue in the file where alignment bytes might be garbage data
        //    This is a bug that needs to be fixed, however we can work around it for now
        //    by avoiding saving the lockfile
        if (manager.options.do.save_lockfile and (did_meta_hash_change or
            manager.lockfile.isEmpty() or
            manager.options.enable.force_save_lockfile))
        {
            save: {
                if (manager.lockfile.isEmpty()) {
                    if (!manager.options.dry_run) {
                        std.fs.cwd().deleteFileZ(manager.options.save_lockfile_path) catch |err| brk: {
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
                        if (log_level != .silent) Output.prettyErrorln("No packages! Deleted empty lockfile", .{});
                    }

                    break :save;
                }

                var node: *Progress.Node = undefined;

                if (comptime log_level.showProgress()) {
                    node = manager.progress.start(ProgressStrings.save(), 0);
                    manager.progress.supports_ansi_escape_codes = Output.enable_ansi_colors_stderr;
                    node.activate();

                    manager.progress.refresh();
                }

                manager.lockfile.saveToDisk(manager.options.save_lockfile_path);
                if (comptime log_level.showProgress()) {
                    node.end();
                    manager.progress.refresh();
                    manager.progress.root.end();
                    manager.progress = .{};
                } else if (comptime log_level != .silent) {
                    Output.prettyErrorln(" Saved lockfile", .{});
                    Output.flush();
                }
            }
        }

        // Install script order for npm 8.3.0:
        // 1. preinstall
        // 2. install
        // 3. postinstall
        // 4. preprepare
        // 5. prepare
        // 6. postprepare

        const run_lifecycle_scripts = manager.options.do.run_scripts and manager.lockfile.scripts.hasAny() and manager.options.do.install_packages;
        const has_pre_lifecycle_scripts = manager.lockfile.scripts.preinstall.items.len > 0;
        const needs_configure_bundler_for_run = run_lifecycle_scripts and !has_pre_lifecycle_scripts;

        if (run_lifecycle_scripts and has_pre_lifecycle_scripts) {
            // We need to figure out the PATH and other environment variables
            // to do that, we re-use the code from bun run
            // this is expensive, it traverses the entire directory tree going up to the root
            // so we really only want to do it when strictly necessary
            {
                var this_bundler: bundler.Bundler = undefined;
                var ORIGINAL_PATH: string = "";
                _ = try RunCommand.configureEnvForRun(
                    ctx,
                    &this_bundler,
                    manager.env,
                    &ORIGINAL_PATH,
                    log_level != .silent,
                );
            }

            try manager.lockfile.scripts.run(manager.allocator, manager.env, log_level != .silent, "preinstall");
        }

        var install_summary = PackageInstall.Summary{};
        if (manager.options.do.install_packages) {
            install_summary = try manager.installPackages(
                manager.lockfile,
                log_level,
            );
        }

        if (needs_new_lockfile) {
            manager.summary.add = @truncate(u32, manager.lockfile.packages.len);
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

        if (comptime log_level != .silent) {
            var printer = Lockfile.Printer{
                .lockfile = manager.lockfile,
                .options = manager.options,
                .updates = manager.package_json_updates,
                .successfully_installed = install_summary.successfully_installed,
            };

            if (Output.enable_ansi_colors) {
                try Lockfile.Printer.Tree.print(&printer, Output.WriterType, Output.writer(), true);
            } else {
                try Lockfile.Printer.Tree.print(&printer, Output.WriterType, Output.writer(), false);
            }

            if (!did_meta_hash_change) {
                manager.summary.remove = 0;
                manager.summary.add = 0;
                manager.summary.update = 0;
            }

            var printed_timestamp = false;
            if (install_summary.success > 0) {
                // it's confusing when it shows 3 packages and says it installed 1
                Output.pretty("\n <green>{d}<r> packages<r> installed ", .{@maximum(
                    install_summary.success,
                    @truncate(
                        u32,
                        manager.package_json_updates.len,
                    ),
                )});
                Output.printStartEndStdout(ctx.start_time, std.time.nanoTimestamp());
                printed_timestamp = true;
                Output.pretty("<r>\n", .{});

                if (manager.summary.remove > 0) {
                    Output.pretty("  Removed: <cyan>{d}<r>\n", .{manager.summary.remove});
                }
            } else if (manager.summary.remove > 0) {
                if (manager.to_remove.len > 0) {
                    for (manager.to_remove) |update| {
                        Output.prettyln(" <r><red>-<r> {s}", .{update.name});
                    }
                }

                Output.pretty("\n <r><b>{d}<r> packages removed ", .{manager.summary.remove});
                Output.printStartEndStdout(ctx.start_time, std.time.nanoTimestamp());
                printed_timestamp = true;
                Output.pretty("<r>\n", .{});
            } else if (install_summary.skipped > 0 and install_summary.fail == 0 and manager.package_json_updates.len == 0) {
                Output.pretty("\n", .{});

                const count = @truncate(PackageID, manager.lockfile.packages.len);
                if (count != install_summary.skipped) {
                    Output.pretty("Checked <green>{d} installs<r> across {d} packages <d>(no changes)<r> ", .{
                        install_summary.skipped,
                        count,
                    });
                    Output.printStartEndStdout(ctx.start_time, std.time.nanoTimestamp());
                    printed_timestamp = true;
                    Output.pretty("<r>\n", .{});
                } else {
                    Output.pretty("<r> <green>Done<r>! Checked {d} packages<r> <d>(no changes)<r> ", .{
                        install_summary.skipped,
                    });
                    Output.printStartEndStdout(ctx.start_time, std.time.nanoTimestamp());
                    printed_timestamp = true;
                    Output.pretty("<r>\n", .{});
                }
            }

            if (install_summary.fail > 0) {
                Output.prettyln("<r>Failed to install <red><b>{d}<r> packages\n", .{install_summary.fail});
                Output.flush();
            }

            if (run_lifecycle_scripts and install_summary.fail == 0) {
                // We need to figure out the PATH and other environment variables
                // to do that, we re-use the code from bun run
                // this is expensive, it traverses the entire directory tree going up to the root
                // so we really only want to do it when strictly necessary
                if (needs_configure_bundler_for_run) {
                    var this_bundler: bundler.Bundler = undefined;
                    var ORIGINAL_PATH: string = "";
                    _ = try RunCommand.configureEnvForRun(
                        ctx,
                        &this_bundler,
                        manager.env,
                        &ORIGINAL_PATH,
                        log_level != .silent,
                    );
                } else {
                    // bun install may have installed new bins, so we need to update the PATH
                    // this can happen if node_modules/.bin didn't previously exist
                    // note: it is harmless to have the same directory in the PATH multiple times
                    const current_path = manager.env.map.get("PATH");

                    // TODO: windows
                    const cwd_without_trailing_slash = if (Fs.FileSystem.instance.top_level_dir.len > 1 and Fs.FileSystem.instance.top_level_dir[Fs.FileSystem.instance.top_level_dir.len - 1] == '/')
                        Fs.FileSystem.instance.top_level_dir[0 .. Fs.FileSystem.instance.top_level_dir.len - 1]
                    else
                        Fs.FileSystem.instance.top_level_dir;

                    try manager.env.map.put("PATH", try std.fmt.allocPrint(
                        ctx.allocator,
                        "{s}:{s}/node_modules/.bin",
                        .{
                            current_path,
                            cwd_without_trailing_slash,
                        },
                    ));
                }

                // 1. preinstall
                // 2. install
                // 3. postinstall
                try manager.lockfile.scripts.run(manager.allocator, manager.env, log_level != .silent, "install");
                try manager.lockfile.scripts.run(manager.allocator, manager.env, log_level != .silent, "postinstall");

                // 4. preprepare
                // 5. prepare
                // 6. postprepare
                try manager.lockfile.scripts.run(manager.allocator, manager.env, log_level != .silent, "preprepare");
                try manager.lockfile.scripts.run(manager.allocator, manager.env, log_level != .silent, "prepare");
                try manager.lockfile.scripts.run(manager.allocator, manager.env, log_level != .silent, "postprepare");
            }

            if (!printed_timestamp) {
                Output.printStartEndStdout(ctx.start_time, std.time.nanoTimestamp());
                Output.prettyln("<d> done<r>", .{});
                printed_timestamp = true;
            }
        }
        Output.flush();
    }
};

const Package = Lockfile.Package;

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
    };
    var reqs = PackageManager.UpdateRequest.parse(default_allocator, &log, updates, &array, .add);

    try std.testing.expectEqualStrings(reqs[0].name, "@bacon/name");
    try std.testing.expectEqualStrings(reqs[1].name, "foo");
    try std.testing.expectEqualStrings(reqs[2].name, "bar");
    try std.testing.expectEqualStrings(reqs[3].name, "baz");
    try std.testing.expectEqualStrings(reqs[4].name, "boo");
    try std.testing.expectEqual(reqs[4].version.tag, Dependency.Version.Tag.npm);
    try std.testing.expectEqualStrings(reqs[4].version.literal.slice("boo@1.0.0"), "1.0.0");
    try std.testing.expectEqual(reqs[5].version.tag, Dependency.Version.Tag.dist_tag);
    try std.testing.expectEqualStrings(reqs[5].version.literal.slice("bing@1.0.0"), "latest");
    try std.testing.expectEqual(updates.len, 6);
}
