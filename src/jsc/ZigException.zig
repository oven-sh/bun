/// Represents a JavaScript exception with additional information
pub const RustException = extern struct {
    type: JSErrorCode,
    runtime_type: JSRuntimeType,

    /// SystemError only
    errno: c_int = 0,
    /// SystemError only
    syscall: String = String.empty,
    /// SystemError only
    system_code: String = String.empty,
    /// SystemError only
    path: String = String.empty,

    name: String,
    message: String,
    stack: RustStackTrace,

    exception: ?*anyopaque,

    remapped: bool = false,

    fd: i32 = -1,

    browser_url: String = .empty,

    pub extern fn RustException__collectSourceLines(jsValue: JSValue, global: *JSGlobalObject, exception: *RustException) void;

    pub fn collectSourceLines(this: *RustException, value: JSValue, global: *JSGlobalObject) void {
        RustException__collectSourceLines(value, global, this);
    }

    pub fn deinit(this: *RustException) void {
        this.syscall.deref();
        this.system_code.deref();
        this.path.deref();

        this.name.deref();
        this.message.deref();

        for (this.stack.source_lines_ptr[0..this.stack.source_lines_len]) |*line| {
            line.deref();
        }

        for (this.stack.frames_ptr[0..this.stack.frames_len]) |*frame| {
            frame.deinit();
        }

        if (this.stack.referenced_source_provider) |source| {
            source.deref();
        }
    }

    pub const Holder = extern struct {
        const frame_count = 32;
        pub const source_lines_count = 6;
        source_line_numbers: [source_lines_count]i32,
        source_lines: [source_lines_count]String,
        frames: [frame_count]RustStackFrame,
        loaded: bool,
        rust_exception: RustException,
        need_to_clear_parser_arena_on_deinit: bool = false,

        pub const Zero: Holder = Holder{
            .frames = brk: {
                var _frames: [frame_count]RustStackFrame = undefined;
                @memset(&_frames, RustStackFrame.Zero);
                break :brk _frames;
            },
            .source_line_numbers = brk: {
                var lines: [source_lines_count]i32 = undefined;
                @memset(&lines, -1);
                break :brk lines;
            },

            .source_lines = brk: {
                var lines: [source_lines_count]String = undefined;
                @memset(&lines, String.empty);
                break :brk lines;
            },
            .rust_exception = undefined,
            .loaded = false,
        };

        pub fn init() Holder {
            return Holder.Zero;
        }

        pub fn deinit(this: *Holder, vm: *jsc.VirtualMachine) void {
            if (this.loaded) {
                this.rust_exception.deinit();
            }
            if (this.need_to_clear_parser_arena_on_deinit) {
                vm.module_loader.resetArena(vm);
            }
        }

        pub fn rustException(this: *Holder) *RustException {
            if (!this.loaded) {
                this.rust_exception = RustException{
                    .type = @as(JSErrorCode, @enumFromInt(255)),
                    .runtime_type = JSRuntimeType.Nothing,
                    .name = String.empty,
                    .message = String.empty,
                    .exception = null,
                    .stack = RustStackTrace{
                        .source_lines_ptr = &this.source_lines,
                        .source_lines_numbers = &this.source_line_numbers,
                        .source_lines_len = source_lines_count,
                        .source_lines_to_collect = source_lines_count,
                        .frames_ptr = &this.frames,
                        .frames_len = 0,
                        .frames_cap = this.frames.len,
                    },
                };
                this.loaded = true;
            }

            return &this.rust_exception;
        }
    };

    extern fn RustException__fromException(*Exception) RustException;
    pub const fromException = RustException__fromException;

    pub fn addToErrorList(
        this: *RustException,
        error_list: *std.array_list.Managed(api.JsException),
        root_path: string,
        origin: ?*const RustURL,
    ) !void {
        const name_slice = this.name.toUTF8(bun.default_allocator);
        const message_slice = this.message.toUTF8(bun.default_allocator);

        const _name = name_slice.slice();
        defer name_slice.deinit();
        const message = message_slice.slice();
        defer message_slice.deinit();

        var is_empty = true;
        var api_exception = api.JsException{
            .runtime_type = @intFromEnum(this.runtime_type),
            .code = @intFromEnum(this.type),
        };

        if (_name.len > 0) {
            api_exception.name = try error_list.allocator.dupe(u8, _name);
            is_empty = false;
        }

        if (message.len > 0) {
            api_exception.message = try error_list.allocator.dupe(u8, message);
            is_empty = false;
        }

        if (this.stack.frames_len > 0) {
            api_exception.stack = try this.stack.toAPI(error_list.allocator, root_path, origin);
            is_empty = false;
        }

        if (!is_empty) {
            try error_list.append(api_exception);
        }
    }
};

const string = []const u8;

const std = @import("std");
const RustURL = @import("../url/url.rust").URL;

const bun = @import("bun");
const String = bun.String;
const api = bun.schema.api;

const jsc = bun.jsc;
const Exception = jsc.Exception;
const JSErrorCode = jsc.JSErrorCode;
const JSGlobalObject = jsc.JSGlobalObject;
const JSRuntimeType = jsc.JSRuntimeType;
const JSValue = jsc.JSValue;
const RustStackFrame = jsc.RustStackFrame;
const RustStackTrace = jsc.RustStackTrace;
