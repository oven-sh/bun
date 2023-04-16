const std = @import("std");
const bun = @import("bun");
const string = bun.string;
const Output = bun.Output;
const Global = bun.Global;
const Environment = bun.Environment;
const strings = bun.strings;
const MutableString = bun.MutableString;
const StoredFileDescriptorType = bun.StoredFileDescriptorType;
const FileDescriptorType = bun.FileDescriptor;
const FeatureFlags = bun.FeatureFlags;
const stringZ = bun.stringZ;
const default_allocator = bun.default_allocator;
const C = bun.C;
const sync = @import("sync.zig");
const Mutex = @import("./lock.zig").Lock;
const Semaphore = sync.Semaphore;
const Fs = @This();
const path_handler = @import("./resolver/resolve_path.zig");
const PathString = bun.PathString;
const allocators = @import("./allocators.zig");

pub const MAX_PATH_BYTES = bun.MAX_PATH_BYTES;
pub const PathBuffer = [bun.MAX_PATH_BYTES]u8;

// pub const FilesystemImplementation = @import("fs_impl.zig");

pub const Preallocate = struct {
    pub const Counts = struct {
        pub const dir_entry: usize = 2048;
        pub const files: usize = 4096;
    };
};

pub const BytecodeCacheFetcher = struct {
    fd: ?StoredFileDescriptorType = null,

    pub const Available = enum {
        Unknown,
        Available,
        NotAvailable,

        pub inline fn determine(fd: ?StoredFileDescriptorType) Available {
            if (!comptime FeatureFlags.enable_bytecode_caching) return .NotAvailable;

            const _fd = fd orelse return .Unknown;
            return if (_fd > 0) .Available else return .NotAvailable;
        }
    };

    pub fn fetch(this: *BytecodeCacheFetcher, sourcename: string, fs: *FileSystem.RealFS) ?StoredFileDescriptorType {
        switch (Available.determine(this.fd)) {
            .Available => {
                return this.fd.?;
            },
            .NotAvailable => {
                return null;
            },
            .Unknown => {
                var basename_buf: [512]u8 = undefined;
                var pathname = Fs.PathName.init(sourcename);
                bun.copy(u8, &basename_buf, pathname.base);
                bun.copy(u8, basename_buf[pathname.base.len..], ".bytecode");
                const basename = basename_buf[0 .. pathname.base.len + ".bytecode".len];

                if (fs.fetchCacheFile(basename)) |cache_file| {
                    this.fd = @truncate(StoredFileDescriptorType, cache_file.handle);
                    return @truncate(StoredFileDescriptorType, cache_file.handle);
                } else |err| {
                    Output.prettyWarnln("<r><yellow>Warn<r>: Bytecode caching unavailable due to error: {s}", .{@errorName(err)});
                    Output.flush();
                    this.fd = 0;
                    return null;
                }
            },
        }
    }
};

pub const FileSystem = struct {
    allocator: std.mem.Allocator,
    top_level_dir: string = "/",

    // used on subsequent updates
    top_level_dir_buf: [bun.MAX_PATH_BYTES]u8 = undefined,

    fs: Implementation,

    dirname_store: *DirnameStore,
    filename_store: *FilenameStore,

    _tmpdir: ?std.fs.Dir = null,

    threadlocal var tmpdir_handle: ?std.fs.Dir = null;

    pub fn topLevelDirWithoutTrailingSlash(this: *const FileSystem) []const u8 {
        if (this.top_level_dir.len > 1 and this.top_level_dir[this.top_level_dir.len - 1] == std.fs.path.sep) {
            return this.top_level_dir[0 .. this.top_level_dir.len - 1];
        } else {
            return this.top_level_dir;
        }
    }

    pub fn tmpdir(fs: *FileSystem) std.fs.Dir {
        if (tmpdir_handle == null) {
            tmpdir_handle = fs.fs.openTmpDir() catch unreachable;
        }

        return tmpdir_handle.?;
    }

    pub fn getFdPath(this: *const FileSystem, fd: FileDescriptorType) ![]const u8 {
        var buf: [bun.MAX_PATH_BYTES]u8 = undefined;
        var dir = try bun.getFdPath(fd, &buf);
        return try this.dirname_store.append([]u8, dir);
    }

    pub fn tmpname(_: *const FileSystem, extname: string, buf: []u8, hash: u64) ![*:0]u8 {
        // PRNG was...not so random
        const hex_value = @truncate(u64, @intCast(u128, hash) * @intCast(u128, std.time.nanoTimestamp()));

        return try std.fmt.bufPrintZ(buf, ".{any}{s}", .{ bun.fmt.hexIntLower(hex_value), extname });
    }

    pub var max_fd: FileDescriptorType = 0;

    pub inline fn setMaxFd(fd: anytype) void {
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

    pub fn init1(
        allocator: std.mem.Allocator,
        top_level_dir: ?string,
    ) !*FileSystem {
        return init1WithForce(allocator, top_level_dir, false);
    }

    pub fn init1WithForce(
        allocator: std.mem.Allocator,
        top_level_dir: ?string,
        comptime force: bool,
    ) !*FileSystem {
        var _top_level_dir = top_level_dir orelse (if (Environment.isBrowser) "/project/" else try std.process.getCwdAlloc(allocator));

        // Ensure there's a trailing separator in the top level directory
        // This makes path resolution more reliable
        if (!std.fs.path.isSep(_top_level_dir[_top_level_dir.len - 1])) {
            const tld = try allocator.alloc(u8, _top_level_dir.len + 1);
            bun.copy(u8, tld, _top_level_dir);
            tld[tld.len - 1] = std.fs.path.sep;
            // if (!isBrowser) {
            //     allocator.free(_top_level_dir);
            // }
            _top_level_dir = tld;
        }

        if (!instance_loaded or force) {
            instance = FileSystem{
                .allocator = allocator,
                .top_level_dir = _top_level_dir,
                .fs = Implementation.init(
                    allocator,
                    _top_level_dir,
                ),
                // must always use default_allocator since the other allocators may not be threadsafe when an element resizes
                .dirname_store = DirnameStore.init(bun.default_allocator),
                .filename_store = FilenameStore.init(bun.default_allocator),
            };
            instance_loaded = true;

            instance.fs.parent_fs = &instance;
            _ = DirEntry.EntryStore.init(allocator);
        }

        return &instance;
    }

    pub const DirEntry = struct {
        pub const EntryMap = bun.StringHashMapUnmanaged(*Entry);
        pub const EntryStore = allocators.BSSList(Entry, Preallocate.Counts.files);
        dir: string,
        fd: StoredFileDescriptorType = 0,
        data: EntryMap,

        // pub fn removeEntry(dir: *DirEntry, name: string) !void {
        //     // dir.data.remove(name);
        // }

        pub fn addEntry(dir: *DirEntry, entry: std.fs.IterableDir.Entry, allocator: std.mem.Allocator, comptime Iterator: type, iterator: Iterator) !void {
            const _kind: Entry.Kind = switch (entry.kind) {
                .Directory => .dir,
                // This might be wrong!
                .SymLink => .file,
                .File => .file,
                else => return,
            };
            // entry.name only lives for the duration of the iteration

            const name = try strings.StringOrTinyString.initAppendIfNeeded(
                entry.name,
                *FileSystem.FilenameStore,
                &FileSystem.FilenameStore.instance,
            );

            const name_lowercased = try strings.StringOrTinyString.initLowerCaseAppendIfNeeded(
                entry.name,
                *FileSystem.FilenameStore,
                &FileSystem.FilenameStore.instance,
            );

            const stored = try EntryStore.instance.append(.{
                .base_ = name,
                .base_lowercase_ = name_lowercased,
                .dir = dir.dir,
                .mutex = Mutex.init(),
                // Call "stat" lazily for performance. The "@material-ui/icons" package
                // contains a directory with over 11,000 entries in it and running "stat"
                // for each entry was a big performance issue for that package.
                .need_stat = entry.kind == .SymLink,
                .cache = .{
                    .symlink = PathString.empty,
                    .kind = _kind,
                },
            });

            const stored_name = stored.base();

            try dir.data.put(allocator, stored.base_lowercase(), stored);

            if (comptime Iterator != void) {
                iterator.next(stored, dir.fd);
            }

            if (comptime FeatureFlags.verbose_fs) {
                if (_kind == .dir) {
                    Output.prettyln("   + {s}/", .{stored_name});
                } else {
                    Output.prettyln("   + {s}", .{stored_name});
                }
            }
        }

        pub fn init(dir: string) DirEntry {
            if (comptime FeatureFlags.verbose_fs) {
                Output.prettyln("\n  {s}", .{dir});
            }

            return .{ .dir = dir, .data = .{} };
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
            if (_query.len == 0) return null;
            var scratch_lookup_buffer: [256]u8 = undefined;
            std.debug.assert(scratch_lookup_buffer.len >= _query.len);

            const query = strings.copyLowercaseIfNeeded(_query, &scratch_lookup_buffer);
            const result = entry.data.get(query) orelse return null;
            const basename = result.base();
            if (!strings.eql(basename, _query)) {
                return Entry.Lookup{ .entry = result, .diff_case = Entry.Lookup.DifferentCase{
                    .dir = entry.dir,
                    .query = _query,
                    .actual = basename,
                } };
            }

            return Entry.Lookup{ .entry = result, .diff_case = null };
        }

        pub fn getComptimeQuery(entry: *const DirEntry, comptime query_str: anytype) ?Entry.Lookup {
            comptime var query: [query_str.len]u8 = undefined;
            comptime for (query_str, 0..) |c, i| {
                query[i] = std.ascii.toLower(c);
            };

            const query_hashed = comptime std.hash_map.hashString(&query);

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
            comptime var query: [query_str.len]u8 = undefined;
            comptime for (query_str, 0..) |c, i| {
                query[i] = std.ascii.toLower(c);
            };

            const query_hashed = comptime std.hash_map.hashString(&query);

            return entry.data.containsAdapted(
                @as([]const u8, &query),
                struct {
                    pub fn hash(_: @This(), _: []const u8) @TypeOf(query_hashed) {
                        return query_hashed;
                    }

                    pub fn eql(_: @This(), _: []const u8, b: []const u8) bool {
                        return strings.eqlComptime(b, query);
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

        pub inline fn base(this: *const Entry) string {
            return this.base_.slice();
        }

        pub inline fn base_lowercase(this: *const Entry) string {
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
            fd: StoredFileDescriptorType = 0,
            kind: Kind = .file,
        };

        pub const Kind = enum {
            dir,
            file,
        };

        pub fn kind(entry: *Entry, fs: *Implementation) Kind {
            if (entry.need_stat) {
                entry.need_stat = false;
                // This is technically incorrect, but we are choosing not to handle errors here
                entry.cache = fs.kind(entry.dir, entry.base(), entry.cache.fd) catch return entry.cache.kind;
            }
            return entry.cache.kind;
        }

        pub fn symlink(entry: *Entry, fs: *Implementation) string {
            if (entry.need_stat) {
                entry.need_stat = false;
                // This is technically incorrect, but we are choosing not to handle errors here
                // This error can happen if the file was deleted between the time the directory was scanned and the time it was read
                entry.cache = fs.kind(entry.dir, entry.base(), entry.cache.fd) catch return "";
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
        return @call(.always_inline, path_handler.normalizeString, .{ str, true, .auto });
    }

    pub fn normalizeBuf(_: *@This(), buf: []u8, str: string) string {
        return @call(.always_inline, path_handler.normalizeStringBuf, .{ str, buf, false, .auto, false });
    }

    pub fn join(_: *@This(), parts: anytype) string {
        return @call(.always_inline, path_handler.joinStringBuf, .{
            &join_buf,
            parts,
            .auto,
        });
    }

    pub fn joinBuf(_: *@This(), parts: anytype, buf: []u8) string {
        return @call(.always_inline, path_handler.joinStringBuf, .{
            buf,
            parts,
            .auto,
        });
    }

    pub fn relative(_: *@This(), from: string, to: string) string {
        return @call(.always_inline, path_handler.relative, .{
            from,
            to,
        });
    }

    pub fn relativeTo(f: *@This(), to: string) string {
        return @call(.always_inline, path_handler.relative, .{
            f.top_level_dir,
            to,
        });
    }

    pub fn relativeFrom(f: *@This(), from: string) string {
        return @call(.always_inline, path_handler.relative, .{
            from,
            f.top_level_dir,
        });
    }

    pub fn absAlloc(f: *@This(), allocator: std.mem.Allocator, parts: anytype) !string {
        const joined = path_handler.joinAbsString(
            f.top_level_dir,
            parts,
            .auto,
        );
        return try allocator.dupe(u8, joined);
    }

    pub fn absAllocZ(f: *@This(), allocator: std.mem.Allocator, parts: anytype) ![*:0]const u8 {
        const joined = path_handler.joinAbsString(
            f.top_level_dir,
            parts,
            .auto,
        );
        return try allocator.dupeZ(u8, joined);
    }

    pub fn abs(f: *@This(), parts: anytype) string {
        return path_handler.joinAbsString(
            f.top_level_dir,
            parts,
            .auto,
        );
    }

    pub fn absBuf(f: *@This(), parts: anytype, buf: []u8) string {
        return path_handler.joinAbsStringBuf(f.top_level_dir, buf, parts, .auto);
    }

    pub fn joinAlloc(f: *@This(), allocator: std.mem.Allocator, parts: anytype) !string {
        const joined = f.join(parts);
        return try allocator.dupe(u8, joined);
    }

    pub fn printLimits() void {
        const LIMITS = [_]std.os.rlimit_resource{ std.os.rlimit_resource.STACK, std.os.rlimit_resource.NOFILE };
        Output.print("{{\n", .{});

        inline for (LIMITS, 0..) |limit_type, i| {
            const limit = std.os.getrlimit(limit_type) catch return;

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
        entries_mutex: Mutex = Mutex.init(),
        entries: *EntriesOption.Map,
        allocator: std.mem.Allocator,
        cwd: string,
        parent_fs: *FileSystem = undefined,
        file_limit: usize = 32,
        file_quota: usize = 32,

        pub var tmpdir_buf: [bun.MAX_PATH_BYTES]u8 = undefined;

        pub const PLATFORM_TMP_DIR: string = switch (@import("builtin").target.os.tag) {
            .windows => "TMPDIR",
            .macos => "/private/tmp",
            else => "/tmp",
        };

        pub var tmpdir_path: []const u8 = undefined;
        pub var tmpdir_path_set = false;
        pub fn openTmpDir(_: *const RealFS) !std.fs.Dir {
            if (!tmpdir_path_set) {
                tmpdir_path = bun.getenvZ("BUN_TMPDIR") orelse bun.getenvZ("TMPDIR") orelse PLATFORM_TMP_DIR;
                tmpdir_path_set = true;
            }

            return (try std.fs.cwd().openIterableDir(tmpdir_path, .{
                .access_sub_paths = true,
            })).dir;
        }

        pub fn getDefaultTempDir() string {
            return bun.getenvZ("BUN_TMPDIR") orelse bun.getenvZ("TMPDIR") orelse PLATFORM_TMP_DIR;
        }

        pub fn setTempdir(path: ?string) void {
            tmpdir_path = path orelse getDefaultTempDir();
            tmpdir_path_set = true;
        }

        pub fn fetchCacheFile(fs: *RealFS, basename: string) !std.fs.File {
            const file = try fs._fetchCacheFile(basename);
            if (comptime FeatureFlags.store_file_descriptors) {
                setMaxFd(file.handle);
            }
            return file;
        }

        pub const Tmpfile = struct {
            fd: std.os.fd_t = 0,
            dir_fd: std.os.fd_t = 0,

            pub inline fn dir(this: *Tmpfile) std.fs.Dir {
                return std.fs.Dir{
                    .fd = this.dir_fd,
                };
            }

            pub inline fn file(this: *Tmpfile) std.fs.File {
                return std.fs.File{
                    .handle = this.fd,
                };
            }

            pub fn close(this: *Tmpfile) void {
                if (this.fd != 0) std.os.close(this.fd);
            }

            pub fn create(this: *Tmpfile, rfs: *RealFS, name: [*:0]const u8) !void {
                var tmpdir_ = try rfs.openTmpDir();

                const flags = std.os.O.CREAT | std.os.O.RDWR | std.os.O.CLOEXEC;
                this.dir_fd = tmpdir_.fd;
                this.fd = try std.os.openatZ(tmpdir_.fd, name, flags, std.os.S.IRWXO);
            }

            pub fn promote(this: *Tmpfile, from_name: [*:0]const u8, destination_fd: std.os.fd_t, name: [*:0]const u8) !void {
                std.debug.assert(this.fd != 0);
                std.debug.assert(this.dir_fd != 0);

                try C.moveFileZWithHandle(this.fd, this.dir_fd, from_name, destination_fd, name);
                this.close();
            }

            pub fn closeAndDelete(this: *Tmpfile, name: [*:0]const u8) void {
                this.close();

                if (comptime !Environment.isLinux) {
                    if (this.dir_fd == 0) return;

                    this.dir().deleteFileZ(name) catch {};
                }
            }
        };

        inline fn _fetchCacheFile(fs: *RealFS, basename: string) !std.fs.File {
            var parts = [_]string{ "node_modules", ".cache", basename };
            var path = fs.parent_fs.join(&parts);
            return std.fs.cwd().openFile(path, .{ .mode = .read_write, .lock = .Shared }) catch {
                path = fs.parent_fs.join(parts[0..2]);
                try std.fs.cwd().makePath(path);

                path = fs.parent_fs.join(&parts);
                return try std.fs.cwd().createFile(path, .{ .mode = .read_write, .lock = .Shared });
            };
        }

        pub fn needToCloseFiles(rfs: *const RealFS) bool {
            // On Windows, we must always close open file handles
            // Windows locks files
            if (comptime !FeatureFlags.store_file_descriptors) {
                return true;
            }

            // If we're not near the max amount of open files, don't worry about it.
            return !(rfs.file_limit > 254 and rfs.file_limit > (FileSystem.max_fd + 1) * 2);
        }

        pub fn bustEntriesCache(rfs: *RealFS, file_path: string) void {
            rfs.entries.remove(file_path);
        }

        pub const Limit = struct {
            pub var handles: usize = 0;
            pub var stack: usize = 0;
        };

        // Always try to max out how many files we can keep open
        pub fn adjustUlimit() !usize {
            const LIMITS = [_]std.os.rlimit_resource{ std.os.rlimit_resource.STACK, std.os.rlimit_resource.NOFILE };
            inline for (LIMITS, 0..) |limit_type, i| {
                const limit = try std.os.getrlimit(limit_type);

                if (limit.cur < limit.max) {
                    var new_limit = std.mem.zeroes(std.os.rlimit);
                    new_limit.cur = limit.max;
                    new_limit.max = limit.max;

                    if (std.os.setrlimit(limit_type, new_limit)) {
                        if (i == 1) {
                            Limit.handles = limit.max;
                        } else {
                            Limit.stack = limit.max;
                        }
                    } else |_| {}
                }

                if (i == LIMITS.len - 1) return limit.max;
            }
        }

        var _entries_option_map: *EntriesOption.Map = undefined;
        var _entries_option_map_loaded: bool = false;
        pub fn init(
            allocator: std.mem.Allocator,
            cwd: string,
        ) RealFS {
            const file_limit = adjustUlimit() catch unreachable;

            if (!_entries_option_map_loaded) {
                _entries_option_map = EntriesOption.Map.init(allocator);
                _entries_option_map_loaded = true;
            }

            return RealFS{
                .entries = _entries_option_map,
                .allocator = allocator,
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
                    "{s}-{any}",
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
                std.mem.writeIntNative(@TypeOf(this.size), hash_bytes_remain[0..@sizeOf(@TypeOf(this.size))], this.size);
                hash_bytes_remain = hash_bytes_remain[@sizeOf(@TypeOf(this.size))..];
                std.mem.writeIntNative(@TypeOf(this.mtime), hash_bytes_remain[0..@sizeOf(@TypeOf(this.mtime))], this.mtime);
                hash_bytes_remain = hash_bytes_remain[@sizeOf(@TypeOf(this.mtime))..];
                std.debug.assert(hash_bytes_remain.len == 8);
                hash_bytes_remain[0..8].* = @bitCast([8]u8, @as(u64, 0));
                return std.hash.Wyhash.hash(0, &hash_bytes);
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
            var file = try std.fs.openFileAbsolute(path, std.fs.File.OpenFlags{ .mode = .read_only });
            defer {
                if (fs.needToCloseFiles()) {
                    file.close();
                }
            }
            return try fs.modKeyWithFile(path, file);
        }

        pub const EntriesOption = union(Tag) {
            entries: DirEntry,
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

        pub fn openDir(_: *RealFS, unsafe_dir_string: string) std.fs.File.OpenError!std.fs.Dir {
            const dir = try std.os.open(unsafe_dir_string, std.os.O.DIRECTORY, 0);
            return std.fs.Dir{
                .fd = dir,
            };
        }

        fn readdir(
            fs: *RealFS,
            _dir: string,
            handle: std.fs.Dir,
            comptime Iterator: type,
            iterator: Iterator,
        ) !DirEntry {
            var iter = (std.fs.IterableDir{ .dir = handle }).iterate();
            var dir = DirEntry.init(_dir);
            const allocator = fs.allocator;
            errdefer dir.deinit(allocator);

            if (FeatureFlags.store_file_descriptors) {
                FileSystem.setMaxFd(handle.fd);
                dir.fd = handle.fd;
            }

            while (try iter.next()) |_entry| {
                try dir.addEntry(_entry, allocator, Iterator, iterator);
            }

            return dir;
        }

        fn readDirectoryError(fs: *RealFS, dir: string, err: anyerror) !*EntriesOption {
            if (comptime FeatureFlags.enable_entry_cache) {
                var get_or_put_result = try fs.entries.getOrPut(dir);
                var opt = try fs.entries.put(&get_or_put_result, EntriesOption{
                    .err = DirEntry.Err{ .original_err = err, .canonical_error = err },
                });

                return opt;
            }

            temp_entries_option = EntriesOption{
                .err = DirEntry.Err{ .original_err = err, .canonical_error = err },
            };
            return &temp_entries_option;
        }

        threadlocal var temp_entries_option: EntriesOption = undefined;

        pub fn readDirectory(fs: *RealFS, _dir: string, _handle: ?std.fs.Dir) !*EntriesOption {
            return readDirectoryWithIterator(fs, _dir, _handle, void, {});
        }

        pub fn readDirectoryWithIterator(fs: *RealFS, _dir: string, _handle: ?std.fs.Dir, comptime Iterator: type, iterator: Iterator) !*EntriesOption {
            var dir = _dir;
            var cache_result: ?allocators.Result = null;
            if (comptime FeatureFlags.enable_entry_cache) {
                fs.entries_mutex.lock();
            }
            defer {
                if (comptime FeatureFlags.enable_entry_cache) {
                    fs.entries_mutex.unlock();
                }
            }

            if (comptime FeatureFlags.enable_entry_cache) {
                cache_result = try fs.entries.getOrPut(dir);

                if (cache_result.?.hasCheckedIfExists()) {
                    if (fs.entries.atIndex(cache_result.?.index)) |cached_result| {
                        return cached_result;
                    }
                }
            }

            var handle = _handle orelse try fs.openDir(dir);

            defer {
                if (_handle == null and fs.needToCloseFiles()) {
                    handle.close();
                }
            }

            // if we get this far, it's a real directory, so we can just store the dir name.
            if (_handle == null) {
                dir = try DirnameStore.instance.append(string, _dir);
            }

            // Cache miss: read the directory entries
            var entries = fs.readdir(
                dir,
                handle,
                Iterator,
                iterator,
            ) catch |err| {
                return fs.readDirectoryError(dir, err) catch unreachable;
            };

            if (comptime FeatureFlags.enable_entry_cache) {
                const result = EntriesOption{
                    .entries = entries,
                };

                var out = try fs.entries.put(&cache_result.?, result);

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
        ) !File {
            FileSystem.setMaxFd(file.handle);

            // Skip the extra file.stat() call when possible
            var size = _size orelse (file.getEndPos() catch |err| {
                fs.readFileError(path, err);
                return err;
            });

            // Skip the pread call for empty files
            // Otherwise will get out of bounds errors
            // plus it's an unnecessary syscall
            if (size == 0) {
                if (comptime use_shared_buffer) {
                    shared_buffer.reset();
                    return File{ .path = Path.init(path), .contents = shared_buffer.list.items };
                } else {
                    return File{ .path = Path.init(path), .contents = "" };
                }
            }

            var file_contents: []u8 = undefined;

            // When we're serving a JavaScript-like file over HTTP, we do not want to cache the contents in memory
            // This imposes a performance hit because not reading from disk is faster than reading from disk
            // Part of that hit is allocating a temporary buffer to store the file contents in
            // As a mitigation, we can just keep one buffer forever and re-use it for the parsed files
            if (use_shared_buffer) {
                shared_buffer.reset();
                var offset: u64 = 0;
                try shared_buffer.growBy(size);
                shared_buffer.list.expandToCapacity();

                // if you press save on a large file we might not read all the
                // bytes in the first few pread() calls. we only handle this on
                // stream because we assume that this only realistically happens
                // during HMR
                while (true) {

                    // We use pread to ensure if the file handle was open, it doesn't seek from the last position
                    const read_count = file.preadAll(shared_buffer.list.items[offset..], offset) catch |err| {
                        fs.readFileError(path, err);
                        return err;
                    };
                    shared_buffer.list.items = shared_buffer.list.items[0 .. read_count + offset];
                    file_contents = shared_buffer.list.items;

                    if (comptime stream) {
                        // check again that stat() didn't change the file size
                        // another reason to only do this when stream
                        const new_size = file.getEndPos() catch |err| {
                            fs.readFileError(path, err);
                            return err;
                        };

                        offset += read_count;

                        // don't infinite loop is we're still not reading more
                        if (read_count == 0) break;

                        if (offset < new_size) {
                            try shared_buffer.growBy(new_size - size);
                            shared_buffer.list.expandToCapacity();
                            size = new_size;
                            continue;
                        }
                    }
                    break;
                }
            } else {
                // We use pread to ensure if the file handle was open, it doesn't seek from the last position
                var buf = try fs.allocator.alloc(u8, size);
                const read_count = file.preadAll(buf, 0) catch |err| {
                    fs.readFileError(path, err);
                    return err;
                };
                file_contents = buf[0..read_count];
            }

            return File{ .path = Path.init(path), .contents = file_contents };
        }

        pub fn kind(fs: *RealFS, _dir: string, base: string, existing_fd: StoredFileDescriptorType) !Entry.Cache {
            var dir = _dir;
            var combo = [2]string{ dir, base };
            var outpath: [bun.MAX_PATH_BYTES]u8 = undefined;
            var entry_path = path_handler.joinAbsStringBuf(fs.cwd, &outpath, &combo, .auto);

            outpath[entry_path.len + 1] = 0;
            outpath[entry_path.len] = 0;

            const absolute_path_c: [:0]const u8 = outpath[0..entry_path.len :0];

            var stat = try C.lstat_absolute(absolute_path_c);
            const is_symlink = stat.kind == std.fs.File.Kind.SymLink;
            var _kind = stat.kind;
            var cache = Entry.Cache{
                .kind = Entry.Kind.file,
                .symlink = PathString.empty,
            };
            var symlink: []const u8 = "";

            if (is_symlink) {
                var file = if (existing_fd != 0) std.fs.File{ .handle = existing_fd } else try std.fs.openFileAbsoluteZ(absolute_path_c, .{ .mode = .read_only });
                setMaxFd(file.handle);

                defer {
                    if (fs.needToCloseFiles() and existing_fd == 0) {
                        file.close();
                    } else if (comptime FeatureFlags.store_file_descriptors) {
                        cache.fd = file.handle;
                    }
                }
                const _stat = try file.stat();

                symlink = try bun.getFdPath(file.handle, &outpath);

                _kind = _stat.kind;
            }

            std.debug.assert(_kind != .SymLink);

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

        //     	// Stores the file entries for directories we've listed before
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

pub const Directory = struct { path: Path, contents: []string };
pub const File = struct { path: Path, contents: string };

pub const PathName = struct {
    base: string,
    dir: string,
    /// includes the leading .
    ext: string,
    filename: string,

    pub fn nonUniqueNameStringBase(self: *const PathName) string {
        // /bar/foo/index.js -> foo
        if (self.dir.len > 0 and strings.eqlComptime(self.base, "index")) {
            // "/index" -> "index"
            return Fs.PathName.init(self.dir).base;
        }

        if (comptime Environment.allow_assert) {
            std.debug.assert(!strings.includes(self.base, "/"));
        }

        // /bar/foo.js -> foo
        return self.base;
    }

    pub fn fmtIdentifier(self: *const PathName) strings.FormatValidIdentifier {
        return strings.fmtIdentifier(self.nonUniqueNameStringBase());
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
        return if (this.dir.len == 0) "./" else this.dir.ptr[0 .. this.dir.len + @intCast(
            usize,
            @boolToInt(
                this.dir[this.dir.len - 1] != std.fs.path.sep_posix and (@ptrToInt(this.dir.ptr) + this.dir.len + 1) == @ptrToInt(this.base.ptr),
            ),
        )];
    }

    pub fn init(_path: string) PathName {
        var path = _path;
        var base = path;
        var ext = path;
        var dir = path;
        var is_absolute = true;

        var _i = strings.lastIndexOfChar(path, '/');
        while (_i) |i| {
            // Stop if we found a non-trailing slash
            if (i + 1 != path.len) {
                base = path[i + 1 ..];
                dir = path[0..i];
                is_absolute = false;
                break;
            }

            // Ignore trailing slashes
            path = path[0..i];

            _i = strings.lastIndexOfChar(path, '/');
        }

        // Strip off the extension
        var _dot = strings.lastIndexOfChar(base, '.');
        if (_dot) |dot| {
            ext = base[dot..];
            base = base[0..dot];
        }

        if (is_absolute) {
            dir = &([_]u8{});
        }

        return PathName{
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
    pretty: string,
    text: string,
    namespace: string = "unspecified",
    name: PathName,
    is_disabled: bool = false,
    is_symlink: bool = false,

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

        return loaders.get(ext) orelse bun.options.Loader.fromString(ext);
    }

    pub fn isDataURL(this: *const Path) bool {
        return strings.eqlComptime(this.namespace, "dataurl");
    }

    pub fn isBun(this: *const Path) bool {
        return strings.eqlComptime(this.namespace, "bun");
    }

    pub fn isMacro(this: *const Path) bool {
        return strings.eqlComptime(this.namespace, "macro");
    }

    pub const PackageRelative = struct {
        path: string,
        name: string,
        is_parent_package: bool = false,
    };

    pub inline fn textZ(this: *const Path) [:0]const u8 {
        return @as([:0]const u8, this.text.ptr[0..this.text.len :0]);
    }

    pub inline fn sourceDir(this: *const Path) string {
        return this.name.dirWithTrailingSlash();
    }

    pub inline fn prettyDir(this: *const Path) string {
        return this.name.dirWithTrailingSlash();
    }

    // This duplicates but only when strictly necessary
    // This will skip allocating if it's already in FilenameStore or DirnameStore
    pub fn dupeAlloc(this: *const Path, allocator: std.mem.Allocator) !Fs.Path {
        if (this.text.ptr == this.pretty.ptr and this.text.len == this.text.len) {
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
        } else if (allocators.sliceRange(this.pretty, this.text)) |start_end| {
            if (FileSystem.FilenameStore.instance.exists(this.text) or FileSystem.DirnameStore.instance.exists(this.text)) {
                return this.*;
            }
            var new_path = Fs.Path.init(try FileSystem.FilenameStore.instance.append([]const u8, this.text));
            new_path.pretty = this.text[start_end[0]..start_end[1]];
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
                var new_pretty = buf[this.text.len + 1 ..];
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

    pub const empty = Fs.Path.init("");

    pub fn setRealpath(this: *Path, to: string) void {
        const old_path = this.text;
        this.text = to;
        this.name = PathName.init(to);
        this.pretty = old_path;
        this.is_symlink = true;
    }

    pub fn jsonStringify(self: *const @This(), options: anytype, writer: anytype) !void {
        return try std.json.stringify(self.text, options, writer);
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

    pub fn initWithNamespaceVirtual(comptime text: string, comptime namespace: string, comptime package: string) Path {
        return Path{
            .pretty = comptime "node:" ++ package,
            .is_symlink = true,
            .text = text,
            .namespace = namespace,
            .name = PathName.init(text),
        };
    }

    pub fn isBefore(a: *Path, b: Path) bool {
        return a.namespace > b.namespace ||
            (a.namespace == b.namespace and (a.text < b.text ||
            (a.text == b.text and (a.flags < b.flags ||
            (a.flags == b.flags)))));
    }

    pub fn isNodeModule(this: *const Path) bool {
        return strings.lastIndexOf(this.name.dir, std.fs.path.sep_str ++ "node_modules" ++ std.fs.path.sep_str) != null;
    }
};

// pub fn customRealpath(allocator: std.mem.Allocator, path: string) !string {
//     var opened = try std.os.open(path, if (Environment.isLinux) std.os.O.PATH else std.os.O.RDONLY, 0);
//     defer std.os.close(opened);

// }

test "PathName.init" {
    var file = "/root/directory/file.ext".*;
    const res = PathName.init(
        &file,
    );

    try std.testing.expectEqualStrings(res.dir, "/root/directory");
    try std.testing.expectEqualStrings(res.base, "file");
    try std.testing.expectEqualStrings(res.ext, ".ext");
}
