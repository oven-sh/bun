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

    pub fn verify(this: *const Bin, extern_strings: []const ExternalString) void {
        if (comptime !Environment.allow_assert)
            return;

        switch (this.tag) {
            .file => this.value.file.assertDefined(),
            .named_file => {
                this.value.named_file[0].assertDefined();
                this.value.named_file[1].assertDefined();
            },
            .dir => {
                this.value.dir.assertDefined();
            },
            .map => {
                const list = this.value.map.get(extern_strings);
                for (list) |*extern_string| {
                    extern_string.value.assertDefined();
                }
            },
            else => {},
        }
    }

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
        package_installed_node_modules: std.fs.Dir = std.fs.Dir{ .fd = bun.fdcast(bun.invalid_fd) },
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

        cmd_ext: ?string = null,

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
            if (comptime Environment.isWindows) {
                @panic("TODO on Windows");
            }
            std.os.symlinkatZ(target_path, this.package_installed_node_modules, dest_path) catch |err| {
                // Silently ignore PathAlreadyExists
                // Most likely, the symlink was already created by another package
                if (err == error.PathAlreadyExists) {
                    setPermissions(this.package_installed_node_modules, dest_path);
                    var target_path_trim = target_path;
                    if (strings.hasPrefix(target_path_trim, "../")) {
                        target_path_trim = target_path_trim[3..];
                    }
                    setPermissions(this.package_installed_node_modules, target_path_trim);
                    return;
                }

                this.err = err;
            };
            setPermissions(this.package_installed_node_modules, dest_path);
        }

        // https://github.com/npm/cli/blob/86ac76caa4a8bd5d1acb1777befdbc4d9ebc8a1a/node_modules/cmd-shim/lib/index.js#L89
        const cmd_contents_begin =
            \\@ECHO off
            \\GOTO start
            \\:find_dp0
            \\SET dp0=%~dp0
            \\EXIT /b
            \\:start
            \\SETLOCAL
            \\CALL :find_dp0
            \\
            \\IF NOT "%BUN_RUN_WINDOWS_BINARY_WITH_BUN%" == "" (
            \\  SET "_prog=%BUN_RUN_WINDOWS_BINARY_WITH_BUN%"
            \\  SET PATHEXT=%PATHEXT:;.JS;=;%
            \\) ELSE IF EXIST "%dp0%\node.exe" (
            \\  SET "_prog=%dp0%\node.exe"
            \\) ELSE (
            \\  SET "_prog=node"
            \\  SET PATHEXT=%PATHEXT:;.JS;=;%
            \\)
            \\
            \\endLocal & goto #_undefined_# 2>NUL || title %COMSPEC% & "%_prog%"  "%dp0%\
        ;

        const cmd_contents_end =
            \\" %*
        ;

        var cmd_contents_buf = brk: {
            // path to file is only used once. copy into a stack allocated buffer
            var buf: [cmd_contents_begin.len + cmd_contents_end.len + bun.MAX_PATH_BYTES]u8 = undefined;
            @memcpy(buf[0..cmd_contents_begin.len], cmd_contents_begin);
            break :brk buf;
        };

        fn createCmdFile(this: *Linker, target_path: [:0]const u8, dest_path_buf: *bun.PathBuffer, dest_path: [:0]const u8) void {
            const ext = this.cmd_ext orelse brk: {
                if (bun.getenvZ("PATHEXT")) |pathext| {
                    var iter = std.mem.splitScalar(u8, pathext, std.fs.path.delimiter);
                    while (iter.next()) |ext| {
                        // https://github.com/pnpm/pnpm/issues/3800
                        // https://github.com/zkochan/packages/blob/0397b5df8b4233a644ea45639ddb1c06f93b24c1/cmd-extension/index.js#L9
                        if (strings.eqlCaseInsensitiveASCII(ext, ".cmd", true)) {
                            this.cmd_ext = ext;
                            break :brk this.cmd_ext.?;
                        }
                    }
                }

                this.cmd_ext = ".cmd";
                break :brk this.cmd_ext.?;
            };

            @memcpy(dest_path_buf[dest_path.len..][0..ext.len], ext);
            const dest = dest_path_buf[0 .. dest_path.len + ext.len];

            const root_dir = std.fs.Dir{ .fd = bun.fdcast(this.package_installed_node_modules) };
            const cmd_file = root_dir.createFile(dest, .{}) catch |err| {
                this.err = err;
                return;
            };

            const cmd_file_fd = bun.toLibUVOwnedFD(cmd_file.handle);
            defer _ = bun.sys.close(cmd_file_fd);

            @memcpy(cmd_contents_buf[cmd_contents_begin.len..][0..target_path.len], target_path);
            @memcpy(cmd_contents_buf[cmd_contents_begin.len + target_path.len ..][0..cmd_contents_end.len], cmd_contents_end);

            const contents = cmd_contents_buf[0 .. cmd_contents_begin.len + target_path.len + cmd_contents_end.len];

            var index: usize = 0;
            while (index < contents.len) {
                switch (bun.sys.write(bun.toFD(cmd_file_fd), contents[index..])) {
                    .result => |written| {
                        index += written;
                    },
                    .err => |err| {
                        this.err = @errorFromInt(err.errno);
                        return;
                    },
                }
            }
        }

        const ps1_contents_fmt =
            \\#!/usr/bin/env pwsh
            \\$basedir=Split-Path $MyInvocation.MyCommand.Definition -Parent
            \\
            \\$exe=""
            \\if ($PSVersionTable.PSVersion -lt "6.0" -or $IsWindows) {{
            \\  # Fix case when both the Windows and Linux builds of Node
            \\  # are installed in the same directory
            \\  $exe=".exe"
            \\}}
            \\$ret=0
            \\if (Test-Path "$basedir/node$exe") {{
            \\  # Support pipeline input
            \\  if ($MyInvocation.ExpectingInput) {{
            \\    $input | & "$basedir/node$exe"  "$basedir/{s}" $args
            \\  }} else {{
            \\    & "$basedir/node$exe"  "$basedir/{s}" $args
            \\  }}
            \\  $ret=$LASTEXITCODE
            \\}} else {{
            \\  # Support pipeline input
            \\  if ($MyInvocation.ExpectingInput) {{
            \\    $input | & "node$exe"  "$basedir/{s}" $args
            \\  }} else {{
            \\    & "node$exe"  "$basedir/{s}" $args
            \\  }}
            \\  $ret=$LASTEXITCODE
            \\}}
            \\exit $ret
        ;

        fn createPs1File(this: *Linker, target_path: [:0]const u8, dest_path_buf: *bun.PathBuffer, dest_path: [:0]const u8) void {
            @memcpy(dest_path_buf[dest_path.len..][0..".ps1".len], ".ps1");
            const dest = dest_path_buf[0 .. dest_path.len + ".ps1".len];

            const root_dir = std.fs.Dir{ .fd = bun.fdcast(this.package_installed_node_modules) };
            const ps1_file = root_dir.createFile(dest, .{}) catch |err| {
                this.err = err;
                return;
            };

            const ps1_file_fd = bun.toLibUVOwnedFD(ps1_file.handle);
            defer _ = bun.sys.close(ps1_file_fd);

            const contents = std.fmt.allocPrint(bun.default_allocator, ps1_contents_fmt, .{ target_path, target_path, target_path, target_path }) catch bun.outOfMemory();
            defer bun.default_allocator.free(contents);

            var index: usize = 0;
            while (index < contents.len) {
                switch (bun.sys.write(bun.toFD(ps1_file_fd), contents[index..])) {
                    .result => |written| {
                        index += written;
                    },
                    .err => |err| {
                        this.err = @errorFromInt(err.errno);
                        return;
                    },
                }
            }
        }

        const sh_contents_fmt =
            \\#!/bin/sh
            \\basedir=$(dirname "$(echo "$0" | sed -e 's,\\,/,g')")
            \\
            \\case `uname` in
            \\    *CYGWIN*|*MINGW*|*MSYS*)
            \\        if command -v cygpath > /dev/null 2>&1; then
            \\            basedir=`cygpath -w "$basedir"`
            \\        fi
            \\    ;;
            \\esac
            \\
            \\if [ -x "$basedir/node" ]; then
            \\  exec "$basedir/node"  "$basedir/{s}" "$@"
            \\else 
            \\  exec node  "$basedir/{s}" "$@"
            \\fi
        ;

        fn createShFile(this: *Linker, target_path: [:0]const u8, dest_path: [:0]const u8) void {
            const root_dir = std.fs.Dir{ .fd = bun.fdcast(this.package_installed_node_modules) };
            const sh_file = root_dir.createFile(dest_path, .{}) catch |err| {
                this.err = err;
                return;
            };

            const sh_file_fd = bun.toLibUVOwnedFD(sh_file.handle);
            defer _ = bun.sys.close(sh_file_fd);

            const contents = std.fmt.allocPrint(bun.default_allocator, sh_contents_fmt, .{ target_path, target_path }) catch bun.outOfMemory();
            defer bun.default_allocator.free(contents);

            var index: usize = 0;
            while (index < contents.len) {
                switch (bun.sys.write(bun.toFD(sh_file_fd), contents[index..])) {
                    .result => |written| {
                        index += written;
                    },
                    .err => |err| {
                        this.err = @errorFromInt(err.errno);
                        return;
                    },
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
                const root_dir = std.fs.Dir{ .fd = bun.fdcast(this.package_installed_node_modules) };
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
                    if (comptime Environment.isDebug) {
                        unreachable;
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

                    if (comptime Environment.isWindows) {
                        var dest_path_buf: bun.PathBuffer = undefined;
                        @memcpy(dest_path_buf[0..dest_path.len], dest_path);
                        this.createCmdFile(target_path, &dest_path_buf, dest_path);
                        this.createPs1File(target_path, &dest_path_buf, dest_path);
                        this.createShFile(target_path, dest_path);
                    } else {
                        this.setSymlinkAndPermissions(target_path, dest_path);
                    }
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

                    if (comptime Environment.isWindows) {
                        var dest_path_buf: bun.PathBuffer = undefined;
                        @memcpy(dest_path_buf[0..dest_path.len], dest_path);
                        this.createCmdFile(target_path, &dest_path_buf, dest_path);
                        this.createPs1File(target_path, &dest_path_buf, dest_path);
                        this.createShFile(target_path, dest_path);
                    } else {
                        this.setSymlinkAndPermissions(target_path, dest_path);
                    }
                },
                .map => {
                    var extern_string_i: u32 = this.bin.value.map.off;
                    const end = this.bin.value.map.len + extern_string_i;
                    const _from_remain = from_remain;
                    const _remain = remain;

                    var dest_path_buf: if (Environment.isWindows) bun.PathBuffer else void = undefined;

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

                        if (comptime Environment.isWindows) {
                            @memcpy(dest_path_buf[0..dest_path.len], dest_path);
                            this.createCmdFile(target_path, &dest_path_buf, dest_path);
                            this.createPs1File(target_path, &dest_path_buf, dest_path);
                            this.createShFile(target_path, dest_path);
                        } else {
                            this.setSymlinkAndPermissions(target_path, dest_path);
                        }
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

                    const dir = std.fs.Dir{ .fd = bun.fdcast(this.package_installed_node_modules) };

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

                    var dest_path_buf: if (Environment.isWindows) bun.PathBuffer else void = undefined;

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

                                if (comptime Environment.isWindows) {
                                    @memcpy(dest_path_buf[0..to_path.len], to_path);
                                    this.createCmdFile(from_path, &dest_path_buf, to_path);
                                    this.createPs1File(from_path, &dest_path_buf, to_path);
                                    this.createShFile(from_path, to_path);
                                } else {
                                    this.setSymlinkAndPermissions(from_path, to_path);
                                }
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
                if (this.global_bin_dir.fd >= bun.invalid_fd) {
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

                this.root_node_modules_folder = this.global_bin_dir.fd;
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

                    std.os.unlinkatZ(this.root_node_modules_folder, dest_path, 0) catch {};
                },
                .named_file => {
                    const name_to_use = this.bin.value.named_file[0].slice(this.string_buf);
                    bun.copy(u8, from_remain, name_to_use);
                    from_remain = from_remain[name_to_use.len..];
                    from_remain[0] = 0;
                    const dest_path: [:0]u8 = target_buf[0 .. @intFromPtr(from_remain.ptr) - @intFromPtr(&target_buf) :0];

                    std.os.unlinkatZ(this.root_node_modules_folder, dest_path, 0) catch {};
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

                        std.os.unlinkatZ(this.root_node_modules_folder, dest_path, 0) catch {};
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

                    const dir = std.fs.Dir{ .fd = bun.fdcast(this.package_installed_node_modules) };

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
                                    this.root_node_modules_folder,
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
