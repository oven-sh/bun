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

    const envp = try this_transpiler.env.map.createNullDelimitedEnvMap(this.allocator);
    try this_transpiler.env.map.put("PATH", original_path);
    PATH.deinit();

    try LifecycleScriptSubprocess.spawnPackageScripts(this, list, envp, optional, log_level, foreground);
}

// @sortImports

const DirInfo = @import("../../resolver/dir_info.zig");
const std = @import("std");

const bun = @import("bun");
const Environment = bun.Environment;
const Output = bun.Output;
const Path = bun.path;
const Syscall = bun.sys;
const default_allocator = bun.default_allocator;
const string = bun.string;
const strings = bun.strings;
const Command = bun.CLI.Command;

const Semver = bun.Semver;
const String = Semver.String;

const Fs = bun.fs;
const FileSystem = Fs.FileSystem;

const LifecycleScriptSubprocess = bun.install.LifecycleScriptSubprocess;
const PackageID = bun.install.PackageID;
const PackageManager = bun.install.PackageManager;
const PreinstallState = bun.install.PreinstallState;

const Lockfile = bun.install.Lockfile;
const Package = Lockfile.Package;
