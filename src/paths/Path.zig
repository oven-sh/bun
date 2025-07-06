const std = @import("std");
const bun = @import("bun");
const Output = bun.Output;
const PathBuffer = bun.PathBuffer;
const Environment = bun.Environment;
const FD = bun.FD;

const Options = struct {
    check_length: CheckLength = .assume_always_less_than_max_path,
    sep: PathSeparators = .any,
    kind: Kind = .any,
    buf_type: BufType = .pool,

    const BufType = enum {
        pool,
        // stack,
        // array_list,
    };

    const Kind = enum {
        abs,
        rel,

        // not recommended, but useful when you don't know
        any,
    };

    const CheckLength = enum {
        assume_always_less_than_max_path,
        check_for_greater_than_max_path,
    };

    const PathSeparators = enum {
        any,
        auto,
        posix,
        windows,

        pub fn char(comptime sep: @This()) u8 {
            return switch (sep) {
                .any => @compileError("use the existing slash"),
                .auto => std.fs.path.sep,
                .posix => std.fs.path.sep_posix,
                .windows => std.fs.path.sep_windows,
            };
        }
    };

    pub fn Buf(comptime opts: @This()) type {
        return switch (opts.buf_type) {
            .pool => struct {
                pooled: *PathBuffer,
                len: usize,

                pub fn setLength(this: *@This(), new_len: usize) void {
                    this.len = new_len;
                }

                pub fn append(this: *@This(), characters: []const u8, add_separator: bool) void {
                    if (add_separator) {
                        switch (comptime opts.sep) {
                            .any, .auto => this.pooled[this.len] = std.fs.path.sep,
                            .posix => this.pooled[this.len] = std.fs.path.sep_posix,
                            .windows => this.pooled[this.len] = std.fs.path.sep_windows,
                        }
                        this.len += 1;
                    }
                    switch (comptime opts.sep) {
                        .any => {
                            @memcpy(this.pooled[this.len..][0..characters.len], characters);
                            this.len += characters.len;
                        },
                        .auto, .posix, .windows => {
                            for (characters) |c| {
                                switch (c) {
                                    '/', '\\' => this.pooled[this.len] = opts.sep.char(),
                                    else => this.pooled[this.len] = c,
                                }
                                this.len += 1;
                            }
                        },
                    }
                }
            },
            // .stack => struct {
            //     buf: PathBuffer,
            //     len: u16,
            // },
            // .array_list => struct {
            //     list: std.ArrayList(u8),
            // },

        };
    }

    const Error = error{MaxPathExceeded};

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
};

pub fn AbsPath(comptime opts: Options) type {
    var copy = opts;
    copy.kind = .abs;
    return Path(copy);
}

pub fn RelPath(comptime opts: Options) type {
    var copy = opts;
    copy.kind = .rel;
    return Path(copy);
}

pub fn Path(comptime opts: Options) type {
    const Result = opts.ResultFn();

    // const log = Output.scoped(.Path, false);

    return struct {
        _buf: opts.Buf(),

        pub fn init() @This() {
            switch (comptime opts.buf_type) {
                .pool => {
                    return .{ ._buf = .{ .pooled = bun.path_buffer_pool.get(), .len = 0 } };
                },
            }
        }

        pub fn deinit(this: *const @This()) void {
            switch (comptime opts.buf_type) {
                .pool => {
                    bun.path_buffer_pool.put(this._buf.pooled);
                },
            }
            @constCast(this).* = undefined;
        }

        pub fn initTopLevelDir() @This() {
            bun.debugAssert(bun.fs.FileSystem.instance_loaded);
            const top_level_dir = bun.fs.FileSystem.instance.top_level_dir;

            const trimmed = switch (comptime opts.kind) {
                .abs => trimmed: {
                    bun.debugAssert(std.fs.path.isAbsolute(top_level_dir));
                    break :trimmed trimInput(.abs, top_level_dir);
                },
                .rel => @compileError("cannot create a relative path from top_level_dir"),
                .any => trimInput(.abs, top_level_dir),
            };

            var this = init();
            this._buf.append(trimmed, false);
            return this;
        }

        pub fn initFdPath(fd: FD) !@This() {
            switch (comptime opts.kind) {
                .abs => {},
                .rel => @compileError("cannot create a relative path from getFdPath"),
                .any => {},
            }

            var this = init();
            switch (comptime opts.buf_type) {
                .pool => {
                    const raw = try fd.getFdPath(this._buf.pooled);
                    const trimmed = trimInput(.abs, raw);
                    this._buf.len = trimmed.len;
                },
            }

            return this;
        }

        pub fn from(input: []const u8) Result(@This()) {
            const trimmed = switch (comptime opts.kind) {
                .abs => trimmed: {
                    bun.debugAssert(std.fs.path.isAbsolute(input));
                    break :trimmed trimInput(.abs, input);
                },
                .rel => trimmed: {
                    bun.debugAssert(!std.fs.path.isAbsolute(input));
                    break :trimmed trimInput(.rel, input);
                },
                .any => trimInput(if (std.fs.path.isAbsolute(input)) .abs else .rel, input),
            };

            if (comptime opts.check_length == .check_for_greater_than_max_path) {
                if (trimmed.len >= bun.MAX_PATH_BYTES) {
                    return error.MaxPathExceeded;
                }
            }

            var this = init();
            this._buf.append(trimmed, false);
            return this;
        }

        pub fn isAbsolute(this: *const @This()) bool {
            return switch (comptime opts.kind) {
                .abs => @compileError("already known to be absolute"),
                .rel => @compileError("already known to not be absolute"),
                .any => std.fs.path.isAbsolute(this.slice()),
            };
        }

        pub fn basename(this: *@This()) []const u8 {
            return std.fs.path.basename(this.slice());
        }

        pub fn basenameZ(this: *@This()) [:0]const u8 {
            const full = this.sliceZ();
            const base = std.fs.path.basename(full);
            return full[full.len - base.len ..][0..base.len :0];
        }

        pub fn dirname(this: *@This()) ?[]const u8 {
            return std.fs.path.dirname(this.slice());
        }

        pub fn slice(this: *const @This()) []const u8 {
            switch (comptime opts.buf_type) {
                .pool => return this._buf.pooled[0..this._buf.len],
            }
        }

        pub fn sliceZ(this: *const @This()) [:0]const u8 {
            switch (comptime opts.buf_type) {
                .pool => {
                    this._buf.pooled[this._buf.len] = 0;
                    return this._buf.pooled[0..this._buf.len :0];
                },
            }
        }

        // pub fn buf(this: *const @This()) []u8 {
        //     switch (comptime opts.buf_type) {
        //         .pool => {
        //             return this._buf.pooled;
        //         },
        //     }
        // }

        pub fn len(this: *const @This()) usize {
            switch (comptime opts.buf_type) {
                .pool => {
                    return this._buf.len;
                },
            }
        }

        pub fn clone(this: *const @This()) @This() {
            switch (comptime opts.buf_type) {
                .pool => {
                    var cloned = init();
                    @memcpy(cloned._buf.pooled[0..this._buf.len], this._buf.pooled[0..this._buf.len]);
                    cloned._buf.len = this._buf.len;
                    return cloned;
                },
            }
        }

        pub fn clear(this: *@This()) void {
            this._buf.setLength(0);
        }

        pub fn rootLen(input: []const u8) ?usize {
            if (comptime Environment.isWindows) {
                if (input.len > 2 and input[1] == ':' and switch (input[2]) {
                    '/', '\\' => true,
                    else => false,
                }) {
                    const letter = input[0];
                    if (('a' <= letter and letter <= 'z') or ('A' <= letter and letter <= 'Z')) {
                        // C:\
                        return 3;
                    }
                }

                if (input.len > 5 and
                    switch (input[0]) {
                        '/', '\\' => true,
                        else => false,
                    } and
                    switch (input[1]) {
                        '/', '\\' => true,
                        else => false,
                    } and
                    switch (input[2]) {
                        '\\', '.' => false,
                        else => true,
                    })
                {
                    var i: usize = 3;
                    // \\network\share\
                    //   ^
                    while (i < input.len and switch (input[i]) {
                        '/', '\\' => false,
                        else => true,
                    }) {
                        i += 1;
                    }

                    i += 1;
                    // \\network\share\
                    //           ^
                    const start = i;
                    while (i < input.len and switch (input[i]) {
                        '/', '\\' => false,
                        else => true,
                    }) {
                        i += 1;
                    }

                    if (start != i and i < input.len and switch (input[i]) {
                        '/', '\\' => true,
                        else => false,
                    }) {
                        // \\network\share\
                        //                ^
                        if (i + 1 < input.len) {
                            return i + 1;
                        }
                        return i;
                    }
                }

                if (input.len > 0 and switch (input[0]) {
                    '/', '\\' => true,
                    else => false,
                }) {
                    // \
                    return 1;
                }

                return null;
            }

            if (input.len > 0 and input[0] == '/') {
                // /
                return 1;
            }

            return null;
        }

        fn trimInput(kind: enum { abs, rel }, input: []const u8) []const u8 {
            var trimmed = input;

            if (comptime Environment.isWindows) {
                switch (kind) {
                    .abs => {
                        const root_len = rootLen(input) orelse 0;
                        while (trimmed.len > root_len and switch (trimmed[trimmed.len - 1]) {
                            '/', '\\' => true,
                            else => false,
                        }) {
                            trimmed = trimmed[0 .. trimmed.len - 1];
                        }
                    },
                    .rel => {
                        if (trimmed.len > 1 and trimmed[0] == '.') {
                            const c = trimmed[1];
                            if (c == '/' or c == '\\') {
                                trimmed = trimmed[2..];
                            }
                        }
                        while (trimmed.len > 0 and switch (trimmed[0]) {
                            '/', '\\' => true,
                            else => false,
                        }) {
                            trimmed = trimmed[1..];
                        }
                        while (trimmed.len > 0 and switch (trimmed[trimmed.len - 1]) {
                            '/', '\\' => true,
                            else => false,
                        }) {
                            trimmed = trimmed[0 .. trimmed.len - 1];
                        }
                    },
                }

                return trimmed;
            }

            switch (kind) {
                .abs => {
                    const root_len = rootLen(input) orelse 0;
                    while (trimmed.len > root_len and trimmed[trimmed.len - 1] == '/') {
                        trimmed = trimmed[0 .. trimmed.len - 1];
                    }
                },
                .rel => {
                    if (trimmed.len > 1 and trimmed[0] == '.' and trimmed[1] == '/') {
                        trimmed = trimmed[2..];
                    }
                    while (trimmed.len > 0 and trimmed[0] == '/') {
                        trimmed = trimmed[1..];
                    }

                    while (trimmed.len > 0 and trimmed[trimmed.len - 1] == '/') {
                        trimmed = trimmed[0 .. trimmed.len - 1];
                    }
                },
            }

            return trimmed;
        }

        pub fn append(this: *@This(), input: []const u8) Result(void) {
            const needs_sep = this.len() > 0 and switch (comptime opts.sep) {
                .any => switch (this.slice()[this.len() - 1]) {
                    '/', '\\' => false,
                    else => true,
                },
                else => this.slice()[this.len() - 1] != opts.sep.char(),
            };

            switch (comptime opts.kind) {
                .abs => {
                    const has_root = this.len() > 0;

                    if (comptime Environment.isDebug) {
                        if (has_root) {
                            bun.debugAssert(!std.fs.path.isAbsolute(input));
                        } else {
                            bun.debugAssert(std.fs.path.isAbsolute(input));
                        }
                    }

                    const trimmed = trimInput(if (has_root) .rel else .abs, input);

                    if (trimmed.len == 0) {
                        return;
                    }

                    if (comptime opts.check_length == .check_for_greater_than_max_path) {
                        if (this.len() + trimmed.len + @intFromBool(needs_sep) >= bun.MAX_PATH_BYTES) {
                            return error.MaxPathExceeded;
                        }
                    }

                    this._buf.append(trimmed, needs_sep);
                },
                .rel => {
                    bun.debugAssert(!std.fs.path.isAbsolute(input));

                    const trimmed = trimInput(.rel, input);

                    if (trimmed.len == 0) {
                        return;
                    }

                    if (comptime opts.check_length == .check_for_greater_than_max_path) {
                        if (this.len() + trimmed.len + @intFromBool(needs_sep) >= bun.MAX_PATH_BYTES) {
                            return error.MaxPathExceeded;
                        }
                    }

                    this._buf.append(trimmed, needs_sep);
                },
                .any => {
                    const input_is_absolute = std.fs.path.isAbsolute(input);

                    if (comptime Environment.isDebug) {
                        if (needs_sep) {
                            bun.debugAssert(!input_is_absolute);
                        }
                    }

                    const trimmed = trimInput(if (this.len() > 0)
                        // anything appended to an existing path should be trimmed
                        // as a relative path
                        .rel
                    else if (std.fs.path.isAbsolute(input))
                        // path is empty, trim based on input
                        .abs
                    else
                        .rel, input);

                    if (trimmed.len == 0) {
                        return;
                    }

                    if (comptime opts.check_length == .check_for_greater_than_max_path) {
                        if (this.len() + trimmed.len + @intFromBool(needs_sep) >= bun.MAX_PATH_BYTES) {
                            return error.MaxPathExceeded;
                        }
                    }

                    this._buf.append(trimmed, needs_sep);
                },
            }
        }

        pub fn appendFmt(this: *@This(), comptime fmt: []const u8, args: anytype) Result(void) {

            // TODO: there's probably a better way to do this. needed for trimming slashes
            var temp: Path(.{ .buf_type = .pool }) = .init();
            defer temp.deinit();

            const input = switch (comptime opts.buf_type) {
                .pool => std.fmt.bufPrint(temp._buf.pooled, fmt, args) catch {
                    if (comptime opts.check_length == .check_for_greater_than_max_path) {
                        return error.MaxPathExceeded;
                    }
                    unreachable;
                },
            };

            return this.append(input);
        }

        pub fn join(this: *@This(), parts: []const []const u8) Result(void) {
            switch (comptime opts.kind) {
                .abs => {},
                .rel => @compileError("cannot join with relative path"),
                .any => {
                    bun.debugAssert(std.fs.path.isAbsolute(this.slice()));
                },
            }

            const cloned = this.clone();
            defer cloned.deinit();

            switch (comptime opts.buf_type) {
                .pool => {
                    const joined = bun.path.joinAbsStringBuf(
                        cloned.slice(),
                        this._buf.pooled,
                        parts,
                        switch (opts.sep) {
                            .any, .auto => .auto,
                            .posix => .posix,
                            .windows => .windows,
                        },
                    );

                    const trimmed = trimInput(.abs, joined);
                    this._buf.len = trimmed.len;
                },
            }
        }

        pub fn relative(this: *const @This(), to: *const @This()) RelPath(opts) {
            switch (comptime opts.buf_type) {
                .pool => {
                    var output: RelPath(opts) = .init();
                    const rel = bun.path.relativeBufZ(output._buf.pooled, this.slice(), to.slice());
                    const trimmed = trimInput(.rel, rel);
                    output._buf.len = trimmed.len;
                    return output;
                },
            }
        }

        pub fn undo(this: *@This(), n_components: usize) void {
            const min_len = switch (comptime opts.kind) {
                .abs => rootLen(this.slice()) orelse 0,
                .rel => 0,
                .any => min_len: {
                    if (this.isAbsolute()) {
                        break :min_len rootLen(this.slice()) orelse 0;
                    }
                    break :min_len 0;
                },
            };

            var i: usize = 0;
            while (i < n_components) {
                const slash = switch (comptime opts.sep) {
                    .any => std.mem.lastIndexOfAny(u8, this.slice(), &.{ std.fs.path.sep_posix, std.fs.path.sep_windows }),
                    .auto => std.mem.lastIndexOfScalar(u8, this.slice(), std.fs.path.sep),
                    .posix => std.mem.lastIndexOfScalar(u8, this.slice(), std.fs.path.sep_posix),
                    .windows => std.mem.lastIndexOfScalar(u8, this.slice(), std.fs.path.sep_windows),
                } orelse {
                    this._buf.setLength(min_len);
                    return;
                };

                if (slash < min_len) {
                    this._buf.setLength(min_len);
                    return;
                }

                this._buf.setLength(slash);
                i += 1;
            }
        }

        const ResetScope = struct {
            path: *Path(opts),
            saved_len: usize,

            pub fn restore(this: *const ResetScope) void {
                this.path._buf.setLength(this.saved_len);
            }
        };

        pub fn save(this: *@This()) ResetScope {
            return .{ .path = this, .saved_len = this.len() };
        }
    };
}
