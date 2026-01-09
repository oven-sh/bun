const Fs = @This();

pub const debug = Output.scoped(.fs, .hidden);

// pub const FilesystemImplementation = @import("./fs_impl.zig");

pub const Preallocate = struct {
    pub const Counts = struct {
        pub const dir_entry: usize = 2048;
        pub const files: usize = 4096;
    };
};

pub const FileSystem = struct {
    top_level_dir: stringZ,

    // used on subsequent updates
    top_level_dir_buf: bun.PathBuffer = undefined,

    fs: Implementation,

    dirname_store: *DirnameStore,
    filename_store: *FilenameStore,

    threadlocal var tmpdir_handle: ?std.fs.Dir = null;

    pub fn topLevelDirWithoutTrailingSlash(this: *const FileSystem) []const u8 {
        if (this.top_level_dir.len > 1 and this.top_level_dir[this.top_level_dir.len - 1] == std.fs.path.sep) {
            return this.top_level_dir[0 .. this.top_level_dir.len - 1];
        } else {
            return this.top_level_dir;
        }
    }

    pub fn tmpdir(fs: *FileSystem) !std.fs.Dir {
        if (tmpdir_handle == null) {
            tmpdir_handle = try fs.fs.openTmpDir();
        }

        return tmpdir_handle.?;
    }

    pub fn getFdPath(this: *const FileSystem, fd: FileDescriptor) ![]const u8 {
        var buf: bun.PathBuffer = undefined;
        const dir = try bun.getFdPath(fd, &buf);
        return try this.dirname_store.append([]u8, dir);
    }

    var tmpname_id_number = std.atomic.Value(u32).init(0);
    pub fn tmpname(extname: string, buf: []u8, hash: u64) std.fmt.BufPrintError![:0]u8 {
        const hex_value = @as(u64, @truncate(@as(u128, @intCast(hash)) | @as(u128, @intCast(std.time.nanoTimestamp()))));

        return try std.fmt.bufPrintZ(buf, ".{f}-{f}.{s}", .{
            bun.fmt.hexIntLower(hex_value),
            bun.fmt.hexIntUpper(tmpname_id_number.fetchAdd(1, .monotonic)),
            extname,
        });
    }

    pub var max_fd: std.posix.fd_t = 0;

    pub inline fn setMaxFd(fd: std.posix.fd_t) void {
        if (Environment.isWindows) {
            return;
        }

        if (!FeatureFlags.store_file_descriptors) {
            return;
        }

        max_fd = @max(fd, max_fd);
    }
    pub var instance_loaded: bool = false;
    pub var instance: FileSystem = undefined;

    pub const DirnameStore = allocators.BSSStringList(Preallocate.Counts.dir_entry, 128);
    pub const FilenameStore = allocators.BSSStringList(Preallocate.Counts.files, 64);

    pub const Error = error{
        ENOENT,
        EACCESS,
        INVALID_NAME,
        ENOTDIR,
    };

    pub fn init(top_level_dir: ?stringZ) !*FileSystem {
        return initWithForce(top_level_dir, false);
    }

    pub fn initWithForce(top_level_dir_: ?stringZ, comptime force: bool) !*FileSystem {
        const allocator = bun.default_allocator;
        var top_level_dir = top_level_dir_ orelse (if (Environment.isBrowser) "/project/" else try bun.getcwdAlloc(allocator));
        _ = &top_level_dir;

        if (!instance_loaded or force) {
            instance = FileSystem{
                .top_level_dir = top_level_dir,
                .fs = Implementation.init(top_level_dir),
                // must always use default_allocator since the other allocators may not be threadsafe when an element resizes
                .dirname_store = DirnameStore.init(bun.default_allocator),
                .filename_store = FilenameStore.init(bun.default_allocator),
            };
            instance_loaded = true;

            _ = DirEntry.EntryStore.init(allocator);
        }

        return &instance;
    }

    pub fn deinit(this: *const FileSystem) void {
        this.dirname_store.deinit();
        this.filename_store.deinit();
    }

    pub const DirEntry = struct {
        pub const EntryMap = bun.StringHashMapUnmanaged(*Entry);
        pub const EntryStore = allocators.BSSList(Entry, Preallocate.Counts.files);

        dir: string,
        fd: FD = .invalid,
        generation: bun.Generation = 0,
        data: EntryMap,

        // pub fn removeEntry(dir: *DirEntry, name: string) !void {
        //     // dir.data.remove(name);
        // }

        pub fn addEntry(dir: *DirEntry, prev_map: ?*EntryMap, entry: *const bun.DirIterator.IteratorResult, allocator: std.mem.Allocator, comptime Iterator: type, iterator: Iterator) !void {
            const name_slice = entry.name.slice();
            const found_kind: ?Entry.Kind = switch (entry.kind) {
                .directory => .dir,
                .file => .file,

                // For a symlink, we will need to stat the target later
                .sym_link,
                // Some filesystems return `.unknown` from getdents() no matter the actual kind of the file
                // (often because it would be slow to look up the kind). If we get this, then code that
                // needs the kind will have to find it out later by calling stat().
                .unknown,
                => null,

                .block_device,
                .character_device,
                .named_pipe,
                .unix_domain_socket,
                .whiteout,
                .door,
                .event_port,
                => return,
            };

            const stored = try brk: {
                if (prev_map) |map| {
                    var stack_fallback = std.heap.stackFallback(512, allocator);
                    const stack = stack_fallback.get();
                    const prehashed = bun.StringHashMapContext.PrehashedCaseInsensitive.init(stack, name_slice);
                    defer prehashed.deinit(stack);
                    if (map.getAdapted(name_slice, prehashed)) |existing| {
                        existing.mutex.lock();
                        defer existing.mutex.unlock();
                        existing.dir = dir.dir;

                        existing.need_stat = existing.need_stat or
                            found_kind == null or
                            existing.cache.kind != found_kind;
                        // TODO: is this right?
                        if (existing.cache.kind != found_kind) {
                            // if found_kind is null, we have set need_stat above, so we
                            // store an arbitrary kind
                            existing.cache.kind = found_kind orelse .file;

                            existing.cache.symlink = PathString.empty;
                        }
                        break :brk existing;
                    }
                }

                // name_slice only lives for the duration of the iteration
                const name = try strings.StringOrTinyString.initAppendIfNeeded(
                    name_slice,
                    *FileSystem.FilenameStore,
                    FileSystem.FilenameStore.instance,
                );

                const name_lowercased = try strings.StringOrTinyString.initLowerCaseAppendIfNeeded(
                    name_slice,
                    *FileSystem.FilenameStore,
                    FileSystem.FilenameStore.instance,
                );

                break :brk EntryStore.instance.append(.{
                    .base_ = name,
                    .base_lowercase_ = name_lowercased,
                    .dir = dir.dir,
                    .mutex = .{},
                    // Call "stat" lazily for performance. The "@material-ui/icons" package
                    // contains a directory with over 11,000 entries in it and running "stat"
                    // for each entry was a big performance issue for that package.
                    .need_stat = found_kind == null,
                    .cache = .{
                        .symlink = PathString.empty,
                        // if found_kind is null, we have set need_stat above, so we
                        // store an arbitrary kind
                        .kind = found_kind orelse .file,
                    },
                });
            };

            const stored_name = stored.base();

            try dir.data.put(allocator, stored.base_lowercase(), stored);

            if (comptime Iterator != void) {
                iterator.next(stored, dir.fd);
            }

            if (comptime FeatureFlags.verbose_fs) {
                if (found_kind == .dir) {
                    Output.prettyln("   + {s}/", .{stored_name});
                } else {
                    Output.prettyln("   + {s}", .{stored_name});
                }
            }
        }

        pub fn init(dir: string, generation: bun.Generation) DirEntry {
            if (comptime FeatureFlags.verbose_fs) {
                Output.prettyln("\n  {s}", .{dir});
            }

            return .{
                .dir = dir,
                .data = .{},
                .generation = generation,
            };
        }

        pub const Err = struct {
            original_err: anyerror,
            canonical_error: anyerror,
        };

        pub fn deinit(d: *DirEntry, allocator: std.mem.Allocator) void {
            d.data.deinit(allocator);
            allocator.free(d.dir);
        }

        pub fn get(entry: *const DirEntry, _query: string) ?Entry.Lookup {
            if (_query.len == 0 or _query.len > bun.MAX_PATH_BYTES) return null;
            var scratch_lookup_buffer: bun.PathBuffer = undefined;

            const query = strings.copyLowercaseIfNeeded(_query, &scratch_lookup_buffer);
            const result = entry.data.get(query) orelse return null;
            const basename = result.base();
            if (!strings.eqlLong(basename, _query, true)) {
                return Entry.Lookup{ .entry = result, .diff_case = Entry.Lookup.DifferentCase{
                    .dir = entry.dir,
                    .query = _query,
                    .actual = basename,
                } };
            }

            return Entry.Lookup{ .entry = result, .diff_case = null };
        }

        pub fn getComptimeQuery(entry: *const DirEntry, comptime query_str: anytype) ?Entry.Lookup {
            comptime var query_var: [query_str.len]u8 = undefined;
            comptime for (query_str, 0..) |c, i| {
                query_var[i] = std.ascii.toLower(c);
            };

            const query_hashed = comptime std.hash_map.hashString(&query_var);
            const query = query_var[0..query_str.len].*;

            const result = entry.data.getAdapted(
                @as([]const u8, &query),
                struct {
                    pub fn hash(_: @This(), _: []const u8) @TypeOf(query_hashed) {
                        return query_hashed;
                    }

                    pub fn eql(_: @This(), _: []const u8, b: []const u8) bool {
                        return strings.eqlComptime(b, query);
                    }
                }{},
            ) orelse return null;

            const basename = result.base();

            if (!strings.eqlComptime(basename, comptime query[0..query_str.len])) {
                return Entry.Lookup{
                    .entry = result,
                    .diff_case = Entry.Lookup.DifferentCase{
                        .dir = entry.dir,
                        .query = &query,
                        .actual = basename,
                    },
                };
            }

            return Entry.Lookup{ .entry = result, .diff_case = null };
        }

        pub fn hasComptimeQuery(entry: *const DirEntry, comptime query_str: anytype) bool {
            comptime var query_var: [query_str.len]u8 = undefined;
            comptime for (query_str, 0..) |c, i| {
                query_var[i] = std.ascii.toLower(c);
            };
            const query = query_var[0..query_str.len].*;

            const query_hashed = comptime std.hash_map.hashString(&query);

            return entry.data.containsAdapted(
                @as([]const u8, &query),
                struct {
                    pub fn hash(_: @This(), _: []const u8) @TypeOf(query_hashed) {
                        return query_hashed;
                    }

                    pub fn eql(_: @This(), _: []const u8, b: []const u8) bool {
                        return strings.eqlComptime(b, &query);
                    }
                }{},
            );
        }
    };

    pub const Entry = struct {
        cache: Cache = .{},
        dir: string,

        base_: strings.StringOrTinyString,

        // Necessary because the hash table uses it as a key
        base_lowercase_: strings.StringOrTinyString,

        mutex: Mutex,
        need_stat: bool = true,

        abs_path: PathString = PathString.empty,

        pub inline fn base(this: *Entry) string {
            return this.base_.slice();
        }

        pub inline fn base_lowercase(this: *Entry) string {
            return this.base_lowercase_.slice();
        }

        pub const Lookup = struct {
            entry: *Entry,
            diff_case: ?DifferentCase,

            pub const DifferentCase = struct {
                dir: string,
                query: string,
                actual: string,
            };
        };

        pub fn deinit(e: *Entry, allocator: std.mem.Allocator) void {
            e.base_.deinit(allocator);

            allocator.free(e.dir);
            allocator.free(e.cache.symlink.slice());
            allocator.destroy(e);
        }

        pub const Cache = struct {
            symlink: PathString = PathString.empty,
            /// Too much code expects this to be 0
            /// don't make it bun.invalid_fd
            fd: FD = .invalid,
            kind: Kind = .file,
        };

        pub const Kind = enum {
            dir,
            file,
        };

        pub fn kind(entry: *Entry, fs: *Implementation, store_fd: bool) Kind {
            if (entry.need_stat) {
                entry.need_stat = false;
                // This is technically incorrect, but we are choosing not to handle errors here
                entry.cache = fs.kind(entry.dir, entry.base(), entry.cache.fd, store_fd) catch return entry.cache.kind;
            }
            return entry.cache.kind;
        }

        pub fn symlink(entry: *Entry, fs: *Implementation, store_fd: bool) string {
            if (entry.need_stat) {
                entry.need_stat = false;
                // This is technically incorrect, but we are choosing not to handle errors here
                // This error can happen if the file was deleted between the time the directory was scanned and the time it was read
                entry.cache = fs.kind(entry.dir, entry.base(), entry.cache.fd, store_fd) catch return "";
            }
            return entry.cache.symlink.slice();
        }
    };

    // pub fn statBatch(fs: *FileSystemEntry, paths: []string) ![]?Stat {

    // }
    // pub fn stat(fs: *FileSystemEntry, path: string) !Stat {

    // }
    // pub fn readFile(fs: *FileSystemEntry, path: string) ?string {

    // }
    // pub fn readDir(fs: *FileSystemEntry, path: string) ?[]string {

    // }
    pub fn normalize(_: *@This(), str: string) string {
        return @call(bun.callmod_inline, path_handler.normalizeString, .{ str, true, bun.path.Platform.auto });
    }

    pub fn normalizeBuf(_: *@This(), buf: []u8, str: string) string {
        return @call(bun.callmod_inline, path_handler.normalizeStringBuf, .{ str, buf, false, bun.path.Platform.auto, false });
    }

    pub fn join(_: *@This(), parts: anytype) string {
        return @call(bun.callmod_inline, path_handler.joinStringBuf, .{
            &join_buf,
            parts,
            bun.path.Platform.loose,
        });
    }

    pub fn joinBuf(_: *@This(), parts: anytype, buf: []u8) string {
        return @call(bun.callmod_inline, path_handler.joinStringBuf, .{
            buf,
            parts,
            bun.path.Platform.loose,
        });
    }

    pub fn relative(_: *@This(), from: string, to: string) string {
        return @call(bun.callmod_inline, path_handler.relative, .{
            from,
            to,
        });
    }

    pub fn relativePlatform(_: *@This(), from: string, to: string, comptime platform: path_handler.Platform) string {
        return @call(bun.callmod_inline, path_handler.relativePlatform, .{
            from,
            to,
            platform,
            false,
        });
    }

    pub fn relativeTo(f: *@This(), to: string) string {
        return @call(bun.callmod_inline, path_handler.relative, .{
            f.top_level_dir,
            to,
        });
    }

    pub fn relativeFrom(f: *@This(), from: string) string {
        return @call(bun.callmod_inline, path_handler.relative, .{
            from,
            f.top_level_dir,
        });
    }

    pub fn absAlloc(f: *@This(), allocator: std.mem.Allocator, parts: anytype) !string {
        const joined = path_handler.joinAbsString(
            f.top_level_dir,
            parts,
            .loose,
        );
        return try allocator.dupe(u8, joined);
    }

    pub fn absAllocZ(f: *@This(), allocator: std.mem.Allocator, parts: anytype) ![*:0]const u8 {
        const joined = path_handler.joinAbsString(
            f.top_level_dir,
            parts,
            .loose,
        );
        return try allocator.dupeZ(u8, joined);
    }

    pub fn abs(f: *@This(), parts: anytype) string {
        return path_handler.joinAbsString(
            f.top_level_dir,
            parts,
            .loose,
        );
    }

    pub fn absBuf(f: *@This(), parts: anytype, buf: []u8) string {
        return path_handler.joinAbsStringBuf(f.top_level_dir, buf, parts, .loose);
    }

    pub fn absBufZ(f: *@This(), parts: anytype, buf: []u8) stringZ {
        return path_handler.joinAbsStringBufZ(f.top_level_dir, buf, parts, .loose);
    }

    pub fn joinAlloc(f: *@This(), allocator: std.mem.Allocator, parts: anytype) !string {
        const joined = f.join(parts);
        return try allocator.dupe(u8, joined);
    }

    pub fn printLimits() void {
        const LIMITS = [_]std.posix.rlimit_resource{ std.posix.rlimit_resource.STACK, std.posix.rlimit_resource.NOFILE };
        Output.print("{{\n", .{});

        inline for (LIMITS, 0..) |limit_type, i| {
            const limit = std.posix.getrlimit(limit_type) catch return;

            if (i == 0) {
                Output.print("  \"stack\": [{d}, {d}],\n", .{ limit.cur, limit.max });
            } else if (i == 1) {
                Output.print("  \"files\": [{d}, {d}]\n", .{ limit.cur, limit.max });
            }
        }

        Output.print("}}\n", .{});
        Output.flush();
    }

    pub const RealFS = struct {
        entries_mutex: Mutex = .{},
        entries: *EntriesOption.Map,
        cwd: string,
        file_limit: usize = 32,
        file_quota: usize = 32,

        fn #platformTempDir() []const u8 {
            // Try TMPDIR, TMP, and TEMP in that order, matching Node.js.
            // https://github.com/nodejs/node/blob/e172be269890702bf2ad06252f2f152e7604d76c/src/node_credentials.cc#L132
            if (bun.env_var.TMPDIR.getNotEmpty() orelse
                bun.env_var.TMP.getNotEmpty() orelse
                bun.env_var.TEMP.getNotEmpty()) |dir|
            {
                if (dir.len > 1 and dir[dir.len - 1] == std.fs.path.sep) {
                    return dir[0 .. dir.len - 1];
                }

                return dir;
            }

            return switch (Environment.os) {
                // https://learn.microsoft.com/en-us/windows/win32/api/fileapi/nf-fileapi-gettemppathw#remarks
                .windows => {
                    if (bun.env_var.SYSTEMROOT.get() orelse bun.env_var.WINDIR.get()) |windir| {
                        return std.fmt.allocPrint(
                            bun.default_allocator,
                            "{s}\\Temp",
                            .{strings.withoutTrailingSlash(windir)},
                        ) catch |err| bun.handleOom(err);
                    }

                    if (bun.env_var.HOME.get()) |profile| {
                        var buf: bun.PathBuffer = undefined;
                        var parts = [_]string{"AppData\\Local\\Temp"};
                        const out = bun.path.joinAbsStringBuf(profile, &buf, &parts, .loose);
                        return bun.handleOom(bun.default_allocator.dupe(u8, out));
                    }

                    var tmp_buf: bun.PathBuffer = undefined;
                    const cwd = std.posix.getcwd(&tmp_buf) catch @panic("Failed to get cwd for platformTempDir");
                    const root = bun.path.windowsFilesystemRoot(cwd);
                    return std.fmt.allocPrint(
                        bun.default_allocator,
                        "{s}\\Windows\\Temp",
                        .{strings.withoutTrailingSlash(root)},
                    ) catch |err| bun.handleOom(err);
                },
                .mac => "/private/tmp",
                else => "/tmp",
            };
        }

        var get_platform_tempdir = bun.once(#platformTempDir);
        pub fn platformTempDir() []const u8 {
            return get_platform_tempdir.call(.{});
        }

        pub const Tmpfile = switch (Environment.os) {
            .windows => TmpfileWindows,
            else => TmpfilePosix,
        };

        pub fn tmpdirPath() []const u8 {
            return bun.env_var.BUN_TMPDIR.getNotEmpty() orelse platformTempDir();
        }

        pub fn openTmpDir(_: *const RealFS) !std.fs.Dir {
            if (comptime Environment.isWindows) {
                return (try bun.sys.openDirAtWindowsA(bun.invalid_fd, tmpdirPath(), .{
                    .iterable = true,
                    // we will not delete the temp directory
                    .can_rename_or_delete = false,
                    .read_only = true,
                }).unwrap()).stdDir();
            }

            return try bun.openDirAbsolute(tmpdirPath());
        }

        pub fn entriesAt(this: *RealFS, index: allocators.IndexType, generation: bun.Generation) ?*EntriesOption {
            var existing = this.entries.atIndex(index) orelse return null;
            if (existing.* == .entries) {
                if (existing.entries.generation < generation) {
                    var handle = bun.openDirForIteration(FD.cwd(), existing.entries.dir).unwrap() catch |err| {
                        existing.entries.data.clearAndFree(bun.default_allocator);

                        return this.readDirectoryError(existing.entries.dir, err) catch unreachable;
                    };
                    defer handle.close();

                    const new_entry = this.readdir(
                        false,
                        &existing.entries.data,
                        existing.entries.dir,
                        generation,
                        handle.stdDir(),

                        void,
                        void{},
                    ) catch |err| {
                        existing.entries.data.clearAndFree(bun.default_allocator);
                        return this.readDirectoryError(existing.entries.dir, err) catch unreachable;
                    };
                    existing.entries.data.clearAndFree(bun.default_allocator);
                    existing.entries.* = new_entry;
                }
            }

            return existing;
        }

        pub fn getDefaultTempDir() string {
            return bun.env_var.BUN_TMPDIR.get() orelse platformTempDir();
        }

        pub const TmpfilePosix = struct {
            fd: bun.FileDescriptor = bun.invalid_fd,
            dir_fd: bun.FileDescriptor = bun.invalid_fd,

            pub inline fn dir(this: *TmpfilePosix) std.fs.Dir {
                return this.dir_fd.stdDir();
            }

            pub inline fn file(this: *TmpfilePosix) std.fs.File {
                return this.fd.stdFile();
            }

            pub fn close(this: *TmpfilePosix) void {
                if (this.fd.isValid()) this.fd.close();
            }

            pub fn create(this: *TmpfilePosix, _: *RealFS, name: [:0]const u8) !void {
                // We originally used a temporary directory, but it caused EXDEV.
                const dir_fd = bun.FD.cwd();
                this.dir_fd = dir_fd;

                const flags = bun.O.CREAT | bun.O.RDWR | bun.O.CLOEXEC;
                this.fd = try bun.sys.openat(dir_fd, name, flags, std.posix.S.IRWXU).unwrap();
            }

            pub fn promoteToCWD(this: *TmpfilePosix, from_name: [*:0]const u8, name: [*:0]const u8) !void {
                bun.assert(this.fd != bun.invalid_fd);
                bun.assert(this.dir_fd != bun.invalid_fd);

                try bun.sys.moveFileZWithHandle(this.fd, this.dir_fd, bun.sliceTo(from_name, 0), bun.FD.cwd(), bun.sliceTo(name, 0));
                this.close();
            }

            pub fn closeAndDelete(this: *TmpfilePosix, name: [*:0]const u8) void {
                this.close();

                if (comptime !Environment.isLinux) {
                    if (this.dir_fd == bun.invalid_fd) return;

                    this.dir().deleteFileZ(name) catch {};
                }
            }
        };

        pub const TmpfileWindows = struct {
            fd: bun.FileDescriptor = bun.invalid_fd,
            existing_path: []const u8 = "",

            pub inline fn dir(_: *TmpfileWindows) std.fs.Dir {
                return Fs.FileSystem.instance.tmpdir();
            }

            pub inline fn file(this: *TmpfileWindows) std.fs.File {
                return this.fd.stdFile();
            }

            pub fn close(this: *TmpfileWindows) void {
                if (this.fd.isValid()) this.fd.close();
            }

            pub fn create(this: *TmpfileWindows, rfs: *RealFS, name: [:0]const u8) !void {
                const tmp_dir = try rfs.openTmpDir();

                const flags = bun.O.CREAT | bun.O.WRONLY | bun.O.CLOEXEC;

                this.fd = try bun.sys.openat(.fromStdDir(tmp_dir), name, flags, 0).unwrap();
                var buf: bun.PathBuffer = undefined;
                const existing_path = try bun.getFdPath(this.fd, &buf);
                this.existing_path = try bun.default_allocator.dupe(u8, existing_path);
            }

            pub fn promoteToCWD(this: *TmpfileWindows, from_name: [*:0]const u8, name: [:0]const u8) !void {
                _ = from_name;
                var existing_buf: bun.WPathBuffer = undefined;
                var new_buf: bun.WPathBuffer = undefined;
                this.close();
                const existing = bun.strings.toExtendedPathNormalized(&new_buf, this.existing_path);
                const new = if (std.fs.path.isAbsoluteWindows(name))
                    bun.strings.toExtendedPathNormalized(&existing_buf, name)
                else
                    bun.strings.toWPathNormalized(&existing_buf, name);
                if (comptime Environment.allow_assert) {
                    debug("moveFileExW({f}, {f})", .{ bun.fmt.utf16(existing), bun.fmt.utf16(new) });
                }

                if (bun.windows.kernel32.MoveFileExW(existing.ptr, new.ptr, bun.windows.MOVEFILE_COPY_ALLOWED | bun.windows.MOVEFILE_REPLACE_EXISTING | bun.windows.MOVEFILE_WRITE_THROUGH) == bun.windows.FALSE) {
                    try bun.windows.Win32Error.get().unwrap();
                }
            }

            pub fn closeAndDelete(this: *TmpfileWindows, name: [*:0]const u8) void {
                _ = name;
                this.close();
            }
        };

        pub fn needToCloseFiles(rfs: *const RealFS) bool {
            if (!FeatureFlags.store_file_descriptors) {
                return true;
            }

            if (Environment.isWindows) {
                // 'false' is okay here because windows gives you a seemingly unlimited number of open
                // file handles, while posix has a lower limit.
                //
                // This limit does not extend to the C-Runtime which is only 512 to 8196 or so,
                // but we know that all resolver-related handles are not C-Runtime handles because
                // `setMaxFd` on Windows (besides being a no-op) only takes in `HANDLE`.
                //
                // Handles are automatically closed when the process exits as stated here:
                // https://learn.microsoft.com/en-us/windows/win32/procthread/terminating-a-process
                // But in a crazy experiment to find the upper-bound of the number of open handles,
                // I found that opening upwards of 500k to a million handles in a single process
                // would cause the process to hang while closing. This might just be Windows slowly
                // closing the handles, not sure. This is likely not something to worry about.
                //
                // If it is decided that not closing files ever is a bad idea. This should be
                // replaced with some form of intelligent count of how many files we opened.
                // On POSIX we can get away with measuring how high `fd` gets because it typically
                // assigns these descriptors in ascending order (1 2 3 ...). Windows does not
                // guarantee this.
                return false;
            }

            // If we're not near the max amount of open files, don't worry about it.
            return !(rfs.file_limit > 254 and rfs.file_limit > (FileSystem.max_fd + 1) * 2);
        }

        /// Returns `true` if an entry was removed
        pub fn bustEntriesCache(rfs: *RealFS, file_path: string) bool {
            return rfs.entries.remove(file_path);
        }

        pub const Limit = struct {
            pub var handles: usize = 0;
            pub var handles_before = std.mem.zeroes(if (Environment.isPosix) std.posix.rlimit else struct {});
        };

        // Always try to max out how many files we can keep open
        pub fn adjustUlimit() !usize {
            if (comptime !Environment.isPosix) {
                return std.math.maxInt(usize);
            }

            var file_limit: usize = 0;
            blk: {
                const resource = std.posix.rlimit_resource.NOFILE;
                const limit = try std.posix.getrlimit(resource);
                Limit.handles_before = limit;
                file_limit = limit.max;
                Limit.handles = file_limit;
                const max_to_use: @TypeOf(limit.max) = if (Environment.isMusl)
                    // musl has extremely low defaults here, so we really want
                    // to enable this on musl or tests will start failing.
                    @max(limit.max, 163840)
                else
                    // apparently, requesting too high of a number can cause other processes to not start.
                    // https://discord.com/channels/876711213126520882/1316342194176790609/1318175562367242271
                    // https://github.com/postgres/postgres/blob/fee2b3ea2ecd0da0c88832b37ac0d9f6b3bfb9a9/src/backend/storage/file/fd.c#L1072
                    limit.max;
                if (limit.cur < max_to_use) {
                    var new_limit = std.mem.zeroes(std.posix.rlimit);
                    new_limit.cur = max_to_use;
                    new_limit.max = max_to_use;

                    std.posix.setrlimit(resource, new_limit) catch break :blk;
                    file_limit = new_limit.max;
                    Limit.handles = file_limit;
                }
            }
            return file_limit;
        }

        var _entries_option_map: *EntriesOption.Map = undefined;
        var _entries_option_map_loaded: bool = false;
        pub fn init(
            cwd: string,
        ) RealFS {
            const file_limit = adjustUlimit() catch unreachable;

            if (!_entries_option_map_loaded) {
                _entries_option_map = EntriesOption.Map.init(bun.default_allocator);
                _entries_option_map_loaded = true;
            }

            return RealFS{
                .entries = _entries_option_map,
                .cwd = cwd,
                .file_limit = file_limit,
                .file_quota = file_limit,
            };
        }

        pub const ModKeyError = error{
            Unusable,
        };
        pub const ModKey = struct {
            inode: std.fs.File.INode = 0,
            size: u64 = 0,
            mtime: i128 = 0,
            mode: std.fs.File.Mode = 0,

            threadlocal var hash_name_buf: [1024]u8 = undefined;

            pub fn hashName(
                this: *const ModKey,
                basename: string,
            ) !string {
                const hex_int = this.hash();

                return try std.fmt.bufPrint(
                    &hash_name_buf,
                    "{s}-{f}",
                    .{
                        basename,
                        bun.fmt.hexIntLower(hex_int),
                    },
                );
            }

            pub fn hash(
                this: *const ModKey,
            ) u64 {
                var hash_bytes: [32]u8 = undefined;
                // We shouldn't just read the contents of the ModKey into memory
                // The hash should be deterministic across computers and operating systems.
                // inode is non-deterministic across volumes within the same compuiter
                // so if we're not going to do a full content hash, we should use mtime and size.
                // even mtime is debatable.
                var hash_bytes_remain: []u8 = hash_bytes[0..];
                std.mem.writeInt(@TypeOf(this.size), hash_bytes_remain[0..@sizeOf(@TypeOf(this.size))], this.size, .little);
                hash_bytes_remain = hash_bytes_remain[@sizeOf(@TypeOf(this.size))..];
                std.mem.writeInt(@TypeOf(this.mtime), hash_bytes_remain[0..@sizeOf(@TypeOf(this.mtime))], this.mtime, .little);
                hash_bytes_remain = hash_bytes_remain[@sizeOf(@TypeOf(this.mtime))..];
                bun.assert(hash_bytes_remain.len == 8);
                hash_bytes_remain[0..8].* = @as([8]u8, @bitCast(@as(u64, 0)));
                return bun.hash(&hash_bytes);
            }

            pub fn generate(_: *RealFS, _: string, file: std.fs.File) anyerror!ModKey {
                const stat = try file.stat();

                const seconds = @divTrunc(stat.mtime, @as(@TypeOf(stat.mtime), std.time.ns_per_s));

                // We can't detect changes if the file system zeros out the modification time
                if (seconds == 0 and std.time.ns_per_s == 0) {
                    return error.Unusable;
                }

                // Don't generate a modification key if the file is too new
                const now = std.time.nanoTimestamp();
                const now_seconds = @divTrunc(now, std.time.ns_per_s);
                if (seconds > seconds or (seconds == now_seconds and stat.mtime > now)) {
                    return error.Unusable;
                }

                return ModKey{
                    .inode = stat.inode,
                    .size = stat.size,
                    .mtime = stat.mtime,
                    .mode = stat.mode,
                    // .uid = stat.
                };
            }
            pub const SafetyGap = 3;
        };

        pub fn modKeyWithFile(fs: *RealFS, path: string, file: anytype) anyerror!ModKey {
            return try ModKey.generate(fs, path, file);
        }

        pub fn modKey(fs: *RealFS, path: string) anyerror!ModKey {
            var file = try std.fs.cwd().openFile(path, std.fs.File.OpenFlags{ .mode = .read_only });
            defer {
                if (fs.needToCloseFiles()) {
                    file.close();
                }
            }
            return try fs.modKeyWithFile(path, file);
        }

        pub const EntriesOption = union(Tag) {
            entries: *DirEntry,
            err: DirEntry.Err,

            pub const Tag = enum {
                entries,
                err,
            };

            // This custom map implementation:
            // - Preallocates a fixed amount of directory name space
            // - Doesn't store directory names which don't exist.
            pub const Map = allocators.BSSMap(EntriesOption, Preallocate.Counts.dir_entry, false, 256, true);
        };

        pub fn openDir(_: *RealFS, unsafe_dir_string: string) !std.fs.Dir {
            const dirfd = if (Environment.isWindows)
                bun.sys.openDirAtWindowsA(bun.invalid_fd, unsafe_dir_string, .{ .iterable = true, .no_follow = false, .read_only = true })
            else
                bun.sys.openA(
                    unsafe_dir_string,
                    bun.O.DIRECTORY,
                    0,
                );
            const fd = try dirfd.unwrap();
            return fd.stdDir();
        }

        fn readdir(
            fs: *RealFS,
            store_fd: bool,
            prev_map: ?*DirEntry.EntryMap,
            _dir: string,
            generation: bun.Generation,
            handle: std.fs.Dir,
            comptime Iterator: type,
            iterator: Iterator,
        ) !DirEntry {
            _ = fs;

            var iter = bun.iterateDir(.fromStdDir(handle));
            var dir = DirEntry.init(_dir, generation);
            const allocator = bun.default_allocator;
            errdefer dir.deinit(allocator);

            if (store_fd) {
                FileSystem.setMaxFd(handle.fd);
                dir.fd = .fromStdDir(handle);
            }

            while (try iter.next().unwrap()) |*_entry| {
                debug("readdir entry {s}", .{_entry.name.slice()});

                try dir.addEntry(prev_map, _entry, allocator, Iterator, iterator);
            }

            debug("readdir({f}, {s}) = {d}", .{ printHandle(handle.fd), _dir, dir.data.count() });

            return dir;
        }

        fn readDirectoryError(fs: *RealFS, dir: string, err: anyerror) OOM!*EntriesOption {
            if (comptime FeatureFlags.enable_entry_cache) {
                var get_or_put_result = try fs.entries.getOrPut(dir);
                switch (err) {
                    error.ENOENT, error.FileNotFound => {
                        fs.entries.markNotFound(get_or_put_result);
                        temp_entries_option = EntriesOption{
                            .err = DirEntry.Err{ .original_err = err, .canonical_error = err },
                        };
                        return &temp_entries_option;
                    },
                    else => {
                        const opt = try fs.entries.put(&get_or_put_result, EntriesOption{
                            .err = DirEntry.Err{ .original_err = err, .canonical_error = err },
                        });

                        return opt;
                    },
                }
            }

            temp_entries_option = EntriesOption{
                .err = DirEntry.Err{ .original_err = err, .canonical_error = err },
            };
            return &temp_entries_option;
        }

        threadlocal var temp_entries_option: EntriesOption = undefined;

        pub fn readDirectory(
            fs: *RealFS,
            _dir: string,
            _handle: ?std.fs.Dir,
            generation: bun.Generation,
            store_fd: bool,
        ) !*EntriesOption {
            return fs.readDirectoryWithIterator(_dir, _handle, generation, store_fd, void, {});
        }

        // One of the learnings here
        //
        //   Closing file descriptors yields significant performance benefits on Linux
        //
        // It was literally a 300% performance improvement to bundling.
        // https://twitter.com/jarredsumner/status/1655787337027309568
        // https://twitter.com/jarredsumner/status/1655714084569120770
        // https://twitter.com/jarredsumner/status/1655464485245845506
        /// Caller borrows the returned EntriesOption. When `FeatureFlags.enable_entry_cache` is `false`,
        /// it is not safe to store this pointer past the current function call.
        pub fn readDirectoryWithIterator(
            fs: *RealFS,
            dir_maybe_trail_slash: string,
            maybe_handle: ?std.fs.Dir,
            generation: bun.Generation,
            store_fd: bool,
            comptime Iterator: type,
            iterator: Iterator,
        ) !*EntriesOption {
            var dir = bun.strings.withoutTrailingSlashWindowsPath(dir_maybe_trail_slash);

            bun.resolver.Resolver.assertValidCacheKey(dir);
            var cache_result: ?allocators.Result = null;
            if (comptime FeatureFlags.enable_entry_cache) {
                fs.entries_mutex.lock();
            }
            defer {
                if (comptime FeatureFlags.enable_entry_cache) {
                    fs.entries_mutex.unlock();
                }
            }
            var in_place: ?*DirEntry = null;

            if (comptime FeatureFlags.enable_entry_cache) {
                cache_result = try fs.entries.getOrPut(dir);

                if (cache_result.?.hasCheckedIfExists()) {
                    if (fs.entries.atIndex(cache_result.?.index)) |cached_result| {
                        if (cached_result.* != .entries or (cached_result.* == .entries and cached_result.entries.generation >= generation)) {
                            return cached_result;
                        }

                        in_place = cached_result.entries;
                    } else if (cache_result.?.status == .not_found and generation == 0) {
                        temp_entries_option = EntriesOption{
                            .err = DirEntry.Err{ .original_err = error.ENOENT, .canonical_error = error.ENOENT },
                        };
                        return &temp_entries_option;
                    }
                }
            }

            var handle = maybe_handle orelse (fs.openDir(dir) catch |err| {
                return try fs.readDirectoryError(dir, err);
            });

            defer {
                if (maybe_handle == null and (!store_fd or fs.needToCloseFiles())) {
                    handle.close();
                }
            }

            // if we get this far, it's a real directory, so we can just store the dir name.
            if (maybe_handle == null) {
                dir = try if (in_place) |existing|
                    existing.dir
                else
                    DirnameStore.instance.append(string, dir_maybe_trail_slash);
            }

            // Cache miss: read the directory entries
            var entries = fs.readdir(
                store_fd,
                if (in_place) |existing| &existing.data else null,
                dir,
                generation,
                handle,

                Iterator,
                iterator,
            ) catch |err| {
                if (in_place) |existing| existing.data.clearAndFree(bun.default_allocator);
                return try fs.readDirectoryError(dir, err);
            };

            if (comptime FeatureFlags.enable_entry_cache) {
                const entries_ptr = in_place orelse bun.handleOom(bun.default_allocator.create(DirEntry));
                if (in_place) |original| {
                    original.data.clearAndFree(bun.default_allocator);
                }
                if (store_fd and !entries.fd.isValid())
                    entries.fd = .fromStdDir(handle);

                entries_ptr.* = entries;
                const result = EntriesOption{
                    .entries = entries_ptr,
                };

                const out = try fs.entries.put(&cache_result.?, result);

                return out;
            }

            temp_entries_option = EntriesOption{ .entries = entries };

            return &temp_entries_option;
        }

        fn readFileError(_: *RealFS, _: string, _: anyerror) void {}

        pub fn readFileWithHandle(
            fs: *RealFS,
            path: string,
            _size: ?usize,
            file: std.fs.File,
            comptime use_shared_buffer: bool,
            shared_buffer: *MutableString,
            comptime stream: bool,
        ) !PathContentsPair {
            return readFileWithHandleAndAllocator(
                fs,
                bun.default_allocator,
                path,
                _size,
                file,
                use_shared_buffer,
                shared_buffer,
                stream,
            );
        }

        pub fn readFileWithHandleAndAllocator(
            fs: *RealFS,
            allocator: std.mem.Allocator,
            path: string,
            size_hint: ?usize,
            std_file: std.fs.File,
            comptime use_shared_buffer: bool,
            shared_buffer: *MutableString,
            comptime stream: bool,
        ) !PathContentsPair {
            FileSystem.setMaxFd(std_file.handle);
            const file = bun.sys.File.from(std_file);

            var file_contents: []u8 = "";
            // When we're serving a JavaScript-like file over HTTP, we do not want to cache the contents in memory
            // This imposes a performance hit because not reading from disk is faster than reading from disk
            // Part of that hit is allocating a temporary buffer to store the file contents in
            // As a mitigation, we can just keep one buffer forever and re-use it for the parsed files
            if (use_shared_buffer) {
                shared_buffer.reset();

                // Skip the extra file.stat() call when possible
                var size = size_hint orelse (file.getEndPos() catch |err| {
                    fs.readFileError(path, err);
                    return err;
                });
                debug("stat({d}) = {d}", .{ file.handle, size });

                // Skip the pread call for empty files
                // Otherwise will get out of bounds errors
                // plus it's an unnecessary syscall
                if (size == 0) {
                    if (comptime use_shared_buffer) {
                        shared_buffer.reset();
                        return PathContentsPair{ .path = Path.init(path), .contents = shared_buffer.list.items };
                    } else {
                        return PathContentsPair{ .path = Path.init(path), .contents = "" };
                    }
                }

                var bytes_read: u64 = 0;
                try shared_buffer.growBy(size + 1);
                shared_buffer.list.expandToCapacity();

                // if you press save on a large file we might not read all the
                // bytes in the first few pread() calls. we only handle this on
                // stream because we assume that this only realistically happens
                // during HMR
                while (true) {
                    // We use pread to ensure if the file handle was open, it doesn't seek from the last position
                    const read_count = file.readAll(shared_buffer.list.items[bytes_read..]) catch |err| {
                        fs.readFileError(path, err);
                        return err;
                    };
                    shared_buffer.list.items = shared_buffer.list.items[0 .. read_count + bytes_read];
                    file_contents = shared_buffer.list.items;
                    debug("read({d}, {d}) = {d}", .{ file.handle, size, read_count });

                    if (comptime stream) {
                        // check again that stat() didn't change the file size
                        // another reason to only do this when stream
                        const new_size = file.getEndPos() catch |err| {
                            fs.readFileError(path, err);
                            return err;
                        };

                        bytes_read += read_count;

                        // don't infinite loop is we're still not reading more
                        if (read_count == 0) break;

                        if (bytes_read < new_size) {
                            try shared_buffer.growBy(new_size - size);
                            shared_buffer.list.expandToCapacity();
                            size = new_size;
                            continue;
                        }
                    }
                    break;
                }

                if (shared_buffer.list.capacity > file_contents.len) {
                    file_contents.ptr[file_contents.len] = 0;
                }

                if (strings.BOM.detect(file_contents)) |bom| {
                    debug("Convert {s} BOM", .{@tagName(bom)});
                    file_contents = try bom.removeAndConvertToUTF8WithoutDealloc(allocator, &shared_buffer.list);
                }
            } else {
                var initial_buf: [16384]u8 = undefined;

                // Optimization: don't call stat() unless the file is big enough
                // that we need to dynamically allocate memory to read it.
                const initial_read = if (size_hint == null) brk: {
                    const buf: []u8 = &initial_buf;
                    const read_count = file.readAll(buf).unwrap() catch |err| {
                        fs.readFileError(path, err);
                        return err;
                    };
                    if (read_count + 1 < buf.len) {
                        const allocation = try allocator.dupeZ(u8, buf[0..read_count]);
                        file_contents = allocation[0..read_count];

                        if (strings.BOM.detect(file_contents)) |bom| {
                            debug("Convert {s} BOM", .{@tagName(bom)});
                            file_contents = try bom.removeAndConvertToUTF8AndFree(allocator, file_contents);
                        }

                        return PathContentsPair{ .path = Path.init(path), .contents = file_contents };
                    }

                    break :brk buf[0..read_count];
                } else initial_buf[0..0];

                // Skip the extra file.stat() call when possible
                const size = size_hint orelse (file.getEndPos().unwrap() catch |err| {
                    fs.readFileError(path, err);
                    return err;
                });
                debug("stat({f}) = {d}", .{ file.handle, size });

                var buf = try allocator.alloc(u8, size + 1);
                @memcpy(buf[0..initial_read.len], initial_read);

                if (size == 0) {
                    return PathContentsPair{ .path = Path.init(path), .contents = "" };
                }

                // stick a zero at the end
                buf[size] = 0;

                const read_count = file.readAll(buf[initial_read.len..]).unwrap() catch |err| {
                    fs.readFileError(path, err);
                    return err;
                };
                file_contents = buf[0 .. read_count + initial_read.len];
                debug("read({f}, {d}) = {d}", .{ file.handle, size, read_count });

                if (strings.BOM.detect(file_contents)) |bom| {
                    debug("Convert {s} BOM", .{@tagName(bom)});
                    file_contents = try bom.removeAndConvertToUTF8AndFree(allocator, file_contents);
                }
            }

            return PathContentsPair{ .path = Path.init(path), .contents = file_contents };
        }

        pub fn kindFromAbsolute(
            fs: *RealFS,
            absolute_path: [:0]const u8,
            existing_fd: StoredFileDescriptorType,
            store_fd: bool,
        ) !Entry.Cache {
            var outpath: bun.PathBuffer = undefined;

            const stat = try bun.sys.lstat_absolute(absolute_path);
            const is_symlink = stat.kind == std.fs.File.Kind.SymLink;
            var _kind = stat.kind;
            var cache = Entry.Cache{
                .kind = Entry.Kind.file,
                .symlink = PathString.empty,
            };
            var symlink: []const u8 = "";

            if (is_symlink) {
                var file = try if (existing_fd != 0)
                    std.fs.File{ .handle = existing_fd }
                else if (store_fd)
                    std.fs.openFileAbsoluteZ(absolute_path, .{ .mode = .read_only })
                else
                    bun.openFileForPath(absolute_path);
                setMaxFd(file.handle);

                defer {
                    if ((!store_fd or fs.needToCloseFiles()) and existing_fd == 0) {
                        file.close();
                    } else if (comptime FeatureFlags.store_file_descriptors) {
                        cache.fd = file.handle;
                    }
                }
                const _stat = try file.stat();

                symlink = try bun.getFdPath(file.handle, &outpath);

                _kind = _stat.kind;
            }

            bun.assert(_kind != .SymLink);

            if (_kind == .Directory) {
                cache.kind = .dir;
            } else {
                cache.kind = .file;
            }
            if (symlink.len > 0) {
                cache.symlink = PathString.init(try FilenameStore.instance.append([]const u8, symlink));
            }

            return cache;
        }

        pub fn kind(
            fs: *RealFS,
            _dir: string,
            base: string,
            existing_fd: StoredFileDescriptorType,
            store_fd: bool,
        ) !Entry.Cache {
            var cache = Entry.Cache{
                .kind = Entry.Kind.file,
                .symlink = PathString.empty,
            };

            const dir = _dir;
            var combo = [2]string{ dir, base };
            var outpath: bun.PathBuffer = undefined;
            const entry_path = path_handler.joinAbsStringBuf(fs.cwd, &outpath, &combo, .auto);

            outpath[entry_path.len + 1] = 0;
            outpath[entry_path.len] = 0;

            var absolute_path_c: [:0]const u8 = outpath[0..entry_path.len :0];

            if (comptime bun.Environment.isWindows) {
                var file = bun.sys.getFileAttributes(absolute_path_c) orelse return error.FileNotFound;
                var depth: usize = 0;
                const buf2: *bun.PathBuffer = bun.path_buffer_pool.get();
                defer bun.path_buffer_pool.put(buf2);
                const buf3: *bun.PathBuffer = bun.path_buffer_pool.get();
                defer bun.path_buffer_pool.put(buf3);

                var current_buf: *bun.PathBuffer = buf2;
                var other_buf: *bun.PathBuffer = &outpath;
                var joining_buf: *bun.PathBuffer = buf3;

                while (file.is_reparse_point) : (depth += 1) {
                    var read: [:0]const u8 = try bun.sys.readlink(absolute_path_c, current_buf).unwrap();
                    if (std.fs.path.isAbsolute(read)) {
                        std.mem.swap(*bun.PathBuffer, &current_buf, &other_buf);
                    } else {
                        read = bun.path.joinAbsStringBufZ(std.fs.path.dirname(absolute_path_c) orelse absolute_path_c, joining_buf, &.{read}, .windows);
                        std.mem.swap(*bun.PathBuffer, &joining_buf, &other_buf);
                    }
                    file = bun.sys.getFileAttributes(read) orelse return error.FileNotFound;
                    absolute_path_c = read;

                    if (depth > 20) {
                        return error.TooManySymlinks;
                    }
                }

                if (depth > 0) {
                    cache.symlink = PathString.init(try FilenameStore.instance.append([]const u8, absolute_path_c));
                }

                if (file.is_directory) {
                    cache.kind = .dir;
                } else {
                    cache.kind = .file;
                }

                return cache;
            }

            const stat = try bun.sys.lstat_absolute(absolute_path_c);
            const is_symlink = stat.kind == std.fs.File.Kind.sym_link;
            var file_kind = stat.kind;

            var symlink: []const u8 = "";

            if (is_symlink) {
                var file: bun.FD = if (existing_fd.unwrapValid()) |valid|
                    valid
                else if (store_fd)
                    .fromStdFile(try std.fs.openFileAbsoluteZ(absolute_path_c, .{ .mode = .read_only }))
                else
                    .fromStdFile(try bun.openFileForPath(absolute_path_c));
                setMaxFd(file.native());

                defer {
                    if ((!store_fd or fs.needToCloseFiles()) and !existing_fd.isValid()) {
                        file.close();
                    } else if (comptime FeatureFlags.store_file_descriptors) {
                        cache.fd = file;
                    }
                }
                const file_stat = try file.stdFile().stat();
                symlink = try file.getFdPath(&outpath);
                file_kind = file_stat.kind;
            }

            bun.assert(file_kind != .sym_link);

            if (file_kind == .directory) {
                cache.kind = .dir;
            } else {
                cache.kind = .file;
            }
            if (symlink.len > 0) {
                cache.symlink = PathString.init(try FilenameStore.instance.append([]const u8, symlink));
            }

            return cache;
        }

        //         // Stores the file entries for directories we've listed before
        // entries_mutex: std.Mutex
        // entries      map[string]entriesOrErr

        // // If true, do not use the "entries" cache
        // doNotCacheEntries bool
    };

    pub const Implementation = RealFS;
    // pub const Implementation = switch (build_target) {
    // .wasi, .native => RealFS,
    //     .wasm => WasmFS,
    // };
};

pub const PathContentsPair = struct { path: Path, contents: string };

pub const NodeJSPathName = struct {
    base: string,
    dir: string,
    /// includes the leading .
    ext: string,
    filename: string,

    pub fn init(_path: string, comptime isWindows: bool) NodeJSPathName {
        const platform: path_handler.Platform = if (isWindows) .windows else .posix;
        const getLastSep = comptime platform.getLastSeparatorFunc();

        var path = _path;
        var base = path;
        // ext must be empty if not detected
        var ext: string = "";
        var dir = path;
        var is_absolute = true;
        var _i = getLastSep(path);
        var first = true;
        while (_i) |i| {
            // Stop if we found a non-trailing slash
            if (i + 1 != path.len and path.len >= i + 1) {
                base = path[i + 1 ..];
                dir = path[0..i];
                is_absolute = false;
                break;
            }

            // If the path starts with a slash and it's the only slash, it's absolute
            if (i == 0 and first) {
                base = path[1..];
                dir = &([_]u8{});
                break;
            }

            first = false;
            // Ignore trailing slashes

            path = path[0..i];

            _i = getLastSep(path);
        }

        // clean trailing slashs
        if (base.len > 1 and platform.isSeparator(base[base.len - 1])) {
            base = base[0 .. base.len - 1];
        }

        // filename is base without extension
        var filename = base;

        // if only one character ext = "" even if filename it's "."
        if (filename.len > 1) {
            // Strip off the extension
            if (strings.lastIndexOfChar(filename, '.')) |dot| {
                if (dot > 0) {
                    filename = filename[0..dot];
                    ext = base[dot..];
                }
            }
        }

        if (is_absolute) {
            dir = &([_]u8{});
        }

        return NodeJSPathName{
            .dir = dir,
            .base = base,
            .ext = ext,
            .filename = filename,
        };
    }
};

pub const PathName = struct {
    base: string,
    dir: string,
    /// includes the leading .
    /// extensionless files report ""
    ext: string,
    filename: string,

    pub fn findExtname(_path: string) string {
        var start: usize = 0;
        if (bun.path.lastIndexOfSep(_path)) |i| {
            start = i + 1;
        }
        const base = _path[start..];
        if (bun.strings.lastIndexOfChar(base, '.')) |dot| {
            if (dot > 0) return base[dot..];
        }
        return "";
    }

    pub fn extWithoutLeadingDot(self: *const PathName) string {
        return if (self.ext.len > 0 and self.ext[0] == '.') self.ext[1..] else self.ext;
    }

    pub fn nonUniqueNameStringBase(self: *const PathName) string {
        // /bar/foo/index.js -> foo
        if (self.dir.len > 0 and strings.eqlComptime(self.base, "index")) {
            // "/index" -> "index"
            return Fs.PathName.init(self.dir).base;
        }

        if (comptime Environment.allow_assert) {
            bun.assert(!strings.includes(self.base, "/"));
        }

        // /bar/foo.js -> foo
        return self.base;
    }

    pub fn dirOrDot(this: *const PathName) string {
        if (this.dir.len == 0) {
            return ".";
        }

        return this.dir;
    }

    pub fn fmtIdentifier(self: *const PathName) bun.fmt.FormatValidIdentifier {
        return bun.fmt.fmtIdentifier(self.nonUniqueNameStringBase());
    }

    // For readability, the names of certain automatically-generated symbols are
    // derived from the file name. For example, instead of the CommonJS wrapper for
    // a file being called something like "require273" it can be called something
    // like "require_react" instead. This function generates the part of these
    // identifiers that's specific to the file path. It can take both an absolute
    // path (OS-specific) and a path in the source code (OS-independent).
    //
    // Note that these generated names do not at all relate to the correctness of
    // the code as far as avoiding symbol name collisions. These names still go
    // through the renaming logic that all other symbols go through to avoid name
    // collisions.
    pub fn nonUniqueNameString(self: *const PathName, allocator: std.mem.Allocator) !string {
        return MutableString.ensureValidIdentifier(self.nonUniqueNameStringBase(), allocator);
    }

    pub inline fn dirWithTrailingSlash(this: *const PathName) string {
        // The three strings basically always point to the same underlying ptr
        // so if dir does not have a trailing slash, but is spaced one apart from the basename
        // we can assume there is a trailing slash there
        // so we extend the original slice's length by one
        return if (this.dir.len == 0) "./" else this.dir.ptr[0 .. this.dir.len + @as(
            usize,
            @intCast(@intFromBool(
                !bun.path.isSepAny(this.dir[this.dir.len - 1]) and (@intFromPtr(this.dir.ptr) + this.dir.len + 1) == @intFromPtr(this.base.ptr),
            )),
        )];
    }

    pub fn init(_path: string) PathName {
        if (comptime Environment.isWindows and Environment.isDebug) {
            // This path is likely incorrect. I think it may be *possible*
            // but it is almost entirely certainly a bug.
            bun.assert(!strings.startsWith(_path, "/:/"));
            bun.assert(!strings.startsWith(_path, "\\:\\"));
        }

        var path = _path;
        var base = path;
        var ext: []const u8 = undefined;
        var dir = path;
        var is_absolute = true;
        const has_disk_designator = path.len > 2 and path[1] == ':' and switch (path[0]) {
            'a'...'z', 'A'...'Z' => true,
            else => false,
        } and bun.path.isSepAny(path[2]);
        if (has_disk_designator) {
            path = path[2..];
        }

        while (bun.path.lastIndexOfSep(path)) |i| {
            // Stop if we found a non-trailing slash
            if (i + 1 != path.len and path.len > i + 1) {
                base = path[i + 1 ..];
                dir = path[0..i];
                is_absolute = false;
                break;
            }

            // Ignore trailing slashes
            path = path[0..i];
        }

        // Strip off the extension
        if (strings.lastIndexOfChar(base, '.')) |dot| {
            ext = base[dot..];
            base = base[0..dot];
        } else {
            ext = "";
        }

        if (is_absolute) {
            dir = &([_]u8{});
        }

        if (base.len > 1 and bun.path.isSepAny(base[base.len - 1])) {
            base = base[0 .. base.len - 1];
        }

        if (!is_absolute and has_disk_designator) {
            dir = _path[0 .. dir.len + 2];
        }

        return .{
            .dir = dir,
            .base = base,
            .ext = ext,
            .filename = if (dir.len > 0) _path[dir.len + 1 ..] else _path,
        };
    }
};

threadlocal var normalize_buf: [1024]u8 = undefined;
threadlocal var join_buf: [1024]u8 = undefined;

pub const Path = struct {
    /// The display path. In the bundler, this is relative to the current
    /// working directory. Since it can be emitted in bundles (and used
    /// for content hashes), this should contain forward slashes on Windows.
    pretty: string,
    /// The location of this resource. For the `file` namespace, this is
    /// usually an absolute path with native slashes or an empty string.
    text: string,
    namespace: string,
    // TODO(@paperclover): investigate removing or simplifying this property (it's 64 bytes)
    name: PathName,
    is_disabled: bool = false,
    is_symlink: bool = false,

    const ns_blob = "blob";
    const ns_bun = "bun";
    const ns_dataurl = "dataurl";
    const ns_file = "file";
    const ns_macro = "macro";

    pub fn isFile(this: *const Path) bool {
        return this.namespace.len == 0 or strings.eqlComptime(this.namespace, "file");
    }

    pub fn hashKey(this: *const Path) u64 {
        if (this.isFile()) {
            return bun.hash(this.text);
        }

        var hasher = std.hash.Wyhash.init(0);
        hasher.update(this.namespace);
        hasher.update("::::::::");
        hasher.update(this.text);
        return hasher.final();
    }

    /// This hash is used by the hot-module-reloading client in order to
    /// identify modules. Since that code is JavaScript, the hash must remain in
    /// range [-MAX_SAFE_INTEGER, MAX_SAFE_INTEGER] or else information is lost
    /// due to floating-point precision.
    pub fn hashForKit(path: Path) u52 {
        return @truncate(path.hashKey());
    }

    pub fn packageName(this: *const Path) ?string {
        var name_to_use = this.pretty;
        if (strings.lastIndexOf(this.text, std.fs.path.sep_str ++ "node_modules" ++ std.fs.path.sep_str)) |node_modules| {
            name_to_use = this.text[node_modules + 14 ..];
        }

        const pkgname = bun.options.JSX.Pragma.parsePackageName(name_to_use);
        if (pkgname.len == 0 or !std.ascii.isAlphanumeric(pkgname[0]))
            return null;

        return pkgname;
    }

    pub fn loader(this: *const Path, loaders: *const bun.options.Loader.HashTable) ?bun.options.Loader {
        if (this.isDataURL()) {
            return bun.options.Loader.dataurl;
        }

        const ext = this.name.ext;

        const result = loaders.get(ext) orelse bun.options.Loader.fromString(ext);
        if (result == null or result == .json) {
            const str = this.name.filename;
            if (strings.eqlComptime(str, "package.json") or strings.eqlComptime(str, "bun.lock")) {
                return .jsonc;
            }

            if (strings.hasSuffixComptime(str, ".jsonc")) {
                return .jsonc;
            }

            if (strings.hasPrefixComptime(str, "tsconfig.") or strings.hasPrefixComptime(str, "jsconfig.")) {
                if (strings.hasSuffixComptime(str, ".json")) {
                    return .jsonc;
                }
            }
        }
        return result;
    }

    pub fn isDataURL(this: *const Path) bool {
        return strings.eqlComptime(this.namespace, ns_dataurl);
    }

    pub fn isBun(this: *const Path) bool {
        return strings.eqlComptime(this.namespace, ns_bun);
    }

    pub fn isMacro(this: *const Path) bool {
        return strings.eqlComptime(this.namespace, ns_macro);
    }

    pub const PackageRelative = struct {
        path: string,
        name: string,
        is_parent_package: bool = false,
    };

    pub inline fn sourceDir(this: *const Path) string {
        return this.name.dirWithTrailingSlash();
    }

    pub inline fn prettyDir(this: *const Path) string {
        return this.name.dirWithTrailingSlash();
    }

    /// The bundler will hash path.pretty, so it needs to be consistent across platforms.
    /// This assertion might be a bit too forceful though.
    pub fn assertPrettyIsValid(path: *const Path) void {
        if (Environment.isWindows and Environment.allow_assert) {
            if (bun.strings.indexOfChar(path.pretty, '\\') != null) {
                std.debug.panic("Expected pretty file path to have only forward slashes, got '{s}'", .{path.pretty});
            }
        }
    }

    pub inline fn assertFilePathIsAbsolute(path: *const Path) void {
        if (bun.Environment.ci_assert) {
            if (path.isFile()) {
                bun.assert(std.fs.path.isAbsolute(path.text));
            }
        }
    }

    pub inline fn isPrettyPathPosix(path: *const Path) bool {
        if (!Environment.isWindows) return true;
        return bun.strings.indexOfChar(path.pretty, '\\') == null;
    }

    // This duplicates but only when strictly necessary
    // This will skip allocating if it's already in FilenameStore or DirnameStore
    pub fn dupeAlloc(this: *const Path, allocator: std.mem.Allocator) !Fs.Path {
        if (this.text.ptr == this.pretty.ptr and this.text.len == this.pretty.len) {
            if (FileSystem.FilenameStore.instance.exists(this.text) or FileSystem.DirnameStore.instance.exists(this.text)) {
                return this.*;
            }

            var new_path = Fs.Path.init(try FileSystem.FilenameStore.instance.append([]const u8, this.text));
            new_path.pretty = this.text;
            new_path.namespace = this.namespace;
            new_path.is_symlink = this.is_symlink;
            return new_path;
        } else if (this.pretty.len == 0) {
            if (FileSystem.FilenameStore.instance.exists(this.text) or FileSystem.DirnameStore.instance.exists(this.text)) {
                return this.*;
            }

            var new_path = Fs.Path.init(try FileSystem.FilenameStore.instance.append([]const u8, this.text));
            new_path.pretty = "";
            new_path.namespace = this.namespace;
            new_path.is_symlink = this.is_symlink;
            return new_path;
        } else if (allocators.sliceRange(this.pretty, this.text)) |start_len| {
            if (FileSystem.FilenameStore.instance.exists(this.text) or FileSystem.DirnameStore.instance.exists(this.text)) {
                return this.*;
            }
            var new_path = Fs.Path.init(try FileSystem.FilenameStore.instance.append([]const u8, this.text));
            new_path.pretty = this.text[start_len[0]..][0..start_len[1]];
            new_path.namespace = this.namespace;
            new_path.is_symlink = this.is_symlink;
            return new_path;
        } else {
            if ((FileSystem.FilenameStore.instance.exists(this.text) or
                FileSystem.DirnameStore.instance.exists(this.text)) and
                (FileSystem.FilenameStore.instance.exists(this.pretty) or
                    FileSystem.DirnameStore.instance.exists(this.pretty)))
            {
                return this.*;
            }

            if (strings.indexOf(this.text, this.pretty)) |offset| {
                var text = try FileSystem.FilenameStore.instance.append([]const u8, this.text);
                var new_path = Fs.Path.init(text);
                new_path.pretty = text[offset..][0..this.pretty.len];
                new_path.namespace = this.namespace;
                new_path.is_symlink = this.is_symlink;
                return new_path;
            } else {
                var buf = try allocator.alloc(u8, this.text.len + this.pretty.len + 2);
                bun.copy(u8, buf, this.text);
                buf.ptr[this.text.len] = 0;
                const new_pretty = buf[this.text.len + 1 ..][0..this.pretty.len];
                bun.copy(u8, buf[this.text.len + 1 ..], this.pretty);
                var new_path = Fs.Path.init(buf[0..this.text.len]);
                buf.ptr[buf.len - 1] = 0;
                new_path.pretty = new_pretty;
                new_path.namespace = this.namespace;
                new_path.is_symlink = this.is_symlink;
                return new_path;
            }
        }
    }

    pub fn dupeAllocFixPretty(this: *const Path, allocator: std.mem.Allocator) !Fs.Path {
        if (this.isPrettyPathPosix()) return this.dupeAlloc(allocator);
        comptime bun.assert(bun.Environment.isWindows);
        var new = this.*;
        new.pretty = "";
        new = try new.dupeAlloc(allocator);
        const pretty = try allocator.dupe(u8, this.pretty);
        bun.path.platformToPosixInPlace(u8, pretty);
        new.pretty = pretty;
        new.assertPrettyIsValid();
        return new;
    }

    pub const empty = Fs.Path.init("");

    pub fn setRealpath(this: *Path, to: string) void {
        const old_path = this.text;
        this.text = to;
        this.name = PathName.init(to);
        this.pretty = old_path;
        this.is_symlink = true;
    }

    pub fn jsonStringify(self: *const @This(), writer: anytype) !void {
        return try writer.write(self.text);
    }

    pub fn generateKey(p: *Path, allocator: std.mem.Allocator) !string {
        return try std.fmt.allocPrint(allocator, "{s}://{s}", .{ p.namespace, p.text });
    }

    pub fn init(text: string) Path {
        return Path{
            .pretty = text,
            .text = text,
            .namespace = "file",
            .name = PathName.init(text),
        };
    }

    pub fn initWithPretty(text: string, pretty: string) Path {
        return Path{
            .pretty = pretty,
            .text = text,
            .namespace = "file",
            .name = PathName.init(text),
        };
    }

    pub fn initWithNamespace(text: string, namespace: string) Path {
        return Path{
            .pretty = text,
            .text = text,
            .namespace = namespace,
            .name = PathName.init(text),
        };
    }

    pub inline fn initWithNamespaceVirtual(comptime text: string, comptime namespace: string, comptime package: string) Path {
        return comptime Path{
            .pretty = namespace ++ ":" ++ package,
            .is_symlink = true,
            .text = text,
            .namespace = namespace,
            .name = PathName.init(text),
        };
    }

    pub inline fn initForKitBuiltIn(comptime namespace: string, comptime package: string) Path {
        return comptime Path{
            .pretty = namespace ++ ":" ++ package,
            .is_symlink = true,
            .text = "_bun/" ++ package,
            .namespace = namespace,
            .name = PathName.init(package),
        };
    }

    pub fn isNodeModule(this: *const Path) bool {
        return strings.lastIndexOf(this.name.dir, std.fs.path.sep_str ++ "node_modules" ++ std.fs.path.sep_str) != null;
    }

    pub fn isJSXFile(this: *const Path) bool {
        return strings.hasSuffixComptime(this.name.filename, ".jsx") or strings.hasSuffixComptime(this.name.filename, ".tsx");
    }

    pub fn keyForIncrementalGraph(path: *const Path) []const u8 {
        return if (path.isFile())
            path.text
        else
            path.pretty;
    }
};

// pub fn customRealpath(allocator: std.mem.Allocator, path: string) !string {
//     var opened = try std.posix.open(path, if (Environment.isLinux) bun.O.PATH else bun.O.RDONLY, 0);
//     defer std.posix.close(opened);
// }

pub fn printHandle(handle: anytype) std.fmt.Alt(@TypeOf(handle), FmtHandleFnGenerator(@TypeOf(handle)).fmtHandle) {
    return .{ .data = handle };
}
fn FmtHandleFnGenerator(comptime T: type) type {
    return struct {
        fn fmtHandle(handle: T, writer: *std.Io.Writer) std.Io.Writer.Error!void {
            switch (@TypeOf(handle)) {
                i32, c_int => try writer.print("{d}", .{handle}),
                *anyopaque => try writer.print("{*}", .{handle}),
                FD => try writer.print("{f}", .{handle}),
                else => {
                    @compileError("unsupported type for fmtHandle: " ++ @typeName(T));
                },
            }
        }
    };
}

pub const StatHash = @import("./fs/stat_hash.zig");

const string = []const u8;
const stringZ = [:0]const u8;

const path_handler = @import("./resolver/resolve_path.zig");
const std = @import("std");

const bun = @import("bun");
const Environment = bun.Environment;
const FD = bun.FD;
const FeatureFlags = bun.FeatureFlags;
const FileDescriptor = bun.FileDescriptor;
const MAX_PATH_BYTES = bun.MAX_PATH_BYTES;
const MutableString = bun.MutableString;
const Mutex = bun.Mutex;
const OOM = bun.OOM;
const Output = bun.Output;
const PathBuffer = bun.PathBuffer;
const PathString = bun.PathString;
const StoredFileDescriptorType = bun.StoredFileDescriptorType;
const WPathBuffer = bun.WPathBuffer;
const allocators = bun.allocators;
const default_allocator = bun.default_allocator;
const strings = bun.strings;
