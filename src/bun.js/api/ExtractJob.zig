pub const ExtractJob = struct {
    archive_data: []const u8,
    destination: ?[]const u8,
    glob_patterns: ?[][]const u8,
    skip_components: u32,
    task: jsc.WorkPoolTask = .{ .callback = &runTask },
    promise: jsc.JSPromise.Strong = .{},
    vm: *jsc.VirtualMachine,
    files: std.StringArrayHashMap([]u8),
    file_count: usize = 0,
    error_message: ?[]const u8 = null,
    any_task: jsc.AnyTask,
    poll: Async.KeepAlive = .{},

    pub fn create(
        vm: *jsc.VirtualMachine,
        globalThis: *JSGlobalObject,
        archive_data: []const u8,
        destination: ?[]const u8,
        glob_patterns: ?[][]const u8,
        skip_components: u32,
    ) *ExtractJob {
        const job = bun.default_allocator.create(ExtractJob) catch bun.outOfMemory();
        job.* = .{
            .archive_data = archive_data,
            .destination = destination,
            .glob_patterns = glob_patterns,
            .skip_components = skip_components,
            .vm = vm,
            .files = std.StringArrayHashMap([]u8).init(bun.default_allocator),
            .any_task = jsc.AnyTask.New(@This(), &runFromJS).init(undefined),
        };

        job.promise = jsc.JSPromise.Strong.init(globalThis);
        job.any_task = jsc.AnyTask.New(@This(), &runFromJS).init(job);
        job.poll.ref(vm);
        jsc.WorkPool.schedule(&job.task);
        return job;
    }

    pub fn runTask(task: *jsc.WorkPoolTask) void {
        const job: *ExtractJob = @fieldParentPtr("task", task);
        defer job.vm.enqueueTaskConcurrent(jsc.ConcurrentTask.create(job.any_task.task()));
        job.extractArchive() catch {
            job.error_message = "Failed to extract archive";
        };
    }

    fn extractArchive(this: *ExtractJob) !void {
        if (this.destination) |dest| {
            if (this.glob_patterns == null and this.skip_components == 0) {
                const is_absolute = std.fs.path.isAbsolute(dest);
                var dir = if (is_absolute)
                    try std.fs.openDirAbsolute(dest, .{})
                else
                    try std.fs.cwd().openDir(dest, .{});
                defer dir.close();

                this.file_count = try bun.libarchive.Archiver.extractToDir(
                    this.archive_data,
                    dir,
                    null,
                    void,
                    {},
                    .{ .depth_to_skip = 0 },
                );
            } else {
                try this.extractToDisk(dest);
            }
        } else {
            try this.extractToMemory();
        }
    }

    fn extractToDisk(this: *ExtractJob, dest: []const u8) !void {
        const lib = bun.libarchive.lib;
        var reader: bun.libarchive.BufferReadStream = undefined;
        reader.init(this.archive_data);
        defer reader.deinit();

        switch (reader.openRead()) {
            .ok => {},
            else => return error.CannotOpenArchive,
        }

        const archive = reader.archive;
        var entry: *lib.Archive.Entry = undefined;
        var normalized_buf: bun.PathBuffer = undefined;

        loop: while (true) {
            switch (archive.readNextHeader(&entry)) {
                .ok => {},
                .eof => break,
                .retry => continue,
                else => return error.ReadError,
            }

            const pathname = entry.pathname();
            const kind = bun.sys.kindFromMode(entry.filetype());

            const path_to_use = if (this.skip_components > 0) blk: {
                var tokenizer = std.mem.tokenizeScalar(u8, pathname, '/');
                for (0..this.skip_components) |_| {
                    if (tokenizer.next() == null) continue :loop;
                }
                break :blk tokenizer.rest();
            } else bun.asByteSlice(pathname);

            const normalized = bun.path.normalizeBuf(path_to_use, &normalized_buf, .auto);
            if (normalized.len == 0 or (normalized.len == 1 and normalized[0] == '.')) continue;
            if (std.fs.path.isAbsolute(normalized)) continue;

            {
                var it = std.mem.splitScalar(u8, normalized, '/');
                while (it.next()) |segment| {
                    if (std.mem.eql(u8, segment, "..")) continue :loop;
                }
            }

            if (this.glob_patterns) |patterns| {
                var matched = false;
                for (patterns) |pattern| {
                    if (bun.glob.match(pattern, normalized).matches()) {
                        matched = true;
                        break;
                    }
                }
                if (!matched) continue;
            }

            switch (kind) {
                .directory => {
                    var path_buf: bun.PathBuffer = undefined;
                    const dest_path = bun.path.joinAbsStringBufZ(dest, &path_buf, &.{normalized}, .auto);
                    bun.makePath(std.fs.cwd(), bun.asByteSlice(dest_path)) catch {};
                    this.file_count += 1;
                },
                .file => {
                    const size = entry.size();
                    if (size < 0) continue;

                    var path_buf: bun.PathBuffer = undefined;
                    const dest_path = bun.path.joinAbsStringBufZ(dest, &path_buf, &.{normalized}, .auto);
                    const dirname = bun.path.dirname(dest_path, .auto);
                    if (dirname.len > 0) bun.makePath(std.fs.cwd(), dirname) catch {};

                    const fd = bun.sys.open(dest_path, bun.O.CREAT | bun.O.WRONLY | bun.O.TRUNC, 0o644).unwrap() catch continue;
                    defer fd.close();

                    if (size > 0) {
                        switch (archive.readDataIntoFd(fd.cast())) {
                            .ok => {},
                            else => continue,
                        }
                    }
                    this.file_count += 1;
                },
                else => {},
            }
        }
    }

    fn extractToMemory(this: *ExtractJob) !void {
        const lib = bun.libarchive.lib;
        const allocator = bun.default_allocator;

        var reader: bun.libarchive.BufferReadStream = undefined;
        reader.init(this.archive_data);
        defer reader.deinit();

        switch (reader.openRead()) {
            .ok => {},
            else => return error.CannotOpenArchive,
        }

        const archive = reader.archive;
        var entry: *lib.Archive.Entry = undefined;
        var normalized_buf: bun.PathBuffer = undefined;

        loop: while (true) {
            switch (archive.readNextHeader(&entry)) {
                .ok => {},
                .eof => break,
                .retry => continue,
                else => return error.ReadError,
            }

            const pathname = entry.pathname();
            const kind = bun.sys.kindFromMode(entry.filetype());
            if (kind != .file) continue;

            const path_to_use = if (this.skip_components > 0) blk: {
                var tokenizer = std.mem.tokenizeScalar(u8, pathname, '/');
                for (0..this.skip_components) |_| {
                    if (tokenizer.next() == null) continue :loop;
                }
                break :blk tokenizer.rest();
            } else bun.asByteSlice(pathname);

            const normalized = bun.path.normalizeBuf(path_to_use, &normalized_buf, .auto);
            if (normalized.len == 0 or (normalized.len == 1 and normalized[0] == '.')) continue;
            if (std.fs.path.isAbsolute(normalized)) continue;

            {
                var it = std.mem.splitScalar(u8, normalized, '/');
                while (it.next()) |segment| {
                    if (std.mem.eql(u8, segment, "..")) continue :loop;
                }
            }

            if (this.glob_patterns) |patterns| {
                var matched = false;
                for (patterns) |pattern| {
                    if (bun.glob.match(pattern, normalized).matches()) {
                        matched = true;
                        break;
                    }
                }
                if (!matched) continue;
            }

            const size = entry.size();
            if (size < 0) continue;

            const buf = try allocator.alloc(u8, @intCast(size));
            errdefer allocator.free(buf);

            if (size > 0) {
                var total: usize = 0;
                while (total < buf.len) {
                    const read = archive.readData(buf[total..]);
                    if (read <= 0) {
                        if (read < 0) return error.ReadError;
                        break;
                    }
                    total += @intCast(read);
                }
            }

            const key = try allocator.dupe(u8, normalized);
            try this.files.put(key, buf);
        }
    }

    pub fn runFromJS(this: *ExtractJob) void {
        const globalThis = this.vm.global;
        const promise = this.promise.swap();
        defer this.deinit();

        if (this.error_message) |msg| {
            promise.reject(globalThis, globalThis.createErrorInstance("{s}", .{msg}));
            return;
        }

        if (this.destination) |_| {
            promise.resolve(globalThis, JSValue.jsNumber(this.file_count));
        } else {
            const result = JSValue.createEmptyObject(globalThis, this.files.count());
            var iter = this.files.iterator();
            while (iter.next()) |e| {
                const store = jsc.WebCore.Blob.Store.init(e.value_ptr.*, bun.default_allocator);
                const blob = jsc.WebCore.Blob.initWithStore(store, globalThis);
                result.put(globalThis, ZigString.fromUTF8(e.key_ptr.*), jsc.WebCore.Blob.new(blob).toJS(globalThis));
            }
            promise.resolve(globalThis, result);
        }
    }

    pub fn deinit(this: *ExtractJob) void {
        this.poll.unref(this.vm);
        if (this.destination) |d| bun.default_allocator.free(d);
        if (this.glob_patterns) |patterns| {
            for (patterns) |pattern| bun.default_allocator.free(pattern);
            bun.default_allocator.free(patterns);
        }
        bun.default_allocator.free(this.archive_data);

        var iter = this.files.iterator();
        while (iter.next()) |e| {
            bun.default_allocator.free(e.key_ptr.*);
            if (this.destination == null and this.error_message != null) {
                bun.default_allocator.free(e.value_ptr.*);
            }
        }
        this.files.deinit();
        this.promise.deinit();
        bun.default_allocator.destroy(this);
    }
};

const std = @import("std");

const bun = @import("bun");
const Async = bun.Async;

const jsc = bun.jsc;
const JSGlobalObject = jsc.JSGlobalObject;
const JSValue = jsc.JSValue;
const ZigString = jsc.ZigString;
