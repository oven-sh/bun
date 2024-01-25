// Originally, we tried using LIEF to inject the module graph into a MachO segment
// But this incurred a fixed 350ms overhead on every build, which is unacceptable
// so we give up on codesigning support on macOS for now until we can find a better solution
const bun = @import("root").bun;
const std = @import("std");
const Schema = bun.Schema.Api;
const strings = bun.strings;

const Environment = bun.Environment;

const Syscall = bun.sys;

pub const StandaloneModuleGraph = struct {
    bytes: []const u8 = "",
    files: bun.StringArrayHashMap(File),
    entry_point_id: u32 = 0,

    pub fn entryPoint(this: *const StandaloneModuleGraph) *File {
        return &this.files.values()[this.entry_point_id];
    }

    pub fn find(this: *const StandaloneModuleGraph, name: []const u8) ?*File {
        if (!bun.strings.isBunStandaloneFilePath(name)) {
            return null;
        }

        return this.files.getPtr(name);
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
        blob_: ?*bun.JSC.WebCore.Blob = null,

        pub fn blob(this: *File, globalObject: *bun.JSC.JSGlobalObject) *bun.JSC.WebCore.Blob {
            if (this.blob_ == null) {
                var store = bun.JSC.WebCore.Blob.Store.init(@constCast(this.contents), bun.default_allocator) catch @panic("out of memory");
                // make it never free
                store.ref();

                var blob_ = bun.default_allocator.create(bun.JSC.WebCore.Blob) catch @panic("out of memory");
                blob_.* = bun.JSC.WebCore.Blob.initWithStore(store, globalObject);
                blob_.allocator = bun.default_allocator;

                if (bun.http.MimeType.byExtensionNoDefault(bun.strings.trimLeadingChar(std.fs.path.extension(this.name), '.'))) |mime| {
                    store.mime_type = mime;
                    blob_.content_type = mime.value;
                    blob_.content_type_was_set = true;
                    blob_.content_type_allocated = false;
                }

                store.data.bytes.stored_name = bun.PathString.init(this.name);

                this.blob_ = blob_;
            }

            return this.blob_.?;
        }
    };

    pub const LazySourceMap = union(enum) {
        compressed: []const u8,
        decompressed: bun.sourcemap,

        pub fn load(this: *LazySourceMap, log: *bun.logger.Log, allocator: std.mem.Allocator) !*bun.sourcemap {
            if (this.* == .decompressed) return &this.decompressed;

            var decompressed = try allocator.alloc(u8, bun.zstd.getDecompressedSize(this.compressed));
            const result = bun.zstd.decompress(decompressed, this.compressed);
            if (result == .err) {
                allocator.free(decompressed);
                log.addError(null, bun.logger.Loc.Empty, bun.span(result.err)) catch unreachable;
                return error.@"Failed to decompress sourcemap";
            }
            errdefer allocator.free(decompressed);
            const bytes = decompressed[0..result.success];

            this.* = .{ .decompressed = try bun.sourcemap.parse(allocator, &bun.logger.Source.initPathString("sourcemap.json", bytes), log) };
            return &this.decompressed;
        }
    };

    pub const Offsets = extern struct {
        byte_count: usize = 0,
        modules_ptr: bun.StringPointer = .{},
        entry_point_id: u32 = 0,
    };

    const trailer = "\n---- Bun! ----\n";

    pub fn fromBytes(allocator: std.mem.Allocator, raw_bytes: []const u8, offsets: Offsets) !StandaloneModuleGraph {
        if (raw_bytes.len == 0) return StandaloneModuleGraph{
            .files = bun.StringArrayHashMap(File).init(allocator),
        };

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

    pub fn toBytes(allocator: std.mem.Allocator, prefix: []const u8, output_files: []const bun.options.OutputFile) ![]u8 {
        var serialize_trace = bun.tracy.traceNamed(@src(), "ModuleGraph.serialize");
        defer serialize_trace.end();
        var entry_point_id: ?usize = null;
        var string_builder = bun.StringBuilder{};
        var module_count: usize = 0;
        for (output_files, 0..) |output_file, i| {
            string_builder.count(output_file.dest_path);
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
        string_builder.cap += trailer.len;
        string_builder.cap += 16;

        {
            var offsets_ = Offsets{};
            string_builder.cap += std.mem.asBytes(&offsets_).len;
        }

        try string_builder.allocate(allocator);

        var modules = try std.ArrayList(CompiledModuleGraphFile).initCapacity(allocator, module_count);

        for (output_files) |output_file| {
            if (output_file.output_kind == .sourcemap) {
                continue;
            }

            if (output_file.value != .buffer) {
                continue;
            }

            var dest_path = output_file.dest_path;
            if (bun.strings.hasPrefixComptime(dest_path, "./")) {
                dest_path = dest_path[2..];
            }

            var module = CompiledModuleGraphFile{
                .name = string_builder.fmtAppendCount("{s}{s}", .{
                    prefix,
                    dest_path,
                }),
                .loader = output_file.loader,
                .contents = string_builder.appendCount(output_file.value.buffer.bytes),
            };
            if (output_file.source_map_index != std.math.maxInt(u32)) {
                const remaining_slice = string_builder.allocatedSlice()[string_builder.len..];
                const compressed_result = bun.zstd.compress(remaining_slice, output_files[output_file.source_map_index].value.buffer.bytes, 1);
                if (compressed_result == .err) {
                    bun.Output.panic("Unexpected error compressing sourcemap: {s}", .{bun.span(compressed_result.err)});
                }
                module.sourcemap = string_builder.add(compressed_result.success);
            }
            modules.appendAssumeCapacity(module);
        }

        var offsets = Offsets{
            .entry_point_id = @as(u32, @truncate(entry_point_id.?)),
            .modules_ptr = string_builder.appendCount(std.mem.sliceAsBytes(modules.items)),
            .byte_count = string_builder.len,
        };

        _ = string_builder.append(std.mem.asBytes(&offsets));
        _ = string_builder.append(trailer);

        return string_builder.ptr.?[0..string_builder.len];
    }

    const page_size = if (Environment.isLinux and Environment.isAarch64)
        // some linux distros do 64 KB pages on aarch64
        64 * 1024
    else
        std.mem.page_size;

    pub fn inject(bytes: []const u8) bun.FileDescriptor {
        var buf: [bun.MAX_PATH_BYTES]u8 = undefined;
        var zname: [:0]const u8 = bun.span(bun.fs.FileSystem.instance.tmpname("bun-build", &buf, @as(u64, @bitCast(std.time.milliTimestamp()))) catch |err| {
            Output.prettyErrorln("<r><red>error<r><d>:<r> failed to get temporary file name: {s}", .{@errorName(err)});
            Global.exit(1);
        });

        const cleanup = struct {
            pub fn toClean(name: [:0]const u8, fd: bun.FileDescriptor) void {
                _ = Syscall.close(fd);
                _ = Syscall.unlink(name);
            }
        }.toClean;

        const cloned_executable_fd: bun.FileDescriptor = brk: {
            var self_buf: [bun.MAX_PATH_BYTES + 1]u8 = undefined;
            const self_exe = std.fs.selfExePath(&self_buf) catch |err| {
                Output.prettyErrorln("<r><red>error<r><d>:<r> failed to get self executable path: {s}", .{@errorName(err)});
                Global.exit(1);
            };
            self_buf[self_exe.len] = 0;
            const self_exeZ = self_buf[0..self_exe.len :0];

            if (comptime Environment.isMac) {
                // if we're on a mac, use clonefile() if we can
                // failure is okay, clonefile is just a fast path.
                if (Syscall.clonefile(self_exeZ, zname) == .result) {
                    switch (Syscall.open(zname, std.os.O.RDWR | std.os.O.CLOEXEC, 0)) {
                        .result => |res| break :brk res,
                        .err => {},
                    }
                }
            }

            // otherwise, just copy the file

            const fd = brk2: {
                var tried_changing_abs_dir = false;
                for (0..3) |retry| {
                    switch (Syscall.open(zname, std.os.O.CLOEXEC | std.os.O.RDWR | std.os.O.CREAT, 0)) {
                        .result => |res| break :brk2 res,
                        .err => |err| {
                            if (retry < 2) {
                                // they may not have write access to the present working directory
                                //
                                // but we want to default to it since it's the
                                // least likely to need to be copied due to
                                // renameat() across filesystems
                                //
                                // so in the event of a failure, we try to
                                // we retry using the tmp dir
                                //
                                // but we only do that once because otherwise it's just silly
                                if (!tried_changing_abs_dir) {
                                    tried_changing_abs_dir = true;
                                    const zname_z = bun.strings.concat(bun.default_allocator, &.{
                                        bun.fs.FileSystem.instance.fs.tmpdirPath(),
                                        std.fs.path.sep_str,
                                        zname,
                                        &.{0},
                                    }) catch @panic("OOM");
                                    zname = zname_z[0..zname_z.len -| 1 :0];
                                    continue;
                                }
                                switch (err.getErrno()) {
                                    // try again
                                    .PERM, .AGAIN, .BUSY => continue,
                                    else => {},
                                }
                            }

                            Output.prettyErrorln("<r><red>error<r><d>:<r> failed to open temporary file to copy bun into\n{}", .{err});
                            Global.exit(1);
                        },
                    }
                }
                unreachable;
            };
            const self_fd = brk2: {
                for (0..3) |retry| {
                    switch (Syscall.open(self_exeZ, std.os.O.CLOEXEC | std.os.O.RDONLY, 0)) {
                        .result => |res| break :brk2 res,
                        .err => |err| {
                            if (retry < 2) {
                                switch (err.getErrno()) {
                                    // try again
                                    .PERM, .AGAIN, .BUSY => continue,
                                    else => {},
                                }
                            }

                            Output.prettyErrorln("<r><red>error<r><d>:<r> failed to open bun executable to copy from as read-only\n{}", .{err});
                            cleanup(zname, fd);
                            Global.exit(1);
                        },
                    }
                }
                unreachable;
            };

            defer _ = Syscall.close(self_fd);

            if (comptime Environment.isWindows) {
                var in_buf: bun.WPathBuffer = undefined;
                strings.copyU8IntoU16(&in_buf, self_exeZ);
                const in = in_buf[0..self_exe.len :0];
                var out_buf: bun.WPathBuffer = undefined;
                strings.copyU8IntoU16(&out_buf, zname);
                const out = out_buf[0..zname.len :0];

                bun.copyFile(in, out) catch |err| {
                    Output.prettyErrorln("<r><red>error<r><d>:<r> failed to copy bun executable into temporary file: {s}", .{@errorName(err)});
                    cleanup(zname, fd);
                    Global.exit(1);
                };
            } else {
                bun.copyFile(self_fd.cast(), fd.cast()) catch |err| {
                    Output.prettyErrorln("<r><red>error<r><d>:<r> failed to copy bun executable into temporary file: {s}", .{@errorName(err)});
                    cleanup(zname, fd);
                    Global.exit(1);
                };
            }
            break :brk fd;
        };

        const seek_position = @as(u64, @intCast(brk: {
            const fstat = switch (Syscall.fstat(cloned_executable_fd)) {
                .result => |res| res,
                .err => |err| {
                    Output.prettyErrorln("{}", .{err});
                    cleanup(zname, cloned_executable_fd);
                    Global.exit(1);
                },
            };

            break :brk @max(fstat.size, 0);
        }));

        const total_byte_count = seek_position + bytes.len + 8;

        // From https://man7.org/linux/man-pages/man2/lseek.2.html
        //
        //  lseek() allows the file offset to be set beyond the end of the
        //  file (but this does not change the size of the file).  If data is
        //  later written at this point, subsequent reads of the data in the
        //  gap (a "hole") return null bytes ('\0') until data is actually

        //  written into the gap.
        //
        switch (Syscall.setFileOffset(cloned_executable_fd, seek_position)) {
            .err => |err| {
                Output.prettyErrorln(
                    "{}\nwhile seeking to end of temporary file (pos: {d})",
                    .{
                        err,
                        seek_position,
                    },
                );
                cleanup(zname, cloned_executable_fd);
                Global.exit(1);
            },
            else => {},
        }

        var remain = bytes;
        while (remain.len > 0) {
            switch (Syscall.write(cloned_executable_fd, bytes)) {
                .result => |written| remain = remain[written..],
                .err => |err| {
                    Output.prettyErrorln("<r><red>error<r><d>:<r> failed to write to temporary file\n{}", .{err});
                    cleanup(zname, cloned_executable_fd);

                    Global.exit(1);
                },
            }
        }

        // the final 8 bytes in the file are the length of the module graph with padding, excluding the trailer and offsets
        _ = Syscall.write(cloned_executable_fd, std.mem.asBytes(&total_byte_count));
        if (comptime !Environment.isWindows) {
            _ = bun.C.fchmod(cloned_executable_fd.int(), 0o777);
        }

        return cloned_executable_fd;
    }

    pub fn toExecutable(allocator: std.mem.Allocator, output_files: []const bun.options.OutputFile, root_dir: std.fs.Dir, module_prefix: []const u8, outfile: []const u8) !void {
        const bytes = try toBytes(allocator, module_prefix, output_files);
        if (bytes.len == 0) return;

        const fd = inject(bytes);
        var buf: [bun.MAX_PATH_BYTES]u8 = undefined;
        const temp_location = bun.getFdPath(fd, &buf) catch |err| {
            Output.prettyErrorln("<r><red>error<r><d>:<r> failed to get path for fd: {s}", .{@errorName(err)});
            Global.exit(1);
        };

        if (comptime Environment.isMac) {
            {
                var signer = std.ChildProcess.init(
                    &.{
                        "codesign",
                        "--remove-signature",
                        temp_location,
                    },
                    bun.default_allocator,
                );
                if (bun.logger.Log.default_log_level.atLeast(.verbose)) {
                    signer.stdout_behavior = .Inherit;
                    signer.stderr_behavior = .Inherit;
                    signer.stdin_behavior = .Inherit;
                } else {
                    signer.stdout_behavior = .Ignore;
                    signer.stderr_behavior = .Ignore;
                    signer.stdin_behavior = .Ignore;
                }
                _ = signer.spawnAndWait() catch {};
            }
        }

        if (comptime Environment.isWindows) {
            Output.prettyError("TODO: windows support. sorry!!\n", .{});
            Global.exit(1);
        }

        bun.C.moveFileZWithHandle(
            fd,
            bun.toFD(std.fs.cwd().fd),
            bun.sliceTo(&(try std.os.toPosixPath(temp_location)), 0),
            bun.toFD(root_dir.fd),
            bun.sliceTo(&(try std.os.toPosixPath(std.fs.path.basename(outfile))), 0),
        ) catch |err| {
            if (err == error.IsDir) {
                Output.prettyErrorln("<r><red>error<r><d>:<r> {} is a directory. Please choose a different --outfile or delete the directory", .{bun.fmt.quote(outfile)});
            } else {
                Output.prettyErrorln("<r><red>error<r><d>:<r> failed to rename {s} to {s}: {s}", .{ temp_location, outfile, @errorName(err) });
            }
            _ = Syscall.unlink(
                &(try std.os.toPosixPath(temp_location)),
            );

            Global.exit(1);
        };
    }

    pub fn fromExecutable(allocator: std.mem.Allocator) !?StandaloneModuleGraph {
        const self_exe = (openSelfExe(.{}) catch null) orelse return null;
        defer _ = Syscall.close(self_exe);

        var trailer_bytes: [4096]u8 = undefined;
        std.os.lseek_END(self_exe.cast(), -4096) catch return null;

        var read_amount: usize = 0;
        while (read_amount < trailer_bytes.len) {
            switch (Syscall.read(self_exe, trailer_bytes[read_amount..])) {
                .result => |read| {
                    if (read == 0) return null;

                    read_amount += read;
                },
                .err => {
                    return null;
                },
            }
        }

        if (read_amount < trailer.len + @sizeOf(usize) + 32)
            // definitely missing data
            return null;

        var end = @as([]u8, &trailer_bytes).ptr + read_amount - @sizeOf(usize);
        const total_byte_count: usize = @as(usize, @bitCast(end[0..8].*));

        if (total_byte_count > std.math.maxInt(u32) or total_byte_count < 4096) {
            // sanity check: the total byte count should never be more than 4 GB
            // bun is at least like 30 MB so if it reports a size less than 4096 bytes then something is wrong
            return null;
        }
        end -= trailer.len;

        if (!bun.strings.hasPrefixComptime(end[0..trailer.len], trailer)) {
            // invalid trailer
            return null;
        }

        end -= @sizeOf(Offsets);

        const offsets: Offsets = std.mem.bytesAsValue(Offsets, end[0..@sizeOf(Offsets)]).*;
        if (offsets.byte_count >= total_byte_count) {
            // if we hit this branch then the file is corrupted and we should just give up
            return null;
        }

        var to_read = try bun.default_allocator.alloc(u8, offsets.byte_count);
        var to_read_from = to_read;

        // Reading the data and making sure it's page-aligned + won't crash due
        // to out of bounds using mmap() is very complicated.
        // we just read the whole thing into memory for now.
        // at the very least
        // if you have not a ton of code, we only do a single read() call
        if (Environment.allow_assert or offsets.byte_count > 1024 * 3) {
            const offset_from_end = trailer_bytes.len - (@intFromPtr(end) - @intFromPtr(@as([]u8, &trailer_bytes).ptr));
            std.os.lseek_END(self_exe.cast(), -@as(i64, @intCast(offset_from_end + offsets.byte_count))) catch return null;

            if (comptime Environment.allow_assert) {
                // actually we just want to verify this logic is correct in development
                if (offsets.byte_count <= 1024 * 3) {
                    to_read_from = try bun.default_allocator.alloc(u8, offsets.byte_count);
                }
            }

            var remain = to_read_from;
            while (remain.len > 0) {
                switch (Syscall.read(self_exe, remain)) {
                    .result => |read| {
                        if (read == 0) return null;

                        remain = remain[read..];
                    },
                    .err => {
                        bun.default_allocator.free(to_read);
                        return null;
                    },
                }
            }
        }

        if (offsets.byte_count <= 1024 * 3) {
            // we already have the bytes
            end -= offsets.byte_count;
            @memcpy(to_read[0..offsets.byte_count], end[0..offsets.byte_count]);
            if (comptime Environment.allow_assert) {
                std.debug.assert(bun.strings.eqlLong(to_read, end[0..offsets.byte_count], true));
            }
        }

        return try StandaloneModuleGraph.fromBytes(allocator, to_read, offsets);
    }

    // this is based on the Zig standard library function, except it accounts for
    fn openSelfExe(flags: std.fs.File.OpenFlags) std.fs.OpenSelfExeError!?bun.FileDescriptor {
        // heuristic: `bun build --compile` won't be supported if the name is "bun" or "bunx".
        // this is a cheap way to avoid the extra overhead of opening the executable
        // and also just makes sense.
        const argv = bun.argv();
        if (argv.len > 0) {
            // const argv0_len = bun.len(argv[0]);
            const argv0 = argv[0];
            if (argv0.len > 0) {
                if (argv0.len == 3) {
                    if (bun.strings.eqlComptimeIgnoreLen(argv0, "bun")) {
                        return null;
                    }
                }

                if (comptime Environment.isDebug) {
                    if (bun.strings.eqlComptime(argv0, "bun-debug")) {
                        return null;
                    }
                }

                if (argv0.len == 4) {
                    if (bun.strings.eqlComptimeIgnoreLen(argv0, "bunx")) {
                        return null;
                    }
                }

                if (comptime Environment.isDebug) {
                    if (bun.strings.eqlComptime(argv0, "bun-debugx")) {
                        return null;
                    }
                }
            }
        }

        if (comptime Environment.isLinux) {
            if (std.fs.openFileAbsoluteZ("/proc/self/exe", flags)) |easymode| {
                return bun.toFD(easymode.handle);
            } else |_| {
                if (bun.argv().len > 0) {
                    // The user doesn't have /proc/ mounted, so now we just guess and hope for the best.
                    var whichbuf: [bun.MAX_PATH_BYTES]u8 = undefined;
                    if (bun.which(
                        &whichbuf,
                        bun.getenvZ("PATH") orelse return error.FileNotFound,
                        "",
                        bun.argv()[0],
                    )) |path| {
                        return bun.toFD((try std.fs.cwd().openFileZ(path, flags)).handle);
                    }
                }

                return error.FileNotFound;
            }
        }

        if (comptime Environment.isWindows) {
            return bun.toFD((try std.fs.openSelfExe(flags)).handle);
        }
        // Use of MAX_PATH_BYTES here is valid as the resulting path is immediately
        // opened with no modification.
        var buf: [bun.MAX_PATH_BYTES]u8 = undefined;
        const self_exe_path = try std.fs.selfExePath(&buf);
        buf[self_exe_path.len] = 0;
        const file = try std.fs.openFileAbsoluteZ(buf[0..self_exe_path.len :0].ptr, flags);
        return @enumFromInt(file.handle);
    }
};

const Output = bun.Output;
const Global = bun.Global;
