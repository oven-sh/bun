const FileCloner = @This();

// macOS clonefileat only

cache_dir: FD,
cache_dir_subpath: bun.AutoRelPath,
dest_subpath: bun.Path(.{ .sep = .auto, .unit = .os }),
/// When true, an existing destination is treated as success rather than wiped
/// and re-cloned. Set for global virtual-store entries, which are shared
/// across projects and content-addressed by name (so the existing tree is
/// already what we'd produce).
keep_existing_dest: bool = false,
/// Path to the entry-level `.bun-ok` stamp (`<gvs>/<entry>/.bun-ok`), used as
/// the "this entry was fully built" sentinel when `cloneAtomic`'s rename hits
/// an existing destination. `package.json` alone is *not* a valid sentinel: a
/// crashed file-walking install (or intervening cache corruption) could leave
/// it alongside an arbitrary subset of files. Only set when
/// `keep_existing_dest` is true.
entry_ok_path: [:0]const u8 = "",

fn clonefileat(this: *FileCloner) sys.Maybe(void) {
    return sys.clonefileat(this.cache_dir, this.cache_dir_subpath.sliceZ(), FD.cwd(), this.dest_subpath.sliceZ());
}

pub fn clone(this: *FileCloner) sys.Maybe(void) {
    if (this.keep_existing_dest) {
        // Global virtual-store entries are content-addressed and shared across
        // processes, so a previously-created destination is normally a hit.
        // But if an earlier install was interrupted mid-clonefile (jetsam,
        // disk-full mid directory walk, panic), the destination directory can
        // exist with only some of the package files. Treating that EEXIST as
        // success would permanently lock in the broken entry for every future
        // install. Make population atomic instead: clone into a per-process
        // temp sibling, then rename into place. The losing process's rename
        // sees EEXIST/NOTEMPTY and discards its identical temp tree.
        return this.cloneAtomic();
    }
    switch (this.clonefileat()) {
        .result => return .success,
        .err => |err| {
            switch (err.getErrno()) {
                .EXIST => {
                    FD.cwd().deleteTree(this.dest_subpath.slice()) catch {};
                    return this.clonefileat();
                },

                .NOENT => {
                    const parent_dest_dir = this.dest_subpath.dirname() orelse {
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

fn cloneAtomic(this: *FileCloner) sys.Maybe(void) {
    var tmp_buf: bun.PathBuffer = undefined;
    // Temp path is a sibling of the final path so the rename is atomic and
    // stays on the same volume (clonefile already requires same-volume).
    const tmp_path: [:0]const u8 = std.fmt.bufPrintZ(
        &tmp_buf,
        "{s}.tmp-{d}-{d}",
        .{ this.dest_subpath.slice(), std.c.getpid(), std.crypto.random.int(u32) },
    ) catch return .initErr(.{ .errno = @intFromEnum(bun.sys.E.NAMETOOLONG), .syscall = .clonefile });

    cloned: {
        switch (sys.clonefileat(this.cache_dir, this.cache_dir_subpath.sliceZ(), FD.cwd(), tmp_path)) {
            .result => break :cloned,
            .err => |err| switch (err.getErrno()) {
                .NOENT => {
                    if (this.dest_subpath.dirname()) |parent| {
                        FD.cwd().makePath(u8, parent) catch {};
                    }
                },
                .EXIST => {
                    // Stale temp from a crashed earlier run with the same pid.
                    FD.cwd().deleteTree(tmp_path) catch {};
                },
                else => return .initErr(err),
            },
        }
        switch (sys.clonefileat(this.cache_dir, this.cache_dir_subpath.sliceZ(), FD.cwd(), tmp_path)) {
            .result => break :cloned,
            .err => |err| return .initErr(err),
        }
    }

    switch (sys.rename(tmp_path, this.dest_subpath.sliceZ())) {
        .result => return .success,
        .err => |err| switch (err.getErrno()) {
            .EXIST, .NOTEMPTY => {
                // Someone got there first. Keep their tree only if the
                // entry-level `.bun-ok` stamp is present (i.e. some install
                // fully built it). `package.json` alone is *not* a valid
                // sentinel: although clonefileat is whole-tree atomic, a
                // file-walking install or cache corruption could have left it
                // alongside an arbitrary subset of files, and the warm-hit
                // check already established `.bun-ok` is absent (that's why
                // we're here). Replacing dest with our complete temp tree is
                // safe even if a concurrent install just renamed first — dest
                // is only the `<pkg>` directory; their dep symlinks, bin
                // links, and the `.bun-ok` stamp live alongside it under the
                // entry root, so their later steps proceed unchanged with our
                // (identical) package files.
                if (this.entry_ok_path.len > 0 and sys.existsZ(this.entry_ok_path)) {
                    FD.cwd().deleteTree(tmp_path) catch {};
                    return .success;
                }
                FD.cwd().deleteTree(this.dest_subpath.slice()) catch {};
                return switch (sys.rename(tmp_path, this.dest_subpath.sliceZ())) {
                    .result => .success,
                    .err => |e| switch (e.getErrno()) {
                        // A concurrent install repopulated it between our
                        // deleteTree and rename — we're done either way.
                        .EXIST, .NOTEMPTY => {
                            FD.cwd().deleteTree(tmp_path) catch {};
                            return .success;
                        },
                        else => {
                            FD.cwd().deleteTree(tmp_path) catch {};
                            return .initErr(e);
                        },
                    },
                };
            },
            else => {
                FD.cwd().deleteTree(tmp_path) catch {};
                return .initErr(err);
            },
        },
    }
}

const std = @import("std");

const bun = @import("bun");
const FD = bun.FD;
const sys = bun.sys;
