const MAX_MEMORY_SIZE = 100 * 1024 * 1024;

pub const Compression = union(enum) {
    none: void,
    gzip: u8,
};

pub const FileList = struct {
    entries: []FileEntry,
    allocator: std.mem.Allocator,

    pub fn deinit(self: *@This()) void {
        for (self.entries) |*entry| entry.deinit(self.allocator);
        self.allocator.free(self.entries);
    }
};

pub const FileEntry = struct {
    archive_path: []const u8,
    data: jsc.Node.BlobOrStringOrBuffer,

    pub fn deinit(self: *@This(), allocator: std.mem.Allocator) void {
        allocator.free(self.archive_path);
        self.data.deinit();
    }
};

fn writeEntry(
    archive: *bun.libarchive.lib.Archive,
    file_entry: FileEntry,
    allocator: std.mem.Allocator,
) !void {
    const lib = bun.libarchive.lib;
    const entry = lib.Archive.Entry.new();
    defer entry.free();

    const content = file_entry.data.slice();
    const path_z = try allocator.dupeZ(u8, file_entry.archive_path);
    defer allocator.free(path_z);

    entry.setPathname(path_z);
    entry.setSize(@intCast(content.len));
    entry.setFiletype(@intFromEnum(lib.FileType.regular));
    entry.setPerm(0o644);
    entry.setMtime(@intCast(std.time.timestamp()), 0);

    if (archive.writeHeader(entry) != .ok) return error.WriteHeaderError;

    if (content.len > 0) {
        var offset: usize = 0;
        while (offset < content.len) {
            const written = archive.writeData(content[offset..]);
            if (written <= 0) return error.WriteDataError;
            offset += @intCast(written);
        }
    }
}

pub const TarballJob = struct {
    files: FileList,
    destination: ?[]const u8 = null,
    compression: Compression = .none,
    task: jsc.WorkPoolTask = .{ .callback = &runTask },
    promise: jsc.JSPromise.Strong = .{},
    vm: *jsc.VirtualMachine,
    output_buffer: []u8 = &.{},
    bytes_written: usize = 0,
    error_message: ?[]const u8 = null,
    any_task: jsc.AnyTask,
    poll: Async.KeepAlive = .{},

    pub const new = bun.TrivialNew(@This());

    pub fn runTask(task: *jsc.WorkPoolTask) void {
        const job: *TarballJob = @fieldParentPtr("task", task);
        defer job.vm.enqueueTaskConcurrent(jsc.ConcurrentTask.create(job.any_task.task()));
        job.createArchive() catch {
            job.error_message = "Failed to create archive";
        };
    }

    fn createArchive(this: *TarballJob) !void {
        const allocator = bun.default_allocator;
        const lib = bun.libarchive.lib;
        const archive = lib.Archive.writeNew();
        defer _ = archive.writeFinish();

        if (archive.writeSetFormatUstar() != .ok) return error.ArchiveFormatError;

        switch (this.compression) {
            .gzip => |level| {
                if (archive.writeAddFilterGzip() != .ok) return error.CompressionError;
                var level_buf: [64]u8 = undefined;
                const level_str = try std.fmt.bufPrintZ(&level_buf, "compression-level={d}", .{level});
                _ = archive.writeSetOptions(level_str);
            },
            .none => {},
        }

        if (this.destination) |destination| {
            const path_z = try allocator.dupeZ(u8, destination);
            defer allocator.free(path_z);
            if (archive.writeOpenFilename(path_z) != .ok) return error.CannotOpenFile;
        } else {
            var estimated_size: usize = 0;
            for (this.files.entries) |entry| {
                estimated_size += 512;
                const blocks = (entry.data.slice().len + 511) / 512;
                estimated_size += blocks * 512;
            }
            estimated_size = @max((estimated_size + 1024) * 2, 16384);
            if (estimated_size > MAX_MEMORY_SIZE) return error.ArchiveTooLarge;

            this.output_buffer = try allocator.alloc(u8, estimated_size);
            switch (archive.writeOpenMemory(this.output_buffer.ptr, this.output_buffer.len, &this.bytes_written)) {
                .ok => {},
                else => {
                    allocator.free(this.output_buffer);
                    this.output_buffer = &.{};
                    return error.CannotOpenMemory;
                },
            }
        }

        for (this.files.entries) |file_entry| {
            try writeEntry(archive, file_entry, allocator);
        }

        switch (archive.writeClose()) {
            .ok, .warn => {},
            else => return error.ArchiveCloseError,
        }

        if (this.destination) |destination| {
            const file = std.fs.cwd().openFile(destination, .{}) catch return error.CannotOpenFile;
            defer file.close();
            this.bytes_written = (file.stat() catch return error.CannotStatFile).size;
        } else {
            this.output_buffer = allocator.realloc(this.output_buffer, this.bytes_written) catch this.output_buffer;
        }
    }

    pub fn runFromJS(this: *TarballJob) void {
        defer this.deinit();
        if (this.vm.isShuttingDown()) return;

        const globalThis = this.vm.global;
        const promise = this.promise.swap();

        if (this.error_message) |err_msg| {
            promise.reject(globalThis, globalThis.createErrorInstance("{s}", .{err_msg}));
            return;
        }

        const result_value = if (this.destination != null) blk: {
            break :blk jsc.JSValue.jsNumber(@as(f64, @floatFromInt(this.bytes_written)));
        } else blk: {
            const store = jsc.WebCore.Blob.Store.init(this.output_buffer, bun.default_allocator);
            var blob = jsc.WebCore.Blob.initWithStore(store, globalThis);
            blob.content_type = switch (this.compression) {
                .gzip => "application/gzip",
                .none => "application/x-tar",
            };
            this.output_buffer = &.{};
            break :blk jsc.WebCore.Blob.new(blob).toJS(globalThis);
        };

        promise.resolve(globalThis, result_value);
    }

    pub fn deinit(this: *TarballJob) void {
        this.poll.unref(this.vm);
        this.files.deinit();
        if (this.destination) |dest| bun.default_allocator.free(dest);
        this.promise.deinit();
        if (this.output_buffer.len > 0) bun.default_allocator.free(this.output_buffer);
        bun.destroy(this);
    }

    pub fn create(
        vm: *jsc.VirtualMachine,
        globalThis: *jsc.JSGlobalObject,
        files: FileList,
        destination: ?[]const u8,
        compression: Compression,
    ) *TarballJob {
        var job = TarballJob.new(.{
            .files = files,
            .destination = destination,
            .compression = compression,
            .vm = vm,
            .any_task = jsc.AnyTask.New(@This(), &runFromJS).init(undefined),
        });

        job.promise = jsc.JSPromise.Strong.init(globalThis);
        job.any_task = jsc.AnyTask.New(@This(), &runFromJS).init(job);
        job.poll.ref(vm);
        jsc.WorkPool.schedule(&job.task);

        return job;
    }
};

const std = @import("std");

const bun = @import("bun");
const Async = bun.Async;
const jsc = bun.jsc;
