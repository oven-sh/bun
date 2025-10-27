pub const PackageID = bun.install.PackageID;
pub const DependencyID = bun.install.DependencyID;

pub const Lockfile = @import("./lockfile.zig");
pub const PatchedDep = Lockfile.PatchedDep;

pub const Resolution = @import("./resolution.zig").Resolution;

pub const PackageInstall = bun.install.PackageInstall;

pub const bun_hash_tag = bun.install.bun_hash_tag;
pub const max_hex_hash_len: comptime_int = brk: {
    var buf: [128]u8 = undefined;
    break :brk (std.fmt.bufPrint(buf[0..], "{x}", .{std.math.maxInt(u64)}) catch @panic("Buf wasn't big enough.")).len;
};
pub const max_buntag_hash_buf_len: comptime_int = max_hex_hash_len + bun_hash_tag.len + 1;
pub const BuntagHashBuf = [max_buntag_hash_buf_len]u8;

pub const PatchTask = struct {
    manager: *PackageManager,
    tempdir: std.fs.Dir,
    project_dir: []const u8,
    callback: union(enum) {
        calc_hash: CalcPatchHash,
        apply: ApplyPatch,
    },
    task: ThreadPool.Task = .{
        .callback = runFromThreadPool,
    },
    pre: bool = false,
    next: ?*PatchTask = null,

    const debug = bun.Output.scoped(.InstallPatch, .visible);

    const Maybe = bun.sys.Maybe;

    const CalcPatchHash = struct {
        patchfile_path: []const u8,
        name_and_version_hash: u64,

        state: ?EnqueueAfterState = null,

        result: ?u64 = null,

        logger: logger.Log,

        const EnqueueAfterState = struct {
            pkg_id: PackageID,
            dependency_id: DependencyID,
            url: string,
        };
    };

    const ApplyPatch = struct {
        pkg_id: PackageID,
        patch_hash: u64,
        name_and_version_hash: u64,

        patchfilepath: []const u8,
        pkgname: String,

        cache_dir: std.fs.Dir,
        cache_dir_subpath: stringZ,
        cache_dir_subpath_without_patch_hash: stringZ,

        /// this is non-null if this was called before a Task, for example extracting
        task_id: ?Task.Id = null,
        install_context: ?struct {
            dependency_id: DependencyID,
            tree_id: Lockfile.Tree.Id,
            path: std.array_list.Managed(u8),
        } = null,
        // dependency_id: ?struct = null,

        logger: logger.Log,
    };

    pub fn deinit(this: *PatchTask) void {
        switch (this.callback) {
            .apply => {
                this.manager.allocator.free(this.callback.apply.patchfilepath);
                this.manager.allocator.free(this.callback.apply.cache_dir_subpath);
                if (this.callback.apply.install_context) |ictx| ictx.path.deinit();
                this.callback.apply.logger.deinit();
            },
            .calc_hash => {
                // TODO: how to deinit `this.callback.calc_hash.network_task`
                if (this.callback.calc_hash.state) |state| this.manager.allocator.free(state.url);
                this.callback.calc_hash.logger.deinit();
                this.manager.allocator.free(this.callback.calc_hash.patchfile_path);
            },
        }
        bun.destroy(this);
    }

    pub fn runFromThreadPool(task: *ThreadPool.Task) void {
        var patch_task: *PatchTask = @fieldParentPtr("task", task);
        patch_task.runFromThreadPoolImpl();
    }

    pub fn runFromThreadPoolImpl(this: *PatchTask) void {
        debug("runFromThreadPoolImpl {s}", .{@tagName(this.callback)});
        defer {
            defer this.manager.wake();
            this.manager.patch_task_queue.push(this);
        }
        switch (this.callback) {
            .calc_hash => {
                this.callback.calc_hash.result = this.calcHash();
            },
            .apply => {
                bun.handleOom(this.apply());
            },
        }
    }

    pub fn runFromMainThread(
        this: *PatchTask,
        manager: *PackageManager,
        log_level: PackageManager.Options.LogLevel,
    ) !void {
        debug("runFromThreadMainThread {s}", .{@tagName(this.callback)});
        defer {
            if (this.pre) _ = manager.pending_pre_calc_hashes.fetchSub(1, .monotonic);
        }
        switch (this.callback) {
            .calc_hash => try this.runFromMainThreadCalcHash(manager, log_level),
            .apply => this.runFromMainThreadApply(manager),
        }
    }

    pub fn runFromMainThreadApply(this: *PatchTask, manager: *PackageManager) void {
        _ = manager; // autofix
        if (this.callback.apply.logger.errors > 0) {
            defer this.callback.apply.logger.deinit();
            Output.errGeneric("failed to apply patchfile ({s})", .{this.callback.apply.patchfilepath});
            this.callback.apply.logger.print(Output.errorWriter()) catch {};
        }
    }

    fn runFromMainThreadCalcHash(
        this: *PatchTask,
        manager: *PackageManager,
        log_level: PackageManager.Options.LogLevel,
    ) !void {
        // TODO only works for npm package
        // need to switch on version.tag and handle each case appropriately
        const calc_hash = &this.callback.calc_hash;
        const hash = calc_hash.result orelse {
            if (log_level != .silent) {
                if (calc_hash.logger.hasErrors()) {
                    calc_hash.logger.print(Output.errorWriter()) catch {};
                } else {
                    Output.errGeneric("Failed to calculate hash for patch <b>{s}<r>", .{this.callback.calc_hash.patchfile_path});
                }
            }
            Global.crash();
        };

        var gop = bun.handleOom(manager.lockfile.patched_dependencies.getOrPut(manager.allocator, calc_hash.name_and_version_hash));
        if (gop.found_existing) {
            gop.value_ptr.setPatchfileHash(hash);
        } else @panic("No entry for patched dependency, this is a bug in Bun.");

        if (calc_hash.state) |state| {
            const url = state.url;
            const pkg_id = state.pkg_id;
            const dep_id = state.dependency_id;

            const pkg = manager.lockfile.packages.get(pkg_id);

            var out_name_and_version_hash: ?u64 = null;
            var out_patchfile_hash: ?u64 = null;
            manager.setPreinstallState(pkg.meta.id, manager.lockfile, .unknown);
            switch (manager.determinePreinstallState(pkg, manager.lockfile, &out_name_and_version_hash, &out_patchfile_hash)) {
                .done => {
                    // patched pkg in folder path, should now be handled by PackageInstall.install()
                    debug("pkg: {s} done", .{pkg.name.slice(manager.lockfile.buffers.string_bytes.items)});
                },
                .extract => {
                    debug("pkg: {s} extract", .{pkg.name.slice(manager.lockfile.buffers.string_bytes.items)});

                    const task_id = Task.Id.forNPMPackage(manager.lockfile.str(&pkg.name), pkg.resolution.value.npm.version);
                    bun.debugAssert(!manager.network_dedupe_map.contains(task_id));

                    const network_task = try manager.generateNetworkTaskForTarball(
                        // TODO: not just npm package
                        task_id,
                        url,
                        manager.lockfile.buffers.dependencies.items[dep_id].behavior.isRequired(),
                        dep_id,
                        pkg,
                        this.callback.calc_hash.name_and_version_hash,
                        switch (pkg.resolution.tag) {
                            .npm => .allow_authorization,
                            else => .no_authorization,
                        },
                    ) orelse unreachable;
                    if (manager.getPreinstallState(pkg.meta.id) == .extract) {
                        manager.setPreinstallState(pkg.meta.id, manager.lockfile, .extracting);
                        manager.enqueueNetworkTask(network_task);
                    }
                },
                .apply_patch => {
                    debug("pkg: {s} apply patch", .{pkg.name.slice(manager.lockfile.buffers.string_bytes.items)});
                    const patch_task = PatchTask.newApplyPatchHash(
                        manager,
                        pkg.meta.id,
                        hash,
                        this.callback.calc_hash.name_and_version_hash,
                    );
                    if (manager.getPreinstallState(pkg.meta.id) == .apply_patch) {
                        manager.setPreinstallState(pkg.meta.id, manager.lockfile, .applying_patch);
                        manager.enqueuePatchTask(patch_task);
                    }
                },
                else => {},
            }
        }
    }

    // 1. Parse patch file
    // 2. Create temp dir to do all the modifications
    // 3. Copy un-patched pkg into temp dir
    // 4. Apply patches to pkg in temp dir
    // 5. Add bun tag for patch hash
    // 6. rename() newly patched pkg to cache
    pub fn apply(this: *PatchTask) bun.OOM!void {
        var log = &this.callback.apply.logger;
        debug("apply patch task", .{});
        bun.assert(this.callback == .apply);

        const patch: *const ApplyPatch = &this.callback.apply;
        const dir = this.project_dir;
        const patchfile_path = patch.patchfilepath;

        var absolute_patchfile_path_buf: bun.PathBuffer = undefined;
        // 1. Parse the patch file
        const absolute_patchfile_path = bun.path.joinZBuf(&absolute_patchfile_path_buf, &[_][]const u8{
            dir,
            patchfile_path,
        }, .auto);
        // TODO: can the patch file be anything other than utf-8?

        const patchfile_txt = switch (bun.sys.File.readFrom(
            bun.FD.cwd(),
            absolute_patchfile_path,
            this.manager.allocator,
        )) {
            .result => |txt| txt,
            .err => |e| {
                try log.addSysError(
                    this.manager.allocator,
                    e,
                    "failed to read patchfile",
                    .{},
                );
                return;
            },
        };
        defer this.manager.allocator.free(patchfile_txt);
        var patchfile = bun.patch.parsePatchFile(patchfile_txt) catch |e| {
            try log.addErrorFmtOpts(
                this.manager.allocator,
                "failed to parse patchfile: {s}",
                .{@errorName(e)},
                .{},
            );
            return;
        };
        defer patchfile.deinit(bun.default_allocator);

        // 2. Create temp dir to do all the modifications
        var tmpname_buf: [1024]u8 = undefined;
        const tempdir_name = bun.fs.FileSystem.tmpname("tmp", &tmpname_buf, bun.fastRandom()) catch |err| switch (err) {
            // max len is 1+16+1+8+3, well below 1024
            error.NoSpaceLeft => unreachable,
        };

        const system_tmpdir = this.tempdir;

        const pkg_name = this.callback.apply.pkgname;

        const dummy_node_modules: PackageManager.PackageInstaller.NodeModulesFolder = .{
            .path = std.array_list.Managed(u8).init(this.manager.allocator),
            .tree_id = 0,
        };

        const resolution_label, const resolution_tag = brk: {
            // TODO: fix this threadsafety issue.
            const resolution = &this.manager.lockfile.packages.items(.resolution)[patch.pkg_id];
            break :brk .{ bun.handleOom(std.fmt.allocPrint(bun.default_allocator, "{f}", .{resolution.fmt(this.manager.lockfile.buffers.string_bytes.items, .posix)})), resolution.tag };
        };
        defer this.manager.allocator.free(resolution_label);

        // 3. copy the unpatched files into temp dir
        var pkg_install: PackageInstall = .{
            .allocator = bun.default_allocator,
            .cache_dir = this.callback.apply.cache_dir,
            .cache_dir_subpath = this.callback.apply.cache_dir_subpath_without_patch_hash,
            .destination_dir_subpath = tempdir_name,
            .destination_dir_subpath_buf = tmpname_buf[0..],
            .patch = null,
            .progress = null,
            .package_name = pkg_name,
            .package_version = resolution_label,
            // dummy value
            .node_modules = &dummy_node_modules,
            .lockfile = this.manager.lockfile,
        };

        switch (pkg_install.install(true, system_tmpdir, .copyfile, resolution_tag)) {
            .success => {},
            .failure => |reason| {
                return try log.addErrorFmtOpts(
                    this.manager.allocator,
                    "{s} while executing step: {s}",
                    .{ @errorName(reason.err), reason.step.name() },
                    .{},
                );
            },
        }

        {
            const patch_pkg_dir = switch (bun.sys.openat(
                .fromStdDir(system_tmpdir),
                tempdir_name,
                bun.O.RDONLY | bun.O.DIRECTORY,
                0,
            )) {
                .result => |fd| fd,
                .err => |e| return try log.addSysError(
                    this.manager.allocator,
                    e,
                    "failed trying to open temporary dir to apply patch to package: {s}",
                    .{resolution_label},
                ),
            };
            defer patch_pkg_dir.close();

            // 4. apply patch
            if (patchfile.apply(this.manager.allocator, patch_pkg_dir)) |e| {
                return try log.addErrorFmtOpts(
                    this.manager.allocator,
                    "failed applying patch file: {f}",
                    .{e},
                    .{},
                );
            }

            // 5. Add bun tag
            const bun_tag_prefix = bun_hash_tag;
            var buntagbuf: BuntagHashBuf = undefined;
            @memcpy(buntagbuf[0..bun_tag_prefix.len], bun_tag_prefix);
            const hashlen = (std.fmt.bufPrint(buntagbuf[bun_tag_prefix.len..], "{x}", .{this.callback.apply.patch_hash}) catch unreachable).len;
            buntagbuf[bun_tag_prefix.len + hashlen] = 0;
            const buntagfd = switch (bun.sys.openat(
                patch_pkg_dir,
                buntagbuf[0 .. bun_tag_prefix.len + hashlen :0],
                bun.O.RDWR | bun.O.CREAT,
                0o666,
            )) {
                .result => |fd| fd,
                .err => |e| {
                    return try log.addErrorFmtOpts(
                        this.manager.allocator,
                        "failed adding bun tag: {f}",
                        .{e.withPath(buntagbuf[0 .. bun_tag_prefix.len + hashlen :0])},
                        .{},
                    );
                },
            };
            buntagfd.close();
        }

        // 6. rename to cache dir
        var path_in_tmpdir_buf: bun.PathBuffer = undefined;
        const path_in_tmpdir = bun.path.joinZBuf(
            &path_in_tmpdir_buf,
            &[_][]const u8{
                tempdir_name,
                // tempdir_name,
            },
            .auto,
        );

        if (bun.sys.renameatConcurrently(
            .fromStdDir(system_tmpdir),
            path_in_tmpdir,
            .fromStdDir(this.callback.apply.cache_dir),
            this.callback.apply.cache_dir_subpath,
            .{ .move_fallback = true },
        ).asErr()) |e| return try log.addErrorFmtOpts(
            this.manager.allocator,
            "renaming changes to cache dir: {f}",
            .{e.withPath(this.callback.apply.cache_dir_subpath)},
            .{},
        );
    }

    pub fn calcHash(this: *PatchTask) ?u64 {
        bun.assert(this.callback == .calc_hash);
        var log = &this.callback.calc_hash.logger;

        const dir = this.project_dir;
        const patchfile_path = this.callback.calc_hash.patchfile_path;

        var absolute_patchfile_path_buf: bun.PathBuffer = undefined;
        // parse the patch file
        const absolute_patchfile_path = bun.path.joinZBuf(
            &absolute_patchfile_path_buf,
            &[_][]const u8{
                dir,
                patchfile_path,
            },
            .auto,
        );

        const stat: bun.Stat = switch (bun.sys.stat(absolute_patchfile_path)) {
            .err => |e| {
                if (e.getErrno() == .NOENT) {
                    bun.handleOom(log.addErrorFmt(null, Loc.Empty, this.manager.allocator, "Couldn't find patch file: '{s}'\n\nTo create a new patch file run:\n\n  <cyan>bun patch {s}<r>", .{
                        this.callback.calc_hash.patchfile_path,
                        this.manager.lockfile.patched_dependencies.get(this.callback.calc_hash.name_and_version_hash).?.path.slice(this.manager.lockfile.buffers.string_bytes.items),
                    }));
                    return null;
                }
                log.addWarningFmt(
                    null,
                    Loc.Empty,
                    this.manager.allocator,
                    "patchfile <b>{s}<r> is empty, please restore or delete it.",
                    .{absolute_patchfile_path},
                ) catch |err| bun.handleOom(err);
                return null;
            },
            .result => |s| s,
        };
        const size: u64 = @intCast(stat.size);
        if (size == 0) {
            log.addErrorFmt(
                null,
                Loc.Empty,
                this.manager.allocator,
                "patchfile <b>{s}<r> is empty, please restore or delete it.",
                .{absolute_patchfile_path},
            ) catch |err| bun.handleOom(err);
            return null;
        }

        const fd = switch (bun.sys.open(absolute_patchfile_path, bun.O.RDONLY, 0)) {
            .err => |e| {
                log.addErrorFmt(
                    null,
                    Loc.Empty,
                    this.manager.allocator,
                    "failed to open patch file: {f}",
                    .{e},
                ) catch |err| bun.handleOom(err);
                return null;
            },
            .result => |fd| fd,
        };
        defer fd.close();

        var hasher = bun.Wyhash11.init(0);

        // what's a good number for this? page size i guess
        const STACK_SIZE = 16384;

        var file = bun.sys.File{ .handle = fd };
        var stack: [STACK_SIZE]u8 = undefined;
        var read: usize = 0;
        while (read < size) {
            const slice = switch (file.readFillBuf(stack[0..])) {
                .result => |slice| slice,
                .err => |e| {
                    log.addErrorFmt(
                        null,
                        Loc.Empty,
                        this.manager.allocator,
                        "failed to read from patch file: {f} ({s})",
                        .{ e, absolute_patchfile_path },
                    ) catch |err| bun.handleOom(err);
                    return null;
                },
            };
            if (slice.len == 0) break;
            hasher.update(slice);
            read += slice.len;
        }

        return hasher.final();
    }

    pub fn notify(this: *PatchTask) void {
        defer this.manager.wake();
        this.manager.patch_task_queue.push(this);
    }

    pub fn schedule(this: *PatchTask, batch: *ThreadPool.Batch) void {
        batch.push(ThreadPool.Batch.from(&this.task));
    }

    pub fn newCalcPatchHash(
        manager: *PackageManager,
        name_and_version_hash: u64,
        state: ?CalcPatchHash.EnqueueAfterState,
    ) *PatchTask {
        const patchdep = manager.lockfile.patched_dependencies.get(name_and_version_hash) orelse @panic("This is a bug");
        const patchfile_path = bun.handleOom(manager.allocator.dupeZ(u8, patchdep.path.slice(manager.lockfile.buffers.string_bytes.items)));

        const pt = bun.new(PatchTask, .{
            .tempdir = manager.getTemporaryDirectory().handle,
            .callback = .{
                .calc_hash = .{
                    .state = state,
                    .patchfile_path = patchfile_path,
                    .name_and_version_hash = name_and_version_hash,
                    .logger = logger.Log.init(manager.allocator),
                },
            },
            .manager = manager,
            .project_dir = FileSystem.instance.top_level_dir,
        });

        return pt;
    }

    pub fn newApplyPatchHash(
        pkg_manager: *PackageManager,
        pkg_id: PackageID,
        patch_hash: u64,
        name_and_version_hash: u64,
    ) *PatchTask {
        const pkg_name = pkg_manager.lockfile.packages.items(.name)[pkg_id];

        const resolution = &pkg_manager.lockfile.packages.items(.resolution)[pkg_id];

        var folder_path_buf: bun.PathBuffer = undefined;
        const stuff = pkg_manager.computeCacheDirAndSubpath(
            pkg_name.slice(pkg_manager.lockfile.buffers.string_bytes.items),
            resolution,
            &folder_path_buf,
            patch_hash,
        );

        const patchfilepath = bun.handleOom(pkg_manager.allocator.dupe(u8, pkg_manager.lockfile.patched_dependencies.get(name_and_version_hash).?.path.slice(pkg_manager.lockfile.buffers.string_bytes.items)));

        const pt = bun.new(PatchTask, .{
            .tempdir = pkg_manager.getTemporaryDirectory().handle,
            .callback = .{
                .apply = .{
                    .pkg_id = pkg_id,
                    .patch_hash = patch_hash,
                    .name_and_version_hash = name_and_version_hash,
                    .cache_dir = stuff.cache_dir,
                    .patchfilepath = patchfilepath,
                    .pkgname = pkg_name,
                    .logger = logger.Log.init(pkg_manager.allocator),
                    // need to dupe this as it's calculated using
                    // `PackageManager.cached_package_folder_name_buf` which may be
                    // modified
                    .cache_dir_subpath = bun.handleOom(pkg_manager.allocator.dupeZ(u8, stuff.cache_dir_subpath)),
                    .cache_dir_subpath_without_patch_hash = bun.handleOom(pkg_manager.allocator.dupeZ(u8, stuff.cache_dir_subpath[0 .. std.mem.indexOf(u8, stuff.cache_dir_subpath, "_patch_hash=") orelse @panic("This is a bug in Bun.")])),
                },
            },
            .manager = pkg_manager,
            .project_dir = FileSystem.instance.top_level_dir,
        });

        return pt;
    }
};

const string = []const u8;
const stringZ = [:0]const u8;

const std = @import("std");

const Fs = @import("../fs.zig");
const FileSystem = Fs.FileSystem;

const bun = @import("bun");
const Global = bun.Global;
const Output = bun.Output;
const PackageManager = bun.PackageManager;
const ThreadPool = bun.ThreadPool;
const String = bun.Semver.String;
const Task = bun.install.Task;

const logger = bun.logger;
const Loc = logger.Loc;
