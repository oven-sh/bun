const std = @import("std");
usingnamespace @import("global.zig");
const sync = @import("sync.zig");
const alloc = @import("alloc.zig");
const expect = std.testing.expect;
const Mutex = @import("./lock.zig").Lock;
const Semaphore = sync.Semaphore;
const Fs = @This();
const path_handler = @import("./resolver/resolve_path.zig");

const allocators = @import("./allocators.zig");
const hash_map = @import("hash_map.zig");

const FSImpl = enum {
    Test,
    Real,

    pub const choice = if (isTest) FSImpl.Test else FSImpl.Real;
};

const FileOpenFlags = std.fs.File.OpenFlags;

// pub const FilesystemImplementation = @import("fs_impl.zig");

pub const Preallocate = struct {
    pub const Counts = struct {
        pub const dir_entry: usize = 4096;
        pub const files: usize = 8096;
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

    pub fn fetch(this: *BytecodeCacheFetcher, sourcename: string, fs: *RealFS) ?StoredFileDescriptorType {
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
                std.mem.copy(u8, &basename_buf, pathname.base);
                std.mem.copy(u8, basename_buf[pathname.base.len..], ".bytecode");
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
    pub const Map = allocators.BSSMap(EntriesOption, Preallocate.Counts.dir_entry, false, 128, true);
};
pub const DirEntry = struct {
    pub const EntryMap = hash_map.StringHashMap(*Entry);
    pub const EntryStore = allocators.BSSList(Entry, Preallocate.Counts.files);
    dir: string,
    fd: StoredFileDescriptorType = 0,
    data: EntryMap,

    pub fn removeEntry(dir: *DirEntry, name: string) !void {
        dir.data.remove(name);
    }

    pub fn addEntry(dir: *DirEntry, entry: std.fs.Dir.Entry) !void {
        var _kind: Entry.Kind = undefined;
        switch (entry.kind) {
            .Directory => {
                _kind = Entry.Kind.dir;
            },
            .SymLink => {
                // This might be wrong!
                _kind = Entry.Kind.file;
            },
            .File => {
                _kind = Entry.Kind.file;
            },
            else => {
                return;
            },
        }
        // entry.name only lives for the duration of the iteration

        const name = if (entry.name.len >= strings.StringOrTinyString.Max)
            strings.StringOrTinyString.init(try FileSystem.FilenameStore.instance.append(@TypeOf(entry.name), entry.name))
        else
            strings.StringOrTinyString.init(entry.name);

        const name_lowercased = if (entry.name.len >= strings.StringOrTinyString.Max)
            strings.StringOrTinyString.init(try FileSystem.FilenameStore.instance.appendLowerCase(@TypeOf(entry.name), entry.name))
        else
            strings.StringOrTinyString.initLowerCase(entry.name);

        var stored = try EntryStore.instance.append(
            Entry{
                .base_ = name,
                .base_lowercase_ = name_lowercased,
                .dir = dir.dir,
                .mutex = Mutex.init(),
                // Call "stat" lazily for performance. The "@material-ui/icons" package
                // contains a directory with over 11,000 entries in it and running "stat"
                // for each entry was a big performance issue for that package.
                .need_stat = entry.kind == .SymLink,
                .cache = Entry.Cache{
                    .symlink = PathString.empty,
                    .kind = _kind,
                },
            },
        );

        const stored_name = stored.base();

        try dir.data.put(stored.base_lowercase(), stored);
        if (comptime FeatureFlags.verbose_fs) {
            if (_kind == .dir) {
                Output.prettyln("   + {s}/", .{stored_name});
            } else {
                Output.prettyln("   + {s}", .{stored_name});
            }
        }
    }

    pub fn updateDir(i: *DirEntry, dir: string) void {
        var iter = i.data.iterator();
        i.dir = dir;
        while (iter.next()) |entry| {
            entry.value_ptr.dir = dir;
        }
    }

    pub fn empty(dir: string, allocator: *std.mem.Allocator) DirEntry {
        return DirEntry{ .dir = dir, .data = EntryMap.init(allocator) };
    }

    pub fn init(dir: string, allocator: *std.mem.Allocator) DirEntry {
        if (comptime FeatureFlags.verbose_fs) {
            Output.prettyln("\n  {s}", .{dir});
        }

        return DirEntry{ .dir = dir, .data = EntryMap.init(allocator) };
    }

    pub const Err = struct {
        original_err: anyerror,
        canonical_error: anyerror,
    };

    pub fn deinit(d: *DirEntry) void {
        d.data.allocator.free(d.dir);

        var iter = d.data.iterator();
        while (iter.next()) |file_entry| {
            // EntryStore.instance.at(file_entry.value).?.deinit(d.data.allocator);
        }

        d.data.deinit();
    }

    pub fn get(entry: *const DirEntry, _query: string) ?Entry.Lookup {
        if (_query.len == 0) return null;
        var scratch_lookup_buffer: [256]u8 = undefined;
        std.debug.assert(scratch_lookup_buffer.len >= _query.len);

        const query = strings.copyLowercase(_query, &scratch_lookup_buffer);
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
        comptime for (query_str) |c, i| {
            query[i] = std.ascii.toLower(c);
        };

        const query_hashed = comptime DirEntry.EntryMap.getHash(&query);

        const result = entry.data.getWithHash(&query, query_hashed) orelse return null;
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
        comptime for (query_str) |c, i| {
            query[i] = std.ascii.toLower(c);
        };

        const query_hashed = comptime DirEntry.EntryMap.getHash(&query);

        return entry.data.getWithHash(&query, query_hashed) != null;
    }
};

pub const Entry = struct {
    cache: Cache = Cache{},
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

    pub fn deinit(e: *Entry, allocator: *std.mem.Allocator) void {
        e.base_.deinit(allocator);

        allocator.free(e.dir);
        allocator.free(e.cache.symlink.slice());
        allocator.destroy(e);
    }

    pub const Cache = struct {
        symlink: PathString = PathString.empty,
        fd: StoredFileDescriptorType = 0,
        kind: Kind = Kind.file,
    };

    pub const Kind = enum {
        dir,
        file,
    };

    pub fn kind(entry: *Entry, fs: *FileSystem.Implementation) Kind {
        if (entry.need_stat) {
            entry.need_stat = false;
            entry.cache = fs.kind(entry.dir, entry.base(), entry.cache.fd) catch unreachable;
        }
        return entry.cache.kind;
    }

    pub fn symlink(entry: *Entry, fs: *FileSystem.Implementation) string {
        if (entry.need_stat) {
            entry.need_stat = false;
            entry.cache = fs.kind(entry.dir, entry.base(), entry.cache.fd) catch unreachable;
        }
        return entry.cache.symlink.slice();
    }
};

pub const FileSystem = struct {
    allocator: *std.mem.Allocator,
    top_level_dir: string = "/",
    fs: Implementation,

    dirname_store: *FileSystem.DirnameStore,
    filename_store: *FileSystem.FilenameStore,

    _tmpdir: ?Dir = null,

    entries_mutex: Mutex = Mutex.init(),
    entries: *EntriesOption.Map,

    threadlocal var tmpdir_handle: ?Dir = null;

    pub var _entries_option_map: *EntriesOption.Map = undefined;
    pub var _entries_option_map_loaded: bool = false;

    pub inline fn cwd() Dir {
        return Implementation.cwd();
    }

    pub fn bustEntriesCache(rfs: *FileSystem, file_path: string) void {
        rfs.entries.remove(file_path);
    }

    pub fn readDirectory(fs: *FileSystem, _dir: string, _handle: ?FileDescriptorType) !*EntriesOption {
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

        var handle = Dir{ .fd = _handle orelse try openFileAbsolute(dir, .{}) };

        defer {
            if (_handle == null and fs.needToCloseFiles()) {
                handle.close();
            }
        }

        // if we get this far, it's a real directory, so we can just store the dir name.
        if (_handle == null) {
            dir = try FileSystem.DirnameStore.instance.append(string, _dir);
        }

        // Cache miss: read the directory entries
        var entries = fs.fs.readdir(
            dir,
            handle,
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

    pub fn openDirectory(_dir: string, flags: std.fs.Dir.OpenDirOptions) !Dir {
        return @call(.{ .modifier = .always_inline }, Implementation.openDirectory, .{
            _dir,
            flags,
        });
    }

    pub fn close(fd: FileDescriptorType) void {
        Implementation.close(fd);
    }

    pub fn mkdir(dir: string) !void {
        if (comptime FSImpl.choice == .Real) {
            try std.fs.Dir.makePath(std.fs.cwd(), dir);
            return;
        }
    }

    pub fn readFileWithHandle(
        fs: *FileSystem,
        path: string,
        _size: ?usize,
        fd: FileDescriptorType,
        comptime use_shared_buffer: bool,
        shared_buffer: *MutableString,
    ) !string {
        const file = File{ .handle = fd };
        FileSystem.setMaxFd(file.handle);

        if (comptime FeatureFlags.disable_filesystem_cache) {
            _ = std.os.fcntl(file.handle, std.os.F_NOCACHE, 1) catch 0;
        }

        // Skip the extra file.stat() call when possible
        var size = _size orelse try file.getEndPos();

        // Skip the pread call for empty files
        // Otherwise will get out of bounds errors
        // plus it's an unnecessary syscall
        if (size == 0) {
            if (comptime use_shared_buffer) {
                shared_buffer.reset();
                return shared_buffer.list.items;
            } else {
                return "";
            }
        }

        // When we're serving a JavaScript-like file over HTTP, we do not want to cache the contents in memory
        // This imposes a performance hit because not reading from disk is faster than reading from disk
        // Part of that hit is allocating a temporary buffer to store the file contents in
        // As a mitigation, we can just keep one buffer forever and re-use it for the parsed files
        if (comptime use_shared_buffer) {
            shared_buffer.reset();
            try shared_buffer.growBy(size);
            shared_buffer.list.expandToCapacity();
            // We use pread to ensure if the file handle was open, it doesn't seek from the last position
            var read_count = try file.preadAll(shared_buffer.list.items, 0);
            shared_buffer.list.items = shared_buffer.list.items[0..read_count];
            return shared_buffer.list.items;
        } else {
            // We use pread to ensure if the file handle was open, it doesn't seek from the last position
            var buf = try fs.allocator.alloc(u8, size);
            var read_count = try file.preadAll(buf, 0);

            return buf[0..read_count];
        }
    }

    fn readDirectoryError(fs: *FileSystem, dir: string, err: anyerror) !*EntriesOption {
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

    pub fn openFileInDir(
        dirname_fd: StoredFileDescriptorType,
        path: string,
        flags: FileOpenFlags,
    ) !FileDescriptorType {
        return @call(
            .{
                .modifier = .always_inline,
            },
            Implementation.openFileInDir,
            .{ dirname_fd, path, flags },
        );
    }

    pub fn createFileInDir(
        dirname_fd: StoredFileDescriptorType,
        path: string,
        flags: std.fs.File.CreateFlags,
    ) !FileDescriptorType {
        return @call(
            .{
                .modifier = .always_inline,
            },
            Implementation.createFileInDir,
            .{ dirname_fd, path, flags },
        );
    }

    pub fn openFileAbsolute(
        path: string,
        flags: FileOpenFlags,
    ) !FileDescriptorType {
        return @call(
            .{
                .modifier = .always_inline,
            },
            Implementation.openFileAbsolute,
            .{ path, flags },
        );
    }

    pub fn openFileAbsoluteZ(
        path: stringZ,
        flags: FileOpenFlags,
    ) !FileDescriptorType {
        return @call(
            .{
                .modifier = .always_inline,
            },
            Implementation.openFileAbsoluteZ,
            .{ path, flags },
        );
    }

    pub inline fn openFileZ(
        path: stringZ,
        flags: FileOpenFlags,
    ) !File {
        return File{ .handle = try openFileAbsoluteZ(path, flags) };
    }

    pub inline fn openFile(
        path: string,
        flags: FileOpenFlags,
    ) !File {
        return File{ .handle = try openFileAbsolute(path, flags) };
    }

    pub inline fn createFile(
        path: string,
        flags: std.fs.File.CreateFlags,
    ) !File {
        return File{ .handle = try Implementation.createFileAbsolute(path, flags) };
    }

    pub inline fn getFileSize(
        handle: FileDescriptorType,
    ) !u64 {
        return @call(
            .{
                .modifier = .always_inline,
            },
            Implementation.getFileSize,
            .{handle},
        );
    }

    pub inline fn needToCloseFiles(fs: *FileSystem) bool {
        return fs.fs.needToCloseFiles();
    }

    pub fn tmpdir(fs: *FileSystem) Dir {
        if (tmpdir_handle == null) {
            tmpdir_handle = fs.fs.openTmpDir() catch unreachable;
        }

        return tmpdir_handle.?;
    }

    pub fn tmpname(fs: *const FileSystem, extname: string, buf: []u8, hash: u64) ![*:0]u8 {
        // PRNG was...not so random
        return try std.fmt.bufPrintZ(buf, "{x}{s}", .{ @truncate(u64, @intCast(u128, hash) * @intCast(u128, std.time.nanoTimestamp())), extname });
    }

    pub var max_fd: FileDescriptorType = 0;

    pub inline fn setMaxFd(fd: anytype) void {
        if (!FeatureFlags.store_file_descriptors) {
            return;
        }

        max_fd = std.math.max(fd, max_fd);
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
        allocator: *std.mem.Allocator,
        top_level_dir: ?string,
    ) !*FileSystem {
        var _top_level_dir = top_level_dir orelse (if (isBrowser) "/project/" else try std.process.getCwdAlloc(allocator));

        // Ensure there's a trailing separator in the top level directory
        // This makes path resolution more reliable
        if (!std.fs.path.isSep(_top_level_dir[_top_level_dir.len - 1])) {
            const tld = try allocator.alloc(u8, _top_level_dir.len + 1);
            std.mem.copy(u8, tld, _top_level_dir);
            tld[tld.len - 1] = std.fs.path.sep;
            // if (!isBrowser) {
            //     allocator.free(_top_level_dir);
            // }
            _top_level_dir = tld;
        }

        if (!_entries_option_map_loaded) {
            _entries_option_map = EntriesOption.Map.init(allocator);
            _entries_option_map_loaded = true;
        }

        if (!instance_loaded) {
            instance = FileSystem{
                .allocator = allocator,
                .top_level_dir = _top_level_dir,
                .fs = Implementation.init(
                    allocator,
                    _top_level_dir,
                    _entries_option_map,
                ),
                // .stats = std.StringHashMap(Stat).init(allocator),
                .dirname_store = FileSystem.DirnameStore.init(allocator),
                .filename_store = FileSystem.FilenameStore.init(allocator),
                .entries = _entries_option_map,
            };
            instance_loaded = true;

            instance.fs.parent_fs = &instance;
            _ = DirEntry.EntryStore.init(allocator);
        }

        return &instance;
    }

    // pub fn statBatch(fs: *FileSystemEntry, paths: []string) ![]?Stat {

    // }
    // pub fn stat(fs: *FileSystemEntry, path: string) !Stat {

    // }
    // pub fn readFile(fs: *FileSystemEntry, path: string) ?string {

    // }
    // pub fn readDir(fs: *FileSystemEntry, path: string) ?[]string {

    // }
    pub fn normalize(f: *const @This(), str: string) string {
        return @call(.{ .modifier = .always_inline }, path_handler.normalizeString, .{ str, true, .auto });
    }

    pub fn normalizeBuf(f: *const @This(), buf: []u8, str: string) string {
        return @call(.{ .modifier = .always_inline }, path_handler.normalizeStringBuf, .{ str, buf, false, .auto, false });
    }

    pub fn join(f: *const @This(), parts: anytype) string {
        return @call(.{ .modifier = .always_inline }, path_handler.joinStringBuf, .{
            &join_buf,
            parts,
            .auto,
        });
    }

    pub fn joinBuf(f: *const @This(), parts: anytype, buf: []u8) string {
        return @call(.{ .modifier = .always_inline }, path_handler.joinStringBuf, .{
            buf,
            parts,
            .auto,
        });
    }

    pub fn relative(f: *const @This(), from: string, to: string) string {
        return @call(.{ .modifier = .always_inline }, path_handler.relative, .{
            from,
            to,
        });
    }

    pub fn relativeAlloc(f: *const @This(), allocator: *std.mem.Allocator, from: string, to: string) string {
        return @call(.{ .modifier = .always_inline }, path_handler.relativeAlloc, .{
            alloc,
            from,
            to,
        });
    }

    pub fn relativeTo(f: *const @This(), to: string) string {
        return @call(.{ .modifier = .always_inline }, path_handler.relative, .{
            f.top_level_dir,
            to,
        });
    }

    pub fn relativeFrom(f: *const @This(), from: string) string {
        return @call(.{ .modifier = .always_inline }, path_handler.relative, .{
            from,
            f.top_level_dir,
        });
    }

    pub fn relativeToAlloc(f: *const @This(), allocator: *std.mem.Allocator, to: string) string {
        return @call(.{ .modifier = .always_inline }, path_handler.relativeAlloc, .{
            allocator,
            f.top_level_dir,
            to,
        });
    }

    pub fn absAlloc(f: *const @This(), allocator: *std.mem.Allocator, parts: anytype) !string {
        const joined = path_handler.joinAbsString(
            f.top_level_dir,
            parts,
            .auto,
        );
        return try allocator.dupe(u8, joined);
    }

    pub fn abs(f: *const @This(), parts: anytype) string {
        return path_handler.joinAbsString(
            f.top_level_dir,
            parts,
            .auto,
        );
    }

    pub fn absBuf(f: *@This(), parts: anytype, buf: []u8) string {
        return path_handler.joinAbsStringBuf(f.top_level_dir, buf, parts, .auto);
    }

    pub fn joinAlloc(f: *@This(), allocator: *std.mem.Allocator, parts: anytype) !string {
        const joined = f.join(parts);
        return try allocator.dupe(u8, joined);
    }

    pub const Implementation: type = FSType;
};

pub const LoadedFile = struct { path: Path, contents: string };

pub const Dir = struct {
    fd: FileDescriptorType,

    pub const OpenDirOptions = std.fs.Dir.OpenDirOptions;
    pub const OpenError = std.fs.Dir.OpenError;
    pub const CreateFlags = std.fs.File.CreateFlags;

    pub inline fn getStd(file: Dir) std.fs.Dir {
        return std.fs.Dir{ .fd = file.fd };
    }

    pub fn close(self: Dir) void {
        FileSystem.close(self.fd);
    }
    pub inline fn openFile(self: Dir, sub_path: []const u8, flags: FileOpenFlags) File.OpenError!File {
        return File{ .handle = try FileSystem.openFileInDir(self.fd, sub_path, flags) };
    }
    pub inline fn openFileZ(self: Dir, sub_path: [*:0]const u8, flags: FileOpenFlags) File.OpenError!File {
        return try FileSystem.openFileZ(self.fd, sub_path, flags);
    }
    pub inline fn createFile(self: Dir, path: []const u8, flags: CreateFlags) File.OpenError!File {
        return File{ .handle = try FileSystem.createFileInDir(self.fd, path, flags) };
    }

    pub inline fn writeFile(self: Dir, path: []const u8, buf: []const u8) !void {
        var file = try self.createFile(path, .{ .truncate = true });
        defer file.close();
        _ = try file.writeAll(buf);
    }

    pub inline fn makePath(self: Dir, sub_path: []const u8) !void {
        switch (comptime FSImpl.choice) {
            .Test => {},
            .Real => {
                try std.fs.Dir.makePath(std.fs.Dir{ .fd = self.fd }, sub_path);
            },
        }
    }
    pub fn makeOpenPath(self: Dir, sub_path: []const u8, open_dir_options: OpenDirOptions) !Dir {
        switch (comptime FSImpl.choice) {
            .Test => {},
            .Real => {
                return Dir{ .fd = try std.fs.Dir.makeOpenPath(std.fs.Dir{ .fd = self.fd }, sub_path, open_dir_options) };
            },
        }
    }

    pub fn iterate(self: Dir) std.fs.Dir.Iterator {
        switch (comptime FSImpl.choice) {
            .Test => {},
            .Real => {
                return std.fs.Dir.iterate(std.fs.Dir{ .fd = self.fd });
            },
        }
    }
};

const Stat = std.fs.File.Stat;

pub const File = struct {
    handle: FileDescriptorType,

    pub const ReadError = std.fs.File.ReadError;
    pub const PReadError = std.fs.File.PReadError;
    pub const WriteError = std.fs.File.WriteError;
    pub const OpenError = std.fs.File.OpenError;

    pub fn close(this: File) void {
        FSType.close(this.handle);
    }

    pub const Writer = std.io.Writer(File, WriteError, writeNoinline);
    pub const Reader = std.io.Reader(File, ReadError, readNoinline);

    pub fn writer(this: File) Writer {
        return Writer{ .context = this };
    }

    pub fn reader(this: File) Reader {
        return Reader{ .context = this };
    }

    pub inline fn getStd(file: File) std.fs.File {
        return std.fs.File{ .handle = file.handle };
    }

    pub inline fn read(self: File, buffer: []u8) ReadError!usize {
        return try FSType.read(self.handle, buffer);
    }

    pub fn readNoinline(self: File, bytes: []u8) ReadError!usize {
        return try FSType.read(self.handle, bytes);
    }

    pub fn pread(self: File, buffer: []u8, offset: u64) PReadError!usize {
        return try FSType.pread(self.handle, buffer, offset);
    }

    pub inline fn realpath(path: string, buf: *[std.fs.MAX_PATH_BYTES]u8) anyerror!string {
        return try FSType.realpath(path, buf);
    }

    pub inline fn getPath(
        self: File,
        buffer: *[std.fs.MAX_PATH_BYTES]u8,
    ) !string {
        return try FSType.getPath(self.handle, buffer);
    }

    pub fn preadAll(self: File, buffer: []u8, offset: u64) PReadError!usize {
        var index: usize = 0;
        while (index != buffer.len) {
            const amt = try self.pread(buffer[index..], offset);
            if (amt == 0) break;
            index += amt;
        }
        return index;
    }

    pub fn readAll(self: File, buffer: []u8) ReadError!usize {
        var index: usize = 0;
        while (index != buffer.len) {
            const amt = try self.read(buffer[index..]);
            if (amt == 0) break;
            index += amt;
        }
        return index;
    }

    pub fn readToEndAlloc(
        self: File,
        allocator: *std.mem.Allocator,
        size_: ?usize,
    ) ![]u8 {
        const size = size_ orelse try self.getEndPos();
        var buf = try allocator.alloc(u8, size);
        return buf[0..try self.readAll(buf)];
    }

    pub fn pwriteAll(self: File, bytes: []const u8, offset: u64) PWriteError!void {
        var index: usize = 0;
        while (index < bytes.len) {
            index += try self.pwrite(bytes[index..], offset + index);
        }
    }

    pub inline fn write(self: File, bytes: []const u8) WriteError!usize {
        return try FSType.write(self.handle, bytes);
    }

    pub fn writeNoinline(self: File, bytes: []const u8) WriteError!usize {
        return try FSType.write(self.handle, bytes);
    }

    pub fn writeAll(self: File, bytes: []const u8) WriteError!void {
        var index: usize = 0;
        while (index < bytes.len) {
            index += try self.write(
                bytes[index..],
            );
        }
    }
    pub inline fn pwrite(self: File, bytes: []const u8, offset: u64) PWriteError!usize {
        return try FSType.pwrite(self.handle, bytes);
    }

    pub fn getPos(self: File) !u64 {
        return try FSType.getPos(self.handle);
    }

    pub fn seekTo(self: File, offset: u64) !void {
        return try FSType.seekTo(self.handle, offset);
    }

    pub inline fn stat(self: File) !std.fs.File.Stat {
        return try FSType.stat(
            self.handle,
        );
    }

    pub inline fn getEndPos(self: File) !usize {
        const stat_ = try self.stat();
        return @intCast(usize, stat_.size);
    }
};

pub const PathName = struct {
    base: string,
    dir: string,
    ext: string,
    filename: string,

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
    pub fn nonUniqueNameString(self: *const PathName, allocator: *std.mem.Allocator) !string {
        if (strings.eqlComptime(self.base, "index")) {
            if (self.dir.len > 0) {
                return MutableString.ensureValidIdentifier(PathName.init(self.dir).base, allocator);
            }
        }

        return MutableString.ensureValidIdentifier(self.base, allocator);
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
    // This will skip allocating if it's already in FileSystem.FilenameStore or FileSystem.DirnameStore
    pub fn dupeAlloc(this: *const Path, allocator: *std.mem.Allocator) !Fs.Path {
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
                std.mem.copy(u8, buf, this.text);
                buf.ptr[this.text.len] = 0;
                var new_pretty = buf[this.text.len + 1 ..];
                std.mem.copy(u8, buf[this.text.len + 1 ..], this.pretty);
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

    pub fn generateKey(p: *Path, allocator: *std.mem.Allocator) !string {
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

pub const ModKeyError = error{
    Unusable,
};
pub const ModKey = struct {
    inode: std.fs.File.INode = 0,
    size: u64 = 0,
    mtime: i128 = 0,
    mode: std.fs.File.Mode = 0,

    threadlocal var hash_bytes: [32]u8 = undefined;
    threadlocal var hash_name_buf: [1024]u8 = undefined;

    pub fn hashName(
        this: *const ModKey,
        basename: string,
    ) !string {

        // We shouldn't just read the contents of the ModKey into memory
        // The hash should be deterministic across computers and operating systems.
        // inode is non-deterministic across volumes within the same compuiter
        // so if we're not going to do a full content hash, we should use mtime and size.
        // even mtime is debatable.
        var hash_bytes_remain: []u8 = hash_bytes[0..];
        std.mem.writeIntNative(@TypeOf(this.size), hash_bytes_remain[0..@sizeOf(@TypeOf(this.size))], this.size);
        hash_bytes_remain = hash_bytes_remain[@sizeOf(@TypeOf(this.size))..];
        std.mem.writeIntNative(@TypeOf(this.mtime), hash_bytes_remain[0..@sizeOf(@TypeOf(this.mtime))], this.mtime);

        return try std.fmt.bufPrint(
            &hash_name_buf,
            "{s}-{x}",
            .{
                basename,
                @truncate(u32, std.hash.Wyhash.hash(1, &hash_bytes)),
            },
        );
    }

    pub fn generate(path: string, file: File) anyerror!ModKey {
        const stat_ = try file.stat();

        const seconds = @divTrunc(stat_.mtime, @as(@TypeOf(stat_.mtime), std.time.ns_per_s));

        // We can't detect changes if the file system zeros out the modification time
        if (seconds == 0 and std.time.ns_per_s == 0) {
            return error.Unusable;
        }

        // Don't generate a modification key if the file is too new
        const now = std.time.nanoTimestamp();
        const now_seconds = @divTrunc(now, std.time.ns_per_s);
        if (seconds > seconds or (seconds == now_seconds and stat_.mtime > now)) {
            return error.Unusable;
        }

        return ModKey{
            .inode = stat_.inode,
            .size = stat_.size,
            .mtime = stat_.mtime,
            .mode = stat_.mode,
            // .uid = stat.
        };
    }
    pub const SafetyGap = 3;
};

pub const RealFS = struct {
    entries: *EntriesOption.Map,
    allocator: *std.mem.Allocator,
    // limiter: *Limiter,
    cwd: string,
    parent_fs: *FileSystem = undefined,
    file_limit: usize = 32,
    file_quota: usize = 32,

    pub var tmpdir_buf: [std.fs.MAX_PATH_BYTES]u8 = undefined;

    const PLATFORM_TMP_DIR: string = switch (std.Target.current.os.tag) {
        .windows => "%TMPDIR%",
        .macos => "/private/tmp",
        else => "/tmp",
    };

    pub var tmpdir_path: []const u8 = undefined;
    pub fn openTmpDir(fs: *const RealFS) !Dir {
        var tmpdir_base = std.os.getenv("TMPDIR") orelse PLATFORM_TMP_DIR;
        tmpdir_path = try std.fs.realpath(tmpdir_base, &tmpdir_buf);
        return try openDirectory(tmpdir_path, .{ .access_sub_paths = true, .iterate = true });
    }

    pub fn fetchCacheFile(fs: *RealFS, basename: string) !std.fs.File {
        const file = try fs._fetchCacheFile(basename);
        if (comptime FeatureFlags.store_file_descriptors) {
            FileSystem.setMaxFd(file.handle);
        }
        return file;
    }

    pub const Tmpfile = struct {
        fd: std.os.fd_t = 0,
        dir_fd: std.os.fd_t = 0,

        pub inline fn dir(this: *Tmpfile) Dir {
            return Dir{
                .fd = this.dir_fd,
            };
        }

        pub inline fn file(this: *Tmpfile) File {
            return File{
                .handle = this.fd,
            };
        }

        pub fn close(this: *Tmpfile) void {
            if (this.fd != 0) std.os.close(this.fd);
        }

        pub fn create(this: *Tmpfile, rfs: *RealFS, name: [*:0]const u8) !void {
            var tmpdir_ = try rfs.openTmpDir();

            const flags = std.os.O_CREAT | std.os.O_RDWR | std.os.O_CLOEXEC;
            this.dir_fd = tmpdir_.fd;
            this.fd = try std.os.openatZ(tmpdir_.fd, name, flags, std.os.S_IRWXO);
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

                this.dir().getStd().deleteFileZ(name) catch {};
            }
        }
    };

    inline fn _fetchCacheFile(fs: *RealFS, basename: string) !std.fs.File {
        var parts = [_]string{ "node_modules", ".cache", basename };
        var path = fs.parent_fs.join(&parts);
        return std.fs.cwd().openFile(path, .{ .write = true, .read = true, .lock = .Shared }) catch |err| {
            path = fs.parent_fs.join(parts[0..2]);
            try std.fs.cwd().makePath(path);

            path = fs.parent_fs.join(&parts);
            return try std.fs.cwd().createFile(path, .{ .read = true, .lock = .Shared });
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

    // Always try to max out how many files we can keep open
    pub fn adjustUlimit() !usize {
        const LIMITS = [_]std.os.rlimit_resource{ std.os.rlimit_resource.STACK, std.os.rlimit_resource.NOFILE };
        inline for (LIMITS) |limit_type, i| {
            const limit = try std.os.getrlimit(limit_type);

            if (limit.cur < limit.max) {
                var new_limit = std.mem.zeroes(std.os.rlimit);
                new_limit.cur = limit.max;
                new_limit.max = limit.max;

                try std.os.setrlimit(limit_type, new_limit);
            }

            if (i == LIMITS.len - 1) return limit.max;
        }
    }

    pub fn init(
        allocator: *std.mem.Allocator,
        cwd_: string,
        entries: *EntriesOption.Map,
    ) RealFS {
        const file_limit = adjustUlimit() catch unreachable;

        return RealFS{
            .entries = entries,
            .allocator = allocator,
            .cwd = cwd_,
            .file_limit = file_limit,
            .file_quota = file_limit,
        };
    }

    pub fn modKeyWithFile(fs: *RealFS, path: string, file: anytype) anyerror!ModKey {
        return try ModKey.generate(fs, path, file);
    }

    pub fn cwd() Dir {
        return Dir{ .fd = std.fs.cwd().fd };
    }

    pub inline fn read(fd: FileDescriptorType, buf: []u8) !usize {
        return try std.os.read(fd, buf);
    }

    pub inline fn write(fd: FileDescriptorType, buf: []const u8) !usize {
        return try std.os.write(fd, buf);
    }

    pub inline fn pwrite(fd: FileDescriptorType, buf: []const u8, offset: usize) !usize {
        return try std.os.pwrite(fd, buf, offset);
    }

    pub inline fn pread(fd: FileDescriptorType, buf: []u8, offset: usize) !usize {
        return try std.os.pread(fd, buf, offset);
    }

    pub inline fn openFileInDir(dir: FileDescriptorType, subpath: string, flags: FileOpenFlags) !FileDescriptorType {
        const file = try std.fs.Dir.openFile(std.fs.Dir{ .fd = dir }, subpath, flags);
        return file.handle;
    }

    pub inline fn createFileInDir(dir: FileDescriptorType, subpath: string, flags: std.fs.File.CreateFlags) !FileDescriptorType {
        const file = try std.fs.Dir.createFile(std.fs.Dir{ .fd = dir }, subpath, flags);
        return file.handle;
    }

    pub inline fn openFileAbsolute(path: string, flags: FileOpenFlags) !FileDescriptorType {
        const file = try std.fs.openFileAbsolute(path, flags);
        return file.handle;
    }

    pub inline fn openFileAbsoluteZ(path: stringZ, flags: FileOpenFlags) !FileDescriptorType {
        const file = try std.fs.openFileAbsoluteZ(path, flags);
        return file.handle;
    }

    pub inline fn createFileAbsolute(path: string, flags: std.fs.File.CreateFlags) !FileDescriptorType {
        const file = try std.fs.createFileAbsolute(path, flags);
        return file.handle;
    }

    pub inline fn seekTo(fd: FileDescriptorType, offset: usize) !void {
        try std.fs.File.seekTo(std.fs.File{ .handle = fd }, offset);
    }

    pub inline fn getPos(
        fd: FileDescriptorType,
    ) !usize {
        return try std.fs.File.getPos(std.fs.File{ .handle = fd });
    }

    pub fn openDirectory(path: string, flags: std.fs.Dir.OpenDirOptions) anyerror!Dir {
        const dir = try std.fs.cwd().openDir(path, flags);
        return Dir{ .fd = dir.fd };
    }

    pub fn modKey(fs: *const RealFS, path: string) anyerror!ModKey {
        // fs.limiter.before();
        // defer fs.limiter.after();
        var file = try std.fs.openFileAbsolute(path, FileOpenFlags{ .read = true });
        defer {
            if (fs.needToCloseFiles()) {
                file.close();
            }
        }
        return try fs.modKeyWithFile(path, file);
    }

    pub inline fn getFileSize(
        handle: FileDescriptorType,
    ) !u64 {
        const stat_ = try std.os.fstat(handle);
        return @intCast(u64, stat_.size);
    }

    pub inline fn close(fd: FileDescriptorType) void {
        std.os.close(fd);
    }

    pub inline fn realpath(path: string, buf: *[std.fs.MAX_PATH_BYTES]u8) !string {
        return try std.os.realpath(path, buf);
    }

    pub inline fn getPath(handle: FileDescriptorType, buf: *[std.fs.MAX_PATH_BYTES]u8) !string {
        return try std.os.getFdPath(handle, buf);
    }

    pub fn readdir(
        fs: *RealFS,
        _dir: string,
        handle: Dir,
    ) !DirEntry {
        // fs.limiter.before();
        // defer fs.limiter.after();

        var iter: std.fs.Dir.Iterator = handle.iterate();
        var dir = DirEntry.init(_dir, fs.allocator);
        errdefer dir.deinit();

        if (FeatureFlags.store_file_descriptors) {
            FileSystem.setMaxFd(handle.fd);
            dir.fd = handle.fd;
        }

        while (try iter.next()) |_entry| {
            try dir.addEntry(_entry);
        }

        return dir;
    }

    threadlocal var temp_entries_option: EntriesOption = undefined;

    fn readFileError(fs: *RealFS, path: string, err: anyerror) void {}

    pub inline fn stat(fd: FileDescriptorType) anyerror!Stat {
        return try std.fs.File.stat(.{ .handle = fd });
    }

    pub fn kind(fs: *RealFS, _dir: string, base: string, existing_fd: StoredFileDescriptorType) !Entry.Cache {
        var dir = _dir;
        var combo = [2]string{ dir, base };
        var outpath: [std.fs.MAX_PATH_BYTES]u8 = undefined;
        var entry_path = path_handler.joinAbsStringBuf(fs.cwd, &outpath, &combo, .auto);

        outpath[entry_path.len + 1] = 0;
        outpath[entry_path.len] = 0;

        const absolute_path_c: [:0]const u8 = outpath[0..entry_path.len :0];

        var lstat = try C.lstat_absolute(absolute_path_c);
        const is_symlink = lstat.kind == std.fs.File.Kind.SymLink;
        var _kind = lstat.kind;
        var cache = Entry.Cache{
            .kind = Entry.Kind.file,
            .symlink = PathString.empty,
        };
        var symlink: []const u8 = "";

        if (is_symlink) {
            var file = if (existing_fd != 0) std.fs.File{ .handle = existing_fd } else try std.fs.openFileAbsoluteZ(absolute_path_c, .{ .read = true });
            FileSystem.setMaxFd(file.handle);

            defer {
                if (fs.needToCloseFiles() and existing_fd == 0) {
                    file.close();
                } else if (comptime FeatureFlags.store_file_descriptors) {
                    cache.fd = file.handle;
                }
            }
            const _stat = try file.stat();

            symlink = try std.os.getFdPath(file.handle, &outpath);

            _kind = _stat.kind;
        }

        std.debug.assert(_kind != .SymLink);

        if (_kind == .Directory) {
            cache.kind = .dir;
        } else {
            cache.kind = .file;
        }
        if (symlink.len > 0) {
            cache.symlink = PathString.init(try FileSystem.FilenameStore.instance.append([]const u8, symlink));
        }

        return cache;
    }

    fn openDir(unsafe_dir_string: string) std.fs.File.OpenError!FileDescriptorType {
        const fd = try std.fs.openDirAbsolute(unsafe_dir_string, std.fs.Dir.OpenDirOptions{ .iterate = true, .access_sub_paths = true, .no_follow = false });

        return fd.fd;
    }

    //     	// Stores the file entries for directories we've listed before
    // entries_mutex: std.Mutex
    // entries      map[string]entriesOrErr

    // // If true, do not use the "entries" cache
    // doNotCacheEntries bool
};

pub const TestFS = struct {
    pub const TestFile = struct {
        bytes: std.ArrayList(u8),
        kind: std.fs.File.Kind = .File,

        pub fn toDirEntry(this: TestFile, name: string) std.fs.Dir.Entry {
            return std.fs.Dir.Entry{ .name = name, .kind = this.kind };
        }
    };
    const Handle = struct {
        pos: usize = 0,
        path: string = "",
    };
    entries: *EntriesOption.Map,
    allocator: *std.mem.Allocator,
    parent_fs: *FileSystem = undefined,

    pub var map: std.StringHashMap(TestFile) = undefined;
    pub var handles: std.AutoArrayHashMap(FileDescriptorType, Handle) = undefined;
    pub var max_fd: FileDescriptorType = 1;
    pub var loaded = false;
    pub fn init(
        allocator: *std.mem.Allocator,
        cwd_: string,
        entries: *EntriesOption.Map,
    ) TestFS {
        if (!loaded) {
            map = std.StringHashMap(TestFile).init(allocator);
            loaded = true;
            handles = std.AutoArrayHashMap(FileDescriptorType, Handle).init(allocator);
        }

        return TestFS{
            .entries = entries,
            .allocator = allocator,
        };
    }

    pub var cwd_path: string = "/bun-testfs";

    pub fn close(fd: FileDescriptorType) void {
        const path = handles.get(fd) orelse @panic("tried to close file without descriptor");
        std.debug.assert(handles.swapRemove(fd));
    }

    pub fn create(allocator: *std.mem.Allocator, data: anytype) void {
        _ = FileSystem.init1(allocator, cwd_path) catch unreachable;
        make(allocator, data);
    }

    pub fn make(allocator: *std.mem.Allocator, data: anytype) void {
        const Data = @TypeOf(data);
        _ = map.getOrPutValue(cwd_path, TestFile{ .kind = .Directory, .bytes = std.ArrayList(u8).init(map.allocator) }) catch unreachable;
        _ = handles.getOrPutValue(0, .{ .path = cwd_path }) catch unreachable;

        const fields: []const std.builtin.TypeInfo.StructField = comptime std.meta.fields(Data);
        inline for (fields) |field| {
            var file = TestFile{ .bytes = std.ArrayList(u8).init(map.allocator) };
            const value = @field(data, field.name);
            var had_bytes = false;
            const ValueType = @TypeOf(value);
            const file_data: []const std.builtin.TypeInfo.StructField = std.meta.fields(ValueType);
            inline for (file_data) |file_field| {
                const file_value = @field(value, file_field.name);
                if (comptime strings.eql(file_field.name, "data")) {
                    file.bytes = std.ArrayList(u8).init(allocator);
                    file.bytes.insertSlice(0, std.mem.span(file_value)) catch unreachable;
                    had_bytes = true;
                } else if (comptime strings.eql(file_field.name, "kind")) {
                    file.kind = @field(file_field, file_field.name);
                    had_bytes = file.kind == .File or had_bytes;
                }
            }

            if (!had_bytes) {
                file.kind = .File;
            }

            var parent = std.fs.path.dirname(field.name);
            while (parent) |_parent| {
                _ = map.getOrPutValue(_parent, .{
                    .bytes = std.ArrayList(u8).init(map.allocator),
                    .kind = .Directory,
                }) catch unreachable;
                parent = std.fs.path.dirname(_parent);
            }
            map.put(field.name, file) catch unreachable;
        }
    }

    pub fn kind(fs: *TestFS, _dir: string, base: string, existing_fd: StoredFileDescriptorType) !Entry.Cache {
        var parts = [2]string{ _dir, base };
        var pathbuf: [std.fs.MAX_PATH_BYTES]u8 = undefined;
        var joined = path_handler.joinAbsStringBuf(cwd, &pathbuf, &parts, .posix);
        var fd = try openFileAbsolute(joined, .{});
        var handle = handles.get(fd).?;
        var file = map.get(handle).?;
        return Entry.Cache{
            .kind = if (file.kind == .File) .file else .dir,
            .symlink = false,
            .fd = fd,
        };
    }

    pub fn modKeyWithFile(fs: *RealFS, path: string, file: anytype) anyerror!ModKey {
        return try ModKey.generate(fs, path, file);
    }

    pub fn cwd() Dir {
        return Dir{ .fd = handles.get(0).? };
    }

    pub fn read(fd: FileDescriptorType, buf: []u8) File.ReadError!usize {
        var handle = handles.getPtr(fd) orelse return error.NotOpenForReading;
        const file = map.getPtr(handle.path) orelse return error.Unexpected;
        if (handle.pos >= file.bytes.items.len) return 0;

        const bytes = file.bytes.items[handle.pos..];
        const len = std.math.min(buf.len, bytes.len);
        std.mem.copy(u8, buf, bytes[0..len]);
        handle.pos += len;
        handle.pos = std.math.min(file.bytes.items.len, handle.pos);
        return len;
    }

    pub inline fn write(fd: FileDescriptorType, buf: []const u8) File.WriteError!usize {
        var handle = handles.getPtr(fd) orelse return error.NotOpenForWriting;
        const file = map.getPtr(handle.path) orelse return error.Unexpected;

        if (handle.pos >= file.bytes.capacity) {
            file.bytes.ensureUnusedCapacity(buf.len) catch return error.DiskQuota;
        }

        file.bytes.insertSlice(handle.pos, buf) catch return error.DiskQuota;
        handle.pos += buf.len;
        return buf.len;
    }

    pub inline fn pwrite(fd: FileDescriptorType, buf: []const u8, offset: usize) File.PWriteError!usize {
        const handle = handles.get(fd) orelse return error.NotOpenForWriting;
        const file = map.getPtr(handle.path) orelse return error.Unexpected;

        file.bytes.insertSlice(offset, buf) catch return error.DiskQuota;
        return buf.len;
    }

    pub inline fn pread(fd: FileDescriptorType, buf: []u8, offset: usize) File.PReadError!usize {
        var handle = handles.getPtr(fd) orelse return error.NotOpenForWriting;
        const file = map.getPtr(handle.path) orelse return error.Unexpected;
        if (offset >= file.bytes.items.len) return 0;
        var remainder = file.bytes.items[offset..];
        remainder = remainder[0..std.math.min(buf.len, remainder.len)];
        std.mem.copy(u8, buf, remainder);
        return remainder.len;
    }

    pub inline fn openFileInDir(dir: FileDescriptorType, subpath: string, flags: FileOpenFlags) !FileDescriptorType {
        const fd = max_fd;
        max_fd += 1;
        const handle = handles.get(dir) orelse return error.NotOpenForWriting;
        var parts = [_]string{ dir_path, subpath };
        var outbuf: [std.fs.MAX_PATH_BYTES]u8 = undefined;
        var path = path_handler.joinAbsStringBuf(cwd_path, &outbuf, &parts, .posix);
        if (!map.contains(handle.path)) return error.FileNotFound;
        try handles.put(fd, .{ .path = try map.allocator.dupe(u8, path) });
        return fd;
    }

    pub inline fn createFileInDir(dir: FileDescriptorType, subpath: string, flags: std.fs.File.CreateFlags) !FileDescriptorType {
        const fd = max_fd;
        max_fd += 1;
        const dir_path = handles.get(dir) orelse return error.NotOpenForWriting;
        var parts = [_]string{ dir_path.path, subpath };
        var outbuf: [std.fs.MAX_PATH_BYTES]u8 = undefined;
        var path = path_handler.joinAbsStringBuf(cwd_path, &outbuf, &parts, .posix);
        return createFileAbsolute(path, flags);
    }

    pub inline fn openFileAbsolute(path: string, flags: FileOpenFlags) !FileDescriptorType {
        if (!map.contains(path)) return error.FileNotFound;
        const fd = max_fd;
        max_fd += 1;

        try handles.put(fd, .{ .path = try map.allocator.dupe(u8, path) });
        return fd;
    }

    pub inline fn openFileAbsoluteZ(path_z: stringZ, flags: FileOpenFlags) !FileDescriptorType {
        const path = std.mem.span(path_z);
        return try openFileAbsolute(path, flags);
    }

    pub inline fn createFileAbsolute(path: string, flags: std.fs.File.CreateFlags) !FileDescriptorType {
        const fd = max_fd;
        max_fd += 1;

        var entry = try map.getOrPutValue(
            try map.allocator.dupe(
                u8,
                path,
            ),
            TestFile{ .kind = .File, .bytes = std.ArrayList(u8).init(map.allocator) },
        );

        if (flags.truncate) {
            entry.value_ptr.bytes.clearRetainingCapacity();
        }

        try handles.put(fd, .{ .path = try map.allocator.dupe(u8, path) });
        return fd;
    }

    pub inline fn seekTo(fd: FileDescriptorType, offset: usize) !void {
        var handle = handles.getPtr(fd) orelse @panic("bad file");
        handle.pos = offset;
    }

    pub inline fn getPos(
        fd: FileDescriptorType,
    ) !usize {
        const handle = handles.get(fd) orelse @panic("bad file");
        return handle.pos;
    }

    pub fn needToCloseFiles(fs: *TestFS) bool {
        return false;
    }

    pub fn openDirectory(path: string, flags: std.fs.Dir.OpenDirOptions) anyerror!Dir {
        var entry = try map.getOrPutValue(
            try map.allocator.dupe(
                u8,
                path,
            ),
            TestFile{ .kind = .Directory, .bytes = std.ArrayList(u8).init(map.allocator) },
        );
        const fd = max_fd;
        max_fd += 1;
        try handles.put(fd, .{ .path = try map.allocator.dupe(u8, path) });
        return fd;
    }

    pub fn modKey(fs: *const TestFS, path: string) anyerror!ModKey {
        return ModKey{};
    }

    pub inline fn realpath(path: string, buf: *[std.fs.MAX_PATH_BYTES]u8) anyerror!string {
        return path;
    }

    pub inline fn getPath(
        fd: FileDescriptorType,
        buffer: *[std.fs.MAX_PATH_BYTES]u8,
    ) !string {
        return handles.get(fd).?.path;
    }

    pub inline fn getFileSize(
        fd: FileDescriptorType,
    ) !u64 {
        const handle = handles.get(fd) orelse @panic("bad file");
        const file = map.get(handle.path) orelse @panic("bad file");
        return file.bytes.items.len;
    }

    pub fn readdir(
        fs: *TestFS,
        _dir: string,
        dir_: Dir,
    ) !DirEntry {
        var handle = handles.getPtr(dir_.fd) orelse @panic("bad dir");
        const dir = map.get(handle.path) orelse @panic("bad dir");

        var dirent = DirEntry.init(_dir, fs.allocator);

        var iter = map.keyIterator();
        while (iter.next()) |key_| {
            const key = key_.*;
            if (strings.eql(key, _dir)) continue;

            if (strings.indexOf(key, handle.path)) |i| {
                if (i == 0) {
                    const basename = std.fs.path.basename(key);
                    if (std.fs.path.dirname(basename) != null) continue;

                    try dirent.addEntry(map.get(key).?.toDirEntry(basename));
                }
            }
        }

        return dirent;
    }

    pub inline fn stat(fd: FileDescriptorType) anyerror!Stat {
        const handle = handles.get(fd) orelse @panic("bad file");
        const file = map.get(handle.path) orelse @panic("bad file");

        return Stat{
            .size = file.bytes.items.len,
            .mode = 0x666,
            .kind = file.kind,
            .inode = @truncate(Stat.INode, std.hash.Wyhash.hash(10, handle.path)),
        };
    }
};

const FSType = switch (FSImpl.choice) {
    FSImpl.Test => TestFS,
    FSImpl.Real => RealFS,
};

test "PathName.init" {
    var file = "/root/directory/file.ext".*;
    const res = PathName.init(
        &file,
    );

    try std.testing.expectEqualStrings(res.dir, "/root/directory");
    try std.testing.expectEqualStrings(res.base, "file");
    try std.testing.expectEqualStrings(res.ext, ".ext");
}

const expectEqual = std.testing.expectEqual;

test "TestFS.init" {
    var instance = try FileSystem.init1(default_allocator, null);
    const fs = FileSystem;
    var file = try fs.createFile("/hiiiiiii", .{ .truncate = true });
    try file.writeAll("wow");
    try file.seekTo(0);
    var buf: [1024]u8 = undefined;
    const read = try file.readAll(&buf);
    try expectEqual(read, 3);
    try expect(strings.eql(buf[0..read], "wow"));

    try expectEqual(read, try file.getPos());
    try file.seekTo(0);
}

test "TestFS.make" {
    var instance = try FileSystem.init1(default_allocator, null);
    const fs = FileSystem;
    TestFS.make(default_allocator, .{
        .@"/foo/bar/wow" = .{
            .data = "hello",
        },
        .@"/foo/bar/hi" = .{
            .data = "greetings",
        },
        .@"/foo/bar/salutations" = .{
            .data = "welcome",
        },
    });
    var file = try fs.openFile("/foo/bar/hi", .{});
    var buf: [1024]u8 = undefined;
    var data = buf[0..try file.readAll(&buf)];
    try std.testing.expectEqualStrings(data, "greetings");

    var entries = try instance.readDirectory("/foo/bar", null);
    var wow = entries.entries.get("wow").?;
    try std.testing.expectEqualStrings(wow.entry.base(), "wow");
}
