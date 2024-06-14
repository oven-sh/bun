const bun = @import("root").bun;
const std = @import("std");

const string = bun.string;
const stringZ = bun.stringZ;
const Output = bun.Output;
const Global = bun.Global;
const Environment = bun.Environment;
const strings = bun.strings;
const MutableString = bun.MutableString;

const logger = bun.logger;

const PackageManager = bun.PackageManager;
pub const PackageID = bun.install.PackageID;
pub const DependencyID = bun.install.DependencyID;

const Task = bun.install.Task;
pub const Lockfile = @import("./lockfile.zig");
pub const PatchedDep = Lockfile.PatchedDep;

const ThreadPool = bun.ThreadPool;

pub const Resolution = @import("./resolution.zig").Resolution;
const Progress = std.Progress;

pub const PackageInstall = bun.install.PackageInstall;
pub const PreparePatchPackageInstall = bun.install.PreparePatchPackageInstall;

const Fs = @import("../fs.zig");
const FileSystem = Fs.FileSystem;

pub const bun_hash_tag = bun.install.bun_hash_tag;
pub const max_hex_hash_len: comptime_int = brk: {
    var buf: [128]u8 = undefined;
    break :brk (std.fmt.bufPrint(buf[0..], "{x}", .{std.math.maxInt(u64)}) catch @panic("Buf wasn't big enough.")).len;
};
pub const max_buntag_hash_buf_len: comptime_int = max_hex_hash_len + bun_hash_tag.len + 1;
pub const BuntagHashBuf = [max_buntag_hash_buf_len]u8;

pub const PatchTask = struct {
    manager: *PackageManager,
    project_dir: []const u8,
    callback: union(enum) {
        calc_hash: CalcPatchHash,
        apply: ApplyPatch,
    },
    task: ThreadPool.Task = .{
        .callback = runFromThreadPool,
    },
    next: ?*PatchTask = null,

    const debug = bun.Output.scoped(.InstallPatch, false);

    fn errDupePath(e: bun.sys.Error) bun.sys.Error {
        if (e.path.len > 0) return e.withPath(bun.default_allocator.dupe(u8, e.path) catch bun.outOfMemory());
        return e;
    }

    const Maybe = bun.sys.Maybe;

    const CalcPatchHash = struct {
        patchfile_path: []const u8,
        name_and_version_hash: u64,

        state: ?EnqueueAfterState = null,

        result: ?Maybe(u64) = null,

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
        resolution: *const Resolution,
        patchfilepath: []const u8,
        pkgname: []const u8,

        cache_dir: std.fs.Dir,
        cache_dir_subpath: stringZ,
        cache_dir_subpath_without_patch_hash: stringZ,

        /// this is non-null if this was called before a Task, for example extracting
        task_id: ?Task.Id.Type = null,
        install_context: ?struct {
            dependency_id: DependencyID,
            tree_id: Lockfile.Tree.Id,
            path: std.ArrayList(u8),
        } = null,
        // dependency_id: ?struct = null,

        logger: logger.Log,
    };

    pub fn deinit(this: *PatchTask) void {
        switch (this.callback) {
            .apply => {
                this.manager.allocator.free(this.callback.apply.patchfilepath);
                this.manager.allocator.free(this.callback.apply.cache_dir_subpath);
                this.manager.allocator.free(this.callback.apply.pkgname);
                if (this.callback.apply.install_context) |ictx| ictx.path.deinit();
            },
            .calc_hash => {
                // TODO: how to deinit `this.callback.calc_hash.network_task`
                if (this.callback.calc_hash.state) |state| this.manager.allocator.free(state.url);
                if (this.callback.calc_hash.result) |r| {
                    if (r.asErr()) |e| {
                        if (e.path.len > 0) bun.default_allocator.free(e.path);
                    }
                }
                this.manager.allocator.free(this.callback.calc_hash.patchfile_path);
            },
        }
        bun.destroy(this);
    }

    pub fn runFromThreadPool(task: *ThreadPool.Task) void {
        var patch_task: *PatchTask = @fieldParentPtr(PatchTask, "task", task);
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
                this.apply() catch bun.outOfMemory();
            },
        }
    }

    pub fn runFromMainThread(
        this: *PatchTask,
        manager: *PackageManager,
        comptime log_level: PackageManager.Options.LogLevel,
    ) !void {
        debug("runFromThreadMainThread {s}", .{@tagName(this.callback)});
        switch (this.callback) {
            .calc_hash => try this.runFromMainThreadCalcHash(manager, log_level),
            .apply => this.runFromMainThreadApply(manager),
        }
    }

    pub fn runFromMainThreadApply(this: *PatchTask, manager: *PackageManager) void {
        _ = manager; // autofix
        if (this.callback.apply.logger.errors > 0) {
            defer this.callback.apply.logger.deinit();
            // this.log.addErrorFmt(null, logger.Loc.Empty, bun.default_allocator, "failed to apply patch: {}", .{e}) catch unreachable;
            this.callback.apply.logger.printForLogLevel(Output.writer()) catch {};
        }
    }

    fn runFromMainThreadCalcHash(
        this: *PatchTask,
        manager: *PackageManager,
        comptime log_level: PackageManager.Options.LogLevel,
    ) !void {
        // TODO only works for npm package
        // need to switch on version.tag and handle each case appropriately
        const calc_hash = &this.callback.calc_hash;
        const hash = switch (calc_hash.result orelse @panic("Calc hash didn't run, this is a bug in Bun.")) {
            .result => |h| h,
            .err => |e| {
                if (e.getErrno() == bun.C.E.NOENT) {
                    const fmt = "\n\n<r><red>error<r>: could not find patch file <b>{s}<r>\n\nPlease make sure it exists.\n\nTo create a new patch file run:\n\n  <cyan>bun patch {s}<r>\n";
                    const args = .{
                        this.callback.calc_hash.patchfile_path,
                        manager.lockfile.patched_dependencies.get(calc_hash.name_and_version_hash).?.path.slice(manager.lockfile.buffers.string_bytes.items),
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
                    Global.crash();
                }

                const fmt = "\n\n<r><red>error<r>: {s}{s} while calculating hash for patchfile: <b>{s}<r>\n";
                const args = .{ @tagName(e.getErrno()), e.path, this.callback.calc_hash.patchfile_path };
                if (comptime log_level.showProgress()) {
                    Output.prettyWithPrinterFn(fmt, args, Progress.log, &manager.progress);
                } else {
                    Output.prettyErrorln(
                        fmt,
                        args,
                    );
                    Output.flush();
                }
                Global.crash();

                return;
            },
        };

        var gop = manager.lockfile.patched_dependencies.getOrPut(manager.allocator, calc_hash.name_and_version_hash) catch bun.outOfMemory();
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
                    const network_task = try manager.generateNetworkTaskForTarball(
                        // TODO: not just npm package
                        Task.Id.forNPMPackage(
                            manager.lockfile.str(&pkg.name),
                            pkg.resolution.value.npm.version,
                        ),
                        url,
                        manager.lockfile.buffers.dependencies.items[dep_id].behavior.isRequired(),
                        dep_id,
                        pkg,
                        this.callback.calc_hash.name_and_version_hash,
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
    pub fn apply(this: *PatchTask) !void {
        var log = this.callback.apply.logger;
        debug("apply patch task", .{});
        bun.assert(this.callback == .apply);

        const strbuf: []const u8 = this.manager.lockfile.buffers.string_bytes.items;

        const patch: *const ApplyPatch = &this.callback.apply;
        const dir = this.project_dir;
        const patchfile_path = patch.patchfilepath;

        // 1. Parse the patch file
        const absolute_patchfile_path = bun.path.joinZ(&[_][]const u8{
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
                try log.addErrorFmtNoLoc(
                    this.manager.allocator,
                    "failed to read patchfile: {}",
                    .{e.toSystemError()},
                );
                return;
            },
        };
        defer this.manager.allocator.free(patchfile_txt);
        var patchfile = bun.patch.parsePatchFile(patchfile_txt) catch |e| {
            try log.addErrorFmtNoLoc(
                this.manager.allocator,
                "failed to parse patchfile: {s}",
                .{@errorName(e)},
            );
            return;
        };
        defer patchfile.deinit(bun.default_allocator);

        // 2. Create temp dir to do all the modifications
        var tmpname_buf: [1024]u8 = undefined;
        const tempdir_name = bun.span(bun.fs.FileSystem.instance.tmpname("tmp", &tmpname_buf, bun.fastRandom()) catch bun.outOfMemory());
        const system_tmpdir = bun.fs.FileSystem.instance.tmpdir() catch |e| {
            try log.addErrorFmtNoLoc(
                this.manager.allocator,
                "failed to creating temp dir: {s}",
                .{@errorName(e)},
            );
            return;
        };

        const pkg_name = this.callback.apply.pkgname;

        var resolution_buf: [512]u8 = undefined;
        const resolution_label = std.fmt.bufPrint(&resolution_buf, "{}", .{this.callback.apply.resolution.fmt(strbuf, .posix)}) catch unreachable;

        const dummy_node_modules = .{
            .path = std.ArrayList(u8).init(this.manager.allocator),
            .tree_id = 0,
        };

        // 3. copy the unpatched files into temp dir
        var pkg_install = PreparePatchPackageInstall{
            .allocator = bun.default_allocator,
            .cache_dir = this.callback.apply.cache_dir,
            .cache_dir_subpath = this.callback.apply.cache_dir_subpath_without_patch_hash,
            .destination_dir_subpath = tempdir_name,
            .destination_dir_subpath_buf = tmpname_buf[0..],
            .progress = .{},
            .package_name = pkg_name,
            .package_version = resolution_label,
            // dummy value
            .node_modules = &dummy_node_modules,
        };

        switch (pkg_install.installImpl(true, system_tmpdir, .copyfile)) {
            .success => {},
            .fail => |reason| {
                return try log.addErrorFmtNoLoc(
                    this.manager.allocator,
                    "{s} while executing step: {s}",
                    .{ @errorName(reason.err), reason.step.name() },
                );
            },
        }

        var patch_pkg_dir = system_tmpdir.openDir(tempdir_name, .{}) catch |e| return try log.addErrorFmtNoLoc(
            this.manager.allocator,
            "failed trying to open temporary dir to apply patch to package: {s}",
            .{@errorName(e)},
        );
        defer patch_pkg_dir.close();

        // 4. apply patch
        if (patchfile.apply(this.manager.allocator, bun.toFD(patch_pkg_dir.fd))) |e| {
            return try log.addErrorFmtNoLoc(
                this.manager.allocator,
                "failed applying patch file: {}",
                .{e},
            );
        }

        // 5. Add bun tag
        const bun_tag_prefix = bun_hash_tag;
        var buntagbuf: BuntagHashBuf = undefined;
        @memcpy(buntagbuf[0..bun_tag_prefix.len], bun_tag_prefix);
        const hashlen = (std.fmt.bufPrint(buntagbuf[bun_tag_prefix.len..], "{x}", .{this.callback.apply.patch_hash}) catch unreachable).len;
        buntagbuf[bun_tag_prefix.len + hashlen] = 0;
        const buntagfd = switch (bun.sys.openat(bun.toFD(patch_pkg_dir.fd), buntagbuf[0 .. bun_tag_prefix.len + hashlen :0], std.os.O.RDWR | std.os.O.CREAT, 0o666)) {
            .result => |fd| fd,
            .err => |e| {
                return try log.addErrorFmtNoLoc(this.manager.allocator, "{}", .{e});
            },
        };
        _ = bun.sys.close(buntagfd);

        // 6. rename to cache dir
        const path_in_tmpdir = bun.path.joinZ(
            &[_][]const u8{
                tempdir_name,
                // tempdir_name,
            },
            .auto,
        );
        // var allocated = false;
        // const package_name_z = brk: {
        //     if (this.package_name.len < tmpname_buf.len) {
        //         @memcpy(tmpname_buf[0..this.package_name.len], this.package_name);
        //         tmpname_buf[this.package_name.len] = 0;
        //         break :brk tmpname_buf[0..this.package_name.len :0];
        //     }
        //     allocated = true;
        //     break :brk this.manager.allocator.dupeZ(u8, this.package_name) catch bun.outOfMemory();
        // };
        // defer if (allocated) this.manager.allocator.free(package_name_z);

        worked: {
            if (bun.sys.renameat2(
                bun.toFD(system_tmpdir.fd),
                path_in_tmpdir,
                bun.toFD(this.callback.apply.cache_dir.fd),
                this.callback.apply.cache_dir_subpath,
                .{
                    .exclude = true,
                },
            ).asErr()) |e_| {
                var e = e_;

                if (if (comptime bun.Environment.isWindows) switch (e.getErrno()) {
                    bun.C.E.NOTEMPTY, bun.C.E.EXIST => true,
                    else => false,
                } else switch (e.getErrno()) {
                    bun.C.E.NOTEMPTY, bun.C.E.EXIST, bun.C.E.OPNOTSUPP => true,
                    else => false,
                }) {
                    switch (bun.sys.renameat2(
                        bun.toFD(system_tmpdir.fd),
                        path_in_tmpdir,
                        bun.toFD(this.callback.apply.cache_dir.fd),
                        this.callback.apply.cache_dir_subpath,
                        .{
                            .exchange = true,
                        },
                    )) {
                        .err => |ee| e = ee,
                        .result => break :worked,
                    }
                }
                return try log.addErrorFmtNoLoc(this.manager.allocator, "{}", .{e});
            }
        }
    }

    pub fn calcHash(this: *PatchTask) Maybe(u64) {
        bun.assert(this.callback == .calc_hash);

        const dir = this.project_dir;
        const patchfile_path = this.callback.calc_hash.patchfile_path;

        // parse the patch file
        const absolute_patchfile_path = bun.path.joinZ(&[_][]const u8{
            dir,
            patchfile_path,
        }, .auto);

        const stat: bun.Stat = switch (bun.sys.stat(absolute_patchfile_path)) {
            .err => |e| return .{ .err = errDupePath(e) },
            .result => |s| s,
        };
        const size: u64 = @intCast(stat.size);

        const fd = switch (bun.sys.open(absolute_patchfile_path, std.os.O.RDONLY, 0)) {
            .err => |e| return .{ .err = errDupePath(e) },
            .result => |fd| fd,
        };
        defer _ = bun.sys.close(fd);

        var hasher = bun.Wyhash11.init(0);

        // what's a good number for this? page size i guess
        const STACK_SIZE = 16384;

        var stack: [STACK_SIZE]u8 = undefined;
        var read: usize = 0;
        while (read < size) {
            var i: usize = 0;
            while (i < STACK_SIZE and i < size) {
                switch (bun.sys.read(fd, stack[i..])) {
                    .result => |w| i += w,
                    .err => |e| return .{ .err = errDupePath(e) },
                }
            }
            read += i;
            hasher.update(stack[0..i]);
        }

        return .{ .result = hasher.final() };
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
        bun.debugAssert(patchdep.patchfile_hash_is_null);
        const patchfile_path = manager.allocator.dupeZ(u8, patchdep.path.slice(manager.lockfile.buffers.string_bytes.items)) catch bun.outOfMemory();

        const pt = bun.new(PatchTask, .{
            .callback = .{
                .calc_hash = .{
                    .state = state,
                    .patchfile_path = patchfile_path,
                    .name_and_version_hash = name_and_version_hash,
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
        const resolution: *const Resolution = &pkg_manager.lockfile.packages.items(.resolution)[pkg_id];

        const stuff = pkg_manager.computeCacheDirAndSubpath(
            pkg_name.slice(pkg_manager.lockfile.buffers.string_bytes.items),
            resolution,
            patch_hash,
        );

        const patchfilepath = pkg_manager.allocator.dupe(u8, pkg_manager.lockfile.patched_dependencies.get(name_and_version_hash).?.path.slice(pkg_manager.lockfile.buffers.string_bytes.items)) catch bun.outOfMemory();

        const pt = bun.new(PatchTask, .{
            .callback = .{
                .apply = .{
                    .pkg_id = pkg_id,
                    .resolution = resolution,
                    .patch_hash = patch_hash,
                    .name_and_version_hash = name_and_version_hash,
                    .cache_dir = stuff.cache_dir,
                    .patchfilepath = patchfilepath,
                    .pkgname = pkg_manager.allocator.dupe(u8, pkg_name.slice(pkg_manager.lockfile.buffers.string_bytes.items)) catch bun.outOfMemory(),
                    .logger = logger.Log.init(pkg_manager.allocator),
                    // need to dupe this as it's calculated using
                    // `PackageManager.cached_package_folder_name_buf` which may be
                    // modified
                    .cache_dir_subpath = pkg_manager.allocator.dupeZ(u8, stuff.cache_dir_subpath) catch bun.outOfMemory(),
                    .cache_dir_subpath_without_patch_hash = pkg_manager.allocator.dupeZ(u8, stuff.cache_dir_subpath[0 .. std.mem.indexOf(u8, stuff.cache_dir_subpath, "_patch_hash=") orelse @panic("This is a bug in Bun.")]) catch bun.outOfMemory(),
                },
            },
            .manager = pkg_manager,
            .project_dir = FileSystem.instance.top_level_dir,
        });

        return pt;
    }
};
