const std = @import("std");
const bun = @import("bun");
const PathBuffer = bun.PathBuffer;
const string = bun.string;
const stringZ = bun.stringZ;
const MAX_PATH_BYTES = bun.MAX_PATH_BYTES;
const path = bun.path;
const strings = bun.strings;
const FD = bun.FD;

fn trimLeadingSlashes(input: string) string {
    var trimmed = input;
    while (trimmed.len > 0 and switch (trimmed[0]) {
        '/', '\\' => true,
        else => false,
    }) {
        trimmed = trimmed[1..];
    }
    return trimmed;
}

fn trimTrailingSlashes(input: string) string {
    var trimmed = input;
    while (trimmed.len > 0 and switch (trimmed[trimmed.len - 1]) {
        '/', '\\' => true,
        else => false,
    }) {
        trimmed = trimmed[0 .. trimmed.len - 1];
    }
    return trimmed;
}

fn trimSlashes(input: string) string {
    return trimLeadingSlashes(trimTrailingSlashes(input));
}

const Error = error{MaxPathExceeded};

const Options = struct {
    check_length: CheckLength = .assume_always_less_than_max_path,
    normalize_slashes: bool = false,
    // buf_type: enum { pool, array_list },

    const CheckLength = enum {
        assume_always_less_than_max_path,
        check_for_greater_than_max_path,
    };

    pub fn ResultFn(comptime opts: @This()) fn (comptime T: type) type {
        return struct {
            pub fn Result(comptime T: type) type {
                return switch (opts.check_length) {
                    .assume_always_less_than_max_path => T,
                    .check_for_greater_than_max_path => Error!T,
                };
            }
        }.Result;
    }

    // pub fn BufType(comptime opts: @This()) type {
    //     return switch (opts.buf_type) {
    //         .stack_buffer => struct {
    //             buf: PathBuffer,
    //             len: u16,
    //         },
    //         .pool => struct {
    //             buf: *PathBuffer,
    //             len: u16,
    //         },
    //         .array_list => struct {
    //             list: std.ArrayListUnmanaged(u8),
    //         },
    //     };
    // }
};

pub fn RelPath(comptime opts: Options) type {
    const Result = opts.ResultFn();

    const log = bun.Output.scoped(.RelPath, false);
    _ = log;

    return struct {
        _buf: *PathBuffer,
        len: u16,

        pub fn slice(this: *const @This()) callconv(bun.callconv_inline) string {
            bun.debugAssert(this.len == 0 or this._buf[this.len - 1] != std.fs.path.sep);
            return this._buf[0..this.len];
        }

        pub fn sliceZ(this: *const @This()) callconv(bun.callconv_inline) stringZ {
            bun.debugAssert(this.len == 0 or this._buf[this.len - 1] != std.fs.path.sep);
            this._buf[this.len] = 0;
            return this._buf[0..this.len :0];
        }

        pub fn basename(this: *@This()) string {
            return std.fs.path.basename(this.slice());
        }

        pub fn basenameZ(this: *@This()) stringZ {
            const full = this.sliceZ();
            const base = std.fs.path.basename(full);
            return full[full.len - base.len ..][0..base.len :0];
        }

        pub fn dirname(this: *@This()) ?string {
            return std.fs.path.dirname(this.slice());
        }

        pub fn buf(this: *@This()) []u8 {
            return this._buf;
        }

        pub fn init() callconv(bun.callconv_inline) @This() {
            return .{ ._buf = bun.PathBufferPool.get(), .len = 0 };
        }

        pub fn from(input: string) callconv(bun.callconv_inline) @This() {
            var new: @This() = .init();
            new.append(input);
            return new;
        }

        pub fn deinit(this: *const @This()) void {
            bun.PathBufferPool.put(this._buf);
        }

        /// Append a component
        pub fn append(this: *@This(), component: string) Result(void) {
            const trimmed = trimSlashes(component);
            if (trimmed.len == 0) {
                return;
            }

            const needs_separator = this.len != 0;

            if (comptime opts.check_length == .check_for_greater_than_max_path) {
                if (this.len + trimmed.len + @intFromBool(needs_separator) > MAX_PATH_BYTES) {
                    return error.MaxPathExceeded;
                }
            }

            if (needs_separator) {
                this._buf[this.len] = std.fs.path.sep;
                this.len += 1;
            }

            this.appendCharacters(trimmed);
        }

        // check length beforehand
        fn appendCharacters(this: *@This(), bytes: string) void {
            if (opts.normalize_slashes) {
                for (bytes) |c| {
                    switch (c) {
                        '/', '\\' => this._buf[this.len] = std.fs.path.sep,
                        else => this._buf[this.len] = c,
                    }
                    this.len += 1;
                }
            } else {
                @memcpy(this._buf[this.len..][0..bytes.len], bytes);
                this.len += @intCast(bytes.len);
            }
        }

        /// Append a component
        pub fn appendFmt(this: *@This(), comptime component_fmt: string, component_args: anytype) Result(void) {
            const needs_separator = this.len != 0;

            if (comptime opts.check_length == .check_for_greater_than_max_path) {
                if (needs_separator and this.len + 1 > MAX_PATH_BYTES) {
                    return error.MaxPathExceeded;
                }
            }

            if (needs_separator) {
                this._buf[this.len] = std.fs.path.sep;
                this.len += 1;
            }

            const printed = std.fmt.bufPrint(
                this._buf[this.len..],
                component_fmt,
                component_args,
            ) catch {
                if (comptime opts.check_length == .check_for_greater_than_max_path) {
                    return error.MaxPathExceeded;
                }
                unreachable;
            };

            const trimmed = trimTrailingSlashes(printed);

            this.len += @intCast(trimmed.len);
        }

        pub fn pop(this: *@This(), component: string) void {
            const trimmed = trimSlashes(component);
            if (trimmed.len == 0) {
                return;
            }
            this.len -= @intCast(trimmed.len - 1);
            bun.debugAssert(this._buf[this.len] == std.fs.path.sep);
        }

        pub const ResetScope = struct {
            path: *RelPath(opts),
            saved_len: u16,

            pub fn restore(this: *const ResetScope) void {
                this.path.len = this.saved_len;
            }
        };

        pub fn save(this: *@This()) ResetScope {
            return .{ .path = this, .saved_len = this.len };
        }
    };
}

/// All operations are done after trimming trailing slashes. Sometimes
/// leading slashes are also trimmed.
pub fn AbsPath(comptime opts: Options) type {
    const Result = opts.ResultFn();

    const log = bun.Output.scoped(.AbsPath, false);

    return struct {
        _buf: *PathBuffer,
        len: u16,

        pub fn slice(this: *const @This()) callconv(bun.callconv_inline) string {
            bun.debugAssert(this._buf[this.len - 1] != std.fs.path.sep);
            return this._buf[0..this.len];
        }

        pub fn sliceZ(this: *const @This()) callconv(bun.callconv_inline) stringZ {
            bun.debugAssert(this._buf[this.len - 1] != std.fs.path.sep);
            this._buf[this.len] = 0;
            return this._buf[0..this.len :0];
        }

        pub fn buf(this: *@This()) []u8 {
            return this._buf;
        }

        pub fn reset(this: *@This(), abs_input_path: string) callconv(bun.callconv_inline) void {
            bun.debugAssert(std.fs.path.isAbsolute(abs_input_path));

            const trimmed = trimTrailingSlashes(abs_input_path);

            this.len = 0;
            this.appendCharacters(trimmed);
        }

        pub fn initEmpty() callconv(bun.callconv_inline) @This() {
            return .{
                ._buf = bun.PathBufferPool.get(),
                .len = 0,
            };
        }

        pub fn init(abs_input_path: string) callconv(bun.callconv_inline) Result(@This()) {
            bun.debugAssert(std.fs.path.isAbsolute(abs_input_path));

            const trimmed = trimTrailingSlashes(abs_input_path);

            if (comptime opts.check_length == .check_for_greater_than_max_path) {
                if (trimmed.len > MAX_PATH_BYTES) {
                    return error.MaxPathExceeded;
                }
            }

            var this: @This() = .{ ._buf = bun.PathBufferPool.get(), .len = 0 };
            this.appendCharacters(trimmed);

            return this;
        }

        pub fn initTopLevelDir() callconv(bun.callconv_inline) Result(@This()) {
            bun.debugAssert(bun.fs.FileSystem.instance_loaded);
            return init(bun.fs.FileSystem.instance.top_level_dir);
        }

        pub fn initFdPath(fd: FD) !@This() {
            var new = initEmpty();
            const trimmed = trimTrailingSlashes(try fd.getFdPath(new._buf));
            new.len = @intCast(trimmed.len);
            return new;
        }

        pub fn deinit(this: *const @This()) void {
            bun.PathBufferPool.put(this._buf);
            @constCast(this).* = undefined;
        }

        pub fn move(this: *const @This()) @This() {
            const moved = this.*;
            @constCast(this).* = undefined;
            return moved;
        }

        pub fn clone(original: *const @This()) callconv(bun.callconv_inline) @This() {
            var this: @This() = .{ ._buf = bun.PathBufferPool.get(), .len = original.len };
            @memcpy(this._buf[0..original.len], original._buf[0..original.len]);
            return this;
        }

        /// Append a component. Trims leading and trailing slashes. Assumes the root is already
        /// in the buffer (this.len != 0).
        pub fn append(this: *AbsPath(opts), component: string) callconv(bun.callconv_inline) Result(void) {
            bun.debugAssert(this.len != 0);

            const trimmed = trimSlashes(component);
            if (trimmed.len == 0) {
                return;
            }

            if (comptime opts.check_length == .check_for_greater_than_max_path) {
                if (this.len + trimmed.len + 1 > MAX_PATH_BYTES) {
                    return error.MaxPathExceeded;
                }
            }

            this._buf[this.len] = std.fs.path.sep;
            this.len += 1;

            this.appendCharacters(trimmed);
        }

        // check length beforehand
        fn appendCharacters(this: *@This(), bytes: string) void {
            if (opts.normalize_slashes) {
                for (bytes) |c| {
                    switch (c) {
                        '/', '\\' => this._buf[this.len] = std.fs.path.sep,
                        else => this._buf[this.len] = c,
                    }
                    this.len += 1;
                }
            } else {
                @memcpy(this._buf[this.len..][0..bytes.len], bytes);
                this.len += @intCast(bytes.len);
            }
        }

        /// Append a component
        pub fn appendFmt(this: *@This(), comptime component_fmt: string, component_args: anytype) Result(void) {
            bun.debugAssert(this.len != 0);

            if (comptime opts.check_length == .check_for_greater_than_max_path) {
                if (this.len + 1 > MAX_PATH_BYTES) {
                    return error.MaxPathExceeded;
                }
            }

            this._buf[this.len] = std.fs.path.sep;
            this.len += 1;

            const printed = std.fmt.bufPrint(
                this._buf[this.len..],
                component_fmt,
                component_args,
            ) catch {
                if (comptime opts.check_length == .check_for_greater_than_max_path) {
                    return error.MaxPathExceeded;
                }
                unreachable;
            };

            const trimmed = trimTrailingSlashes(printed);

            this.len += @intCast(trimmed.len);
        }

        /// Pop a component. Trims leading and trailing slashes from input.
        pub fn pop(this: *@This(), component: string) callconv(bun.callconv_inline) void {
            const trimmed = trimSlashes(component);
            if (trimmed.len == 0) {
                return;
            }
            this.len -= @intCast(trimmed.len + 1);
            bun.debugAssert(this._buf[this.len] == std.fs.path.sep);
        }

        pub fn undo(this: *@This(), n_components: usize) callconv(bun.callconv_inline) void {
            var i: usize = 0;
            while (i < n_components) {
                const slash = strings.lastIndexOfChar(this.slice(), std.fs.path.sep) orelse {
                    return;
                };
                this.len = @intCast(slash);
                i += 1;
            }
        }

        pub fn basename(this: *@This()) string {
            return std.fs.path.basename(this.slice());
        }

        pub fn basenameZ(this: *@This()) stringZ {
            const full = this.sliceZ();
            const base = std.fs.path.basename(full);
            return full[full.len - base.len ..][0..base.len :0];
        }

        pub fn relative(from: *const @This(), to: *const @This(), output: *RelPath(opts)) void {
            const rel = path.relativeBufZ(output._buf, from.slice(), to.slice());
            const trimmed = trimTrailingSlashes(rel);
            output.len = @intCast(trimmed.len);

            log(
                \\relative:
                \\  from: '{s}'
                \\    to: '{s}'
                \\   rel: '{s}'
                \\
            , .{
                from.slice(),
                to.slice(),
                output.slice(),
            });
        }

        pub const ResetScope = struct {
            path: *AbsPath(opts),
            saved_len: u16,

            pub fn restore(this: *const ResetScope) void {
                this.path.len = this.saved_len;
            }
        };

        pub fn save(this: *@This()) ResetScope {
            return .{ .path = this, .saved_len = this.len };
        }
    };
}
