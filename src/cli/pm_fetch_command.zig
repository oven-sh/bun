pub const PmFetchCommand = struct {
    pub fn exec(ctx: Command.Context, pm: *PackageManager, original_cwd: []const u8) !void {
        const log_level = pm.options.log_level;

        if (pm.options.shouldPrintCommandName()) {
            Output.prettyln("<r><b>bun pm fetch <r><d>v" ++ Global.package_json_version_with_sha ++ "<r>\n", .{});
            Output.flush();
        }

        // Resolve and download, but never touch node_modules or run scripts.
        pm.options.do.install_packages = false;
        pm.options.do.run_scripts = false;
        pm.options.do.write_package_json = false;
        pm.options.do.summary = false;

        // Resolve dependencies and download any newly-resolved tarballs into the
        // cache. This reuses the standard install pipeline with node_modules
        // installation disabled above.
        try pm.installWithManager(ctx, PackageManager.root_package_json_path, original_cwd);

        if (pm.any_failed_to_install or pm.log.hasErrors()) {
            try pm.log.print(Output.errorWriter());
            Global.exit(1);
        }

        // The resolve phase only prefetches tarballs for packages it *newly* resolved.
        // Packages already resolved in the lockfile need a second pass to ensure
        // they are present in the cache.
        const lockfile = pm.lockfile;
        const string_buf = lockfile.buffers.string_bytes.items;
        const packages = lockfile.packages.slice();
        const names = packages.items(.name);
        const resolutions = packages.items(.resolution);

        // Build a reverse index from package id to a dependency id that
        // resolves to it, preferring required edges over optional ones so
        // download failures on transitively-required packages are errors.
        const dep_ids = dep_ids: {
            const deps = lockfile.buffers.dependencies.items;
            const dep_resolutions = lockfile.buffers.resolutions.items;
            const index = bun.handleOom(pm.allocator.alloc(DependencyID, lockfile.packages.len));
            @memset(index, invalid_dependency_id);
            for (dep_resolutions, 0..) |res_pkg_id, dep_idx| {
                if (res_pkg_id >= lockfile.packages.len) continue;
                const id: DependencyID = @intCast(dep_idx);
                const existing = index[res_pkg_id];
                if (existing == invalid_dependency_id or
                    (!deps[existing].behavior.isRequired() and deps[id].behavior.isRequired()))
                {
                    index[res_pkg_id] = id;
                }
            }
            break :dep_ids index;
        };
        defer pm.allocator.free(dep_ids);

        var already_cached: u32 = 0;

        _ = pm.getCacheDirectory();
        _ = pm.getTemporaryDirectory();

        for (0..lockfile.packages.len) |i| {
            const pkg_id: PackageID = @intCast(i);
            const resolution = resolutions[pkg_id];

            if (!resolution.tag.canEnqueueInstallTask()) continue;

            const pkg = lockfile.packages.get(pkg_id);

            if (pkg.isDisabled(pm.options.cpu, pm.options.os)) continue;

            var name_and_version_hash: ?u64 = null;
            var patchfile_hash: ?u64 = null;

            switch (pm.determinePreinstallState(pkg, lockfile, &name_and_version_hash, &patchfile_hash)) {
                .done => {
                    already_cached += 1;
                    continue;
                },
                .extract => {},
                .apply_patch => {
                    // The unpatched tarball is already in the cache. `bun pm fetch`
                    // only guarantees tarballs are cached; patches are applied
                    // during `bun install`.
                    already_cached += 1;
                    continue;
                },
                // `.calc_patch_hash` is returned before the cache is checked;
                // in practice pass 1 computes all patch hashes so this should
                // not occur here, but if it does the cache state is unknown.
                .calc_patch_hash,
                .unknown,
                .extracting,
                .calcing_patch_hash,
                .applying_patch,
                => continue,
            }

            const dep_id = dep_ids[pkg_id];
            // Orphaned package, skip it.
            if (dep_id == invalid_dependency_id) continue;

            const dep = lockfile.buffers.dependencies.items[dep_id];
            const task_ctx: TaskCallbackContext = .{ .dependency = dep_id };
            const pkg_name = names[pkg_id].slice(string_buf);

            switch (resolution.tag) {
                .npm => {
                    pm.enqueuePackageForDownload(
                        pkg_name,
                        dep_id,
                        pkg_id,
                        resolution.value.npm.version,
                        resolution.value.npm.url.slice(string_buf),
                        task_ctx,
                        name_and_version_hash,
                    ) catch |err| switch (err) {
                        error.OutOfMemory => bun.outOfMemory(),
                        error.InvalidURL => {
                            reportInvalidURL(pm, dep, pkg_name);
                            continue;
                        },
                    };
                },
                .git => {
                    // The `.git_clone` completion handler in `runTasks.zig`
                    // only schedules a checkout when `Ctx == *PackageInstaller`.
                    // In the resolve-mode callbacks used here it re-resolves
                    // the dependency (finding the existing lockfile package)
                    // and never schedules the checkout, so the cache would
                    // not be populated. Skip `git:` dependencies in this pass;
                    // they are populated during the resolve phase above when
                    // first resolved, and otherwise during `bun install`.
                    continue;
                },
                .github => {
                    const url = pm.allocGitHubURL(&resolution.value.github);
                    defer pm.allocator.free(url);
                    pm.enqueueTarballForDownload(
                        dep_id,
                        pkg_id,
                        url,
                        task_ctx,
                        name_and_version_hash,
                    ) catch |err| switch (err) {
                        error.OutOfMemory => bun.outOfMemory(),
                        error.InvalidURL => {
                            reportInvalidURL(pm, dep, pkg_name);
                            continue;
                        },
                    };
                },
                .local_tarball => {
                    pm.enqueueTarballForReading(
                        dep_id,
                        pkg_id,
                        dep.name.slice(string_buf),
                        &resolution,
                        task_ctx,
                    );
                },
                .remote_tarball => {
                    pm.enqueueTarballForDownload(
                        dep_id,
                        pkg_id,
                        resolution.value.remote_tarball.slice(string_buf),
                        task_ctx,
                        name_and_version_hash,
                    ) catch |err| switch (err) {
                        error.OutOfMemory => bun.outOfMemory(),
                        error.InvalidURL => {
                            reportInvalidURL(pm, dep, pkg_name);
                            continue;
                        },
                    };
                },
                else => continue,
            }
        }

        _ = pm.scheduleTasks();

        if (pm.pendingTaskCount() > 0) {
            if (log_level.showProgress()) {
                pm.startProgressBar();
            } else if (log_level != .silent) {
                Output.prettyErrorln("Fetching packages", .{});
                Output.flush();
            }

            var closure: WaitClosure = .{ .manager = pm };
            pm.sleepUntil(&closure, &WaitClosure.isDone);

            if (log_level.showProgress()) {
                pm.endProgressBar();
            }

            if (closure.err) |err| {
                try pm.log.print(Output.errorWriter());
                return err;
            }
        }

        if (log_level != .silent) {
            try pm.log.print(Output.errorWriter());
        }
        if (pm.log.hasErrors() or pm.any_failed_to_install) {
            Global.exit(1);
        }

        if (log_level != .silent) {
            var cache_dir_buf: bun.PathBuffer = undefined;
            const cache_dir = bun.getFdPath(.fromStdDir(pm.getCacheDirectory()), &cache_dir_buf) catch "";

            const total_fetched = pm.extracted_count;

            if (total_fetched > 0) {
                Output.pretty("<green>Fetched {d} package{s}<r> into cache ", .{
                    total_fetched,
                    if (total_fetched == 1) "" else "s",
                });
            } else if (already_cached > 0) {
                Output.pretty("<green>Done<r>! All {d} package{s} already in cache ", .{
                    already_cached,
                    if (already_cached == 1) "" else "s",
                });
            } else {
                Output.pretty("<green>Done<r>! No packages to fetch ", .{});
            }
            Output.printStartEndStdout(ctx.start_time, std.time.nanoTimestamp());
            Output.pretty("<r>\n", .{});
            if (cache_dir.len > 0) {
                Output.prettyln("<d>Cache: {s}<r>", .{cache_dir});
            }
            Output.flush();
        }
    }

    const WaitClosure = struct {
        manager: *PackageManager,
        err: ?anyerror = null,

        pub fn isDone(closure: *WaitClosure) bool {
            const this = closure.manager;
            this.drainDependencyList();

            this.runTasks(
                *PackageManager,
                this,
                .{
                    .onExtract = {},
                    .onResolve = {},
                    .onPackageManifestError = {},
                    .onPackageDownloadError = {},
                    .progress_bar = true,
                },
                false,
                this.options.log_level,
            ) catch |err| {
                closure.err = err;
                return true;
            };

            return this.pendingTaskCount() == 0;
        }
    };

    fn reportInvalidURL(pm: *PackageManager, dep: Dependency, pkg_name: []const u8) void {
        if (dep.behavior.isRequired()) {
            pm.log.addErrorFmt(
                null,
                bun.logger.Loc.Empty,
                pm.allocator,
                "invalid tarball url for <b>{s}<r>",
                .{pkg_name},
            ) catch bun.outOfMemory();
        } else {
            pm.log.addWarningFmt(
                null,
                bun.logger.Loc.Empty,
                pm.allocator,
                "invalid tarball url for <b>{s}<r>",
                .{pkg_name},
            ) catch bun.outOfMemory();
        }
    }
};

const std = @import("std");

const bun = @import("bun");
const Global = bun.Global;
const Output = bun.Output;
const Command = bun.cli.Command;

const install = bun.install;
const Dependency = install.Dependency;
const DependencyID = install.DependencyID;
const PackageID = install.PackageID;
const PackageManager = install.PackageManager;
const TaskCallbackContext = install.TaskCallbackContext;
const invalid_dependency_id = install.invalid_dependency_id;
