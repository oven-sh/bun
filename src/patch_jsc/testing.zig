//! JS testing bindings for `bun.patch`. Keeps `src/patch/` free of JSC types.

pub const TestingAPIs = struct {
    pub fn makeDiff(globalThis: *jsc.JSGlobalObject, callframe: *jsc.CallFrame) bun.JSError!jsc.JSValue {
        const arguments_ = callframe.arguments_old(2);
        var arguments = jsc.CallFrame.ArgumentsSlice.init(globalThis.bunVM(), arguments_.slice());

        const old_folder_jsval = arguments.nextEat() orelse {
            return globalThis.throw("expected 2 strings", .{});
        };
        const old_folder_bunstr = try old_folder_jsval.toBunString(globalThis);
        defer old_folder_bunstr.deref();

        const new_folder_jsval = arguments.nextEat() orelse {
            return globalThis.throw("expected 2 strings", .{});
        };
        const new_folder_bunstr = try new_folder_jsval.toBunString(globalThis);
        defer new_folder_bunstr.deref();

        const old_folder = old_folder_bunstr.toUTF8(bun.default_allocator);
        defer old_folder.deinit();

        const new_folder = new_folder_bunstr.toUTF8(bun.default_allocator);
        defer new_folder.deinit();

        return switch (gitDiffInternal(bun.default_allocator, old_folder.slice(), new_folder.slice()) catch |e| {
            return globalThis.throwError(e, "failed to make diff");
        }) {
            .result => |s| {
                defer s.deinit();
                return bun.String.fromBytes(s.items).toJS(globalThis);
            },
            .err => |e| {
                defer e.deinit();
                return globalThis.throw("failed to make diff: {s}", .{e.items});
            },
        };
    }
    const ApplyArgs = struct {
        patchfile_txt: jsc.ZigString.Slice,
        patchfile: PatchFile,
        dirfd: bun.FD,

        pub fn deinit(this: *ApplyArgs) void {
            this.patchfile_txt.deinit();
            this.patchfile.deinit(bun.default_allocator);
            // TODO: HAVE @zackradisic REVIEW THIS DIFF
            if (bun.FD.cwd() != this.dirfd) {
                this.dirfd.close();
            }
        }
    };
    pub fn apply(globalThis: *jsc.JSGlobalObject, callframe: *jsc.CallFrame) bun.JSError!jsc.JSValue {
        var args = switch (parseApplyArgs(globalThis, callframe)) {
            .err => |e| return e,
            .result => |a| a,
        };
        defer args.deinit();

        if (args.patchfile.apply(bun.default_allocator, args.dirfd)) |err| {
            return globalThis.throwValue(try err.toJS(globalThis));
        }

        return .true;
    }
    /// Used in JS tests, see `internal-for-testing.ts` and patch tests.
    pub fn parse(globalThis: *jsc.JSGlobalObject, callframe: *jsc.CallFrame) bun.JSError!jsc.JSValue {
        const arguments_ = callframe.arguments_old(2);
        var arguments = jsc.CallFrame.ArgumentsSlice.init(globalThis.bunVM(), arguments_.slice());

        const patchfile_src_js = arguments.nextEat() orelse {
            return globalThis.throw("TestingAPIs.parse: expected at least 1 argument, got 0", .{});
        };
        const patchfile_src_bunstr = try patchfile_src_js.toBunString(globalThis);
        const patchfile_src = patchfile_src_bunstr.toUTF8(bun.default_allocator);

        var patchfile = parsePatchFile(patchfile_src.slice()) catch |e| {
            if (e == error.hunk_header_integrity_check_failed) {
                return globalThis.throwError(e, "this indicates either that the supplied patch file was incorrect, or there is a bug in Bun. Please check your .patch file, or open a GitHub issue :)");
            } else {
                return globalThis.throwError(e, "failed to parse patch file");
            }
        };
        defer patchfile.deinit(bun.default_allocator);

        const str = bun.handleOom(std.fmt.allocPrint(bun.default_allocator, "{f}", .{std.json.fmt(patchfile, .{})}));
        const outstr = bun.String.borrowUTF8(str);
        return outstr.toJS(globalThis);
    }

    pub fn parseApplyArgs(globalThis: *jsc.JSGlobalObject, callframe: *jsc.CallFrame) bun.jsc.Node.Maybe(ApplyArgs, jsc.JSValue) {
        const arguments_ = callframe.arguments_old(2);
        var arguments = jsc.CallFrame.ArgumentsSlice.init(globalThis.bunVM(), arguments_.slice());

        const patchfile_js = arguments.nextEat() orelse {
            globalThis.throw("apply: expected at least 1 argument, got 0", .{}) catch {};
            return .initErr(.js_undefined);
        };

        const dir_fd = if (arguments.nextEat()) |dir_js| brk: {
            var bunstr = dir_js.toBunString(globalThis) catch return .initErr(.js_undefined);
            defer bunstr.deref();
            const path = bunstr.toOwnedSliceZ(bun.default_allocator) catch unreachable;
            defer bun.default_allocator.free(path);

            break :brk switch (bun.sys.open(path, bun.O.DIRECTORY | bun.O.RDONLY, 0)) {
                .err => |e| {
                    globalThis.throwValue(e.withPath(path).toJS(globalThis) catch return .initErr(.js_undefined)) catch {};
                    return .initErr(.js_undefined);
                },
                .result => |fd| fd,
            };
        } else bun.FD.cwd();

        const patchfile_bunstr = patchfile_js.toBunString(globalThis) catch return .initErr(.js_undefined);
        defer patchfile_bunstr.deref();
        const patchfile_src = patchfile_bunstr.toUTF8(bun.default_allocator);

        const patch_file = parsePatchFile(patchfile_src.slice()) catch |e| {
            // TODO: HAVE @zackradisic REVIEW THIS DIFF
            if (bun.FD.cwd() != dir_fd) {
                dir_fd.close();
            }

            patchfile_src.deinit();
            globalThis.throwError(e, "failed to parse patchfile") catch {};
            return .initErr(.js_undefined);
        };

        return .{
            .result = ApplyArgs{
                .dirfd = dir_fd,
                .patchfile = patch_file,
                .patchfile_txt = patchfile_src,
            },
        };
    }
};

const std = @import("std");

const bun = @import("bun");
const jsc = bun.jsc;

const PatchFile = bun.patch.PatchFile;
const gitDiffInternal = bun.patch.gitDiffInternal;
const parsePatchFile = bun.patch.parsePatchFile;
