pub const PackageInstaller = struct {
    manager: *PackageManager,
    lockfile: *Lockfile,
    progress: *Progress,

    // relative paths from `next` will be copied into this list.
    node_modules: NodeModulesFolder,

    skip_verify_installed_version_number: bool,
    skip_delete: bool,
    force_install: bool,
    root_node_modules_folder: std.fs.Dir,
    summary: *PackageInstall.Summary,
    options: *const PackageManager.Options,
    metas: []const Lockfile.Package.Meta,
    names: []const String,
    pkg_dependencies: []const Lockfile.DependencySlice,
    pkg_name_hashes: []const PackageNameHash,
    bins: []const Bin,
    resolutions: []Resolution,
    node: *Progress.Node,
    destination_dir_subpath_buf: bun.PathBuffer = undefined,
    folder_path_buf: bun.PathBuffer = undefined,
    successfully_installed: Bitset,
    command_ctx: Command.Context,
    current_tree_id: Lockfile.Tree.Id = Lockfile.Tree.invalid_id,

    // fields used for running lifecycle scripts when it's safe
    //
    /// set of completed tree ids
    completed_trees: Bitset,
    /// the tree ids a tree depends on before it can run the lifecycle scripts of it's immediate dependencies
    tree_ids_to_trees_the_id_depends_on: Bitset.List,
    pending_lifecycle_scripts: std.ArrayListUnmanaged(struct {
        list: Lockfile.Package.Scripts.List,
        tree_id: Lockfile.Tree.Id,
        optional: bool,
    }) = .{},

    trusted_dependencies_from_update_requests: std.AutoArrayHashMapUnmanaged(TruncatedPackageNameHash, void),

    // uses same ids as lockfile.trees
    trees: []TreeContext,

    seen_bin_links: bun.StringHashMap(void),

    const debug = Output.scoped(.PackageInstaller, .hidden);

    pub const NodeModulesFolder = struct {
        tree_id: Lockfile.Tree.Id = 0,
        path: std.array_list.Managed(u8) = std.array_list.Managed(u8).init(bun.default_allocator),

        pub fn deinit(this: *NodeModulesFolder) void {
            this.path.clearAndFree();
        }

        // Since the stack size of these functions are rather large, let's not let them be inlined.
        noinline fn directoryExistsAtWithoutOpeningDirectories(this: *const NodeModulesFolder, root_node_modules_dir: std.fs.Dir, file_path: [:0]const u8) bool {
            var path_buf: bun.PathBuffer = undefined;
            const parts: [2][]const u8 = .{ this.path.items, file_path };
            return bun.sys.directoryExistsAt(.fromStdDir(root_node_modules_dir), bun.path.joinZBuf(&path_buf, &parts, .auto)).unwrapOr(false);
        }

        pub fn directoryExistsAt(this: *const NodeModulesFolder, root_node_modules_dir: std.fs.Dir, file_path: [:0]const u8) bool {
            if (file_path.len + this.path.items.len * 2 < bun.MAX_PATH_BYTES) {
                return this.directoryExistsAtWithoutOpeningDirectories(root_node_modules_dir, file_path);
            }

            const dir = FD.fromStdDir(this.openDir(root_node_modules_dir) catch return false);
            defer dir.close();
            return dir.directoryExistsAt(file_path).unwrapOr(false);
        }

        // Since the stack size of these functions are rather large, let's not let them be inlined.
        noinline fn openFileWithoutOpeningDirectories(this: *const NodeModulesFolder, root_node_modules_dir: std.fs.Dir, file_path: [:0]const u8) bun.sys.Maybe(bun.sys.File) {
            var path_buf: bun.PathBuffer = undefined;
            const parts: [2][]const u8 = .{ this.path.items, file_path };
            return bun.sys.File.openat(.fromStdDir(root_node_modules_dir), bun.path.joinZBuf(&path_buf, &parts, .auto), bun.O.RDONLY, 0);
        }

        pub fn readFile(this: *const NodeModulesFolder, root_node_modules_dir: std.fs.Dir, file_path: [:0]const u8, allocator: std.mem.Allocator) !bun.sys.File.ReadToEndResult {
            const file = try this.openFile(root_node_modules_dir, file_path);
            defer file.close();
            return file.readToEnd(allocator);
        }

        pub fn readSmallFile(this: *const NodeModulesFolder, root_node_modules_dir: std.fs.Dir, file_path: [:0]const u8, allocator: std.mem.Allocator) !bun.sys.File.ReadToEndResult {
            const file = try this.openFile(root_node_modules_dir, file_path);
            defer file.close();
            return file.readToEndSmall(allocator);
        }

        pub fn openFile(this: *const NodeModulesFolder, root_node_modules_dir: std.fs.Dir, file_path: [:0]const u8) !bun.sys.File {
            if (this.path.items.len + file_path.len * 2 < bun.MAX_PATH_BYTES) {
                // If we do not run the risk of ENAMETOOLONG, then let's just avoid opening the extra directories altogether.
                switch (this.openFileWithoutOpeningDirectories(root_node_modules_dir, file_path)) {
                    .err => |e| {
                        switch (e.getErrno()) {
                            // Just incase we're wrong, let's try the fallback
                            .PERM, .ACCES, .INVAL, .NAMETOOLONG => {
                                // Use fallback
                            },
                            else => return e.toZigErr(),
                        }
                    },
                    .result => |file| return file,
                }
            }

            const dir = bun.FD.fromStdDir(try this.openDir(root_node_modules_dir));
            defer dir.close();

            return try bun.sys.File.openat(dir, file_path, bun.O.RDONLY, 0).unwrap();
        }

        pub fn openDir(this: *const NodeModulesFolder, root: std.fs.Dir) !std.fs.Dir {
            if (comptime Environment.isPosix) {
                return (try bun.sys.openat(.fromStdDir(root), &try std.posix.toPosixPath(this.path.items), bun.O.DIRECTORY, 0).unwrap()).stdDir();
            }

            return (try bun.sys.openDirAtWindowsA(.fromStdDir(root), this.path.items, .{
                .can_rename_or_delete = false,
                .read_only = false,
            }).unwrap()).stdDir();
        }

        pub fn makeAndOpenDir(this: *NodeModulesFolder, root: std.fs.Dir) !std.fs.Dir {
            const out = brk: {
                if (comptime Environment.isPosix) {
                    break :brk try root.makeOpenPath(this.path.items, .{ .iterate = true, .access_sub_paths = true });
                }

                break :brk (try bun.sys.openDirAtWindowsA(.fromStdDir(root), this.path.items, .{
                    .can_rename_or_delete = false,
                    .op = .open_or_create,
                    .read_only = false,
                }).unwrap()).stdDir();
            };
            return out;
        }
    };

    pub const TreeContext = struct {
        /// Each tree (other than the root tree) can accumulate packages it cannot install until
        /// each parent tree has installed their packages. We keep arrays of these pending
        /// packages for each tree, and drain them when a tree is completed (each of it's immediate
        /// dependencies are installed).
        ///
        /// Trees are drained breadth first because if the current tree is completed from
        /// the remaining pending installs, then any child tree has a higher chance of
        /// being able to install it's dependencies
        pending_installs: std.ArrayListUnmanaged(DependencyInstallContext) = .{},

        binaries: Bin.PriorityQueue,

        /// Number of installed dependencies. Could be successful or failure.
        install_count: usize = 0,

        pub const Id = Lockfile.Tree.Id;

        pub fn deinit(this: *TreeContext, allocator: std.mem.Allocator) void {
            this.pending_installs.deinit(allocator);
            this.binaries.deinit();
        }
    };

    pub const LazyPackageDestinationDir = union(enum) {
        dir: std.fs.Dir,
        node_modules_path: struct {
            node_modules: *NodeModulesFolder,
            root_node_modules_dir: std.fs.Dir,
        },
        closed: void,

        pub fn getDir(this: *LazyPackageDestinationDir) !std.fs.Dir {
            return switch (this.*) {
                .dir => |dir| dir,
                .node_modules_path => |lazy| brk: {
                    const dir = try lazy.node_modules.openDir(lazy.root_node_modules_dir);
                    this.* = .{ .dir = dir };
                    break :brk dir;
                },
                .closed => @panic("LazyPackageDestinationDir is closed! This should never happen. Why did this happen?! It's not your fault. Its our fault. We're sorry."),
            };
        }

        pub fn close(this: *LazyPackageDestinationDir) void {
            switch (this.*) {
                .dir => {
                    if (this.dir.fd != std.fs.cwd().fd) {
                        this.dir.close();
                    }
                },
                .node_modules_path, .closed => {},
            }

            this.* = .{ .closed = {} };
        }
    };

    /// Increments the number of installed packages for a tree id and runs available scripts
    /// if the tree is finished.
    pub fn incrementTreeInstallCount(
        this: *PackageInstaller,
        tree_id: Lockfile.Tree.Id,
        comptime should_install_packages: bool,
        log_level: Options.LogLevel,
    ) void {
        if (comptime Environment.allow_assert) {
            bun.assertWithLocation(tree_id != Lockfile.Tree.invalid_id, @src());
        }

        const tree = &this.trees[tree_id];
        const current_count = tree.install_count;
        const max = this.lockfile.buffers.trees.items[tree_id].dependencies.len;

        if (current_count == std.math.maxInt(usize)) {
            if (comptime Environment.allow_assert)
                Output.panic("Installed more packages than expected for tree id: {d}. Expected: {d}", .{ tree_id, max });

            return;
        }

        const is_not_done = current_count + 1 < max;

        this.trees[tree_id].install_count = if (is_not_done) current_count + 1 else std.math.maxInt(usize);

        if (is_not_done) return;

        this.completed_trees.set(tree_id);

        if (tree.binaries.count() > 0) {
            this.seen_bin_links.clearRetainingCapacity();

            var link_target_buf: bun.PathBuffer = undefined;
            var link_dest_buf: bun.PathBuffer = undefined;
            var link_rel_buf: bun.PathBuffer = undefined;
            this.linkTreeBins(tree, tree_id, &link_target_buf, &link_dest_buf, &link_rel_buf, log_level);
        }

        if (comptime should_install_packages) {
            const force = false;
            this.installAvailablePackages(log_level, force);
        }
        this.runAvailableScripts(log_level);
    }

    pub fn linkTreeBins(
        this: *PackageInstaller,
        tree: *TreeContext,
        tree_id: TreeContext.Id,
        link_target_buf: []u8,
        link_dest_buf: []u8,
        link_rel_buf: []u8,
        log_level: Options.LogLevel,
    ) void {
        const lockfile = this.lockfile;
        const manager = this.manager;
        const string_buf = lockfile.buffers.string_bytes.items;
        var node_modules_path: bun.AbsPath(.{}) = .from(this.node_modules.path.items);
        defer node_modules_path.deinit();

        const pkgs = lockfile.packages.slice();
        const pkg_name_hashes = pkgs.items(.name_hash);
        const pkg_metas = pkgs.items(.meta);
        const pkg_resolutions_lists = pkgs.items(.resolutions);
        const pkg_resolutions_buffer = lockfile.buffers.resolutions.items;
        const pkg_names = pkgs.items(.name);

        while (tree.binaries.removeOrNull()) |dep_id| {
            bun.assertWithLocation(dep_id < lockfile.buffers.dependencies.items.len, @src());
            const package_id = lockfile.buffers.resolutions.items[dep_id];
            bun.assertWithLocation(package_id != invalid_package_id, @src());
            const bin = this.bins[package_id];
            bun.assertWithLocation(bin.tag != .none, @src());

            const alias = lockfile.buffers.dependencies.items[dep_id].name.slice(string_buf);
            const package_name_ = strings.StringOrTinyString.init(alias);
            var target_package_name = package_name_;
            var can_retry_without_native_binlink_optimization = false;
            var target_node_modules_path_opt: ?bun.AbsPath(.{}) = null;
            defer if (target_node_modules_path_opt) |*path| path.deinit();

            if (manager.postinstall_optimizer.isNativeBinlinkEnabled()) native_binlink_optimization: {
                // Check for native binlink optimization
                const name_hash = pkg_name_hashes[package_id];
                if (manager.postinstall_optimizer.get(.{ .name_hash = name_hash })) |optimizer| {
                    switch (optimizer) {
                        .native_binlink => {
                            const target_cpu = manager.options.cpu;
                            const target_os = manager.options.os;
                            if (PostinstallOptimizer.getNativeBinlinkReplacementPackageID(
                                pkg_resolutions_lists[package_id].get(pkg_resolutions_buffer),
                                pkg_metas,
                                target_cpu,
                                target_os,
                            )) |replacement_pkg_id| {
                                if (tree_id != 0) {
                                    // TODO: support this optimization in nested node_modules
                                    // It's tricky to get the hoisting right.
                                    // So we leave this out for now.
                                    break :native_binlink_optimization;
                                }

                                const replacement_name = pkg_names[replacement_pkg_id].slice(string_buf);
                                target_package_name = strings.StringOrTinyString.init(replacement_name);
                                can_retry_without_native_binlink_optimization = true;
                            }
                        },
                        .ignore => {},
                    }
                }
            }
            // globally linked packages shouls always belong to the root
            // tree (0).
            const global = if (!manager.options.global)
                false
            else if (tree_id != 0)
                false
            else global: {
                for (manager.update_requests) |request| {
                    if (request.package_id == package_id) {
                        break :global true;
                    }
                }

                break :global false;
            };

            while (true) {
                var bin_linker: Bin.Linker = .{
                    .bin = bin,
                    .global_bin_path = this.options.bin_path,
                    .package_name = package_name_,
                    .target_package_name = target_package_name,
                    .string_buf = string_buf,
                    .extern_string_buf = lockfile.buffers.extern_strings.items,
                    .seen = &this.seen_bin_links,
                    .node_modules_path = &node_modules_path,
                    .target_node_modules_path = if (target_node_modules_path_opt) |*path| path else &node_modules_path,
                    .abs_target_buf = link_target_buf,
                    .abs_dest_buf = link_dest_buf,
                    .rel_buf = link_rel_buf,
                };

                bin_linker.link(global);

                if (can_retry_without_native_binlink_optimization and (bin_linker.skipped_due_to_missing_bin or bin_linker.err != null)) {
                    can_retry_without_native_binlink_optimization = false;
                    if (PackageManager.verbose_install) {
                        Output.prettyErrorln("<d>[Bin Linker]<r> {s} -> {s} retrying without native bin link", .{
                            package_name_.slice(),
                            target_package_name.slice(),
                        });
                    }
                    target_package_name = package_name_;
                    continue;
                }

                if (bin_linker.err) |err| {
                    if (log_level != .silent) {
                        manager.log.addErrorFmtOpts(
                            manager.allocator,
                            "Failed to link <b>{s}<r>: {s}",
                            .{ alias, @errorName(err) },
                            .{},
                        ) catch |e| bun.handleOom(e);
                    }

                    if (this.options.enable.fail_early) {
                        manager.crash();
                    }
                }

                break;
            }
        }
    }

    pub fn linkRemainingBins(this: *PackageInstaller, log_level: Options.LogLevel) void {
        var depth_buf: Lockfile.Tree.DepthBuf = undefined;
        var node_modules_rel_path_buf: bun.PathBuffer = undefined;
        @memcpy(node_modules_rel_path_buf[0.."node_modules".len], "node_modules");

        var link_target_buf: bun.PathBuffer = undefined;
        var link_dest_buf: bun.PathBuffer = undefined;
        var link_rel_buf: bun.PathBuffer = undefined;
        const lockfile = this.lockfile;

        for (this.trees, 0..) |*tree, tree_id| {
            if (tree.binaries.count() > 0) {
                this.seen_bin_links.clearRetainingCapacity();
                this.node_modules.path.items.len = strings.withoutTrailingSlash(FileSystem.instance.top_level_dir).len + 1;
                const rel_path, _ = Lockfile.Tree.relativePathAndDepth(
                    lockfile,
                    @intCast(tree_id),
                    &node_modules_rel_path_buf,
                    &depth_buf,
                    .node_modules,
                );

                bun.handleOom(this.node_modules.path.appendSlice(rel_path));

                this.linkTreeBins(tree, @intCast(tree_id), &link_target_buf, &link_dest_buf, &link_rel_buf, log_level);
            }
        }
    }

    pub fn runAvailableScripts(this: *PackageInstaller, log_level: Options.LogLevel) void {
        var i: usize = this.pending_lifecycle_scripts.items.len;
        while (i > 0) {
            i -= 1;
            const entry = this.pending_lifecycle_scripts.items[i];
            const name = entry.list.package_name;
            const tree_id = entry.tree_id;
            const optional = entry.optional;
            if (this.canRunScripts(tree_id)) {
                _ = this.pending_lifecycle_scripts.swapRemove(i);
                const output_in_foreground = false;

                this.manager.spawnPackageLifecycleScripts(
                    this.command_ctx,
                    entry.list,
                    optional,
                    output_in_foreground,
                    null,
                ) catch |err| {
                    if (log_level != .silent) {
                        const fmt = "\n<r><red>error:<r> failed to spawn life-cycle scripts for <b>{s}<r>: {s}\n";
                        const args = .{ name, @errorName(err) };

                        if (log_level.showProgress()) {
                            switch (Output.enable_ansi_colors_stderr) {
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

    pub fn installAvailablePackages(this: *PackageInstaller, log_level: Options.LogLevel, comptime force: bool) void {
        const prev_node_modules = this.node_modules;
        defer this.node_modules = prev_node_modules;
        const prev_tree_id = this.current_tree_id;
        defer this.current_tree_id = prev_tree_id;

        const lockfile = this.lockfile;
        const resolutions = lockfile.buffers.resolutions.items;

        for (this.trees, 0..) |*tree, i| {
            if (force or this.canInstallPackageForTree(this.lockfile.buffers.trees.items, @intCast(i))) {
                defer tree.pending_installs.clearRetainingCapacity();

                // If installing these packages completes the tree, we don't allow it
                // to call `installAvailablePackages` recursively. Starting at id 0 and
                // going up ensures we will reach any trees that will be able to install
                // packages upon completing the current tree
                for (tree.pending_installs.items) |context| {
                    const package_id = resolutions[context.dependency_id];
                    const name = this.names[package_id];
                    const resolution = &this.resolutions[package_id];
                    this.node_modules.tree_id = context.tree_id;
                    this.node_modules.path = context.path;
                    this.current_tree_id = context.tree_id;

                    const needs_verify = false;
                    const is_pending_package_install = true;
                    this.installPackageWithNameAndResolution(
                        // This id might be different from the id used to enqueue the task. Important
                        // to use the correct one because the package might be aliased with a different
                        // name
                        context.dependency_id,
                        package_id,
                        log_level,
                        name,
                        resolution,
                        needs_verify,
                        is_pending_package_install,
                    );
                    this.node_modules.deinit();
                }
            }
        }
    }

    pub fn completeRemainingScripts(this: *PackageInstaller, log_level: Options.LogLevel) void {
        for (this.pending_lifecycle_scripts.items) |entry| {
            const package_name = entry.list.package_name;
            // .monotonic is okay because this value isn't modified from any other thread.
            // (Scripts are spawned on this thread.)
            while (LifecycleScriptSubprocess.alive_count.load(.monotonic) >= this.manager.options.max_concurrent_lifecycle_scripts) {
                this.manager.sleep();
            }

            const optional = entry.optional;
            const output_in_foreground = false;
            this.manager.spawnPackageLifecycleScripts(this.command_ctx, entry.list, optional, output_in_foreground, null) catch |err| {
                if (log_level != .silent) {
                    const fmt = "\n<r><red>error:<r> failed to spawn life-cycle scripts for <b>{s}<r>: {s}\n";
                    const args = .{ package_name, @errorName(err) };

                    if (log_level.showProgress()) {
                        switch (Output.enable_ansi_colors_stderr) {
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

        // .monotonic is okay because this value isn't modified from any other thread.
        while (this.manager.pending_lifecycle_script_tasks.load(.monotonic) > 0) {
            this.manager.reportSlowLifecycleScripts();

            if (log_level.showProgress()) {
                if (this.manager.scripts_node) |scripts_node| {
                    scripts_node.activate();
                    this.manager.progress.refresh();
                }
            }

            this.manager.sleep();
        }
    }

    /// Check if a tree is ready to start running lifecycle scripts
    pub fn canRunScripts(this: *PackageInstaller, scripts_tree_id: Lockfile.Tree.Id) bool {
        const deps = this.tree_ids_to_trees_the_id_depends_on.at(scripts_tree_id);
        // .monotonic is okay because this value isn't modified from any other thread.
        return (deps.subsetOf(this.completed_trees) or
            deps.eql(this.completed_trees)) and
            LifecycleScriptSubprocess.alive_count.load(.monotonic) < this.manager.options.max_concurrent_lifecycle_scripts;
    }

    /// A tree can start installing packages when the parent has installed all its packages. If the parent
    /// isn't finished, we need to wait because it's possible a package installed in this tree will be deleted by the parent.
    pub fn canInstallPackageForTree(this: *const PackageInstaller, trees: []Lockfile.Tree, package_tree_id: Lockfile.Tree.Id) bool {
        var curr_tree_id = trees[package_tree_id].parent;
        while (curr_tree_id != Lockfile.Tree.invalid_id) {
            if (!this.completed_trees.isSet(curr_tree_id)) return false;
            curr_tree_id = trees[curr_tree_id].parent;
        }

        return true;
    }

    pub fn deinit(this: *PackageInstaller) void {
        const allocator = this.manager.allocator;
        this.pending_lifecycle_scripts.deinit(this.manager.allocator);
        this.completed_trees.deinit(allocator);
        for (this.trees) |*node| {
            node.deinit(allocator);
        }
        allocator.free(this.trees);
        this.tree_ids_to_trees_the_id_depends_on.deinit(allocator);
        this.node_modules.deinit();
        this.trusted_dependencies_from_update_requests.deinit(allocator);
    }

    /// Call when you mutate the length of `lockfile.packages`
    pub fn fixCachedLockfilePackageSlices(this: *PackageInstaller) void {
        var packages = this.lockfile.packages.slice();
        this.metas = packages.items(.meta);
        this.names = packages.items(.name);
        this.pkg_name_hashes = packages.items(.name_hash);
        this.bins = packages.items(.bin);
        this.resolutions = packages.items(.resolution);
        this.pkg_dependencies = packages.items(.dependencies);

        // fixes an assertion failure where a transitive dependency is a git dependency newly added to the lockfile after the list of dependencies has been resized
        // this assertion failure would also only happen after the lockfile has been written to disk and the summary is being printed.
        if (this.successfully_installed.bit_length < this.lockfile.packages.len) {
            const new = bun.handleOom(Bitset.initEmpty(bun.default_allocator, this.lockfile.packages.len));
            var old = this.successfully_installed;
            defer old.deinit(bun.default_allocator);
            old.copyInto(new);
            this.successfully_installed = new;
        }
    }

    /// Install versions of a package which are waiting on a network request
    pub fn installEnqueuedPackagesAfterExtraction(
        this: *PackageInstaller,
        task_id: Task.Id,
        dependency_id: DependencyID,
        data: *const ExtractData,
        log_level: Options.LogLevel,
    ) void {
        const package_id = this.lockfile.buffers.resolutions.items[dependency_id];
        const name = this.names[package_id];

        // const resolution = &this.resolutions[package_id];
        // const task_id = switch (resolution.tag) {
        //     .git => Task.Id.forGitCheckout(data.url, data.resolved),
        //     .github => Task.Id.forTarball(data.url),
        //     .local_tarball => Task.Id.forTarball(this.lockfile.str(&resolution.value.local_tarball)),
        //     .remote_tarball => Task.Id.forTarball(this.lockfile.str(&resolution.value.remote_tarball)),
        //     .npm => Task.Id.forNPMPackage(name.slice(this.lockfile.buffers.string_bytes.items), resolution.value.npm.version),
        //     else => unreachable,
        // };

        if (this.manager.task_queue.fetchRemove(task_id)) |removed| {
            var callbacks = removed.value;
            defer callbacks.deinit(this.manager.allocator);

            const prev_node_modules = this.node_modules;
            defer this.node_modules = prev_node_modules;
            const prev_tree_id = this.current_tree_id;
            defer this.current_tree_id = prev_tree_id;

            if (callbacks.items.len == 0) {
                debug("Unexpected state: no callbacks for async task.", .{});
                return;
            }

            for (callbacks.items) |*cb| {
                const context = cb.dependency_install_context;
                const callback_package_id = this.lockfile.buffers.resolutions.items[context.dependency_id];
                const callback_resolution = &this.resolutions[callback_package_id];
                this.node_modules.tree_id = context.tree_id;
                this.node_modules.path = context.path;
                this.current_tree_id = context.tree_id;
                const needs_verify = false;
                const is_pending_package_install = false;
                this.installPackageWithNameAndResolution(
                    // This id might be different from the id used to enqueue the task. Important
                    // to use the correct one because the package might be aliased with a different
                    // name
                    context.dependency_id,
                    callback_package_id,
                    log_level,
                    name,
                    callback_resolution,
                    needs_verify,
                    is_pending_package_install,
                );
                this.node_modules.deinit();
            }
            return;
        }

        if (comptime Environment.allow_assert) {
            Output.panic("Ran callback to install enqueued packages, but there was no task associated with it. {f}:{f} (dependency_id: {d})", .{
                bun.fmt.quote(name.slice(this.lockfile.buffers.string_bytes.items)),
                bun.fmt.quote(data.url),
                dependency_id,
            });
        }
    }

    fn getInstalledPackageScriptsCount(
        this: *PackageInstaller,
        alias: string,
        package_id: PackageID,
        resolution_tag: Resolution.Tag,
        folder_path: *bun.AbsPath(.{ .sep = .auto }),
        log_level: Options.LogLevel,
    ) usize {
        if (comptime Environment.allow_assert) {
            bun.assertWithLocation(resolution_tag != .root, @src());
            bun.assertWithLocation(resolution_tag != .workspace, @src());
            bun.assertWithLocation(package_id != 0, @src());
        }
        var count: usize = 0;
        const scripts = brk: {
            const scripts = this.lockfile.packages.items(.scripts)[package_id];
            if (scripts.filled) break :brk scripts;

            var temp: Package.Scripts = .{};
            var temp_lockfile: Lockfile = undefined;
            temp_lockfile.initEmpty(this.lockfile.allocator);
            defer temp_lockfile.deinit();
            var string_builder = temp_lockfile.stringBuilder();
            temp.fillFromPackageJSON(
                this.lockfile.allocator,
                &string_builder,
                this.manager.log,
                folder_path,
            ) catch |err| {
                if (log_level != .silent) {
                    Output.errGeneric("failed to fill lifecycle scripts for <b>{s}<r>: {s}", .{
                        alias,
                        @errorName(err),
                    });
                }

                if (this.manager.options.enable.fail_early) {
                    Global.crash();
                }

                return 0;
            };
            break :brk temp;
        };

        if (comptime Environment.allow_assert) {
            bun.assertWithLocation(scripts.filled, @src());
        }

        switch (resolution_tag) {
            .git, .github, .root => {
                inline for (Lockfile.Scripts.names) |script_name| {
                    count += @intFromBool(!@field(scripts, script_name).isEmpty());
                }
            },
            else => {
                const install_script_names = .{
                    "preinstall",
                    "install",
                    "postinstall",
                };
                inline for (install_script_names) |script_name| {
                    count += @intFromBool(!@field(scripts, script_name).isEmpty());
                }
            },
        }

        if (scripts.preinstall.isEmpty() and scripts.install.isEmpty()) {
            const binding_dot_gyp_path = Path.joinAbsStringZ(
                this.node_modules.path.items,
                &[_]string{
                    alias,
                    "binding.gyp",
                },
                .auto,
            );
            count += @intFromBool(Syscall.exists(binding_dot_gyp_path));
        }

        return count;
    }

    fn getPatchfileHash(patchfile_path: []const u8) ?u64 {
        _ = patchfile_path; // autofix
    }

    pub fn installPackageWithNameAndResolution(
        this: *PackageInstaller,
        dependency_id: DependencyID,
        package_id: PackageID,
        log_level: Options.LogLevel,
        pkg_name: String,
        resolution: *const Resolution,

        // false when coming from download. if the package was downloaded
        // it was already determined to need an install
        comptime needs_verify: bool,

        // we don't want to allow more package installs through
        // pending packages if we're already draining them.
        comptime is_pending_package_install: bool,
    ) void {
        const alias = this.lockfile.buffers.dependencies.items[dependency_id].name;
        const destination_dir_subpath: [:0]u8 = brk: {
            const alias_slice = alias.slice(this.lockfile.buffers.string_bytes.items);
            bun.copy(u8, &this.destination_dir_subpath_buf, alias_slice);
            this.destination_dir_subpath_buf[alias_slice.len] = 0;
            break :brk this.destination_dir_subpath_buf[0..alias_slice.len :0];
        };

        const pkg_name_hash = this.pkg_name_hashes[package_id];

        var resolution_buf: [512]u8 = undefined;
        const package_version = if (resolution.tag == .workspace) brk: {
            if (this.manager.lockfile.workspace_versions.get(pkg_name_hash)) |workspace_version| {
                break :brk std.fmt.bufPrint(&resolution_buf, "{f}", .{workspace_version.fmt(this.lockfile.buffers.string_bytes.items)}) catch unreachable;
            }

            // no version
            break :brk "";
        } else std.fmt.bufPrint(&resolution_buf, "{f}", .{resolution.fmt(this.lockfile.buffers.string_bytes.items, .posix)}) catch unreachable;

        const patch_patch, const patch_contents_hash, const patch_name_and_version_hash, const remove_patch = brk: {
            if (this.manager.lockfile.patched_dependencies.entries.len == 0 and this.manager.patched_dependencies_to_remove.entries.len == 0) break :brk .{ null, null, null, false };
            var sfa = std.heap.stackFallback(1024, this.lockfile.allocator);
            const alloc = sfa.get();
            const name_and_version = std.fmt.allocPrint(alloc, "{s}@{s}", .{
                pkg_name.slice(this.lockfile.buffers.string_bytes.items),
                package_version,
            }) catch unreachable;
            defer alloc.free(name_and_version);

            const name_and_version_hash = String.Builder.stringHash(name_and_version);

            const patchdep = this.lockfile.patched_dependencies.get(name_and_version_hash) orelse {
                const to_remove = this.manager.patched_dependencies_to_remove.contains(name_and_version_hash);
                if (to_remove) {
                    break :brk .{
                        null,
                        null,
                        name_and_version_hash,
                        true,
                    };
                }
                break :brk .{ null, null, null, false };
            };
            bun.assert(!patchdep.patchfile_hash_is_null);
            // if (!patchdep.patchfile_hash_is_null) {
            //     this.manager.enqueuePatchTask(PatchTask.newCalcPatchHash(this, package_id, name_and_version_hash, dependency_id, url: string))
            // }
            break :brk .{
                patchdep.path.slice(this.lockfile.buffers.string_bytes.items),
                patchdep.patchfileHash().?,
                name_and_version_hash,
                false,
            };
        };

        var installer = PackageInstall{
            .progress = if (this.manager.options.log_level.showProgress()) this.progress else null,
            .cache_dir = undefined,
            .destination_dir_subpath = destination_dir_subpath,
            .destination_dir_subpath_buf = &this.destination_dir_subpath_buf,
            .allocator = this.lockfile.allocator,
            .package_name = pkg_name,
            .patch = if (patch_patch) |p| .{
                .contents_hash = patch_contents_hash.?,
                .path = p,
            } else null,
            .package_version = package_version,
            .node_modules = &this.node_modules,
            .lockfile = this.lockfile,
        };
        debug("Installing {s}@{f}", .{
            pkg_name.slice(this.lockfile.buffers.string_bytes.items),
            resolution.fmt(this.lockfile.buffers.string_bytes.items, .posix),
        });

        switch (resolution.tag) {
            .npm => {
                installer.cache_dir_subpath = this.manager.cachedNPMPackageFolderName(
                    pkg_name.slice(this.lockfile.buffers.string_bytes.items),
                    resolution.value.npm.version,
                    patch_contents_hash,
                );
                installer.cache_dir = this.manager.getCacheDirectory();
            },
            .git => {
                installer.cache_dir_subpath = this.manager.cachedGitFolderName(&resolution.value.git, patch_contents_hash);
                installer.cache_dir = this.manager.getCacheDirectory();
            },
            .github => {
                installer.cache_dir_subpath = this.manager.cachedGitHubFolderName(&resolution.value.github, patch_contents_hash);
                installer.cache_dir = this.manager.getCacheDirectory();
            },
            .folder => {
                const folder = resolution.value.folder.slice(this.lockfile.buffers.string_bytes.items);

                if (this.lockfile.isWorkspaceTreeId(this.current_tree_id)) {
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
                } else {
                    // transitive folder dependencies are relative to their parent. they are not hoisted
                    @memcpy(this.folder_path_buf[0..folder.len], folder);
                    this.folder_path_buf[folder.len] = 0;
                    installer.cache_dir_subpath = this.folder_path_buf[0..folder.len :0];

                    // cache_dir might not be created yet (if it's in node_modules)
                    installer.cache_dir = std.fs.cwd();
                }
            },
            .local_tarball => {
                installer.cache_dir_subpath = this.manager.cachedTarballFolderName(resolution.value.local_tarball, patch_contents_hash);
                installer.cache_dir = this.manager.getCacheDirectory();
            },
            .remote_tarball => {
                installer.cache_dir_subpath = this.manager.cachedTarballFolderName(resolution.value.remote_tarball, patch_contents_hash);
                installer.cache_dir = this.manager.getCacheDirectory();
            },
            .workspace => {
                const folder = resolution.value.workspace.slice(this.lockfile.buffers.string_bytes.items);
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
            .root => {
                installer.cache_dir_subpath = ".";
                installer.cache_dir = std.fs.cwd();
            },
            .symlink => {
                const directory = this.manager.globalLinkDir();

                const folder = resolution.value.symlink.slice(this.lockfile.buffers.string_bytes.items);

                if (folder.len == 0 or (folder.len == 1 and folder[0] == '.')) {
                    installer.cache_dir_subpath = ".";
                    installer.cache_dir = std.fs.cwd();
                } else {
                    const global_link_dir = this.manager.globalLinkDirPath();
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
            else => {
                if (comptime Environment.allow_assert) {
                    @panic("Internal assertion failure: unexpected resolution tag");
                }
                this.incrementTreeInstallCount(this.current_tree_id, !is_pending_package_install, log_level);
                return;
            },
        }

        const needs_install = this.force_install or this.skip_verify_installed_version_number or !needs_verify or remove_patch or !installer.verify(
            resolution,
            this.root_node_modules_folder,
        );
        this.summary.skipped += @intFromBool(!needs_install);

        if (needs_install) {
            if (resolution.tag.canEnqueueInstallTask() and installer.packageMissingFromCache(this.manager, package_id, resolution.tag)) {
                if (comptime Environment.allow_assert) {
                    bun.assertWithLocation(resolution.canEnqueueInstallTask(), @src());
                }

                const context: TaskCallbackContext = .{
                    .dependency_install_context = .{
                        .tree_id = this.current_tree_id,
                        .path = bun.handleOom(this.node_modules.path.clone()),
                        .dependency_id = dependency_id,
                    },
                };
                switch (resolution.tag) {
                    .git => {
                        this.manager.enqueueGitForCheckout(
                            dependency_id,
                            alias.slice(this.lockfile.buffers.string_bytes.items),
                            resolution,
                            context,
                            patch_name_and_version_hash,
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
                            patch_name_and_version_hash,
                        ) catch |err| switch (err) {
                            error.OutOfMemory => bun.outOfMemory(),
                            error.InvalidURL => this.failWithInvalidUrl(
                                is_pending_package_install,
                                log_level,
                            ),
                        };
                    },
                    .local_tarball => {
                        this.manager.enqueueTarballForReading(
                            dependency_id,
                            alias.slice(this.lockfile.buffers.string_bytes.items),
                            resolution,
                            context,
                        );
                    },
                    .remote_tarball => {
                        this.manager.enqueueTarballForDownload(
                            dependency_id,
                            package_id,
                            resolution.value.remote_tarball.slice(this.lockfile.buffers.string_bytes.items),
                            context,
                            patch_name_and_version_hash,
                        ) catch |err| switch (err) {
                            error.OutOfMemory => bun.outOfMemory(),
                            error.InvalidURL => this.failWithInvalidUrl(
                                is_pending_package_install,
                                log_level,
                            ),
                        };
                    },
                    .npm => {
                        if (comptime Environment.isDebug) {
                            // Very old versions of Bun didn't store the tarball url when it didn't seem necessary
                            // This caused bugs. We can't assert on it because they could come from old lockfiles
                            if (resolution.value.npm.url.isEmpty()) {
                                Output.debugWarn("package {s}@{f} missing tarball_url", .{
                                    pkg_name.slice(this.lockfile.buffers.string_bytes.items),
                                    resolution.fmt(this.lockfile.buffers.string_bytes.items, .posix),
                                });
                            }
                        }

                        this.manager.enqueuePackageForDownload(
                            pkg_name.slice(this.lockfile.buffers.string_bytes.items),
                            dependency_id,
                            package_id,
                            resolution.value.npm.version,
                            resolution.value.npm.url.slice(this.lockfile.buffers.string_bytes.items),
                            context,
                            patch_name_and_version_hash,
                        ) catch |err| switch (err) {
                            error.OutOfMemory => bun.outOfMemory(),
                            error.InvalidURL => this.failWithInvalidUrl(
                                is_pending_package_install,
                                log_level,
                            ),
                        };
                    },
                    else => {
                        if (comptime Environment.allow_assert) {
                            @panic("unreachable, handled above");
                        }
                        this.incrementTreeInstallCount(this.current_tree_id, !is_pending_package_install, log_level);
                        this.summary.fail += 1;
                    },
                }

                return;
            }

            // above checks if unpatched package is in cache, if not null apply patch in temp directory, copy
            // into cache, then install into node_modules
            if (installer.patch) |patch| {
                if (installer.patchedPackageMissingFromCache(this.manager, package_id)) {
                    const task = PatchTask.newApplyPatchHash(
                        this.manager,
                        package_id,
                        patch.contents_hash,
                        patch_name_and_version_hash.?,
                    );
                    task.callback.apply.install_context = .{
                        .dependency_id = dependency_id,
                        .tree_id = this.current_tree_id,
                        .path = bun.handleOom(this.node_modules.path.clone()),
                    };
                    this.manager.enqueuePatchTask(task);
                    return;
                }
            }

            if (!is_pending_package_install and !this.canInstallPackageForTree(this.lockfile.buffers.trees.items, this.current_tree_id)) {
                this.trees[this.current_tree_id].pending_installs.append(this.manager.allocator, .{
                    .dependency_id = dependency_id,
                    .tree_id = this.current_tree_id,
                    .path = bun.handleOom(this.node_modules.path.clone()),
                }) catch |err| bun.handleOom(err);
                return;
            }

            // creating this directory now, right before installing package
            var destination_dir = this.node_modules.makeAndOpenDir(this.root_node_modules_folder) catch |err| {
                if (log_level != .silent) {
                    Output.err(err, "Failed to open node_modules folder for <r><red>{s}<r> in {f}", .{
                        pkg_name.slice(this.lockfile.buffers.string_bytes.items),
                        bun.fmt.fmtPath(u8, this.node_modules.path.items, .{}),
                    });
                }
                this.summary.fail += 1;
                this.incrementTreeInstallCount(this.current_tree_id, !is_pending_package_install, log_level);
                return;
            };

            defer {
                if (std.fs.cwd().fd != destination_dir.fd) destination_dir.close();
            }

            var lazy_package_dir: LazyPackageDestinationDir = .{ .dir = destination_dir };

            const install_result: PackageInstall.Result = switch (resolution.tag) {
                .symlink, .workspace => installer.installFromLink(this.skip_delete, destination_dir),
                else => result: {
                    if (resolution.tag == .root or (resolution.tag == .folder and !this.lockfile.isWorkspaceTreeId(this.current_tree_id))) {
                        // This is a transitive folder dependency. It is installed with a single symlink to the target folder/file,
                        // and is not hoisted.
                        const dirname = std.fs.path.dirname(this.node_modules.path.items) orelse this.node_modules.path.items;

                        installer.cache_dir = this.root_node_modules_folder.openDir(dirname, .{ .iterate = true, .access_sub_paths = true }) catch |err|
                            break :result .fail(err, .opening_cache_dir, @errorReturnTrace());

                        const result = if (resolution.tag == .root)
                            installer.installFromLink(this.skip_delete, destination_dir)
                        else
                            installer.install(this.skip_delete, destination_dir, installer.getInstallMethod(), resolution.tag);

                        if (result.isFail() and (result.failure.err == error.ENOENT or result.failure.err == error.FileNotFound))
                            break :result .success;

                        break :result result;
                    }

                    break :result installer.install(this.skip_delete, destination_dir, installer.getInstallMethod(), resolution.tag);
                },
            };

            switch (install_result) {
                .success => {
                    const is_duplicate = this.successfully_installed.isSet(package_id);
                    this.summary.success += @as(u32, @intFromBool(!is_duplicate));
                    this.successfully_installed.set(package_id);

                    if (log_level.showProgress()) {
                        this.node.completeOne();
                    }

                    if (this.bins[package_id].tag != .none) {
                        bun.handleOom(this.trees[this.current_tree_id].binaries.add(dependency_id));
                    }

                    const dep = this.lockfile.buffers.dependencies.items[dependency_id];
                    const truncated_dep_name_hash: TruncatedPackageNameHash = @truncate(dep.name_hash);
                    const is_trusted, const is_trusted_through_update_request = brk: {
                        if (this.trusted_dependencies_from_update_requests.contains(truncated_dep_name_hash)) break :brk .{ true, true };
                        if (this.lockfile.hasTrustedDependency(alias.slice(this.lockfile.buffers.string_bytes.items), resolution)) break :brk .{ true, false };
                        break :brk .{ false, false };
                    };

                    if (resolution.tag != .root and (resolution.tag == .workspace or is_trusted)) {
                        var folder_path: bun.AbsPath(.{ .sep = .auto }) = .from(this.node_modules.path.items);
                        defer folder_path.deinit();
                        folder_path.append(alias.slice(this.lockfile.buffers.string_bytes.items));

                        enqueueLifecycleScripts: {
                            if (this.manager.postinstall_optimizer.shouldIgnoreLifecycleScripts(
                                .{
                                    .name_hash = pkg_name_hash,
                                    .version = if (resolution.tag == .npm) resolution.value.npm.version else null,
                                    .version_buf = this.lockfile.buffers.string_bytes.items,
                                },
                                this.lockfile.packages.items(.resolutions)[package_id].get(this.lockfile.buffers.resolutions.items),
                                this.lockfile.packages.items(.meta),
                                this.manager.options.cpu,
                                this.manager.options.os,
                                this.current_tree_id,
                            )) {
                                if (PackageManager.verbose_install) {
                                    Output.prettyErrorln("<d>[Lifecycle Scripts]<r> ignoring {s} lifecycle scripts", .{
                                        pkg_name.slice(this.lockfile.buffers.string_bytes.items),
                                    });
                                }
                                break :enqueueLifecycleScripts;
                            }

                            if (this.enqueueLifecycleScripts(
                                alias.slice(this.lockfile.buffers.string_bytes.items),
                                log_level,
                                &folder_path,
                                package_id,
                                dep.behavior.optional,
                                resolution,
                            )) {
                                if (is_trusted_through_update_request) {
                                    this.manager.trusted_deps_to_add_to_package_json.append(
                                        this.manager.allocator,
                                        bun.handleOom(this.manager.allocator.dupe(u8, alias.slice(this.lockfile.buffers.string_bytes.items))),
                                    ) catch |err| bun.handleOom(err);

                                    if (this.lockfile.trusted_dependencies == null) this.lockfile.trusted_dependencies = .{};
                                    this.lockfile.trusted_dependencies.?.put(this.manager.allocator, truncated_dep_name_hash, {}) catch |err| bun.handleOom(err);
                                }
                            }
                        }
                    }

                    switch (resolution.tag) {
                        .root, .workspace => {
                            // these will never be blocked
                        },
                        else => if (!is_trusted and this.metas[package_id].hasInstallScript()) {
                            // Check if the package actually has scripts. `hasInstallScript` can be false positive if a package is published with
                            // an auto binding.gyp rebuild script but binding.gyp is excluded from the published files.
                            var folder_path: bun.AbsPath(.{ .sep = .auto }) = .from(this.node_modules.path.items);
                            defer folder_path.deinit();
                            folder_path.append(alias.slice(this.lockfile.buffers.string_bytes.items));

                            const count = this.getInstalledPackageScriptsCount(
                                alias.slice(this.lockfile.buffers.string_bytes.items),
                                package_id,
                                resolution.tag,
                                &folder_path,
                                log_level,
                            );
                            if (count > 0) {
                                if (log_level.isVerbose()) {
                                    Output.prettyError("Blocked {d} scripts for: {s}@{f}\n", .{
                                        count,
                                        alias.slice(this.lockfile.buffers.string_bytes.items),
                                        resolution.fmt(this.lockfile.buffers.string_bytes.items, .posix),
                                    });
                                }
                                const entry = bun.handleOom(this.summary.packages_with_blocked_scripts.getOrPut(this.manager.allocator, truncated_dep_name_hash));
                                if (!entry.found_existing) entry.value_ptr.* = 0;
                                entry.value_ptr.* += count;
                            }
                        },
                    }

                    this.incrementTreeInstallCount(this.current_tree_id, !is_pending_package_install, log_level);
                },
                .failure => |cause| {
                    if (comptime Environment.allow_assert) {
                        bun.assert(!cause.isPackageMissingFromCache() or (resolution.tag != .symlink and resolution.tag != .workspace));
                    }

                    // even if the package failed to install, we still need to increment the install
                    // counter for this tree
                    this.incrementTreeInstallCount(this.current_tree_id, !is_pending_package_install, log_level);

                    if (cause.err == error.DanglingSymlink) {
                        Output.prettyErrorln(
                            "<r><red>error<r>: <b>{s}<r> \"link:{s}\" not found (try running 'bun link' in the intended package's folder)<r>",
                            .{ @errorName(cause.err), this.names[package_id].slice(this.lockfile.buffers.string_bytes.items) },
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
                            if (!Environment.isWindows) {
                                const stat = bun.sys.fstat(.fromStdDir(lazy_package_dir.getDir() catch |err| {
                                    Output.err("EACCES", "Permission denied while installing <b>{s}<r>", .{
                                        this.names[package_id].slice(this.lockfile.buffers.string_bytes.items),
                                    });
                                    if (Environment.isDebug) {
                                        Output.err(err, "Failed to stat node_modules", .{});
                                    }
                                    Global.exit(1);
                                })).unwrap() catch |err| {
                                    Output.err("EACCES", "Permission denied while installing <b>{s}<r>", .{
                                        this.names[package_id].slice(this.lockfile.buffers.string_bytes.items),
                                    });
                                    if (Environment.isDebug) {
                                        Output.err(err, "Failed to stat node_modules", .{});
                                    }
                                    Global.exit(1);
                                };

                                const is_writable = if (stat.uid == bun.c.getuid())
                                    stat.mode & bun.S.IWUSR > 0
                                else if (stat.gid == bun.c.getgid())
                                    stat.mode & bun.S.IWGRP > 0
                                else
                                    stat.mode & bun.S.IWOTH > 0;

                                if (!is_writable) {
                                    Output.err("EACCES", "Permission denied while writing packages into node_modules.", .{});
                                    Global.exit(1);
                                }
                            }
                            Singleton.node_modules_is_ok = true;
                        }

                        Output.err("EACCES", "Permission denied while installing <b>{s}<r>", .{
                            this.names[package_id].slice(this.lockfile.buffers.string_bytes.items),
                        });

                        this.summary.fail += 1;
                    } else {
                        Output.err(
                            cause.err,
                            "failed {s} for package <b>{s}<r>",
                            .{
                                install_result.failure.step.name(),
                                this.names[package_id].slice(this.lockfile.buffers.string_bytes.items),
                            },
                        );
                        if (Environment.isDebug) {
                            var t = cause.debug_trace;
                            bun.crash_handler.dumpStackTrace(t.trace(), .{});
                        }
                        this.summary.fail += 1;
                    }
                },
            }
        } else {
            if (this.bins[package_id].tag != .none) {
                bun.handleOom(this.trees[this.current_tree_id].binaries.add(dependency_id));
            }

            var destination_dir: LazyPackageDestinationDir = .{
                .node_modules_path = .{
                    .node_modules = &this.node_modules,
                    .root_node_modules_dir = this.root_node_modules_folder,
                },
            };

            defer {
                destination_dir.close();
            }

            defer this.incrementTreeInstallCount(this.current_tree_id, !is_pending_package_install, log_level);

            const dep = this.lockfile.buffers.dependencies.items[dependency_id];
            const truncated_dep_name_hash: TruncatedPackageNameHash = @truncate(dep.name_hash);
            const is_trusted, const is_trusted_through_update_request, const add_to_lockfile = brk: {
                // trusted through a --trust dependency. need to enqueue scripts, write to package.json, and add to lockfile
                if (this.trusted_dependencies_from_update_requests.contains(truncated_dep_name_hash)) break :brk .{ true, true, true };

                if (this.manager.summary.added_trusted_dependencies.get(truncated_dep_name_hash)) |should_add_to_lockfile| {
                    // is a new trusted dependency. need to enqueue scripts and maybe add to lockfile
                    break :brk .{ true, false, should_add_to_lockfile };
                }
                break :brk .{ false, false, false };
            };

            if (resolution.tag != .root and is_trusted) {
                var folder_path: bun.AbsPath(.{ .sep = .auto }) = .from(this.node_modules.path.items);
                defer folder_path.deinit();
                folder_path.append(alias.slice(this.lockfile.buffers.string_bytes.items));

                enqueueLifecycleScripts: {
                    if (this.manager.postinstall_optimizer.shouldIgnoreLifecycleScripts(
                        .{
                            .name_hash = pkg_name_hash,
                            .version = if (resolution.tag == .npm) resolution.value.npm.version else null,
                            .version_buf = this.lockfile.buffers.string_bytes.items,
                        },
                        this.lockfile.packages.items(.resolutions)[package_id].get(this.lockfile.buffers.resolutions.items),
                        this.lockfile.packages.items(.meta),
                        this.manager.options.cpu,
                        this.manager.options.os,
                        this.current_tree_id,
                    )) {
                        if (PackageManager.verbose_install) {
                            Output.prettyErrorln("<d>[Lifecycle Scripts]<r> ignoring {s} lifecycle scripts", .{
                                pkg_name.slice(this.lockfile.buffers.string_bytes.items),
                            });
                        }
                        break :enqueueLifecycleScripts;
                    }

                    if (this.enqueueLifecycleScripts(
                        alias.slice(this.lockfile.buffers.string_bytes.items),
                        log_level,
                        &folder_path,
                        package_id,
                        dep.behavior.optional,
                        resolution,
                    )) {
                        if (is_trusted_through_update_request) {
                            this.manager.trusted_deps_to_add_to_package_json.append(
                                this.manager.allocator,
                                bun.handleOom(this.manager.allocator.dupe(u8, alias.slice(this.lockfile.buffers.string_bytes.items))),
                            ) catch |err| bun.handleOom(err);
                        }

                        if (add_to_lockfile) {
                            if (this.lockfile.trusted_dependencies == null) this.lockfile.trusted_dependencies = .{};
                            this.lockfile.trusted_dependencies.?.put(this.manager.allocator, truncated_dep_name_hash, {}) catch |err| bun.handleOom(err);
                        }
                    }
                }
            }
        }
    }

    fn failWithInvalidUrl(
        this: *PackageInstaller,
        comptime is_pending_package_install: bool,
        log_level: Options.LogLevel,
    ) void {
        this.summary.fail += 1;
        this.incrementTreeInstallCount(this.current_tree_id, !is_pending_package_install, log_level);
    }

    // returns true if scripts are enqueued
    fn enqueueLifecycleScripts(
        this: *PackageInstaller,
        folder_name: string,
        log_level: Options.LogLevel,
        package_path: *bun.AbsPath(.{ .sep = .auto }),
        package_id: PackageID,
        optional: bool,
        resolution: *const Resolution,
    ) bool {
        var scripts: Package.Scripts = this.lockfile.packages.items(.scripts)[package_id];
        const scripts_list = scripts.getList(
            this.manager.log,
            this.lockfile,
            package_path,
            folder_name,
            resolution,
        ) catch |err| {
            if (log_level != .silent) {
                const fmt = "\n<r><red>error:<r> failed to enqueue lifecycle scripts for <b>{s}<r>: {s}\n";
                const args = .{ folder_name, @errorName(err) };

                if (log_level.showProgress()) {
                    switch (Output.enable_ansi_colors_stderr) {
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
            return false;
        };

        if (scripts_list == null) return false;

        if (this.manager.options.do.run_scripts) {
            this.manager.total_scripts += scripts_list.?.total;
            if (this.manager.scripts_node) |scripts_node| {
                this.manager.setNodeName(
                    scripts_node,
                    scripts_list.?.package_name,
                    PackageManager.ProgressStrings.script_emoji,
                    true,
                );
                scripts_node.setEstimatedTotalItems(scripts_node.unprotected_estimated_total_items + scripts_list.?.total);
            }
            this.pending_lifecycle_scripts.append(this.manager.allocator, .{
                .list = scripts_list.?,
                .tree_id = this.current_tree_id,
                .optional = optional,
            }) catch |err| bun.handleOom(err);

            return true;
        }

        return false;
    }

    pub fn installPackage(
        this: *PackageInstaller,
        dep_id: DependencyID,
        log_level: Options.LogLevel,
    ) void {
        const package_id = this.lockfile.buffers.resolutions.items[dep_id];

        const name = this.names[package_id];
        const resolution = &this.resolutions[package_id];

        const needs_verify = true;
        const is_pending_package_install = false;
        this.installPackageWithNameAndResolution(
            dep_id,
            package_id,
            log_level,
            name,
            resolution,
            needs_verify,
            is_pending_package_install,
        );
    }
};

const string = []const u8;

const std = @import("std");

const bun = @import("bun");
const Environment = bun.Environment;
const FD = bun.FD;
const Global = bun.Global;
const Output = bun.Output;
const Path = bun.path;
const Progress = bun.Progress;
const Syscall = bun.sys;
const strings = bun.strings;
const Bitset = bun.bit_set.DynamicBitSetUnmanaged;
const Command = bun.cli.Command;
const FileSystem = bun.fs.FileSystem;
const String = bun.Semver.String;

const install = bun.install;
const Bin = install.Bin;
const DependencyID = install.DependencyID;
const DependencyInstallContext = install.DependencyInstallContext;
const ExtractData = install.ExtractData;
const LifecycleScriptSubprocess = install.LifecycleScriptSubprocess;
const PackageID = install.PackageID;
const PackageInstall = install.PackageInstall;
const PackageNameHash = install.PackageNameHash;
const PatchTask = install.PatchTask;
const PostinstallOptimizer = install.PostinstallOptimizer;
const Resolution = install.Resolution;
const Task = install.Task;
const TaskCallbackContext = install.TaskCallbackContext;
const TruncatedPackageNameHash = install.TruncatedPackageNameHash;
const invalid_package_id = install.invalid_package_id;

const Lockfile = install.Lockfile;
const Package = Lockfile.Package;

const PackageManager = install.PackageManager;
const Options = PackageManager.Options;
