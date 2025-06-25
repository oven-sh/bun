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

pub const SuccessFn = *const fn (*PackageManager, DependencyID, PackageID) void;
pub const FailFn = *const fn (*PackageManager, *const Dependency, PackageID, anyerror) void;

pub fn assignResolution(this: *PackageManager, dependency_id: DependencyID, package_id: PackageID) void {
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

pub fn assignRootResolution(this: *PackageManager, dependency_id: DependencyID, package_id: PackageID) void {
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

pub const debug = Output.scoped(.PackageManager, true);

pub fn flushNetworkQueue(this: *PackageManager) void {
    var network = &this.network_task_fifo;

    while (network.readItem()) |network_task| {
        network_task.schedule(if (network_task.callback == .extract) &this.network_tarball_batch else &this.network_resolve_batch);
    }
}

pub fn flushPatchTaskQueue(this: *PackageManager) void {
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

pub fn drainDependencyList(this: *PackageManager) void {
    // Step 2. If there were cached dependencies, go through all of those but don't download the devDependencies for them.
    this.flushDependencyQueue();

    if (PackageManager.verbose_install) Output.flush();

    // It's only network requests here because we don't store tarballs.
    _ = this.scheduleTasks();
}

pub fn processDependencyListItem(
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

pub fn processPeerDependencyList(
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

pub fn processDependencyList(
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
pub fn processExtractedTarballPackage(
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

pub fn printInstallSummary(
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

pub fn saveLockfile(
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

// Default to a maximum of 64 simultaneous HTTP requests for bun install if no proxy is specified
// if a proxy IS specified, default to 64. We have different values because we might change this in the future.
// https://github.com/npm/cli/issues/7072
// https://pnpm.io/npmrc#network-concurrency (pnpm defaults to 16)
// https://yarnpkg.com/configuration/yarnrc#networkConcurrency (defaults to 50)
const default_max_simultaneous_requests_for_bun_install = 64;
const default_max_simultaneous_requests_for_bun_install_for_proxies = 64;

pub const TaskCallbackList = std.ArrayListUnmanaged(TaskCallbackContext);
const TaskDependencyQueue = std.HashMapUnmanaged(u64, TaskCallbackList, IdentityContext(u64), 80);

const PreallocatedTaskStore = bun.HiveArray(Task, 64).Fallback;
const PreallocatedNetworkTasks = bun.HiveArray(NetworkTask, 128).Fallback;
const ResolveTaskQueue = bun.UnboundedQueue(Task, .next);

const RepositoryMap = std.HashMapUnmanaged(u64, bun.FileDescriptor, IdentityContext(u64), 80);
const NpmAliasMap = std.HashMapUnmanaged(PackageNameHash, Dependency.Version, IdentityContext(u64), 80);

const NetworkQueue = std.fifo.LinearFifo(*NetworkTask, .{ .Static = 32 });
const PatchTaskFifo = std.fifo.LinearFifo(*PatchTask, .{ .Static = 32 });

pub const CommandLineArguments = @import("./PackageManager/CommandLineArguments.zig");
const DirInfo = @import("../resolver/dir_info.zig");
pub const Options = @import("./PackageManager/PackageManagerOptions.zig");
pub const PackageJSONEditor = @import("./PackageManager/PackageJSONEditor.zig");
pub const UpdateRequest = @import("PackageManager/UpdateRequest.zig");
const std = @import("std");
pub const PackageInstaller = @import("./PackageInstaller.zig").PackageInstaller;
pub const installWithManager = @import("PackageManager/install_with_manager.zig").installWithManager;
pub const runTasks = @import("PackageManager/run_tasks.zig").runTasks;
const updatePackageJSONAndInstallWithManager = @import("PackageManager/update_package_json_and_install.zig").updatePackageJSONAndInstallWithManager;

pub const enqueueDependencyList = @import("PackageManager/enqueue.zig").enqueueDependencyList;
pub const enqueueDependencyToRoot = @import("PackageManager/enqueue.zig").enqueueDependencyToRoot;
pub const enqueueDependencyWithMain = @import("PackageManager/enqueue.zig").enqueueDependencyWithMain;
pub const enqueueDependencyWithMainAndSuccessFn = @import("PackageManager/enqueue.zig").enqueueDependencyWithMainAndSuccessFn;
pub const enqueueExtractNPMPackage = @import("PackageManager/enqueue.zig").enqueueExtractNPMPackage;
pub const enqueueGitCheckout = @import("PackageManager/enqueue.zig").enqueueGitCheckout;
pub const enqueueGitForCheckout = @import("PackageManager/enqueue.zig").enqueueGitForCheckout;
pub const enqueueNetworkTask = @import("PackageManager/enqueue.zig").enqueueNetworkTask;
pub const enqueuePackageForDownload = @import("PackageManager/enqueue.zig").enqueuePackageForDownload;
pub const enqueueParseNPMPackage = @import("PackageManager/enqueue.zig").enqueueParseNPMPackage;
pub const enqueuePatchTask = @import("PackageManager/enqueue.zig").enqueuePatchTask;
pub const enqueuePatchTaskPre = @import("PackageManager/enqueue.zig").enqueuePatchTaskPre;
pub const enqueueTarballForDownload = @import("PackageManager/enqueue.zig").enqueueTarballForDownload;
pub const enqueueTarballForReading = @import("PackageManager/enqueue.zig").enqueueTarballForReading;

pub const PatchCommitResult = @import("PackageManager/patch.zig").PatchCommitResult;
pub const doPatchCommit = @import("PackageManager/patch.zig").doPatchCommit;
const preparePatch = @import("PackageManager/patch.zig").preparePatch;

const bun = @import("bun");
const DotEnv = bun.DotEnv;
const Environment = bun.Environment;
const FD = bun.FD;
const Global = bun.Global;
const JSAst = bun.JSAst;
const JSC = bun.JSC;
const JSON = bun.JSON;
const JSPrinter = bun.js_printer;
const OOM = bun.OOM;
const Output = bun.Output;
const Path = bun.path;
const Progress = bun.Progress;
const RunCommand = bun.RunCommand;
const ThreadPool = bun.ThreadPool;
const URL = bun.URL;
const default_allocator = bun.default_allocator;
const logger = bun.logger;
const string = bun.string;
const stringZ = bun.stringZ;
const strings = bun.strings;
const transpiler = bun.transpiler;
const Api = bun.Schema.Api;

const BunArguments = bun.CLI.Arguments;
const Command = bun.CLI.Command;

const Semver = bun.Semver;
const ExternalString = Semver.ExternalString;
const SlicedString = Semver.SlicedString;
const String = Semver.String;

const Fs = bun.fs;
const FileSystem = Fs.FileSystem;

const HTTP = bun.http;
const AsyncHTTP = HTTP.AsyncHTTP;

const ArrayIdentityContext = bun.install.ArrayIdentityContext;
const Bin = bun.install.Bin;
const Dependency = bun.install.Dependency;
const DependencyID = bun.install.DependencyID;
const ExtractData = bun.install.ExtractData;
const Features = bun.install.Features;
const FolderResolution = bun.install.FolderResolution;
const IdentityContext = bun.install.IdentityContext;
const LifecycleScriptSubprocess = bun.install.LifecycleScriptSubprocess;
const NetworkTask = bun.install.NetworkTask;
const Npm = bun.install.Npm;
const PackageID = bun.install.PackageID;
const PackageInstall = bun.install.PackageInstall;
const PackageManager = bun.install.PackageManager;
const PackageManifestMap = bun.install.PackageManifestMap;
const PackageNameAndVersionHash = bun.install.PackageNameAndVersionHash;
const PackageNameHash = bun.install.PackageNameHash;
const PatchTask = bun.install.PatchTask;
const PreinstallState = bun.install.PreinstallState;
const Repository = bun.install.Repository;
const Resolution = bun.install.Resolution;
const Task = bun.install.Task;
const TaskCallbackContext = bun.install.TaskCallbackContext;
const TextLockfile = bun.install.TextLockfile;
const initializeStore = bun.install.initializeStore;
const invalid_package_id = bun.install.invalid_package_id;

const Lockfile = bun.install.Lockfile;
const Package = Lockfile.Package;

const Syscall = bun.sys;
const File = bun.sys.File;
