const std = @import("std");
const bun = @import("bun");
const string = bun.string;
const stringZ = bun.stringZ;
const strings = bun.strings;
const Progress = bun.Progress;
const install = bun.install;
const String = bun.Semver.String;
const PackageManager = install.PackageManager;
const Lockfile = install.Lockfile;
const Output = bun.Output;
const Global = bun.Global;
const Environment = bun.Environment;
const Bitset = bun.bit_set.DynamicBitSetUnmanaged;
const TruncatedPackageNameHash = install.TruncatedPackageNameHash;
const BuntagHashBuf = install.BuntagHashBuf;
const buntaghashbuf_make = install.buntaghashbuf_make;
const Repository = install.Repository;
const Resolution = install.Resolution;
const MutableString = bun.MutableString;
const logger = bun.logger;
const Npm = install.Npm;
const initializeStore = install.initializeStore;
const JSON = bun.JSON;
const Walker = @import("../walker_skippable.zig");
const ThreadPool = bun.ThreadPool;
const JSC = bun.JSC;
const Syscall = bun.sys;
const FileSystem = bun.fs.FileSystem;
const Path = bun.path;
const PackageID = install.PackageID;

pub const PackageInstall = struct {
    /// TODO: Change to bun.FD.Dir
    cache_dir: std.fs.Dir,
    cache_dir_subpath: stringZ = "",
    destination_dir_subpath: stringZ = "",
    destination_dir_subpath_buf: []u8,

    allocator: std.mem.Allocator,

    progress: ?*Progress,

    package_name: String,
    package_version: string,
    patch: Patch,

    // TODO: this is never read
    file_count: u32 = 0,
    node_modules: *const PackageManager.PackageInstaller.NodeModulesFolder,
    lockfile: *Lockfile,

    const ThisPackageInstall = @This();

    pub const Patch = struct {
        root_project_dir: ?[]const u8 = null,
        patch_path: string = undefined,
        patch_contents_hash: u64 = 0,

        pub const NULL = Patch{};

        pub fn isNull(this: Patch) bool {
            return this.root_project_dir == null;
        }
    };

    const debug = Output.scoped(.install, true);

    pub const Summary = struct {
        fail: u32 = 0,
        success: u32 = 0,
        skipped: u32 = 0,
        successfully_installed: ?Bitset = null,

        /// Package name hash -> number of scripts skipped.
        /// Multiple versions of the same package might add to the count, and each version
        /// might have a different number of scripts
        packages_with_blocked_scripts: std.AutoArrayHashMapUnmanaged(TruncatedPackageNameHash, usize) = .{},
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
        pub const map = bun.ComptimeStringMap(Method, .{
            .{ "clonefile", .clonefile },
            .{ "clonefile_each_dir", .clonefile_each_dir },
            .{ "hardlink", .hardlink },
            .{ "copyfile", .copyfile },
            .{ "symlink", .symlink },
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

    ///
    fn verifyPatchHash(
        this: *@This(),
        root_node_modules_dir: std.fs.Dir,
    ) bool {
        bun.debugAssert(!this.patch.isNull());

        // hash from the .patch file, to be checked against bun tag
        const patchfile_contents_hash = this.patch.patch_contents_hash;
        var buf: BuntagHashBuf = undefined;
        const bunhashtag = buntaghashbuf_make(&buf, patchfile_contents_hash);

        const patch_tag_path = bun.path.joinZ(&[_][]const u8{
            this.destination_dir_subpath,
            bunhashtag,
        }, .posix);

        var destination_dir = this.node_modules.openDir(root_node_modules_dir) catch return false;
        defer {
            if (std.fs.cwd().fd != destination_dir.fd) destination_dir.close();
        }

        if (comptime bun.Environment.isPosix) {
            _ = bun.sys.fstatat(.fromStdDir(destination_dir), patch_tag_path).unwrap() catch return false;
        } else {
            switch (bun.sys.openat(.fromStdDir(destination_dir), patch_tag_path, bun.O.RDONLY, 0)) {
                .err => return false,
                .result => |fd| fd.close(),
            }
        }

        return true;
    }

    // 1. verify that .bun-tag exists (was it installed from bun?)
    // 2. check .bun-tag against the resolved version
    fn verifyGitResolution(
        this: *@This(),
        repo: *const Repository,
        root_node_modules_dir: std.fs.Dir,
    ) bool {
        bun.copy(u8, this.destination_dir_subpath_buf[this.destination_dir_subpath.len..], std.fs.path.sep_str ++ ".bun-tag");
        this.destination_dir_subpath_buf[this.destination_dir_subpath.len + std.fs.path.sep_str.len + ".bun-tag".len] = 0;
        const bun_tag_path: [:0]u8 = this.destination_dir_subpath_buf[0 .. this.destination_dir_subpath.len + std.fs.path.sep_str.len + ".bun-tag".len :0];
        defer this.destination_dir_subpath_buf[this.destination_dir_subpath.len] = 0;
        var git_tag_stack_fallback = std.heap.stackFallback(2048, bun.default_allocator);
        const allocator = git_tag_stack_fallback.get();

        var bun_tag_file = this.node_modules.readSmallFile(
            root_node_modules_dir,
            bun_tag_path,
            allocator,
        ) catch return false;
        defer bun_tag_file.bytes.deinit();

        return strings.eqlLong(repo.resolved.slice(this.lockfile.buffers.string_bytes.items), bun_tag_file.bytes.items, true);
    }

    pub fn verify(
        this: *@This(),
        resolution: *const Resolution,
        root_node_modules_dir: std.fs.Dir,
    ) bool {
        const verified =
            switch (resolution.tag) {
                .git => this.verifyGitResolution(&resolution.value.git, root_node_modules_dir),
                .github => this.verifyGitResolution(&resolution.value.github, root_node_modules_dir),
                .root => this.verifyTransitiveSymlinkedFolder(root_node_modules_dir),
                .folder => if (this.lockfile.isWorkspaceTreeId(this.node_modules.tree_id))
                    this.verifyPackageJSONNameAndVersion(root_node_modules_dir, resolution.tag)
                else
                    this.verifyTransitiveSymlinkedFolder(root_node_modules_dir),
                else => this.verifyPackageJSONNameAndVersion(root_node_modules_dir, resolution.tag),
            };
        if (this.patch.isNull()) return verified;
        if (!verified) return false;
        return this.verifyPatchHash(root_node_modules_dir);
    }

    // Only check for destination directory in node_modules. We can't use package.json because
    // it might not exist
    fn verifyTransitiveSymlinkedFolder(this: *@This(), root_node_modules_dir: std.fs.Dir) bool {
        return this.node_modules.directoryExistsAt(root_node_modules_dir, this.destination_dir_subpath);
    }

    fn getInstalledPackageJsonSource(
        this: *PackageInstall,
        root_node_modules_dir: std.fs.Dir,
        mutable: *MutableString,
        resolution_tag: Resolution.Tag,
    ) ?logger.Source {
        var total: usize = 0;
        var read: usize = 0;
        mutable.reset();
        mutable.list.expandToCapacity();
        bun.copy(u8, this.destination_dir_subpath_buf[this.destination_dir_subpath.len..], std.fs.path.sep_str ++ "package.json");
        this.destination_dir_subpath_buf[this.destination_dir_subpath.len + std.fs.path.sep_str.len + "package.json".len] = 0;
        const package_json_path: [:0]u8 = this.destination_dir_subpath_buf[0 .. this.destination_dir_subpath.len + std.fs.path.sep_str.len + "package.json".len :0];
        defer this.destination_dir_subpath_buf[this.destination_dir_subpath.len] = 0;

        var package_json_file = this.node_modules.openFile(root_node_modules_dir, package_json_path) catch return null;
        defer package_json_file.close();

        // Heuristic: most package.jsons will be less than 2048 bytes.
        read = package_json_file.read(mutable.list.items[total..]).unwrap() catch return null;
        var remain = mutable.list.items[@min(total, read)..];
        if (read > 0 and remain.len < 1024) {
            mutable.growBy(4096) catch return null;
            mutable.list.expandToCapacity();
        }

        while (read > 0) : (read = package_json_file.read(remain).unwrap() catch return null) {
            total += read;

            mutable.list.expandToCapacity();
            remain = mutable.list.items[total..];

            if (remain.len < 1024) {
                mutable.growBy(4096) catch return null;
            }
            mutable.list.expandToCapacity();
            remain = mutable.list.items[total..];
        }

        // If it's not long enough to have {"name": "foo", "version": "1.2.0"}, there's no way it's valid
        const minimum = if (resolution_tag == .workspace and this.package_version.len == 0)
            // workspaces aren't required to have a version
            "{\"name\":\"\"}".len + this.package_name.len()
        else
            "{\"name\":\"\",\"version\":\"\"}".len + this.package_name.len() + this.package_version.len;

        if (total < minimum) return null;

        return logger.Source.initPathString(bun.span(package_json_path), mutable.list.items[0..total]);
    }

    fn verifyPackageJSONNameAndVersion(this: *PackageInstall, root_node_modules_dir: std.fs.Dir, resolution_tag: Resolution.Tag) bool {
        var body_pool = Npm.Registry.BodyPool.get(this.allocator);
        var mutable: MutableString = body_pool.data;
        defer {
            body_pool.data = mutable;
            Npm.Registry.BodyPool.release(body_pool);
        }

        // Read the file
        // Return false on any error.
        // Don't keep it open while we're parsing the JSON.
        // The longer the file stays open, the more likely it causes issues for
        // other processes on Windows.
        const source = &(this.getInstalledPackageJsonSource(root_node_modules_dir, &mutable, resolution_tag) orelse return false);

        var log = logger.Log.init(this.allocator);
        defer log.deinit();

        initializeStore();

        var package_json_checker = JSON.PackageJSONVersionChecker.init(
            this.allocator,
            source,
            &log,
        ) catch return false;
        _ = package_json_checker.parseExpr() catch return false;
        if (log.errors > 0 or !package_json_checker.has_found_name) return false;
        // workspaces aren't required to have a version
        if (!package_json_checker.has_found_version and resolution_tag != .workspace) return false;

        const found_version = package_json_checker.found_version;

        // exclude build tags from comparsion
        // https://github.com/oven-sh/bun/issues/13563
        const found_version_end = strings.lastIndexOfChar(found_version, '+') orelse found_version.len;
        const expected_version_end = strings.lastIndexOfChar(this.package_version, '+') orelse this.package_version.len;
        // Check if the version matches
        if (!strings.eql(found_version[0..found_version_end], this.package_version[0..expected_version_end])) {
            const offset = brk: {
                // ASCII only.
                for (0..found_version.len) |c| {
                    switch (found_version[c]) {
                        // newlines & whitespace
                        ' ',
                        '\t',
                        '\n',
                        '\r',
                        std.ascii.control_code.vt,
                        std.ascii.control_code.ff,

                        // version separators
                        'v',
                        '=',
                        => {},
                        else => {
                            break :brk c;
                        },
                    }
                }
                // If we didn't find any of these characters, there's no point in checking the version again.
                // it will never match.
                return false;
            };

            if (!strings.eql(found_version[offset..], this.package_version)) return false;
        }

        // lastly, check the name.
        return strings.eql(package_json_checker.found_name, this.package_name.slice(this.lockfile.buffers.string_bytes.items));
    }

    pub const Result = union(Tag) {
        success: void,
        failure: struct {
            err: anyerror,
            step: Step,
            debug_trace: if (Environment.isDebug) bun.crash_handler.StoredTrace else void,

            pub inline fn isPackageMissingFromCache(this: @This()) bool {
                return (this.err == error.FileNotFound or this.err == error.ENOENT) and this.step == .opening_cache_dir;
            }
        },

        /// Init a Result with the 'fail' tag. use `.success` for the 'success' tag.
        pub inline fn fail(err: anyerror, step: Step, trace: ?*std.builtin.StackTrace) Result {
            return .{
                .failure = .{
                    .err = err,
                    .step = step,
                    .debug_trace = if (Environment.isDebug)
                        if (trace) |t|
                            bun.crash_handler.StoredTrace.from(t)
                        else
                            bun.crash_handler.StoredTrace.capture(@returnAddress()),
                },
            };
        }

        pub fn isFail(this: @This()) bool {
            return switch (this) {
                .success => false,
                .failure => true,
            };
        }

        pub const Tag = enum {
            success,
            failure,
        };
    };

    pub const Step = enum {
        copyfile,
        opening_cache_dir,
        opening_dest_dir,
        copying_files,
        linking,
        linking_dependency,
        patching,

        /// "error: failed {s} for package"
        pub fn name(this: Step) []const u8 {
            return switch (this) {
                .copyfile, .copying_files => "copying files from cache to destination",
                .opening_cache_dir => "opening cache/package/version dir",
                .opening_dest_dir => "opening node_modules/package dir",
                .linking => "linking bins",
                .linking_dependency => "linking dependency/workspace to node_modules",
                .patching => "patching dependency",
            };
        }
    };

    pub var supported_method: Method = if (Environment.isMac)
        Method.clonefile
    else
        Method.hardlink;

    fn installWithClonefileEachDir(this: *@This(), destination_dir: std.fs.Dir) !Result {
        var cached_package_dir = bun.openDir(this.cache_dir, this.cache_dir_subpath) catch |err| return Result.fail(err, .opening_cache_dir, @errorReturnTrace());
        defer cached_package_dir.close();
        var walker_ = Walker.walk(
            cached_package_dir,
            this.allocator,
            &[_]bun.OSPathSlice{},
            &[_]bun.OSPathSlice{},
        ) catch |err| return Result.fail(err, .opening_cache_dir, @errorReturnTrace());
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
                            _ = bun.sys.mkdirat(.fromStdDir(destination_dir_), entry.path, 0o755);
                        },
                        .file => {
                            bun.copy(u8, &stackpath, entry.path);
                            stackpath[entry.path.len] = 0;
                            const path: [:0]u8 = stackpath[0..entry.path.len :0];
                            const basename: [:0]u8 = stackpath[entry.path.len - entry.basename.len .. entry.path.len :0];
                            switch (bun.c.clonefileat(
                                entry.dir.fd,
                                basename,
                                destination_dir_.fd,
                                path,
                                0,
                            )) {
                                0 => {},
                                else => |errno| switch (std.posix.errno(errno)) {
                                    .XDEV => return error.NotSupported, // not same file system
                                    .OPNOTSUPP => return error.NotSupported,
                                    .NOENT => return error.FileNotFound,
                                    // sometimes the downloaded npm package has already node_modules with it, so just ignore exist error here
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

        var subdir = destination_dir.makeOpenPath(bun.span(this.destination_dir_subpath), .{}) catch |err| return Result.fail(err, .opening_dest_dir, @errorReturnTrace());
        defer subdir.close();

        this.file_count = FileCopier.copy(
            subdir,
            &walker_,
        ) catch |err| return Result.fail(err, .copying_files, @errorReturnTrace());

        return .{ .success = {} };
    }

    // https://www.unix.com/man-page/mojave/2/fclonefileat/
    fn installWithClonefile(this: *@This(), destination_dir: std.fs.Dir) !Result {
        if (comptime !Environment.isMac) @compileError("clonefileat() is macOS only.");

        if (this.destination_dir_subpath[0] == '@') {
            if (strings.indexOfCharZ(this.destination_dir_subpath, std.fs.path.sep)) |slash| {
                this.destination_dir_subpath_buf[slash] = 0;
                const subdir = this.destination_dir_subpath_buf[0..slash :0];
                destination_dir.makeDirZ(subdir) catch {};
                this.destination_dir_subpath_buf[slash] = std.fs.path.sep;
            }
        }

        return switch (bun.c.clonefileat(
            this.cache_dir.fd,
            this.cache_dir_subpath,
            destination_dir.fd,
            this.destination_dir_subpath,
            0,
        )) {
            0 => .{ .success = {} },
            else => |errno| switch (std.posix.errno(errno)) {
                .XDEV => error.NotSupported, // not same file system
                .OPNOTSUPP => error.NotSupported,
                .NOENT => error.FileNotFound,
                // We first try to delete the directory
                // But, this can happen if this package contains a node_modules folder
                // We want to continue installing as many packages as we can, so we shouldn't block while downloading
                // We use the slow path in this case
                .EXIST => try this.installWithClonefileEachDir(destination_dir),
                .ACCES => return error.AccessDenied,
                else => error.Unexpected,
            },
        };
    }

    const InstallDirState = struct {
        cached_package_dir: std.fs.Dir = undefined,
        walker: Walker = undefined,
        subdir: std.fs.Dir = if (Environment.isWindows) std.fs.Dir{ .fd = std.os.windows.INVALID_HANDLE_VALUE } else undefined,
        buf: bun.windows.WPathBuffer = if (Environment.isWindows) undefined,
        buf2: bun.windows.WPathBuffer = if (Environment.isWindows) undefined,
        to_copy_buf: if (Environment.isWindows) []u16 else void = if (Environment.isWindows) undefined,
        to_copy_buf2: if (Environment.isWindows) []u16 else void = if (Environment.isWindows) undefined,

        pub fn deinit(this: *@This()) void {
            if (!Environment.isWindows) {
                this.subdir.close();
            }
            defer this.walker.deinit();
            defer this.cached_package_dir.close();
        }
    };

    threadlocal var node_fs_for_package_installer: bun.JSC.Node.fs.NodeFS = .{};

    fn initInstallDir(this: *@This(), state: *InstallDirState, destination_dir: std.fs.Dir, method: Method) Result {
        const destbase = destination_dir;
        const destpath = this.destination_dir_subpath;

        state.cached_package_dir = (if (comptime Environment.isWindows)
            if (method == .symlink)
                bun.openDirNoRenamingOrDeletingWindows(.fromStdDir(this.cache_dir), this.cache_dir_subpath)
            else
                bun.openDir(this.cache_dir, this.cache_dir_subpath)
        else
            bun.openDir(this.cache_dir, this.cache_dir_subpath)) catch |err|
            return Result.fail(err, .opening_cache_dir, @errorReturnTrace());

        state.walker = Walker.walk(
            state.cached_package_dir,
            this.allocator,
            &[_]bun.OSPathSlice{},
            if (method == .symlink and this.cache_dir_subpath.len == 1 and this.cache_dir_subpath[0] == '.')
                &[_]bun.OSPathSlice{comptime bun.OSPathLiteral("node_modules")}
            else
                &[_]bun.OSPathSlice{},
        ) catch bun.outOfMemory();

        if (!Environment.isWindows) {
            state.subdir = destbase.makeOpenPath(bun.span(destpath), .{
                .iterate = true,
                .access_sub_paths = true,
            }) catch |err| {
                state.cached_package_dir.close();
                state.walker.deinit();
                return Result.fail(err, .opening_dest_dir, @errorReturnTrace());
            };
            return .success;
        }

        const dest_path_length = bun.windows.GetFinalPathNameByHandleW(destbase.fd, &state.buf, state.buf.len, 0);
        if (dest_path_length == 0) {
            const e = bun.windows.Win32Error.get();
            const err = if (e.toSystemErrno()) |sys_err| bun.errnoToZigErr(sys_err) else error.Unexpected;
            state.cached_package_dir.close();
            state.walker.deinit();
            return Result.fail(err, .opening_dest_dir, null);
        }

        var i: usize = dest_path_length;
        if (state.buf[i] != '\\') {
            state.buf[i] = '\\';
            i += 1;
        }

        i += bun.strings.toWPathNormalized(state.buf[i..], destpath).len;
        state.buf[i] = std.fs.path.sep_windows;
        i += 1;
        state.buf[i] = 0;
        const fullpath = state.buf[0..i :0];

        _ = node_fs_for_package_installer.mkdirRecursiveOSPathImpl(void, {}, fullpath, 0, false);
        state.to_copy_buf = state.buf[fullpath.len..];

        const cache_path_length = bun.windows.GetFinalPathNameByHandleW(state.cached_package_dir.fd, &state.buf2, state.buf2.len, 0);
        if (cache_path_length == 0) {
            const e = bun.windows.Win32Error.get();
            const err = if (e.toSystemErrno()) |sys_err| bun.errnoToZigErr(sys_err) else error.Unexpected;
            state.cached_package_dir.close();
            state.walker.deinit();
            return Result.fail(err, .copying_files, null);
        }
        const cache_path = state.buf2[0..cache_path_length];
        var to_copy_buf2: []u16 = undefined;
        if (state.buf2[cache_path.len - 1] != '\\') {
            state.buf2[cache_path.len] = '\\';
            to_copy_buf2 = state.buf2[cache_path.len + 1 ..];
        } else {
            to_copy_buf2 = state.buf2[cache_path.len..];
        }

        state.to_copy_buf2 = to_copy_buf2;
        return .success;
    }

    fn installWithCopyfile(this: *@This(), destination_dir: std.fs.Dir) Result {
        var state = InstallDirState{};
        const res = this.initInstallDir(&state, destination_dir, .copyfile);
        if (res.isFail()) return res;
        defer state.deinit();

        const FileCopier = struct {
            pub fn copy(
                destination_dir_: std.fs.Dir,
                walker: *Walker,
                progress_: ?*Progress,
                to_copy_into1: if (Environment.isWindows) []u16 else void,
                head1: if (Environment.isWindows) []u16 else void,
                to_copy_into2: if (Environment.isWindows) []u16 else void,
                head2: if (Environment.isWindows) []u16 else void,
            ) !u32 {
                var real_file_count: u32 = 0;

                var copy_file_state: bun.CopyFileState = .{};

                while (try walker.next()) |entry| {
                    if (comptime Environment.isWindows) {
                        switch (entry.kind) {
                            .directory, .file => {},
                            else => continue,
                        }

                        if (entry.path.len > to_copy_into1.len or entry.path.len > to_copy_into2.len) {
                            return error.NameTooLong;
                        }

                        @memcpy(to_copy_into1[0..entry.path.len], entry.path);
                        head1[entry.path.len + (head1.len - to_copy_into1.len)] = 0;
                        const dest: [:0]u16 = head1[0 .. entry.path.len + head1.len - to_copy_into1.len :0];

                        @memcpy(to_copy_into2[0..entry.path.len], entry.path);
                        head2[entry.path.len + (head1.len - to_copy_into2.len)] = 0;
                        const src: [:0]u16 = head2[0 .. entry.path.len + head2.len - to_copy_into2.len :0];

                        switch (entry.kind) {
                            .directory => {
                                if (bun.windows.CreateDirectoryExW(src.ptr, dest.ptr, null) == 0) {
                                    bun.MakePath.makePath(u16, destination_dir_, entry.path) catch {};
                                }
                            },
                            .file => {
                                if (bun.windows.CopyFileW(src.ptr, dest.ptr, 0) == 0) {
                                    if (bun.Dirname.dirname(u16, entry.path)) |entry_dirname| {
                                        bun.MakePath.makePath(u16, destination_dir_, entry_dirname) catch {};
                                        if (bun.windows.CopyFileW(src.ptr, dest.ptr, 0) != 0) {
                                            continue;
                                        }
                                    }

                                    if (progress_) |progress| {
                                        progress.root.end();
                                        progress.refresh();
                                    }

                                    if (bun.windows.Win32Error.get().toSystemErrno()) |err| {
                                        Output.prettyError("<r><red>{s}<r>: copying file {}", .{ @tagName(err), bun.fmt.fmtOSPath(entry.path, .{}) });
                                    } else {
                                        Output.prettyError("<r><red>error<r> copying file {}", .{bun.fmt.fmtOSPath(entry.path, .{})});
                                    }

                                    Global.crash();
                                }
                            },
                            else => unreachable, // handled above
                        }
                    } else {
                        if (entry.kind != .file) continue;
                        real_file_count += 1;
                        const openFile = std.fs.Dir.openFile;
                        const createFile = std.fs.Dir.createFile;

                        var in_file = try openFile(entry.dir, entry.basename, .{ .mode = .read_only });
                        defer in_file.close();

                        debug("createFile {} {s}\n", .{ destination_dir_.fd, entry.path });
                        var outfile = createFile(destination_dir_, entry.path, .{}) catch brk: {
                            if (bun.Dirname.dirname(bun.OSPathChar, entry.path)) |entry_dirname| {
                                bun.MakePath.makePath(bun.OSPathChar, destination_dir_, entry_dirname) catch {};
                            }
                            break :brk createFile(destination_dir_, entry.path, .{}) catch |err| {
                                if (progress_) |progress| {
                                    progress.root.end();
                                    progress.refresh();
                                }

                                Output.prettyErrorln("<r><red>{s}<r>: copying file {}", .{ @errorName(err), bun.fmt.fmtOSPath(entry.path, .{}) });
                                Global.crash();
                            };
                        };
                        defer outfile.close();

                        if (comptime Environment.isPosix) {
                            const stat = in_file.stat() catch continue;
                            _ = bun.c.fchmod(outfile.handle, @intCast(stat.mode));
                        }

                        bun.copyFileWithState(.fromStdFile(in_file), .fromStdFile(outfile), &copy_file_state).unwrap() catch |err| {
                            if (progress_) |progress| {
                                progress.root.end();
                                progress.refresh();
                            }

                            Output.prettyError("<r><red>{s}<r>: copying file {}", .{ @errorName(err), bun.fmt.fmtOSPath(entry.path, .{}) });
                            Global.crash();
                        };
                    }
                }

                return real_file_count;
            }
        };

        this.file_count = FileCopier.copy(
            state.subdir,
            &state.walker,
            this.progress,
            if (Environment.isWindows) state.to_copy_buf else void{},
            if (Environment.isWindows) &state.buf else void{},
            if (Environment.isWindows) state.to_copy_buf2 else void{},
            if (Environment.isWindows) &state.buf2 else void{},
        ) catch |err| return Result.fail(err, .copying_files, @errorReturnTrace());

        return .success;
    }

    fn NewTaskQueue(comptime TaskType: type) type {
        return struct {
            remaining: std.atomic.Value(u32) = std.atomic.Value(u32).init(0),
            errored_task: ?*TaskType = null,
            thread_pool: *ThreadPool,
            wake_value: std.atomic.Value(u32) = std.atomic.Value(u32).init(0),

            pub fn completeOne(this: *@This()) void {
                if (this.remaining.fetchSub(1, .monotonic) == 1) {
                    _ = this.wake_value.fetchAdd(1, .monotonic);
                    bun.Futex.wake(&this.wake_value, std.math.maxInt(u32));
                }
            }

            pub fn push(this: *@This(), task: *TaskType) void {
                _ = this.remaining.fetchAdd(1, .monotonic);
                this.thread_pool.schedule(bun.ThreadPool.Batch.from(&task.task));
            }

            pub fn wait(this: *@This()) void {
                this.wake_value.store(0, .monotonic);
                while (this.remaining.load(.monotonic) > 0) {
                    bun.Futex.wait(&this.wake_value, 0, std.time.ns_per_ms * 5) catch {};
                }
            }
        };
    }

    const HardLinkWindowsInstallTask = struct {
        bytes: []u16,
        src: [:0]bun.OSPathChar,
        dest: [:0]bun.OSPathChar,
        basename: u16,
        task: bun.JSC.WorkPoolTask = .{ .callback = &runFromThreadPool },
        err: ?anyerror = null,

        pub const Queue = NewTaskQueue(@This());
        var queue: Queue = undefined;
        pub fn getQueue() *Queue {
            queue = Queue{
                .thread_pool = &PackageManager.get().thread_pool,
            };
            return &queue;
        }

        pub fn init(src: []const bun.OSPathChar, dest: []const bun.OSPathChar, basename: []const bun.OSPathChar) *@This() {
            const allocation_size =
                (src.len) + 1 + (dest.len) + 1;

            const combined = bun.default_allocator.alloc(u16, allocation_size) catch bun.outOfMemory();
            var remaining = combined;
            @memcpy(remaining[0..src.len], src);
            remaining[src.len] = 0;
            const src_ = remaining[0..src.len :0];
            remaining = remaining[src.len + 1 ..];

            @memcpy(remaining[0..dest.len], dest);
            remaining[dest.len] = 0;
            const dest_ = remaining[0..dest.len :0];
            remaining = remaining[dest.len + 1 ..];

            return @This().new(.{
                .bytes = combined,
                .src = src_,
                .dest = dest_,
                .basename = @truncate(basename.len),
            });
        }

        pub fn runFromThreadPool(task: *bun.JSC.WorkPoolTask) void {
            var iter: *@This() = @fieldParentPtr("task", task);
            defer queue.completeOne();
            if (iter.run()) |err| {
                iter.err = err;
                queue.errored_task = iter;
                return;
            }
            iter.deinit();
        }

        pub fn deinit(task: *@This()) void {
            bun.default_allocator.free(task.bytes);
            bun.destroy(task);
        }

        pub const new = bun.TrivialNew(@This());

        pub fn run(task: *@This()) ?anyerror {
            const src = task.src;
            const dest = task.dest;

            if (bun.windows.CreateHardLinkW(dest.ptr, src.ptr, null) != 0) {
                return null;
            }

            switch (bun.windows.GetLastError()) {
                .ALREADY_EXISTS, .FILE_EXISTS, .CANNOT_MAKE => {
                    // Race condition: this shouldn't happen
                    if (comptime Environment.isDebug)
                        debug(
                            "CreateHardLinkW returned EEXIST, this shouldn't happen: {}",
                            .{bun.fmt.fmtPath(u16, dest, .{})},
                        );
                    _ = bun.windows.DeleteFileW(dest.ptr);
                    if (bun.windows.CreateHardLinkW(dest.ptr, src.ptr, null) != 0) {
                        return null;
                    }
                },
                else => {},
            }

            dest[dest.len - task.basename - 1] = 0;
            const dirpath = dest[0 .. dest.len - task.basename - 1 :0];
            _ = node_fs_for_package_installer.mkdirRecursiveOSPathImpl(void, {}, dirpath, 0, false).unwrap() catch {};
            dest[dest.len - task.basename - 1] = std.fs.path.sep;

            if (bun.windows.CreateHardLinkW(dest.ptr, src.ptr, null) != 0) {
                return null;
            }

            if (PackageManager.verbose_install) {
                const once_log = struct {
                    var once = false;

                    pub fn get() bool {
                        const prev = once;
                        once = true;
                        return !prev;
                    }
                }.get();

                if (once_log) {
                    Output.warn("CreateHardLinkW failed, falling back to CopyFileW: {} -> {}\n", .{
                        bun.fmt.fmtOSPath(src, .{}),
                        bun.fmt.fmtOSPath(dest, .{}),
                    });
                }
            }

            if (bun.windows.CopyFileW(src.ptr, dest.ptr, 0) != 0) {
                return null;
            }

            return bun.windows.getLastError();
        }
    };

    fn installWithHardlink(this: *@This(), dest_dir: std.fs.Dir) !Result {
        var state = InstallDirState{};
        const res = this.initInstallDir(&state, dest_dir, .hardlink);
        if (res.isFail()) return res;
        defer state.deinit();

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
                var queue = if (Environment.isWindows) HardLinkWindowsInstallTask.getQueue();

                while (try walker.next()) |entry| {
                    if (comptime Environment.isPosix) {
                        switch (entry.kind) {
                            .directory => {
                                bun.MakePath.makePath(std.meta.Elem(@TypeOf(entry.path)), destination_dir, entry.path) catch {};
                            },
                            .file => {
                                std.posix.linkat(entry.dir.fd, entry.basename, destination_dir.fd, entry.path, 0) catch |err| {
                                    if (err != error.PathAlreadyExists) {
                                        return err;
                                    }

                                    std.posix.unlinkat(destination_dir.fd, entry.path, 0) catch {};
                                    try std.posix.linkat(entry.dir.fd, entry.basename, destination_dir.fd, entry.path, 0);
                                };

                                real_file_count += 1;
                            },
                            else => {},
                        }
                    } else {
                        switch (entry.kind) {
                            .file => {},
                            else => continue,
                        }

                        if (entry.path.len > to_copy_into1.len or entry.path.len > to_copy_into2.len) {
                            return error.NameTooLong;
                        }

                        @memcpy(to_copy_into1[0..entry.path.len], entry.path);
                        head1[entry.path.len + (head1.len - to_copy_into1.len)] = 0;
                        const dest: [:0]u16 = head1[0 .. entry.path.len + head1.len - to_copy_into1.len :0];

                        @memcpy(to_copy_into2[0..entry.path.len], entry.path);
                        head2[entry.path.len + (head1.len - to_copy_into2.len)] = 0;
                        const src: [:0]u16 = head2[0 .. entry.path.len + head2.len - to_copy_into2.len :0];

                        queue.push(HardLinkWindowsInstallTask.init(src, dest, entry.basename));
                        real_file_count += 1;
                    }
                }

                if (comptime Environment.isWindows) {
                    queue.wait();

                    if (queue.errored_task) |task| {
                        if (task.err) |err| {
                            return err;
                        }
                    }
                }

                return real_file_count;
            }
        };

        this.file_count = FileCopier.copy(
            state.subdir,
            &state.walker,
            state.to_copy_buf,
            if (Environment.isWindows) &state.buf else void{},
            state.to_copy_buf2,
            if (Environment.isWindows) &state.buf2 else void{},
        ) catch |err| {
            bun.handleErrorReturnTrace(err, @errorReturnTrace());

            if (comptime Environment.isWindows) {
                if (err == error.FailedToCopyFile) {
                    return Result.fail(err, .copying_files, @errorReturnTrace());
                }
            } else if (err == error.NotSameFileSystem or err == error.ENXIO) {
                return err;
            }

            return Result.fail(err, .copying_files, @errorReturnTrace());
        };

        return .success;
    }

    fn installWithSymlink(this: *@This(), dest_dir: std.fs.Dir) !Result {
        var state = InstallDirState{};
        const res = this.initInstallDir(&state, dest_dir, .symlink);
        if (res.isFail()) return res;
        defer state.deinit();

        var buf2: bun.PathBuffer = undefined;
        var to_copy_buf2: []u8 = undefined;
        if (Environment.isPosix) {
            const cache_dir_path = try bun.FD.fromStdDir(state.cached_package_dir).getFdPath(&buf2);
            if (cache_dir_path.len > 0 and cache_dir_path[cache_dir_path.len - 1] != std.fs.path.sep) {
                buf2[cache_dir_path.len] = std.fs.path.sep;
                to_copy_buf2 = buf2[cache_dir_path.len + 1 ..];
            } else {
                to_copy_buf2 = buf2[cache_dir_path.len..];
            }
        }

        const FileCopier = struct {
            pub fn copy(
                destination_dir: std.fs.Dir,
                walker: *Walker,
                to_copy_into1: if (Environment.isWindows) []u16 else void,
                head1: if (Environment.isWindows) []u16 else void,
                to_copy_into2: []if (Environment.isWindows) u16 else u8,
                head2: []if (Environment.isWindows) u16 else u8,
            ) !u32 {
                var real_file_count: u32 = 0;
                while (try walker.next()) |entry| {
                    if (comptime Environment.isPosix) {
                        switch (entry.kind) {
                            .directory => {
                                bun.MakePath.makePath(std.meta.Elem(@TypeOf(entry.path)), destination_dir, entry.path) catch {};
                            },
                            .file => {
                                @memcpy(to_copy_into2[0..entry.path.len], entry.path);
                                head2[entry.path.len + (head2.len - to_copy_into2.len)] = 0;
                                const target: [:0]u8 = head2[0 .. entry.path.len + head2.len - to_copy_into2.len :0];

                                std.posix.symlinkat(target, destination_dir.fd, entry.path) catch |err| {
                                    if (err != error.PathAlreadyExists) {
                                        return err;
                                    }

                                    std.posix.unlinkat(destination_dir.fd, entry.path, 0) catch {};
                                    try std.posix.symlinkat(entry.basename, destination_dir.fd, entry.path);
                                };

                                real_file_count += 1;
                            },
                            else => {},
                        }
                    } else {
                        switch (entry.kind) {
                            .directory, .file => {},
                            else => continue,
                        }

                        if (entry.path.len > to_copy_into1.len or entry.path.len > to_copy_into2.len) {
                            return error.NameTooLong;
                        }

                        @memcpy(to_copy_into1[0..entry.path.len], entry.path);
                        head1[entry.path.len + (head1.len - to_copy_into1.len)] = 0;
                        const dest: [:0]u16 = head1[0 .. entry.path.len + head1.len - to_copy_into1.len :0];

                        @memcpy(to_copy_into2[0..entry.path.len], entry.path);
                        head2[entry.path.len + (head1.len - to_copy_into2.len)] = 0;
                        const src: [:0]u16 = head2[0 .. entry.path.len + head2.len - to_copy_into2.len :0];

                        switch (entry.kind) {
                            .directory => {
                                if (bun.windows.CreateDirectoryExW(src.ptr, dest.ptr, null) == 0) {
                                    bun.MakePath.makePath(u16, destination_dir, entry.path) catch {};
                                }
                            },
                            .file => {
                                switch (bun.sys.symlinkW(dest, src, .{})) {
                                    .err => |err| {
                                        if (bun.Dirname.dirname(u16, entry.path)) |entry_dirname| {
                                            bun.MakePath.makePath(u16, destination_dir, entry_dirname) catch {};
                                            if (bun.sys.symlinkW(dest, src, .{}) == .result) {
                                                continue;
                                            }
                                        }

                                        if (PackageManager.verbose_install) {
                                            const once_log = struct {
                                                var once = false;

                                                pub fn get() bool {
                                                    const prev = once;
                                                    once = true;
                                                    return !prev;
                                                }
                                            }.get();

                                            if (once_log) {
                                                Output.warn("CreateHardLinkW failed, falling back to CopyFileW: {} -> {}\n", .{
                                                    bun.fmt.fmtOSPath(src, .{}),
                                                    bun.fmt.fmtOSPath(dest, .{}),
                                                });
                                            }
                                        }

                                        return bun.errnoToZigErr(err.errno);
                                    },
                                    .result => {},
                                }
                            },
                            else => unreachable, // handled above
                        }
                    }
                }

                return real_file_count;
            }
        };

        this.file_count = FileCopier.copy(
            state.subdir,
            &state.walker,
            if (Environment.isWindows) state.to_copy_buf else void{},
            if (Environment.isWindows) &state.buf else void{},
            if (Environment.isWindows) state.to_copy_buf2 else to_copy_buf2,
            if (Environment.isWindows) &state.buf2 else &buf2,
        ) catch |err| {
            if (comptime Environment.isWindows) {
                if (err == error.FailedToCopyFile) {
                    return Result.fail(err, .copying_files, @errorReturnTrace());
                }
            } else if (err == error.NotSameFileSystem or err == error.ENXIO) {
                return err;
            }
            return Result.fail(err, .copying_files, @errorReturnTrace());
        };

        return .success;
    }

    pub fn uninstall(this: *@This(), destination_dir: std.fs.Dir) void {
        destination_dir.deleteTree(bun.span(this.destination_dir_subpath)) catch {};
    }

    pub fn uninstallBeforeInstall(this: *@This(), destination_dir: std.fs.Dir) void {
        var rand_path_buf: [48]u8 = undefined;
        const temp_path = std.fmt.bufPrintZ(&rand_path_buf, ".old-{}", .{std.fmt.fmtSliceHexUpper(std.mem.asBytes(&bun.fastRandom()))}) catch unreachable;
        switch (bun.sys.renameat(
            .fromStdDir(destination_dir),
            this.destination_dir_subpath,
            .fromStdDir(destination_dir),
            temp_path,
        )) {
            .err => {
                // if it fails, that means the directory doesn't exist or was inaccessible
            },
            .result => {
                // Uninstall can sometimes take awhile in a large directory
                // tree. Since we're renaming the directory to a randomly
                // generated name, we can delete it in another thread without
                // worrying about race conditions or blocking the main thread.
                //
                // This should be a slight improvement to CI environments.
                //
                // on macOS ARM64 in a project with Gatsby, @mui/icons-material, and Next.js:
                //
                // ❯ hyperfine "bun install --ignore-scripts" "bun-1.1.2 install --ignore-scripts" --prepare="rm -rf node_modules/**/package.json" --warmup=2
                // Benchmark 1: bun install --ignore-scripts
                //   Time (mean ± σ):      2.281 s ±  0.027 s    [User: 0.041 s, System: 6.851 s]
                //   Range (min … max):    2.231 s …  2.312 s    10 runs
                //
                // Benchmark 2: bun-1.1.2 install --ignore-scripts
                //   Time (mean ± σ):      3.315 s ±  0.033 s    [User: 0.029 s, System: 2.237 s]
                //   Range (min … max):    3.279 s …  3.356 s    10 runs
                //
                // Summary
                //   bun install --ignore-scripts ran
                //     1.45 ± 0.02 times faster than bun-1.1.2 install --ignore-scripts
                //

                const UninstallTask = struct {
                    pub const new = bun.TrivialNew(@This());

                    absolute_path: []const u8,
                    task: JSC.WorkPoolTask = .{ .callback = &run },

                    pub fn run(task: *JSC.WorkPoolTask) void {
                        var unintall_task: *@This() = @fieldParentPtr("task", task);
                        var debug_timer = bun.Output.DebugTimer.start();
                        defer {
                            _ = PackageManager.get().decrementPendingTasks();
                            PackageManager.get().wake();
                        }

                        defer unintall_task.deinit();
                        const dirname = std.fs.path.dirname(unintall_task.absolute_path) orelse {
                            Output.debugWarn("Unexpectedly failed to get dirname of {s}", .{unintall_task.absolute_path});
                            return;
                        };
                        const basename = std.fs.path.basename(unintall_task.absolute_path);

                        var dir = bun.openDirA(std.fs.cwd(), dirname) catch |err| {
                            if (comptime Environment.isDebug or Environment.enable_asan) {
                                Output.debugWarn("Failed to delete {s}: {s}", .{ unintall_task.absolute_path, @errorName(err) });
                            }
                            return;
                        };
                        defer bun.FD.fromStdDir(dir).close();

                        dir.deleteTree(basename) catch |err| {
                            if (comptime Environment.isDebug or Environment.enable_asan) {
                                Output.debugWarn("Failed to delete {s} in {s}: {s}", .{ basename, dirname, @errorName(err) });
                            }
                        };

                        if (Environment.isDebug) {
                            _ = &debug_timer;
                            debug("deleteTree({s}, {s}) = {}", .{ basename, dirname, debug_timer });
                        }
                    }

                    pub fn deinit(uninstall_task: *@This()) void {
                        bun.default_allocator.free(uninstall_task.absolute_path);
                        bun.destroy(uninstall_task);
                    }
                };
                var task = UninstallTask.new(.{
                    .absolute_path = bun.default_allocator.dupeZ(u8, bun.path.joinAbsString(FileSystem.instance.top_level_dir, &.{ this.node_modules.path.items, temp_path }, .auto)) catch bun.outOfMemory(),
                });
                PackageManager.get().thread_pool.schedule(bun.ThreadPool.Batch.from(&task.task));
                _ = PackageManager.get().incrementPendingTasks(1);
            },
        }
    }

    pub fn isDanglingSymlink(path: [:0]const u8) bool {
        if (comptime Environment.isLinux) {
            switch (Syscall.open(path, bun.O.PATH, @as(u32, 0))) {
                .err => return true,
                .result => |fd| {
                    fd.close();
                    return false;
                },
            }
        } else if (comptime Environment.isWindows) {
            switch (bun.sys.sys_uv.open(path, 0, 0)) {
                .err => {
                    return true;
                },
                .result => |fd| {
                    fd.close();
                    return false;
                },
            }
        } else {
            switch (Syscall.open(path, bun.O.PATH, @as(u32, 0))) {
                .err => return true,
                .result => |fd| {
                    fd.close();
                    return false;
                },
            }
        }
    }

    pub fn isDanglingWindowsBinLink(node_mod_fd: bun.FileDescriptor, path: []const u16, temp_buffer: []u8) bool {
        const WinBinLinkingShim = @import("./windows-shim/BinLinkingShim.zig");
        const bin_path = bin_path: {
            const fd = bun.sys.openatWindows(node_mod_fd, path, bun.O.RDONLY).unwrap() catch return true;
            defer fd.close();
            const size = fd.stdFile().readAll(temp_buffer) catch return true;
            const decoded = WinBinLinkingShim.looseDecode(temp_buffer[0..size]) orelse return true;
            bun.assert(decoded.flags.isValid()); // looseDecode ensures valid flags
            break :bin_path decoded.bin_path;
        };

        {
            const fd = bun.sys.openatWindows(node_mod_fd, bin_path, bun.O.RDONLY).unwrap() catch return true;
            fd.close();
        }

        return false;
    }

    pub fn installFromLink(this: *@This(), skip_delete: bool, destination_dir: std.fs.Dir) Result {
        const dest_path = this.destination_dir_subpath;
        // If this fails, we don't care.
        // we'll catch it the next error
        if (!skip_delete and !strings.eqlComptime(dest_path, ".")) this.uninstallBeforeInstall(destination_dir);

        const subdir = std.fs.path.dirname(dest_path);

        var dest_buf: bun.PathBuffer = undefined;
        // cache_dir_subpath in here is actually the full path to the symlink pointing to the linked package
        const symlinked_path = this.cache_dir_subpath;
        var to_buf: bun.PathBuffer = undefined;
        const to_path = this.cache_dir.realpath(symlinked_path, &to_buf) catch |err|
            return Result.fail(err, .linking_dependency, @errorReturnTrace());

        const dest = std.fs.path.basename(dest_path);
        // When we're linking on Windows, we want to avoid keeping the source directory handle open
        if (comptime Environment.isWindows) {
            var wbuf: bun.WPathBuffer = undefined;
            const dest_path_length = bun.windows.GetFinalPathNameByHandleW(destination_dir.fd, &wbuf, dest_buf.len, 0);
            if (dest_path_length == 0) {
                const e = bun.windows.Win32Error.get();
                const err = if (e.toSystemErrno()) |sys_err| bun.errnoToZigErr(sys_err) else error.Unexpected;
                return Result.fail(err, .linking_dependency, null);
            }

            var i: usize = dest_path_length;
            if (wbuf[i] != '\\') {
                wbuf[i] = '\\';
                i += 1;
            }

            if (subdir) |dir| {
                i += bun.strings.toWPathNormalized(wbuf[i..], dir).len;
                wbuf[i] = std.fs.path.sep_windows;
                i += 1;
                wbuf[i] = 0;
                const fullpath = wbuf[0..i :0];

                _ = node_fs_for_package_installer.mkdirRecursiveOSPathImpl(void, {}, fullpath, 0, false);
            }

            const res = strings.copyUTF16IntoUTF8(dest_buf[0..], []const u16, wbuf[0..i], true);
            var offset: usize = res.written;
            if (dest_buf[offset - 1] != std.fs.path.sep_windows) {
                dest_buf[offset] = std.fs.path.sep_windows;
                offset += 1;
            }
            @memcpy(dest_buf[offset .. offset + dest.len], dest);
            offset += dest.len;
            dest_buf[offset] = 0;

            const dest_z = dest_buf[0..offset :0];

            to_buf[to_path.len] = 0;
            const target_z = to_buf[0..to_path.len :0];

            // https://github.com/npm/cli/blob/162c82e845d410ede643466f9f8af78a312296cc/workspaces/arborist/lib/arborist/reify.js#L738
            // https://github.com/npm/cli/commit/0e58e6f6b8f0cd62294642a502c17561aaf46553
            switch (bun.sys.symlinkOrJunction(dest_z, target_z)) {
                .err => |err_| brk: {
                    var err = err_;
                    if (err.getErrno() == .EXIST) {
                        _ = bun.sys.rmdirat(.fromStdDir(destination_dir), this.destination_dir_subpath);
                        switch (bun.sys.symlinkOrJunction(dest_z, target_z)) {
                            .err => |e| err = e,
                            .result => break :brk,
                        }
                    }

                    return Result.fail(bun.errnoToZigErr(err.errno), .linking_dependency, null);
                },
                .result => {},
            }
        } else {
            var dest_dir = if (subdir) |dir| brk: {
                break :brk bun.MakePath.makeOpenPath(destination_dir, dir, .{}) catch |err| return Result.fail(err, .linking_dependency, @errorReturnTrace());
            } else destination_dir;
            defer {
                if (subdir != null) dest_dir.close();
            }

            const dest_dir_path = bun.getFdPath(.fromStdDir(dest_dir), &dest_buf) catch |err| return Result.fail(err, .linking_dependency, @errorReturnTrace());

            const target = Path.relative(dest_dir_path, to_path);
            std.posix.symlinkat(target, dest_dir.fd, dest) catch |err| return Result.fail(err, .linking_dependency, null);
        }

        if (isDanglingSymlink(symlinked_path)) return Result.fail(error.DanglingSymlink, .linking_dependency, @errorReturnTrace());

        return .success;
    }

    pub fn getInstallMethod(this: *const @This()) Method {
        return if (strings.eqlComptime(this.cache_dir_subpath, ".") or strings.hasPrefixComptime(this.cache_dir_subpath, ".."))
            Method.symlink
        else
            supported_method;
    }

    pub fn packageMissingFromCache(this: *@This(), manager: *PackageManager, package_id: PackageID, resolution_tag: Resolution.Tag) bool {
        const state = manager.getPreinstallState(package_id);
        return switch (state) {
            .done => false,
            else => brk: {
                if (this.patch.isNull()) {
                    const exists = switch (resolution_tag) {
                        .npm => package_json_exists: {
                            var buf = &PackageManager.cached_package_folder_name_buf;

                            if (comptime Environment.isDebug) {
                                bun.assertWithLocation(bun.isSliceInBuffer(this.cache_dir_subpath, buf), @src());
                            }

                            const subpath_len = strings.withoutTrailingSlash(this.cache_dir_subpath).len;
                            buf[subpath_len] = std.fs.path.sep;
                            defer buf[subpath_len] = 0;
                            @memcpy(buf[subpath_len + 1 ..][0.."package.json\x00".len], "package.json\x00");
                            const subpath = buf[0 .. subpath_len + 1 + "package.json".len :0];
                            break :package_json_exists Syscall.existsAt(.fromStdDir(this.cache_dir), subpath);
                        },
                        else => Syscall.directoryExistsAt(.fromStdDir(this.cache_dir), this.cache_dir_subpath).unwrap() catch false,
                    };
                    if (exists) manager.setPreinstallState(package_id, manager.lockfile, .done);
                    break :brk !exists;
                }
                const cache_dir_subpath_without_patch_hash = this.cache_dir_subpath[0 .. std.mem.lastIndexOf(u8, this.cache_dir_subpath, "_patch_hash=") orelse @panic("Patched dependency cache dir subpath does not have the \"_patch_hash=HASH\" suffix. This is a bug, please file a GitHub issue.")];
                @memcpy(bun.path.join_buf[0..cache_dir_subpath_without_patch_hash.len], cache_dir_subpath_without_patch_hash);
                bun.path.join_buf[cache_dir_subpath_without_patch_hash.len] = 0;
                const exists = Syscall.directoryExistsAt(.fromStdDir(this.cache_dir), bun.path.join_buf[0..cache_dir_subpath_without_patch_hash.len :0]).unwrap() catch false;
                if (exists) manager.setPreinstallState(package_id, manager.lockfile, .done);
                break :brk !exists;
            },
        };
    }

    pub fn patchedPackageMissingFromCache(this: *@This(), manager: *PackageManager, package_id: PackageID) bool {
        const exists = Syscall.directoryExistsAt(.fromStdDir(this.cache_dir), this.cache_dir_subpath).unwrap() catch false;
        if (exists) manager.setPreinstallState(package_id, manager.lockfile, .done);
        return !exists;
    }

    pub fn install(this: *@This(), skip_delete: bool, destination_dir: std.fs.Dir, method_: Method, resolution_tag: Resolution.Tag) Result {
        const tracer = bun.perf.trace("PackageInstaller.install");
        defer tracer.end();

        // If this fails, we don't care.
        // we'll catch it the next error
        if (!skip_delete and !strings.eqlComptime(this.destination_dir_subpath, ".")) this.uninstallBeforeInstall(destination_dir);

        var supported_method_to_use = method_;

        if (resolution_tag == .folder and !this.lockfile.isWorkspaceTreeId(this.node_modules.tree_id)) {
            supported_method_to_use = .symlink;
        }

        switch (supported_method_to_use) {
            .clonefile => {
                if (comptime Environment.isMac) {

                    // First, attempt to use clonefile
                    // if that fails due to ENOTSUP, mark it as unsupported and then fall back to copyfile
                    if (this.installWithClonefile(destination_dir)) |result| {
                        return result;
                    } else |err| {
                        switch (err) {
                            error.NotSupported => {
                                supported_method = .copyfile;
                                supported_method_to_use = .copyfile;
                            },
                            error.FileNotFound => return Result.fail(error.FileNotFound, .opening_cache_dir, @errorReturnTrace()),
                            else => return Result.fail(err, .copying_files, @errorReturnTrace()),
                        }
                    }
                }
            },
            .clonefile_each_dir => {
                if (comptime Environment.isMac) {
                    if (this.installWithClonefileEachDir(destination_dir)) |result| {
                        return result;
                    } else |err| {
                        switch (err) {
                            error.NotSupported => {
                                supported_method = .copyfile;
                                supported_method_to_use = .copyfile;
                            },
                            error.FileNotFound => return Result.fail(error.FileNotFound, .opening_cache_dir, @errorReturnTrace()),
                            else => return Result.fail(err, .copying_files, @errorReturnTrace()),
                        }
                    }
                }
            },
            .hardlink => {
                if (this.installWithHardlink(destination_dir)) |result| {
                    return result;
                } else |err| outer: {
                    if (comptime !Environment.isWindows) {
                        if (err == error.NotSameFileSystem) {
                            supported_method = .copyfile;
                            supported_method_to_use = .copyfile;
                            break :outer;
                        }
                    }

                    return switch (err) {
                        error.FileNotFound => Result.fail(error.FileNotFound, .opening_cache_dir, @errorReturnTrace()),
                        else => Result.fail(err, .copying_files, @errorReturnTrace()),
                    };
                }
            },
            .symlink => {
                return this.installWithSymlink(destination_dir) catch |err| {
                    return switch (err) {
                        error.FileNotFound => Result.fail(err, .opening_cache_dir, @errorReturnTrace()),
                        else => Result.fail(err, .copying_files, @errorReturnTrace()),
                    };
                };
            },
            else => {},
        }

        if (supported_method_to_use != .copyfile) return .success;

        // TODO: linux io_uring
        return this.installWithCopyfile(destination_dir);
    }
};
