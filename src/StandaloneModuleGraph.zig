//! Originally, we tried using LIEF to inject the module graph into a MachO segment
//! But this incurred a fixed 350ms overhead on every build, which is unacceptable
//! so we give up on codesigning support on macOS for now until we can find a better solution
const bun = @import("root").bun;
const std = @import("std");
const Schema = bun.Schema.Api;
const strings = bun.strings;
const Output = bun.Output;
const Global = bun.Global;
const Environment = bun.Environment;
const Syscall = bun.sys;

const w = std.os.windows;

pub const StandaloneModuleGraph = struct {
    bytes: []const u8 = "",
    files: bun.StringArrayHashMap(File),
    entry_point_id: u32 = 0,

    // We never want to hit the filesystem for these files
    // We use the `/$bunfs/` prefix to indicate that it's a virtual path
    // It is `/$bunfs/` because:
    //
    // - `$` makes it unlikely to collide with a real path
    // - `/$bunfs/` is 8 characters which is fast to compare for 64-bit CPUs
    pub const base_path = switch (Environment.os) {
        else => "/$bunfs/",
        // Special case for windows because of file URLs being invalid
        // if they do not have a drive letter. B drive because 'bun' but
        // also because it's more unlikely to collide with a real path.
        .windows => "B:\\~BUN\\",
    };

    pub const base_public_path = targetBasePublicPath(Environment.os, "");

    pub fn targetBasePublicPath(target: Environment.OperatingSystem, comptime suffix: [:0]const u8) [:0]const u8 {
        return switch (target) {
            .windows => "B:/~BUN/" ++ suffix,
            else => "/$bunfs/" ++ suffix,
        };
    }

    pub fn isBunStandaloneFilePath(str: []const u8) bool {
        return bun.strings.hasPrefixComptime(str, base_path) or
            (Environment.isWindows and bun.strings.hasPrefixComptime(str, base_public_path));
    }

    pub fn entryPoint(this: *const StandaloneModuleGraph) *File {
        return &this.files.values()[this.entry_point_id];
    }

    // by normalized file path
    pub fn find(this: *const StandaloneModuleGraph, name: []const u8) ?*File {
        if (!isBunStandaloneFilePath(base_path)) {
            return null;
        }
        if (Environment.isWindows) {
            var normalized_buf: bun.PathBuffer = undefined;
            const normalized = bun.path.platformToPosixBuf(u8, name, &normalized_buf);
            return this.files.getPtr(normalized);
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
        cached_blob: ?*bun.JSC.WebCore.Blob = null,

        pub fn blob(this: *File, globalObject: *bun.JSC.JSGlobalObject) *bun.JSC.WebCore.Blob {
            if (this.cached_blob == null) {
                var store = bun.JSC.WebCore.Blob.Store.init(@constCast(this.contents), bun.default_allocator);
                // make it never free
                store.ref();

                const b = bun.JSC.WebCore.Blob.initWithStore(store, globalObject).new();
                b.allocator = bun.default_allocator;

                if (bun.http.MimeType.byExtensionNoDefault(bun.strings.trimLeadingChar(std.fs.path.extension(this.name), '.'))) |mime| {
                    store.mime_type = mime;
                    b.content_type = mime.value;
                    b.content_type_was_set = true;
                    b.content_type_allocated = false;
                }

                store.data.bytes.stored_name = bun.PathString.init(this.name);

                this.cached_blob = b;
            }

            return this.cached_blob.?;
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
        var serialize_trace = bun.tracy.traceNamed(@src(), "StandaloneModuleGraph.serialize");
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

            const dest_path = bun.strings.removeLeadingDotSlash(output_file.dest_path);

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

    pub fn inject(bytes: []const u8, self_exe: [:0]const u8) bun.FileDescriptor {
        var buf: bun.PathBuffer = undefined;
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
            if (comptime Environment.isWindows) {
                // copy self and then open it for writing

                var in_buf: bun.WPathBuffer = undefined;
                strings.copyU8IntoU16(&in_buf, self_exe);
                in_buf[self_exe.len] = 0;
                const in = in_buf[0..self_exe.len :0];
                var out_buf: bun.WPathBuffer = undefined;
                strings.copyU8IntoU16(&out_buf, zname);
                out_buf[zname.len] = 0;
                const out = out_buf[0..zname.len :0];

                bun.copyFile(in, out).unwrap() catch |err| {
                    Output.prettyErrorln("<r><red>error<r><d>:<r> failed to copy bun executable into temporary file: {s}", .{@errorName(err)});
                    Global.exit(1);
                };
                const file = bun.sys.openFileAtWindows(
                    bun.invalid_fd,
                    out,
                    // access_mask
                    w.SYNCHRONIZE | w.GENERIC_WRITE | w.DELETE,
                    // create disposition
                    w.FILE_OPEN,
                    // create options
                    w.FILE_SYNCHRONOUS_IO_NONALERT | w.FILE_OPEN_REPARSE_POINT,
                ).unwrap() catch |e| {
                    Output.prettyErrorln("<r><red>error<r><d>:<r> failed to open temporary file to copy bun into\n{}", .{e});
                    Global.exit(1);
                };

                break :brk file;
            }

            if (comptime Environment.isMac) {
                // if we're on a mac, use clonefile() if we can
                // failure is okay, clonefile is just a fast path.
                if (Syscall.clonefile(self_exe, zname) == .result) {
                    switch (Syscall.open(zname, bun.O.RDWR | bun.O.CLOEXEC, 0)) {
                        .result => |res| break :brk res,
                        .err => {},
                    }
                }
            }

            // otherwise, just copy the file

            const fd = brk2: {
                var tried_changing_abs_dir = false;
                for (0..3) |retry| {
                    switch (Syscall.open(zname, bun.O.CLOEXEC | bun.O.RDWR | bun.O.CREAT, 0)) {
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
                                    }) catch bun.outOfMemory();
                                    zname = zname_z[0..zname_z.len -| 1 :0];
                                    continue;
                                }
                                switch (err.getErrno()) {
                                    // try again
                                    .PERM, .AGAIN, .BUSY => continue,
                                    else => break,
                                }

                                Output.prettyErrorln("<r><red>error<r><d>:<r> failed to open temporary file to copy bun into\n{}", .{err});
                                Global.exit(1);
                            }
                        },
                    }
                }
                unreachable;
            };
            const self_fd = brk2: {
                for (0..3) |retry| {
                    switch (Syscall.open(self_exe, bun.O.CLOEXEC | bun.O.RDONLY, 0)) {
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

            bun.copyFile(self_fd.cast(), fd.cast()).unwrap() catch |err| {
                Output.prettyErrorln("<r><red>error<r><d>:<r> failed to copy bun executable into temporary file: {s}", .{@errorName(err)});
                cleanup(zname, fd);
                Global.exit(1);
            };
            break :brk fd;
        };

        var total_byte_count: usize = undefined;

        if (Environment.isWindows) {
            total_byte_count = bytes.len + 8 + (Syscall.setFileOffsetToEndWindows(cloned_executable_fd).unwrap() catch |err| {
                Output.prettyErrorln("<r><red>error<r><d>:<r> failed to seek to end of temporary file\n{}", .{err});
                cleanup(zname, cloned_executable_fd);
                Global.exit(1);
            });
        } else {
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

            total_byte_count = seek_position + bytes.len + 8;

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

    pub const CompileTarget = @import("./compile_target.zig");

    pub fn download(allocator: std.mem.Allocator, target: *const CompileTarget, env: *bun.DotEnv.Loader) ![:0]const u8 {
        var exe_path_buf: bun.PathBuffer = undefined;
        var version_str_buf: [1024]u8 = undefined;
        const version_str = try std.fmt.bufPrintZ(&version_str_buf, "{}", .{target});
        var needs_download: bool = true;
        const dest_z = target.exePath(&exe_path_buf, version_str, env, &needs_download);
        if (needs_download) {
            try target.downloadToPath(env, allocator, dest_z);
        }

        return try allocator.dupeZ(u8, dest_z);
    }

    pub fn toExecutable(
        target: *const CompileTarget,
        allocator: std.mem.Allocator,
        output_files: []const bun.options.OutputFile,
        root_dir: std.fs.Dir,
        module_prefix: []const u8,
        outfile: []const u8,
        env: *bun.DotEnv.Loader,
    ) !void {
        const bytes = try toBytes(allocator, module_prefix, output_files);
        if (bytes.len == 0) return;

        const fd = inject(
            bytes,
            if (target.isDefault())
                bun.selfExePath() catch |err| {
                    Output.err(err, "failed to get self executable path", .{});
                    Global.exit(1);
                }
            else
                download(allocator, target, env) catch |err| {
                    Output.err(err, "failed to download cross-compiled bun executable", .{});
                    Global.exit(1);
                },
        );
        fd.assertKind(.system);

        if (Environment.isWindows) {
            var outfile_buf: bun.OSPathBuffer = undefined;
            const outfile_slice = brk: {
                const outfile_w = bun.strings.toWPathNormalized(&outfile_buf, std.fs.path.basenameWindows(outfile));
                bun.assert(outfile_w.ptr == &outfile_buf);
                const outfile_buf_u16 = bun.reinterpretSlice(u16, &outfile_buf);
                outfile_buf_u16[outfile_w.len] = 0;
                break :brk outfile_buf_u16[0..outfile_w.len :0];
            };

            bun.C.moveOpenedFileAtLoose(fd, bun.toFD(root_dir.fd), outfile_slice, true).unwrap() catch |err| {
                if (err == error.EISDIR) {
                    Output.errGeneric("{} is a directory. Please choose a different --outfile or delete the directory", .{bun.fmt.utf16(outfile_slice)});
                } else {
                    Output.err(err, "failed to move executable to result path", .{});
                }

                _ = bun.C.deleteOpenedFile(fd);

                Global.exit(1);
            };
            return;
        }

        var buf: bun.PathBuffer = undefined;
        const temp_location = bun.getFdPath(fd, &buf) catch |err| {
            Output.prettyErrorln("<r><red>error<r><d>:<r> failed to get path for fd: {s}", .{@errorName(err)});
            Global.exit(1);
        };

        if (comptime Environment.isMac) {
            if (target.os == .mac) {
                var signer = std.process.Child.init(
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

        bun.C.moveFileZWithHandle(
            fd,
            bun.FD.cwd(),
            bun.sliceTo(&(try std.posix.toPosixPath(temp_location)), 0),
            bun.toFD(root_dir.fd),
            bun.sliceTo(&(try std.posix.toPosixPath(std.fs.path.basename(outfile))), 0),
        ) catch |err| {
            if (err == error.IsDir) {
                Output.prettyErrorln("<r><red>error<r><d>:<r> {} is a directory. Please choose a different --outfile or delete the directory", .{bun.fmt.quote(outfile)});
            } else {
                Output.prettyErrorln("<r><red>error<r><d>:<r> failed to rename {s} to {s}: {s}", .{ temp_location, outfile, @errorName(err) });
            }
            _ = Syscall.unlink(
                &(try std.posix.toPosixPath(temp_location)),
            );

            Global.exit(1);
        };
    }

    pub fn fromExecutable(allocator: std.mem.Allocator) !?StandaloneModuleGraph {
        // Do not invoke libuv here.
        const self_exe = openSelf() catch return null;
        defer _ = Syscall.close(self_exe);

        var trailer_bytes: [4096]u8 = undefined;
        std.posix.lseek_END(self_exe.cast(), -4096) catch return null;

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
            std.posix.lseek_END(self_exe.cast(), -@as(i64, @intCast(offset_from_end + offsets.byte_count))) catch return null;

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
                bun.assert(bun.strings.eqlLong(to_read, end[0..offsets.byte_count], true));
            }
        }

        return try StandaloneModuleGraph.fromBytes(allocator, to_read, offsets);
    }

    /// heuristic: `bun build --compile` won't be supported if the name is "bun", "bunx", or "node".
    /// this is a cheap way to avoid the extra overhead of opening the executable, and also just makes sense.
    fn isBuiltInExe(comptime T: type, argv0: []const T) bool {
        if (argv0.len == 0) return false;

        if (argv0.len == 3) {
            if (bun.strings.eqlComptimeCheckLenWithType(T, argv0, bun.strings.literal(T, "bun"), false)) {
                return true;
            }
        }

        if (argv0.len == 4) {
            if (bun.strings.eqlComptimeCheckLenWithType(T, argv0, bun.strings.literal(T, "bunx"), false)) {
                return true;
            }

            if (bun.strings.eqlComptimeCheckLenWithType(T, argv0, bun.strings.literal(T, "node"), false)) {
                return true;
            }
        }

        if (comptime Environment.isDebug) {
            if (bun.strings.eqlComptimeCheckLenWithType(T, argv0, bun.strings.literal(T, "bun-debug"), true)) {
                return true;
            }
            if (bun.strings.eqlComptimeCheckLenWithType(T, argv0, bun.strings.literal(T, "bun-debugx"), true)) {
                return true;
            }
        }

        return false;
    }

    fn openSelf() std.fs.OpenSelfExeError!bun.FileDescriptor {
        if (!Environment.isWindows) {
            const argv = bun.argv;
            if (argv.len > 0) {
                if (isBuiltInExe(u8, argv[0])) {
                    return error.FileNotFound;
                }
            }
        }

        switch (Environment.os) {
            .linux => {
                if (std.fs.openFileAbsoluteZ("/proc/self/exe", .{})) |easymode| {
                    return bun.toFD(easymode.handle);
                } else |_| {
                    if (bun.argv.len > 0) {
                        // The user doesn't have /proc/ mounted, so now we just guess and hope for the best.
                        var whichbuf: bun.PathBuffer = undefined;
                        if (bun.which(
                            &whichbuf,
                            bun.getenvZ("PATH") orelse return error.FileNotFound,
                            "",
                            bun.argv[0],
                        )) |path| {
                            return bun.toFD((try std.fs.cwd().openFileZ(path, .{})).handle);
                        }
                    }

                    return error.FileNotFound;
                }
            },
            .mac => {
                // Use of MAX_PATH_BYTES here is valid as the resulting path is immediately
                // opened with no modification.
                const self_exe_path = try bun.selfExePath();
                const file = try std.fs.openFileAbsoluteZ(self_exe_path.ptr, .{});
                return bun.toFD(file.handle);
            },
            .windows => {
                const image_path_unicode_string = std.os.windows.peb().ProcessParameters.ImagePathName;
                const image_path = image_path_unicode_string.Buffer.?[0 .. image_path_unicode_string.Length / 2];

                var nt_path_buf: bun.WPathBuffer = undefined;
                const nt_path = bun.strings.addNTPathPrefix(&nt_path_buf, image_path);

                const basename_start = std.mem.lastIndexOfScalar(u16, nt_path, '\\') orelse
                    return error.FileNotFound;
                const basename = nt_path[basename_start + 1 .. nt_path.len - ".exe".len];
                if (isBuiltInExe(u16, basename)) {
                    return error.FileNotFound;
                }

                return bun.sys.openFileAtWindows(
                    bun.FileDescriptor.cwd(),
                    nt_path,
                    // access_mask
                    w.SYNCHRONIZE | w.GENERIC_READ,
                    // create disposition
                    w.FILE_OPEN,
                    // create options
                    w.FILE_SYNCHRONOUS_IO_NONALERT | w.FILE_OPEN_REPARSE_POINT,
                ).unwrap() catch {
                    return error.FileNotFound;
                };
            },
            else => @compileError("TODO"),
        }
    }
};
