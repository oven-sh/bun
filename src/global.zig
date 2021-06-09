const std = @import("std");
pub usingnamespace @import("strings.zig");

pub const C = @import("c.zig");
pub const BuildTarget = enum { native, wasm, wasi };
pub const build_target: BuildTarget = comptime {
    if (std.Target.current.isWasm() and std.Target.current.getOsTag() == .wasi) {
        return BuildTarget.wasi;
    } else if (std.Target.current.isWasm()) {
        return BuildTarget.wasm;
    } else {
        return BuildTarget.native;
    }
};

pub const isWasm = build_target == .wasm;
pub const isNative = build_target == .native;
pub const isWasi = build_target == .wasi;
pub const isMac = build_target == .native and std.Target.current.os.tag == .macos;
pub const isBrowser = !isWasi and isWasm;
pub const isWindows = std.Target.current.os.tag == .windows;

pub const FeatureFlags = struct {
    pub const strong_etags_for_built_files = true;
    pub const keep_alive = true;

    // it just doesn't work well.
    pub const use_std_path_relative = false;
    pub const use_std_path_join = false;

    // Debug helpers
    pub const print_ast = false;
    pub const disable_printing_null = false;

    // This was a ~5% performance improvement
    pub const store_file_descriptors = !isWindows and !isBrowser;

    // This doesn't really seem to do anything for us
    pub const disable_filesystem_cache = false and std.Target.current.os.tag == .macos;

    pub const css_in_js_import_behavior = CSSModulePolyfill.facade;

    pub const only_output_esm = true;

    pub const jsx_runtime_is_cjs = true;

    pub const bundle_node_modules = true;

    pub const tracing = true;

    pub const CSSModulePolyfill = enum {
        // When you import a .css file and you reference the import in JavaScript
        // Just return whatever the property key they referenced was
        facade,
    };
};

pub const isDebug = std.builtin.Mode.Debug == std.builtin.mode;
pub const isTest = std.builtin.is_test;

pub const Output = struct {
    var source: *Source = undefined;
    pub const Source = struct {
        const StreamType = {
            if (isWasm) {
                return std.io.FixedBufferStream([]u8);
            } else {
                return std.fs.File;
                // var stdout = std.io.getStdOut();
                // return @TypeOf(std.io.bufferedWriter(stdout.writer()));
            }
        };
        const BufferedStream = std.io.BufferedWriter(4096, @typeInfo(@TypeOf(Source.StreamType.writer)).Fn.return_type.?);

        buffered_stream: BufferedStream,
        buffered_error_stream: BufferedStream,

        stream: StreamType,
        error_stream: StreamType,
        out_buffer: []u8 = &([_]u8{}),
        err_buffer: []u8 = &([_]u8{}),

        pub fn init(
            stream: StreamType,
            err: StreamType,
        ) Source {
            return Source{
                .stream = stream,
                .error_stream = err,
                .buffered_stream = BufferedStream{ .unbuffered_writer = stream.writer() },
                .buffered_error_stream = BufferedStream{ .unbuffered_writer = err.writer() },
            };
        }

        pub fn set(_source: *Source) void {
            source = _source;
        }
    };
    pub var enable_ansi_colors = isNative;
    pub var enable_buffering = true;

    pub fn enableBuffering() void {
        enable_buffering = true;
    }

    pub fn disableBuffering() void {
        Output.flush();
        enable_buffering = false;
    }

    pub fn errorWriter() @typeInfo(@TypeOf(Source.StreamType.writer)).Fn.return_type.? {
        return source.error_stream.writer();
    }

    pub fn writer() @typeInfo(@TypeOf(Source.StreamType.writer)).Fn.return_type.? {
        return source.stream.writer();
    }

    pub fn flush() void {
        if (isNative) {
            source.buffered_stream.flush() catch {};
            source.buffered_error_stream.flush() catch {};
            // source.stream.flush() catch {};
            // source.error_stream.flush() catch {};
        }
    }

    pub fn printErrorable(comptime fmt: string, args: anytype) !void {
        if (isWasm) {
            try source.stream.seekTo(0);
            try source.stream.writer().print(fmt, args);
            const root = @import("root");
            root.console_log(root.Uint8Array.fromSlice(source.out_buffer[0..source.stream.pos]));
        } else {
            std.fmt.format(source.stream.writer(), fmt, args) catch unreachable;
        }
    }

    pub fn println(comptime fmt: string, args: anytype) void {
        if (fmt[fmt.len - 1] != '\n') {
            return print(fmt ++ "\n", args);
        }

        return print(fmt, args);
    }

    pub const debug = if (isDebug) _debug else _noop;

    fn _noop(comptime fmt: string, args: anytype) void {}

    pub fn _debug(comptime fmt: string, args: anytype) void {
        if (fmt[fmt.len - 1] != '\n') {
            return print(fmt ++ "\n", args);
        }

        return print(fmt, args);
    }

    pub fn print(comptime fmt: string, args: anytype) void {
        if (isWasm) {
            source.stream.seekTo(0) catch return;
            source.stream.writer().print(fmt, args) catch return;
            const root = @import("root");
            root.console_log(root.Uint8Array.fromSlice(source.out_buffer[0..source.stream.pos]));
        } else {
            if (enable_buffering) {
                std.fmt.format(source.buffered_stream.writer(), fmt, args) catch unreachable;
            } else {
                std.fmt.format(writer(), fmt, args) catch unreachable;
            }
        }
    }

    // Valid colors:
    // <black>
    // <blue>
    // <cyan>
    // <green>
    // <magenta>
    // <red>
    // <white>
    // <yellow>
    // <b> - bold
    // <d> - dim
    // </r> - reset
    // <r> - reset
    fn _pretty(comptime fmt: string, args: anytype, comptime printer: anytype, comptime is_enabled: bool) void {
        comptime var new_fmt: [fmt.len * 4]u8 = undefined;
        comptime var new_fmt_i: usize = 0;
        comptime const ED = "\x1b[";

        @setEvalBranchQuota(9999);
        comptime var i: usize = 0;
        comptime while (i < fmt.len) {
            const c = fmt[i];
            switch (c) {
                '\\' => {
                    i += 1;
                    if (fmt.len < i) {
                        switch (fmt[i]) {
                            '<', '>' => {
                                i += 1;
                            },
                            else => {
                                new_fmt[new_fmt_i] = '\\';
                                new_fmt_i += 1;
                                new_fmt[new_fmt_i] = fmt[i];
                                new_fmt_i += 1;
                            },
                        }
                    }
                },
                '>' => {
                    i += 1;
                },
                '{' => {
                    while (fmt.len > i and fmt[i] != '}') {
                        new_fmt[new_fmt_i] = fmt[i];
                        new_fmt_i += 1;
                        i += 1;
                    }
                },
                '<' => {
                    i += 1;
                    var is_reset = fmt[i] == '/';
                    if (is_reset) i += 1;
                    var start: usize = i;
                    while (i < fmt.len and fmt[i] != '>') {
                        i += 1;
                    }

                    const color_name = fmt[start..i];
                    const color_str = color_picker: {
                        if (std.mem.eql(u8, color_name, "black")) {
                            break :color_picker ED ++ "30m";
                        } else if (std.mem.eql(u8, color_name, "blue")) {
                            break :color_picker ED ++ "34m";
                        } else if (std.mem.eql(u8, color_name, "b")) {
                            break :color_picker ED ++ "1m";
                        } else if (std.mem.eql(u8, color_name, "d")) {
                            break :color_picker ED ++ "2m";
                        } else if (std.mem.eql(u8, color_name, "cyan")) {
                            break :color_picker ED ++ "36m";
                        } else if (std.mem.eql(u8, color_name, "green")) {
                            break :color_picker ED ++ "32m";
                        } else if (std.mem.eql(u8, color_name, "magenta")) {
                            break :color_picker ED ++ "35m";
                        } else if (std.mem.eql(u8, color_name, "red")) {
                            break :color_picker ED ++ "31m";
                        } else if (std.mem.eql(u8, color_name, "white")) {
                            break :color_picker ED ++ "37m";
                        } else if (std.mem.eql(u8, color_name, "yellow")) {
                            break :color_picker ED ++ "33m";
                        } else if (std.mem.eql(u8, color_name, "r")) {
                            is_reset = true;
                            break :color_picker "";
                        } else {
                            @compileError("Invalid color name passed:" ++ color_name);
                        }
                    };
                    var orig = new_fmt_i;

                    if (is_enabled) {
                        if (!is_reset) {
                            orig = new_fmt_i;
                            new_fmt_i += color_str.len;
                            std.mem.copy(u8, new_fmt[orig..new_fmt_i], color_str);
                        }

                        if (is_reset) {
                            const reset_sequence = "\x1b[0m";
                            orig = new_fmt_i;
                            new_fmt_i += reset_sequence.len;
                            std.mem.copy(u8, new_fmt[orig..new_fmt_i], reset_sequence);
                        }
                    }
                },

                else => {
                    new_fmt[new_fmt_i] = fmt[i];
                    new_fmt_i += 1;
                    i += 1;
                },
            }
        };
        printer(new_fmt[0..new_fmt_i], args);
    }

    pub fn prettyWithPrinter(comptime fmt: string, args: anytype, printer: anytype) void {
        if (enable_ansi_colors) {
            _pretty(fmt, args, printer, true);
        } else {
            _pretty(fmt, args, printer, false);
        }
    }

    pub fn pretty(comptime fmt: string, args: anytype) void {
        prettyWithPrinter(fmt, args, print);
    }

    pub fn prettyln(comptime fmt: string, args: anytype) void {
        if (enable_ansi_colors) {
            _pretty(fmt, args, println, true);
        } else {
            _pretty(fmt, args, println, false);
        }
    }

    pub fn printErrorln(comptime fmt: string, args: anytype) void {
        if (fmt[fmt.len - 1] != '\n') {
            return printError(fmt ++ "\n", args);
        }

        return printError(fmt, args);
    }

    pub fn prettyError(comptime fmt: string, args: anytype) void {
        prettyWithPrinter(fmt, args, printError);
    }

    pub fn prettyErrorln(comptime fmt: string, args: anytype) void {
        if (fmt[fmt.len - 1] != '\n') {
            return prettyWithPrinter(
                fmt ++ "\n",
                args,
                printError,
            );
        }

        return prettyWithPrinter(
            fmt,
            args,
            printError,
        );
    }

    pub fn errorLn(comptime fmt: string, args: anytype) void {
        return printErrorln(fmt, args);
    }

    pub fn printError(comptime fmt: string, args: anytype) void {
        if (isWasm) {
            source.error_stream.seekTo(0) catch return;
            source.error_stream.writer().print(fmt, args) catch unreachable;
            const root = @import("root");
            root.console_error(root.Uint8Array.fromSlice(source.err_buffer[0..source.error_stream.pos]));
        } else {
            std.fmt.format(source.error_stream.writer(), fmt, args) catch unreachable;
        }
    }
};

pub const Global = struct {
    pub fn panic(comptime fmt: string, args: anytype) noreturn {
        if (isWasm) {
            Output.print(fmt, args);
            Output.flush();
            @panic(fmt);
        } else {
            Output.flush();
            std.debug.panic(fmt, args);
        }
    }

    pub fn notimpl() noreturn {
        Global.panic("Not implemented yet!!!!!", .{});
    }

    // Make sure we always print any leftover
    pub fn crash() noreturn {
        Output.flush();
        std.os.exit(1);
    }
};

pub const FileDescriptorType = if (isBrowser) u0 else std.os.fd_t;

// When we are on a computer with an absurdly high number of max open file handles
// such is often the case with macOS
// As a useful optimization, we can store file descriptors and just keep them open...forever
pub const StoredFileDescriptorType = if (isWindows or isBrowser) u0 else std.os.fd_t;
