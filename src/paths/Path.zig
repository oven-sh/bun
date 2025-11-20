const Options = struct {
    check_length: CheckLength = .assume_always_less_than_max_path,
    sep: PathSeparators = .any,
    kind: Kind = .any,
    buf_type: BufType = .pool,
    unit: Unit = .u8,

    const Unit = enum {
        u8,
        u16,
        os,
    };

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

    pub fn pathUnit(comptime opts: @This()) type {
        return switch (opts.unit) {
            .u8 => u8,
            .u16 => u16,
            .os => if (Environment.isWindows) u16 else u8,
        };
    }

    pub fn notPathUnit(comptime opts: @This()) type {
        return switch (opts.unit) {
            .u8 => u16,
            .u16 => u8,
            .os => if (Environment.isWindows) u8 else u16,
        };
    }

    pub fn maxPathLength(comptime opts: @This()) usize {
        switch (comptime opts.check_length) {
            .assume_always_less_than_max_path => @compileError("max path length is not needed"),
            .check_for_greater_than_max_path => {
                return switch (comptime opts.unit) {
                    .u8 => bun.MAX_PATH_BYTES,
                    .u16 => bun.PATH_MAX_WIDE,
                    .os => if (Environment.isWindows) bun.PATH_MAX_WIDE else bun.MAX_PATH_BYTES,
                };
            },
        }
    }

    pub fn Buf(comptime opts: @This()) type {
        return switch (opts.buf_type) {
            .pool => struct {
                pooled: switch (opts.unit) {
                    .u8 => *PathBuffer,
                    .u16 => *WPathBuffer,
                    .os => if (Environment.isWindows) *WPathBuffer else *PathBuffer,
                },
                len: usize,

                pub fn setLength(this: *@This(), new_len: usize) void {
                    this.len = new_len;
                }

                pub fn append(this: *@This(), characters: anytype, add_separator: bool) void {
                    if (add_separator) {
                        switch (comptime opts.sep) {
                            .any, .auto => this.pooled[this.len] = std.fs.path.sep,
                            .posix => this.pooled[this.len] = std.fs.path.sep_posix,
                            .windows => this.pooled[this.len] = std.fs.path.sep_windows,
                        }
                        this.len += 1;
                    }

                    if (opts.inputChildType(@TypeOf(characters)) == opts.pathUnit()) {
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
                    } else {
                        switch (opts.inputChildType(@TypeOf(characters))) {
                            u8 => {
                                const converted = bun.strings.convertUTF8toUTF16InBuffer(this.pooled[this.len..], characters);
                                if (comptime opts.sep != .any) {
                                    for (this.pooled[this.len..][0..converted.len], 0..) |c, off| {
                                        switch (c) {
                                            '/', '\\' => this.pooled[this.len + off] = opts.sep.char(),
                                            else => {},
                                        }
                                    }
                                }
                                this.len += converted.len;
                            },
                            u16 => {
                                const converted = bun.strings.convertUTF16toUTF8InBuffer(this.pooled[this.len..], characters) catch unreachable;
                                if (comptime opts.sep != .any) {
                                    for (this.pooled[this.len..][0..converted.len], 0..) |c, off| {
                                        switch (c) {
                                            '/', '\\' => this.pooled[this.len + off] = opts.sep.char(),
                                            else => {},
                                        }
                                    }
                                }
                                this.len += converted.len;
                            },
                            else => @compileError("unexpected character type"),
                        }
                    }

                    // switch (@TypeOf(characters)) {
                    //     []u8, []const u8, [:0]u8, [:0]const u8 => {
                    //         if (opts.unit == .u8) {
                    //             this.appendT()
                    //         }
                    //     }
                    // }
                }

                // fn append(this: *@This(), characters: []const opts.pathUnit(), add_separator: bool) void {
                //     if (add_separator) {}
                //     switch (comptime opts.sep) {
                //         .any => {
                //             @memcpy(this.pooled[this.len..][0..characters.len], characters);
                //             this.len += characters.len;
                //         },
                //         .auto, .posix, .windows => {
                //             for (characters) |c| {
                //                 switch (c) {
                //                     '/', '\\' => this.pooled[this.len] = opts.sep.char(),
                //                     else => this.pooled[this.len] = c,
                //                 }
                //                 this.len += 1;
                //             }
                //         },
                //     }
                // }

                fn convertAppend(this: *@This(), characters: []const opts.notPathUnit()) void {
                    _ = this;
                    _ = characters;
                    // switch (comptime opts.sep) {
                    //     .any => {
                    //         switch (opts.notPathUnit()) {
                    //             .u8 => {
                    //                 const converted = bun.strings.convertUTF8toUTF16InBuffer(this.pooled[this.len..], characters);
                    //             },
                    //         }
                    //     },
                    // }
                }
            },
            // .stack => struct {
            //     buf: PathBuffer,
            //     len: u16,
            // },
            // .array_list => struct {
            //     list: std.array_list.Managed(opts.pathUnit()),
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

    pub fn inputChildType(comptime opts: @This(), comptime InputType: type) type {
        _ = opts;
        return switch (@typeInfo(std.meta.Child(InputType))) {
            // handle string literals
            .array => |array| array.child,
            else => std.meta.Child(InputType),
        };
    }
};

pub fn AbsPath(comptime opts: Options) type {
    var copy = opts;
    copy.kind = .abs;
    return Path(copy);
}

pub const AutoAbsPath = Path(.{ .kind = .abs, .sep = .auto });

pub fn RelPath(comptime opts: Options) type {
    var copy = opts;
    copy.kind = .rel;
    return Path(copy);
}

pub const AutoRelPath = Path(.{ .kind = .rel, .sep = .auto });

pub fn Path(comptime opts: Options) type {
    const Result = opts.ResultFn();

    // if (opts.unit == .u16 and !Environment.isWindows) {
    //     @compileError("utf16 not supported");
    // }

    // const log = Output.scoped(.Path, .visible);

    return struct {
        _buf: opts.Buf(),

        pub fn init() @This() {
            switch (comptime opts.buf_type) {
                .pool => {
                    return .{
                        ._buf = .{
                            .pooled = switch (opts.unit) {
                                .u8 => bun.path_buffer_pool.get(),
                                .u16 => bun.w_path_buffer_pool.get(),
                                .os => if (comptime Environment.isWindows)
                                    bun.w_path_buffer_pool.get()
                                else
                                    bun.path_buffer_pool.get(),
                            },
                            .len = 0,
                        },
                    };
                },
            }
        }

        pub fn deinit(this: *const @This()) void {
            switch (comptime opts.buf_type) {
                .pool => {
                    switch (opts.unit) {
                        .u8 => bun.path_buffer_pool.put(this._buf.pooled),
                        .u16 => bun.w_path_buffer_pool.put(this._buf.pooled),
                        .os => if (comptime Environment.isWindows)
                            bun.w_path_buffer_pool.put(this._buf.pooled)
                        else
                            bun.path_buffer_pool.put(this._buf.pooled),
                    }
                },
            }
            @constCast(this).* = undefined;
        }

        pub fn move(this: *const @This()) @This() {
            const moved = this.*;
            @constCast(this).* = undefined;
            return moved;
        }

        pub fn initTopLevelDir() @This() {
            bun.debugAssert(bun.fs.FileSystem.instance_loaded);
            const top_level_dir = bun.fs.FileSystem.instance.top_level_dir;

            const trimmed = switch (comptime opts.kind) {
                .abs => trimmed: {
                    bun.debugAssert(isInputAbsolute(top_level_dir));
                    break :trimmed trimInput(.abs, top_level_dir);
                },
                .rel => @compileError("cannot create a relative path from top_level_dir"),
                .any => trimInput(.abs, top_level_dir),
            };

            var this = init();
            this._buf.append(trimmed, false);
            return this;
        }

        pub fn initTopLevelDirLongPath() @This() {
            bun.debugAssert(bun.fs.FileSystem.instance_loaded);
            const top_level_dir = bun.fs.FileSystem.instance.top_level_dir;

            const trimmed = switch (comptime opts.kind) {
                .abs => trimmed: {
                    bun.debugAssert(isInputAbsolute(top_level_dir));
                    break :trimmed trimInput(.abs, top_level_dir);
                },
                .rel => @compileError("cannot create a relative path from top_level_dir"),
                .any => trimInput(.abs, top_level_dir),
            };

            var this = init();

            if (comptime Environment.isWindows) {
                switch (comptime opts.unit) {
                    .u8 => this._buf.append(bun.windows.long_path_prefix_u8, false),
                    .u16 => this._buf.append(bun.windows.long_path_prefix, false),
                    .os => if (Environment.isWindows)
                        this._buf.append(bun.windows.long_path_prefix, false)
                    else
                        this._buf.append(bun.windows.long_path_prefix_u8, false),
                }
            }

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
        pub fn fromLongPath(input: anytype) Result(@This()) {
            switch (comptime @TypeOf(input)) {
                []u8, []const u8, [:0]u8, [:0]const u8 => {},
                []u16, []const u16, [:0]u16, [:0]const u16 => {},
                else => @compileError("unsupported type: " ++ @typeName(@TypeOf(input))),
            }
            const trimmed = switch (comptime opts.kind) {
                .abs => trimmed: {
                    bun.debugAssert(isInputAbsolute(input));
                    break :trimmed trimInput(.abs, input);
                },
                .rel => trimmed: {
                    bun.debugAssert(!isInputAbsolute(input));
                    break :trimmed trimInput(.rel, input);
                },
                .any => trimInput(if (isInputAbsolute(input)) .abs else .rel, input),
            };

            if (comptime opts.check_length == .check_for_greater_than_max_path) {
                if (trimmed.len >= opts.maxPathLength()) {
                    return error.MaxPathExceeded;
                }
            }

            var this = init();
            if (comptime Environment.isWindows) {
                switch (comptime opts.unit) {
                    .u8 => this._buf.append(bun.windows.long_path_prefix_u8, false),
                    .u16 => this._buf.append(bun.windows.long_path_prefix, false),
                    .os => if (Environment.isWindows)
                        this._buf.append(bun.windows.long_path_prefix, false)
                    else
                        this._buf.append(bun.windows.long_path_prefix_u8, false),
                }
            }

            this._buf.append(trimmed, false);
            return this;
        }
        pub fn from(input: anytype) Result(@This()) {
            const trimmed = switch (comptime opts.kind) {
                .abs => trimmed: {
                    bun.debugAssert(isInputAbsolute(input));
                    break :trimmed trimInput(.abs, input);
                },
                .rel => trimmed: {
                    bun.debugAssert(!isInputAbsolute(input));
                    break :trimmed trimInput(.rel, input);
                },
                .any => trimInput(if (isInputAbsolute(input)) .abs else .rel, input),
            };

            if (comptime opts.check_length == .check_for_greater_than_max_path) {
                if (trimmed.len >= opts.maxPathLength()) {
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
                .any => isInputAbsolute(this.slice()),
            };
        }

        pub fn basename(this: *const @This()) []const opts.pathUnit() {
            return bun.strings.basename(opts.pathUnit(), this.slice());
        }

        pub fn basenameZ(this: *const @This()) [:0]const opts.pathUnit() {
            const full = this.sliceZ();
            const base = bun.strings.basename(opts.pathUnit(), full);
            return full[full.len - base.len ..][0..base.len :0];
        }

        pub fn dirname(this: *const @This()) ?[]const opts.pathUnit() {
            return bun.Dirname.dirname(opts.pathUnit(), this.slice());
        }

        pub fn slice(this: *const @This()) []const opts.pathUnit() {
            switch (comptime opts.buf_type) {
                .pool => return this._buf.pooled[0..this._buf.len],
            }
        }

        pub fn sliceZ(this: *const @This()) [:0]const opts.pathUnit() {
            switch (comptime opts.buf_type) {
                .pool => {
                    this._buf.pooled[this._buf.len] = 0;
                    return this._buf.pooled[0..this._buf.len :0];
                },
            }
        }

        pub fn buf(this: *const @This()) []opts.pathUnit() {
            switch (comptime opts.buf_type) {
                .pool => {
                    return this._buf.pooled;
                },
            }
        }

        pub fn setLength(this: *@This(), new_length: usize) void {
            this._buf.setLength(new_length);

            const trimmed = switch (comptime opts.kind) {
                .abs => trimInput(.abs, this.slice()),
                .rel => trimInput(.rel, this.slice()),
                .any => trimmed: {
                    if (this.isAbsolute()) {
                        break :trimmed trimInput(.abs, this.slice());
                    }

                    break :trimmed trimInput(.rel, this.slice());
                },
            };

            this._buf.setLength(trimmed.len);
        }

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

        pub fn rootLen(input: anytype) ?usize {
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

        const TrimInputKind = enum {
            abs,
            rel,
        };

        fn trimInput(kind: TrimInputKind, input: anytype) []const opts.inputChildType(@TypeOf(input)) {
            var trimmed: []const opts.inputChildType(@TypeOf(input)) = input[0..];

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

        fn isInputAbsolute(input: anytype) bool {
            if (input.len == 0) {
                return false;
            }

            if (input[0] == '/') {
                return true;
            }

            if (comptime Environment.isWindows) {
                if (input[0] == '\\') {
                    return true;
                }

                if (input.len < 3) {
                    return false;
                }

                if (input[1] == ':' and switch (input[2]) {
                    '/', '\\' => true,
                    else => false,
                }) {
                    return true;
                }
            }

            return false;
        }

        pub fn append(this: *@This(), input: anytype) Result(void) {
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
                            bun.debugAssert(!isInputAbsolute(input));
                        } else {
                            bun.debugAssert(isInputAbsolute(input));
                        }
                    }

                    const trimmed = trimInput(if (has_root) .rel else .abs, input);

                    if (trimmed.len == 0) {
                        return;
                    }

                    if (comptime opts.check_length == .check_for_greater_than_max_path) {
                        if (this.len() + trimmed.len + @intFromBool(needs_sep) >= opts.maxPathLength()) {
                            return error.MaxPathExceeded;
                        }
                    }

                    this._buf.append(trimmed, needs_sep);
                },
                .rel => {
                    bun.debugAssert(!isInputAbsolute(input));

                    const trimmed = trimInput(.rel, input);

                    if (trimmed.len == 0) {
                        return;
                    }

                    if (comptime opts.check_length == .check_for_greater_than_max_path) {
                        if (this.len() + trimmed.len + @intFromBool(needs_sep) >= opts.maxPathLength()) {
                            return error.MaxPathExceeded;
                        }
                    }

                    this._buf.append(trimmed, needs_sep);
                },
                .any => {
                    const input_is_absolute = isInputAbsolute(input);

                    if (comptime Environment.isDebug) {
                        if (needs_sep) {
                            bun.debugAssert(!input_is_absolute);
                        }
                    }

                    const trimmed = trimInput(if (this.len() > 0)
                        // anything appended to an existing path should be trimmed
                        // as a relative path
                        .rel
                    else if (isInputAbsolute(input))
                        // path is empty, trim based on input
                        .abs
                    else
                        .rel, input);

                    if (trimmed.len == 0) {
                        return;
                    }

                    if (comptime opts.check_length == .check_for_greater_than_max_path) {
                        if (this.len() + trimmed.len + @intFromBool(needs_sep) >= opts.maxPathLength()) {
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

        pub fn join(this: *@This(), parts: []const []const opts.pathUnit()) Result(void) {
            switch (comptime opts.unit) {
                .u8 => {},
                .u16 => @compileError("unsupported unit type"),
                .os => if (Environment.isWindows) @compileError("unsupported unit type"),
            }

            switch (comptime opts.kind) {
                .abs => {},
                .rel => @compileError("cannot join with relative path"),
                .any => {
                    bun.debugAssert(this.isAbsolute());
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

        pub fn appendJoin(this: *@This(), part: anytype) Result(void) {
            switch (comptime opts.kind) {
                .abs => {},
                .rel => @compileError("cannot join with relative path"),
                .any => {
                    bun.debugAssert(this.isAbsolute());
                },
            }

            switch (comptime @TypeOf(part)) {
                []u8, []const u8 => {
                    switch (comptime opts.pathUnit()) {
                        u8 => {
                            const cwd_path_buf = bun.path_buffer_pool.get();
                            defer bun.path_buffer_pool.put(cwd_path_buf);
                            const current_slice = this.slice();
                            const cwd_path = cwd_path_buf[0..current_slice.len];
                            bun.copy(u8, cwd_path, current_slice);

                            const joined = bun.path.joinStringBuf(
                                this._buf.pooled,
                                &[_][]const u8{ cwd_path, part },
                                switch (opts.sep) {
                                    .any, .auto => .auto,
                                    .posix => .posix,
                                    .windows => .windows,
                                },
                            );

                            const trimmed = trimInput(.abs, joined);
                            this._buf.len = trimmed.len;
                        },
                        u16 => {
                            const path_buf = bun.w_path_buffer_pool.get();
                            defer bun.w_path_buffer_pool.put(path_buf);
                            const converted = bun.strings.convertUTF8toUTF16InBuffer(path_buf, part);
                            return this.appendJoin(converted);
                        },
                        else => @compileError("unsupported unit type"),
                    }
                },
                []u16, []const u16 => {
                    switch (comptime opts.pathUnit()) {
                        u16 => {
                            const cwd_path_buf = bun.w_path_buffer_pool.get();
                            defer bun.w_path_buffer_pool.put(cwd_path_buf);
                            const current_slice = this.slice();
                            const cwd_path = cwd_path_buf[0..current_slice.len];
                            bun.copy(u16, cwd_path, current_slice);

                            const joined = bun.path.joinStringBufW(
                                this._buf.pooled,
                                &[_][]const u16{ cwd_path, part },
                                switch (opts.sep) {
                                    .any, .auto => .auto,
                                    .posix => .posix,
                                    .windows => .windows,
                                },
                            );

                            const trimmed = trimInput(.abs, joined);
                            this._buf.len = trimmed.len;
                        },
                        u8 => {
                            const path_buf = bun.path_buffer_pool.get();
                            defer bun.path_buffer_pool.put(path_buf);
                            const converted = bun.strings.convertUTF16toUTF8InBuffer(path_buf, part) catch {
                                return .initError(.MaxPathExceeded);
                            };
                            return this.appendJoin(converted);
                        },
                        else => @compileError("unsupported unit type"),
                    }
                },
                else => @compileError("unsupported type: " ++ @typeName(@TypeOf(part))),
            }
        }

        pub fn relative(this: *const @This(), to: anytype) RelPath(opts) {
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
                    .any => std.mem.lastIndexOfAny(opts.pathUnit(), this.slice(), &.{ std.fs.path.sep_posix, std.fs.path.sep_windows }),
                    .auto => std.mem.lastIndexOfScalar(opts.pathUnit(), this.slice(), std.fs.path.sep),
                    .posix => std.mem.lastIndexOfScalar(opts.pathUnit(), this.slice(), std.fs.path.sep_posix),
                    .windows => std.mem.lastIndexOfScalar(opts.pathUnit(), this.slice(), std.fs.path.sep_windows),
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

const std = @import("std");

const bun = @import("bun");
const Environment = bun.Environment;
const FD = bun.FD;
const Output = bun.Output;
const PathBuffer = bun.PathBuffer;
const WPathBuffer = bun.WPathBuffer;
