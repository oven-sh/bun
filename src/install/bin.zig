const ExternalStringList = @import("./install.zig").ExternalStringList;
const Semver = @import("./semver.zig");
const ExternalString = Semver.ExternalString;
const String = Semver.String;
const std = @import("std");
const strings = @import("strings");
const Environment = @import("../env.zig");
const Path = @import("../resolver/resolve_path.zig");
const C = @import("../c.zig");
/// Normalized `bin` field in [package.json](https://docs.npmjs.com/cli/v8/configuring-npm/package-json#bin)
/// Can be a:
/// - file path (relative to the package root)
/// - directory (relative to the package root)
/// - map where keys are names of the binaries and values are file paths to the binaries
pub const Bin = extern struct {
    tag: Tag = Tag.none,
    value: Value = Value{ .none = .{} },

    pub fn count(this: Bin, buf: []const u8, comptime StringBuilder: type, builder: StringBuilder) void {
        switch (this.tag) {
            .file => builder.count(this.value.file.slice(buf)),
            .named_file => {
                builder.count(this.value.named_file[0].slice(buf));
                builder.count(this.value.named_file[1].slice(buf));
            },
            .dir => builder.count(this.value.dir.slice(buf)),
            .map => @panic("Bin.map not implemented yet!!. That means \"bin\" as multiple specific files won't work just yet"),
            else => {},
        }
    }

    pub fn clone(this: Bin, buf: []const u8, comptime StringBuilder: type, builder: StringBuilder) Bin {
        return switch (this.tag) {
            .none => Bin{ .tag = .none, .value = .{ .none = .{} } },
            .file => Bin{
                .tag = .file,
                .value = .{ .file = builder.append(String, this.value.file.slice(buf)) },
            },
            .named_file => Bin{
                .tag = .named_file,
                .value = .{
                    .named_file = [2]String{
                        builder.append(String, this.value.named_file[0].slice(buf)),
                        builder.append(String, this.value.named_file[1].slice(buf)),
                    },
                },
            },
            .dir => Bin{
                .tag = .dir,
                .value = .{ .dir = builder.append(String, this.value.dir.slice(buf)) },
            },
            .map => @panic("Bin.map not implemented yet!!. That means \"bin\" as multiple specific files won't work just yet"),
        };
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
        // "bin" is a map
        ///```
        /// "bin": {
        ///     "babel": "./cli.js",
        ///     "babel-cli": "./cli.js",
        /// }
        ///```
        map = 4,
    };

    pub const Linker = struct {
        bin: Bin,

        package_installed_node_modules: std.os.fd_t = std.math.maxInt(std.os.fd_t),
        root_node_modules_folder: std.os.fd_t = std.math.maxInt(std.os.fd_t),

        /// Used for generating relative paths
        package_name: strings.StringOrTinyString,

        string_buf: []const u8,

        err: ?anyerror = null,

        pub var umask: std.os.mode_t = 0;

        pub const Error = error{
            NotImplementedYet,
        } || std.os.SymLinkError || std.os.OpenError || std.os.RealPathError;

        fn unscopedPackageName(name: []const u8) []const u8 {
            if (name[0] != '@') return name;
            var name_ = name;
            name_ = name[1..];
            return name_[(std.mem.indexOfScalar(u8, name_, '/') orelse return name) + 1 ..];
        }

        // Sometimes, packages set "bin" to a file not marked as executable in the tarball
        // They want it to be executable though
        // so we make it executable
        fn setPermissions(this: *const Linker, target: [:0]const u8) void {
            // we use fchmodat to avoid any issues with current working directory
            _ = C.fchmodat(this.root_node_modules_folder, target, umask | 0o777, 0);
        }

        // It is important that we use symlinkat(2) with relative paths instead of symlink()
        // That way, if you move your node_modules folder around, the symlinks in .bin still work
        // If we used absolute paths for the symlinks, you'd end up with broken symlinks
        pub fn link(this: *Linker) void {
            var from_buf: [std.fs.MAX_PATH_BYTES]u8 = undefined;
            var path_buf: [std.fs.MAX_PATH_BYTES]u8 = undefined;

            from_buf[0..".bin/".len].* = ".bin/".*;
            var from_remain: []u8 = from_buf[".bin/".len..];
            path_buf[0.."../".len].* = "../".*;

            var remain: []u8 = path_buf["../".len..];
            const name = this.package_name.slice();
            std.mem.copy(u8, remain, name);
            remain = remain[name.len..];
            remain[0] = std.fs.path.sep;
            remain = remain[1..];

            if (comptime Environment.isWindows) {
                @compileError("Bin.Linker.link() needs to be updated to generate .cmd files on Windows");
            }

            switch (this.bin.tag) {
                .none => {
                    if (comptime Environment.isDebug) {
                        unreachable;
                    }
                },
                .file => {
                    var target = this.bin.value.file.slice(this.string_buf);

                    if (strings.hasPrefix(target, "./")) {
                        target = target[2..];
                    }
                    std.mem.copy(u8, remain, target);
                    remain = remain[target.len..];
                    remain[0] = 0;
                    const target_len = @ptrToInt(remain.ptr) - @ptrToInt(&path_buf);
                    remain = remain[1..];

                    var target_path: [:0]u8 = path_buf[0..target_len :0];
                    // we need to use the unscoped package name here
                    // this is why @babel/parser would fail to link
                    const unscoped_name = unscopedPackageName(name);
                    std.mem.copy(u8, from_remain, unscoped_name);
                    from_remain = from_remain[unscoped_name.len..];
                    from_remain[0] = 0;
                    var dest_path: [:0]u8 = from_buf[0 .. @ptrToInt(from_remain.ptr) - @ptrToInt(&from_buf) :0];

                    std.os.symlinkatZ(target_path, this.root_node_modules_folder, dest_path) catch |err| {
                        // Silently ignore PathAlreadyExists
                        // Most likely, the symlink was already created by another package
                        if (err == error.PathAlreadyExists) {
                            this.setPermissions(dest_path);
                            return;
                        }

                        this.err = err;
                    };
                    this.setPermissions(dest_path);
                },
                .named_file => {
                    var target = this.bin.value.named_file[1].slice(this.string_buf);
                    if (strings.hasPrefix(target, "./")) {
                        target = target[2..];
                    }
                    std.mem.copy(u8, remain, target);
                    remain = remain[target.len..];
                    remain[0] = 0;
                    const target_len = @ptrToInt(remain.ptr) - @ptrToInt(&path_buf);
                    remain = remain[1..];

                    var target_path: [:0]u8 = path_buf[0..target_len :0];
                    var name_to_use = this.bin.value.named_file[0].slice(this.string_buf);
                    std.mem.copy(u8, from_remain, name_to_use);
                    from_remain = from_remain[name_to_use.len..];
                    from_remain[0] = 0;
                    var dest_path: [:0]u8 = from_buf[0 .. @ptrToInt(from_remain.ptr) - @ptrToInt(&from_buf) :0];

                    std.os.symlinkatZ(target_path, this.root_node_modules_folder, dest_path) catch |err| {
                        // Silently ignore PathAlreadyExists
                        // Most likely, the symlink was already created by another package
                        if (err == error.PathAlreadyExists) {
                            this.setPermissions(dest_path);
                            return;
                        }

                        this.err = err;
                    };
                    this.setPermissions(dest_path);
                },
                .dir => {
                    var target = this.bin.value.dir.slice(this.string_buf);
                    var parts = [_][]const u8{ name, target };
                    if (strings.hasPrefix(target, "./")) {
                        target = target[2..];
                    }
                    std.mem.copy(u8, remain, target);
                    remain = remain[target.len..];
                    remain[0] = 0;
                    var dir = std.fs.Dir{ .fd = this.package_installed_node_modules };

                    var joined = Path.joinStringBuf(&from_buf, &parts, .auto);
                    from_buf[joined.len] = 0;
                    var joined_: [:0]u8 = from_buf[0..joined.len :0];
                    var child_dir = dir.openDirZ(joined_, .{ .iterate = true }) catch |err| {
                        this.err = err;
                        return;
                    };
                    defer child_dir.close();

                    var iter = child_dir.iterate();

                    var basedir_path = std.os.getFdPath(child_dir.fd, &from_buf) catch |err| {
                        this.err = err;
                        return;
                    };
                    from_buf[basedir_path.len] = std.fs.path.sep;
                    var from_buf_remain = from_buf[basedir_path.len + 1 ..];

                    while (iter.next() catch null) |entry_| {
                        const entry: std.fs.Dir.Entry = entry_;
                        switch (entry.kind) {
                            std.fs.Dir.Entry.Kind.SymLink, std.fs.Dir.Entry.Kind.File => {
                                std.mem.copy(u8, from_buf_remain, entry.name);
                                from_buf_remain = from_buf_remain[entry.name.len..];
                                from_buf_remain[0] = 0;
                                var from_path: [:0]u8 = from_buf[0 .. @ptrToInt(from_buf_remain.ptr) - @ptrToInt(&from_buf) :0];
                                var to_path = std.fmt.bufPrintZ(&path_buf, ".bin/{s}", .{entry.name}) catch unreachable;

                                std.os.symlinkatZ(
                                    from_path,
                                    this.root_node_modules_folder,
                                    to_path,
                                ) catch |err| {

                                    // Silently ignore PathAlreadyExists
                                    // Most likely, the symlink was already created by another package
                                    if (err == error.PathAlreadyExists) {
                                        this.setPermissions(to_path);
                                        continue;
                                    }

                                    this.err = err;
                                    continue;
                                };
                                this.setPermissions(to_path);
                            },
                            else => {},
                        }
                    }
                },
                .map => {
                    this.err = error.NotImplementedYet;
                },
            }
        }
    };
};
