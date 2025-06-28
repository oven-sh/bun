const ExternalStringList = @import("./install.zig").ExternalStringList;
const Semver = bun.Semver;
const ExternalString = Semver.ExternalString;
const String = Semver.String;
const std = @import("std");
const strings = bun.strings;
const Environment = @import("../env.zig");
const stringZ = bun.stringZ;
const bun = @import("bun");
const path = bun.path;
const string = bun.string;
const Install = @import("./install.zig");
const Dependency = @import("./dependency.zig");
const OOM = bun.OOM;
const JSON = bun.JSON;
const Lockfile = Install.Lockfile;

/// Normalized `bin` field in [package.json](https://docs.npmjs.com/cli/v8/configuring-npm/package-json#bin)
/// Can be a:
/// - file path (relative to the package root)
/// - directory (relative to the package root)
/// - map where keys are names of the binaries and values are file paths to the binaries
pub const Bin = extern struct {
    tag: Tag = Tag.none,
    _padding_tag: [3]u8 = .{0} ** 3,

    // Largest member must be zero initialized
    value: Value = Value{ .map = ExternalStringList{} },

    pub fn count(this: *const Bin, buf: []const u8, extern_strings: []const ExternalString, comptime StringBuilder: type, builder: StringBuilder) u32 {
        switch (this.tag) {
            .file => builder.count(this.value.file.slice(buf)),
            .named_file => {
                builder.count(this.value.named_file[0].slice(buf));
                builder.count(this.value.named_file[1].slice(buf));
            },
            .dir => builder.count(this.value.dir.slice(buf)),
            .map => {
                const list = this.value.map.get(extern_strings);
                for (list) |*extern_string| {
                    builder.count(extern_string.slice(buf));
                }
                return @as(u32, @truncate(list.len));
            },
            else => {},
        }

        return 0;
    }

    pub fn eql(
        l: *const Bin,
        r: *const Bin,
        l_buf: string,
        l_extern_strings: []const ExternalString,
        r_buf: string,
        r_extern_strings: []const ExternalString,
    ) bool {
        if (l.tag != r.tag) return false;

        return switch (l.tag) {
            .none => true,
            .file => l.value.file.eql(r.value.file, l_buf, r_buf),
            .dir => l.value.dir.eql(r.value.dir, l_buf, r_buf),
            .named_file => l.value.named_file[0].eql(r.value.named_file[0], l_buf, r_buf) and
                l.value.named_file[1].eql(r.value.named_file[1], l_buf, r_buf),
            .map => {
                const l_list = l.value.map.get(l_extern_strings);
                const r_list = r.value.map.get(r_extern_strings);
                if (l_list.len != r_list.len) return false;

                // assuming these maps are small without duplicate keys
                var i: usize = 0;
                outer: while (i < l_list.len) : (i += 2) {
                    var j: usize = 0;
                    while (j < r_list.len) : (j += 2) {
                        if (l_list[i].hash == r_list[j].hash) {
                            if (l_list[i + 1].hash != r_list[j + 1].hash) {
                                return false;
                            }

                            continue :outer;
                        }
                    }

                    // not found
                    return false;
                }

                return true;
            },
        };
    }

    pub fn clone(this: *const Bin, buf: []const u8, prev_external_strings: []const ExternalString, all_extern_strings: []ExternalString, extern_strings_slice: []ExternalString, comptime StringBuilder: type, builder: StringBuilder) Bin {
        switch (this.tag) {
            .none => {
                return Bin{
                    .tag = .none,
                    .value = Value.init(.{ .none = {} }),
                };
            },
            .file => {
                return Bin{
                    .tag = .file,
                    .value = Value.init(.{ .file = builder.append(String, this.value.file.slice(buf)) }),
                };
            },
            .named_file => {
                return Bin{
                    .tag = .named_file,
                    .value = Value.init(
                        .{
                            .named_file = [2]String{
                                builder.append(String, this.value.named_file[0].slice(buf)),
                                builder.append(String, this.value.named_file[1].slice(buf)),
                            },
                        },
                    ),
                };
            },
            .dir => {
                return Bin{
                    .tag = .dir,
                    .value = Value.init(.{ .dir = builder.append(String, this.value.dir.slice(buf)) }),
                };
            },
            .map => {
                for (this.value.map.get(prev_external_strings), 0..) |extern_string, i| {
                    extern_strings_slice[i] = builder.append(ExternalString, extern_string.slice(buf));
                }

                return Bin{
                    .tag = .map,
                    .value = Value.init(.{ .map = ExternalStringList.init(all_extern_strings, extern_strings_slice) }),
                };
            },
        }

        unreachable;
    }

    pub fn cloneAppend(this: *const Bin, this_buf: string, this_extern_strings: []const ExternalString, lockfile: *Lockfile) OOM!Bin {
        var string_buf = lockfile.stringBuf();
        defer string_buf.apply(lockfile);

        const cloned: Bin = .{
            .tag = this.tag,

            .value = switch (this.tag) {
                .none => Value.init(.{ .none = {} }),
                .file => Value.init(.{
                    .file = try string_buf.append(this.value.file.slice(this_buf)),
                }),
                .named_file => Value.init(.{ .named_file = .{
                    try string_buf.append(this.value.named_file[0].slice(this_buf)),
                    try string_buf.append(this.value.named_file[1].slice(this_buf)),
                } }),
                .dir => Value.init(.{
                    .dir = try string_buf.append(this.value.dir.slice(this_buf)),
                }),
                .map => map: {
                    const off = lockfile.buffers.extern_strings.items.len;
                    for (this.value.map.get(this_extern_strings)) |extern_string| {
                        try lockfile.buffers.extern_strings.append(
                            lockfile.allocator,
                            try string_buf.appendExternal(extern_string.slice(this_buf)),
                        );
                    }
                    const new = lockfile.buffers.extern_strings.items[off..];
                    break :map Value.init(.{
                        .map = ExternalStringList.init(lockfile.buffers.extern_strings.items, new),
                    });
                },
            },
        };

        return cloned;
    }

    /// Used for packages read from text lockfile.
    pub fn parseAppend(
        allocator: std.mem.Allocator,
        bin_expr: JSON.Expr,
        buf: *String.Buf,
        extern_strings: *std.ArrayListUnmanaged(ExternalString),
    ) OOM!Bin {
        switch (bin_expr.data) {
            .e_object => |obj| {
                switch (obj.properties.len) {
                    0 => {},
                    1 => {
                        const bin_name = obj.properties.ptr[0].key.?.asString(allocator) orelse return .{};
                        const value = obj.properties.ptr[0].value.?.asString(allocator) orelse return .{};

                        return .{
                            .tag = .named_file,
                            .value = .{
                                .named_file = .{
                                    try buf.append(bin_name),
                                    try buf.append(value),
                                },
                            },
                        };
                    },
                    else => {
                        const current_len = extern_strings.items.len;
                        const num_props: usize = obj.properties.len * 2;
                        try extern_strings.ensureTotalCapacityPrecise(
                            allocator,
                            current_len + num_props,
                        );
                        var new = extern_strings.items.ptr[current_len .. current_len + num_props];
                        extern_strings.items.len += num_props;

                        var i: usize = 0;
                        for (obj.properties.slice()) |bin_prop| {
                            const key = bin_prop.key.?;
                            const value = bin_prop.value.?;
                            const key_str = key.asString(allocator) orelse return .{};
                            const value_str = value.asString(allocator) orelse return .{};
                            new[i] = try buf.appendExternal(key_str);
                            i += 1;
                            new[i] = try buf.appendExternal(value_str);
                            i += 1;
                        }
                        if (comptime Environment.allow_assert) {
                            bun.assert(i == new.len);
                        }
                        return .{
                            .tag = .map,
                            .value = .{
                                .map = ExternalStringList.init(extern_strings.items, new),
                            },
                        };
                    },
                }
            },
            .e_string => |str| {
                if (str.data.len > 0) {
                    return .{
                        .tag = .file,
                        .value = .{
                            .file = try buf.append(str.data),
                        },
                    };
                }
            },
            else => {},
        }
        return .{};
    }

    pub fn parseAppendFromDirectories(allocator: std.mem.Allocator, bin_expr: JSON.Expr, buf: *String.Buf) OOM!Bin {
        if (bin_expr.asString(allocator)) |bin_str| {
            return .{
                .tag = .dir,
                .value = .{
                    .dir = try buf.append(bin_str),
                },
            };
        }
        return .{};
    }

    pub fn toJson(
        this: *const Bin,
        comptime style: enum { single_line, multi_line },
        indent: if (style == .multi_line) *u32 else void,
        buf: string,
        extern_strings: []const ExternalString,
        writer: anytype,
        writeIndent: *const fn (anytype, *u32) @TypeOf(writer).Error!void,
    ) @TypeOf(writer).Error!void {
        bun.debugAssert(this.tag != .none);
        if (comptime style == .single_line) {
            switch (this.tag) {
                .none => {},
                .file => {
                    try writer.print("{}", .{this.value.file.fmtJson(buf, .{})});
                },
                .named_file => {
                    try writer.writeByte('{');
                    try writer.print(" {}: {} ", .{
                        this.value.named_file[0].fmtJson(buf, .{}),
                        this.value.named_file[1].fmtJson(buf, .{}),
                    });
                    try writer.writeByte('}');
                },
                .dir => {
                    try writer.print("{}", .{this.value.dir.fmtJson(buf, .{})});
                },
                .map => {
                    try writer.writeByte('{');
                    const list = this.value.map.get(extern_strings);
                    var first = true;
                    var i: usize = 0;
                    while (i < list.len) : (i += 2) {
                        if (!first) {
                            try writer.writeByte(',');
                        }
                        first = false;
                        try writer.print(" {}: {}", .{
                            list[i].value.fmtJson(buf, .{}),
                            list[i + 1].value.fmtJson(buf, .{}),
                        });
                    }
                    try writer.writeAll(" }");
                },
            }

            return;
        }

        switch (this.tag) {
            .none => {},
            .file => {
                try writer.print("{}", .{this.value.file.fmtJson(buf, .{})});
            },
            .named_file => {
                try writer.writeAll("{\n");
                indent.* += 1;
                try writeIndent(writer, indent);
                try writer.print("{}: {},\n", .{
                    this.value.named_file[0].fmtJson(buf, .{}),
                    this.value.named_file[1].fmtJson(buf, .{}),
                });
                indent.* -= 1;
                try writeIndent(writer, indent);
                try writer.writeByte('}');
            },
            .dir => {
                try writer.print("{}", .{this.value.dir.fmtJson(buf, .{})});
            },
            .map => {
                try writer.writeByte('{');
                indent.* += 1;

                const list = this.value.map.get(extern_strings);
                var any = false;
                var i: usize = 0;
                while (i < list.len) : (i += 2) {
                    if (!any) {
                        any = true;
                        try writer.writeByte('\n');
                    }
                    try writeIndent(writer, indent);
                    try writer.print("{}: {},\n", .{
                        list[i].value.fmtJson(buf, .{}),
                        list[i + 1].value.fmtJson(buf, .{}),
                    });
                }
                if (!any) {
                    try writer.writeByte('}');
                    indent.* -= 1;
                    return;
                }

                indent.* -= 1;
                try writeIndent(writer, indent);
                try writer.writeByte('}');
            },
        }
    }

    pub fn init() Bin {
        return bun.serializable(Bin{ .tag = .none, .value = Value.init(.{ .none = {} }) });
    }

    pub const Value = extern union {
        /// no "bin", or empty "bin"
        none: void,

        /// "bin" is a string
        /// ```
        /// "bin": "./bin/foo",
        /// ```
        file: String,

        // Single-entry map
        ///```
        /// "bin": {
        ///     "babel": "./cli.js",
        /// }
        ///```
        named_file: [2]String,

        /// "bin" is a directory
        ///```
        /// "dirs": {
        ///     "bin": "./bin",
        /// }
        ///```
        dir: String,
        // "bin" is a map
        ///```
        /// "bin": {
        ///     "babel": "./cli.js",
        ///     "babel-cli": "./cli.js",
        /// }
        ///```
        map: ExternalStringList,

        /// To avoid undefined memory between union values, we must zero initialize the union first.
        pub fn init(field: anytype) Value {
            return bun.serializableInto(Value, field);
        }
    };

    pub const Tag = enum(u8) {
        /// no bin field
        none = 0,

        /// "bin" is a string
        /// ```
        /// "bin": "./bin/foo",
        /// ```
        file = 1,

        // Single-entry map
        ///```
        /// "bin": {
        ///     "babel": "./cli.js",
        /// }
        ///```
        named_file = 2,

        /// "bin" is a directory
        ///```
        /// "dirs": {
        ///     "bin": "./bin",
        /// }
        ///```
        dir = 3,

        // "bin" is a map of more than one
        ///```
        /// "bin": {
        ///     "babel": "./cli.js",
        ///     "babel-cli": "./cli.js",
        ///     "webpack-dev-server": "./cli.js",
        /// }
        ///```
        map = 4,
    };

    pub const NamesIterator = struct {
        bin: Bin,
        i: usize = 0,
        done: bool = false,
        dir_iterator: ?std.fs.Dir.Iterator = null,
        package_name: String,
        destination_node_modules: std.fs.Dir = bun.invalid_fd.stdDir(),
        buf: bun.PathBuffer = undefined,
        string_buffer: []const u8,
        extern_string_buf: []const ExternalString,

        fn nextInDir(this: *NamesIterator) !?[]const u8 {
            if (this.done) return null;
            if (this.dir_iterator == null) {
                var target = this.bin.value.dir.slice(this.string_buffer);
                if (strings.hasPrefixComptime(target, "./") or strings.hasPrefixComptime(target, ".\\")) {
                    target = target[2..];
                }
                var parts = [_][]const u8{ this.package_name.slice(this.string_buffer), target };

                const dir = this.destination_node_modules;

                const joined = path.joinStringBuf(&this.buf, &parts, .auto);
                this.buf[joined.len] = 0;
                const joined_: [:0]u8 = this.buf[0..joined.len :0];
                var child_dir = try bun.openDir(dir, joined_);
                this.dir_iterator = child_dir.iterate();
            }

            var iter = &this.dir_iterator.?;
            if (iter.next() catch null) |entry| {
                this.i += 1;
                return entry.name;
            } else {
                this.done = true;
                this.dir_iterator.?.dir.close();
                this.dir_iterator = null;
                return null;
            }
        }

        /// next filename, e.g. "babel" instead of "cli.js"
        pub fn next(this: *NamesIterator) !?[]const u8 {
            switch (this.bin.tag) {
                .file => {
                    if (this.i > 0) return null;
                    this.i += 1;
                    this.done = true;
                    const base = std.fs.path.basename(this.package_name.slice(this.string_buffer));
                    if (strings.hasPrefixComptime(base, "./") or strings.hasPrefixComptime(base, ".\\"))
                        return strings.copy(&this.buf, base[2..]);

                    return strings.copy(&this.buf, base);
                },
                .named_file => {
                    if (this.i > 0) return null;
                    this.i += 1;
                    this.done = true;
                    const base = std.fs.path.basename(this.bin.value.named_file[0].slice(this.string_buffer));
                    if (strings.hasPrefixComptime(base, "./") or strings.hasPrefixComptime(base, ".\\"))
                        return strings.copy(&this.buf, base[2..]);
                    return strings.copy(&this.buf, base);
                },

                .dir => return try this.nextInDir(),
                .map => {
                    if (this.i >= this.bin.value.map.len) return null;
                    const index = this.i;
                    this.i += 2;
                    this.done = this.i >= this.bin.value.map.len;
                    const current_string = this.bin.value.map.get(
                        this.extern_string_buf,
                    )[index];

                    const base = std.fs.path.basename(
                        current_string.slice(
                            this.string_buffer,
                        ),
                    );
                    if (strings.hasPrefixComptime(base, "./") or strings.hasPrefixComptime(base, ".\\"))
                        return strings.copy(&this.buf, base[2..]);
                    return strings.copy(&this.buf, base);
                },
                else => return null,
            }
        }
    };

    pub const PriorityQueueContext = struct {
        dependencies: *const std.ArrayListUnmanaged(Dependency),
        string_buf: *const std.ArrayListUnmanaged(u8),

        pub fn lessThan(this: PriorityQueueContext, a: Install.DependencyID, b: Install.DependencyID) std.math.Order {
            const deps = this.dependencies.items;
            const buf = this.string_buf.items;
            const a_name = deps[a].name.slice(buf);
            const b_name = deps[b].name.slice(buf);
            return strings.order(a_name, b_name);
        }
    };

    pub const PriorityQueue = std.PriorityQueue(Install.DependencyID, PriorityQueueContext, PriorityQueueContext.lessThan);

    // https://github.com/npm/npm-normalize-package-bin/blob/574e6d7cd21b2f3dee28a216ec2053c2551f7af9/lib/index.js#L38
    pub fn normalizedBinName(name: []const u8) []const u8 {
        if (std.mem.lastIndexOfAny(u8, name, "/\\:")) |i| {
            return name[i + 1 ..];
        }

        return name;
    }

    pub const Linker = struct {
        bin: Bin,

        // Hash map of seen destination paths for this `node_modules/.bin` folder. PackageInstaller will reset it before
        // linking each tree.
        seen: ?*bun.StringHashMap(void),

        node_modules: bun.FileDescriptor,
        node_modules_path: []const u8,

        /// Used for generating relative paths
        package_name: strings.StringOrTinyString,

        global_bin_path: stringZ = "",

        string_buf: []const u8,
        extern_string_buf: []const ExternalString,

        abs_target_buf: []u8,
        abs_dest_buf: []u8,
        rel_buf: []u8,

        err: ?anyerror = null,

        pub var umask: bun.Mode = 0;

        var has_set_umask = false;

        pub fn ensureUmask() void {
            if (!has_set_umask) {
                has_set_umask = true;
                umask = bun.sys.umask(0);
            }
        }

        fn unlinkBinOrShim(abs_dest: [:0]const u8) void {
            if (comptime !Environment.isWindows) {
                _ = bun.sys.unlink(abs_dest);
                return;
            }

            var dest_buf: bun.WPathBuffer = undefined;
            const abs_dest_w = strings.convertUTF8toUTF16InBuffer(&dest_buf, abs_dest);
            @memcpy(dest_buf[abs_dest_w.len..][0..".bunx\x00".len], comptime strings.literal(u16, ".bunx\x00"));
            const abs_bunx_file: [:0]const u16 = dest_buf[0 .. abs_dest_w.len + ".bunx".len :0];
            _ = bun.sys.unlinkW(abs_bunx_file);
            @memcpy(dest_buf[abs_dest_w.len..][0..".exe\x00".len], comptime strings.literal(u16, ".exe\x00"));
            const abs_exe_file: [:0]const u16 = dest_buf[0 .. abs_dest_w.len + ".exe".len :0];
            _ = bun.sys.unlinkW(abs_exe_file);
        }

        fn linkBinOrCreateShim(this: *Linker, abs_target: [:0]const u8, abs_dest: [:0]const u8, global: bool) void {
            bun.assertWithLocation(std.fs.path.isAbsolute(abs_target), @src());
            bun.assertWithLocation(std.fs.path.isAbsolute(abs_dest), @src());
            bun.assertWithLocation(abs_target[abs_target.len - 1] != std.fs.path.sep, @src());
            bun.assertWithLocation(abs_dest[abs_dest.len - 1] != std.fs.path.sep, @src());

            if (this.seen) |seen| {
                // Skip seen destinations for this tree
                // https://github.com/npm/cli/blob/22731831e22011e32fa0ca12178e242c2ee2b33d/node_modules/bin-links/lib/link-gently.js#L30
                const entry = seen.getOrPut(abs_dest) catch bun.outOfMemory();
                if (entry.found_existing) {
                    return;
                }
                entry.key_ptr.* = seen.allocator.dupe(u8, abs_dest) catch bun.outOfMemory();
            }

            // Skip if the target does not exist. This is important because placing a dangling
            // shim in path might break a postinstall
            if (!bun.sys.exists(abs_target)) {
                return;
            }

            bun.Analytics.Features.binlinks += 1;

            if (comptime !Environment.isWindows)
                this.createSymlink(abs_target, abs_dest, global)
            else {
                const target = bun.sys.openat(.cwd(), abs_target, bun.O.RDONLY, 0).unwrap() catch |err| {
                    if (err != error.EISDIR) {
                        // ignore directories, creating a shim for one won't do anything
                        this.err = err;
                    }
                    return;
                };
                defer target.close();
                this.createWindowsShim(target, abs_target, abs_dest, global);
            }

            if (this.err != null) {
                // cleanup on error just in case
                unlinkBinOrShim(abs_dest);
                return;
            }

            if (comptime !Environment.isWindows) {
                // any error here is ignored
                const bin = bun.sys.File.openat(.cwd(), abs_target, bun.O.RDWR, 0o664).unwrap() catch return;
                defer bin.close();

                var shebang_buf: [1024]u8 = undefined;
                const read = bin.read(&shebang_buf).unwrap() catch return;
                const chunk = shebang_buf[0..read];
                // 123 4 5
                // #!a\r\n
                if (chunk.len < 5 or chunk[0] != '#' or chunk[1] != '!') return;

                if (strings.indexOfChar(chunk, '\n')) |newline| {
                    if (newline > 0 and chunk[newline - 1] == '\r') {
                        const pos = newline - 1;
                        bin.handle.stdFile().seekTo(pos) catch return;
                        bin.writeAll("\n").unwrap() catch return;
                    }
                }
            }
        }

        fn createWindowsShim(this: *Linker, target: bun.FileDescriptor, abs_target: [:0]const u8, abs_dest: [:0]const u8, global: bool) void {
            const WinBinLinkingShim = @import("./windows-shim/BinLinkingShim.zig");

            var shim_buf: [65536]u8 = undefined;
            var read_in_buf: [WinBinLinkingShim.Shebang.max_shebang_input_length]u8 = undefined;
            var dest_buf: bun.WPathBuffer = undefined;
            var target_buf: bun.WPathBuffer = undefined;

            const abs_dest_w = strings.convertUTF8toUTF16InBuffer(&dest_buf, abs_dest);
            @memcpy(dest_buf[abs_dest_w.len..][0..".bunx\x00".len], comptime strings.literal(u16, ".bunx\x00"));

            const abs_bunx_file: [:0]const u16 = dest_buf[0 .. abs_dest_w.len + ".bunx".len :0];

            const bunx_file = bun.sys.File.openatOSPath(bun.invalid_fd, abs_bunx_file, bun.O.WRONLY | bun.O.CREAT | bun.O.TRUNC, 0o664).unwrap() catch |err| bunx_file: {
                if (err != error.ENOENT or global) {
                    this.err = err;
                    return;
                }

                bun.makePath(this.node_modules.stdDir(), ".bin") catch {};
                break :bunx_file bun.sys.File.openatOSPath(bun.invalid_fd, abs_bunx_file, bun.O.WRONLY | bun.O.CREAT | bun.O.TRUNC, 0o664).unwrap() catch |real_err| {
                    this.err = real_err;
                    return;
                };
            };
            defer bunx_file.close();

            const rel_target = path.relativeBufZ(this.rel_buf, path.dirname(abs_dest, .auto), abs_target);
            bun.assertWithLocation(strings.hasPrefixComptime(rel_target, "..\\"), @src());

            const rel_target_w = strings.toWPathNormalized(&target_buf, rel_target["..\\".len..]);

            const shebang = shebang: {
                const first_content_chunk = contents: {
                    const reader = target.stdFile().reader();
                    const read = reader.read(&read_in_buf) catch break :contents null;
                    if (read == 0) break :contents null;
                    break :contents read_in_buf[0..read];
                };

                if (first_content_chunk) |chunk| {
                    break :shebang WinBinLinkingShim.Shebang.parse(chunk, rel_target_w) catch {
                        this.err = error.InvalidBinCount;
                        return;
                    };
                } else {
                    break :shebang WinBinLinkingShim.Shebang.parseFromBinPath(rel_target_w);
                }
            };

            const shim = WinBinLinkingShim{
                .bin_path = rel_target_w,
                .shebang = shebang,
            };

            const len = shim.encodedLength();
            if (len > shim_buf.len) {
                this.err = error.InvalidBinContent;
                return;
            }

            const metadata = shim_buf[0..len];
            shim.encodeInto(metadata) catch {
                this.err = error.InvalidBinContent;
                return;
            };

            bunx_file.writer().writeAll(metadata) catch |err| {
                this.err = err;
                return;
            };

            @memcpy(dest_buf[abs_dest_w.len..][0..".exe\x00".len], comptime strings.literal(u16, ".exe\x00"));
            const abs_exe_file: [:0]const u16 = dest_buf[0 .. abs_dest_w.len + ".exe".len :0];

            bun.sys.File.writeFile(bun.invalid_fd, abs_exe_file, WinBinLinkingShim.embedded_executable_data).unwrap() catch |err| {
                if (err == error.EBUSY) {
                    // exe is most likely running. bunx file has already been updated, ignore error
                    return;
                }

                this.err = err;
                return;
            };
        }

        fn createSymlink(this: *Linker, abs_target: [:0]const u8, abs_dest: [:0]const u8, global: bool) void {
            defer {
                if (this.err == null) {
                    _ = bun.sys.chmod(abs_target, umask | 0o777);
                }
            }

            const abs_dest_dir = path.dirname(abs_dest, .auto);
            const rel_target = path.relativeBufZ(this.rel_buf, abs_dest_dir, abs_target);

            bun.assertWithLocation(strings.hasPrefixComptime(rel_target, ".."), @src());

            switch (bun.sys.symlink(rel_target, abs_dest)) {
                .err => |err| {
                    if (err.getErrno() != .EXIST and err.getErrno() != .NOENT) {
                        this.err = err.toZigErr();
                        return;
                    }

                    // ENOENT means `.bin` hasn't been created yet. Should only happen if this isn't global
                    if (err.getErrno() == .NOENT) {
                        if (global) {
                            this.err = err.toZigErr();
                            return;
                        }

                        bun.makePath(this.node_modules.stdDir(), ".bin") catch {};
                        switch (bun.sys.symlink(rel_target, abs_dest)) {
                            .err => |real_error| {
                                // It was just created, no need to delete destination and symlink again
                                this.err = real_error.toZigErr();
                                return;
                            },
                            .result => return,
                        }
                        bun.sys.symlink(rel_target, abs_dest).unwrap() catch |real_err| {
                            this.err = real_err;
                        };
                        return;
                    }

                    // beyond this error can only be `.EXIST`
                    bun.assertWithLocation(err.getErrno() == .EXIST, @src());
                },
                .result => return,
            }

            // delete and try again
            std.fs.deleteTreeAbsolute(abs_dest) catch {};
            bun.sys.symlink(rel_target, abs_dest).unwrap() catch |err| {
                this.err = err;
            };
        }

        /// uses `this.abs_target_buf`
        pub fn buildTargetPackageDir(this: *const Linker) []const u8 {
            const dest_dir_without_trailing_slash = strings.withoutTrailingSlash(this.node_modules_path);

            var remain = this.abs_target_buf;

            @memcpy(remain[0..dest_dir_without_trailing_slash.len], dest_dir_without_trailing_slash);
            remain = remain[dest_dir_without_trailing_slash.len..];
            remain[0] = std.fs.path.sep;
            remain = remain[1..];

            const package_name = this.package_name.slice();
            @memcpy(remain[0..package_name.len], package_name);
            remain = remain[package_name.len..];
            remain[0] = std.fs.path.sep;
            remain = remain[1..];

            return this.abs_target_buf[0 .. @intFromPtr(remain.ptr) - @intFromPtr(this.abs_target_buf.ptr)];
        }

        pub fn buildDestinationDir(this: *const Linker, global: bool) []u8 {
            const dest_dir_without_trailing_slash = strings.withoutTrailingSlash(this.node_modules_path);

            var remain = this.abs_dest_buf;
            if (global) {
                const global_bin_path_without_trailing_slash = strings.withoutTrailingSlash(this.global_bin_path);
                @memcpy(remain[0..global_bin_path_without_trailing_slash.len], global_bin_path_without_trailing_slash);
                remain = remain[global_bin_path_without_trailing_slash.len..];
                remain[0] = std.fs.path.sep;
                remain = remain[1..];
            } else {
                @memcpy(remain[0..dest_dir_without_trailing_slash.len], dest_dir_without_trailing_slash);
                remain = remain[dest_dir_without_trailing_slash.len..];
                @memcpy(remain[0.."/.bin/".len], std.fs.path.sep_str ++ ".bin" ++ std.fs.path.sep_str);
                remain = remain["/.bin/".len..];
            }

            return remain;
        }

        // target: what the symlink points to
        // destination: where the symlink exists on disk
        pub fn link(this: *Linker, global: bool) void {
            const package_dir = this.buildTargetPackageDir();
            var abs_dest_buf_remain = this.buildDestinationDir(global);

            bun.assertWithLocation(this.bin.tag != .none, @src());

            switch (this.bin.tag) {
                .none => {},
                .file => {
                    const target = this.bin.value.file.slice(this.string_buf);
                    if (target.len == 0) return;

                    // for normalizing `target`
                    const abs_target = path.joinAbsStringZ(package_dir, &.{target}, .auto);

                    const unscoped_package_name = Dependency.unscopedPackageName(this.package_name.slice());
                    @memcpy(abs_dest_buf_remain[0..unscoped_package_name.len], unscoped_package_name);
                    abs_dest_buf_remain = abs_dest_buf_remain[unscoped_package_name.len..];
                    abs_dest_buf_remain[0] = 0;
                    const abs_dest_len = @intFromPtr(abs_dest_buf_remain.ptr) - @intFromPtr(this.abs_dest_buf.ptr);
                    const abs_dest: [:0]const u8 = this.abs_dest_buf[0..abs_dest_len :0];

                    this.linkBinOrCreateShim(abs_target, abs_dest, global);
                },
                .named_file => {
                    const name = this.bin.value.named_file[0].slice(this.string_buf);
                    const normalized_name = normalizedBinName(name);
                    const target = this.bin.value.named_file[1].slice(this.string_buf);
                    if (normalized_name.len == 0 or target.len == 0) return;

                    // for normalizing `target`
                    const abs_target = path.joinAbsStringZ(package_dir, &.{target}, .auto);

                    @memcpy(abs_dest_buf_remain[0..normalized_name.len], normalized_name);
                    abs_dest_buf_remain = abs_dest_buf_remain[normalized_name.len..];
                    abs_dest_buf_remain[0] = 0;
                    const abs_dest_len = @intFromPtr(abs_dest_buf_remain.ptr) - @intFromPtr(this.abs_dest_buf.ptr);
                    const abs_dest: [:0]const u8 = this.abs_dest_buf[0..abs_dest_len :0];

                    this.linkBinOrCreateShim(abs_target, abs_dest, global);
                },
                .map => {
                    var i = this.bin.value.map.begin();
                    const end = this.bin.value.map.end();

                    const abs_dest_dir_end = abs_dest_buf_remain;

                    while (i < end) : (i += 2) {
                        const bin_dest = this.extern_string_buf[i].slice(this.string_buf);
                        const normalized_bin_dest = normalizedBinName(bin_dest);
                        const bin_target = this.extern_string_buf[i + 1].slice(this.string_buf);
                        if (bin_target.len == 0 or normalized_bin_dest.len == 0) continue;

                        const abs_target = path.joinAbsStringZ(package_dir, &.{bin_target}, .auto);

                        abs_dest_buf_remain = abs_dest_dir_end;
                        @memcpy(abs_dest_buf_remain[0..normalized_bin_dest.len], normalized_bin_dest);
                        abs_dest_buf_remain = abs_dest_buf_remain[normalized_bin_dest.len..];
                        abs_dest_buf_remain[0] = 0;
                        const abs_dest_len = @intFromPtr(abs_dest_buf_remain.ptr) - @intFromPtr(this.abs_dest_buf.ptr);
                        const abs_dest: [:0]const u8 = this.abs_dest_buf[0..abs_dest_len :0];

                        this.linkBinOrCreateShim(abs_target, abs_dest, global);
                    }
                },
                .dir => {
                    const target = this.bin.value.dir.slice(this.string_buf);
                    if (target.len == 0) return;

                    // for normalizing `target`
                    const abs_target_dir = path.joinAbsStringZ(package_dir, &.{target}, .auto);

                    var target_dir = bun.openDirAbsolute(abs_target_dir) catch |err| {
                        if (err == error.ENOENT) {
                            // https://github.com/npm/cli/blob/366c07e2f3cb9d1c6ddbd03e624a4d73fbd2676e/node_modules/bin-links/lib/link-gently.js#L43
                            // avoid erroring when the directory does not exist
                            return;
                        }
                        this.err = err;
                        return;
                    };
                    defer target_dir.close();

                    const abs_dest_dir_end = abs_dest_buf_remain;

                    var iter = target_dir.iterate();
                    while (iter.next() catch null) |entry| {
                        switch (entry.kind) {
                            .sym_link, .file => {
                                // `this.abs_target_buf` is available now because `path.joinAbsStringZ` copied everything into `parse_join_input_buffer`
                                const abs_target = path.joinAbsStringBufZ(abs_target_dir, this.abs_target_buf, &.{entry.name}, .auto);

                                abs_dest_buf_remain = abs_dest_dir_end;
                                @memcpy(abs_dest_buf_remain[0..entry.name.len], entry.name);
                                abs_dest_buf_remain = abs_dest_buf_remain[entry.name.len..];
                                abs_dest_buf_remain[0] = 0;
                                const abs_dest_len = @intFromPtr(abs_dest_buf_remain.ptr) - @intFromPtr(this.abs_dest_buf.ptr);
                                const abs_dest: [:0]const u8 = this.abs_dest_buf[0..abs_dest_len :0];

                                this.linkBinOrCreateShim(abs_target, abs_dest, global);
                            },
                            else => {},
                        }
                    }
                },
            }
        }

        pub fn unlink(this: *Linker, global: bool) void {
            const package_dir = this.buildTargetPackageDir();
            var abs_dest_buf_remain = this.buildDestinationDir(global);

            bun.assertWithLocation(this.bin.tag != .none, @src());

            switch (this.bin.tag) {
                .none => {},
                .file => {
                    const unscoped_package_name = Dependency.unscopedPackageName(this.package_name.slice());
                    @memcpy(abs_dest_buf_remain[0..unscoped_package_name.len], unscoped_package_name);
                    abs_dest_buf_remain = abs_dest_buf_remain[unscoped_package_name.len..];
                    abs_dest_buf_remain[0] = 0;
                    const abs_dest_len = @intFromPtr(abs_dest_buf_remain.ptr) - @intFromPtr(this.abs_dest_buf.ptr);
                    const abs_dest: [:0]const u8 = this.abs_dest_buf[0..abs_dest_len :0];

                    unlinkBinOrShim(abs_dest);
                },
                .named_file => {
                    const name = this.bin.value.named_file[0].slice(this.string_buf);
                    const normalized_name = normalizedBinName(name);
                    if (normalized_name.len == 0) return;

                    @memcpy(abs_dest_buf_remain[0..normalized_name.len], normalized_name);
                    abs_dest_buf_remain = abs_dest_buf_remain[normalized_name.len..];
                    abs_dest_buf_remain[0] = 0;
                    const abs_dest_len = @intFromPtr(abs_dest_buf_remain.ptr) - @intFromPtr(this.abs_dest_buf.ptr);
                    const abs_dest: [:0]const u8 = this.abs_dest_buf[0..abs_dest_len :0];

                    unlinkBinOrShim(abs_dest);
                },
                .map => {
                    var i = this.bin.value.map.begin();
                    const end = this.bin.value.map.end();

                    const abs_dest_dir_end = abs_dest_buf_remain;

                    while (i < end) : (i += 2) {
                        const bin_dest = this.extern_string_buf[i].slice(this.string_buf);
                        const normalized_bin_dest = normalizedBinName(bin_dest);
                        if (normalized_bin_dest.len == 0) continue;

                        abs_dest_buf_remain = abs_dest_dir_end;
                        @memcpy(abs_dest_buf_remain[0..normalized_bin_dest.len], normalized_bin_dest);
                        abs_dest_buf_remain = abs_dest_buf_remain[normalized_bin_dest.len..];
                        abs_dest_buf_remain[0] = 0;
                        const abs_dest_len = @intFromPtr(abs_dest_buf_remain.ptr) - @intFromPtr(this.abs_dest_buf.ptr);
                        const abs_dest: [:0]const u8 = this.abs_dest_buf[0..abs_dest_len :0];

                        unlinkBinOrShim(abs_dest);
                    }
                },
                .dir => {
                    const target = this.bin.value.dir.slice(this.string_buf);
                    if (target.len == 0) return;

                    const abs_target_dir = path.joinAbsStringZ(package_dir, &.{target}, .auto);

                    var target_dir = bun.openDirAbsolute(abs_target_dir) catch |err| {
                        this.err = err;
                        return;
                    };
                    defer target_dir.close();

                    const abs_dest_dir_end = abs_dest_buf_remain;

                    var iter = target_dir.iterate();
                    while (iter.next() catch null) |entry| {
                        switch (entry.kind) {
                            .sym_link, .file => {
                                abs_dest_buf_remain = abs_dest_dir_end;
                                @memcpy(abs_dest_buf_remain[0..entry.name.len], entry.name);
                                abs_dest_buf_remain = abs_dest_buf_remain[entry.name.len..];
                                abs_dest_buf_remain[0] = 0;
                                const abs_dest_len = @intFromPtr(abs_dest_buf_remain.ptr) - @intFromPtr(this.abs_dest_buf.ptr);
                                const abs_dest: [:0]const u8 = this.abs_dest_buf[0..abs_dest_len :0];

                                unlinkBinOrShim(abs_dest);
                            },
                            else => {},
                        }
                    }
                },
            }
        }
    };
};
