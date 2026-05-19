//! Emit compressed (.gz / .br / .zst) copies of bundler output files.
//!
//! Runs after `generateChunksInParallel` has produced the final list of
//! `OutputFile`s. For every compressible file (entry points, chunks, assets,
//! and sourcemaps) and every algorithm enabled in `BundleOptions.compress`,
//! a thread-pool task compresses the buffer with libdeflate / brotli / zstd.
//! When an `outdir` is set, the compressed bytes are also written to disk.

pub const Task = struct {
    /// Points into the original (uncompressed) OutputFile's buffer. Not owned.
    input: []const u8,
    /// Owned by `bun.default_allocator`.
    output_path: []const u8,
    side: ?bun.bake.Side,
    algorithm: Algorithm,
    level: options.CompressionOptions.Level,
    /// Absolute path of the output directory, or empty if not writing to disk.
    root_path: []const u8,

    result: union(enum) {
        pending,
        err: anyerror,
        buffer: []u8,
        saved: u32,
    } = .pending,

    fn compress(input: []const u8, comptime algo: Algorithm, level: options.CompressionOptions.Level) ![]u8 {
        switch (algo) {
            .gzip => {
                bun.libdeflate.load();
                const compressor = bun.libdeflate.Compressor.alloc(level.@"for"(.gzip)) orelse return error.OutOfMemory;
                defer compressor.deinit();
                var out = try bun.default_allocator.alloc(u8, compressor.maxBytesNeeded(input, .gzip));
                errdefer bun.default_allocator.free(out);
                const result = compressor.gzip(input, out);
                if (result.written == 0 and input.len != 0) return error.CompressionFailed;
                if (bun.default_allocator.realloc(out, result.written)) |shrunk| out = shrunk else |_| {}
                return out[0..result.written];
            },
            .brotli => {
                const c = bun.brotli.c;
                var encoded_size: usize = c.BrotliEncoderMaxCompressedSize(input.len);
                if (encoded_size == 0) encoded_size = input.len + 1024;
                var out = try bun.default_allocator.alloc(u8, encoded_size);
                errdefer bun.default_allocator.free(out);
                const ok = c.BrotliEncoderCompress(
                    level.@"for"(.brotli),
                    c.BROTLI_DEFAULT_WINDOW,
                    c.BROTLI_MODE_TEXT,
                    input.len,
                    input.ptr,
                    &encoded_size,
                    out.ptr,
                );
                if (ok == 0) return error.CompressionFailed;
                if (bun.default_allocator.realloc(out, encoded_size)) |shrunk| out = shrunk else |_| {}
                return out[0..encoded_size];
            },
            .zstd => {
                var out = try bun.default_allocator.alloc(u8, bun.zstd.compressBound(input.len));
                errdefer bun.default_allocator.free(out);
                const written = switch (bun.zstd.compress(out, input, level.@"for"(.zstd))) {
                    .success => |n| n,
                    .err => return error.CompressionFailed,
                };
                if (bun.default_allocator.realloc(out, written)) |shrunk| out = shrunk else |_| {}
                return out[0..written];
            },
        }
    }

    fn run(ctx: *const Context, task: *Task, _: usize) void {
        const buffer = switch (task.algorithm) {
            inline else => |algo| compress(task.input, algo, task.level),
        } catch |err| {
            task.result = .{ .err = err };
            return;
        };

        if (task.root_path.len == 0) {
            task.result = .{ .buffer = buffer };
            return;
        }

        defer bun.default_allocator.free(buffer);
        var pathbuf: bun.PathBuffer = undefined;
        switch (jsc.Node.fs.NodeFS.writeFileWithPathBuffer(&pathbuf, .{
            .data = .{ .buffer = .{ .buffer = .{
                .ptr = @constCast(buffer.ptr),
                .len = @as(u32, @truncate(buffer.len)),
                .byte_len = @as(u32, @truncate(buffer.len)),
            } } },
            .encoding = .buffer,
            .dirfd = ctx.root_fd,
            .file = .{ .path = .{ .string = bun.PathString.init(task.output_path) } },
        })) {
            .result => task.result = .{ .saved = @truncate(buffer.len) },
            .err => |err| {
                ctx.c.log.addSysError(bun.default_allocator, err, "writing compressed output {f}", .{
                    bun.fmt.quote(task.output_path),
                }) catch {};
                task.result = .{ .err = error.WriteFailed };
            },
        }
    }
};

const Context = struct {
    c: *LinkerContext,
    root_fd: bun.FileDescriptor,
};

/// Compresses every compressible file in `output_files` using the bundler's
/// worker pool, appending one new `OutputFile` per (file × algorithm) pair.
/// When `root_path` is non-empty, the compressed bytes are written there and
/// the appended `OutputFile`s carry `.saved`; otherwise they carry `.buffer`.
///
/// Called only when `c.resolver.opts.compress.any()` is true. Input
/// `OutputFile`s are expected to have `.buffer` values — the caller forces the
/// in-memory generation path when compression is enabled so the bytes are
/// still available here.
pub fn compressOutputFilesInParallel(
    c: *LinkerContext,
    output_files: *std.array_list.Managed(options.OutputFile),
    root_path: []const u8,
) !void {
    const opts = c.resolver.opts.compress;
    bun.assert(opts.any());

    const trace = bun.perf.trace("Bundler.compressOutputFiles");
    defer trace.end();

    const original_len = output_files.items.len;

    var task_count: usize = 0;
    for (output_files.items[0..original_len]) |*f| {
        if (!f.output_kind.isCompressible()) continue;
        if (f.value != .buffer) continue;
        if (f.value.buffer.bytes.len == 0) continue;
        task_count += opts.count();
    }
    if (task_count == 0) return;

    const tasks = try bun.default_allocator.alloc(Task, task_count);
    defer bun.default_allocator.free(tasks);

    var i: usize = 0;
    for (output_files.items[0..original_len]) |*f| {
        if (!f.output_kind.isCompressible()) continue;
        if (f.value != .buffer) continue;
        const bytes = f.value.buffer.bytes;
        if (bytes.len == 0) continue;
        inline for (comptime std.meta.tags(Algorithm)) |algo| {
            if (@field(opts, @tagName(algo))) {
                tasks[i] = .{
                    .input = bytes,
                    .output_path = bun.handleOom(bun.strings.concat(bun.default_allocator, &.{ f.dest_path, algo.suffix() })),
                    .side = f.side,
                    .algorithm = algo,
                    .level = opts.level,
                    .root_path = root_path,
                };
                i += 1;
            }
        }
    }
    bun.assert(i == task_count);

    var root_dir: ?std.fs.Dir = null;
    defer if (root_dir) |*d| d.close();
    if (root_path.len > 0) {
        // The directory tree was already created when the uncompressed files were
        // written, so a plain open is enough here.
        root_dir = std.fs.cwd().makeOpenPath(root_path, .{}) catch |err| {
            try c.log.addErrorFmt(null, Logger.Loc.Empty, bun.default_allocator, "Failed to open output directory {s} {f}", .{
                @errorName(err),
                bun.fmt.quote(root_path),
            });
            return err;
        };
    }

    const ctx = Context{
        .c = c,
        .root_fd = if (root_dir) |d| .fromStdDir(d) else .cwd(),
    };

    try c.parse_graph.pool.worker_pool.eachPtr(bun.default_allocator, &ctx, Task.run, tasks);

    try output_files.ensureUnusedCapacity(task_count);
    for (tasks) |*task| {
        switch (task.result) {
            .pending => unreachable,
            .err => {
                bun.default_allocator.free(task.output_path);
            },
            .buffer => |buf| output_files.appendAssumeCapacity(options.OutputFile.init(.{
                .data = .{ .buffer = .{ .data = buf, .allocator = bun.default_allocator } },
                .output_path = task.output_path,
                .input_path = bun.handleOom(bun.default_allocator.dupe(u8, task.output_path)),
                .loader = .file,
                .input_loader = .file,
                .hash = null,
                .output_kind = .compressed,
                .side = task.side,
                .entry_point_index = null,
                .is_executable = false,
            })),
            .saved => |size| output_files.appendAssumeCapacity(options.OutputFile.init(.{
                .data = .{ .saved = 0 },
                .size = size,
                .output_path = task.output_path,
                .input_path = bun.handleOom(bun.default_allocator.dupe(u8, task.output_path)),
                .loader = .file,
                .input_loader = .file,
                .hash = null,
                .output_kind = .compressed,
                .side = task.side,
                .entry_point_index = null,
                .is_executable = false,
            })),
        }
    }
}

const std = @import("std");
const bun = @import("bun");
const options = bun.options;
const jsc = bun.jsc;
const Logger = bun.logger;
const LinkerContext = bun.bundle_v2.LinkerContext;
const Algorithm = options.CompressionOptions.Algorithm;
