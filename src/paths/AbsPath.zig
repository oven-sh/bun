const std = @import("std");
const bun = @import("bun");
const Options = @import("./PathOptions.zig");
const PathBuffer = bun.PathBuffer;
const strings = bun.strings;
const string = bun.string;
const stringZ = bun.stringZ;
const FD = bun.FD;
const RelPath = bun.RelPath;

/// All operations are done after trimming trailing slashes. Sometimes
/// leading slashes are also trimmed. Root slashes will not be trimmed.
pub fn AbsPath(comptime opts: Options) type {
    const Result = opts.ResultFn();

    const log = bun.Output.scoped(.AbsPath, false);

    return struct {
        _buf: *PathBuffer,
        len: u16,

        pub fn slice(this: *const @This()) callconv(bun.callconv_inline) string {
            return this._buf[0..this.len];
        }

        pub fn sliceZ(this: *const @This()) callconv(bun.callconv_inline) stringZ {
            this._buf[this.len] = 0;
            return this._buf[0..this.len :0];
        }

        pub fn buf(this: *@This()) []u8 {
            return this._buf;
        }

        pub fn clear(this: *@This()) callconv(bun.callconv_inline) void {
            this.len = 0;
        }

        pub fn reset(this: *@This(), abs_input_path: string) callconv(bun.callconv_inline) void {
            bun.debugAssert(std.fs.path.isAbsolute(abs_input_path));

            const trimmed = strings.trimTrailingPathSeparators(abs_input_path);

            this.len = 0;
            this.appendCharacters(trimmed);
        }

        pub fn initEmpty() callconv(bun.callconv_inline) @This() {
            return .{
                ._buf = bun.PathBufferPool.get(),
                .len = 0,
            };
        }

        pub const Any = opaque {};

        pub fn init(abs_input_path: string) callconv(bun.callconv_inline) Result(@This()) {
            bun.debugAssert(std.fs.path.isAbsolute(abs_input_path));

            const trimmed = strings.trimTrailingPathSeparators(abs_input_path);

            if (comptime opts.check_length == .check_for_greater_than_max_path) {
                if (trimmed.len > bun.MAX_PATH_BYTES) {
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
            const trimmed = strings.trimTrailingPathSeparators(try fd.getFdPath(new._buf));
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

        /// Append a component. Trims leading and trailing slashes if it's not the root component.
        pub fn append(this: *AbsPath(opts), component: string) callconv(bun.callconv_inline) Result(void) {
            const is_root = this.len == 0;
            if (comptime bun.Environment.isDebug) {
                if (is_root) {
                    bun.debugAssert(std.fs.path.isAbsolute(component));
                } else {
                    bun.debugAssert(!std.fs.path.isAbsolute(component));
                }
            }
            const trimmed = if (is_root)
                component
            else
                strings.trimPathSeparators(component);

            if (trimmed.len == 0) {
                return;
            }

            if (comptime opts.check_length == .check_for_greater_than_max_path) {
                if (this.len + trimmed.len + @intFromBool(!is_root) > bun.MAX_PATH_BYTES) {
                    return error.MaxPathExceeded;
                }
            }

            if (!is_root) {
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
            const is_root = this.len == 0;

            if (comptime opts.check_length == .check_for_greater_than_max_path) {
                if (this.len + @intFromBool(!is_root) > bun.MAX_PATH_BYTES) {
                    return error.MaxPathExceeded;
                }
            }

            if (!is_root) {
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

            if (comptime bun.Environment.isDebug) {
                if (is_root) {
                    bun.debugAssert(std.fs.path.isAbsolute(printed));
                } else {
                    bun.debugAssert(!std.fs.path.isAbsolute(printed));
                }
            }

            const trimmed = if (is_root)
                printed
            else
                strings.trimPathSeparators(printed);

            this.len += @intCast(trimmed.len);
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
            const rel = bun.path.relativeBufZ(output._buf, from.slice(), to.slice());
            const trimmed = strings.trimTrailingPathSeparators(rel);
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
