const std = @import("std");
const bun = @import("bun");
const Options = @import("./PathOptions.zig");
const PathBuffer = bun.PathBuffer;
const strings = bun.strings;
const string = bun.string;
const stringZ = bun.stringZ;

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

        pub fn reset(this: *@This(), new_path: string) void {
            const trimmed = strings.trimPathSeparators(new_path);
            this.len = 0;
            this.appendCharacters(trimmed);
        }

        /// Append a component
        pub fn append(this: *@This(), component: string) Result(void) {
            const trimmed = strings.trimPathSeparators(component);
            if (trimmed.len == 0) {
                return;
            }

            const needs_separator = this.len != 0;

            if (comptime opts.check_length == .check_for_greater_than_max_path) {
                if (this.len + trimmed.len + @intFromBool(needs_separator) > bun.MAX_PATH_BYTES) {
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
                if (needs_separator and this.len + 1 > bun.MAX_PATH_BYTES) {
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

            const trimmed = strings.trimTrailingPathSeparators(printed);

            if (comptime opts.normalize_slashes) {
                for (trimmed) |c| {
                    switch (c) {
                        '/', '\\' => this._buf[this.len] = std.fs.path.sep,
                        else => {},
                    }
                    this.len += 1;
                }
            } else {
                this.len += @intCast(trimmed.len);
            }
        }

        pub fn pop(this: *@This(), component: string) void {
            const trimmed = strings.trimPathSeparators(component);
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
