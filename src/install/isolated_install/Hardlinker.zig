const Hardlinker = @This();

src_dir: FD,
src: bun.AbsPath(.{ .sep = .auto, .unit = .os }),
dest: bun.Path(.{ .sep = .auto, .unit = .os }),
walker: Walker,

pub fn init(
    folder_dir: FD,
    src: bun.AbsPath(.{ .sep = .auto, .unit = .os }),
    dest: bun.Path(.{ .sep = .auto, .unit = .os }),
    skip_dirnames: []const bun.OSPathSlice,
) OOM!Hardlinker {
    return .{
        .src_dir = folder_dir,
        .src = src,
        .dest = dest,
        .walker = walker: {
            var w = try Walker.walk(
                folder_dir,
                bun.default_allocator,
                &.{},
                skip_dirnames,
            );
            w.resolve_unknown_entry_types = true;
            break :walker w;
        },
    };
}

pub fn deinit(this: *Hardlinker) void {
    this.walker.deinit();
}

pub fn link(this: *Hardlinker) OOM!sys.Maybe(void) {
    if (bun.install.PackageManager.verbose_install) {
        bun.Output.prettyErrorln(
            \\Hardlinking {f} to {f}
        ,
            .{
                bun.fmt.fmtOSPath(this.src.slice(), .{ .path_sep = .auto }),
                bun.fmt.fmtOSPath(this.dest.slice(), .{ .path_sep = .auto }),
            },
        );
        bun.Output.flush();
    }

    if (comptime Environment.isWindows) {
        const cwd_buf = bun.w_path_buffer_pool.get();
        defer bun.w_path_buffer_pool.put(cwd_buf);
        const dest_cwd = FD.cwd().getFdPathW(cwd_buf) catch {
            return .initErr(bun.sys.Error.fromCode(bun.sys.E.ACCES, .link));
        };

        while (switch (this.walker.next()) {
            .result => |res| res,
            .err => |err| return .initErr(err),
        }) |entry| {
            var src_save = this.src.save();
            defer src_save.restore();

            this.src.append(entry.path);

            var dest_save = this.dest.save();
            defer dest_save.restore();

            this.dest.append(entry.path);

            switch (entry.kind) {
                .directory => {
                    FD.cwd().makePath(u16, this.dest.slice()) catch {};
                },
                .file => {
                    const destfile_path_buf = bun.w_path_buffer_pool.get();
                    const destfile_path_buf2 = bun.w_path_buffer_pool.get();
                    defer bun.w_path_buffer_pool.put(destfile_path_buf2);
                    defer bun.w_path_buffer_pool.put(destfile_path_buf);
                    // `dest` may already be absolute (global virtual store
                    // entries live under the cache, not cwd); only prefix the
                    // working-directory path when it's project-relative.
                    const dest_parts: []const []const u16 = if (this.dest.len() > 0 and bun.path.Platform.windows.isAbsoluteT(u16, this.dest.slice()))
                        &.{this.dest.slice()}
                    else
                        &.{ dest_cwd, this.dest.slice() };
                    const destfile_path = bun.strings.addNTPathPrefixIfNeeded(destfile_path_buf2, bun.path.joinStringBufWZ(destfile_path_buf, dest_parts, .windows));

                    const srcfile_path_buf = bun.w_path_buffer_pool.get();
                    defer bun.w_path_buffer_pool.put(srcfile_path_buf);

                    switch (sys.link(u16, this.src.sliceZ(), destfile_path)) {
                        .result => {},
                        .err => |link_err1| switch (link_err1.getErrno()) {
                            .UV_EEXIST,
                            .EXIST,
                            => {
                                if (bun.install.PackageManager.verbose_install) {
                                    bun.Output.prettyErrorln(
                                        \\Hardlinking {f} to a path that already exists: {f}
                                    ,
                                        .{
                                            bun.fmt.fmtOSPath(this.src.slice(), .{ .path_sep = .auto }),
                                            bun.fmt.fmtOSPath(destfile_path, .{ .path_sep = .auto }),
                                        },
                                    );
                                }

                                try_delete: {
                                    const delete_tree_buf = bun.path_buffer_pool.get();
                                    defer bun.path_buffer_pool.put(delete_tree_buf);

                                    const delete_tree_path = bun.strings.convertUTF16toUTF8InBuffer(delete_tree_buf, this.dest.slice()) catch {
                                        break :try_delete;
                                    };
                                    FD.cwd().deleteTree(delete_tree_path) catch {};
                                }
                                switch (sys.link(u16, this.src.sliceZ(), destfile_path)) {
                                    .result => {},
                                    .err => |link_err2| switch (link_err2.getErrno()) {
                                        .UV_EEXIST, .EXIST => {},
                                        else => return .initErr(link_err2),
                                    },
                                }
                            },
                            .UV_ENOENT,
                            .NOENT,
                            => {
                                if (bun.install.PackageManager.verbose_install) {
                                    bun.Output.prettyErrorln(
                                        \\Hardlinking {f} to a path that doesn't exist: {f}
                                    ,
                                        .{
                                            bun.fmt.fmtOSPath(this.src.slice(), .{ .path_sep = .auto }),
                                            bun.fmt.fmtOSPath(destfile_path, .{ .path_sep = .auto }),
                                        },
                                    );
                                }
                                const dest_parent = this.dest.dirname() orelse {
                                    return .initErr(link_err1);
                                };

                                FD.cwd().makePath(u16, dest_parent) catch {};

                                switch (sys.link(u16, this.src.sliceZ(), destfile_path)) {
                                    .result => {},
                                    .err => |link_err2| switch (link_err2.getErrno()) {
                                        .UV_EEXIST, .EXIST => {},
                                        else => return .initErr(link_err2),
                                    },
                                }
                            },
                            else => return .initErr(link_err1),
                        },
                    }
                },
                else => {},
            }
        }

        return .success;
    }

    while (switch (this.walker.next()) {
        .result => |res| res,
        .err => |err| return .initErr(err),
    }) |entry| {
        var dest_save = this.dest.save();
        defer dest_save.restore();

        this.dest.append(entry.path);

        switch (entry.kind) {
            .directory => {
                FD.cwd().makePath(u8, this.dest.sliceZ()) catch {};
            },
            .file => {
                switch (sys.linkatZ(entry.dir, entry.basename, FD.cwd(), this.dest.sliceZ())) {
                    .result => {},
                    .err => |link_err1| {
                        switch (link_err1.getErrno()) {
                            .EXIST => {
                                FD.cwd().deleteTree(this.dest.slice()) catch {};
                                switch (sys.linkatZ(entry.dir, entry.basename, FD.cwd(), this.dest.sliceZ())) {
                                    .result => {},
                                    // Another writer (concurrent install into a
                                    // shared global-store entry) re-created the
                                    // same hardlink between our delete and this
                                    // retry; it points at identical bytes.
                                    .err => |link_err2| if (link_err2.getErrno() != .EXIST) return .initErr(link_err2),
                                }
                            },
                            .NOENT => {
                                const dest_parent = this.dest.dirname() orelse {
                                    return .initErr(link_err1);
                                };

                                FD.cwd().makePath(u8, dest_parent) catch {};
                                switch (sys.linkatZ(entry.dir, entry.basename, FD.cwd(), this.dest.sliceZ())) {
                                    .result => {},
                                    .err => |link_err2| if (link_err2.getErrno() != .EXIST) return .initErr(link_err2),
                                }
                            },
                            else => return .initErr(link_err1),
                        }
                    },
                }
            },
            else => {},
        }
    }

    return .success;
}

const Walker = @import("../../walker_skippable.zig");

const bun = @import("bun");
const Environment = bun.Environment;
const FD = bun.FD;
const OOM = bun.OOM;
const sys = bun.sys;
