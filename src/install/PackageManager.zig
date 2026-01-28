cache_directory_: ?std.fs.Dir = null,
cache_directory_path: stringZ = "",
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

network_dedupe_map: NetworkTask.DedupeMap = .init(bun.default_allocator),
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
///
/// TODO: Does this need to be atomic? It seems to be accessed only from the main thread.
pending_pre_calc_hashes: std.atomic.Value(u32) = .init(0),
pending_tasks: std.atomic.Value(u32) = .init(0),
total_tasks: u32 = 0,
preallocated_network_tasks: PreallocatedNetworkTasks,
preallocated_resolve_tasks: PreallocatedTaskStore,

/// items are only inserted into this if they took more than 500ms
lifecycle_script_time_log: LifecycleScriptTimeLog = .{},

pending_lifecycle_script_tasks: std.atomic.Value(u32) = .init(0),
finished_installing: std.atomic.Value(bool) = .init(false),
total_scripts: usize = 0,

root_lifecycle_scripts: ?Package.Scripts.List = null,

node_gyp_tempdir_name: string = "",

env_configure: ?ScriptRunEnvironment = null,

lockfile: *Lockfile = undefined,

options: Options,
preinstall_state: std.ArrayListUnmanaged(PreinstallState) = .{},
postinstall_optimizer: PostinstallOptimizer.List = .{},

global_link_dir: ?std.fs.Dir = null,
global_dir: ?std.fs.Dir = null,
global_link_dir_path: string = "",

onWake: WakeHandler = .{},
ci_mode: bun.LazyBool(computeIsContinuousIntegration, @This(), "ci_mode") = .{},

peer_dependencies: bun.LinearFifo(DependencyID, .Dynamic) = .init(default_allocator),

// name hash from alias package name -> aliased package dependency version info
known_npm_aliases: NpmAliasMap = .{},

event_loop: jsc.AnyEventLoop,

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

/// Corresponds to possible commands from the CLI.
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
    why,
    scan,

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
            .update => true,
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

pub fn hasEnoughTimePassedBetweenWaitingMessages() bool {
    const iter = get().event_loop.loop().iterationNumber();
    if (TimePasser.last_time < iter) {
        TimePasser.last_time = iter;
        return true;
    }

    return false;
}

pub fn configureEnvForScripts(this: *PackageManager, ctx: Command.Context, log_level: Options.LogLevel) !transpiler.Transpiler {
    return configureEnvForScriptsOnce.call(.{ this, ctx, log_level });
}

pub var configureEnvForScriptsOnce = bun.once(struct {
    pub fn run(this: *PackageManager, ctx: Command.Context, log_level: Options.LogLevel) !transpiler.Transpiler {

        // We need to figure out the PATH and other environment variables
        // to do that, we re-use the code from bun run
        // this is expensive, it traverses the entire directory tree going up to the root
        // so we really only want to do it when strictly necessary
        var this_transpiler: transpiler.Transpiler = undefined;
        _ = try RunCommand.configureEnvForRun(
            ctx,
            &this_transpiler,
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
            // Run node-gyp jobs in parallel.
            // https://github.com/nodejs/node-gyp/blob/7d883b5cf4c26e76065201f85b0be36d5ebdcc0e/lib/build.js#L150-L184
            const thread_count = bun.getThreadCount();
            if (thread_count > 2) {
                if (!this_transpiler.env.has("JOBS")) {
                    var int_buf: [10]u8 = undefined;
                    const jobs_str = std.fmt.bufPrint(&int_buf, "{d}", .{thread_count}) catch unreachable;
                    this_transpiler.env.map.putAllocValue(bun.default_allocator, "JOBS", jobs_str) catch unreachable;
                }
            }
        }

        {
            var node_path: bun.PathBuffer = undefined;
            if (this.env.getNodePath(this_transpiler.fs, &node_path)) |node_pathZ| {
                _ = try this.env.loadNodeJSConfig(this_transpiler.fs, bun.handleOom(bun.default_allocator.dupe(u8, node_pathZ)));
            } else brk: {
                const current_path = this.env.get("PATH") orelse "";
                var PATH = try std.array_list.Managed(u8).initCapacity(bun.default_allocator, current_path.len);
                try PATH.appendSlice(current_path);
                var bun_path: string = "";
                RunCommand.createFakeTemporaryNodeExecutable(&PATH, &bun_path) catch break :brk;
                try this.env.map.put("PATH", PATH.items);
                _ = try this.env.loadNodeJSConfig(this_transpiler.fs, bun.handleOom(bun.default_allocator.dupe(u8, bun_path)));
            }
        }

        return this_transpiler;
    }
}.run);

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

    this.event_loop.wakeup();
}

pub fn sleepUntil(this: *PackageManager, closure: anytype, comptime isDoneFn: anytype) void {
    Output.flush();
    this.event_loop.tick(closure, isDoneFn);
}

pub threadlocal var cached_package_folder_name_buf: bun.PathBuffer = undefined;

const Holder = struct {
    pub var ptr: *PackageManager = undefined;
};

pub fn allocatePackageManager() void {
    Holder.ptr = bun.handleOom(bun.default_allocator.create(PackageManager));
}

pub fn get() *PackageManager {
    return Holder.ptr;
}

pub const SuccessFn = *const fn (*PackageManager, DependencyID, PackageID) void;
pub const FailFn = *const fn (*PackageManager, *const Dependency, PackageID, anyerror) void;

pub const debug = Output.scoped(.PackageManager, .hidden);

pub fn ensureTempNodeGypScript(this: *PackageManager) !void {
    return ensureTempNodeGypScriptOnce.call(.{this});
}

var ensureTempNodeGypScriptOnce = bun.once(struct {
    pub fn run(manager: *PackageManager) !void {
        if (manager.node_gyp_tempdir_name.len > 0) return;

        const tempdir = manager.getTemporaryDirectory();
        var path_buf: bun.PathBuffer = undefined;
        const node_gyp_tempdir_name = try Fs.FileSystem.tmpname("node-gyp", &path_buf, 12345);

        // used later for adding to path for scripts
        manager.node_gyp_tempdir_name = try manager.allocator.dupe(u8, node_gyp_tempdir_name);

        var node_gyp_tempdir = tempdir.handle.makeOpenPath(manager.node_gyp_tempdir_name, .{}) catch |err| {
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
        const existing_path = manager.env.get("PATH") orelse "";
        var PATH = try std.array_list.Managed(u8).initCapacity(bun.default_allocator, existing_path.len + 1 + tempdir.name.len + 1 + manager.node_gyp_tempdir_name.len);
        try PATH.appendSlice(existing_path);
        if (existing_path.len > 0 and existing_path[existing_path.len - 1] != std.fs.path.delimiter)
            try PATH.append(std.fs.path.delimiter);
        try PATH.appendSlice(strings.withoutTrailingSlash(tempdir.name));
        try PATH.append(std.fs.path.sep);
        try PATH.appendSlice(manager.node_gyp_tempdir_name);
        try manager.env.map.put("PATH", PATH.items);

        const npm_config_node_gyp = try std.fmt.bufPrint(&path_buf, "{s}{s}{s}{s}{s}", .{
            strings.withoutTrailingSlash(tempdir.name),
            std.fs.path.sep_str,
            strings.withoutTrailingSlash(manager.node_gyp_tempdir_name),
            std.fs.path.sep_str,
            file_name,
        });

        const node_gyp_abs_dir = std.fs.path.dirname(npm_config_node_gyp).?;
        try manager.env.map.putAllocKeyAndValue(manager.allocator, "BUN_WHICH_IGNORE_CWD", node_gyp_abs_dir);
    }
}.run);

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
        // Avoid memcpy alias when source and dest are the same
        if (cwd_buf[0..].ptr != top_level_dir_no_trailing_slash.ptr) {
            bun.copy(u8, cwd_buf[0..top_level_dir_no_trailing_slash.len], top_level_dir_no_trailing_slash);
        }
    }

    var original_package_json_path_buf = bun.handleOom(std.ArrayListUnmanaged(u8).initCapacity(ctx.allocator, top_level_dir_no_trailing_slash.len + "/package.json".len + 1));
    original_package_json_path_buf.appendSliceAssumeCapacity(top_level_dir_no_trailing_slash);
    original_package_json_path_buf.appendSliceAssumeCapacity(std.fs.path.sep_str ++ "package.json");
    original_package_json_path_buf.appendAssumeCapacity(0);

    var original_package_json_path: stringZ = original_package_json_path_buf.items[0 .. top_level_dir_no_trailing_slash.len + "/package.json".len :0];
    const original_cwd = strings.withoutSuffixComptime(original_package_json_path, std.fs.path.sep_str ++ "package.json");
    const original_cwd_clone = bun.handleOom(ctx.allocator.dupe(u8, original_cwd));

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
                    const json_path = try bun.getFdPath(.fromStdFile(json_file), &root_package_json_path_buf);
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
    root_package_json_path = try bun.getFdPathZ(.fromStdFile(root_package_json_file), &root_package_json_path_buf);

    const entries_option = try fs.fs.readDirectory(fs.top_level_dir, null, 0, true);
    if (entries_option.* == .err) {
        return entries_option.err.canonical_error;
    }

    var env: *DotEnv.Loader = brk: {
        const map = try ctx.allocator.create(DotEnv.Map);
        map.* = DotEnv.Map.init(ctx.allocator);

        const loader = try ctx.allocator.create(DotEnv.Loader);
        loader.* = DotEnv.Loader.init(map, ctx.allocator);
        break :brk loader;
    };

    try env.loadProcess();
    try env.load(entries_option.entries, &[_][]u8{}, .production, false);

    initializeStore();

    if (bun.env_var.XDG_CONFIG_HOME.get() orelse bun.env_var.HOME.get()) |data_dir| {
        var buf: bun.PathBuffer = undefined;
        var parts = [_]string{
            "./.npmrc",
        };

        bun.ini.loadNpmrcConfig(ctx.allocator, ctx.install orelse brk: {
            const install_ = bun.handleOom(ctx.allocator.create(Api.BunInstall));
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
            const install_ = bun.handleOom(ctx.allocator.create(Api.BunInstall));
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

    if (bun.feature_flag.BUN_FEATURE_FLAG_FORCE_WINDOWS_JUNCTIONS.get()) {
        bun.sys.WindowsSymlinkOptions.has_failed_to_create_symlink = true;
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
            .mini = jsc.MiniEventLoop.init(bun.default_allocator),
        },
        .original_package_json_path = original_package_json_path,
        .workspace_package_json_cache = workspace_package_json_cache,
        .workspace_name_hash = workspace_name_hash,
        .subcommand = subcommand,
        .root_package_json_name_at_time_of_init = root_package_json_name_at_time_of_init,
    };
    manager.event_loop.loop().internal_loop_data.setParentEventLoop(bun.jsc.EventLoopHandle.init(&manager.event_loop));
    manager.lockfile = try ctx.allocator.create(Lockfile);

    {
        // make sure folder packages can find the root package without creating a new one
        var normalized: bun.AbsPath(.{ .sep = .posix }) = .from(root_package_json_path);
        defer normalized.deinit();
        try manager.folders.put(manager.allocator, FolderResolution.hash(normalized.slice()), .{ .package_id = 0 });
    }

    jsc.MiniEventLoop.global = &manager.event_loop.mini;
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
    var original_package_json_path = bun.handleOom(allocator.allocSentinel(u8, top_level_dir_no_trailing_slash.len + "/package.json".len, 0));
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
            .js = jsc.VirtualMachine.get().eventLoop(),
        },
        .original_package_json_path = original_package_json_path[0..original_package_json_path.len :0],
        .subcommand = .install,
    };
    manager.lockfile = bun.handleOom(allocator.create(Lockfile));

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
var cwd_buf: bun.PathBuffer = undefined;
var root_package_json_path_buf: bun.PathBuffer = undefined;
pub var root_package_json_path: [:0]const u8 = "";

// Default to a maximum of 64 simultaneous HTTP requests for bun install if no proxy is specified
// if a proxy IS specified, default to 64. We have different values because we might change this in the future.
// https://github.com/npm/cli/issues/7072
// https://pnpm.io/npmrc#network-concurrency (pnpm defaults to 16)
// https://yarnpkg.com/configuration/yarnrc#networkConcurrency (defaults to 50)
const default_max_simultaneous_requests_for_bun_install = 64;
const default_max_simultaneous_requests_for_bun_install_for_proxies = 64;

pub const TaskCallbackList = std.ArrayListUnmanaged(TaskCallbackContext);
const TaskDependencyQueue = std.HashMapUnmanaged(Task.Id, TaskCallbackList, IdentityContext(Task.Id), 80);

const PreallocatedTaskStore = bun.HiveArray(Task, 64).Fallback;
const PreallocatedNetworkTasks = bun.HiveArray(NetworkTask, 128).Fallback;
const ResolveTaskQueue = bun.UnboundedQueue(Task, .next);

const RepositoryMap = std.HashMapUnmanaged(Task.Id, bun.FileDescriptor, IdentityContext(Task.Id), 80);
const NpmAliasMap = std.HashMapUnmanaged(PackageNameHash, Dependency.Version, IdentityContext(u64), 80);

const NetworkQueue = bun.LinearFifo(*NetworkTask, .{ .Static = 32 });
const PatchTaskFifo = bun.LinearFifo(*PatchTask, .{ .Static = 32 });

// pub const ensureTempNodeGypScript = directories.ensureTempNodeGypScript;

pub const CommandLineArguments = @import("./PackageManager/CommandLineArguments.zig");
pub const Options = @import("./PackageManager/PackageManagerOptions.zig");
pub const PackageJSONEditor = @import("./PackageManager/PackageJSONEditor.zig");
pub const UpdateRequest = @import("./PackageManager/UpdateRequest.zig");
pub const WorkspacePackageJSONCache = @import("./PackageManager/WorkspacePackageJSONCache.zig");
pub const PackageInstaller = @import("./PackageInstaller.zig").PackageInstaller;
pub const installWithManager = @import("./PackageManager/install_with_manager.zig").installWithManager;

pub const directories = @import("./PackageManager/PackageManagerDirectories.zig");
pub const attemptToCreatePackageJSON = directories.attemptToCreatePackageJSON;
const attemptToCreatePackageJSONAndOpen = directories.attemptToCreatePackageJSONAndOpen;
pub const cachedGitFolderName = directories.cachedGitFolderName;
pub const cachedGitFolderNamePrint = directories.cachedGitFolderNamePrint;
pub const cachedGitFolderNamePrintAuto = directories.cachedGitFolderNamePrintAuto;
pub const cachedGitHubFolderName = directories.cachedGitHubFolderName;
pub const cachedGitHubFolderNamePrint = directories.cachedGitHubFolderNamePrint;
pub const cachedGitHubFolderNamePrintAuto = directories.cachedGitHubFolderNamePrintAuto;
pub const cachedNPMPackageFolderName = directories.cachedNPMPackageFolderName;
pub const cachedNPMPackageFolderNamePrint = directories.cachedNPMPackageFolderNamePrint;
pub const cachedNPMPackageFolderPrintBasename = directories.cachedNPMPackageFolderPrintBasename;
pub const cachedTarballFolderName = directories.cachedTarballFolderName;
pub const cachedTarballFolderNamePrint = directories.cachedTarballFolderNamePrint;
pub const computeCacheDirAndSubpath = directories.computeCacheDirAndSubpath;
pub const fetchCacheDirectoryPath = directories.fetchCacheDirectoryPath;
pub const getCacheDirectory = directories.getCacheDirectory;
pub const getCacheDirectoryAndAbsPath = directories.getCacheDirectoryAndAbsPath;
pub const getTemporaryDirectory = directories.getTemporaryDirectory;
pub const globalLinkDir = directories.globalLinkDir;
pub const globalLinkDirAndPath = directories.globalLinkDirAndPath;
pub const globalLinkDirPath = directories.globalLinkDirPath;
pub const isFolderInCache = directories.isFolderInCache;
pub const pathForCachedNPMPath = directories.pathForCachedNPMPath;
pub const pathForResolution = directories.pathForResolution;
pub const saveLockfile = directories.saveLockfile;
pub const setupGlobalDir = directories.setupGlobalDir;
pub const updateLockfileIfNeeded = directories.updateLockfileIfNeeded;
pub const writeYarnLock = directories.writeYarnLock;

pub const enqueue = @import("./PackageManager/PackageManagerEnqueue.zig");
pub const enqueueDependencyList = enqueue.enqueueDependencyList;
pub const enqueueDependencyToRoot = enqueue.enqueueDependencyToRoot;
pub const enqueueDependencyWithMain = enqueue.enqueueDependencyWithMain;
pub const enqueueDependencyWithMainAndSuccessFn = enqueue.enqueueDependencyWithMainAndSuccessFn;
pub const enqueueExtractNPMPackage = enqueue.enqueueExtractNPMPackage;
pub const enqueueGitCheckout = enqueue.enqueueGitCheckout;
pub const enqueueGitForCheckout = enqueue.enqueueGitForCheckout;
pub const enqueueNetworkTask = enqueue.enqueueNetworkTask;
pub const enqueuePackageForDownload = enqueue.enqueuePackageForDownload;
pub const enqueueParseNPMPackage = enqueue.enqueueParseNPMPackage;
pub const enqueuePatchTask = enqueue.enqueuePatchTask;
pub const enqueuePatchTaskPre = enqueue.enqueuePatchTaskPre;
pub const enqueueTarballForDownload = enqueue.enqueueTarballForDownload;
pub const enqueueTarballForReading = enqueue.enqueueTarballForReading;

pub const determinePreinstallState = lifecycle.determinePreinstallState;
pub const ensurePreinstallStateListCapacity = lifecycle.ensurePreinstallStateListCapacity;
pub const findTrustedDependenciesFromUpdateRequests = lifecycle.findTrustedDependenciesFromUpdateRequests;
pub const getPreinstallState = lifecycle.getPreinstallState;
pub const hasNoMorePendingLifecycleScripts = lifecycle.hasNoMorePendingLifecycleScripts;
pub const loadRootLifecycleScripts = lifecycle.loadRootLifecycleScripts;
pub const reportSlowLifecycleScripts = lifecycle.reportSlowLifecycleScripts;
pub const setPreinstallState = lifecycle.setPreinstallState;
pub const sleep = lifecycle.sleep;
pub const spawnPackageLifecycleScripts = lifecycle.spawnPackageLifecycleScripts;
pub const tickLifecycleScripts = lifecycle.tickLifecycleScripts;

pub const assignResolution = resolution.assignResolution;
pub const assignRootResolution = resolution.assignRootResolution;
pub const formatLaterVersionInCache = resolution.formatLaterVersionInCache;
pub const getInstalledVersionsFromDiskCache = resolution.getInstalledVersionsFromDiskCache;
pub const resolveFromDiskCache = resolution.resolveFromDiskCache;
pub const scopeForPackageName = resolution.scopeForPackageName;
pub const verifyResolutions = resolution.verifyResolutions;

pub const progress_zig = @import("./PackageManager/ProgressStrings.zig");
pub const ProgressStrings = progress_zig.ProgressStrings;
pub const endProgressBar = progress_zig.endProgressBar;
pub const setNodeName = progress_zig.setNodeName;
pub const startProgressBar = progress_zig.startProgressBar;
pub const startProgressBarIfNone = progress_zig.startProgressBarIfNone;

pub const PatchCommitResult = @import("./PackageManager/patchPackage.zig").PatchCommitResult;
pub const doPatchCommit = @import("./PackageManager/patchPackage.zig").doPatchCommit;
pub const preparePatch = @import("./PackageManager/patchPackage.zig").preparePatch;

pub const GitResolver = @import("./PackageManager/processDependencyList.zig").GitResolver;
pub const processDependencyList = @import("./PackageManager/processDependencyList.zig").processDependencyList;
pub const processDependencyListItem = @import("./PackageManager/processDependencyList.zig").processDependencyListItem;
pub const processExtractedTarballPackage = @import("./PackageManager/processDependencyList.zig").processExtractedTarballPackage;
pub const processPeerDependencyList = @import("./PackageManager/processDependencyList.zig").processPeerDependencyList;

pub const allocGitHubURL = @import("./PackageManager/runTasks.zig").allocGitHubURL;
pub const decrementPendingTasks = @import("./PackageManager/runTasks.zig").decrementPendingTasks;
pub const drainDependencyList = @import("./PackageManager/runTasks.zig").drainDependencyList;
pub const flushDependencyQueue = @import("./PackageManager/runTasks.zig").flushDependencyQueue;
pub const flushNetworkQueue = @import("./PackageManager/runTasks.zig").flushNetworkQueue;
pub const flushPatchTaskQueue = @import("./PackageManager/runTasks.zig").flushPatchTaskQueue;
pub const generateNetworkTaskForTarball = @import("./PackageManager/runTasks.zig").generateNetworkTaskForTarball;
pub const getNetworkTask = @import("./PackageManager/runTasks.zig").getNetworkTask;
pub const hasCreatedNetworkTask = @import("./PackageManager/runTasks.zig").hasCreatedNetworkTask;
pub const incrementPendingTasks = @import("./PackageManager/runTasks.zig").incrementPendingTasks;
pub const isNetworkTaskRequired = @import("./PackageManager/runTasks.zig").isNetworkTaskRequired;
pub const pendingTaskCount = @import("./PackageManager/runTasks.zig").pendingTaskCount;
pub const runTasks = @import("./PackageManager/runTasks.zig").runTasks;
pub const scheduleTasks = @import("./PackageManager/runTasks.zig").scheduleTasks;

pub const updatePackageJSONAndInstallCatchError = @import("./PackageManager/updatePackageJSONAndInstall.zig").updatePackageJSONAndInstallCatchError;
pub const updatePackageJSONAndInstallWithManager = @import("./PackageManager/updatePackageJSONAndInstall.zig").updatePackageJSONAndInstallWithManager;

pub const populateManifestCache = @import("./PackageManager/PopulateManifestCache.zig").populateManifestCache;

const string = []const u8;
const stringZ = [:0]const u8;

const DirInfo = @import("../resolver/dir_info.zig");
const resolution = @import("./PackageManager/PackageManagerResolution.zig");
const std = @import("std");
const updatePackageJSONAndInstall = @import("./PackageManager/updatePackageJSONAndInstall.zig").updatePackageJSONAndInstall;

const lifecycle = @import("./PackageManager/PackageManagerLifecycle.zig");
const LifecycleScriptTimeLog = lifecycle.LifecycleScriptTimeLog;

const bun = @import("bun");
const DotEnv = bun.DotEnv;
const Environment = bun.Environment;
const Global = bun.Global;
const JSON = bun.json;
const OOM = bun.OOM;
const Output = bun.Output;
const Path = bun.path;
const Progress = bun.Progress;
const RunCommand = bun.RunCommand;
const ThreadPool = bun.ThreadPool;
const URL = bun.URL;
const default_allocator = bun.default_allocator;
const jsc = bun.jsc;
const logger = bun.logger;
const strings = bun.strings;
const transpiler = bun.transpiler;
const Api = bun.schema.api;
const File = bun.sys.File;

const Semver = bun.Semver;
const String = Semver.String;

const BunArguments = bun.cli.Arguments;
const Command = bun.cli.Command;

const Fs = bun.fs;
const FileSystem = Fs.FileSystem;

const HTTP = bun.http;
const AsyncHTTP = HTTP.AsyncHTTP;

const ArrayIdentityContext = bun.install.ArrayIdentityContext;
const Dependency = bun.install.Dependency;
const DependencyID = bun.install.DependencyID;
const Features = bun.install.Features;
const FolderResolution = bun.install.FolderResolution;
const IdentityContext = bun.install.IdentityContext;
const LifecycleScriptSubprocess = bun.install.LifecycleScriptSubprocess;
const NetworkTask = bun.install.NetworkTask;
const PackageID = bun.install.PackageID;
const PackageManager = bun.install.PackageManager;
const PackageManifestMap = bun.install.PackageManifestMap;
const PackageNameAndVersionHash = bun.install.PackageNameAndVersionHash;
const PackageNameHash = bun.install.PackageNameHash;
const PatchTask = bun.install.PatchTask;
const PostinstallOptimizer = bun.install.PostinstallOptimizer;
const PreinstallState = bun.install.PreinstallState;
const Task = bun.install.Task;
const TaskCallbackContext = bun.install.TaskCallbackContext;
const initializeStore = bun.install.initializeStore;

const Lockfile = bun.install.Lockfile;
const Package = Lockfile.Package;
