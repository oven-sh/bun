const Bun = @This();
const root = @import("root");
const default_allocator = bun.default_allocator;
const bun = @import("root").bun;
const Environment = bun.Environment;

const Global = bun.Global;
const strings = bun.strings;
const string = bun.string;
const Output = bun.Output;
const debug = Output.scoped(.TCC, false);
const MutableString = bun.MutableString;
const std = @import("std");
const Allocator = std.mem.Allocator;
const IdentityContext = @import("../../identity_context.zig").IdentityContext;
const Fs = @import("../../fs.zig");
const Resolver = @import("../../resolver/resolver.zig");
const ast = @import("../../import_record.zig");

const MacroEntryPoint = bun.transpiler.MacroEntryPoint;
const logger = bun.logger;
const Api = @import("../../api/schema.zig").Api;
const options = @import("../../options.zig");
const Transpiler = bun.Transpiler;
const ServerEntryPoint = bun.transpiler.ServerEntryPoint;
const js_printer = bun.js_printer;
const js_parser = bun.js_parser;
const js_ast = bun.JSAst;
const NodeFallbackModules = @import("../../node_fallbacks.zig");
const ImportKind = ast.ImportKind;
const Analytics = @import("../../analytics/analytics_thread.zig");
const ZigString = bun.JSC.ZigString;
const Runtime = @import("../../runtime.zig");
const ImportRecord = ast.ImportRecord;
const DotEnv = @import("../../env_loader.zig");
const ParseResult = bun.transpiler.ParseResult;
const PackageJSON = @import("../../resolver/package_json.zig").PackageJSON;
const MacroRemap = @import("../../resolver/package_json.zig").MacroMap;
const WebCore = bun.JSC.WebCore;
const Request = WebCore.Request;
const Response = WebCore.Response;
const Headers = WebCore.Headers;
const Fetch = WebCore.Fetch;
const FetchEvent = WebCore.FetchEvent;
const js = bun.JSC.C;
const JSC = bun.JSC;
const JSError = @import("../base.zig").JSError;

const MarkedArrayBuffer = @import("../base.zig").MarkedArrayBuffer;
const getAllocator = @import("../base.zig").getAllocator;
const JSValue = bun.JSC.JSValue;

const JSGlobalObject = bun.JSC.JSGlobalObject;
const ExceptionValueRef = bun.JSC.ExceptionValueRef;
const JSPrivateDataPtr = bun.JSC.JSPrivateDataPtr;
const ConsoleObject = bun.JSC.ConsoleObject;
const Node = bun.JSC.Node;
const ZigException = bun.JSC.ZigException;
const ZigStackTrace = bun.JSC.ZigStackTrace;
const ErrorableResolvedSource = bun.JSC.ErrorableResolvedSource;
const ResolvedSource = bun.JSC.ResolvedSource;
const JSPromise = bun.JSC.JSPromise;
const JSInternalPromise = bun.JSC.JSInternalPromise;
const JSModuleLoader = bun.JSC.JSModuleLoader;
const JSPromiseRejectionOperation = bun.JSC.JSPromiseRejectionOperation;
const ErrorableZigString = bun.JSC.ErrorableZigString;
const ZigGlobalObject = bun.JSC.ZigGlobalObject;
const VM = bun.JSC.VM;
const JSFunction = bun.JSC.JSFunction;
const Config = @import("../config.zig");
const URL = @import("../../url.zig").URL;
const VirtualMachine = JSC.VirtualMachine;
const IOTask = JSC.IOTask;

const TCC = @import("../../tcc.zig");
extern fn pthread_jit_write_protect_np(enable: bool) callconv(.C) void;

const Offsets = extern struct {
    JSArrayBufferView__offsetOfLength: u32,
    JSArrayBufferView__offsetOfByteOffset: u32,
    JSArrayBufferView__offsetOfVector: u32,
    JSCell__offsetOfType: u32,

    extern "C" var Bun__FFI__offsets: Offsets;
    extern "C" fn Bun__FFI__ensureOffsetsAreLoaded() void;
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
    dylib: ?std.DynLib = null,
    relocated_bytes_to_free: ?[]u8 = null,
    functions: bun.StringArrayHashMapUnmanaged(Function) = .{},
    closed: bool = false,
    shared_state: ?*TCC.TCCState = null,

    pub usingnamespace JSC.Codegen.JSFFI;

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

            pub fn add(this: *Source, state: *TCC.TCCState, current_file_for_errors: *[:0]const u8) !void {
                switch (this.*) {
                    .file => {
                        current_file_for_errors.* = this.file;
                        if (TCC.tcc_add_file(state, this.file) != 0) {
                            return error.CompilationError;
                        }
                        current_file_for_errors.* = "";
                    },
                    .files => {
                        for (this.files.items) |file| {
                            current_file_for_errors.* = file;
                            if (TCC.tcc_add_file(state, file) != 0) {
                                return error.CompilationError;
                            }
                            current_file_for_errors.* = "";
                        }
                    },
                }
            }
        };

        const stdarg = struct {
            extern "C" fn ffi_vfprintf(*anyopaque, [*:0]const u8, ...) callconv(.C) c_int;
            extern "C" fn ffi_vprintf([*:0]const u8, ...) callconv(.C) c_int;
            extern "C" fn ffi_fprintf(*anyopaque, [*:0]const u8, ...) callconv(.C) c_int;
            extern "C" fn ffi_printf([*:0]const u8, ...) callconv(.C) c_int;
            extern "C" fn ffi_fscanf(*anyopaque, [*:0]const u8, ...) callconv(.C) c_int;
            extern "C" fn ffi_scanf([*:0]const u8, ...) callconv(.C) c_int;
            extern "C" fn ffi_sscanf([*:0]const u8, [*:0]const u8, ...) callconv(.C) c_int;
            extern "C" fn ffi_vsscanf([*:0]const u8, [*:0]const u8, ...) callconv(.C) c_int;
            extern "C" fn ffi_fopen([*:0]const u8, [*:0]const u8) callconv(.C) *anyopaque;
            extern "C" fn ffi_fclose(*anyopaque) callconv(.C) c_int;
            extern "C" fn ffi_fgetc(*anyopaque) callconv(.C) c_int;
            extern "C" fn ffi_fputc(c: c_int, *anyopaque) callconv(.C) c_int;
            extern "C" fn ffi_feof(*anyopaque) callconv(.C) c_int;
            extern "C" fn ffi_fileno(*anyopaque) callconv(.C) c_int;
            extern "C" fn ffi_ungetc(c: c_int, *anyopaque) callconv(.C) c_int;
            extern "C" fn ffi_ftell(*anyopaque) callconv(.C) c_long;
            extern "C" fn ffi_fseek(*anyopaque, c_long, c_int) callconv(.C) c_int;
            extern "C" fn ffi_fflush(*anyopaque) callconv(.C) c_int;

            extern "C" fn calloc(nmemb: usize, size: usize) callconv(.C) ?*anyopaque;
            extern "C" fn perror([*:0]const u8) callconv(.C) void;

            const mac = if (Environment.isMac) struct {
                var ffi_stdinp: *anyopaque = @extern(*anyopaque, .{ .name = "__stdinp" });
                var ffi_stdoutp: *anyopaque = @extern(*anyopaque, .{ .name = "__stdoutp" });
                var ffi_stderrp: *anyopaque = @extern(*anyopaque, .{ .name = "__stderrp" });

                pub fn inject(state: *TCC.TCCState) void {
                    _ = TCC.tcc_add_symbol(state, "__stdinp", ffi_stdinp);
                    _ = TCC.tcc_add_symbol(state, "__stdoutp", ffi_stdoutp);
                    _ = TCC.tcc_add_symbol(state, "__stderrp", ffi_stderrp);
                }
            } else struct {
                pub fn inject(_: *TCC.TCCState) void {}
            };

            pub fn inject(state: *TCC.TCCState) void {
                _ = TCC.tcc_add_symbol(state, "vfprintf", ffi_vfprintf);
                _ = TCC.tcc_add_symbol(state, "vprintf", ffi_vprintf);
                _ = TCC.tcc_add_symbol(state, "fprintf", ffi_fprintf);
                _ = TCC.tcc_add_symbol(state, "printf", ffi_printf);
                _ = TCC.tcc_add_symbol(state, "fscanf", ffi_fscanf);
                _ = TCC.tcc_add_symbol(state, "scanf", ffi_scanf);
                _ = TCC.tcc_add_symbol(state, "sscanf", ffi_sscanf);
                _ = TCC.tcc_add_symbol(state, "vsscanf", ffi_vsscanf);

                _ = TCC.tcc_add_symbol(state, "fopen", ffi_fopen);
                _ = TCC.tcc_add_symbol(state, "fclose", ffi_fclose);
                _ = TCC.tcc_add_symbol(state, "fgetc", ffi_fgetc);
                _ = TCC.tcc_add_symbol(state, "fputc", ffi_fputc);
                _ = TCC.tcc_add_symbol(state, "feof", ffi_feof);
                _ = TCC.tcc_add_symbol(state, "fileno", ffi_fileno);
                _ = TCC.tcc_add_symbol(state, "fwrite", std.c.fwrite);
                _ = TCC.tcc_add_symbol(state, "ungetc", ffi_ungetc);
                _ = TCC.tcc_add_symbol(state, "ftell", ffi_ftell);
                _ = TCC.tcc_add_symbol(state, "fseek", ffi_fseek);
                _ = TCC.tcc_add_symbol(state, "fflush", ffi_fflush);
                _ = TCC.tcc_add_symbol(state, "malloc", std.c.malloc);
                _ = TCC.tcc_add_symbol(state, "free", std.c.free);
                _ = TCC.tcc_add_symbol(state, "fread", std.c.fread);
                _ = TCC.tcc_add_symbol(state, "realloc", std.c.realloc);
                _ = TCC.tcc_add_symbol(state, "calloc", calloc);
                _ = TCC.tcc_add_symbol(state, "perror", perror);

                if (Environment.isPosix) {
                    _ = TCC.tcc_add_symbol(state, "posix_memalign", std.c.posix_memalign);
                    _ = TCC.tcc_add_symbol(state, "dlopen", std.c.dlopen);
                    _ = TCC.tcc_add_symbol(state, "dlclose", std.c.dlclose);
                    _ = TCC.tcc_add_symbol(state, "dlsym", std.c.dlsym);
                    _ = TCC.tcc_add_symbol(state, "dlerror", std.c.dlerror);
                }

                mac.inject(state);
            }
        };

        pub fn handleCompilationError(this: *CompileC, message: ?[*:0]const u8) callconv(.C) void {
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
                    .envp = std.c.environ,
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
                    if (bun.sys.directoryExistsAt(std.fs.cwd(), "/usr/include/x86_64-linux-gnu").isTrue()) {
                        cached_default_system_include_dir = "/usr/include/x86_64-linux-gnu";
                    } else if (bun.sys.directoryExistsAt(std.fs.cwd(), "/usr/include").isTrue()) {
                        cached_default_system_include_dir = "/usr/include";
                    }

                    if (bun.sys.directoryExistsAt(std.fs.cwd(), "/usr/lib/x86_64-linux-gnu").isTrue()) {
                        cached_default_system_library_dir = "/usr/lib/x86_64-linux-gnu";
                    } else if (bun.sys.directoryExistsAt(std.fs.cwd(), "/usr/lib64").isTrue()) {
                        cached_default_system_library_dir = "/usr/lib64";
                    }
                } else if (Environment.isAarch64) {
                    if (bun.sys.directoryExistsAt(std.fs.cwd(), "/usr/include/aarch64-linux-gnu").isTrue()) {
                        cached_default_system_include_dir = "/usr/include/aarch64-linux-gnu";
                    } else if (bun.sys.directoryExistsAt(std.fs.cwd(), "/usr/include").isTrue()) {
                        cached_default_system_include_dir = "/usr/include";
                    }

                    if (bun.sys.directoryExistsAt(std.fs.cwd(), "/usr/lib/aarch64-linux-gnu").isTrue()) {
                        cached_default_system_library_dir = "/usr/lib/aarch64-linux-gnu";
                    } else if (bun.sys.directoryExistsAt(std.fs.cwd(), "/usr/lib64").isTrue()) {
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

        pub fn compile(this: *CompileC, globalThis: *JSGlobalObject) !struct { *TCC.TCCState, []u8 } {
            const state = TCC.tcc_new() orelse {
                return globalThis.throw("TinyCC failed to initialize", .{});
            };
            TCC.tcc_set_error_func(state, this, @ptrCast(&handleCompilationError));
            if (this.flags.len > 0) {
                TCC.tcc_set_options(state, this.flags.ptr);
            } else if (bun.getenvZ("BUN_TCC_OPTIONS")) |tcc_options| {
                TCC.tcc_set_options(state, @ptrCast(tcc_options));
            } else {
                TCC.tcc_set_options(state, default_tcc_options);
            }
            _ = TCC.tcc_set_output_type(state, TCC.TCC_OUTPUT_MEMORY);
            errdefer TCC.tcc_delete(state);

            var pathbuf: [bun.MAX_PATH_BYTES]u8 = undefined;

            if (CompilerRT.dir()) |compiler_rt_dir| {
                if (TCC.tcc_add_sysinclude_path(state, compiler_rt_dir) == -1) {
                    debug("TinyCC failed to add sysinclude path", .{});
                }
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
                            if (TCC.tcc_add_sysinclude_path(state, include_dir.ptr) == -1) {
                                return globalThis.throw("TinyCC failed to add sysinclude path", .{});
                            }

                            const lib_dir = bun.path.joinAbsStringBufZ(sdkroot, &pathbuf, &.{ "usr", "lib" }, .auto);
                            if (TCC.tcc_add_library_path(state, lib_dir.ptr) == -1) {
                                return globalThis.throw("TinyCC failed to add library path", .{});
                            }
                            break :add_system_include_dir;
                        }
                    }
                }

                if (Environment.isAarch64) {
                    if (bun.sys.directoryExistsAt(std.fs.cwd(), "/opt/homebrew/include").isTrue()) {
                        if (TCC.tcc_add_include_path(state, "/opt/homebrew/include") == -1) {
                            debug("TinyCC failed to add library path", .{});
                        }
                    }

                    if (bun.sys.directoryExistsAt(std.fs.cwd(), "/opt/homebrew/lib").isTrue()) {
                        if (TCC.tcc_add_library_path(state, "/opt/homebrew/lib") == -1) {
                            debug("TinyCC failed to add library path", .{});
                        }
                    }
                }
            } else if (Environment.isLinux) {
                if (getSystemIncludeDir()) |include_dir| {
                    if (TCC.tcc_add_sysinclude_path(state, include_dir) == -1) {
                        debug("TinyCC failed to add library path", .{});
                    }
                }

                if (getSystemLibraryDir()) |library_dir| {
                    if (TCC.tcc_add_library_path(state, library_dir) == -1) {
                        debug("TinyCC failed to add library path", .{});
                    }
                }
            }

            if (Environment.isPosix) {
                if (bun.sys.directoryExistsAt(std.fs.cwd(), "/usr/local/include").isTrue()) {
                    if (TCC.tcc_add_sysinclude_path(state, "/usr/local/include") == -1) {
                        debug("TinyCC failed to add library path", .{});
                    }
                }

                if (bun.sys.directoryExistsAt(std.fs.cwd(), "/usr/local/lib").isTrue()) {
                    if (TCC.tcc_add_library_path(state, "/usr/local/lib") == -1) {
                        debug("TinyCC failed to add library path", .{});
                    }
                }
            }

            if (this.deferred_errors.items.len > 0) {
                return error.DeferredErrors;
            }

            for (this.include_dirs.items) |include_dir| {
                if (TCC.tcc_add_include_path(state, include_dir) == -1) {}

                if (this.deferred_errors.items.len > 0) {
                    return error.DeferredErrors;
                }
            }

            if (this.deferred_errors.items.len > 0) {
                return error.DeferredErrors;
            }

            CompilerRT.define(state);

            if (this.deferred_errors.items.len > 0) {
                return error.DeferredErrors;
            }

            for (this.symbols.map.values()) |*symbol| {
                if (symbol.needsNapiEnv()) {
                    _ = TCC.tcc_add_symbol(state, "Bun__thisFFIModuleNapiEnv", globalThis);
                    break;
                }
            }

            for (this.define.items) |define| {
                TCC.tcc_define_symbol(state, define[0], define[1]);

                if (this.deferred_errors.items.len > 0) {
                    return error.DeferredErrors;
                }
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

            if (this.deferred_errors.items.len > 0) {
                return error.DeferredErrors;
            }

            for (this.library_dirs.items) |library_dir| {
                if (TCC.tcc_add_library_path(state, library_dir) == -1) {}
            }

            if (this.deferred_errors.items.len > 0) {
                return error.DeferredErrors;
            }

            for (this.libraries.items) |library| {
                _ = TCC.tcc_add_library(state, library);

                if (this.deferred_errors.items.len > 0) {
                    break;
                }
            }

            if (this.deferred_errors.items.len > 0) {
                return error.DeferredErrors;
            }

            const relocation_size = TCC.tcc_relocate(state, null);
            if (this.deferred_errors.items.len > 0) {
                return error.DeferredErrors;
            }

            if (relocation_size < 0) {
                return globalThis.throw("Unexpected: tcc_relocate returned a negative value", .{});
            }

            const bytes: []u8 = try bun.default_allocator.alloc(u8, @as(usize, @intCast(relocation_size)));
            // We cannot free these bytes, evidently.

            if (comptime Environment.isAarch64 and Environment.isMac) {
                pthread_jit_write_protect_np(false);
            }
            _ = TCC.tcc_relocate(state, bytes.ptr);
            if (comptime Environment.isAarch64 and Environment.isMac) {
                pthread_jit_write_protect_np(true);
            }

            if (this.deferred_errors.items.len > 0) {
                return error.DeferredErrors;
            }

            for (this.symbols.map.keys(), this.symbols.map.values()) |symbol, *function| {
                const duped = bun.default_allocator.dupeZ(u8, symbol) catch bun.outOfMemory();
                defer bun.default_allocator.free(duped);
                if (TCC.tcc_get_symbol(state, duped)) |function_ptr| {
                    function.symbol_from_dynamic_library = function_ptr;
                } else {
                    return globalThis.throw("{} is missing from {s}. Was it included in the source code?", .{ bun.fmt.quote(symbol), this.source.first() });
                }
            }

            if (this.deferred_errors.items.len > 0) {
                return error.DeferredErrors;
            }

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
            var iter = value.arrayIterator(globalThis);
            var items = std.ArrayList([:0]const u8).init(bun.default_allocator);

            while (iter.next()) |val| {
                if (!val.isString()) {
                    for (items.items) |item| {
                        bun.default_allocator.free(@constCast(item));
                    }
                    items.deinit();
                    return globalThis.throwInvalidArgumentTypeValue(property, "array of strings", val);
                }
                const str = val.getZigString(globalThis);
                if (str.isEmpty()) continue;
                items.append(str.toOwnedSliceZ(bun.default_allocator) catch bun.outOfMemory()) catch bun.outOfMemory();
            }

            return .{ .items = items.items };
        }

        pub fn fromJSString(globalThis: *JSC.JSGlobalObject, value: JSC.JSValue, comptime property: []const u8) bun.JSError!StringArray {
            if (value == .undefined) return .{};
            if (!value.isString()) {
                return globalThis.throwInvalidArgumentTypeValue(property, "array of strings", value);
            }
            const str = value.getZigString(globalThis);
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

        // Step 1. compile the user's code

        const object = arguments[0];

        var compile_c = CompileC{};
        defer {
            if (globalThis.hasException()) {
                compile_c.deinit();
            }
        }

        const symbols_object = object.getOwn(globalThis, "symbols") orelse .undefined;
        if (!globalThis.hasException() and (symbols_object == .zero or !symbols_object.isObject())) {
            return globalThis.throwInvalidArgumentTypeValue("symbols", "object", symbols_object);
        }

        if (globalThis.hasException()) {
            return error.JSError;
        }

        if (try generateSymbols(globalThis, &compile_c.symbols.map, symbols_object)) |val| {
            if (val != .zero and !globalThis.hasException())
                return globalThis.throwValue(val);
            return error.JSError;
        }

        if (compile_c.symbols.map.count() == 0) {
            return globalThis.throw("Expected at least one exported symbol", .{});
        }

        if (object.getOwn(globalThis, "library")) |library_value| {
            compile_c.libraries = try StringArray.fromJS(globalThis, library_value, "library");
        }

        if (globalThis.hasException()) {
            return error.JSError;
        }

        if (try object.getTruthy(globalThis, "flags")) |flags_value| {
            if (flags_value.isArray()) {
                var iter = flags_value.arrayIterator(globalThis);

                var flags = std.ArrayList(u8).init(bun.default_allocator);
                defer flags.deinit();
                flags.appendSlice(CompileC.default_tcc_options) catch bun.outOfMemory();

                while (iter.next()) |value| {
                    if (!value.isString()) {
                        return globalThis.throwInvalidArgumentTypeValue("flags", "array of strings", value);
                    }
                    const slice = try value.toSlice(globalThis, bun.default_allocator);
                    if (slice.len == 0) continue;
                    defer slice.deinit();
                    flags.append(' ') catch bun.outOfMemory();
                    flags.appendSlice(slice.slice()) catch bun.outOfMemory();
                }
                flags.append(0) catch bun.outOfMemory();
                compile_c.flags = flags.items[0 .. flags.items.len - 1 :0];
                flags = std.ArrayList(u8).init(bun.default_allocator);
            } else {
                if (!flags_value.isString()) {
                    return globalThis.throwInvalidArgumentTypeValue("flags", "string", flags_value);
                }

                const str = flags_value.getZigString(globalThis);
                if (!str.isEmpty()) {
                    compile_c.flags = str.toOwnedSliceZ(bun.default_allocator) catch bun.outOfMemory();
                }
            }
        }

        if (globalThis.hasException()) {
            return error.JSError;
        }

        if (try object.getTruthy(globalThis, "define")) |define_value| {
            if (define_value.isObject()) {
                const Iter = JSC.JSPropertyIterator(.{ .include_value = true, .skip_empty_name = true });
                var iter = try Iter.init(globalThis, define_value);
                defer iter.deinit();
                while (try iter.next()) |entry| {
                    const key = entry.toOwnedSliceZ(bun.default_allocator) catch bun.outOfMemory();
                    var owned_value: [:0]const u8 = "";
                    if (iter.value != .zero and iter.value != .undefined) {
                        if (iter.value.isString()) {
                            const value = iter.value.getZigString(globalThis);
                            if (value.len > 0) {
                                owned_value = value.toOwnedSliceZ(bun.default_allocator) catch bun.outOfMemory();
                            }
                        }
                    }
                    if (globalThis.hasException()) {
                        bun.default_allocator.free(key);
                        return error.JSError;
                    }

                    compile_c.define.append(bun.default_allocator, .{ key, owned_value }) catch bun.outOfMemory();
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

        if (object.getOwn(globalThis, "source")) |source_value| {
            if (source_value.isArray()) {
                compile_c.source = .{ .files = .{} };
                var iter = source_value.arrayIterator(globalThis);
                while (iter.next()) |value| {
                    if (!value.isString()) {
                        return globalThis.throwInvalidArgumentTypeValue("source", "array of strings", value);
                    }
                    compile_c.source.files.append(bun.default_allocator, value.getZigString(globalThis).toOwnedSliceZ(bun.default_allocator) catch bun.outOfMemory()) catch bun.outOfMemory();
                }
            } else if (!source_value.isString()) {
                return globalThis.throwInvalidArgumentTypeValue("source", "string", source_value);
            } else {
                const source_path = source_value.getZigString(globalThis).toOwnedSliceZ(bun.default_allocator) catch bun.outOfMemory();
                compile_c.source.file = source_path;
            }
        }

        if (globalThis.hasException()) {
            return error.JSError;
        }

        // Now we compile the code with tinycc.
        var tcc_state: ?*TCC.TCCState, var bytes_to_free_on_error = compile_c.compile(globalThis) catch |err| {
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
            if (tcc_state) |state| {
                TCC.tcc_delete(state);
            }

            // TODO: upgrade tinycc because they improved the way memory management works for this
            // we are unable to free memory safely in certain cases here.
        }

        var obj = JSC.JSValue.createEmptyObject(globalThis, compile_c.symbols.map.count());
        for (compile_c.symbols.map.values()) |*function| {
            const function_name = function.base_name.?;
            const allocator = bun.default_allocator;

            function.compile(allocator, globalThis) catch |err| {
                if (!globalThis.hasException()) {
                    const ret = JSC.toInvalidArguments("{s} when translating symbol \"{s}\"", .{
                        @errorName(err),
                        function_name,
                    }, globalThis);
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
                    const cb = JSC.NewRuntimeFunction(
                        globalThis,
                        &str,
                        @as(u32, @intCast(function.arg_types.items.len)),
                        bun.cast(JSC.JSHostFunctionPtr, compiled.ptr),
                        false,
                        true,
                        function.symbol_from_dynamic_library,
                    );
                    compiled.js_function = cb;
                    obj.put(globalThis, &str, cb);
                },
            }
        }

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
        var function = ctx.asPtr(Function);
        function.deinit(globalThis, bun.default_allocator);
        return JSValue.jsUndefined();
    }

    pub fn callback(globalThis: *JSGlobalObject, interface: JSC.JSValue, js_callback: JSC.JSValue) JSValue {
        JSC.markBinding(@src());
        if (!interface.isObject()) {
            return JSC.toInvalidArguments("Expected object", .{}, globalThis);
        }

        if (js_callback.isEmptyOrUndefinedOrNull() or !js_callback.isCallable(globalThis.vm())) {
            return JSC.toInvalidArguments("Expected callback function", .{}, globalThis);
        }

        const allocator = VirtualMachine.get().allocator;
        var function: Function = .{};
        var func = &function;

        if (generateSymbolForFunction(globalThis, allocator, interface, func) catch ZigString.init("Out of memory").toErrorInstance(globalThis)) |val| {
            return val;
        }

        // TODO: WeakRefHandle that automatically frees it?
        func.base_name = "";
        js_callback.ensureStillAlive();

        func.compileCallback(allocator, globalThis, js_callback, func.threadsafe) catch return ZigString.init("Out of memory").toErrorInstance(globalThis);
        switch (func.step) {
            .failed => |err| {
                const message = ZigString.init(err.msg).toErrorInstance(globalThis);

                func.deinit(globalThis, allocator);

                return message;
            },
            .pending => {
                func.deinit(globalThis, allocator);
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
            return .undefined;
        }
        this.closed = true;
        if (this.dylib) |*dylib| {
            dylib.close();
            this.dylib = null;
        }

        if (this.shared_state) |state| {
            this.shared_state = null;
            TCC.tcc_delete(state);
        }

        const allocator = VirtualMachine.get().allocator;

        for (this.functions.values()) |*val| {
            val.deinit(globalThis, allocator);
        }
        this.functions.deinit(allocator);
        if (this.relocated_bytes_to_free) |relocated_bytes_to_free| {
            this.relocated_bytes_to_free = null;
            bun.default_allocator.free(relocated_bytes_to_free);
        }

        return .undefined;
    }

    pub fn printCallback(global: *JSGlobalObject, object: JSC.JSValue) JSValue {
        JSC.markBinding(@src());
        const allocator = VirtualMachine.get().allocator;

        if (object.isEmptyOrUndefinedOrNull() or !object.isObject()) {
            return JSC.toInvalidArguments("Expected an object", .{}, global);
        }

        var function: Function = .{};
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

    pub fn print(global: *JSGlobalObject, object: JSC.JSValue, is_callback_val: ?JSC.JSValue) JSValue {
        const allocator = VirtualMachine.get().allocator;
        if (is_callback_val) |is_callback| {
            if (is_callback.toBoolean()) {
                return printCallback(global, object);
            }
        }

        if (object.isEmptyOrUndefinedOrNull() or !object.isObject()) {
            return JSC.toInvalidArguments("Expected an options object with symbol names", .{}, global);
        }

        var symbols = bun.StringArrayHashMapUnmanaged(Function){};
        if (generateSymbols(global, &symbols, object) catch JSC.JSValue.zero) |val| {
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

        const ret = bun.String.toJSArray(global, strs.items);

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

    // pub fn dlcompile(global: *JSGlobalObject, object: JSC.JSValue) JSValue {
    //     const allocator = VirtualMachine.get().allocator;

    //     if (object.isEmptyOrUndefinedOrNull() or !object.isObject()) {
    //         return JSC.toInvalidArguments("Expected an options object with symbol names", .{}, global);
    //     }

    //     var symbols = bun.StringArrayHashMapUnmanaged(Function){};
    //     if (generateSymbols(global, &symbols, object) catch JSC.JSValue.zero) |val| {
    //         // an error while validating symbols
    //         for (symbols.keys()) |key| {
    //             allocator.free(@constCast(key));
    //         }
    //         symbols.clearAndFree(allocator);
    //         return val;
    //     }

    // }

    pub fn open(global: *JSGlobalObject, name_str: ZigString, object: JSC.JSValue) JSC.JSValue {
        JSC.markBinding(@src());
        const vm = VirtualMachine.get();
        const allocator = bun.default_allocator;
        var name_slice = name_str.toSlice(allocator);
        defer name_slice.deinit();

        if (object.isEmptyOrUndefinedOrNull() or !object.isObject()) {
            return JSC.toInvalidArguments("Expected an options object with symbol names", .{}, global);
        }

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
            return JSC.toInvalidArguments("Invalid library name", .{}, global);
        }

        var symbols = bun.StringArrayHashMapUnmanaged(Function){};
        if (generateSymbols(global, &symbols, object) catch JSC.JSValue.zero) |val| {
            // an error while validating symbols
            for (symbols.keys()) |key| {
                allocator.free(@constCast(key));
            }
            symbols.clearAndFree(allocator);
            return val;
        }
        if (symbols.count() == 0) {
            return JSC.toInvalidArguments("Expected at least one symbol", .{}, global);
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
        for (symbols.values()) |*function| {
            const function_name = function.base_name.?;

            // optional if the user passed "ptr"
            if (function.symbol_from_dynamic_library == null) {
                const resolved_symbol = dylib.lookup(*anyopaque, function_name) orelse {
                    const ret = JSC.toInvalidArguments("Symbol \"{s}\" not found in \"{s}\"", .{ bun.asByteSlice(function_name), name }, global);
                    for (symbols.values()) |*value| {
                        allocator.free(@constCast(bun.asByteSlice(value.base_name.?)));
                        value.arg_types.clearAndFree(allocator);
                    }
                    symbols.clearAndFree(allocator);
                    dylib.close();
                    return ret;
                };

                function.symbol_from_dynamic_library = resolved_symbol;
            }

            function.compile(allocator, global) catch |err| {
                const ret = JSC.toInvalidArguments("{s} when compiling symbol \"{s}\" in \"{s}\"", .{
                    bun.asByteSlice(@errorName(err)),
                    bun.asByteSlice(function_name),
                    name,
                }, global);
                for (symbols.values()) |*value| {
                    allocator.free(@constCast(bun.asByteSlice(value.base_name.?)));
                    value.arg_types.clearAndFree(allocator);
                }
                symbols.clearAndFree(allocator);
                dylib.close();
                return ret;
            };
            switch (function.step) {
                .failed => |err| {
                    for (symbols.values()) |*value| {
                        allocator.free(@constCast(bun.asByteSlice(value.base_name.?)));
                        value.arg_types.clearAndFree(allocator);
                    }

                    const res = ZigString.init(err.msg).toErrorInstance(global);
                    function.deinit(global, allocator);
                    symbols.clearAndFree(allocator);
                    dylib.close();
                    return res;
                },
                .pending => {
                    for (symbols.values()) |*value| {
                        allocator.free(@constCast(bun.asByteSlice(value.base_name.?)));
                        value.arg_types.clearAndFree(allocator);
                    }
                    symbols.clearAndFree(allocator);
                    dylib.close();
                    return ZigString.init("Failed to compile (nothing happend!)").toErrorInstance(global);
                },
                .compiled => |*compiled| {
                    const str = ZigString.init(bun.asByteSlice(function_name));
                    const cb = JSC.NewRuntimeFunction(
                        global,
                        &str,
                        @as(u32, @intCast(function.arg_types.items.len)),
                        bun.cast(JSC.JSHostFunctionPtr, compiled.ptr),
                        false,
                        true,
                        function.symbol_from_dynamic_library,
                    );
                    compiled.js_function = cb;
                    obj.put(global, &str, cb);
                },
            }
        }

        var lib = allocator.create(FFI) catch unreachable;
        lib.* = .{
            .dylib = dylib,
            .functions = symbols,
        };

        const js_object = lib.toJS(global);
        JSC.Codegen.JSFFI.symbolsValueSetCached(js_object, global, obj);
        return js_object;
    }

    pub fn getSymbols(_: *FFI, _: *JSC.JSGlobalObject) JSC.JSValue {
        // This shouldn't be called. The cachedValue is what should be called.
        return .undefined;
    }

    pub fn linkSymbols(global: *JSGlobalObject, object: JSC.JSValue) JSC.JSValue {
        JSC.markBinding(@src());
        const allocator = VirtualMachine.get().allocator;

        if (object.isEmptyOrUndefinedOrNull() or !object.isObject()) {
            return JSC.toInvalidArguments("Expected an options object with symbol names", .{}, global);
        }

        var symbols = bun.StringArrayHashMapUnmanaged(Function){};
        if (generateSymbols(global, &symbols, object) catch JSC.JSValue.zero) |val| {
            // an error while validating symbols
            for (symbols.keys()) |key| {
                allocator.free(@constCast(key));
            }
            symbols.clearAndFree(allocator);
            return val;
        }
        if (symbols.count() == 0) {
            return JSC.toInvalidArguments("Expected at least one symbol", .{}, global);
        }

        var obj = JSValue.createEmptyObject(global, symbols.count());
        obj.ensureStillAlive();
        defer obj.ensureStillAlive();
        for (symbols.values()) |*function| {
            const function_name = function.base_name.?;

            if (function.symbol_from_dynamic_library == null) {
                const ret = JSC.toInvalidArguments("Symbol for \"{s}\" not found", .{bun.asByteSlice(function_name)}, global);
                for (symbols.values()) |*value| {
                    allocator.free(@constCast(bun.asByteSlice(value.base_name.?)));
                    value.arg_types.clearAndFree(allocator);
                }
                symbols.clearAndFree(allocator);
                return ret;
            }

            function.compile(allocator, global) catch |err| {
                const ret = JSC.toInvalidArguments("{s} when compiling symbol \"{s}\"", .{
                    bun.asByteSlice(@errorName(err)),
                    bun.asByteSlice(function_name),
                }, global);
                for (symbols.values()) |*value| {
                    allocator.free(@constCast(bun.asByteSlice(value.base_name.?)));
                    value.arg_types.clearAndFree(allocator);
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
                    function.deinit(global, allocator);
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

                    const cb = JSC.NewRuntimeFunction(
                        global,
                        name,
                        @as(u32, @intCast(function.arg_types.items.len)),
                        bun.cast(JSC.JSHostFunctionPtr, compiled.ptr),
                        false,
                        true,
                        function.symbol_from_dynamic_library,
                    );
                    compiled.js_function = cb;

                    obj.put(global, name, cb);
                },
            }
        }

        var lib = allocator.create(FFI) catch unreachable;
        lib.* = .{
            .dylib = null,
            .functions = symbols,
        };

        const js_object = lib.toJS(global);
        JSC.Codegen.JSFFI.symbolsValueSetCached(js_object, global, obj);
        return js_object;
    }
    pub fn generateSymbolForFunction(global: *JSGlobalObject, allocator: std.mem.Allocator, value: JSC.JSValue, function: *Function) bun.JSError!?JSValue {
        JSC.markBinding(@src());

        var abi_types = std.ArrayListUnmanaged(ABIType){};

        if (value.getOwn(global, "args")) |args| {
            if (args.isEmptyOrUndefinedOrNull() or !args.jsType().isArray()) {
                return ZigString.static("Expected an object with \"args\" as an array").toErrorInstance(global);
            }

            var array = args.arrayIterator(global);

            try abi_types.ensureTotalCapacityPrecise(allocator, array.len);
            while (array.next()) |val| {
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
                    return JSC.toTypeError(.ERR_INVALID_ARG_VALUE, "Unknown type {s}", .{type_name.slice()}, global);
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
                return JSC.toTypeError(.ERR_INVALID_ARG_VALUE, "Unknown return type {s}", .{ret_slice.slice()}, global);
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

    pub fn generateSymbols(global: *JSGlobalObject, symbols: *bun.StringArrayHashMapUnmanaged(Function), object: JSC.JSValue) bun.JSError!?JSValue {
        JSC.markBinding(@src());
        const allocator = VirtualMachine.get().allocator;

        var symbols_iter = try JSC.JSPropertyIterator(.{
            .skip_empty_name = true,

            .include_value = true,
        }).init(global, object);
        defer symbols_iter.deinit();

        try symbols.ensureTotalCapacity(allocator, symbols_iter.len);

        while (try symbols_iter.next()) |prop| {
            const value = symbols_iter.value;

            if (value.isEmptyOrUndefinedOrNull()) {
                return JSC.toTypeError(.ERR_INVALID_ARG_VALUE, "Expected an object for key \"{any}\"", .{prop}, global);
            }

            var function: Function = .{};
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
        state: ?*TCC.TCCState = null,

        return_type: ABIType = ABIType.void,
        arg_types: std.ArrayListUnmanaged(ABIType) = .{},
        step: Step = Step{ .pending = {} },
        threadsafe: bool = false,

        pub var lib_dirZ: [*:0]const u8 = "";

        pub fn needsHandleScope(val: *const Function) bool {
            for (val.arg_types.items) |arg| {
                if (arg == ABIType.napi_env or arg == ABIType.napi_value) {
                    return true;
                }
            }
            return val.return_type == ABIType.napi_value;
        }

        extern "C" fn FFICallbackFunctionWrapper_destroy(*anyopaque) void;

        pub fn deinit(val: *Function, globalThis: *JSC.JSGlobalObject, allocator: std.mem.Allocator) void {
            JSC.markBinding(@src());

            if (val.base_name) |base_name| {
                if (bun.asByteSlice(base_name).len > 0) {
                    allocator.free(@constCast(bun.asByteSlice(base_name)));
                }
            }

            val.arg_types.clearAndFree(allocator);

            if (val.state) |state| {
                TCC.tcc_delete(state);
                val.state = null;
            }

            if (val.step == .compiled) {
                // allocator.free(val.step.compiled.buf);
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
                allocator.free(val.step.failed.msg);
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

        pub fn ffiHeader() string {
            return if (Environment.codegen_embed)
                @embedFile("./FFI.h")
            else
                bun.runtimeEmbedFile(.src, "bun.js/api/FFI.h");
        }

        pub fn handleTCCError(ctx: ?*anyopaque, message: [*c]const u8) callconv(.C) void {
            var this = bun.cast(*Function, ctx.?);
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

            this.step = .{ .failed = .{ .msg = VirtualMachine.get().allocator.dupe(u8, msg) catch unreachable, .allocated = true } };
        }

        const tcc_options = "-std=c11 -nostdlib -Wl,--export-all-symbols" ++ if (Environment.isDebug) " -g" else "";

        pub fn compile(
            this: *Function,
            allocator: std.mem.Allocator,
            globalObject: *JSC.JSGlobalObject,
        ) !void {
            var source_code = std.ArrayList(u8).init(allocator);
            var source_code_writer = source_code.writer();
            try this.printSourceCode(&source_code_writer);

            try source_code.append(0);
            defer source_code.deinit();

            const state = TCC.tcc_new() orelse return error.TCCMissing;
            TCC.tcc_set_options(state, tcc_options);
            // addSharedLibPaths(state);
            TCC.tcc_set_error_func(state, this, handleTCCError);
            this.state = state;
            defer {
                if (this.step == .failed) {
                    TCC.tcc_delete(state);
                    this.state = null;
                }
            }

            _ = TCC.tcc_set_output_type(state, TCC.TCC_OUTPUT_MEMORY);

            _ = TCC.tcc_add_symbol(state, "Bun__thisFFIModuleNapiEnv", globalObject);

            CompilerRT.define(state);

            // TCC.tcc_define_symbol(
            //     state,
            //     "Bun_FFI_PointerOffsetToArgumentsCount",
            //     std.fmt.bufPrintZ(symbol_buf[8..], "{d}", .{Bun_FFI_PointerOffsetToArgumentsCount}) catch unreachable,
            // );

            const compilation_result = TCC.tcc_compile_string(
                state,
                @ptrCast(source_code.items.ptr),
            );
            // did tcc report an error?
            if (this.step == .failed) {
                return;
            }

            // did tcc report failure but never called the error callback?
            if (compilation_result == -1) {
                this.step = .{ .failed = .{ .msg = "tcc returned -1, which means it failed" } };
                return;
            }
            CompilerRT.inject(state);
            _ = TCC.tcc_add_symbol(state, this.base_name.?, this.symbol_from_dynamic_library.?);

            if (this.step == .failed) {
                return;
            }

            const relocation_size = TCC.tcc_relocate(state, null);
            if (this.step == .failed) {
                return;
            }

            if (relocation_size < 0) {
                if (this.step != .failed)
                    this.step = .{ .failed = .{ .msg = "tcc_relocate returned a negative value" } };
                return;
            }

            const bytes: []u8 = try allocator.alloc(u8, @as(usize, @intCast(relocation_size)));
            defer {
                if (this.step == .failed) {
                    allocator.free(bytes);
                }
            }

            if (comptime Environment.isAarch64 and Environment.isMac) {
                pthread_jit_write_protect_np(false);
            }
            _ = TCC.tcc_relocate(state, bytes.ptr);
            if (comptime Environment.isAarch64 and Environment.isMac) {
                pthread_jit_write_protect_np(true);
            }

            const symbol = TCC.tcc_get_symbol(state, "JSFunctionCall") orelse {
                this.step = .{ .failed = .{ .msg = "missing generated symbol in source code" } };

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
            allocator: std.mem.Allocator,
            js_context: *JSC.JSGlobalObject,
            js_function: JSValue,
            is_threadsafe: bool,
        ) !void {
            JSC.markBinding(@src());
            var source_code = std.ArrayList(u8).init(allocator);
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
            const state = TCC.tcc_new() orelse return error.TCCMissing;
            TCC.tcc_set_options(state, tcc_options);
            TCC.tcc_set_error_func(state, this, handleTCCError);
            this.state = state;
            defer {
                if (this.step == .failed) {
                    TCC.tcc_delete(state);
                    this.state = null;
                }
            }

            _ = TCC.tcc_set_output_type(state, TCC.TCC_OUTPUT_MEMORY);

            _ = TCC.tcc_add_symbol(state, "Bun__thisFFIModuleNapiEnv", js_context);

            CompilerRT.define(state);

            const compilation_result = TCC.tcc_compile_string(
                state,
                @ptrCast(source_code.items.ptr),
            );
            // did tcc report an error?
            if (this.step == .failed) {
                return;
            }

            // did tcc report failure but never called the error callback?
            if (compilation_result == -1) {
                this.step = .{ .failed = .{ .msg = "tcc returned -1, which means it failed" } };

                return;
            }

            CompilerRT.inject(state);
            _ = TCC.tcc_add_symbol(
                state,
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
            );
            const relocation_size = TCC.tcc_relocate(state, null);

            if (relocation_size < 0) {
                if (this.step != .failed)
                    this.step = .{ .failed = .{ .msg = "tcc_relocate returned a negative value" } };
                return;
            }

            const bytes: []u8 = try allocator.alloc(u8, @as(usize, @intCast(relocation_size)));
            defer {
                if (this.step == .failed) {
                    allocator.free(bytes);
                }
            }

            if (comptime Environment.isAarch64 and Environment.isMac) {
                pthread_jit_write_protect_np(false);
            }
            _ = TCC.tcc_relocate(state, bytes.ptr);
            if (comptime Environment.isAarch64 and Environment.isMac) {
                pthread_jit_write_protect_np(true);
            }

            const symbol = TCC.tcc_get_symbol(state, "my_callback_function") orelse {
                this.step = .{ .failed = .{ .msg = "missing generated symbol in source code" } };

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
                        .{
                            fmt,
                        },
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
                // if (self.fromi64) {
                //     try writer.writeAll("EncodedJSValue{ ");
                // }
                try writer.writeAll(self.symbol);
                // if (self.fromi64) {
                //     try writer.writeAll(", }");
                // }
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
        compiler_rt_dir = bun.default_allocator.dupeZ(u8, bun.getFdPath(bunCC, &path_buf) catch return) catch bun.outOfMemory();
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
    const headers = @import("../bindings/headers.zig");
    var workaround: MyFunctionSStructWorkAround = .{
        .JSVALUE_TO_INT64 = headers.JSC__JSValue__toInt64,
        .JSVALUE_TO_UINT64 = headers.JSC__JSValue__toUInt64NoTruncate,
        .INT64_TO_JSVALUE = headers.JSC__JSValue__fromInt64NoTruncate,
        .UINT64_TO_JSVALUE = headers.JSC__JSValue__fromUInt64NoTruncate,
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

    pub fn define(state: *TCC.TCCState) void {
        if (comptime Environment.isX64) {
            _ = TCC.tcc_define_symbol(state, "NEEDS_COMPILER_RT_FUNCTIONS", "1");
            // there
            _ = TCC.tcc_compile_string(state, @embedFile(("libtcc1.c")));
        }

        const Sizes = @import("../bindings/sizes.zig");
        var symbol_buf: [256]u8 = undefined;
        TCC.tcc_define_symbol(
            state,
            "Bun_FFI_PointerOffsetToArgumentsList",
            std.fmt.bufPrintZ(&symbol_buf, "{d}", .{Sizes.Bun_FFI_PointerOffsetToArgumentsList}) catch unreachable,
        );
        const offsets = Offsets.get();
        TCC.tcc_define_symbol(
            state,
            "JSArrayBufferView__offsetOfLength",
            std.fmt.bufPrintZ(&symbol_buf, "{d}", .{offsets.JSArrayBufferView__offsetOfLength}) catch unreachable,
        );
        TCC.tcc_define_symbol(
            state,
            "JSArrayBufferView__offsetOfVector",
            std.fmt.bufPrintZ(&symbol_buf, "{d}", .{offsets.JSArrayBufferView__offsetOfVector}) catch unreachable,
        );
        TCC.tcc_define_symbol(
            state,
            "JSCell__offsetOfType",
            std.fmt.bufPrintZ(&symbol_buf, "{d}", .{offsets.JSCell__offsetOfType}) catch unreachable,
        );
        TCC.tcc_define_symbol(
            state,
            "JSTypeArrayBufferViewMin",
            std.fmt.bufPrintZ(&symbol_buf, "{d}", .{@intFromEnum(JSC.JSValue.JSType.min_typed_array)}) catch unreachable,
        );
        TCC.tcc_define_symbol(
            state,
            "JSTypeArrayBufferViewMax",
            std.fmt.bufPrintZ(&symbol_buf, "{d}", .{@intFromEnum(JSC.JSValue.JSType.max_typed_array)}) catch unreachable,
        );
    }

    pub fn inject(state: *TCC.TCCState) void {
        _ = TCC.tcc_add_symbol(state, "memset", &memset);
        _ = TCC.tcc_add_symbol(state, "memcpy", &memcpy);
        _ = TCC.tcc_add_symbol(state, "NapiHandleScope__open", &bun.JSC.napi.NapiHandleScope.NapiHandleScope__open);
        _ = TCC.tcc_add_symbol(state, "NapiHandleScope__close", &bun.JSC.napi.NapiHandleScope.NapiHandleScope__close);

        _ = TCC.tcc_add_symbol(
            state,
            "JSVALUE_TO_INT64_SLOW",
            workaround.JSVALUE_TO_INT64,
        );
        _ = TCC.tcc_add_symbol(
            state,
            "JSVALUE_TO_UINT64_SLOW",
            workaround.JSVALUE_TO_UINT64,
        );
        std.mem.doNotOptimizeAway(headers.JSC__JSValue__toUInt64NoTruncate);
        std.mem.doNotOptimizeAway(headers.JSC__JSValue__toInt64);
        std.mem.doNotOptimizeAway(headers.JSC__JSValue__fromInt64NoTruncate);
        std.mem.doNotOptimizeAway(headers.JSC__JSValue__fromUInt64NoTruncate);
        _ = TCC.tcc_add_symbol(
            state,
            "INT64_TO_JSVALUE_SLOW",
            workaround.INT64_TO_JSVALUE,
        );
        _ = TCC.tcc_add_symbol(
            state,
            "UINT64_TO_JSVALUE_SLOW",
            workaround.UINT64_TO_JSVALUE,
        );
    }
};

pub const Bun__FFI__cc = FFI.Bun__FFI__cc;
