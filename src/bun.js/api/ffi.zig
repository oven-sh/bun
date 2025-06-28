const bun = @import("bun");
const Environment = bun.Environment;

const strings = bun.strings;
const string = bun.string;
const Output = bun.Output;
const debug = Output.scoped(.TCC, false);
const std = @import("std");
const Allocator = std.mem.Allocator;
const Fs = @import("../../fs.zig");

const options = @import("../../options.zig");
const ZigString = bun.JSC.ZigString;
const JSC = bun.JSC;

const JSValue = bun.JSC.JSValue;

const JSGlobalObject = bun.JSC.JSGlobalObject;
const VM = bun.JSC.VM;
const VirtualMachine = JSC.VirtualMachine;

const napi = @import("../../napi/napi.zig");

const TCC = @import("../../deps/tcc.zig");
extern fn pthread_jit_write_protect_np(enable: c_int) void;

/// Run a function that needs to write to JIT-protected memory.
///
/// This is dangerous as it allows overwriting executable regions of memory.
/// Do not pass in user-defined functions (including JSFunctions).
fn dangerouslyRunWithoutJitProtections(R: type, func: anytype, args: anytype) R {
    const has_protection = (Environment.isAarch64 and Environment.isMac);
    if (comptime has_protection) pthread_jit_write_protect_np(@intFromBool(false));
    defer if (comptime has_protection) pthread_jit_write_protect_np(@intFromBool(true));
    return @call(.always_inline, func, args);
}

const Offsets = extern struct {
    JSArrayBufferView__offsetOfLength: u32,
    JSArrayBufferView__offsetOfByteOffset: u32,
    JSArrayBufferView__offsetOfVector: u32,
    JSCell__offsetOfType: u32,

    extern "c" var Bun__FFI__offsets: Offsets;
    extern "c" fn Bun__FFI__ensureOffsetsAreLoaded() void;
    fn loadOnce() void {
        Bun__FFI__ensureOffsetsAreLoaded();
    }
    var once = std.once(loadOnce);
    pub fn get() *const Offsets {
        once.call();
        return &Bun__FFI__offsets;
    }
};

pub const FFI = struct {
    pub const js = JSC.Codegen.JSFFI;
    pub const toJS = js.toJS;
    pub const fromJS = js.fromJS;
    pub const fromJSDirect = js.fromJSDirect;

    dylib: ?std.DynLib = null,
    relocated_bytes_to_free: ?[]u8 = null,
    functions: bun.StringArrayHashMapUnmanaged(Function) = .{},
    closed: bool = false,
    shared_state: ?*TCC.State = null,

    pub fn finalize(_: *FFI) callconv(.C) void {}

    const CompileC = struct {
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

            this.deferred_errors.append(bun.default_allocator, bun.default_allocator.dupe(u8, msg) catch bun.outOfMemory()) catch bun.outOfMemory();
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

            _ = dangerouslyRunWithoutJitProtections(TCC.Error!usize, TCC.State.relocate, .{ state, bytes.ptr }) catch return error.DeferredErrors;

            // if errors got added, we would have returned in the relocation catch.
            bun.debugAssert(this.deferred_errors.items.len == 0);

            for (this.symbols.map.keys(), this.symbols.map.values()) |symbol, *function| {
                // FIXME: why are we duping here? can we at least use a stack
                // fallback allocator?
                const duped = bun.default_allocator.dupeZ(u8, symbol) catch bun.outOfMemory();
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
    const SymbolsMap = struct {
        map: bun.StringArrayHashMapUnmanaged(Function) = .{},
        pub fn deinit(this: *SymbolsMap) void {
            for (this.map.keys()) |key| {
                bun.default_allocator.free(@constCast(key));
            }
            this.map.clearAndFree(bun.default_allocator);
        }
    };

    const StringArray = struct {
        items: []const [:0]const u8 = &.{},
        pub fn deinit(this: *StringArray) void {
            for (this.items) |item| {
                // Attempting to free an empty null-terminated slice will crash if it was a default value
                bun.debugAssert(item.len > 0);

                bun.default_allocator.free(@constCast(item));
            }

            if (this.items.len > 0)
                bun.default_allocator.free(this.items);
        }

        pub fn fromJSArray(globalThis: *JSC.JSGlobalObject, value: JSC.JSValue, comptime property: []const u8) bun.JSError!StringArray {
            var iter = try value.arrayIterator(globalThis);
            var items = std.ArrayList([:0]const u8).init(bun.default_allocator);

            while (try iter.next()) |val| {
                if (!val.isString()) {
                    for (items.items) |item| {
                        bun.default_allocator.free(@constCast(item));
                    }
                    items.deinit();
                    return globalThis.throwInvalidArgumentTypeValue(property, "array of strings", val);
                }
                const str = try val.getZigString(globalThis);
                if (str.isEmpty()) continue;
                items.append(str.toOwnedSliceZ(bun.default_allocator) catch bun.outOfMemory()) catch bun.outOfMemory();
            }

            return .{ .items = items.items };
        }

        pub fn fromJSString(globalThis: *JSC.JSGlobalObject, value: JSC.JSValue, comptime property: []const u8) bun.JSError!StringArray {
            if (value.isUndefined()) return .{};
            if (!value.isString()) {
                return globalThis.throwInvalidArgumentTypeValue(property, "array of strings", value);
            }
            const str = try value.getZigString(globalThis);
            if (str.isEmpty()) return .{};
            var items = std.ArrayList([:0]const u8).init(bun.default_allocator);
            items.append(str.toOwnedSliceZ(bun.default_allocator) catch bun.outOfMemory()) catch bun.outOfMemory();
            return .{ .items = items.items };
        }

        pub fn fromJS(globalThis: *JSC.JSGlobalObject, value: JSC.JSValue, comptime property: []const u8) bun.JSError!StringArray {
            if (value.isArray()) {
                return fromJSArray(globalThis, value, property);
            }
            return fromJSString(globalThis, value, property);
        }
    };

    pub fn Bun__FFI__cc(globalThis: *JSC.JSGlobalObject, callframe: *JSC.CallFrame) bun.JSError!JSC.JSValue {
        const arguments = callframe.arguments_old(1).slice();
        if (arguments.len == 0 or !arguments[0].isObject()) {
            return globalThis.throwInvalidArguments("Expected object", .{});
        }
        const allocator = bun.default_allocator;

        // Step 1. compile the user's code

        const object = arguments[0];

        var compile_c = CompileC{};
        defer {
            if (globalThis.hasException()) {
                compile_c.deinit();
            }
        }

        const symbols_object: JSValue = try object.getOwn(globalThis, "symbols") orelse .js_undefined;
        if (!globalThis.hasException() and (symbols_object == .zero or !symbols_object.isObject())) {
            return globalThis.throwInvalidArgumentTypeValue("symbols", "object", symbols_object);
        }

        if (globalThis.hasException()) {
            return error.JSError;
        }

        // SAFETY: already checked that symbols_object is an object
        if (try generateSymbols(globalThis, allocator, &compile_c.symbols.map, symbols_object.getObject().?)) |val| {
            if (val != .zero and !globalThis.hasException())
                return globalThis.throwValue(val);
            return error.JSError;
        }

        if (compile_c.symbols.map.count() == 0) {
            return globalThis.throw("Expected at least one exported symbol", .{});
        }

        if (try object.getOwn(globalThis, "library")) |library_value| {
            compile_c.libraries = try StringArray.fromJS(globalThis, library_value, "library");
        }

        if (globalThis.hasException()) {
            return error.JSError;
        }

        if (try object.getTruthy(globalThis, "flags")) |flags_value| {
            if (flags_value.isArray()) {
                var iter = try flags_value.arrayIterator(globalThis);

                var flags = std.ArrayList(u8).init(allocator);
                defer flags.deinit();
                flags.appendSlice(CompileC.default_tcc_options) catch bun.outOfMemory();

                while (try iter.next()) |value| {
                    if (!value.isString()) {
                        return globalThis.throwInvalidArgumentTypeValue("flags", "array of strings", value);
                    }
                    const slice = try value.toSlice(globalThis, allocator);
                    if (slice.len == 0) continue;
                    defer slice.deinit();
                    flags.append(' ') catch bun.outOfMemory();
                    flags.appendSlice(slice.slice()) catch bun.outOfMemory();
                }
                flags.append(0) catch bun.outOfMemory();
                compile_c.flags = flags.items[0 .. flags.items.len - 1 :0];
                flags = std.ArrayList(u8).init(allocator);
            } else {
                if (!flags_value.isString()) {
                    return globalThis.throwInvalidArgumentTypeValue("flags", "string", flags_value);
                }

                const str = try flags_value.getZigString(globalThis);
                if (!str.isEmpty()) {
                    compile_c.flags = str.toOwnedSliceZ(allocator) catch bun.outOfMemory();
                }
            }
        }

        if (globalThis.hasException()) {
            return error.JSError;
        }

        if (try object.getTruthy(globalThis, "define")) |define_value| {
            if (define_value.getObject()) |define_obj| {
                const Iter = JSC.JSPropertyIterator(.{ .include_value = true, .skip_empty_name = true });
                var iter = try Iter.init(globalThis, define_obj);
                defer iter.deinit();
                while (try iter.next()) |entry| {
                    const key = entry.toOwnedSliceZ(allocator) catch bun.outOfMemory();
                    var owned_value: [:0]const u8 = "";
                    if (!iter.value.isUndefinedOrNull()) {
                        if (iter.value.isString()) {
                            const value = try iter.value.getZigString(globalThis);
                            if (value.len > 0) {
                                owned_value = value.toOwnedSliceZ(allocator) catch bun.outOfMemory();
                            }
                        }
                    }
                    if (globalThis.hasException()) {
                        allocator.free(key);
                        return error.JSError;
                    }

                    compile_c.define.append(allocator, .{ key, owned_value }) catch bun.outOfMemory();
                }
            }
        }

        if (globalThis.hasException()) {
            return error.JSError;
        }

        if (try object.getTruthy(globalThis, "include")) |include_value| {
            compile_c.include_dirs = try StringArray.fromJS(globalThis, include_value, "include");
        }

        if (globalThis.hasException()) {
            return error.JSError;
        }

        if (try object.getOwn(globalThis, "source")) |source_value| {
            if (source_value.isArray()) {
                compile_c.source = .{ .files = .{} };
                var iter = try source_value.arrayIterator(globalThis);
                while (try iter.next()) |value| {
                    if (!value.isString()) {
                        return globalThis.throwInvalidArgumentTypeValue("source", "array of strings", value);
                    }
                    try compile_c.source.files.append(bun.default_allocator, try (try value.getZigString(globalThis)).toOwnedSliceZ(bun.default_allocator));
                }
            } else if (!source_value.isString()) {
                return globalThis.throwInvalidArgumentTypeValue("source", "string", source_value);
            } else {
                const source_path = try (try source_value.getZigString(globalThis)).toOwnedSliceZ(bun.default_allocator);
                compile_c.source.file = source_path;
            }
        }

        if (globalThis.hasException()) {
            return error.JSError;
        }

        // Now we compile the code with tinycc.
        var tcc_state: ?*TCC.State, var bytes_to_free_on_error = compile_c.compile(globalThis) catch |err| {
            switch (err) {
                error.DeferredErrors => {
                    var combined = std.ArrayList(u8).init(bun.default_allocator);
                    defer combined.deinit();
                    var writer = combined.writer();
                    writer.print("{d} errors while compiling {s}\n", .{ compile_c.deferred_errors.items.len, if (compile_c.current_file_for_errors.len > 0) compile_c.current_file_for_errors else compile_c.source.first() }) catch bun.outOfMemory();

                    for (compile_c.deferred_errors.items) |deferred_error| {
                        writer.print("{s}\n", .{deferred_error}) catch bun.outOfMemory();
                    }

                    return globalThis.throw("{s}", .{combined.items});
                },
                error.JSError => |e| return e,
                error.OutOfMemory => |e| return e,
            }
        };
        defer {
            if (tcc_state) |state| state.deinit();

            // TODO: upgrade tinycc because they improved the way memory management works for this
            // we are unable to free memory safely in certain cases here.
        }

        const napi_env = makeNapiEnvIfNeeded(compile_c.symbols.map.values(), globalThis);

        var obj = JSC.JSValue.createEmptyObject(globalThis, compile_c.symbols.map.count());
        for (compile_c.symbols.map.values()) |*function| {
            const function_name = function.base_name.?;

            function.compile(napi_env) catch |err| {
                if (!globalThis.hasException()) {
                    const ret = globalThis.toInvalidArguments("{s} when translating symbol \"{s}\"", .{
                        @errorName(err),
                        function_name,
                    });
                    return globalThis.throwValue(ret);
                }
                return error.JSError;
            };
            switch (function.step) {
                .failed => |err| {
                    const res = ZigString.init(err.msg).toErrorInstance(globalThis);
                    return globalThis.throwValue(res);
                },
                .pending => {
                    return globalThis.throw("Failed to compile (nothing happend!)", .{});
                },
                .compiled => |*compiled| {
                    const str = ZigString.init(bun.asByteSlice(function_name));
                    const cb = JSC.host_fn.NewRuntimeFunction(
                        globalThis,
                        &str,
                        @as(u32, @intCast(function.arg_types.items.len)),
                        bun.cast(*const JSC.JSHostFn, compiled.ptr),
                        false,
                        true,
                        function.symbol_from_dynamic_library,
                    );
                    compiled.js_function = cb;
                    obj.put(globalThis, &str, cb);
                },
            }
        }

        // TODO: pub const new = bun.TrivialNew(FFI)
        var lib = bun.default_allocator.create(FFI) catch bun.outOfMemory();
        lib.* = .{
            .dylib = null,
            .shared_state = tcc_state,
            .functions = compile_c.symbols.map,
            .relocated_bytes_to_free = bytes_to_free_on_error,
        };
        tcc_state = null;
        bytes_to_free_on_error = "";
        compile_c.symbols = .{};

        const js_object = lib.toJS(globalThis);
        JSC.Codegen.JSFFI.symbolsValueSetCached(js_object, globalThis, obj);
        return js_object;
    }

    pub fn closeCallback(globalThis: *JSGlobalObject, ctx: JSValue) JSValue {
        var function: *Function = @ptrFromInt(ctx.asPtrAddress());
        function.deinit(globalThis);
        return .js_undefined;
    }

    pub fn callback(globalThis: *JSGlobalObject, interface: JSC.JSValue, js_callback: JSC.JSValue) JSValue {
        JSC.markBinding(@src());
        if (!interface.isObject()) {
            return globalThis.toInvalidArguments("Expected object", .{});
        }

        if (js_callback.isEmptyOrUndefinedOrNull() or !js_callback.isCallable()) {
            return globalThis.toInvalidArguments("Expected callback function", .{});
        }

        const allocator = VirtualMachine.get().allocator;
        var function: Function = .{ .allocator = allocator };
        var func = &function;

        if (generateSymbolForFunction(globalThis, allocator, interface, func) catch ZigString.init("Out of memory").toErrorInstance(globalThis)) |val| {
            return val;
        }

        // TODO: WeakRefHandle that automatically frees it?
        func.base_name = "";
        js_callback.ensureStillAlive();

        func.compileCallback(globalThis, js_callback, func.threadsafe) catch return ZigString.init("Out of memory").toErrorInstance(globalThis);
        switch (func.step) {
            .failed => |err| {
                const message = ZigString.init(err.msg).toErrorInstance(globalThis);

                func.deinit(globalThis);

                return message;
            },
            .pending => {
                func.deinit(globalThis);
                return ZigString.init("Failed to compile, but not sure why. Please report this bug").toErrorInstance(globalThis);
            },
            .compiled => {
                const function_ = bun.default_allocator.create(Function) catch unreachable;
                function_.* = func.*;
                return JSValue.createObject2(
                    globalThis,
                    ZigString.static("ptr"),
                    ZigString.static("ctx"),
                    JSC.JSValue.fromPtrAddress(@intFromPtr(function_.step.compiled.ptr)),
                    JSC.JSValue.fromPtrAddress(@intFromPtr(function_)),
                );
            },
        }
    }

    pub fn close(
        this: *FFI,
        globalThis: *JSC.JSGlobalObject,
        _: *JSC.CallFrame,
    ) bun.JSError!JSValue {
        JSC.markBinding(@src());
        if (this.closed) {
            return .js_undefined;
        }
        this.closed = true;
        if (this.dylib) |*dylib| {
            dylib.close();
            this.dylib = null;
        }

        if (this.shared_state) |state| {
            this.shared_state = null;
            state.deinit();
        }

        const allocator = VirtualMachine.get().allocator;

        for (this.functions.values()) |*val| {
            val.deinit(globalThis);
        }
        this.functions.deinit(allocator);

        // NOTE: `relocated_bytes_to_free` points to a memory region that was
        // relocated by tinycc. Attempts to free it will cause a bus error,
        // even if jit protections are disabled.
        // if (this.relocated_bytes_to_free) |relocated_bytes_to_free| {
        //     this.relocated_bytes_to_free = null;
        //     bun.default_allocator.free(relocated_bytes_to_free);
        // }

        return .js_undefined;
    }

    pub fn printCallback(global: *JSGlobalObject, object: JSC.JSValue) JSValue {
        JSC.markBinding(@src());
        const allocator = VirtualMachine.get().allocator;

        if (object.isEmptyOrUndefinedOrNull() or !object.isObject()) {
            return global.toInvalidArguments("Expected an object", .{});
        }

        var function: Function = .{ .allocator = allocator };
        if (generateSymbolForFunction(global, allocator, object, &function) catch ZigString.init("Out of memory").toErrorInstance(global)) |val| {
            return val;
        }

        var arraylist = std.ArrayList(u8).init(allocator);
        defer arraylist.deinit();
        var writer = arraylist.writer();

        function.base_name = "my_callback_function";

        function.printCallbackSourceCode(null, null, &writer) catch {
            return ZigString.init("Error while printing code").toErrorInstance(global);
        };
        return ZigString.init(arraylist.items).toJS(global);
    }

    pub fn print(global: *JSGlobalObject, object: JSC.JSValue, is_callback_val: ?JSC.JSValue) bun.JSError!JSValue {
        const allocator = bun.default_allocator;
        if (is_callback_val) |is_callback| {
            if (is_callback.toBoolean()) {
                return printCallback(global, object);
            }
        }

        if (object.isEmptyOrUndefinedOrNull()) return invalidOptionsArg(global);
        const obj = object.getObject() orelse return invalidOptionsArg(global);

        var symbols = bun.StringArrayHashMapUnmanaged(Function){};
        if (generateSymbols(global, bun.default_allocator, &symbols, obj) catch JSC.JSValue.zero) |val| {
            // an error while validating symbols
            for (symbols.keys()) |key| {
                allocator.free(@constCast(key));
            }
            symbols.clearAndFree(allocator);
            return val;
        }
        JSC.markBinding(@src());
        var strs = std.ArrayList(bun.String).initCapacity(allocator, symbols.count()) catch bun.outOfMemory();
        defer {
            for (strs.items) |str| {
                str.deref();
            }
            strs.deinit();
        }
        for (symbols.values()) |*function| {
            var arraylist = std.ArrayList(u8).init(allocator);
            var writer = arraylist.writer();
            function.printSourceCode(&writer) catch {
                // an error while generating source code
                for (symbols.keys()) |key| {
                    allocator.free(@constCast(key));
                }
                for (symbols.values()) |*function_| {
                    function_.arg_types.deinit(allocator);
                }

                symbols.clearAndFree(allocator);
                return ZigString.init("Error while printing code").toErrorInstance(global);
            };
            strs.appendAssumeCapacity(bun.String.createUTF8(arraylist.items));
        }

        const ret = try bun.String.toJSArray(global, strs.items);

        for (symbols.keys()) |key| {
            allocator.free(@constCast(key));
        }
        for (symbols.values()) |*function_| {
            function_.arg_types.deinit(allocator);
            if (function_.step == .compiled) {
                allocator.free(function_.step.compiled.buf);
            }
        }
        symbols.clearAndFree(allocator);

        return ret;
    }

    /// Creates an Exception object indicating that options object is invalid.
    /// The exception is not thrown on the VM.
    fn invalidOptionsArg(global: *JSGlobalObject) JSValue {
        return global.toInvalidArguments("Expected an options object with symbol names", .{});
    }

    pub fn open(global: *JSGlobalObject, name_str: ZigString, object_value: JSC.JSValue) JSC.JSValue {
        JSC.markBinding(@src());
        const vm = VirtualMachine.get();
        var name_slice = name_str.toSlice(bun.default_allocator);
        defer name_slice.deinit();

        if (object_value.isEmptyOrUndefinedOrNull()) return invalidOptionsArg(global);
        const object = object_value.getObject() orelse return invalidOptionsArg(global);

        var filepath_buf: bun.PathBuffer = undefined;
        const name = brk: {
            if (JSC.ModuleLoader.resolveEmbeddedFile(
                vm,
                name_slice.slice(),
                switch (Environment.os) {
                    .linux => "so",
                    .mac => "dylib",
                    .windows => "dll",
                    else => @compileError("TODO"),
                },
            )) |resolved| {
                @memcpy(filepath_buf[0..resolved.len], resolved);
                filepath_buf[resolved.len] = 0;
                break :brk filepath_buf[0..resolved.len];
            }

            break :brk name_slice.slice();
        };

        if (name.len == 0) {
            return global.toInvalidArguments("Invalid library name", .{});
        }

        var symbols = bun.StringArrayHashMapUnmanaged(Function){};
        if (generateSymbols(global, bun.default_allocator, &symbols, object) catch JSC.JSValue.zero) |val| {
            // an error while validating symbols
            for (symbols.keys()) |key| {
                bun.default_allocator.free(@constCast(key));
            }
            symbols.clearAndFree(bun.default_allocator);
            return val;
        }
        if (symbols.count() == 0) {
            return global.toInvalidArguments("Expected at least one symbol", .{});
        }

        var dylib: std.DynLib = brk: {
            // First try using the name directly
            break :brk std.DynLib.open(name) catch {
                const backup_name = Fs.FileSystem.instance.abs(&[1]string{name});
                // if that fails, try resolving the filepath relative to the current working directory
                break :brk std.DynLib.open(backup_name) catch {
                    // Then, if that fails, report an error.
                    const system_error = JSC.SystemError{
                        .code = bun.String.createUTF8(@tagName(.ERR_DLOPEN_FAILED)),
                        .message = bun.String.createUTF8("Failed to open library. This is usually caused by a missing library or an invalid library path."),
                        .syscall = bun.String.createUTF8("dlopen"),
                    };
                    return system_error.toErrorInstance(global);
                };
            };
        };

        var size = symbols.values().len;
        if (size >= 63) {
            size = 0;
        }
        var obj = JSC.JSValue.createEmptyObject(global, size);
        obj.protect();
        defer obj.unprotect();

        const napi_env = makeNapiEnvIfNeeded(symbols.values(), global);

        for (symbols.values()) |*function| {
            const function_name = function.base_name.?;

            // optional if the user passed "ptr"
            if (function.symbol_from_dynamic_library == null) {
                const resolved_symbol = dylib.lookup(*anyopaque, function_name) orelse {
                    const ret = global.toInvalidArguments("Symbol \"{s}\" not found in \"{s}\"", .{ bun.asByteSlice(function_name), name });
                    for (symbols.values()) |*value| {
                        bun.default_allocator.free(@constCast(bun.asByteSlice(value.base_name.?)));
                        value.arg_types.clearAndFree(bun.default_allocator);
                    }
                    symbols.clearAndFree(bun.default_allocator);
                    dylib.close();
                    return ret;
                };

                function.symbol_from_dynamic_library = resolved_symbol;
            }

            function.compile(napi_env) catch |err| {
                const ret = global.toInvalidArguments("{s} when compiling symbol \"{s}\" in \"{s}\"", .{
                    bun.asByteSlice(@errorName(err)),
                    bun.asByteSlice(function_name),
                    name,
                });
                for (symbols.values()) |*value| {
                    value.deinit(global);
                }
                symbols.clearAndFree(bun.default_allocator);
                dylib.close();
                return ret;
            };
            switch (function.step) {
                .failed => |err| {
                    defer for (symbols.values()) |*other_function| {
                        other_function.deinit(global);
                    };

                    const res = ZigString.init(err.msg).toErrorInstance(global);
                    symbols.clearAndFree(bun.default_allocator);
                    dylib.close();
                    return res;
                },
                .pending => {
                    for (symbols.values()) |*other_function| {
                        other_function.deinit(global);
                    }
                    symbols.clearAndFree(bun.default_allocator);
                    dylib.close();
                    return ZigString.init("Failed to compile (nothing happend!)").toErrorInstance(global);
                },
                .compiled => |*compiled| {
                    const str = ZigString.init(bun.asByteSlice(function_name));
                    const cb = JSC.host_fn.NewRuntimeFunction(
                        global,
                        &str,
                        @as(u32, @intCast(function.arg_types.items.len)),
                        bun.cast(*const JSC.JSHostFn, compiled.ptr),
                        false,
                        true,
                        function.symbol_from_dynamic_library,
                    );
                    compiled.js_function = cb;
                    obj.put(global, &str, cb);
                },
            }
        }

        const lib = bun.new(FFI, .{
            .dylib = dylib,
            .functions = symbols,
        });

        const js_object = lib.toJS(global);
        JSC.Codegen.JSFFI.symbolsValueSetCached(js_object, global, obj);
        return js_object;
    }

    pub fn getSymbols(_: *FFI, _: *JSC.JSGlobalObject) JSC.JSValue {
        // This shouldn't be called. The cachedValue is what should be called.
        return .js_undefined;
    }

    pub fn linkSymbols(global: *JSGlobalObject, object_value: JSC.JSValue) JSC.JSValue {
        JSC.markBinding(@src());
        const allocator = VirtualMachine.get().allocator;

        if (object_value.isEmptyOrUndefinedOrNull()) return invalidOptionsArg(global);
        const object = object_value.getObject() orelse return invalidOptionsArg(global);

        var symbols = bun.StringArrayHashMapUnmanaged(Function){};
        if (generateSymbols(global, allocator, &symbols, object) catch JSC.JSValue.zero) |val| {
            // an error while validating symbols
            for (symbols.keys()) |key| {
                allocator.free(@constCast(key));
            }
            symbols.clearAndFree(allocator);
            return val;
        }
        if (symbols.count() == 0) {
            return global.toInvalidArguments("Expected at least one symbol", .{});
        }

        var obj = JSValue.createEmptyObject(global, symbols.count());
        obj.ensureStillAlive();
        defer obj.ensureStillAlive();

        const napi_env = makeNapiEnvIfNeeded(symbols.values(), global);

        for (symbols.values()) |*function| {
            const function_name = function.base_name.?;

            if (function.symbol_from_dynamic_library == null) {
                const ret = global.toInvalidArguments("Symbol for \"{s}\" not found", .{bun.asByteSlice(function_name)});
                for (symbols.values()) |*value| {
                    allocator.free(@constCast(bun.asByteSlice(value.base_name.?)));
                    value.arg_types.clearAndFree(allocator);
                }
                symbols.clearAndFree(allocator);
                return ret;
            }

            function.compile(napi_env) catch |err| {
                const ret = global.toInvalidArguments("{s} when compiling symbol \"{s}\"", .{
                    bun.asByteSlice(@errorName(err)),
                    bun.asByteSlice(function_name),
                });
                for (symbols.values()) |*value| {
                    value.deinit(global);
                }
                symbols.clearAndFree(allocator);
                return ret;
            };
            switch (function.step) {
                .failed => |err| {
                    for (symbols.values()) |*value| {
                        allocator.free(@constCast(bun.asByteSlice(value.base_name.?)));
                        value.arg_types.clearAndFree(allocator);
                    }

                    const res = ZigString.init(err.msg).toErrorInstance(global);
                    function.deinit(global);
                    symbols.clearAndFree(allocator);
                    return res;
                },
                .pending => {
                    for (symbols.values()) |*value| {
                        allocator.free(@constCast(bun.asByteSlice(value.base_name.?)));
                        value.arg_types.clearAndFree(allocator);
                    }
                    symbols.clearAndFree(allocator);
                    return ZigString.static("Failed to compile (nothing happend!)").toErrorInstance(global);
                },
                .compiled => |*compiled| {
                    const name = &ZigString.init(bun.asByteSlice(function_name));

                    const cb = JSC.host_fn.NewRuntimeFunction(
                        global,
                        name,
                        @as(u32, @intCast(function.arg_types.items.len)),
                        bun.cast(*JSC.JSHostFn, compiled.ptr),
                        false,
                        true,
                        function.symbol_from_dynamic_library,
                    );
                    compiled.js_function = cb;

                    obj.put(global, name, cb);
                },
            }
        }

        const lib = bun.new(FFI, .{
            .dylib = null,
            .functions = symbols,
        });

        const js_object = lib.toJS(global);
        JSC.Codegen.JSFFI.symbolsValueSetCached(js_object, global, obj);
        return js_object;
    }
    pub fn generateSymbolForFunction(global: *JSGlobalObject, allocator: std.mem.Allocator, value: JSC.JSValue, function: *Function) bun.JSError!?JSValue {
        JSC.markBinding(@src());

        var abi_types = std.ArrayListUnmanaged(ABIType){};

        if (try value.getOwn(global, "args")) |args| {
            if (args.isEmptyOrUndefinedOrNull() or !args.jsType().isArray()) {
                return ZigString.static("Expected an object with \"args\" as an array").toErrorInstance(global);
            }

            var array = try args.arrayIterator(global);

            try abi_types.ensureTotalCapacityPrecise(allocator, array.len);
            while (try array.next()) |val| {
                if (val.isEmptyOrUndefinedOrNull()) {
                    abi_types.clearAndFree(allocator);
                    return ZigString.static("param must be a string (type name) or number").toErrorInstance(global);
                }

                if (val.isAnyInt()) {
                    const int = val.to(i32);
                    switch (int) {
                        0...ABIType.max => {
                            abi_types.appendAssumeCapacity(@as(ABIType, @enumFromInt(int)));
                            continue;
                        },
                        else => {
                            abi_types.clearAndFree(allocator);
                            return ZigString.static("invalid ABI type").toErrorInstance(global);
                        },
                    }
                }

                if (!val.jsType().isStringLike()) {
                    abi_types.clearAndFree(allocator);
                    return ZigString.static("param must be a string (type name) or number").toErrorInstance(global);
                }

                var type_name = try val.toSlice(global, allocator);
                defer type_name.deinit();
                abi_types.appendAssumeCapacity(ABIType.label.get(type_name.slice()) orelse {
                    abi_types.clearAndFree(allocator);
                    return global.toTypeError(.INVALID_ARG_VALUE, "Unknown type {s}", .{type_name.slice()});
                });
            }
        }
        // var function
        var return_type = ABIType.void;

        var threadsafe = false;

        if (try value.getTruthy(global, "threadsafe")) |threadsafe_value| {
            threadsafe = threadsafe_value.toBoolean();
        }

        if (try value.getTruthy(global, "returns")) |ret_value| brk: {
            if (ret_value.isAnyInt()) {
                const int = ret_value.toInt32();
                switch (int) {
                    0...ABIType.max => {
                        return_type = @as(ABIType, @enumFromInt(int));
                        break :brk;
                    },
                    else => {
                        abi_types.clearAndFree(allocator);
                        return ZigString.static("invalid ABI type").toErrorInstance(global);
                    },
                }
            }

            var ret_slice = try ret_value.toSlice(global, allocator);
            defer ret_slice.deinit();
            return_type = ABIType.label.get(ret_slice.slice()) orelse {
                abi_types.clearAndFree(allocator);
                return global.toTypeError(.INVALID_ARG_VALUE, "Unknown return type {s}", .{ret_slice.slice()});
            };
        }

        if (return_type == ABIType.napi_env) {
            abi_types.clearAndFree(allocator);
            return ZigString.static("Cannot return napi_env to JavaScript").toErrorInstance(global);
        }

        if (return_type == .buffer) {
            abi_types.clearAndFree(allocator);
            return ZigString.static("Cannot return a buffer to JavaScript (since byteLength and byteOffset are unknown)").toErrorInstance(global);
        }

        if (function.threadsafe and return_type != ABIType.void) {
            abi_types.clearAndFree(allocator);
            return ZigString.static("Threadsafe functions must return void").toErrorInstance(global);
        }

        function.* = Function{
            .base_name = null,
            .arg_types = abi_types,
            .return_type = return_type,
            .threadsafe = threadsafe,
            .allocator = allocator,
        };

        if (try value.get(global, "ptr")) |ptr| {
            if (ptr.isNumber()) {
                const num = ptr.asPtrAddress();
                if (num > 0)
                    function.symbol_from_dynamic_library = @as(*anyopaque, @ptrFromInt(num));
            } else {
                const num = ptr.toUInt64NoTruncate();
                if (num > 0) {
                    function.symbol_from_dynamic_library = @as(*anyopaque, @ptrFromInt(num));
                }
            }
        }

        return null;
    }

    pub fn generateSymbols(global: *JSGlobalObject, allocator: Allocator, symbols: *bun.StringArrayHashMapUnmanaged(Function), object: *JSC.JSObject) bun.JSError!?JSValue {
        JSC.markBinding(@src());

        var symbols_iter = try JSC.JSPropertyIterator(.{
            .skip_empty_name = true,

            .include_value = true,
        }).init(global, object);
        defer symbols_iter.deinit();

        try symbols.ensureTotalCapacity(allocator, symbols_iter.len);

        while (try symbols_iter.next()) |prop| {
            const value = symbols_iter.value;

            if (value.isEmptyOrUndefinedOrNull()) {
                return global.toTypeError(.INVALID_ARG_VALUE, "Expected an object for key \"{any}\"", .{prop});
            }

            var function: Function = .{ .allocator = allocator };
            if (try generateSymbolForFunction(global, allocator, value, &function)) |val| {
                return val;
            }
            function.base_name = try prop.toOwnedSliceZ(allocator);

            symbols.putAssumeCapacity(bun.asByteSlice(function.base_name.?), function);
        }

        return null;
    }

    pub const Function = struct {
        symbol_from_dynamic_library: ?*anyopaque = null,
        base_name: ?[:0]const u8 = null,
        state: ?*TCC.State = null,

        return_type: ABIType = ABIType.void,
        arg_types: std.ArrayListUnmanaged(ABIType) = .{},
        step: Step = Step{ .pending = {} },
        threadsafe: bool = false,
        allocator: Allocator,

        pub var lib_dirZ: [*:0]const u8 = "";

        pub fn needsHandleScope(val: *const Function) bool {
            for (val.arg_types.items) |arg| {
                if (arg == ABIType.napi_env or arg == ABIType.napi_value) {
                    return true;
                }
            }
            return val.return_type == ABIType.napi_value;
        }

        extern "c" fn FFICallbackFunctionWrapper_destroy(*anyopaque) void;

        pub fn deinit(val: *Function, globalThis: *JSC.JSGlobalObject) void {
            JSC.markBinding(@src());

            if (val.base_name) |base_name| {
                if (bun.asByteSlice(base_name).len > 0) {
                    val.allocator.free(@constCast(bun.asByteSlice(base_name)));
                }
            }

            val.arg_types.clearAndFree(val.allocator);

            if (val.state) |state| {
                state.deinit();
                val.state = null;
            }

            if (val.step == .compiled) {
                // val.allocator.free(val.step.compiled.buf);
                if (val.step.compiled.js_function != .zero) {
                    _ = globalThis;
                    // _ = JSC.untrackFunction(globalThis, val.step.compiled.js_function);
                    val.step.compiled.js_function = .zero;
                }

                if (val.step.compiled.ffi_callback_function_wrapper) |wrapper| {
                    FFICallbackFunctionWrapper_destroy(wrapper);
                    val.step.compiled.ffi_callback_function_wrapper = null;
                }
            }

            if (val.step == .failed and val.step.failed.allocated) {
                val.allocator.free(val.step.failed.msg);
            }
        }

        pub const Step = union(enum) {
            pending: void,
            compiled: struct {
                ptr: *anyopaque,
                buf: []u8,
                js_function: JSValue = JSValue.zero,
                js_context: ?*anyopaque = null,
                ffi_callback_function_wrapper: ?*anyopaque = null,
            },
            failed: struct {
                msg: []const u8,
                allocated: bool = false,
            },
        };

        fn fail(this: *Function, comptime msg: []const u8) void {
            if (this.step != .failed) {
                @branchHint(.likely);
                this.step = .{ .failed = .{ .msg = msg, .allocated = false } };
            }
        }

        pub fn ffiHeader() string {
            return if (Environment.codegen_embed)
                @embedFile("./FFI.h")
            else
                bun.runtimeEmbedFile(.src, "bun.js/api/FFI.h");
        }

        pub fn handleTCCError(ctx: ?*Function, message: [*c]const u8) callconv(.C) void {
            var this = ctx.?;
            var msg = std.mem.span(message);
            if (msg.len > 0) {
                var offset: usize = 0;
                // the message we get from TCC sometimes has garbage in it
                // i think because we're doing in-memory compilation
                while (offset < msg.len) : (offset += 1) {
                    if (msg[offset] > 0x20 and msg[offset] < 0x7f) break;
                }
                msg = msg[offset..];
            }

            this.step = .{ .failed = .{ .msg = this.allocator.dupe(u8, msg) catch unreachable, .allocated = true } };
        }

        const tcc_options = "-std=c11 -nostdlib -Wl,--export-all-symbols" ++ if (Environment.isDebug) " -g" else "";

        pub fn compile(this: *Function, napiEnv: ?*napi.NapiEnv) !void {
            var source_code = std.ArrayList(u8).init(this.allocator);
            var source_code_writer = source_code.writer();
            try this.printSourceCode(&source_code_writer);

            try source_code.append(0);
            defer source_code.deinit();
            const state = TCC.State.init(Function, .{
                .options = tcc_options,
                .err = .{ .ctx = this, .handler = handleTCCError },
            }, false) catch return error.TCCMissing;

            this.state = state;
            defer {
                if (this.step == .failed) {
                    state.deinit();
                    this.state = null;
                }
            }

            if (napiEnv) |env| {
                _ = state.addSymbol("Bun__thisFFIModuleNapiEnv", env) catch {
                    this.fail("Failed to add NAPI env symbol");
                    return;
                };
            }

            CompilerRT.define(state);

            state.compileString(@ptrCast(source_code.items)) catch {
                this.fail("Failed to compile source code");
                return;
            };

            CompilerRT.inject(state);
            state.addSymbol(this.base_name.?, this.symbol_from_dynamic_library.?) catch {
                bun.debugAssert(this.step == .failed);
                return;
            };

            const relocation_size = state.relocate(null) catch {
                this.fail("tcc_relocate returned a negative value");
                return;
            };

            const bytes: []u8 = try this.allocator.alloc(u8, relocation_size);
            defer {
                if (this.step == .failed) this.allocator.free(bytes);
            }

            _ = dangerouslyRunWithoutJitProtections(TCC.Error!usize, TCC.State.relocate, .{ state, bytes.ptr }) catch {
                this.fail("tcc_relocate returned a negative value");
                return;
            };

            const symbol = state.getSymbol("JSFunctionCall") orelse {
                this.fail("missing generated symbol in source code");
                return;
            };

            this.step = .{
                .compiled = .{
                    .ptr = symbol,
                    .buf = bytes,
                },
            };
            return;
        }

        pub fn compileCallback(
            this: *Function,
            js_context: *JSC.JSGlobalObject,
            js_function: JSValue,
            is_threadsafe: bool,
        ) !void {
            JSC.markBinding(@src());
            var source_code = std.ArrayList(u8).init(this.allocator);
            var source_code_writer = source_code.writer();
            const ffi_wrapper = Bun__createFFICallbackFunction(js_context, js_function);
            try this.printCallbackSourceCode(js_context, ffi_wrapper, &source_code_writer);

            if (comptime Environment.isDebug and Environment.isPosix) {
                debug_write: {
                    const fd = std.posix.open("/tmp/bun-ffi-callback-source.c", .{ .CREAT = true, .ACCMODE = .WRONLY }, 0o644) catch break :debug_write;
                    _ = std.posix.write(fd, source_code.items) catch break :debug_write;
                    std.posix.ftruncate(fd, source_code.items.len) catch break :debug_write;
                    std.posix.close(fd);
                }
            }

            try source_code.append(0);
            // defer source_code.deinit();

            const state = TCC.State.init(Function, .{
                .options = tcc_options,
                .err = .{ .ctx = this, .handler = handleTCCError },
            }, false) catch |e| switch (e) {
                error.OutOfMemory => return error.TCCMissing,
                // 1. .Memory is always a valid option, so InvalidOptions is
                //    impossible
                // 2. other throwable functions arent called, so their errors
                //    aren't possible
                else => unreachable,
            };
            this.state = state;
            defer {
                if (this.step == .failed) {
                    state.deinit();
                    this.state = null;
                }
            }

            if (this.needsNapiEnv()) {
                state.addSymbol("Bun__thisFFIModuleNapiEnv", js_context.makeNapiEnvForFFI()) catch {
                    this.fail("Failed to add NAPI env symbol");
                    return;
                };
            }

            CompilerRT.define(state);

            state.compileString(@ptrCast(source_code.items)) catch {
                this.fail("Failed to compile source code");
                return;
            };

            CompilerRT.inject(state);
            _ = state.addSymbol(
                "FFI_Callback_call",
                // TODO: stage2 - make these ptrs
                if (is_threadsafe)
                    FFI_Callback_threadsafe_call
                else switch (this.arg_types.items.len) {
                    0 => FFI_Callback_call_0,
                    1 => FFI_Callback_call_1,
                    2 => FFI_Callback_call_2,
                    3 => FFI_Callback_call_3,
                    4 => FFI_Callback_call_4,
                    5 => FFI_Callback_call_5,
                    6 => FFI_Callback_call_6,
                    7 => FFI_Callback_call_7,
                    else => FFI_Callback_call,
                },
            ) catch {
                this.fail("Failed to add FFI callback symbol");
                return;
            };
            const relocation_size = state.relocate(null) catch {
                this.fail("tcc_relocate returned a negative value");
                return;
            };

            const bytes: []u8 = try this.allocator.alloc(u8, relocation_size);
            defer {
                if (this.step == .failed) {
                    this.allocator.free(bytes);
                }
            }

            _ = dangerouslyRunWithoutJitProtections(TCC.Error!usize, TCC.State.relocate, .{ state, bytes.ptr }) catch {
                this.fail("tcc_relocate returned a negative value");
                return;
            };

            const symbol = state.getSymbol("my_callback_function") orelse {
                this.fail("missing generated symbol in source code");
                return;
            };

            this.step = .{
                .compiled = .{
                    .ptr = symbol,
                    .buf = bytes,
                    .js_function = js_function,
                    .js_context = js_context,
                    .ffi_callback_function_wrapper = ffi_wrapper,
                },
            };
        }

        pub fn printSourceCode(
            this: *Function,
            writer: anytype,
        ) !void {
            if (this.arg_types.items.len > 0) {
                try writer.writeAll("#define HAS_ARGUMENTS\n");
            }

            brk: {
                if (this.return_type.isFloatingPoint()) {
                    try writer.writeAll("#define USES_FLOAT 1\n");
                    break :brk;
                }

                for (this.arg_types.items) |arg| {
                    // conditionally include math.h
                    if (arg.isFloatingPoint()) {
                        try writer.writeAll("#define USES_FLOAT 1\n");
                        break;
                    }
                }
            }

            try writer.writeAll(ffiHeader());

            // -- Generate the FFI function symbol
            try writer.writeAll("/* --- The Function To Call */\n");
            try this.return_type.typename(writer);
            try writer.writeAll(" ");
            try writer.writeAll(bun.asByteSlice(this.base_name.?));
            try writer.writeAll("(");
            var first = true;
            for (this.arg_types.items, 0..) |arg, i| {
                if (!first) {
                    try writer.writeAll(", ");
                }
                first = false;
                try arg.paramTypename(writer);
                try writer.print(" arg{d}", .{i});
            }
            try writer.writeAll(
                \\);
                \\
                \\/* ---- Your Wrapper Function ---- */
                \\ZIG_REPR_TYPE JSFunctionCall(void* JS_GLOBAL_OBJECT, void* callFrame) {
                \\
            );

            if (this.needsHandleScope()) {
                try writer.writeAll(
                    \\  void* handleScope = NapiHandleScope__open(&Bun__thisFFIModuleNapiEnv, false);
                    \\
                );
            }

            if (this.arg_types.items.len > 0) {
                try writer.writeAll(
                    \\  LOAD_ARGUMENTS_FROM_CALL_FRAME;
                    \\
                );
                for (this.arg_types.items, 0..) |arg, i| {
                    if (arg == .napi_env) {
                        try writer.print(
                            \\  napi_env arg{d} = (napi_env)&Bun__thisFFIModuleNapiEnv;
                            \\  argsPtr++;
                            \\
                        ,
                            .{
                                i,
                            },
                        );
                    } else if (arg == .napi_value) {
                        try writer.print(
                            \\  EncodedJSValue arg{d} = {{ .asInt64 = *argsPtr++ }};
                            \\
                        ,
                            .{
                                i,
                            },
                        );
                    } else if (arg.needsACastInC()) {
                        if (i < this.arg_types.items.len - 1) {
                            try writer.print(
                                \\  EncodedJSValue arg{d} = {{ .asInt64 = *argsPtr++ }};
                                \\
                            ,
                                .{
                                    i,
                                },
                            );
                        } else {
                            try writer.print(
                                \\  EncodedJSValue arg{d};
                                \\  arg{d}.asInt64 = *argsPtr;
                                \\
                            ,
                                .{
                                    i,
                                    i,
                                },
                            );
                        }
                    } else {
                        if (i < this.arg_types.items.len - 1) {
                            try writer.print(
                                \\  int64_t arg{d} = *argsPtr++;
                                \\
                            ,
                                .{
                                    i,
                                },
                            );
                        } else {
                            try writer.print(
                                \\  int64_t arg{d} = *argsPtr;
                                \\
                            ,
                                .{
                                    i,
                                },
                            );
                        }
                    }
                }
            }

            // try writer.writeAll(
            //     "(JSContext ctx, void* function, void* thisObject, size_t argumentCount, const EncodedJSValue arguments[], void* exception);\n\n",
            // );

            var arg_buf: [512]u8 = undefined;

            try writer.writeAll("    ");
            if (!(this.return_type == .void)) {
                try this.return_type.typename(writer);
                try writer.writeAll(" return_value = ");
            }
            try writer.print("{s}(", .{bun.asByteSlice(this.base_name.?)});
            first = true;
            arg_buf[0..3].* = "arg".*;
            for (this.arg_types.items, 0..) |arg, i| {
                if (!first) {
                    try writer.writeAll(", ");
                }
                first = false;
                try writer.writeAll("    ");

                const lengthBuf = std.fmt.bufPrintIntToSlice(arg_buf["arg".len..], i, 10, .lower, .{});
                const argName = arg_buf[0 .. 3 + lengthBuf.len];
                if (arg.needsACastInC()) {
                    try writer.print("{any}", .{arg.toC(argName)});
                } else {
                    try writer.writeAll(argName);
                }
            }
            try writer.writeAll(");\n");

            if (!first) try writer.writeAll("\n");

            try writer.writeAll("    ");

            if (this.needsHandleScope()) {
                try writer.writeAll(
                    \\  NapiHandleScope__close(&Bun__thisFFIModuleNapiEnv, handleScope);
                    \\
                );
            }

            try writer.writeAll("return ");

            if (!(this.return_type == .void)) {
                try writer.print("{any}.asZigRepr", .{this.return_type.toJS("return_value")});
            } else {
                try writer.writeAll("ValueUndefined.asZigRepr");
            }

            try writer.writeAll(";\n}\n\n");
        }

        extern fn FFI_Callback_call(*anyopaque, usize, [*]JSValue) JSValue;
        extern fn FFI_Callback_call_0(*anyopaque, usize, [*]JSValue) JSValue;
        extern fn FFI_Callback_call_1(*anyopaque, usize, [*]JSValue) JSValue;
        extern fn FFI_Callback_call_2(*anyopaque, usize, [*]JSValue) JSValue;
        extern fn FFI_Callback_call_3(*anyopaque, usize, [*]JSValue) JSValue;
        extern fn FFI_Callback_call_4(*anyopaque, usize, [*]JSValue) JSValue;
        extern fn FFI_Callback_call_5(*anyopaque, usize, [*]JSValue) JSValue;
        extern fn FFI_Callback_threadsafe_call(*anyopaque, usize, [*]JSValue) JSValue;
        extern fn FFI_Callback_call_6(*anyopaque, usize, [*]JSValue) JSValue;
        extern fn FFI_Callback_call_7(*anyopaque, usize, [*]JSValue) JSValue;
        extern fn Bun__createFFICallbackFunction(*JSC.JSGlobalObject, JSValue) *anyopaque;

        pub fn printCallbackSourceCode(
            this: *Function,
            globalObject: ?*JSC.JSGlobalObject,
            context_ptr: ?*anyopaque,
            writer: anytype,
        ) !void {
            {
                const ptr = @intFromPtr(globalObject);
                const fmt = bun.fmt.hexIntUpper(ptr);
                try writer.print("#define JS_GLOBAL_OBJECT (void*)0x{any}ULL\n", .{fmt});
            }

            try writer.writeAll("#define IS_CALLBACK 1\n");

            brk: {
                if (this.return_type.isFloatingPoint()) {
                    try writer.writeAll("#define USES_FLOAT 1\n");
                    break :brk;
                }

                for (this.arg_types.items) |arg| {
                    // conditionally include math.h
                    if (arg.isFloatingPoint()) {
                        try writer.writeAll("#define USES_FLOAT 1\n");
                        break;
                    }
                }
            }

            try writer.writeAll(ffiHeader());

            // -- Generate the FFI function symbol
            try writer.writeAll("\n \n/* --- The Callback Function */\n");
            var first = true;
            try this.return_type.typename(writer);

            try writer.writeAll(" my_callback_function");
            try writer.writeAll("(");
            for (this.arg_types.items, 0..) |arg, i| {
                if (!first) {
                    try writer.writeAll(", ");
                }
                first = false;
                try arg.typename(writer);
                try writer.print(" arg{d}", .{i});
            }
            try writer.writeAll(") {\n");

            if (comptime Environment.isDebug) {
                try writer.writeAll("#ifdef INJECT_BEFORE\n");
                try writer.writeAll("INJECT_BEFORE;\n");
                try writer.writeAll("#endif\n");
            }

            first = true;

            if (this.arg_types.items.len > 0) {
                var arg_buf: [512]u8 = undefined;
                try writer.print(" ZIG_REPR_TYPE arguments[{d}];\n", .{this.arg_types.items.len});

                arg_buf[0.."arg".len].* = "arg".*;
                for (this.arg_types.items, 0..) |arg, i| {
                    const printed = std.fmt.bufPrintIntToSlice(arg_buf["arg".len..], i, 10, .lower, .{});
                    const arg_name = arg_buf[0 .. "arg".len + printed.len];
                    try writer.print("arguments[{d}] = {any}.asZigRepr;\n", .{ i, arg.toJS(arg_name) });
                }
            }

            try writer.writeAll("  ");
            var inner_buf_: [372]u8 = undefined;
            var inner_buf: []u8 = &.{};

            {
                const ptr = @intFromPtr(context_ptr);
                const fmt = bun.fmt.hexIntUpper(ptr);

                if (this.arg_types.items.len > 0) {
                    inner_buf = try std.fmt.bufPrint(
                        inner_buf_[1..],
                        "FFI_Callback_call((void*)0x{any}ULL, {d}, arguments)",
                        .{ fmt, this.arg_types.items.len },
                    );
                } else {
                    inner_buf = try std.fmt.bufPrint(
                        inner_buf_[1..],
                        "FFI_Callback_call((void*)0x{any}ULL, 0, (ZIG_REPR_TYPE*)0)",
                        .{fmt},
                    );
                }
            }

            if (this.return_type == .void) {
                try writer.writeAll(inner_buf);
            } else {
                const len = inner_buf.len + 1;
                inner_buf = inner_buf_[0..len];
                inner_buf[0] = '_';
                try writer.print("return {s}", .{this.return_type.toCExact(inner_buf)});
            }

            try writer.writeAll(";\n}\n\n");
        }

        fn needsNapiEnv(this: *const FFI.Function) bool {
            for (this.arg_types.items) |arg| {
                if (arg == .napi_env or arg == .napi_value) {
                    return true;
                }
            }

            return false;
        }
    };

    // Must be kept in sync with JSFFIFunction.h version
    pub const ABIType = enum(i32) {
        char = 0,

        int8_t = 1,
        uint8_t = 2,

        int16_t = 3,
        uint16_t = 4,

        int32_t = 5,
        uint32_t = 6,

        int64_t = 7,
        uint64_t = 8,

        double = 9,
        float = 10,

        bool = 11,

        ptr = 12,

        void = 13,

        cstring = 14,

        i64_fast = 15,
        u64_fast = 16,

        function = 17,
        napi_env = 18,
        napi_value = 19,
        buffer = 20,
        pub const max = @intFromEnum(ABIType.napi_value);

        /// Types that we can directly pass through as an `int64_t`
        pub fn needsACastInC(this: ABIType) bool {
            return switch (this) {
                .char, .int8_t, .uint8_t, .int16_t, .uint16_t, .int32_t, .uint32_t => false,
                else => true,
            };
        }

        const map = .{
            .{ "bool", ABIType.bool },
            .{ "c_int", ABIType.int32_t },
            .{ "c_uint", ABIType.uint32_t },
            .{ "char", ABIType.char },
            .{ "char*", ABIType.ptr },
            .{ "double", ABIType.double },
            .{ "f32", ABIType.float },
            .{ "f64", ABIType.double },
            .{ "float", ABIType.float },
            .{ "i16", ABIType.int16_t },
            .{ "i32", ABIType.int32_t },
            .{ "i64", ABIType.int64_t },
            .{ "i8", ABIType.int8_t },
            .{ "int", ABIType.int32_t },
            .{ "int16_t", ABIType.int16_t },
            .{ "int32_t", ABIType.int32_t },
            .{ "int64_t", ABIType.int64_t },
            .{ "int8_t", ABIType.int8_t },
            .{ "isize", ABIType.int64_t },
            .{ "u16", ABIType.uint16_t },
            .{ "u32", ABIType.uint32_t },
            .{ "u64", ABIType.uint64_t },
            .{ "u8", ABIType.uint8_t },
            .{ "uint16_t", ABIType.uint16_t },
            .{ "uint32_t", ABIType.uint32_t },
            .{ "uint64_t", ABIType.uint64_t },
            .{ "uint8_t", ABIType.uint8_t },
            .{ "usize", ABIType.uint64_t },
            .{ "size_t", ABIType.uint64_t },
            .{ "buffer", ABIType.buffer },
            .{ "void*", ABIType.ptr },
            .{ "ptr", ABIType.ptr },
            .{ "pointer", ABIType.ptr },
            .{ "void", ABIType.void },
            .{ "cstring", ABIType.cstring },
            .{ "i64_fast", ABIType.i64_fast },
            .{ "u64_fast", ABIType.u64_fast },
            .{ "function", ABIType.function },
            .{ "callback", ABIType.function },
            .{ "fn", ABIType.function },
            .{ "napi_env", ABIType.napi_env },
            .{ "napi_value", ABIType.napi_value },
        };
        pub const label = bun.ComptimeStringMap(ABIType, map);
        const EnumMapFormatter = struct {
            name: []const u8,
            entry: ABIType,
            pub fn format(self: EnumMapFormatter, comptime _: []const u8, _: std.fmt.FormatOptions, writer: anytype) !void {
                try writer.writeAll("['");
                // these are not all valid identifiers
                try writer.writeAll(self.name);
                try writer.writeAll("']:");
                try std.fmt.formatInt(@intFromEnum(self.entry), 10, .lower, .{}, writer);
                try writer.writeAll(",'");
                try std.fmt.formatInt(@intFromEnum(self.entry), 10, .lower, .{}, writer);
                try writer.writeAll("':");
                try std.fmt.formatInt(@intFromEnum(self.entry), 10, .lower, .{}, writer);
            }
        };
        pub const map_to_js_object = brk: {
            var count: usize = 2;
            for (map, 0..) |item, i| {
                const fmt = EnumMapFormatter{ .name = item.@"0", .entry = item.@"1" };
                count += std.fmt.count("{}", .{fmt});
                count += @intFromBool(i > 0);
            }

            var buf: [count]u8 = undefined;
            buf[0] = '{';
            buf[buf.len - 1] = '}';
            var end: usize = 1;
            for (map, 0..) |item, i| {
                const fmt = EnumMapFormatter{ .name = item.@"0", .entry = item.@"1" };
                if (i > 0) {
                    buf[end] = ',';
                    end += 1;
                }
                end += (std.fmt.bufPrint(buf[end..], "{}", .{fmt}) catch unreachable).len;
            }

            break :brk buf;
        };

        pub fn isFloatingPoint(this: ABIType) bool {
            return switch (this) {
                .double, .float => true,
                else => false,
            };
        }

        const ToCFormatter = struct {
            symbol: string,
            tag: ABIType,
            exact: bool = false,

            pub fn format(self: ToCFormatter, comptime _: []const u8, _: std.fmt.FormatOptions, writer: anytype) !void {
                switch (self.tag) {
                    .void => {
                        return;
                    },
                    .bool => {
                        if (self.exact)
                            try writer.writeAll("(bool)");
                        try writer.writeAll("JSVALUE_TO_BOOL(");
                    },
                    .char, .int8_t, .uint8_t, .int16_t, .uint16_t, .int32_t, .uint32_t => {
                        if (self.exact)
                            try writer.print("({s})", .{bun.asByteSlice(@tagName(self.tag))});

                        try writer.writeAll("JSVALUE_TO_INT32(");
                    },
                    .i64_fast, .int64_t => {
                        if (self.exact)
                            try writer.writeAll("(int64_t)");
                        try writer.writeAll("JSVALUE_TO_INT64(");
                    },
                    .u64_fast, .uint64_t => {
                        if (self.exact)
                            try writer.writeAll("(uint64_t)");
                        try writer.writeAll("JSVALUE_TO_UINT64(");
                    },
                    .function, .cstring, .ptr => {
                        if (self.exact)
                            try writer.writeAll("(void*)");
                        try writer.writeAll("JSVALUE_TO_PTR(");
                    },
                    .double => {
                        if (self.exact)
                            try writer.writeAll("(double)");
                        try writer.writeAll("JSVALUE_TO_DOUBLE(");
                    },
                    .float => {
                        if (self.exact)
                            try writer.writeAll("(float)");
                        try writer.writeAll("JSVALUE_TO_FLOAT(");
                    },
                    .napi_env => {
                        try writer.writeAll("((napi_env)&Bun__thisFFIModuleNapiEnv)");
                        return;
                    },
                    .napi_value => {
                        try writer.writeAll(self.symbol);
                        try writer.writeAll(".asNapiValue");
                        return;
                    },
                    .buffer => {
                        try writer.writeAll("JSVALUE_TO_TYPED_ARRAY_VECTOR(");
                    },
                }
                try writer.writeAll(self.symbol);
                try writer.writeAll(")");
            }
        };

        const ToJSFormatter = struct {
            symbol: []const u8,
            tag: ABIType,

            pub fn format(self: ToJSFormatter, comptime _: []const u8, _: std.fmt.FormatOptions, writer: anytype) !void {
                switch (self.tag) {
                    .void => {},
                    .bool => {
                        try writer.print("BOOLEAN_TO_JSVALUE({s})", .{self.symbol});
                    },
                    .char, .int8_t, .uint8_t, .int16_t, .uint16_t, .int32_t => {
                        try writer.print("INT32_TO_JSVALUE((int32_t){s})", .{self.symbol});
                    },
                    .uint32_t => {
                        try writer.print("UINT32_TO_JSVALUE({s})", .{self.symbol});
                    },
                    .i64_fast => {
                        try writer.print("INT64_TO_JSVALUE(JS_GLOBAL_OBJECT, (int64_t){s})", .{self.symbol});
                    },
                    .int64_t => {
                        try writer.print("INT64_TO_JSVALUE_SLOW(JS_GLOBAL_OBJECT, {s})", .{self.symbol});
                    },
                    .u64_fast => {
                        try writer.print("UINT64_TO_JSVALUE(JS_GLOBAL_OBJECT, {s})", .{self.symbol});
                    },
                    .uint64_t => {
                        try writer.print("UINT64_TO_JSVALUE_SLOW(JS_GLOBAL_OBJECT, {s})", .{self.symbol});
                    },
                    .function, .cstring, .ptr => {
                        try writer.print("PTR_TO_JSVALUE({s})", .{self.symbol});
                    },
                    .double => {
                        try writer.print("DOUBLE_TO_JSVALUE({s})", .{self.symbol});
                    },
                    .float => {
                        try writer.print("FLOAT_TO_JSVALUE({s})", .{self.symbol});
                    },
                    .napi_env => {
                        try writer.writeAll("((napi_env)&Bun__thisFFIModuleNapiEnv)");
                    },
                    .napi_value => {
                        try writer.print("((EncodedJSValue) {{.asNapiValue = {s} }} )", .{self.symbol});
                    },
                    .buffer => {
                        try writer.writeAll("0");
                    },
                }
            }
        };

        pub fn toC(this: ABIType, symbol: string) ToCFormatter {
            return ToCFormatter{ .tag = this, .symbol = symbol };
        }

        pub fn toCExact(this: ABIType, symbol: string) ToCFormatter {
            return ToCFormatter{ .tag = this, .symbol = symbol, .exact = true };
        }

        pub fn toJS(
            this: ABIType,
            symbol: string,
        ) ToJSFormatter {
            return ToJSFormatter{
                .tag = this,
                .symbol = symbol,
            };
        }

        pub fn typename(this: ABIType, writer: anytype) !void {
            try writer.writeAll(this.typenameLabel());
        }

        pub fn typenameLabel(this: ABIType) []const u8 {
            return switch (this) {
                .buffer, .function, .cstring, .ptr => "void*",
                .bool => "bool",
                .int8_t => "int8_t",
                .uint8_t => "uint8_t",
                .int16_t => "int16_t",
                .uint16_t => "uint16_t",
                .int32_t => "int32_t",
                .uint32_t => "uint32_t",
                .i64_fast, .int64_t => "int64_t",
                .u64_fast, .uint64_t => "uint64_t",
                .double => "double",
                .float => "float",
                .char => "char",
                .void => "void",
                .napi_env => "napi_env",
                .napi_value => "napi_value",
            };
        }

        pub fn paramTypename(this: ABIType, writer: anytype) !void {
            try writer.writeAll(this.typenameLabel());
        }

        pub fn paramTypenameLabel(this: ABIType) []const u8 {
            return switch (this) {
                .function, .cstring, .ptr => "void*",
                .bool => "bool",
                .int8_t => "int8_t",
                .uint8_t => "uint8_t",
                .int16_t => "int16_t",
                .uint16_t => "uint16_t",
                // see the comment in ffi.ts about why `uint32_t` acts as `int32_t`
                .int32_t,
                .uint32_t,
                => "int32_t",
                .i64_fast, .int64_t => "int64_t",
                .u64_fast, .uint64_t => "uint64_t",
                .double => "double",
                .float => "float",
                .char => "char",
                .void => "void",
                .napi_env => "napi_env",
                .napi_value => "napi_value",
                .buffer => "buffer",
            };
        }
    };
};

const CompilerRT = struct {
    var compiler_rt_dir: [:0]const u8 = "";
    const compiler_rt_sources = struct {
        pub const @"stdbool.h" = @embedFile("./ffi-stdbool.h");
        pub const @"stdarg.h" = @embedFile("./ffi-stdarg.h");
        pub const @"stdnoreturn.h" = @embedFile("./ffi-stdnoreturn.h");
        pub const @"stdalign.h" = @embedFile("./ffi-stdalign.h");
        pub const @"tgmath.h" = @embedFile("./ffi-tgmath.h");
        pub const @"stddef.h" = @embedFile("./ffi-stddef.h");
        pub const @"varargs.h" = "// empty";
    };

    fn createCompilerRTDir() void {
        const tmpdir = Fs.FileSystem.instance.tmpdir() catch return;
        var bunCC = tmpdir.makeOpenPath("bun-cc", .{}) catch return;
        defer bunCC.close();

        inline for (comptime std.meta.declarations(compiler_rt_sources)) |decl| {
            const source = @field(compiler_rt_sources, decl.name);
            bunCC.writeFile(.{
                .sub_path = decl.name,
                .data = source,
            }) catch {};
        }
        var path_buf: [bun.MAX_PATH_BYTES]u8 = undefined;
        compiler_rt_dir = bun.default_allocator.dupeZ(u8, bun.getFdPath(.fromStdDir(bunCC), &path_buf) catch return) catch bun.outOfMemory();
    }
    var create_compiler_rt_dir_once = std.once(createCompilerRTDir);

    pub fn dir() ?[:0]const u8 {
        create_compiler_rt_dir_once.call();
        if (compiler_rt_dir.len == 0) return null;
        return compiler_rt_dir;
    }

    const MyFunctionSStructWorkAround = struct {
        JSVALUE_TO_INT64: *const fn (JSValue0: JSC.JSValue) callconv(.C) i64,
        JSVALUE_TO_UINT64: *const fn (JSValue0: JSC.JSValue) callconv(.C) u64,
        INT64_TO_JSVALUE: *const fn (arg0: *JSC.JSGlobalObject, arg1: i64) callconv(.C) JSC.JSValue,
        UINT64_TO_JSVALUE: *const fn (arg0: *JSC.JSGlobalObject, arg1: u64) callconv(.C) JSC.JSValue,
        bun_call: *const @TypeOf(JSC.C.JSObjectCallAsFunction),
    };
    const headers = JSValue.exposed_to_ffi;
    var workaround: MyFunctionSStructWorkAround = .{
        .JSVALUE_TO_INT64 = headers.JSVALUE_TO_INT64,
        .JSVALUE_TO_UINT64 = headers.JSVALUE_TO_UINT64,
        .INT64_TO_JSVALUE = headers.INT64_TO_JSVALUE,
        .UINT64_TO_JSVALUE = headers.UINT64_TO_JSVALUE,
        .bun_call = &JSC.C.JSObjectCallAsFunction,
    };

    noinline fn memset(
        dest: [*]u8,
        c: u8,
        byte_count: usize,
    ) callconv(.C) void {
        @memset(dest[0..byte_count], c);
    }

    noinline fn memcpy(
        noalias dest: [*]u8,
        noalias source: [*]const u8,
        byte_count: usize,
    ) callconv(.C) void {
        @memcpy(dest[0..byte_count], source[0..byte_count]);
    }

    pub fn define(state: *TCC.State) void {
        if (comptime Environment.isX64) {
            state.defineSymbol("NEEDS_COMPILER_RT_FUNCTIONS", "1");
            state.compileString(@embedFile(("libtcc1.c"))) catch {
                if (bun.Environment.isDebug) {
                    @panic("Failed to compile libtcc1.c");
                }
            };
        }

        const Sizes = @import("../bindings/sizes.zig");
        const offsets = Offsets.get();
        state.defineSymbolsComptime(.{
            .Bun_FFI_PointerOffsetToArgumentsList = Sizes.Bun_FFI_PointerOffsetToArgumentsList,
            .JSArrayBufferView__offsetOfLength = offsets.JSArrayBufferView__offsetOfLength,
            .JSArrayBufferView__offsetOfVector = offsets.JSArrayBufferView__offsetOfVector,
            .JSCell__offsetOfType = offsets.JSCell__offsetOfType,
            .JSTypeArrayBufferViewMin = @intFromEnum(JSC.JSValue.JSType.min_typed_array),
            .JSTypeArrayBufferViewMax = @intFromEnum(JSC.JSValue.JSType.max_typed_array),
        });
    }

    pub fn inject(state: *TCC.State) void {
        state.addSymbol("memset", &memset) catch unreachable;
        state.addSymbol("memcpy", &memcpy) catch unreachable;
        state.addSymbol("NapiHandleScope__open", &bun.api.napi.NapiHandleScope.NapiHandleScope__open) catch unreachable;
        state.addSymbol("NapiHandleScope__close", &bun.api.napi.NapiHandleScope.NapiHandleScope__close) catch unreachable;

        state.addSymbol("JSVALUE_TO_INT64_SLOW", workaround.JSVALUE_TO_INT64) catch unreachable;
        state.addSymbol("JSVALUE_TO_UINT64_SLOW", workaround.JSVALUE_TO_UINT64) catch unreachable;
        state.addSymbol("INT64_TO_JSVALUE_SLOW", workaround.INT64_TO_JSVALUE) catch unreachable;
        state.addSymbol("UINT64_TO_JSVALUE_SLOW", workaround.UINT64_TO_JSVALUE) catch unreachable;
    }
};

pub const Bun__FFI__cc = FFI.Bun__FFI__cc;

fn makeNapiEnvIfNeeded(functions: []const FFI.Function, globalThis: *JSGlobalObject) ?*napi.NapiEnv {
    for (functions) |function| {
        if (function.needsNapiEnv()) {
            return globalThis.makeNapiEnvForFFI();
        }
    }

    return null;
}
