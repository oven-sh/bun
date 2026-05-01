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
        bun.handleOom(log.list.append(allocator, entry));
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
            Output.warn("{s}'s {s} script took {f}\n\n", .{
                longest.package_name,
                Lockfile.Scripts.names[longest.script_id],
                bun.fmt.fmtDurationOneDecimal(longest.duration),
            });
            Output.flush();
        }
        log.list.deinit(allocator);
    }
};

pub fn ensurePreinstallStateListCapacity(this: *PackageManager, count: usize) void {
    if (this.preinstall_state.items.len >= count) {
        return;
    }

    const offset = this.preinstall_state.items.len;
    bun.handleOom(this.preinstall_state.ensureTotalCapacity(this.allocator, count));
    this.preinstall_state.expandToCapacity();
    @memset(this.preinstall_state.items[offset..], PreinstallState.unknown);
}

pub fn setPreinstallState(this: *PackageManager, package_id: PackageID, lockfile: *const Lockfile, value: PreinstallState) void {
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
            if (pkg.isDisabled(manager.options.cpu, manager.options.os)) {
                manager.setPreinstallState(pkg.meta.id, lockfile, .done);
                return .done;
            }

            const patch_hash: ?u64 = brk: {
                if (manager.lockfile.patched_dependencies.entries.len == 0) break :brk null;
                var sfb = std.heap.stackFallback(1024, manager.lockfile.allocator);
                const name_and_version = std.fmt.allocPrint(
                    sfb.get(),
                    "{s}@{f}",
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
                const non_patched_path = bun.handleOom(manager.lockfile.allocator.dupeZ(u8, non_patched_path_));
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

pub fn hasNoMorePendingLifecycleScripts(this: *PackageManager) bool {
    this.reportSlowLifecycleScripts();
    return this.pending_lifecycle_script_tasks.load(.monotonic) == 0;
}

pub fn tickLifecycleScripts(this: *PackageManager) void {
    this.event_loop.tickOnce(this);
}

pub fn sleep(this: *PackageManager) void {
    this.reportSlowLifecycleScripts();
    Output.flush();
    this.event_loop.tick(this, hasNoMorePendingLifecycleScripts);
}

pub fn reportSlowLifecycleScripts(this: *PackageManager) void {
    const log_level = this.options.log_level;
    if (log_level == .silent) return;
    if (bun.feature_flag.BUN_DISABLE_SLOW_LIFECYCLE_SCRIPT_LOGGING.get()) {
        return;
    }

    if (this.active_lifecycle_scripts.peek()) |active_lifecycle_script_running_for_the_longest_amount_of_time| {
        if (this.cached_tick_for_slow_lifecycle_script_logging == this.event_loop.iterationNumber()) {
            return;
        }
        this.cached_tick_for_slow_lifecycle_script_logging = this.event_loop.iterationNumber();
        const current_time = bun.timespec.now(.allow_mocked_time).ns();
        const time_running = current_time -| active_lifecycle_script_running_for_the_longest_amount_of_time.started_at;
        const interval: u64 = if (log_level.isVerbose()) std.time.ns_per_s * 5 else std.time.ns_per_s * 30;
        if (time_running > interval and current_time -| this.last_reported_slow_lifecycle_script_at > interval) {
            this.last_reported_slow_lifecycle_script_at = current_time;
            const package_name = active_lifecycle_script_running_for_the_longest_amount_of_time.package_name;

            if (!(package_name.len > 1 and package_name[package_name.len - 1] == 's')) {
                Output.warn("{s}'s postinstall cost you {f}\n", .{
                    package_name,
                    bun.fmt.fmtDurationOneDecimal(time_running),
                });
            } else {
                Output.warn("{s}' postinstall cost you {f}\n", .{
                    package_name,
                    bun.fmt.fmtDurationOneDecimal(time_running),
                });
            }
            Output.flush();
        }
    }
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

    var top_level_dir: bun.AbsPath(.{ .sep = .auto }) = .initTopLevelDir();
    defer top_level_dir.deinit();

    if (root_package.scripts.hasAny()) {
        const add_node_gyp_rebuild_script = root_package.scripts.install.isEmpty() and root_package.scripts.preinstall.isEmpty() and Syscall.exists(binding_dot_gyp_path);

        this.root_lifecycle_scripts = root_package.scripts.createList(
            this.lockfile,
            buf,
            &top_level_dir,
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
                &top_level_dir,
                name,
                .root,
                true,
            );
        }
    }
}

/// Used to be called from multiple threads; now single-threaded
/// TODO: re-evaluate whether some variables still need to be atomic
pub fn spawnPackageLifecycleScripts(
    this: *PackageManager,
    ctx: Command.Context,
    list: Lockfile.Package.Scripts.List,
    optional: bool,
    foreground: bool,
    install_ctx: ?LifecycleScriptSubprocess.InstallCtx,
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
    var this_transpiler = try this.configureEnvForScripts(ctx, log_level);

    var script_env = try this_transpiler.env.map.cloneWithAllocator(bun.default_allocator);
    defer script_env.map.deinit();

    const original_path = script_env.get("PATH") orelse "";

    var PATH: bun.EnvPath(.{}) = try .initCapacity(bun.default_allocator, original_path.len + 1 + "node_modules/.bin".len + cwd.len + 1);
    defer PATH.deinit();

    var parent: ?string = cwd;

    while (parent) |dir| {
        var builder = PATH.pathComponentBuilder();
        builder.append(dir);
        builder.append("node_modules/.bin");
        try builder.apply();

        parent = std.fs.path.dirname(dir);
    }

    try PATH.append(original_path);
    try script_env.put("PATH", PATH.slice());

    const envp = try script_env.createNullDelimitedEnvMap(this.allocator);

    const shell_bin = shell_bin: {
        if (comptime Environment.isWindows) {
            break :shell_bin null;
        }

        if (this.env.get("PATH")) |env_path| {
            break :shell_bin bun.cli.RunCommand.findShell(env_path, cwd);
        }

        break :shell_bin null;
    };

    try LifecycleScriptSubprocess.spawnPackageScripts(this, list, envp, shell_bin, optional, log_level, foreground, install_ctx);
}

pub fn findTrustedDependenciesFromUpdateRequests(this: *PackageManager) std.AutoArrayHashMapUnmanaged(TruncatedPackageNameHash, void) {
    const parts = this.lockfile.packages.slice();
    // find all deps originating from --trust packages from cli
    var set: std.AutoArrayHashMapUnmanaged(TruncatedPackageNameHash, void) = .{};
    if (this.options.do.trust_dependencies_from_args and this.lockfile.packages.len > 0) {
        const root_deps = parts.items(.dependencies)[this.root_package_id.get(this.lockfile, this.workspace_name_hash)];
        var dep_id = root_deps.off;
        const end = dep_id +| root_deps.len;
        while (dep_id < end) : (dep_id += 1) {
            const root_dep = this.lockfile.buffers.dependencies.items[dep_id];
            for (this.update_requests) |request| {
                if (request.matches(root_dep, this.lockfile.buffers.string_bytes.items)) {
                    const package_id = this.lockfile.buffers.resolutions.items[dep_id];
                    if (package_id == invalid_package_id) continue;

                    const entry = bun.handleOom(set.getOrPut(this.lockfile.allocator, @truncate(root_dep.name_hash)));
                    if (!entry.found_existing) {
                        const dependency_slice = parts.items(.dependencies)[package_id];
                        addDependenciesToSet(&set, this.lockfile, dependency_slice);
                    }
                    break;
                }
            }
        }
    }

    return set;
}

fn addDependenciesToSet(
    names: *std.AutoArrayHashMapUnmanaged(TruncatedPackageNameHash, void),
    lockfile: *Lockfile,
    dependencies_slice: Lockfile.DependencySlice,
) void {
    const begin = dependencies_slice.off;
    const end = begin +| dependencies_slice.len;
    var dep_id = begin;
    while (dep_id < end) : (dep_id += 1) {
        const package_id = lockfile.buffers.resolutions.items[dep_id];
        if (package_id == invalid_package_id) continue;

        const dep = lockfile.buffers.dependencies.items[dep_id];
        const entry = bun.handleOom(names.getOrPut(lockfile.allocator, @truncate(dep.name_hash)));
        if (!entry.found_existing) {
            const dependency_slice = lockfile.packages.items(.dependencies)[package_id];
            addDependenciesToSet(names, lockfile, dependency_slice);
        }
    }
}

const string = []const u8;

const std = @import("std");

const bun = @import("bun");
const Environment = bun.Environment;
const Output = bun.Output;
const Path = bun.path;
const Syscall = bun.sys;
const default_allocator = bun.default_allocator;
const Command = bun.cli.Command;

const Semver = bun.Semver;
const String = Semver.String;

const Fs = bun.fs;
const FileSystem = Fs.FileSystem;

const LifecycleScriptSubprocess = bun.install.LifecycleScriptSubprocess;
const PackageID = bun.install.PackageID;
const PackageManager = bun.install.PackageManager;
const PreinstallState = bun.install.PreinstallState;
const TruncatedPackageNameHash = bun.install.TruncatedPackageNameHash;
const invalid_package_id = bun.install.invalid_package_id;

const Lockfile = bun.install.Lockfile;
const Package = Lockfile.Package;
