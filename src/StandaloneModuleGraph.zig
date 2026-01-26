//! Originally, we tried using LIEF to inject the module graph into a MachO segment
//! But this incurred a fixed 350ms overhead on every build, which is unacceptable
//! so we give up on codesigning support on macOS for now until we can find a better solution

pub const StandaloneModuleGraph = struct {
    bytes: []const u8 = "",
    files: bun.StringArrayHashMap(File),
    entry_point_id: u32 = 0,
    compile_exec_argv: []const u8 = "",
    flags: Flags = .{},

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

    pub const base_public_path_with_default_suffix = targetBasePublicPath(Environment.os, "root/");
    const Instance = struct {
        pub var instance: ?*StandaloneModuleGraph = null;
    };

    pub fn get() ?*StandaloneModuleGraph {
        return Instance.instance;
    }

    pub fn set(instance: *StandaloneModuleGraph) void {
        Instance.instance = instance;
    }

    pub fn targetBasePublicPath(target: Environment.OperatingSystem, comptime suffix: [:0]const u8) [:0]const u8 {
        return switch (target) {
            .windows => "B:/~BUN/" ++ suffix,
            else => "/$bunfs/" ++ suffix,
        };
    }

    pub fn isBunStandaloneFilePathCanonicalized(str: []const u8) bool {
        return bun.strings.hasPrefixComptime(str, base_path) or
            (Environment.isWindows and bun.strings.hasPrefixComptime(str, base_public_path));
    }

    pub fn isBunStandaloneFilePath(str: []const u8) bool {
        if (Environment.isWindows) {
            // On Windows, remove NT path prefixes before checking
            const canonicalized = strings.withoutNTPrefix(u8, str);
            return isBunStandaloneFilePathCanonicalized(canonicalized);
        }
        return isBunStandaloneFilePathCanonicalized(str);
    }

    pub fn entryPoint(this: *const StandaloneModuleGraph) *File {
        return &this.files.values()[this.entry_point_id];
    }

    // by normalized file path
    pub fn find(this: *const StandaloneModuleGraph, name: []const u8) ?*File {
        if (!isBunStandaloneFilePath(name)) {
            return null;
        }

        return this.findAssumeStandalonePath(name);
    }

    pub fn stat(this: *const StandaloneModuleGraph, name: []const u8) ?bun.Stat {
        const file = this.find(name) orelse return null;
        return file.stat();
    }

    pub fn findAssumeStandalonePath(this: *const StandaloneModuleGraph, name: []const u8) ?*File {
        if (Environment.isWindows) {
            var normalized_buf: bun.PathBuffer = undefined;
            const input = strings.withoutNTPrefix(u8, name);
            const normalized = bun.path.platformToPosixBuf(u8, input, &normalized_buf);
            return this.files.getPtr(normalized);
        }
        return this.files.getPtr(name);
    }

    pub const CompiledModuleGraphFile = struct {
        name: Schema.StringPointer = .{},
        contents: Schema.StringPointer = .{},
        sourcemap: Schema.StringPointer = .{},
        bytecode: Schema.StringPointer = .{},
        encoding: Encoding = .latin1,
        loader: bun.options.Loader = .file,
        module_format: ModuleFormat = .none,
        side: FileSide = .server,
    };

    pub const FileSide = enum(u8) {
        server = 0,
        client = 1,
    };

    pub const Encoding = enum(u8) {
        binary = 0,

        latin1 = 1,

        // Not used yet.
        utf8 = 2,
    };

    pub const ModuleFormat = enum(u8) {
        none = 0,
        esm = 1,
        cjs = 2,
    };

    const Macho = struct {
        pub extern "C" fn Bun__getStandaloneModuleGraphMachoLength() ?*align(1) u64;

        pub fn getData() ?[]const u8 {
            if (Bun__getStandaloneModuleGraphMachoLength()) |length| {
                if (length.* < 8) {
                    return null;
                }

                // BlobHeader has 8 bytes size (u64), so data starts at offset 8.
                const data_offset = @sizeOf(u64);
                const slice_ptr: [*]const u8 = @ptrCast(length);
                return slice_ptr[data_offset..][0..length.*];
            }

            return null;
        }
    };

    const PE = struct {
        pub extern "C" fn Bun__getStandaloneModuleGraphPELength() u64;
        pub extern "C" fn Bun__getStandaloneModuleGraphPEData() ?[*]u8;

        pub fn getData() ?[]const u8 {
            const length = Bun__getStandaloneModuleGraphPELength();
            if (length == 0) return null;

            const data_ptr = Bun__getStandaloneModuleGraphPEData() orelse return null;
            return data_ptr[0..length];
        }
    };

    pub const File = struct {
        name: []const u8 = "",
        loader: bun.options.Loader,
        contents: [:0]const u8 = "",
        sourcemap: LazySourceMap,
        cached_blob: ?*bun.webcore.Blob = null,
        encoding: Encoding = .binary,
        wtf_string: bun.String = bun.String.empty,
        bytecode: []u8 = "",
        module_format: ModuleFormat = .none,
        side: FileSide = .server,

        pub fn appearsInEmbeddedFilesArray(this: *const File) bool {
            return this.side == .client or !this.loader.isJavaScriptLike();
        }

        pub fn stat(this: *const File) bun.Stat {
            var result = std.mem.zeroes(bun.Stat);
            result.size = @intCast(this.contents.len);
            result.mode = bun.S.IFREG | 0o644;
            return result;
        }

        pub fn lessThanByIndex(ctx: []const File, lhs_i: u32, rhs_i: u32) bool {
            const lhs = ctx[lhs_i];
            const rhs = ctx[rhs_i];
            return bun.strings.cmpStringsAsc({}, lhs.name, rhs.name);
        }

        pub fn toWTFString(this: *File) bun.String {
            if (this.wtf_string.isEmpty()) {
                switch (this.encoding) {
                    .binary, .utf8 => {
                        this.wtf_string = bun.String.cloneUTF8(this.contents);
                    },
                    .latin1 => {
                        this.wtf_string = bun.String.createStaticExternal(this.contents, true);
                    },
                }
            }

            // We don't want this to free.
            return this.wtf_string.dupeRef();
        }

        pub fn blob(this: *File, globalObject: *bun.jsc.JSGlobalObject) *bun.webcore.Blob {
            if (this.cached_blob == null) {
                const store = bun.webcore.Blob.Store.init(@constCast(this.contents), bun.default_allocator);
                // make it never free
                store.ref();

                const b = bun.webcore.Blob.initWithStore(store, globalObject).new();

                if (bun.http.MimeType.byExtensionNoDefault(bun.strings.trimLeadingChar(std.fs.path.extension(this.name), '.'))) |mime| {
                    store.mime_type = mime;
                    b.content_type = mime.value;
                    b.content_type_was_set = true;
                    b.content_type_allocated = false;
                }

                // The real name goes here:
                store.data.bytes.stored_name = bun.PathString.init(this.name);

                // The pretty name goes here:
                if (strings.hasPrefixComptime(this.name, base_public_path_with_default_suffix)) {
                    b.name = bun.String.cloneUTF8(this.name[base_public_path_with_default_suffix.len..]);
                } else if (this.name.len > 0) {
                    b.name = bun.String.cloneUTF8(this.name);
                }

                this.cached_blob = b;
            }

            return this.cached_blob.?;
        }
    };

    pub const LazySourceMap = union(enum) {
        serialized: SerializedSourceMap,
        parsed: *SourceMap.ParsedSourceMap,
        none,

        /// It probably is not possible to run two decoding jobs on the same file
        var init_lock: bun.Mutex = .{};

        pub fn load(this: *LazySourceMap) ?*SourceMap.ParsedSourceMap {
            init_lock.lock();
            defer init_lock.unlock();

            return switch (this.*) {
                .none => null,
                .parsed => |map| map,
                .serialized => |serialized| {
                    var stored = switch (SourceMap.Mapping.parse(
                        bun.default_allocator,
                        serialized.mappingVLQ(),
                        null,
                        std.math.maxInt(i32),
                        std.math.maxInt(i32),
                        .{},
                    )) {
                        .success => |x| x,
                        .fail => {
                            this.* = .none;
                            return null;
                        },
                    };

                    const source_files = serialized.sourceFileNames();
                    const slices = bun.handleOom(bun.default_allocator.alloc(?[]u8, source_files.len * 2));

                    const file_names: [][]const u8 = @ptrCast(slices[0..source_files.len]);
                    const decompressed_contents_slice = slices[source_files.len..][0..source_files.len];
                    for (file_names, source_files) |*dest, src| {
                        dest.* = src.slice(serialized.bytes);
                    }

                    @memset(decompressed_contents_slice, null);

                    const data = bun.new(SerializedSourceMap.Loaded, .{
                        .map = serialized,
                        .decompressed_files = decompressed_contents_slice,
                    });

                    stored.external_source_names = file_names;
                    stored.underlying_provider = .{ .data = @truncate(@intFromPtr(data)), .load_hint = .none, .kind = .zig };
                    stored.is_standalone_module_graph = true;

                    const parsed = bun.new(SourceMap.ParsedSourceMap, stored);
                    parsed.ref(); // never free
                    this.* = .{ .parsed = parsed };
                    return parsed;
                },
            };
        }
    };

    pub const Offsets = extern struct {
        byte_count: usize = 0,
        modules_ptr: bun.StringPointer = .{},
        entry_point_id: u32 = 0,
        compile_exec_argv_ptr: bun.StringPointer = .{},
        flags: Flags = .{},
    };

    pub const Flags = packed struct(u32) {
        disable_default_env_files: bool = false,
        disable_autoload_bunfig: bool = false,
        disable_autoload_tsconfig: bool = false,
        disable_autoload_package_json: bool = false,
        _padding: u28 = 0,
    };

    const trailer = "\n---- Bun! ----\n";

    pub fn fromBytes(allocator: std.mem.Allocator, raw_bytes: []u8, offsets: Offsets) !StandaloneModuleGraph {
        if (raw_bytes.len == 0) return StandaloneModuleGraph{
            .files = bun.StringArrayHashMap(File).init(allocator),
        };

        const modules_list_bytes = sliceTo(raw_bytes, offsets.modules_ptr);
        const modules_list: []align(1) const CompiledModuleGraphFile = std.mem.bytesAsSlice(CompiledModuleGraphFile, modules_list_bytes);

        if (offsets.entry_point_id > modules_list.len) {
            return error.@"Corrupted module graph: entry point ID is greater than module list count";
        }

        var modules = bun.StringArrayHashMap(File).init(allocator);
        try modules.ensureTotalCapacity(modules_list.len);
        for (modules_list) |module| {
            modules.putAssumeCapacity(
                sliceToZ(raw_bytes, module.name),
                File{
                    .name = sliceToZ(raw_bytes, module.name),
                    .loader = module.loader,
                    .contents = sliceToZ(raw_bytes, module.contents),
                    .sourcemap = if (module.sourcemap.length > 0)
                        .{ .serialized = .{
                            .bytes = @alignCast(sliceTo(raw_bytes, module.sourcemap)),
                        } }
                    else
                        .none,
                    .bytecode = if (module.bytecode.length > 0) @constCast(sliceTo(raw_bytes, module.bytecode)) else &.{},
                    .module_format = module.module_format,
                    .side = module.side,
                },
            );
        }

        modules.lockPointers(); // make the pointers stable forever

        return StandaloneModuleGraph{
            .bytes = raw_bytes[0..offsets.byte_count],
            .files = modules,
            .entry_point_id = offsets.entry_point_id,
            .compile_exec_argv = sliceToZ(raw_bytes, offsets.compile_exec_argv_ptr),
            .flags = offsets.flags,
        };
    }

    fn sliceTo(bytes: []const u8, ptr: bun.StringPointer) []const u8 {
        if (ptr.length == 0) return "";

        return bytes[ptr.offset..][0..ptr.length];
    }

    fn sliceToZ(bytes: []const u8, ptr: bun.StringPointer) [:0]const u8 {
        if (ptr.length == 0) return "";

        return bytes[ptr.offset..][0..ptr.length :0];
    }

    pub fn toBytes(allocator: std.mem.Allocator, prefix: []const u8, output_files: []const bun.options.OutputFile, output_format: bun.options.Format, compile_exec_argv: []const u8, flags: Flags) ![]u8 {
        var serialize_trace = bun.perf.trace("StandaloneModuleGraph.serialize");
        defer serialize_trace.end();

        var entry_point_id: ?usize = null;
        var string_builder = bun.StringBuilder{};
        var module_count: usize = 0;
        for (output_files) |*output_file| {
            string_builder.countZ(output_file.dest_path);
            string_builder.countZ(prefix);
            if (output_file.value == .buffer) {
                if (output_file.output_kind == .sourcemap) {
                    // This is an over-estimation to ensure that we allocate
                    // enough memory for the source-map contents. Calculating
                    // the exact amount is not possible without allocating as it
                    // involves a JSON parser.
                    string_builder.cap += output_file.value.buffer.bytes.len * 2;
                } else if (output_file.output_kind == .bytecode) {
                    // Allocate up to 256 byte alignment for bytecode
                    string_builder.cap += (output_file.value.buffer.bytes.len + 255) / 256 * 256 + 256;
                } else {
                    if (entry_point_id == null) {
                        if (output_file.side == null or output_file.side.? == .server) {
                            if (output_file.output_kind == .@"entry-point") {
                                entry_point_id = module_count;
                            }
                        }
                    }

                    string_builder.countZ(output_file.value.buffer.bytes);
                    module_count += 1;
                }
            }
        }

        if (module_count == 0 or entry_point_id == null) return &[_]u8{};

        string_builder.cap += @sizeOf(CompiledModuleGraphFile) * output_files.len;
        string_builder.cap += trailer.len;
        string_builder.cap += 16;
        string_builder.cap += @sizeOf(Offsets);
        string_builder.countZ(compile_exec_argv);

        try string_builder.allocate(allocator);

        var modules = try std.array_list.Managed(CompiledModuleGraphFile).initCapacity(allocator, module_count);

        var source_map_header_list = std.array_list.Managed(u8).init(allocator);
        defer source_map_header_list.deinit();
        var source_map_string_list = std.array_list.Managed(u8).init(allocator);
        defer source_map_string_list.deinit();
        var source_map_arena = bun.ArenaAllocator.init(allocator);
        defer source_map_arena.deinit();

        for (output_files) |*output_file| {
            if (!output_file.output_kind.isFileInStandaloneMode()) {
                continue;
            }

            if (output_file.value != .buffer) {
                continue;
            }

            const dest_path = bun.strings.removeLeadingDotSlash(output_file.dest_path);

            const bytecode: StringPointer = brk: {
                if (output_file.bytecode_index != std.math.maxInt(u32)) {
                    // Bytecode alignment for JSC bytecode cache deserialization.
                    // Not aligning correctly causes a runtime assertion error or segfault.
                    //
                    // PLATFORM-SPECIFIC ALIGNMENT:
                    // - PE (Windows) and Mach-O (macOS): The module graph data is embedded in
                    //   a dedicated section with an 8-byte size header. At runtime, the section
                    //   is memory-mapped at a page-aligned address (hence 128-byte aligned).
                    //   The data buffer starts 8 bytes after the section start.
                    //   For bytecode at offset O to be 128-byte aligned:
                    //     (section_va + 8 + O) % 128 == 0
                    //     => O % 128 == 120
                    //
                    // - ELF (Linux): The module graph data is appended to the executable and
                    //   read into a heap-allocated buffer at runtime. The allocator provides
                    //   natural alignment, and there's no 8-byte section header offset.
                    //   However, using target_mod=120 is still safe because:
                    //   - If the buffer is 128-aligned: bytecode at offset 120 is at (128n + 120),
                    //     which when loaded at a 128-aligned address gives proper alignment.
                    //   - The extra 120 bytes of padding is acceptable overhead.
                    //
                    // This alignment strategy (target_mod=120) works for all platforms because
                    // it's the worst-case offset needed for the 8-byte header scenario.
                    const bytecode = output_files[output_file.bytecode_index].value.buffer.bytes;
                    const current_offset = string_builder.len;
                    // Calculate padding so that (current_offset + padding) % 128 == 120
                    // This accounts for the 8-byte section header on PE/Mach-O platforms.
                    const target_mod: usize = 128 - @sizeOf(u64); // 120 = accounts for 8-byte header
                    const current_mod = current_offset % 128;
                    const padding = if (current_mod <= target_mod)
                        target_mod - current_mod
                    else
                        128 - current_mod + target_mod;
                    // Zero the padding bytes to ensure deterministic output
                    const writable = string_builder.writable();
                    @memset(writable[0..padding], 0);
                    string_builder.len += padding;
                    const aligned_offset = string_builder.len;
                    const writable_after_padding = string_builder.writable();
                    @memcpy(writable_after_padding[0..bytecode.len], bytecode[0..bytecode.len]);
                    const unaligned_space = writable_after_padding[bytecode.len..];
                    const len = bytecode.len + @min(unaligned_space.len, 128);
                    string_builder.len += len;
                    break :brk StringPointer{ .offset = @truncate(aligned_offset), .length = @truncate(len) };
                } else {
                    break :brk .{};
                }
            };

            if (comptime bun.Environment.is_canary or bun.Environment.isDebug) {
                if (bun.env_var.BUN_FEATURE_FLAG_DUMP_CODE.get()) |dump_code_dir| {
                    const buf = bun.path_buffer_pool.get();
                    defer bun.path_buffer_pool.put(buf);
                    const dest_z = bun.path.joinAbsStringBufZ(dump_code_dir, buf, &.{dest_path}, .auto);

                    // Scoped block to handle dump failures without skipping module emission
                    dump: {
                        const file = bun.sys.File.makeOpen(dest_z, bun.O.WRONLY | bun.O.CREAT | bun.O.TRUNC, 0o664).unwrap() catch |err| {
                            Output.prettyErrorln("<r><red>error<r><d>:<r> failed to open {s}: {s}", .{ dest_path, @errorName(err) });
                            break :dump;
                        };
                        defer file.close();
                        file.writeAll(output_file.value.buffer.bytes).unwrap() catch |err| {
                            Output.prettyErrorln("<r><red>error<r><d>:<r> failed to write {s}: {s}", .{ dest_path, @errorName(err) });
                            break :dump;
                        };
                    }
                }
            }

            var module = CompiledModuleGraphFile{
                .name = string_builder.fmtAppendCountZ("{s}{s}", .{
                    prefix,
                    dest_path,
                }),
                .loader = output_file.loader,
                .contents = string_builder.appendCountZ(output_file.value.buffer.bytes),
                .encoding = switch (output_file.loader) {
                    .js, .jsx, .ts, .tsx => .latin1,
                    else => .binary,
                },
                .module_format = if (output_file.loader.isJavaScriptLike()) switch (output_format) {
                    .cjs => .cjs,
                    .esm => .esm,
                    else => .none,
                } else .none,
                .bytecode = bytecode,
                .side = switch (output_file.side orelse .server) {
                    .server => .server,
                    .client => .client,
                },
            };

            if (output_file.source_map_index != std.math.maxInt(u32)) {
                defer source_map_header_list.clearRetainingCapacity();
                defer source_map_string_list.clearRetainingCapacity();
                _ = source_map_arena.reset(.retain_capacity);
                try serializeJsonSourceMapForStandalone(
                    &source_map_header_list,
                    &source_map_string_list,
                    source_map_arena.allocator(),
                    output_files[output_file.source_map_index].value.buffer.bytes,
                );
                module.sourcemap = string_builder.addConcat(&.{
                    source_map_header_list.items,
                    source_map_string_list.items,
                });
            }
            modules.appendAssumeCapacity(module);
        }

        const offsets = Offsets{
            .entry_point_id = @as(u32, @truncate(entry_point_id.?)),
            .modules_ptr = string_builder.appendCount(std.mem.sliceAsBytes(modules.items)),
            .compile_exec_argv_ptr = string_builder.appendCountZ(compile_exec_argv),
            .byte_count = string_builder.len,
            .flags = flags,
        };

        _ = string_builder.append(std.mem.asBytes(&offsets));
        _ = string_builder.append(trailer);

        const output_bytes = string_builder.ptr.?[0..string_builder.len];

        if (comptime Environment.isDebug) {
            // An expensive sanity check:
            var graph = try fromBytes(allocator, @alignCast(output_bytes), offsets);
            defer {
                graph.files.unlockPointers();
                graph.files.deinit();
            }

            bun.assert_eql(graph.files.count(), modules.items.len);
        }

        return output_bytes;
    }

    const page_size = std.heap.page_size_max;

    pub const InjectOptions = bun.options.WindowsOptions;

    pub const CompileResult = union(enum) {
        success: void,

        err: Error,

        const Error = union(enum) {
            message: []const u8,
            reason: Reason,

            pub const Reason = enum {
                no_entry_point,
                no_output_files,

                pub fn message(this: Reason) []const u8 {
                    return switch (this) {
                        .no_entry_point => "No entry point found for compilation",
                        .no_output_files => "No output files to bundle",
                    };
                }
            };

            pub fn slice(this: *const Error) []const u8 {
                return switch (this.*) {
                    .message => this.message,
                    .reason => this.reason.message(),
                };
            }
        };

        pub fn fail(reason: Error.Reason) CompileResult {
            return .{ .err = .{ .reason = reason } };
        }

        pub fn failFmt(comptime fmt: []const u8, args: anytype) CompileResult {
            return .{ .err = .{ .message = bun.handleOom(std.fmt.allocPrint(bun.default_allocator, fmt, args)) } };
        }

        pub fn deinit(this: *const @This()) void {
            switch (this.*) {
                .success => {},
                .err => switch (this.err) {
                    .message => bun.default_allocator.free(this.err.message),
                    .reason => {},
                },
            }
        }
    };

    pub fn inject(bytes: []const u8, self_exe: [:0]const u8, inject_options: InjectOptions, target: *const CompileTarget) bun.FileDescriptor {
        var buf: bun.PathBuffer = undefined;
        var zname: [:0]const u8 = bun.fs.FileSystem.tmpname("bun-build", &buf, @as(u64, @bitCast(std.time.milliTimestamp()))) catch |err| {
            Output.prettyErrorln("<r><red>error<r><d>:<r> failed to get temporary file name: {s}", .{@errorName(err)});
            return bun.invalid_fd;
        };

        const cleanup = struct {
            pub fn toClean(name: [:0]const u8, fd: bun.FileDescriptor) void {
                // Ensure we own the file
                if (Environment.isPosix) {
                    // Make the file writable so we can delete it
                    _ = Syscall.fchmod(fd, 0o777);
                }
                fd.close();
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
                    return bun.invalid_fd;
                };
                const file = bun.sys.openFileAtWindows(
                    bun.invalid_fd,
                    out,
                    .{
                        .access_mask = w.SYNCHRONIZE | w.GENERIC_WRITE | w.GENERIC_READ | w.DELETE,
                        .disposition = w.FILE_OPEN,
                        .options = w.FILE_SYNCHRONOUS_IO_NONALERT | w.FILE_OPEN_REPARSE_POINT,
                    },
                ).unwrap() catch |e| {
                    Output.prettyErrorln("<r><red>error<r><d>:<r> failed to open temporary file to copy bun into\n{}", .{e});
                    return bun.invalid_fd;
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
                                        bun.fs.FileSystem.RealFS.tmpdirPath(),
                                        std.fs.path.sep_str,
                                        zname,
                                        &.{0},
                                    }) catch |e| bun.handleOom(e);
                                    zname = zname_z[0..zname_z.len -| 1 :0];
                                    continue;
                                }
                                switch (err.getErrno()) {
                                    // try again
                                    .PERM, .AGAIN, .BUSY => continue,
                                    else => break,
                                }

                                Output.prettyErrorln("<r><red>error<r><d>:<r> failed to open temporary file to copy bun into\n{f}", .{err});
                                // No fd to cleanup yet, just return error
                                return bun.invalid_fd;
                            }
                        },
                    }
                }
                unreachable;
            };
            const self_fd: bun.FileDescriptor = brk2: {
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

                            Output.prettyErrorln("<r><red>error<r><d>:<r> failed to open bun executable to copy from as read-only\n{f}", .{err});
                            cleanup(zname, fd);
                            return bun.invalid_fd;
                        },
                    }
                }
                unreachable;
            };

            defer self_fd.close();

            bun.copyFile(self_fd, fd).unwrap() catch |err| {
                Output.prettyErrorln("<r><red>error<r><d>:<r> failed to copy bun executable into temporary file: {s}", .{@errorName(err)});
                cleanup(zname, fd);
                return bun.invalid_fd;
            };

            break :brk fd;
        };

        switch (target.os) {
            .mac => {
                const input_result = bun.sys.File.readToEnd(.{ .handle = cloned_executable_fd }, bun.default_allocator);
                if (input_result.err) |err| {
                    Output.prettyErrorln("Error reading standalone module graph: {f}", .{err});
                    cleanup(zname, cloned_executable_fd);
                    return bun.invalid_fd;
                }
                var macho_file = bun.macho.MachoFile.init(bun.default_allocator, input_result.bytes.items, bytes.len) catch |err| {
                    Output.prettyErrorln("Error initializing standalone module graph: {}", .{err});
                    cleanup(zname, cloned_executable_fd);
                    return bun.invalid_fd;
                };
                defer macho_file.deinit();
                macho_file.writeSection(bytes) catch |err| {
                    Output.prettyErrorln("Error writing standalone module graph: {}", .{err});
                    cleanup(zname, cloned_executable_fd);
                    return bun.invalid_fd;
                };
                input_result.bytes.deinit();

                switch (Syscall.setFileOffset(cloned_executable_fd, 0)) {
                    .err => |err| {
                        Output.prettyErrorln("Error seeking to start of temporary file: {f}", .{err});
                        cleanup(zname, cloned_executable_fd);
                        return bun.invalid_fd;
                    },
                    else => {},
                }

                var file = bun.sys.File{ .handle = cloned_executable_fd };
                const writer = file.writer();
                var buffer: [512 * 1024]u8 = undefined;
                var buffered_writer = writer.adaptToNewApi(&buffer);
                macho_file.buildAndSign(&buffered_writer.new_interface) catch |err| {
                    Output.prettyErrorln("Error writing standalone module graph: {}", .{err});
                    cleanup(zname, cloned_executable_fd);
                    return bun.invalid_fd;
                };
                buffered_writer.new_interface.flush() catch |err| {
                    Output.prettyErrorln("Error flushing standalone module graph: {}", .{err});
                    cleanup(zname, cloned_executable_fd);
                    return bun.invalid_fd;
                };
                if (comptime !Environment.isWindows) {
                    _ = bun.c.fchmod(cloned_executable_fd.native(), 0o777);
                }
                return cloned_executable_fd;
            },
            .windows => {
                const input_result = bun.sys.File.readToEnd(.{ .handle = cloned_executable_fd }, bun.default_allocator);
                if (input_result.err) |err| {
                    Output.prettyErrorln("Error reading standalone module graph: {f}", .{err});
                    cleanup(zname, cloned_executable_fd);
                    return bun.invalid_fd;
                }
                var pe_file = bun.pe.PEFile.init(bun.default_allocator, input_result.bytes.items) catch |err| {
                    Output.prettyErrorln("Error initializing PE file: {}", .{err});
                    cleanup(zname, cloned_executable_fd);
                    return bun.invalid_fd;
                };
                defer pe_file.deinit();
                // Always strip authenticode when adding .bun section for --compile
                pe_file.addBunSection(bytes, .strip_always) catch |err| {
                    Output.prettyErrorln("Error adding Bun section to PE file: {}", .{err});
                    cleanup(zname, cloned_executable_fd);
                    return bun.invalid_fd;
                };
                input_result.bytes.deinit();

                switch (Syscall.setFileOffset(cloned_executable_fd, 0)) {
                    .err => |err| {
                        Output.prettyErrorln("Error seeking to start of temporary file: {f}", .{err});
                        cleanup(zname, cloned_executable_fd);
                        return bun.invalid_fd;
                    },
                    else => {},
                }

                var file = bun.sys.File{ .handle = cloned_executable_fd };
                const writer = file.writer();
                pe_file.write(writer) catch |err| {
                    Output.prettyErrorln("Error writing PE file: {}", .{err});
                    cleanup(zname, cloned_executable_fd);
                    return bun.invalid_fd;
                };
                // Set executable permissions when running on POSIX hosts, even for Windows targets
                if (comptime !Environment.isWindows) {
                    _ = bun.c.fchmod(cloned_executable_fd.native(), 0o777);
                }
                return cloned_executable_fd;
            },
            else => {
                var total_byte_count: usize = undefined;
                if (Environment.isWindows) {
                    total_byte_count = bytes.len + 8 + (Syscall.setFileOffsetToEndWindows(cloned_executable_fd).unwrap() catch |err| {
                        Output.prettyErrorln("<r><red>error<r><d>:<r> failed to seek to end of temporary file\n{}", .{err});
                        cleanup(zname, cloned_executable_fd);
                        return bun.invalid_fd;
                    });
                } else {
                    const seek_position = @as(u64, @intCast(brk: {
                        const fstat = switch (Syscall.fstat(cloned_executable_fd)) {
                            .result => |res| res,
                            .err => |err| {
                                Output.prettyErrorln("{f}", .{err});
                                cleanup(zname, cloned_executable_fd);
                                return bun.invalid_fd;
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
                                "{f}\nwhile seeking to end of temporary file (pos: {d})",
                                .{
                                    err,
                                    seek_position,
                                },
                            );
                            cleanup(zname, cloned_executable_fd);
                            return bun.invalid_fd;
                        },
                        else => {},
                    }
                }

                var remain = bytes;
                while (remain.len > 0) {
                    switch (Syscall.write(cloned_executable_fd, bytes)) {
                        .result => |written| remain = remain[written..],
                        .err => |err| {
                            Output.prettyErrorln("<r><red>error<r><d>:<r> failed to write to temporary file\n{f}", .{err});
                            cleanup(zname, cloned_executable_fd);
                            return bun.invalid_fd;
                        },
                    }
                }

                // the final 8 bytes in the file are the length of the module graph with padding, excluding the trailer and offsets
                _ = Syscall.write(cloned_executable_fd, std.mem.asBytes(&total_byte_count));
                if (comptime !Environment.isWindows) {
                    _ = bun.c.fchmod(cloned_executable_fd.native(), 0o777);
                }

                return cloned_executable_fd;
            },
        }

        if (Environment.isWindows and inject_options.hide_console) {
            bun.windows.editWin32BinarySubsystem(.{ .handle = cloned_executable_fd }, .windows_gui) catch |err| {
                Output.err(err, "failed to disable console on executable", .{});
                cleanup(zname, cloned_executable_fd);
                return bun.invalid_fd;
            };
        }

        // Set Windows icon and/or metadata if any options are provided (single operation)
        if (Environment.isWindows and (inject_options.icon != null or
            inject_options.title != null or
            inject_options.publisher != null or
            inject_options.version != null or
            inject_options.description != null or
            inject_options.copyright != null))
        {
            var zname_buf: bun.OSPathBuffer = undefined;
            const zname_w = bun.strings.toWPathNormalized(&zname_buf, zname) catch |err| {
                Output.err(err, "failed to resolve executable path", .{});
                cleanup(zname, cloned_executable_fd);
                return bun.invalid_fd;
            };

            // Single call to set all Windows metadata at once
            bun.windows.rescle.setWindowsMetadata(
                zname_w.ptr,
                inject_options.icon,
                inject_options.title,
                inject_options.publisher,
                inject_options.version,
                inject_options.description,
                inject_options.copyright,
            ) catch |err| {
                Output.err(err, "failed to set Windows metadata on executable", .{});
                cleanup(zname, cloned_executable_fd);
                return bun.invalid_fd;
            };
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
            target.downloadToPath(env, allocator, dest_z) catch |err| {
                // For CLI, provide detailed error messages and exit
                switch (err) {
                    error.TargetNotFound => {
                        Output.errGeneric(
                            \\Does this target and version of Bun exist?
                            \\
                            \\404 downloading {} from npm registry
                        , .{target.*});
                    },
                    error.NetworkError => {
                        Output.errGeneric(
                            \\Failed to download cross-compilation target.
                            \\
                            \\Network error downloading {} from npm registry
                        , .{target.*});
                    },
                    error.InvalidResponse => {
                        Output.errGeneric(
                            \\Failed to verify the integrity of the downloaded tarball.
                            \\
                            \\The downloaded content for {} appears to be corrupted
                        , .{target.*});
                    },
                    error.ExtractionFailed => {
                        Output.errGeneric(
                            \\Failed to extract the downloaded tarball.
                            \\
                            \\Could not extract executable for {}
                        , .{target.*});
                    },
                    else => {
                        Output.errGeneric("Failed to download {}: {s}", .{ target.*, @errorName(err) });
                    },
                }
                return error.DownloadFailed;
            };
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
        output_format: bun.options.Format,
        windows_options: bun.options.WindowsOptions,
        compile_exec_argv: []const u8,
        self_exe_path: ?[]const u8,
        flags: Flags,
    ) !CompileResult {
        const bytes = toBytes(allocator, module_prefix, output_files, output_format, compile_exec_argv, flags) catch |err| {
            return CompileResult.failFmt("failed to generate module graph bytes: {s}", .{@errorName(err)});
        };
        if (bytes.len == 0) return CompileResult.fail(.no_output_files);
        defer allocator.free(bytes);

        var free_self_exe = false;
        const self_exe = if (self_exe_path) |path| brk: {
            free_self_exe = true;
            break :brk bun.handleOom(allocator.dupeZ(u8, path));
        } else if (target.isDefault())
            bun.selfExePath() catch |err| {
                return CompileResult.failFmt("failed to get self executable path: {s}", .{@errorName(err)});
            }
        else blk: {
            var exe_path_buf: bun.PathBuffer = undefined;
            const version_str = bun.handleOom(std.fmt.allocPrintSentinel(allocator, "{f}", .{target}, 0));
            defer allocator.free(version_str);

            var needs_download: bool = true;
            const dest_z = target.exePath(&exe_path_buf, version_str, env, &needs_download);

            if (needs_download) {
                target.downloadToPath(env, allocator, dest_z) catch |err| {
                    return switch (err) {
                        error.TargetNotFound => CompileResult.failFmt("Target platform '{f}' is not available for download. Check if this version of Bun supports this target.", .{target}),
                        error.NetworkError => CompileResult.failFmt("Network error downloading executable for '{f}'. Check your internet connection and proxy settings.", .{target}),
                        error.InvalidResponse => CompileResult.failFmt("Downloaded file for '{f}' appears to be corrupted. Please try again.", .{target}),
                        error.ExtractionFailed => CompileResult.failFmt("Failed to extract executable for '{f}'. The download may be incomplete.", .{target}),
                        error.UnsupportedTarget => CompileResult.failFmt("Target '{f}' is not supported", .{target}),
                        else => CompileResult.failFmt("Failed to download '{f}': {s}", .{ target, @errorName(err) }),
                    };
                };
            }

            free_self_exe = true;
            break :blk bun.handleOom(allocator.dupeZ(u8, dest_z));
        };

        defer if (free_self_exe) {
            allocator.free(self_exe);
        };

        var fd = inject(
            bytes,
            self_exe,
            windows_options,
            target,
        );
        defer if (fd != bun.invalid_fd) fd.close();
        bun.debugAssert(fd.kind == .system);

        if (Environment.isPosix) {
            // Set executable permissions (0o755 = rwxr-xr-x) - makes it executable for owner, readable/executable for group and others
            _ = Syscall.fchmod(fd, 0o755);
        }

        if (Environment.isWindows) {
            // Get the current path of the temp file
            var temp_buf: bun.PathBuffer = undefined;
            const temp_path = bun.getFdPath(fd, &temp_buf) catch |err| {
                return CompileResult.failFmt("Failed to get temp file path: {s}", .{@errorName(err)});
            };

            // Build the absolute destination path
            // On Windows, we need an absolute path for MoveFileExW
            // Get the current working directory and join with outfile
            var cwd_buf: bun.PathBuffer = undefined;
            const cwd_path = bun.getcwd(&cwd_buf) catch |err| {
                return CompileResult.failFmt("Failed to get current directory: {s}", .{@errorName(err)});
            };
            const dest_path = if (std.fs.path.isAbsolute(outfile))
                outfile
            else
                bun.path.joinAbsString(cwd_path, &[_][]const u8{outfile}, .auto);

            // Convert paths to Windows UTF-16
            var temp_buf_w: bun.OSPathBuffer = undefined;
            var dest_buf_w: bun.OSPathBuffer = undefined;
            const temp_w = bun.strings.toWPathNormalized(&temp_buf_w, temp_path);
            const dest_w = bun.strings.toWPathNormalized(&dest_buf_w, dest_path);

            // Ensure null termination
            const temp_buf_u16 = bun.reinterpretSlice(u16, &temp_buf_w);
            const dest_buf_u16 = bun.reinterpretSlice(u16, &dest_buf_w);
            temp_buf_u16[temp_w.len] = 0;
            dest_buf_u16[dest_w.len] = 0;

            // Close the file handle before moving (Windows requires this)
            fd.close();
            fd = bun.invalid_fd;

            // Move the file using MoveFileExW
            if (bun.windows.kernel32.MoveFileExW(temp_buf_u16[0..temp_w.len :0].ptr, dest_buf_u16[0..dest_w.len :0].ptr, bun.windows.MOVEFILE_COPY_ALLOWED | bun.windows.MOVEFILE_REPLACE_EXISTING | bun.windows.MOVEFILE_WRITE_THROUGH) == bun.windows.FALSE) {
                const err = bun.windows.Win32Error.get();
                if (err.toSystemErrno()) |sys_err| {
                    if (sys_err == .EISDIR) {
                        return CompileResult.failFmt("{s} is a directory. Please choose a different --outfile or delete the directory", .{outfile});
                    } else {
                        return CompileResult.failFmt("failed to move executable to {s}: {s}", .{ dest_path, @tagName(sys_err) });
                    }
                } else {
                    return CompileResult.failFmt("failed to move executable to {s}", .{dest_path});
                }
            }

            // Set Windows icon and/or metadata using unified function
            if (windows_options.icon != null or
                windows_options.title != null or
                windows_options.publisher != null or
                windows_options.version != null or
                windows_options.description != null or
                windows_options.copyright != null)
            {
                // The file has been moved to dest_path
                bun.windows.rescle.setWindowsMetadata(
                    dest_buf_u16[0..dest_w.len :0].ptr,
                    windows_options.icon,
                    windows_options.title,
                    windows_options.publisher,
                    windows_options.version,
                    windows_options.description,
                    windows_options.copyright,
                ) catch |err| {
                    return CompileResult.failFmt("Failed to set Windows metadata: {s}", .{@errorName(err)});
                };
            }
            return .success;
        }

        var buf: bun.PathBuffer = undefined;
        const temp_location = bun.getFdPath(fd, &buf) catch |err| {
            return CompileResult.failFmt("failed to get path for fd: {s}", .{@errorName(err)});
        };
        const temp_posix = std.posix.toPosixPath(temp_location) catch |err| {
            return CompileResult.failFmt("path too long: {s}", .{@errorName(err)});
        };
        const outfile_basename = std.fs.path.basename(outfile);
        const outfile_posix = std.posix.toPosixPath(outfile_basename) catch |err| {
            return CompileResult.failFmt("outfile name too long: {s}", .{@errorName(err)});
        };

        bun.sys.moveFileZWithHandle(
            fd,
            bun.FD.cwd(),
            bun.sliceTo(&temp_posix, 0),
            .fromStdDir(root_dir),
            bun.sliceTo(&outfile_posix, 0),
        ) catch |err| {
            fd.close();
            fd = bun.invalid_fd;

            _ = Syscall.unlink(&temp_posix);

            if (err == error.IsDir or err == error.EISDIR) {
                return CompileResult.failFmt("{s} is a directory. Please choose a different --outfile or delete the directory", .{outfile});
            } else {
                return CompileResult.failFmt("failed to rename {s} to {s}: {s}", .{ temp_location, outfile, @errorName(err) });
            }
        };

        return .success;
    }

    /// Loads the standalone module graph from the executable, allocates it on the heap,
    /// sets it globally, and returns the pointer.
    pub fn fromExecutable(allocator: std.mem.Allocator) !?*StandaloneModuleGraph {
        if (comptime Environment.isMac) {
            const macho_bytes = Macho.getData() orelse return null;
            if (macho_bytes.len < @sizeOf(Offsets) + trailer.len) {
                Output.debugWarn("bun standalone module graph is too small to be valid", .{});
                return null;
            }
            const macho_bytes_slice = macho_bytes[macho_bytes.len - @sizeOf(Offsets) - trailer.len ..];
            const trailer_bytes = macho_bytes[macho_bytes.len - trailer.len ..][0..trailer.len];
            if (!bun.strings.eqlComptime(trailer_bytes, trailer)) {
                Output.debugWarn("bun standalone module graph has invalid trailer", .{});
                return null;
            }
            const offsets = std.mem.bytesAsValue(Offsets, macho_bytes_slice).*;
            return try fromBytesAlloc(allocator, @constCast(macho_bytes), offsets);
        }

        if (comptime Environment.isWindows) {
            const pe_bytes = PE.getData() orelse return null;
            if (pe_bytes.len < @sizeOf(Offsets) + trailer.len) {
                Output.debugWarn("bun standalone module graph is too small to be valid", .{});
                return null;
            }
            const pe_bytes_slice = pe_bytes[pe_bytes.len - @sizeOf(Offsets) - trailer.len ..];
            const trailer_bytes = pe_bytes[pe_bytes.len - trailer.len ..][0..trailer.len];
            if (!bun.strings.eqlComptime(trailer_bytes, trailer)) {
                Output.debugWarn("bun standalone module graph has invalid trailer", .{});
                return null;
            }
            const offsets = std.mem.bytesAsValue(Offsets, pe_bytes_slice).*;
            return try fromBytesAlloc(allocator, @constCast(pe_bytes), offsets);
        }

        // Do not invoke libuv here.
        const self_exe = openSelf() catch return null;
        defer self_exe.close();

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

        if (read_amount < trailer.len + @sizeOf(usize) + @sizeOf(Offsets))
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

        return try fromBytesAlloc(allocator, to_read, offsets);
    }

    /// Allocates a StandaloneModuleGraph on the heap, populates it from bytes, sets it globally, and returns the pointer.
    fn fromBytesAlloc(allocator: std.mem.Allocator, raw_bytes: []u8, offsets: Offsets) !*StandaloneModuleGraph {
        const graph_ptr = try allocator.create(StandaloneModuleGraph);
        graph_ptr.* = try StandaloneModuleGraph.fromBytes(allocator, raw_bytes, offsets);
        graph_ptr.set();
        return graph_ptr;
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
                    return .fromStdFile(easymode);
                } else |_| {
                    if (bun.argv.len > 0) {
                        // The user doesn't have /proc/ mounted, so now we just guess and hope for the best.
                        var whichbuf: bun.PathBuffer = undefined;
                        if (bun.which(
                            &whichbuf,
                            bun.env_var.PATH.get() orelse return error.FileNotFound,
                            "",
                            bun.argv[0],
                        )) |path| {
                            return .fromStdFile(try std.fs.cwd().openFileZ(path, .{}));
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
                return .fromStdFile(file);
            },
            .windows => {
                const image_path_unicode_string = std.os.windows.peb().ProcessParameters.ImagePathName;
                const image_path = image_path_unicode_string.Buffer.?[0 .. image_path_unicode_string.Length / 2];

                var nt_path_buf: bun.WPathBuffer = undefined;
                const nt_path = bun.strings.addNTPathPrefixIfNeeded(&nt_path_buf, image_path);

                const basename_start = std.mem.lastIndexOfScalar(u16, nt_path, '\\') orelse
                    return error.FileNotFound;
                const basename = nt_path[basename_start + 1 .. nt_path.len - ".exe".len];
                if (isBuiltInExe(u16, basename)) {
                    return error.FileNotFound;
                }

                return bun.sys.openFileAtWindows(
                    .cwd(),
                    nt_path,
                    .{
                        .access_mask = w.SYNCHRONIZE | w.GENERIC_READ,
                        .disposition = w.FILE_OPEN,
                        .options = w.FILE_SYNCHRONOUS_IO_NONALERT | w.FILE_OPEN_REPARSE_POINT,
                    },
                ).unwrap() catch {
                    return error.FileNotFound;
                };
            },
            .wasm => @compileError("TODO"),
        }
    }

    /// Source map serialization in the bundler is specially designed to be
    /// loaded in memory as is. Source contents are compressed with ZSTD to
    /// reduce the file size, and mappings are stored as uncompressed VLQ.
    pub const SerializedSourceMap = struct {
        bytes: []const u8,

        /// Following the header bytes:
        /// - source_files_count number of StringPointer, file names
        /// - source_files_count number of StringPointer, zstd compressed contents
        /// - the mapping data, `map_vlq_length` bytes
        /// - all the StringPointer contents
        pub const Header = extern struct {
            source_files_count: u32,
            map_bytes_length: u32,
        };

        pub fn header(map: SerializedSourceMap) *align(1) const Header {
            return @ptrCast(map.bytes.ptr);
        }

        pub fn mappingVLQ(map: SerializedSourceMap) []const u8 {
            const head = map.header();
            const start = @sizeOf(Header) + head.source_files_count * @sizeOf(StringPointer) * 2;
            return map.bytes[start..][0..head.map_bytes_length];
        }

        pub fn sourceFileNames(map: SerializedSourceMap) []align(1) const StringPointer {
            const head = map.header();
            return @as([*]align(1) const StringPointer, @ptrCast(map.bytes[@sizeOf(Header)..]))[0..head.source_files_count];
        }

        fn compressedSourceFiles(map: SerializedSourceMap) []align(1) const StringPointer {
            const head = map.header();
            return @as([*]align(1) const StringPointer, @ptrCast(map.bytes[@sizeOf(Header)..]))[head.source_files_count..][0..head.source_files_count];
        }

        /// Once loaded, this map stores additional data for keeping track of source code.
        pub const Loaded = struct {
            map: SerializedSourceMap,

            /// Only decompress source code once! Once a file is decompressed,
            /// it is stored here. Decompression failures are stored as an empty
            /// string, which will be treated as "no contents".
            decompressed_files: []?[]u8,

            pub fn sourceFileContents(this: Loaded, index: usize) ?[]const u8 {
                if (this.decompressed_files[index]) |decompressed| {
                    return if (decompressed.len == 0) null else decompressed;
                }

                const compressed_codes = this.map.compressedSourceFiles();
                const compressed_file = compressed_codes[@intCast(index)].slice(this.map.bytes);
                const size = bun.zstd.getDecompressedSize(compressed_file);

                const bytes = bun.handleOom(bun.default_allocator.alloc(u8, size));
                const result = bun.zstd.decompress(bytes, compressed_file);

                if (result == .err) {
                    bun.Output.warn("Source map decompression error: {s}", .{result.err});
                    bun.default_allocator.free(bytes);
                    this.decompressed_files[index] = "";
                    return null;
                }

                const data = bytes[0..result.success];
                this.decompressed_files[index] = data;
                return data;
            }
        };
    };

    pub fn serializeJsonSourceMapForStandalone(
        header_list: *std.array_list.Managed(u8),
        string_payload: *std.array_list.Managed(u8),
        arena: std.mem.Allocator,
        json_source: []const u8,
    ) !void {
        const out = header_list.writer();
        const json_src = bun.logger.Source.initPathString("sourcemap.json", json_source);
        var log = bun.logger.Log.init(arena);
        defer log.deinit();

        // the allocator given to the JS parser is not respected for all parts
        // of the parse, so we need to remember to reset the ast store
        bun.ast.Expr.Data.Store.reset();
        bun.ast.Stmt.Data.Store.reset();
        defer {
            bun.ast.Expr.Data.Store.reset();
            bun.ast.Stmt.Data.Store.reset();
        }
        var json = bun.json.parse(&json_src, &log, arena, false) catch
            return error.InvalidSourceMap;

        const mappings_str = json.get("mappings") orelse
            return error.InvalidSourceMap;
        if (mappings_str.data != .e_string)
            return error.InvalidSourceMap;
        const sources_content = switch ((json.get("sourcesContent") orelse return error.InvalidSourceMap).data) {
            .e_array => |arr| arr,
            else => return error.InvalidSourceMap,
        };
        const sources_paths = switch ((json.get("sources") orelse return error.InvalidSourceMap).data) {
            .e_array => |arr| arr,
            else => return error.InvalidSourceMap,
        };
        if (sources_content.items.len != sources_paths.items.len) {
            return error.InvalidSourceMap;
        }

        const map_vlq: []const u8 = mappings_str.data.e_string.slice(arena);

        try out.writeInt(u32, sources_paths.items.len, .little);
        try out.writeInt(u32, @intCast(map_vlq.len), .little);

        const string_payload_start_location = @sizeOf(u32) +
            @sizeOf(u32) +
            @sizeOf(bun.StringPointer) * sources_content.items.len * 2 + // path + source
            map_vlq.len;

        for (sources_paths.items.slice()) |item| {
            if (item.data != .e_string)
                return error.InvalidSourceMap;

            const decoded = try item.data.e_string.stringCloned(arena);

            const offset = string_payload.items.len;
            try string_payload.appendSlice(decoded);

            const slice = bun.StringPointer{
                .offset = @intCast(offset + string_payload_start_location),
                .length = @intCast(string_payload.items.len - offset),
            };
            try out.writeInt(u32, slice.offset, .little);
            try out.writeInt(u32, slice.length, .little);
        }

        for (sources_content.items.slice()) |item| {
            if (item.data != .e_string)
                return error.InvalidSourceMap;

            const utf8 = try item.data.e_string.stringCloned(arena);
            defer arena.free(utf8);

            const offset = string_payload.items.len;

            const bound = bun.zstd.compressBound(utf8.len);
            try string_payload.ensureUnusedCapacity(bound);

            const unused = string_payload.unusedCapacitySlice();
            const compressed_result = bun.zstd.compress(unused, utf8, 1);
            if (compressed_result == .err) {
                bun.Output.panic("Unexpected error compressing sourcemap: {s}", .{bun.span(compressed_result.err)});
            }
            string_payload.items.len += compressed_result.success;

            const slice = bun.StringPointer{
                .offset = @intCast(offset + string_payload_start_location),
                .length = @intCast(string_payload.items.len - offset),
            };
            try out.writeInt(u32, slice.offset, .little);
            try out.writeInt(u32, slice.length, .little);
        }

        try out.writeAll(map_vlq);

        bun.assert(header_list.items.len == string_payload_start_location);
    }
};

const std = @import("std");
const w = std.os.windows;

const bun = @import("bun");
const Environment = bun.Environment;
const Output = bun.Output;
const SourceMap = bun.SourceMap;
const StringPointer = bun.StringPointer;
const Syscall = bun.sys;
const macho = bun.macho;
const pe = bun.pe;
const strings = bun.strings;
const Schema = bun.schema.api;
