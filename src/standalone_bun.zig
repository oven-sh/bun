const bun = @import("root").bun;
const std = @import("std");
const Schema = bun.Schema.Api;

const Environment = bun.Environment;

pub const StandaloneModuleGraph = struct {
    bytes: []const u8 = "",
    files: bun.StringArrayHashMap(File),
    entry_point_id: u32 = 0,

    pub fn entryPoint(this: *const StandaloneModuleGraph) *File {
        return &this.files.values()[this.entry_point_id];
    }

    pub const CompiledModuleGraphFile = struct {
        name: Schema.StringPointer = .{},
        loader: bun.options.Loader = .file,
        contents: Schema.StringPointer = .{},
        sourcemap: Schema.StringPointer = .{},
    };

    pub const File = struct {
        name: []const u8 = "",
        loader: bun.options.Loader,
        contents: []const u8 = "",
        sourcemap: LazySourceMap,
    };

    pub const LazySourceMap = union(enum) {
        compressed: []const u8,
        decompressed: bun.sourcemap,

        pub fn load(this: *LazySourceMap, log: *bun.logger.Log, allocator: std.mem.Allocator) !*bun.sourcemap {
            if (this.* == .decompressed) return &this.decompressed;

            var decompressed = try allocator.alloc(u8, bun.zstd.getDecompressedSize(this.compressed));
            var result = bun.zstd.decompress(decompressed, this.compressed);
            if (result == .err) {
                allocator.free(decompressed);
                log.addError(null, bun.logger.Loc.Empty, bun.span(result.err)) catch unreachable;
                return error.@"Failed to decompress sourcemap";
            }
            errdefer allocator.free(decompressed);
            var bytes = decompressed[0..result.success];

            this.* = .{ .decompressed = try bun.sourcemap.parse(allocator, &bun.logger.Source.initPathString("sourcemap.json", bytes), log) };
            return &this.decompressed;
        }
    };

    pub const Offsets = extern struct {
        byte_count: usize = 0,
        modules_ptr: bun.StringPointer = .{},
        entry_point_id: u32 = 0,
    };

    const header = "\n--- Bun's module graph ---\n";

    pub fn fromBytes(allocator: std.mem.Allocator, raw_bytes: []const u8) !StandaloneModuleGraph {
        if (raw_bytes.len == 0) return StandaloneModuleGraph{
            .files = bun.StringArrayHashMap(File).init(allocator),
        };

        if (raw_bytes.len < header.len) {
            return error.@"Corrupted module graph: missing header";
        }

        if (!bun.strings.eqlComptime(raw_bytes[0..header.len], header)) {
            return error.@"Corrupted module graph: invalid header";
        }

        // We aren't aligning it, so we must copy
        const offsets: Offsets = std.mem.bytesAsValue(Offsets, raw_bytes[header.len..][0..@sizeOf(Offsets)]).*;

        if (offsets.byte_count > raw_bytes.len) {
            return error.@"Corrupted module graph: invalid byte count (exceeds segment size)";
        }

        const modules_list_bytes = sliceTo(raw_bytes, offsets.modules_ptr);
        const modules_list = std.mem.bytesAsSlice(CompiledModuleGraphFile, modules_list_bytes);

        if (offsets.entry_point_id > modules_list.len) {
            return error.@"Corrupted module graph: entry point ID is greater than module list count";
        }

        var modules = bun.StringArrayHashMap(File).init(allocator);
        try modules.ensureTotalCapacity(modules_list.len);
        for (modules_list) |module| {
            modules.putAssumeCapacity(
                sliceTo(raw_bytes, module.name),
                File{
                    .name = sliceTo(raw_bytes, module.name),
                    .loader = module.loader,
                    .contents = sliceTo(raw_bytes, module.contents),
                    .sourcemap = LazySourceMap{
                        .compressed = sliceTo(raw_bytes, module.sourcemap),
                    },
                },
            );
        }

        return StandaloneModuleGraph{
            .bytes = raw_bytes[0..offsets.byte_count],
            .files = modules,
            .entry_point_id = offsets.entry_point_id,
        };
    }

    fn sliceTo(bytes: []const u8, ptr: bun.StringPointer) []const u8 {
        if (ptr.length == 0) return "";

        return bytes[ptr.offset..][0..ptr.length];
    }

    extern "C" fn inject_into_macho(ptr: [*]u8, len: usize, section_name: [*:0]const u8) i32;
    extern "C" fn postject_find_resource(name: [*:0]const u8, size: *usize) ?[*:0]const u8;
    fn inject(data: []u8) i32 {
        if (comptime Environment.isMac) {
            return inject_into_macho(data.ptr, data.len, "__BUN");
        } else {
            @panic("inject not implemented for this platform");
        }
    }

    pub fn toBytes(allocator: std.mem.Allocator, prefix: []const u8, output_files: []const bun.options.OutputFile) ![]u8 {
        var serialize_trace = bun.tracy.traceNamed(@src(), "ModuleGraph.serialize");
        defer serialize_trace.end();
        var entry_point_id: ?usize = null;
        var string_builder = bun.StringBuilder{};
        var module_count: usize = 0;
        for (output_files, 0..) |output_file, i| {
            string_builder.count(output_file.path);
            string_builder.count(prefix);
            if (output_file.value == .buffer) {
                if (output_file.output_kind == .sourcemap) {
                    string_builder.cap += bun.zstd.compressBound(output_file.value.buffer.bytes.len);
                } else {
                    if (entry_point_id == null) {
                        if (output_file.output_kind == .@"entry-point") {
                            entry_point_id = i;
                        }
                    }

                    string_builder.count(output_file.value.buffer.bytes);
                    module_count += 1;
                }
            }
        }

        if (module_count == 0 or entry_point_id == null) return &[_]u8{};

        string_builder.cap += @sizeOf(CompiledModuleGraphFile) * output_files.len;
        string_builder.cap += header.len;
        string_builder.cap += 16;

        {
            var offsets_ = Offsets{};
            string_builder.cap += std.mem.asBytes(&offsets_).len;
        }

        try string_builder.allocate(allocator);

        _ = string_builder.append(header);
        var offset_bytes = string_builder.allocatedSlice()[string_builder.len..][0..@sizeOf(Offsets)];
        @memset(offset_bytes, 0, @sizeOf(Offsets));
        var offsets = std.mem.bytesAsValue(Offsets, offset_bytes);
        string_builder.len += offset_bytes.len;

        offsets.entry_point_id = @truncate(u32, entry_point_id.?);

        var modules = try std.ArrayList(CompiledModuleGraphFile).initCapacity(allocator, module_count);

        for (output_files) |output_file| {
            if (output_file.output_kind == .sourcemap) {
                continue;
            }

            if (output_file.value != .buffer) {
                continue;
            }

            var module = CompiledModuleGraphFile{
                .name = string_builder.fmtAppendCount("{s}{s}", .{ prefix, output_file.path }),
                .loader = output_file.loader,
                .contents = string_builder.appendCount(output_file.value.buffer.bytes),
            };
            if (output_file.source_map_index != std.math.maxInt(u32)) {
                var remaining_slice = string_builder.allocatedSlice()[string_builder.len..];
                const compressed_result = bun.zstd.compress(remaining_slice, output_files[output_file.source_map_index].value.buffer.bytes, 1);
                if (compressed_result == .err) {
                    bun.Output.panic("Unexpected error compressing sourcemap: {s}", .{bun.span(compressed_result.err)});
                }
                module.sourcemap = string_builder.add(compressed_result.success);
            }
            modules.appendAssumeCapacity(module);
        }

        offsets.modules_ptr = string_builder.appendCount(std.mem.sliceAsBytes(modules.items));
        offsets.byte_count = string_builder.len;

        return string_builder.ptr.?[0..offsets.byte_count];
    }

    pub fn toExecutable(allocator: std.mem.Allocator, output_files: []const bun.options.OutputFile, root_dir: std.fs.IterableDir, module_prefix: []const u8, outfile: []const u8) !void {
        const bytes = try toBytes(allocator, module_prefix, output_files);
        if (bytes.len == 0) return;

        const fd = inject(@constCast(bytes));
        if (fd == -1) {
            Output.prettyErrorln("<r><red>error<r><d>:<r> failed to inject into macho", .{});
            Global.exit(1);
            return;
        }

        var buf: [bun.MAX_PATH_BYTES]u8 = undefined;
        const temp_location = bun.getFdPath(fd, &buf) catch |err| {
            Output.prettyErrorln("<r><red>error<r><d>:<r> failed to get path for fd: {s}", .{@errorName(err)});
            Global.exit(1);
            return;
        };

        if (comptime Environment.isMac) {
            {
                var signer = std.ChildProcess.init(
                    &.{
                        "bash",
                        "-c",
                        std.fmt.allocPrint(bun.default_allocator, "codesign --sign - {s}", .{temp_location}) catch unreachable,
                    },
                    bun.default_allocator,
                );
                signer.stdout_behavior = .Inherit;
                signer.stderr_behavior = .Inherit;
                signer.stdin_behavior = .Inherit;
                _ = signer.spawnAndWait() catch |err| {
                    Output.prettyErrorln("<r><red>error<r><d>:<r> failed to codesign executablez: {s}", .{@errorName(err)});
                    Global.exit(1);
                    return;
                };
            }
        }

        std.os.unlinkat(root_dir.dir.fd, outfile, 0) catch {};
        std.os.renameat(std.fs.cwd().fd, temp_location, root_dir.dir.fd, outfile) catch |err| {
            Output.prettyErrorln("<r><red>error<r><d>:<r> failed to rename {s} to {s}: {s}", .{ temp_location, outfile, @errorName(err) });
            Global.exit(1);
            return;
        };
    }

    pub fn fromExecutable(allocator: std.mem.Allocator) !?StandaloneModuleGraph {
        var size: usize = 0;
        var raw_bytes_ptr = postject_find_resource("__BUN", &size) orelse return null;
        const raw_bytes = raw_bytes_ptr[0..size];
        return try StandaloneModuleGraph.fromBytes(allocator, raw_bytes);
    }
};

const Output = bun.Output;
const Global = bun.Global;
