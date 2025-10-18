const Fs = @import("../../../fs.zig");
const TCC = @import("../../../deps/tcc.zig");
const std = @import("std");
const Allocator = std.mem.Allocator;

const bun = @import("bun");
const Environment = bun.Environment;
const Output = bun.Output;
const strings = bun.strings;

const jsc = bun.jsc;
const JSGlobalObject = jsc.JSGlobalObject;

const debug = Output.scoped(.TCC, .visible);

const StringArray = @import("./string_array.zig").StringArray;
const SymbolsMap = @import("./symbols_map.zig").SymbolsMap;
const CompilerRT = @import("./compiler_rt.zig").CompilerRT;
const Function = @import("./function.zig").Function;

pub const CompileC = struct {
    source: Source = .{ .file = "" },
    current_file_for_errors: [:0]const u8 = "",

    libraries: StringArray = .{},
    library_dirs: StringArray = .{},
    include_dirs: StringArray = .{},
    symbols: SymbolsMap = .{},
    define: std.ArrayListUnmanaged([2][:0]const u8) = .{},
    // Flags to replace the default flags
    flags: [:0]const u8 = "",
    deferred_errors: std.ArrayListUnmanaged([]const u8) = .{},

    const Source = union(enum) {
        file: [:0]const u8,
        files: std.ArrayListUnmanaged([:0]const u8),

        pub fn first(this: *const Source) [:0]const u8 {
            return switch (this.*) {
                .file => this.file,
                .files => this.files.items[0],
            };
        }

        pub fn deinit(this: *Source, allocator: Allocator) void {
            switch (this.*) {
                .file => if (this.file.len > 0) allocator.free(this.file),
                .files => {
                    for (this.files.items) |file| {
                        allocator.free(file);
                    }
                    this.files.deinit(allocator);
                },
            }

            this.* = .{ .file = "" };
        }

        pub fn add(this: *Source, state: *TCC.State, current_file_for_errors: *[:0]const u8) !void {
            switch (this.*) {
                .file => {
                    current_file_for_errors.* = this.file;
                    state.addFile(this.file) catch return error.CompilationError;
                    current_file_for_errors.* = "";
                },
                .files => {
                    for (this.files.items) |file| {
                        current_file_for_errors.* = file;
                        state.addFile(file) catch return error.CompilationError;
                        current_file_for_errors.* = "";
                    }
                },
            }
        }
    };

    const stdarg = struct {
        extern "c" fn ffi_vfprintf(*anyopaque, [*:0]const u8, ...) callconv(.C) c_int;
        extern "c" fn ffi_vprintf([*:0]const u8, ...) callconv(.C) c_int;
        extern "c" fn ffi_fprintf(*anyopaque, [*:0]const u8, ...) callconv(.C) c_int;
        extern "c" fn ffi_printf([*:0]const u8, ...) callconv(.C) c_int;
        extern "c" fn ffi_fscanf(*anyopaque, [*:0]const u8, ...) callconv(.C) c_int;
        extern "c" fn ffi_scanf([*:0]const u8, ...) callconv(.C) c_int;
        extern "c" fn ffi_sscanf([*:0]const u8, [*:0]const u8, ...) callconv(.C) c_int;
        extern "c" fn ffi_vsscanf([*:0]const u8, [*:0]const u8, ...) callconv(.C) c_int;
        extern "c" fn ffi_fopen([*:0]const u8, [*:0]const u8) callconv(.C) *anyopaque;
        extern "c" fn ffi_fclose(*anyopaque) callconv(.C) c_int;
        extern "c" fn ffi_fgetc(*anyopaque) callconv(.C) c_int;
        extern "c" fn ffi_fputc(c: c_int, *anyopaque) callconv(.C) c_int;
        extern "c" fn ffi_feof(*anyopaque) callconv(.C) c_int;
        extern "c" fn ffi_fileno(*anyopaque) callconv(.C) c_int;
        extern "c" fn ffi_ungetc(c: c_int, *anyopaque) callconv(.C) c_int;
        extern "c" fn ffi_ftell(*anyopaque) callconv(.C) c_long;
        extern "c" fn ffi_fseek(*anyopaque, c_long, c_int) callconv(.C) c_int;
        extern "c" fn ffi_fflush(*anyopaque) callconv(.C) c_int;

        extern "c" fn calloc(nmemb: usize, size: usize) callconv(.C) ?*anyopaque;
        extern "c" fn perror([*:0]const u8) callconv(.C) void;

        const mac = if (Environment.isMac) struct {
            var ffi_stdinp: *anyopaque = @extern(*anyopaque, .{ .name = "__stdinp" });
            var ffi_stdoutp: *anyopaque = @extern(*anyopaque, .{ .name = "__stdoutp" });
            var ffi_stderrp: *anyopaque = @extern(*anyopaque, .{ .name = "__stderrp" });

            pub fn inject(state: *TCC.State) void {
                state.addSymbolsComptime(.{
                    .__stdinp = ffi_stdinp,
                    .__stdoutp = ffi_stdoutp,
                    .__stderrp = ffi_stderrp,
                }) catch @panic("Failed to add macos symbols");
            }
        } else struct {
            pub fn inject(_: *TCC.State) void {}
        };

        pub fn inject(state: *TCC.State) void {
            state.addSymbolsComptime(.{
                // printf family
                .vfprintf = ffi_vfprintf,
                .vprintf = ffi_vprintf,
                .fprintf = ffi_fprintf,
                .printf = ffi_printf,
                .fscanf = ffi_fscanf,
                .scanf = ffi_scanf,
                .sscanf = ffi_sscanf,
                .vsscanf = ffi_vsscanf,
                // files
                .fopen = ffi_fopen,
                .fclose = ffi_fclose,
                .fgetc = ffi_fgetc,
                .fputc = ffi_fputc,
                .feof = ffi_feof,
                .fileno = ffi_fileno,
                .fwrite = std.c.fwrite,
                .ungetc = ffi_ungetc,
                .ftell = ffi_ftell,
                .fseek = ffi_fseek,
                .fflush = ffi_fflush,
                .fread = std.c.fread,
                // memory
                .malloc = std.c.malloc,
                .realloc = std.c.realloc,
                .calloc = calloc,
                .free = std.c.free,
                // error
                .perror = perror,
            }) catch @panic("Failed to add std.c symbols");

            if (Environment.isPosix) {
                state.addSymbolsComptime(.{
                    .posix_memalign = std.c.posix_memalign,
                    .dlopen = std.c.dlopen,
                    .dlclose = std.c.dlclose,
                    .dlsym = std.c.dlsym,
                    .dlerror = std.c.dlerror,
                }) catch @panic("Failed to add posix symbols");
            }

            mac.inject(state);
        }
    };

    pub fn handleCompilationError(this_: ?*CompileC, message: ?[*:0]const u8) callconv(.C) void {
        const this = this_ orelse return;
        var msg = std.mem.span(message orelse "");
        if (msg.len == 0) return;

        var offset: usize = 0;
        // the message we get from TCC sometimes has garbage in it
        // i think because we're doing in-memory compilation
        while (offset < msg.len) : (offset += 1) {
            if (msg[offset] > 0x20 and msg[offset] < 0x7f) break;
        }
        msg = msg[offset..];

        bun.handleOom(this.deferred_errors.append(bun.default_allocator, bun.handleOom(bun.default_allocator.dupe(u8, msg))));
    }

    const DeferredError = error{DeferredErrors};

    inline fn hasDeferredErrors(this: *CompileC) bool {
        return this.deferred_errors.items.len > 0;
    }

    /// Returns DeferredError if any errors from tinycc were registered
    /// via `handleCompilationError`
    inline fn errorCheck(this: *CompileC) DeferredError!void {
        if (this.deferred_errors.items.len > 0) {
            return error.DeferredErrors;
        }
    }

    pub const default_tcc_options: [:0]const u8 = "-std=c11 -Wl,--export-all-symbols -g -O2";

    var cached_default_system_include_dir: [:0]const u8 = "";
    var cached_default_system_library_dir: [:0]const u8 = "";
    var cached_default_system_include_dir_once = std.once(getSystemRootDirOnce);
    fn getSystemRootDirOnce() void {
        if (Environment.isMac) {
            var which_buf: [bun.MAX_PATH_BYTES]u8 = undefined;

            var process = bun.spawnSync(&.{
                .stdout = .buffer,
                .stdin = .ignore,
                .stderr = .ignore,
                .argv = &.{
                    bun.which(&which_buf, bun.sliceTo(std.c.getenv("PATH") orelse "", 0), Fs.FileSystem.instance.top_level_dir, "xcrun") orelse "/usr/bin/xcrun",
                    "-sdk",
                    "macosx",
                    "-show-sdk-path",
                },
                // ?[*:null]?[*:0]const u8
                //  [*:null]?[*:0]u8
                .envp = @ptrCast(std.c.environ),
            }) catch return;
            if (process == .result) {
                defer process.result.deinit();
                if (process.result.isOK()) {
                    const stdout = process.result.stdout.items;
                    if (stdout.len > 0) {
                        cached_default_system_include_dir = bun.default_allocator.dupeZ(u8, strings.trim(stdout, "\n\r")) catch return;
                    }
                }
            }
        } else if (Environment.isLinux) {
            // On Debian/Ubuntu, the lib and include paths are suffixed with {arch}-linux-gnu
            // e.g. x86_64-linux-gnu or aarch64-linux-gnu
            // On Alpine and RHEL-based distros, the paths are not suffixed

            if (Environment.isX64) {
                if (bun.FD.cwd().directoryExistsAt("/usr/include/x86_64-linux-gnu").isTrue()) {
                    cached_default_system_include_dir = "/usr/include/x86_64-linux-gnu";
                } else if (bun.FD.cwd().directoryExistsAt("/usr/include").isTrue()) {
                    cached_default_system_include_dir = "/usr/include";
                }

                if (bun.FD.cwd().directoryExistsAt("/usr/lib/x86_64-linux-gnu").isTrue()) {
                    cached_default_system_library_dir = "/usr/lib/x86_64-linux-gnu";
                } else if (bun.FD.cwd().directoryExistsAt("/usr/lib64").isTrue()) {
                    cached_default_system_library_dir = "/usr/lib64";
                }
            } else if (Environment.isAarch64) {
                if (bun.FD.cwd().directoryExistsAt("/usr/include/aarch64-linux-gnu").isTrue()) {
                    cached_default_system_include_dir = "/usr/include/aarch64-linux-gnu";
                } else if (bun.FD.cwd().directoryExistsAt("/usr/include").isTrue()) {
                    cached_default_system_include_dir = "/usr/include";
                }

                if (bun.FD.cwd().directoryExistsAt("/usr/lib/aarch64-linux-gnu").isTrue()) {
                    cached_default_system_library_dir = "/usr/lib/aarch64-linux-gnu";
                } else if (bun.FD.cwd().directoryExistsAt("/usr/lib64").isTrue()) {
                    cached_default_system_library_dir = "/usr/lib64";
                }
            }
        }
    }

    fn getSystemIncludeDir() ?[:0]const u8 {
        cached_default_system_include_dir_once.call();
        if (cached_default_system_include_dir.len == 0) return null;
        return cached_default_system_include_dir;
    }

    fn getSystemLibraryDir() ?[:0]const u8 {
        cached_default_system_include_dir_once.call();
        if (cached_default_system_library_dir.len == 0) return null;
        return cached_default_system_library_dir;
    }

    pub fn compile(this: *CompileC, globalThis: *JSGlobalObject) !struct { *TCC.State, []u8 } {
        const compile_options: [:0]const u8 = if (this.flags.len > 0)
            this.flags
        else if (bun.getenvZ("BUN_TCC_OPTIONS")) |tcc_options|
            @ptrCast(tcc_options)
        else
            default_tcc_options;

        // TODO: correctly handle invalid user-provided options
        const state = TCC.State.init(CompileC, .{
            .options = compile_options,
            .err = .{ .ctx = this, .handler = &handleCompilationError },
        }, true) catch |e| switch (e) {
            error.OutOfMemory => return error.OutOfMemory,
            else => {
                bun.debugAssert(this.hasDeferredErrors());
                return error.DeferredErrors;
            },
        };

        var pathbuf: [bun.MAX_PATH_BYTES]u8 = undefined;

        if (CompilerRT.dir()) |compiler_rt_dir| {
            state.addSysIncludePath(compiler_rt_dir) catch {
                debug("TinyCC failed to add sysinclude path", .{});
            };
        }

        if (Environment.isMac) {
            add_system_include_dir: {
                const dirs_to_try = [_][]const u8{
                    bun.getenvZ("SDKROOT") orelse "",
                    getSystemIncludeDir() orelse "",
                };

                for (dirs_to_try) |sdkroot| {
                    if (sdkroot.len > 0) {
                        const include_dir = bun.path.joinAbsStringBufZ(sdkroot, &pathbuf, &.{ "usr", "include" }, .auto);
                        state.addSysIncludePath(include_dir) catch return globalThis.throw("TinyCC failed to add sysinclude path", .{});

                        const lib_dir = bun.path.joinAbsStringBufZ(sdkroot, &pathbuf, &.{ "usr", "lib" }, .auto);
                        state.addLibraryPath(lib_dir) catch return globalThis.throw("TinyCC failed to add library path", .{});

                        break :add_system_include_dir;
                    }
                }
            }

            if (Environment.isAarch64) {
                if (bun.FD.cwd().directoryExistsAt("/opt/homebrew/include").isTrue()) {
                    state.addSysIncludePath("/opt/homebrew/include") catch {
                        debug("TinyCC failed to add library path", .{});
                    };
                }

                if (bun.FD.cwd().directoryExistsAt("/opt/homebrew/lib").isTrue()) {
                    state.addLibraryPath("/opt/homebrew/lib") catch {
                        debug("TinyCC failed to add library path", .{});
                    };
                }
            }
        } else if (Environment.isLinux) {
            if (getSystemIncludeDir()) |include_dir| {
                state.addSysIncludePath(include_dir) catch {
                    debug("TinyCC failed to add sysinclude path", .{});
                };
            }

            if (getSystemLibraryDir()) |library_dir| {
                state.addLibraryPath(library_dir) catch {
                    debug("TinyCC failed to add library path", .{});
                };
            }
        }

        if (Environment.isPosix) {
            if (bun.FD.cwd().directoryExistsAt("/usr/local/include").isTrue()) {
                state.addSysIncludePath("/usr/local/include") catch {
                    debug("TinyCC failed to add sysinclude path", .{});
                };
            }

            if (bun.FD.cwd().directoryExistsAt("/usr/local/lib").isTrue()) {
                state.addLibraryPath("/usr/local/lib") catch {
                    debug("TinyCC failed to add library path", .{});
                };
            }
        }

        try this.errorCheck();

        for (this.include_dirs.items) |include_dir| {
            state.addSysIncludePath(include_dir) catch {
                bun.debugAssert(this.hasDeferredErrors());
                return error.DeferredErrors;
            };
        }

        try this.errorCheck();

        CompilerRT.define(state);

        try this.errorCheck();

        for (this.symbols.map.values()) |*symbol| {
            if (symbol.needsNapiEnv()) {
                state.addSymbol("Bun__thisFFIModuleNapiEnv", globalThis.makeNapiEnvForFFI()) catch return error.DeferredErrors;
                break;
            }
        }

        for (this.define.items) |define| {
            state.defineSymbol(define[0], define[1]);
            try this.errorCheck();
        }

        this.source.add(state, &this.current_file_for_errors) catch {
            if (this.deferred_errors.items.len > 0) {
                return error.DeferredErrors;
            } else {
                if (!globalThis.hasException()) {
                    return globalThis.throw("TinyCC failed to compile", .{});
                }
                return error.JSError;
            }
        };

        CompilerRT.inject(state);
        stdarg.inject(state);

        try this.errorCheck();

        for (this.library_dirs.items) |library_dir| {
            // register all, even if some fail. Only fail after all have been registered.
            state.addLibraryPath(library_dir) catch {
                debug("TinyCC failed to add library path", .{});
            };
        }
        try this.errorCheck();

        for (this.libraries.items) |library| {
            // register all, even if some fail.
            state.addLibrary(library) catch {};
        }
        try this.errorCheck();

        const relocation_size = state.relocate(null) catch {
            bun.debugAssert(this.hasDeferredErrors());
            return error.DeferredErrors;
        };

        const bytes: []u8 = try bun.default_allocator.alloc(u8, @as(usize, @intCast(relocation_size)));
        // We cannot free these bytes, evidently.

        const dangerouslyRunWithoutJitProtections = @import("./common.zig").dangerouslyRunWithoutJitProtections;
        _ = dangerouslyRunWithoutJitProtections(TCC.Error!usize, TCC.State.relocate, .{ state, bytes.ptr }) catch return error.DeferredErrors;

        // if errors got added, we would have returned in the relocation catch.
        bun.debugAssert(this.deferred_errors.items.len == 0);

        for (this.symbols.map.keys(), this.symbols.map.values()) |symbol, *function| {
            // FIXME: why are we duping here? can we at least use a stack
            // fallback allocator?
            const duped = bun.handleOom(bun.default_allocator.dupeZ(u8, symbol));
            defer bun.default_allocator.free(duped);
            function.symbol_from_dynamic_library = state.getSymbol(duped) orelse {
                return globalThis.throw("{} is missing from {s}. Was it included in the source code?", .{ bun.fmt.quote(symbol), this.source.first() });
            };
        }

        try this.errorCheck();

        return .{ state, bytes };
    }

    pub fn deinit(this: *CompileC) void {
        this.symbols.deinit();

        this.libraries.deinit();
        this.library_dirs.deinit();
        this.include_dirs.deinit();

        for (this.deferred_errors.items) |deferred_error| {
            bun.default_allocator.free(deferred_error);
        }
        this.deferred_errors.clearAndFree(bun.default_allocator);

        for (this.define.items) |define| {
            bun.default_allocator.free(define[0]);
            if (define[1].len > 0) bun.default_allocator.free(define[1]);
        }
        this.define.clearAndFree(bun.default_allocator);

        this.source.deinit(bun.default_allocator);
        if (this.flags.len > 0) bun.default_allocator.free(this.flags);
        this.flags = "";
    }
};
