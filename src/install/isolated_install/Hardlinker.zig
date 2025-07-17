pub const Hardlinker = struct {
    src_dir: FD,
    src: bun.AbsPath(.{ .sep = .auto, .unit = .os }),
    dest: bun.RelPath(.{ .sep = .auto, .unit = .os }),

    pub fn link(this: *Hardlinker, skip_dirnames: []const bun.OSPathSlice) OOM!sys.Maybe(void) {
        var walker: Walker = try .walk(
            this.src_dir,
            bun.default_allocator,
            &.{},
            skip_dirnames,
        );
        defer walker.deinit();

        if (comptime Environment.isWindows) {
            while (switch (walker.next()) {
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
                        FD.cwd().makePath(u16, this.dest.sliceZ()) catch {};
                    },
                    .file => {
                        switch (sys.link(u16, this.src.sliceZ(), this.dest.sliceZ())) {
                            .result => {},
                            .err => |link_err1| switch (link_err1.getErrno()) {
                                .UV_EEXIST,
                                .EXIST,
                                => {
                                    try_delete: {
                                        const delete_tree_buf = bun.path_buffer_pool.get();
                                        defer bun.path_buffer_pool.put(delete_tree_buf);

                                        const delete_tree_path = bun.strings.convertUTF16toUTF8InBuffer(delete_tree_buf, this.dest.slice()) catch {
                                            break :try_delete;
                                        };
                                        FD.cwd().deleteTree(delete_tree_path) catch {};
                                    }
                                    switch (sys.link(u16, this.src.sliceZ(), this.dest.sliceZ())) {
                                        .result => {},
                                        .err => |link_err2| return .initErr(link_err2),
                                    }
                                },
                                .UV_ENOENT,
                                .NOENT,
                                => {
                                    const dest_parent = this.dest.dirname() orelse {
                                        return .initErr(link_err1);
                                    };

                                    FD.cwd().makePath(u16, dest_parent) catch {};
                                    switch (sys.link(u16, this.src.sliceZ(), this.dest.sliceZ())) {
                                        .result => {},
                                        .err => |link_err2| return .initErr(link_err2),
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

        while (switch (walker.next()) {
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
                                        .err => |link_err2| return .initErr(link_err2),
                                    }
                                },
                                .NOENT => {
                                    const dest_parent = this.dest.dirname() orelse {
                                        return .initErr(link_err1);
                                    };

                                    FD.cwd().makePath(u8, dest_parent) catch {};
                                    switch (sys.linkatZ(entry.dir, entry.basename, FD.cwd(), this.dest.sliceZ())) {
                                        .result => {},
                                        .err => |link_err2| return .initErr(link_err2),
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
};

// @sortImports

const Walker = @import("../../walker_skippable.zig");

const bun = @import("bun");
const Environment = bun.Environment;
const FD = bun.FD;
const OOM = bun.OOM;
const sys = bun.sys;
