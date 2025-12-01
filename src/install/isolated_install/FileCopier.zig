pub const FileCopier = struct {
    src_path: bun.AbsPath(.{ .sep = .auto, .unit = .os }),
    dest_subpath: bun.RelPath(.{ .sep = .auto, .unit = .os }),
    walker: Walker,

    pub fn init(
        src_dir: FD,
        src_path: bun.AbsPath(.{ .sep = .auto, .unit = .os }),
        dest_subpath: bun.RelPath(.{ .sep = .auto, .unit = .os }),
        skip_dirnames: []const bun.OSPathSlice,
    ) OOM!FileCopier {
        return .{
            .src_path = src_path,
            .dest_subpath = dest_subpath,
            .walker = try .walk(
                src_dir,
                bun.default_allocator,
                &.{},
                skip_dirnames,
            ),
        };
    }

    pub fn deinit(this: *FileCopier) void {
        this.walker.deinit();
    }

    pub fn copy(this: *FileCopier) sys.Maybe(void) {
        var dest_dir = bun.MakePath.makeOpenPath(FD.cwd().stdDir(), this.dest_subpath.sliceZ(), .{}) catch |err| {
            // TODO: remove the need for this and implement openDir makePath makeOpenPath in bun
            var errno: bun.sys.E = switch (@as(anyerror, err)) {
                error.AccessDenied => .PERM,
                error.FileTooBig => .FBIG,
                error.SymLinkLoop => .LOOP,
                error.ProcessFdQuotaExceeded => .NFILE,
                error.NameTooLong => .NAMETOOLONG,
                error.SystemFdQuotaExceeded => .MFILE,
                error.SystemResources => .NOMEM,
                error.ReadOnlyFileSystem => .ROFS,
                error.FileSystem => .IO,
                error.FileBusy => .BUSY,
                error.DeviceBusy => .BUSY,

                // One of the path components was not a directory.
                // This error is unreachable if `sub_path` does not contain a path separator.
                error.NotDir => .NOTDIR,
                // On Windows, file paths must be valid Unicode.
                error.InvalidUtf8 => .INVAL,
                error.InvalidWtf8 => .INVAL,

                // On Windows, file paths cannot contain these characters:
                // '/', '*', '?', '"', '<', '>', '|'
                error.BadPathName => .INVAL,

                error.FileNotFound => .NOENT,
                error.IsDir => .ISDIR,

                else => .FAULT,
            };
            if (Environment.isWindows and errno == .NOTDIR) {
                errno = .NOENT;
            }

            return .{ .err = bun.sys.Error.fromCode(errno, .copyfile) };
        };
        defer dest_dir.close();

        var copy_file_state: bun.CopyFileState = .{};

        while (switch (this.walker.next()) {
            .result => |res| res,
            .err => |err| return .initErr(err),
        }) |entry| {
            if (comptime Environment.isWindows) {
                switch (entry.kind) {
                    .directory, .file => {},
                    else => continue,
                }

                var src_path_save = this.src_path.save();
                defer src_path_save.restore();

                this.src_path.append(entry.path);

                var dest_subpath_save = this.dest_subpath.save();
                defer dest_subpath_save.restore();

                this.dest_subpath.append(entry.path);

                switch (entry.kind) {
                    .directory => {
                        if (bun.windows.CreateDirectoryExW(this.src_path.sliceZ(), this.dest_subpath.sliceZ(), null) == 0) {
                            bun.MakePath.makePath(u16, dest_dir, entry.path) catch {};
                        }
                    },
                    .file => {
                        bun.copyFile(this.src_path.sliceZ(), this.dest_subpath.sliceZ()).unwrap() catch {
                            if (bun.Dirname.dirname(u16, entry.path)) |entry_dirname| {
                                bun.MakePath.makePath(u16, dest_dir, entry_dirname) catch {};
                                switch (bun.copyFile(this.src_path.sliceZ(), this.dest_subpath.sliceZ())) {
                                    .result => {},
                                    .err => |err| {
                                        return .initErr(err);
                                    },
                                }
                            }
                        };
                    },
                    else => unreachable,
                }
            } else {
                if (entry.kind != .file) {
                    continue;
                }

                const src = switch (entry.dir.openat(entry.basename, bun.O.RDONLY, 0)) {
                    .result => |fd| fd,
                    .err => |err| {
                        return .initErr(err);
                    },
                };
                defer src.close();

                var dest = dest_dir.createFileZ(entry.path, .{}) catch dest: {
                    if (bun.Dirname.dirname(bun.OSPathChar, entry.path)) |entry_dirname| {
                        bun.MakePath.makePath(bun.OSPathChar, dest_dir, entry_dirname) catch {};
                    }

                    break :dest dest_dir.createFileZ(entry.path, .{}) catch |err| {
                        Output.prettyErrorln("<r><red>{s}<r>: copy file {f}", .{ @errorName(err), bun.fmt.fmtOSPath(entry.path, .{}) });
                        Global.exit(1);
                    };
                };
                defer dest.close();

                if (comptime Environment.isPosix) {
                    const stat = src.stat().unwrap() catch continue;
                    _ = bun.c.fchmod(dest.handle, @intCast(stat.mode));
                }

                switch (bun.copyFileWithState(src, .fromStdFile(dest), &copy_file_state)) {
                    .result => {},
                    .err => |err| {
                        return .initErr(err);
                    },
                }
            }
        }

        return .success;
    }
};

const Walker = @import("../../walker_skippable.zig");

const bun = @import("bun");
const Environment = bun.Environment;
const FD = bun.FD;
const Global = bun.Global;
const OOM = bun.OOM;
const Output = bun.Output;
const sys = bun.sys;
