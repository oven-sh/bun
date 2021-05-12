const std = @import("std");
usingnamespace @import("global.zig");
const sync = @import("sync.zig");
const alloc = @import("alloc.zig");
const expect = std.testing.expect;
const Mutex = sync.Mutex;
const Semaphore = sync.Semaphore;

const resolvePath = @import("./resolver/resolve_path.zig").resolvePath;

// pub const FilesystemImplementation = @import("fs_impl.zig");

//

threadlocal var scratch_lookup_buffer = [_]u8{0} ** 255;

pub const FileSystem = struct {
    allocator: *std.mem.Allocator,
    top_level_dir: string = "/",
    fs: Implementation,

    pub const Error = error{
        ENOENT,
        EACCESS,
        INVALID_NAME,
        ENOTDIR,
    };

    pub fn init1(allocator: *std.mem.Allocator, top_level_dir: ?string, enable_watcher: bool) !*FileSystem {
        var files = try allocator.create(FileSystem);
        files.* = FileSystem{
            .allocator = allocator,
            .top_level_dir = top_level_dir orelse (if (isBrowser) "/project" else try std.process.getCwdAlloc(allocator)),
            .fs = Implementation.init(allocator, enable_watcher),
            // .stats = std.StringHashMap(Stat).init(allocator),
        };

        return files;
    }

    pub const DirEntry = struct {
        pub const EntryMap = std.StringArrayHashMap(*Entry);
        dir: string,
        data: EntryMap,

        pub fn empty(dir: string, allocator: *std.mem.Allocator) DirEntry {
            return DirEntry{ .dir = dir, .data = EntryMap.init(allocator) };
        }

        pub fn init(dir: string, allocator: *std.mem.Allocator) DirEntry {
            return DirEntry{ .dir = dir, .data = EntryMap.init(allocator) };
        }

        pub const Err = struct {
            original_err: anyerror,
            canonical_error: anyerror,
        };

        pub fn deinit(d: *DirEntry) void {
            d.data.allocator.free(d.dir);

            for (d.data.items()) |item| {
                item.value.deinit(d.data.allocator);
            }
            d.data.deinit();
        }

        pub fn get(entry: *DirEntry, _query: string) ?Entry.Lookup {
            if (_query.len == 0) return null;

            var end: usize = 0;
            std.debug.assert(scratch_lookup_buffer.len >= _query.len);
            for (_query) |c, i| {
                scratch_lookup_buffer[i] = std.ascii.toLower(c);
                end = i;
            }
            const query = scratch_lookup_buffer[0 .. end + 1];
            const result = entry.data.get(query) orelse return null;
            if (!strings.eql(result.base, query)) {
                return Entry.Lookup{ .entry = result, .diff_case = Entry.Lookup.DifferentCase{
                    .dir = entry.dir,
                    .query = _query,
                    .actual = result.base,
                } };
            }

            return Entry.Lookup{ .entry = result, .diff_case = null };
        }
    };

    pub const Entry = struct {
        cache: Cache = Cache{},
        dir: string,
        base: string,
        mutex: Mutex,
        need_stat: bool = true,

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
            allocator.free(e.base);
            allocator.free(e.dir);
            allocator.free(e.cache.symlink);
            allocator.destroy(e);
        }

        pub const Cache = struct {
            symlink: string = "",
            kind: Kind = Kind.file,
        };

        pub const Kind = enum {
            dir,
            file,
        };

        pub fn kind(entry: *Entry, fs: *Implementation) !Kind {
            entry.mutex.lock();
            defer entry.mutex.unlock();
            if (entry.need_stat) {
                entry.need_stat = false;
                entry.cache = try fs.kind(entry.dir, entry.base);
            }
            return entry.cache.kind;
        }

        pub fn symlink(entry: *Entry, fs: *Implementation) !string {
            entry.mutex.lock();
            defer entry.mutex.unlock();
            if (entry.need_stat) {
                entry.need_stat = false;
                entry.cache = try fs.kind(entry.dir, entry.base);
            }
            return entry.cache.symlink;
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

    pub const RealFS = struct {
        entries_mutex: Mutex = Mutex.init(),
        entries: std.StringHashMap(EntriesOption),
        allocator: *std.mem.Allocator,
        do_not_cache_entries: bool = false,
        limiter: Limiter,
        watcher: ?std.StringHashMap(WatchData) = null,
        watcher_mutex: Mutex = Mutex.init(),

        pub fn init(allocator: *std.mem.Allocator, enable_watcher: bool) RealFS {
            return RealFS{
                .entries = std.StringHashMap(EntriesOption).init(allocator),
                .allocator = allocator,
                .limiter = Limiter.init(allocator),
                .watcher = if (enable_watcher) std.StringHashMap(WatchData).init(allocator) else null,
            };
        }

        pub const ModKey = struct {
            inode: std.fs.File.INode = 0,
            size: u64 = 0,
            mtime: i128 = 0,
            mode: std.fs.File.Mode = 0,

            pub const Error = error{
                Unusable,
            };
            pub fn generate(fs: *RealFS, path: string) anyerror!ModKey {
                var file = try std.fs.openFileAbsolute(path, std.fs.File.OpenFlags{ .read = true });
                defer file.close();
                const stat = try file.stat();

                const seconds = stat.mtime / std.time.ns_per_s;

                // We can't detect changes if the file system zeros out the modification time
                if (seconds == 0 and std.time.ns_per_s == 0) {
                    return Error.Unusable;
                }

                // Don't generate a modification key if the file is too new
                const now = std.time.nanoTimestamp();
                const now_seconds = now / std.time.ns_per_s;
                if (seconds > seconds or (seconds == now_seconds and stat.mtime > now)) {
                    return Error.Unusable;
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

        fn modKeyError(fs: *RealFS, path: string, err: anyerror) !void {
            if (fs.watcher) |*watcher| {
                watch_data.watch_mutex.lock();
                defer watch_data.watch_mutex.unlock();
                var state = WatchData.State.file_missing;

                switch (err) {
                    ModKey.Error.Unusable => {
                        state = WatchData.State.file_unusable_mod_key;
                    },
                    else => {},
                }

                var entry = try watcher.getOrPutValue(path, WatchData{ .state = state });
                entry.value.state = state;
            }
            return err;
        }

        pub fn modKey(fs: *RealFS, path: string) !ModKey {
            fs.limiter.before();
            defer fs.limiter.after();

            const key = ModKey.generate(fs, path) catch |err| return fs.modKeyError(path, err);
            if (fs.watcher) |*watcher| {
                fs.watcher_mutex.lock();
                defer fs.watcher_mutex.unlock();

                var entry = try watcher.getOrPutValue(path, WatchData{ .state = .file_has_mod_key, .mod_key = key });
                entry.value.mod_key = key;
            }

            return key;
        }

        pub const WatchData = struct {
            dir_entries: []string = &([_]string{}),
            file_contents: string = "",
            mod_key: ModKey = ModKey{},
            watch_mutex: Mutex = Mutex.init(),
            state: State = State.none,

            pub const State = enum {
                none,
                dir_has_entries,
                dir_missing,
                file_has_mod_key,
                file_need_mod_key,
                file_missing,
                file_unusable_mod_key,
            };
        };

        pub const EntriesOption = union(Tag) {
            entries: DirEntry,
            err: DirEntry.Err,

            pub const Tag = enum {
                entries,
                err,
            };
        };

        // Limit the number of files open simultaneously to avoid ulimit issues
        pub const Limiter = struct {
            semaphore: Semaphore,
            pub fn init(allocator: *std.mem.Allocator) Limiter {
                return Limiter{
                    .semaphore = Semaphore.init(32),
                    // .counter = std.atomic.Int(u8).init(0),
                    // .lock = std.Thread.Mutex.init(),
                };
            }

            // This will block if the number of open files is already at the limit
            pub fn before(limiter: *Limiter) void {
                limiter.semaphore.wait();
                // var added = limiter.counter.fetchAdd(1);
            }

            pub fn after(limiter: *Limiter) void {
                limiter.semaphore.post();
                // limiter.counter.decr();
                // if (limiter.held) |hold| {
                //     hold.release();
                //     limiter.held = null;
                // }
            }
        };

        fn readdir(fs: *RealFS, _dir: string) !DirEntry {
            fs.limiter.before();
            defer fs.limiter.after();

            var handle = try std.fs.openDirAbsolute(_dir, std.fs.Dir.OpenDirOptions{ .iterate = true, .access_sub_paths = true });
            defer handle.close();

            var iter: std.fs.Dir.Iterator = handle.iterate();
            var dir = DirEntry{ .data = DirEntry.EntryMap.init(fs.allocator), .dir = _dir };
            errdefer dir.deinit();
            while (try iter.next()) |_entry| {
                const entry: std.fs.Dir.Entry = _entry;
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
                        continue;
                    },
                }

                // entry.name only lives for the duration of the iteration
                var name = try fs.allocator.alloc(u8, entry.name.len);
                for (entry.name) |c, i| {
                    name[i] = std.ascii.toLower(c);
                }
                var entry_ptr = try fs.allocator.create(Entry);
                entry_ptr.* = Entry{
                    .base = name,
                    .dir = _dir,
                    .mutex = Mutex.init(),
                    // Call "stat" lazily for performance. The "@material-ui/icons" package
                    // contains a directory with over 11,000 entries in it and running "stat"
                    // for each entry was a big performance issue for that package.
                    .need_stat = true,
                    .cache = Entry.Cache{
                        .symlink = if (entry.kind == std.fs.Dir.Entry.Kind.SymLink) (try fs.allocator.dupe(u8, name)) else "",
                        .kind = _kind,
                    },
                };

                try dir.data.put(name, entry_ptr);
            }
            // Copy at the bottom here so in the event of an error, we don't deinit the dir string.
            dir.dir = _dir;
            return dir;
        }

        fn readDirectoryError(fs: *RealFS, dir: string, err: anyerror) !void {
            if (fs.watcher) |*watcher| {
                fs.watcher_mutex.lock();
                defer fs.watcher_mutex.unlock();
                try watcher.put(dir, WatchData{ .state = .dir_missing });
            }

            if (!fs.do_not_cache_entries) {
                fs.entries_mutex.lock();
                defer fs.entries_mutex.unlock();

                try fs.entries.put(dir, EntriesOption{
                    .err = DirEntry.Err{ .original_err = err, .canonical_error = err },
                });
            }
        }
        pub fn readDirectory(fs: *RealFS, dir: string) !EntriesOption {
            if (!fs.do_not_cache_entries) {
                fs.entries_mutex.lock();
                defer fs.entries_mutex.unlock();

                // First, check the cache
                if (fs.entries.get(dir)) |_dir| {
                    return EntriesOption{ .entries = _dir.entries };
                }
            }

            // Cache miss: read the directory entries
            const entries = fs.readdir(dir) catch |err| {
                _ = fs.readDirectoryError(dir, err) catch {};
                return err;
            };

            if (fs.watcher) |*watcher| {
                fs.watcher_mutex.lock();
                defer fs.watcher_mutex.unlock();
                var _entries = entries.data.items();
                const names = try fs.allocator.alloc([]const u8, _entries.len);
                for (_entries) |entry, i| {
                    names[i] = try fs.allocator.dupe(u8, entry.key);
                }
                strings.sortAsc(names);

                try watcher.put(
                    try fs.allocator.dupe(u8, dir),
                    WatchData{ .dir_entries = names, .state = .dir_has_entries },
                );
            }

            fs.entries_mutex.lock();
            defer fs.entries_mutex.unlock();
            const result = EntriesOption{
                .entries = entries,
            };
            if (!fs.do_not_cache_entries) {
                try fs.entries.put(dir, result);
            }
            return result;
        }

        fn readFileError(fs: *RealFS, path: string, err: anyerror) !void {
            if (fs.watcher) |*watcher| {
                fs.watcher_mutex.lock();
                defer fs.watcher_mutex.unlock();
                var res = try watcher.getOrPutValue(path, WatchData{ .state = .file_missing });
                res.value.state = .file_missing;
            }

            return err;
        }

        pub fn readFile(fs: *RealFS, path: string, _size: ?usize) !File {
            fs.limiter.before();
            defer fs.limiter.after();

            const file: std.fs.File = std.fs.openFileAbsolute(path, std.fs.File.OpenFlags{ .read = true, .write = false }) catch |err| return fs.readFileError(path, err);
            defer file.close();

            // Skip the extra file.stat() call when possible
            const size = _size orelse (try file.getEndPos() catch |err| return fs.readFileError(path, err));
            const file_contents: []u8 = file.readToEndAllocOptions(fs.allocator, size, size, @alignOf(u8), null) catch |err| return fs.readFileError(path, err);

            if (fs.watcher) |*watcher| {
                var hold = fs.watcher_mutex.acquire();
                defer hold.release();
                var res = try watcher.getOrPutValue(path, WatchData{});
                res.value.state = .file_need_mod_key;
                res.value.file_contents = file_contents;
            }

            return File{ .path = Path.init(path), .contents = file_contents };
        }

        pub fn kind(fs: *RealFS, _dir: string, base: string) !Entry.Cache {
            var dir = _dir;
            var combo = [2]string{ dir, base };
            var entry_path = try std.fs.path.join(fs.allocator, &combo);
            defer fs.allocator.free(entry_path);

            fs.limiter.before();
            defer fs.limiter.after();

            const file = try std.fs.openFileAbsolute(entry_path, .{ .read = true, .write = false });
            defer file.close();
            const stat = try file.stat();
            var _kind = stat.kind;
            var cache = Entry.Cache{ .kind = Entry.Kind.file, .symlink = "" };

            if (_kind == .SymLink) {
                // windows has a max filepath of 255 chars
                // we give it a little longer for other platforms
                var out_buffer = [_]u8{ 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0 };
                var out_slice = &(out_buffer);
                var symlink = entry_path;
                var links_walked: u8 = 0;

                while (links_walked < 255) : (links_walked += 1) {
                    var link = try std.os.readlink(symlink, out_slice);

                    if (!std.fs.path.isAbsolute(link)) {
                        combo[0] = dir;
                        combo[1] = link;
                        if (link.ptr != out_slice.ptr) {
                            fs.allocator.free(link);
                        }
                        link = std.fs.path.join(fs.allocator, &combo) catch return cache;
                    }
                    // TODO: do we need to clean the path?
                    symlink = link;

                    const file2 = std.fs.openFileAbsolute(symlink, std.fs.File.OpenFlags{ .read = true, .write = false }) catch return cache;
                    defer file2.close();

                    const stat2 = file2.stat() catch return cache;

                    // Re-run "lstat" on the symlink target
                    mode = stat2.mode;
                    if (mode == .Symlink) {
                        break;
                    }
                    dir = std.fs.path.dirname(link) orelse return cache;
                }

                if (links_walked > 255) {
                    return cache;
                }
            }

            if (mode == .Directory) {
                _kind = Entry.Kind.dir;
            } else {
                _kind = Entry.Kind.file;
            }
            cache.kind = _kind;
            cache.symlink = symlink;

            return cache;
        }

        //     	// Stores the file entries for directories we've listed before
        // entries_mutex: std.Mutex
        // entries      map[string]entriesOrErr

        // // If true, do not use the "entries" cache
        // doNotCacheEntries bool
    };

    pub const Implementation = comptime {
        switch (build_target) {
            .wasi, .native => return RealFS,
            .wasm => return WasmFS,
        }
    };
};

pub const FileSystemEntry = union(FileSystemEntry.Kind) {
    file: File,
    directory: Directory,
    not_found: FileNotFound,

    pub const Kind = enum(u8) {
        file,
        directory,
        not_found,
    };
};

pub const Directory = struct { path: Path, contents: []string };
pub const File = struct { path: Path, contents: string };

pub const PathName = struct {
    base: string,
    dir: string,
    ext: string,

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
    pub fn nonUniqueNameString(self: *PathName, allocator: *std.mem.Allocator) !string {
        if (strings.eqlComptime(self.base, "index")) {
            if (self.dir.len > 0) {
                return MutableString.ensureValidIdentifier(PathName.init(self.dir).dir, allocator);
            }
        }

        return MutableString.ensureValidIdentifier(self.base, allocator);
    }

    pub fn init(_path: string) PathName {
        var path = _path;
        var base = path;
        var ext = path;
        var dir = path;

        var _i = strings.lastIndexOfChar(path, '/');
        while (_i) |i| {
            // Stop if we found a non-trailing slash
            if (i + 1 != path.len) {
                base = path[i + 1 ..];
                dir = path[0..i];
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

        return PathName{
            .dir = dir,
            .base = base,
            .ext = ext,
        };
    }
};

threadlocal var normalize_buf: [1024]u8 = undefined;

pub const Path = struct {
    pretty: string,
    text: string,
    namespace: string = "unspecified",
    name: PathName,

    pub fn generateKey(p: *Path, allocator: *std.mem.Allocator) !string {
        return try std.fmt.allocPrint(allocator, "{s}://{s}", .{ p.namespace, p.text });
    }

    // for now, assume you won't try to normalize a path longer than 1024 chars
    pub fn normalize(str: string, allocator: *std.mem.Allocator) string {
        if (str.len == 0 or (str.len == 1 and str[0] == ' ')) return ".";
        if (resolvePath(normalize_buf, str)) |out| {
            return allocator.dupe(u8, out) catch unreachable;
        }
        return str;
    }

    pub fn init(text: string) Path {
        return Path{ .pretty = text, .text = text, .namespace = "file", .name = PathName.init(text) };
    }

    pub fn initWithNamespace(text: string, namespace: string) Path {
        return Path{ .pretty = text, .text = text, .namespace = namespace, .name = PathName.init(text) };
    }

    pub fn isBefore(a: *Path, b: Path) bool {
        return a.namespace > b.namespace ||
            (a.namespace == b.namespace and (a.text < b.text ||
            (a.text == b.text and (a.flags < b.flags ||
            (a.flags == b.flags)))));
    }
};

test "PathName.init" {
    var file = "/root/directory/file.ext".*;
    const res = PathName.init(
        &file,
    );

    std.testing.expectEqualStrings(res.dir, "/root/directory");
    std.testing.expectEqualStrings(res.base, "file");
    std.testing.expectEqualStrings(res.ext, ".ext");
}
