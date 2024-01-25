const ExternalStringList = @import("./install.zig").ExternalStringList;
const Semver = @import("./semver.zig");
const ExternalString = Semver.ExternalString;
const String = Semver.String;
const Output = bun.Output;
const Global = bun.Global;
const std = @import("std");
const strings = @import("root").bun.strings;
const Environment = @import("../env.zig");
const Path = @import("../resolver/resolve_path.zig");
const C = @import("../c.zig");
const Fs = @import("../fs.zig");
const stringZ = @import("root").bun.stringZ;
const Resolution = @import("./resolution.zig").Resolution;
const bun = @import("root").bun;
const string = bun.string;
const PackageInstall = @import("./install.zig").PackageInstall;

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

    pub fn init() Bin {
        return bun.serializable(.{ .tag = .none, .value = Value.init(.{ .none = {} }) });
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
        package_installed_node_modules: std.fs.Dir = bun.invalid_fd.asDir(),
        buf: [bun.MAX_PATH_BYTES]u8 = undefined,
        string_buffer: []const u8,
        extern_string_buf: []const ExternalString,

        fn nextInDir(this: *NamesIterator) !?[]const u8 {
            if (this.done) return null;
            if (this.dir_iterator == null) {
                var target = this.bin.value.dir.slice(this.string_buffer);
                if (strings.hasPrefix(target, "./")) {
                    target = target[2..];
                }
                var parts = [_][]const u8{ this.package_name.slice(this.string_buffer), target };

                const dir = this.package_installed_node_modules;

                const joined = Path.joinStringBuf(&this.buf, &parts, .auto);
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
                    if (strings.hasPrefix(base, "./"))
                        return strings.copy(&this.buf, base[2..]);

                    return strings.copy(&this.buf, base);
                },
                .named_file => {
                    if (this.i > 0) return null;
                    this.i += 1;
                    this.done = true;
                    const base = std.fs.path.basename(this.bin.value.named_file[0].slice(this.string_buffer));
                    if (strings.hasPrefix(base, "./"))
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
                    if (strings.hasPrefix(base, "./"))
                        return strings.copy(&this.buf, base[2..]);
                    return strings.copy(&this.buf, base);
                },
                else => return null,
            }
        }
    };

    pub const Linker = struct {
        bin: Bin,

        package_installed_node_modules: bun.FileDescriptor = bun.invalid_fd,
        root_node_modules_folder: bun.FileDescriptor = bun.invalid_fd,

        /// Used for generating relative paths
        package_name: strings.StringOrTinyString,

        global_bin_dir: std.fs.Dir,
        global_bin_path: stringZ = "",

        string_buf: []const u8,
        extern_string_buf: []const ExternalString,

        err: ?anyerror = null,

        pub var umask: std.os.mode_t = 0;

        var has_set_umask = false;

        pub const Error = error{
            NotImplementedYet,
        } || std.os.SymLinkError || std.os.OpenError || std.os.RealPathError;

        pub fn ensureUmask() void {
            if (!has_set_umask) {
                has_set_umask = true;
                umask = bun.C.umask(0);
            }
        }

        fn unscopedPackageName(name: []const u8) []const u8 {
            if (name[0] != '@') return name;
            var name_ = name;
            name_ = name[1..];
            return name_[(strings.indexOfChar(name_, '/') orelse return name) + 1 ..];
        }

        fn setPermissions(folder: std.os.fd_t, target: [:0]const u8) void {
            // we use fchmodat to avoid any issues with current working directory
            _ = C.fchmodat(folder, target, @intCast(umask | 0o777), 0);
        }

        fn setSymlinkAndPermissions(this: *Linker, target_path: [:0]const u8, dest_path: [:0]const u8) void {
            const node_modules = this.package_installed_node_modules.asDir();
            if (!Environment.isWindows) {
                std.os.symlinkatZ(target_path, node_modules.fd, dest_path) catch |err| {
                    // Silently ignore PathAlreadyExists if the symlink is valid.
                    // Most likely, the symlink was already created by another package
                    if (err == error.PathAlreadyExists) {
                        if (PackageInstall.isDanglingSymlink(dest_path)) {
                            // this case is hit if the package was previously and the bin is located in a different directory
                            node_modules.deleteFileZ(dest_path) catch |err2| {
                                this.err = err2;
                                return;
                            };

                            std.os.symlinkatZ(target_path, node_modules.fd, dest_path) catch |err2| {
                                this.err = err2;
                                return;
                            };

                            setPermissions(node_modules.fd, dest_path);
                            return;
                        }

                        setPermissions(node_modules.fd, dest_path);
                        var target_path_trim = target_path;
                        if (strings.hasPrefix(target_path_trim, "../")) {
                            target_path_trim = target_path_trim[3..];
                        }
                        setPermissions(node_modules.fd, target_path_trim);
                        this.err = err;
                    }
                };
                setPermissions(node_modules.fd, dest_path);
            } else {
                const WinBinLinkingShim = @import("./windows-shim/BinLinkingShim.zig");

                var shim_buf: [65536]u8 = undefined;
                var read_in_buf: [WinBinLinkingShim.Shebang.max_shebang_input_length]u8 = undefined;
                var filename1_buf: bun.WPathBuffer = undefined;
                var filename2_buf: bun.WPathBuffer = undefined;

                std.debug.assert(strings.hasPrefixComptime(target_path, "..\\"));

                const target_wpath = bun.strings.toWPathNormalized(&filename1_buf, target_path[3..]);
                var destination_wpath: []u16 = bun.strings.convertUTF8toUTF16InBuffer(&filename2_buf, dest_path);

                destination_wpath.len += 5;
                @memcpy(destination_wpath[destination_wpath.len - 5 ..], &[_]u16{ '.', 'b', 'u', 'n', 'x' });
                {
                    const file = node_modules.createFileW(destination_wpath, .{
                        .truncate = true,
                        .exclusive = true,
                    }) catch |open_err| fd: {
                        if (open_err == error.PathAlreadyExists) {
                            // we need to verify this link is valid, otherwise regenerate it
                            if (PackageInstall.isDanglingWindowsBinLink(bun.toFD(node_modules.fd), destination_wpath, &shim_buf)) {
                                break :fd node_modules.createFileW(destination_wpath, .{
                                    .truncate = true,
                                }) catch |second_open_err| {
                                    this.err = second_open_err;
                                    return;
                                };
                            }

                            // otherwise it is ok to skip the rest
                            return;
                        }
                        this.err = open_err;
                        return;
                    };
                    defer file.close();

                    const first_content_chunk = contents: {
                        const fd = bun.sys.openatWindows(
                            this.package_installed_node_modules,
                            target_wpath,
                            std.os.O.RDONLY,
                        ).unwrap() catch |err| {
                            this.err = err;
                            return;
                        };
                        defer _ = bun.sys.close(fd);
                        const reader = fd.asFile().reader();
                        const read = reader.read(&read_in_buf) catch |err| {
                            this.err = err;
                            return;
                        };
                        if (read == 0) {
                            this.err = error.FileNotFound;
                            return;
                        }
                        break :contents read_in_buf[0..read];
                    };

                    const shim = WinBinLinkingShim{
                        .bin_path = target_wpath,
                        .shebang = WinBinLinkingShim.Shebang.parse(first_content_chunk, target_wpath) catch {
                            this.err = error.InvalidBinContent;
                            return;
                        },
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

                    file.writer().writeAll(metadata) catch |err| {
                        this.err = err;
                        return;
                    };
                }

                destination_wpath.len -= 1;
                @memcpy(destination_wpath[destination_wpath.len - 3 ..], &[_]u16{ 'e', 'x', 'e' });

                if (node_modules.createFileW(destination_wpath, .{
                    .exclusive = true,
                })) |exe_file| {
                    defer exe_file.close();
                    exe_file.writer().writeAll(WinBinLinkingShim.embedded_executable_data) catch |err| {
                        this.err = err;
                        return;
                    };
                } else |err| {
                    if (err != error.PathAlreadyExists) {
                        this.err = err;
                        return;
                    }
                }
            }
        }

        const dot_bin = ".bin" ++ std.fs.path.sep_str;

        // It is important that we use symlinkat(2) with relative paths instead of symlink()
        // That way, if you move your node_modules folder around, the symlinks in .bin still work
        // If we used absolute paths for the symlinks, you'd end up with broken symlinks
        pub fn link(this: *Linker, link_global: bool) void {
            var target_buf: [bun.MAX_PATH_BYTES]u8 = undefined;
            var dest_buf: [bun.MAX_PATH_BYTES]u8 = undefined;
            var from_remain: []u8 = &target_buf;
            var remain: []u8 = &dest_buf;

            if (!link_global) {
                const root_dir = this.package_installed_node_modules.asDir();
                const from = root_dir.realpath(dot_bin, &target_buf) catch |realpath_err| brk: {
                    if (realpath_err == error.FileNotFound) {
                        if (comptime Environment.isWindows) {
                            std.os.mkdiratW(root_dir.fd, comptime bun.OSPathLiteral(".bin"), 0) catch |err| {
                                this.err = err;
                                return;
                            };
                        } else {
                            root_dir.makeDirZ(".bin") catch |err| {
                                this.err = err;
                                return;
                            };
                        }

                        break :brk root_dir.realpath(dot_bin, &target_buf) catch |err| {
                            this.err = err;
                            return;
                        };
                    }

                    this.err = realpath_err;
                    return;
                };
                const to = bun.getFdPath(this.package_installed_node_modules, &dest_buf) catch |err| {
                    this.err = err;
                    return;
                };
                const rel = Path.relative(from, to);
                bun.copy(u8, remain, rel);
                remain = remain[rel.len..];
                remain[0] = std.fs.path.sep;
                remain = remain[1..];
                from_remain[0..dot_bin.len].* = dot_bin.*;
                from_remain = from_remain[dot_bin.len..];
            } else {
                if (bun.toFD(this.global_bin_dir.fd) == bun.invalid_fd) {
                    this.err = error.MissingGlobalBinDir;
                    return;
                }

                bun.copy(u8, &target_buf, this.global_bin_path);
                from_remain = target_buf[this.global_bin_path.len..];
                from_remain[0] = std.fs.path.sep;
                from_remain = from_remain[1..];
                const abs = bun.getFdPath(this.root_node_modules_folder, &dest_buf) catch |err| {
                    this.err = err;
                    return;
                };
                remain = remain[abs.len..];
                remain[0] = std.fs.path.sep;
                remain = remain[1..];

                this.root_node_modules_folder = bun.toFD(this.global_bin_dir.fd);
            }

            const name = this.package_name.slice();
            bun.copy(u8, remain, name);
            remain = remain[name.len..];
            remain[0] = std.fs.path.sep;
            remain = remain[1..];

            switch (this.bin.tag) {
                .none => {
                    if (Environment.allow_assert) {
                        @panic("unexpected .null when linking binary");
                    }
                },
                .file => {
                    var target = this.bin.value.file.slice(this.string_buf);

                    if (strings.hasPrefixComptime(target, "./")) {
                        target = target["./".len..];
                    }
                    bun.copy(u8, remain, target);
                    remain = remain[target.len..];
                    remain[0] = 0;
                    const target_len = @intFromPtr(remain.ptr) - @intFromPtr(&dest_buf);
                    remain = remain[1..];

                    const target_path: [:0]u8 = dest_buf[0..target_len :0];
                    // we need to use the unscoped package name here
                    // this is why @babel/parser would fail to link
                    const unscoped_name = unscopedPackageName(name);
                    bun.copy(u8, from_remain, unscoped_name);
                    from_remain = from_remain[unscoped_name.len..];
                    from_remain[0] = 0;
                    const dest_path: [:0]u8 = target_buf[0 .. @intFromPtr(from_remain.ptr) - @intFromPtr(&target_buf) :0];

                    this.setSymlinkAndPermissions(target_path, dest_path);
                },
                .named_file => {
                    var target = this.bin.value.named_file[1].slice(this.string_buf);
                    if (strings.hasPrefixComptime(target, "./")) {
                        target = target["./".len..];
                    }
                    bun.copy(u8, remain, target);
                    remain = remain[target.len..];
                    remain[0] = 0;
                    const target_len = @intFromPtr(remain.ptr) - @intFromPtr(&dest_buf);
                    remain = remain[1..];

                    const target_path: [:0]u8 = dest_buf[0..target_len :0];
                    const name_to_use = this.bin.value.named_file[0].slice(this.string_buf);
                    bun.copy(u8, from_remain, name_to_use);
                    from_remain = from_remain[name_to_use.len..];
                    from_remain[0] = 0;
                    const dest_path: [:0]u8 = target_buf[0 .. @intFromPtr(from_remain.ptr) - @intFromPtr(&target_buf) :0];

                    this.setSymlinkAndPermissions(target_path, dest_path);
                },
                .map => {
                    var extern_string_i: u32 = this.bin.value.map.off;
                    const end = this.bin.value.map.len + extern_string_i;
                    const _from_remain = from_remain;
                    const _remain = remain;

                    while (extern_string_i < end) : (extern_string_i += 2) {
                        from_remain = _from_remain;
                        remain = _remain;
                        const name_in_terminal = this.extern_string_buf[extern_string_i];
                        const name_in_filesystem = this.extern_string_buf[extern_string_i + 1];

                        var target = name_in_filesystem.slice(this.string_buf);
                        if (strings.hasPrefixComptime(target, "./")) {
                            target = target["./".len..];
                        }
                        bun.copy(u8, remain, target);
                        remain = remain[target.len..];
                        remain[0] = 0;
                        const target_len = @intFromPtr(remain.ptr) - @intFromPtr(&dest_buf);
                        remain = remain[1..];

                        const target_path: [:0]u8 = dest_buf[0..target_len :0];
                        const name_to_use = name_in_terminal.slice(this.string_buf);
                        bun.copy(u8, from_remain, name_to_use);
                        from_remain = from_remain[name_to_use.len..];
                        from_remain[0] = 0;
                        const dest_path: [:0]u8 = target_buf[0 .. @intFromPtr(from_remain.ptr) - @intFromPtr(&target_buf) :0];

                        this.setSymlinkAndPermissions(target_path, dest_path);
                    }
                },
                .dir => {
                    var target = this.bin.value.dir.slice(this.string_buf);
                    if (strings.hasPrefixComptime(target, "./")) {
                        target = target["./".len..];
                    }

                    var parts = [_][]const u8{ name, target };

                    bun.copy(u8, remain, target);
                    remain = remain[target.len..];

                    const dir = this.package_installed_node_modules.asDir();

                    var joined = Path.joinStringBuf(&target_buf, &parts, .auto);
                    @as([*]u8, @ptrFromInt(@intFromPtr(joined.ptr)))[joined.len] = 0;
                    const joined_: [:0]const u8 = joined.ptr[0..joined.len :0];
                    var child_dir = bun.openDir(dir, joined_) catch |err| {
                        this.err = err;
                        return;
                    };
                    defer child_dir.close();

                    var iter = child_dir.iterate();

                    const basedir_path = bun.getFdPath(child_dir.fd, &target_buf) catch |err| {
                        this.err = err;
                        return;
                    };
                    target_buf[basedir_path.len] = std.fs.path.sep;
                    var target_buf_remain = target_buf[basedir_path.len + 1 ..];
                    const prev_target_buf_remain = target_buf_remain;

                    while (iter.next() catch null) |entry_| {
                        const entry: std.fs.Dir.Entry = entry_;
                        switch (entry.kind) {
                            std.fs.Dir.Entry.Kind.sym_link, std.fs.Dir.Entry.Kind.file => {
                                target_buf_remain = prev_target_buf_remain;
                                bun.copy(u8, target_buf_remain, entry.name);
                                target_buf_remain = target_buf_remain[entry.name.len..];
                                target_buf_remain[0] = 0;
                                const from_path: [:0]u8 = target_buf[0 .. @intFromPtr(target_buf_remain.ptr) - @intFromPtr(&target_buf) :0];
                                const to_path = if (!link_global)
                                    std.fmt.bufPrintZ(&dest_buf, dot_bin ++ "{s}", .{entry.name}) catch continue
                                else
                                    std.fmt.bufPrintZ(&dest_buf, "{s}", .{entry.name}) catch continue;

                                this.setSymlinkAndPermissions(from_path, to_path);
                            },
                            else => {},
                        }
                    }
                },
            }
        }

        pub fn unlink(this: *Linker, link_global: bool) void {
            var target_buf: [bun.MAX_PATH_BYTES]u8 = undefined;
            var dest_buf: [bun.MAX_PATH_BYTES]u8 = undefined;
            var from_remain: []u8 = &target_buf;
            var remain: []u8 = &dest_buf;

            if (!link_global) {
                target_buf[0..dot_bin.len].* = dot_bin.*;
                from_remain = target_buf[dot_bin.len..];
                dest_buf[0.."../".len].* = "../".*;
                remain = dest_buf["../".len..];
            } else {
                if (this.global_bin_dir.fd >= bun.invalid_fd.int()) {
                    this.err = error.MissingGlobalBinDir;
                    return;
                }

                @memcpy(target_buf[0..this.global_bin_path.len], this.global_bin_path);
                from_remain = target_buf[this.global_bin_path.len..];
                from_remain[0] = std.fs.path.sep;
                from_remain = from_remain[1..];
                const abs = bun.getFdPath(this.root_node_modules_folder, &dest_buf) catch |err| {
                    this.err = err;
                    return;
                };
                remain = remain[abs.len..];
                remain[0] = std.fs.path.sep;
                remain = remain[1..];

                this.root_node_modules_folder = bun.toFD(this.global_bin_dir.fd);
            }

            const name = this.package_name.slice();
            bun.copy(u8, remain, name);
            remain = remain[name.len..];
            remain[0] = std.fs.path.sep;
            remain = remain[1..];

            if (comptime Environment.isWindows) {
                @compileError("Bin.Linker.unlink() needs to be updated to generate .cmd files on Windows");
            }

            switch (this.bin.tag) {
                .none => {
                    if (comptime Environment.isDebug) {
                        unreachable;
                    }
                },
                .file => {
                    // we need to use the unscoped package name here
                    // this is why @babel/parser would fail to link
                    const unscoped_name = unscopedPackageName(name);
                    bun.copy(u8, from_remain, unscoped_name);
                    from_remain = from_remain[unscoped_name.len..];
                    from_remain[0] = 0;
                    const dest_path: [:0]u8 = target_buf[0 .. @intFromPtr(from_remain.ptr) - @intFromPtr(&target_buf) :0];

                    std.os.unlinkatZ(this.root_node_modules_folder.cast(), dest_path, 0) catch {};
                },
                .named_file => {
                    const name_to_use = this.bin.value.named_file[0].slice(this.string_buf);
                    bun.copy(u8, from_remain, name_to_use);
                    from_remain = from_remain[name_to_use.len..];
                    from_remain[0] = 0;
                    const dest_path: [:0]u8 = target_buf[0 .. @intFromPtr(from_remain.ptr) - @intFromPtr(&target_buf) :0];

                    std.os.unlinkatZ(this.root_node_modules_folder.cast(), dest_path, 0) catch {};
                },
                .map => {
                    var extern_string_i: u32 = this.bin.value.map.off;
                    const end = this.bin.value.map.len + extern_string_i;
                    const _from_remain = from_remain;
                    const _remain = remain;
                    while (extern_string_i < end) : (extern_string_i += 2) {
                        from_remain = _from_remain;
                        remain = _remain;
                        const name_in_terminal = this.extern_string_buf[extern_string_i];
                        const name_in_filesystem = this.extern_string_buf[extern_string_i + 1];

                        var target = name_in_filesystem.slice(this.string_buf);
                        if (strings.hasPrefix(target, "./")) {
                            target = target[2..];
                        }
                        bun.copy(u8, remain, target);
                        remain = remain[target.len..];
                        remain[0] = 0;
                        remain = remain[1..];

                        const name_to_use = name_in_terminal.slice(this.string_buf);
                        bun.copy(u8, from_remain, name_to_use);
                        from_remain = from_remain[name_to_use.len..];
                        from_remain[0] = 0;
                        const dest_path: [:0]u8 = target_buf[0 .. @intFromPtr(from_remain.ptr) - @intFromPtr(&target_buf) :0];

                        std.os.unlinkatZ(this.root_node_modules_folder.cast(), dest_path, 0) catch {};
                    }
                },
                .dir => {
                    var target = this.bin.value.dir.slice(this.string_buf);
                    if (strings.hasPrefix(target, "./")) {
                        target = target[2..];
                    }

                    var parts = [_][]const u8{ name, target };

                    bun.copy(u8, remain, target);
                    remain = remain[target.len..];

                    const dir = this.package_installed_node_modules.asDir();

                    var joined = Path.joinStringBuf(&target_buf, &parts, .auto);
                    @as([*]u8, @ptrFromInt(@intFromPtr(joined.ptr)))[joined.len] = 0;
                    const joined_: [:0]const u8 = joined.ptr[0..joined.len :0];
                    var child_dir = bun.openDir(dir, joined_) catch |err| {
                        this.err = err;
                        return;
                    };
                    defer child_dir.close();

                    var iter = child_dir.iterate();

                    const basedir_path = bun.getFdPath(child_dir.fd, &target_buf) catch |err| {
                        this.err = err;
                        return;
                    };
                    target_buf[basedir_path.len] = std.fs.path.sep;
                    var target_buf_remain = target_buf[basedir_path.len + 1 ..];
                    const prev_target_buf_remain = target_buf_remain;

                    while (iter.next() catch null) |entry_| {
                        const entry: std.fs.Dir.Entry = entry_;
                        switch (entry.kind) {
                            std.fs.Dir.Entry.Kind.sym_link, std.fs.Dir.Entry.Kind.file => {
                                target_buf_remain = prev_target_buf_remain;
                                bun.copy(u8, target_buf_remain, entry.name);
                                target_buf_remain = target_buf_remain[entry.name.len..];
                                target_buf_remain[0] = 0;
                                const to_path = if (!link_global)
                                    std.fmt.bufPrintZ(&dest_buf, dot_bin ++ "{s}", .{entry.name}) catch continue
                                else
                                    std.fmt.bufPrintZ(&dest_buf, "{s}", .{entry.name}) catch continue;

                                std.os.unlinkatZ(
                                    this.root_node_modules_folder.cast(),
                                    to_path,
                                    0,
                                ) catch continue;
                            },
                            else => {},
                        }
                    }
                },
            }
        }
    };
};
