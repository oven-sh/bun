const FileCloner = @This();

// macOS clonefileat only

cache_dir: FD,
cache_dir_subpath: bun.AutoRelPath,
dest_subpath: bun.RelPath(.{ .sep = .auto, .unit = .os }),

fn clonefileat(this: *FileCloner) sys.Maybe(void) {
    return sys.clonefileat(this.cache_dir, this.cache_dir_subpath.sliceZ(), FD.cwd(), this.dest_subpath.sliceZ());
}

pub fn clone(this: *FileCloner) sys.Maybe(void) {
    switch (this.clonefileat()) {
        .result => return .success,
        .err => |err| {
            switch (err.getErrno()) {
                .EXIST => {
                    FD.cwd().deleteTree(this.dest_subpath.slice()) catch {};
                    return this.clonefileat();
                },

                .NOENT => {
                    const parent_dest_dir = std.fs.path.dirname(this.dest_subpath.slice()) orelse {
                        return .initErr(err);
                    };
                    FD.cwd().makePath(u8, parent_dest_dir) catch {};
                    return this.clonefileat();
                },
                else => {
                    return .initErr(err);
                },
            }
        },
    }
}

const std = @import("std");

const bun = @import("bun");
const FD = bun.FD;
const sys = bun.sys;
