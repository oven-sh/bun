//! Process information and control APIs (`globalThis.process` / `node:process`)
comptime {
    @export(&getTitle, .{ .name = "Bun__Process__getTitle" });
    @export(&setTitle, .{ .name = "Bun__Process__setTitle" });
    @export(&createArgv, .{ .name = "Bun__Process__createArgv" });
    @export(&getCwd, .{ .name = "Bun__Process__getCwd" });
    @export(&setCwd, .{ .name = "Bun__Process__setCwd" });
    @export(&exit, .{ .name = "Bun__Process__exit" });
    @export(&createArgv0, .{ .name = "Bun__Process__createArgv0" });
    @export(&getExecPath, .{ .name = "Bun__Process__getExecPath" });
    @export(&createExecArgv, .{ .name = "Bun__Process__createExecArgv" });
    @export(&getEval, .{ .name = "Bun__Process__getEval" });
}

var title_mutex = bun.Mutex{};

pub fn getTitle(_: *JSGlobalObject, title: *ZigString) callconv(.C) void {
    title_mutex.lock();
    defer title_mutex.unlock();
    const str = bun.CLI.Bun__Node__ProcessTitle;
    title.* = ZigString.init(str orelse "bun");
}

// TODO: https://github.com/nodejs/node/blob/master/deps/uv/src/unix/darwin-proctitle.c
pub fn setTitle(globalObject: *JSGlobalObject, newvalue: *ZigString) callconv(.C) JSValue {
    title_mutex.lock();
    defer title_mutex.unlock();
    if (bun.CLI.Bun__Node__ProcessTitle) |_| bun.default_allocator.free(bun.CLI.Bun__Node__ProcessTitle.?);
    bun.CLI.Bun__Node__ProcessTitle = newvalue.dupe(bun.default_allocator) catch bun.outOfMemory();
    return newvalue.toJS(globalObject);
}

pub fn createArgv0(globalObject: *JSC.JSGlobalObject) callconv(.C) JSC.JSValue {
    return JSC.ZigString.fromUTF8(bun.argv[0]).toJS(globalObject);
}

pub fn getExecPath(globalObject: *JSC.JSGlobalObject) callconv(.C) JSC.JSValue {
    const out = bun.selfExePath() catch {
        // if for any reason we are unable to get the executable path, we just return argv[0]
        return createArgv0(globalObject);
    };

    return JSC.ZigString.fromUTF8(out).toJS(globalObject);
}

fn createExecArgv(globalObject: *JSC.JSGlobalObject) callconv(.C) JSC.JSValue {
    var sfb = std.heap.stackFallback(4096, globalObject.allocator());
    const temp_alloc = sfb.get();
    const vm = globalObject.bunVM();

    if (vm.worker) |worker| {
        // was explicitly overridden for the worker?
        if (worker.execArgv) |execArgv| {
            const array = JSC.JSValue.createEmptyArray(globalObject, execArgv.len) catch return .zero;
            for (0..execArgv.len) |i| {
                array.putIndex(globalObject, @intCast(i), bun.String.init(execArgv[i]).toJS(globalObject));
            }
            return array;
        }
    }

    var args = std.ArrayList(bun.String).initCapacity(temp_alloc, bun.argv.len - 1) catch bun.outOfMemory();
    defer args.deinit();
    defer for (args.items) |*arg| arg.deref();

    var seen_run = false;
    var prev: ?[]const u8 = null;

    // we re-parse the process argv to extract execArgv, since this is a very uncommon operation
    // it isn't worth doing this as a part of the CLI
    for (bun.argv[@min(1, bun.argv.len)..]) |arg| {
        defer prev = arg;

        if (arg.len >= 1 and arg[0] == '-') {
            args.append(bun.String.createUTF8(arg)) catch bun.outOfMemory();
            continue;
        }

        if (!seen_run and bun.strings.eqlComptime(arg, "run")) {
            seen_run = true;
            continue;
        }

        // A set of execArgv args consume an extra argument, so we do not want to
        // confuse these with script names.
        const map = bun.ComptimeStringMap(void, comptime brk: {
            const auto_params = bun.CLI.Arguments.auto_params;
            const KV = struct { []const u8, void };
            var entries: [auto_params.len]KV = undefined;
            var i = 0;
            for (auto_params) |param| {
                if (param.takes_value != .none) {
                    if (param.names.long) |name| {
                        entries[i] = .{ "--" ++ name, {} };
                        i += 1;
                    }
                    if (param.names.short) |name| {
                        entries[i] = .{ &[_]u8{ '-', name }, {} };
                        i += 1;
                    }
                }
            }

            var result: [i]KV = undefined;
            @memcpy(&result, entries[0..i]);
            break :brk result;
        });

        if (prev) |p| if (map.has(p)) {
            args.append(bun.String.createUTF8(arg)) catch @panic("OOM");
            continue;
        };

        // we hit the script name
        break;
    }

    return bun.String.toJSArray(globalObject, args.items) catch .zero;
}

fn createArgv(globalObject: *JSC.JSGlobalObject) callconv(.C) JSC.JSValue {
    const vm = globalObject.bunVM();

    // Allocate up to 32 strings in stack
    var stack_fallback_allocator = std.heap.stackFallback(
        32 * @sizeOf(JSC.ZigString) + (bun.MAX_PATH_BYTES + 1) + 32,
        bun.default_allocator,
    );
    const allocator = stack_fallback_allocator.get();

    var args_count: usize = vm.argv.len;
    if (vm.worker) |worker| {
        args_count = worker.argv.len;
    }

    const args = allocator.alloc(
        bun.String,
        // argv omits "bun" because it could be "bun run" or "bun" and it's kind of ambiguous
        // argv also omits the script name
        args_count + 2,
    ) catch bun.outOfMemory();
    defer allocator.free(args);

    var args_list: std.ArrayListUnmanaged(bun.String) = .initBuffer(args);

    if (vm.standalone_module_graph != null) {
        // Don't break user's code because they did process.argv.slice(2)
        // Even if they didn't type "bun", we still want to add it as argv[0]
        args_list.appendAssumeCapacity(
            bun.String.static("bun"),
        );
    } else {
        const exe_path = bun.selfExePath() catch null;
        args_list.appendAssumeCapacity(
            if (exe_path) |str| bun.String.fromUTF8(str) else bun.String.static("bun"),
        );
    }

    if (vm.main.len > 0 and
        !strings.endsWithComptime(vm.main, bun.pathLiteral("/[eval]")) and
        !strings.endsWithComptime(vm.main, bun.pathLiteral("/[stdin]")))
    {
        if (vm.worker != null and vm.worker.?.eval_mode) {
            args_list.appendAssumeCapacity(bun.String.static("[worker eval]"));
        } else {
            args_list.appendAssumeCapacity(bun.String.fromUTF8(vm.main));
        }
    }

    defer allocator.free(args);

    if (vm.worker) |worker| {
        for (worker.argv) |arg| {
            args_list.appendAssumeCapacity(bun.String.init(arg));
        }
    } else {
        for (vm.argv) |arg| {
            const str = bun.String.fromUTF8(arg);
            // https://github.com/yargs/yargs/blob/adb0d11e02c613af3d9427b3028cc192703a3869/lib/utils/process-argv.ts#L1
            args_list.appendAssumeCapacity(str);
        }
    }

    return bun.String.toJSArray(globalObject, args_list.items) catch .zero;
}

extern fn Bun__Process__getArgv(global: *JSGlobalObject) JSValue;
pub fn getArgv(global: *JSGlobalObject) callconv(.c) JSValue {
    return Bun__Process__getArgv(global);
}

extern fn Bun__Process__getExecArgv(global: *JSGlobalObject) JSValue;
pub fn getExecArgv(global: *JSGlobalObject) callconv(.c) JSValue {
    return Bun__Process__getExecArgv(global);
}

pub fn getEval(globalObject: *JSC.JSGlobalObject) callconv(.C) JSC.JSValue {
    const vm = globalObject.bunVM();
    if (vm.module_loader.eval_source) |source| {
        return JSC.ZigString.init(source.contents).toJS(globalObject);
    }
    return .js_undefined;
}

pub const getCwd = JSC.host_fn.wrap1(getCwd_);
fn getCwd_(globalObject: *JSC.JSGlobalObject) bun.JSError!JSC.JSValue {
    var buf: bun.PathBuffer = undefined;
    switch (bun.api.node.path.getCwd(&buf)) {
        .result => |r| return JSC.ZigString.init(r).withEncoding().toJS(globalObject),
        .err => |e| {
            return globalObject.throwValue(e.toJSC(globalObject));
        },
    }
}

pub const setCwd = JSC.host_fn.wrap2(setCwd_);
fn setCwd_(globalObject: *JSC.JSGlobalObject, to: *JSC.ZigString) bun.JSError!JSC.JSValue {
    if (to.len == 0) {
        return globalObject.throwInvalidArguments("Expected path to be a non-empty string", .{});
    }
    const vm = globalObject.bunVM();
    const fs = vm.transpiler.fs;

    var buf: bun.PathBuffer = undefined;
    const slice = to.sliceZBuf(&buf) catch return globalObject.throw("Invalid path", .{});

    switch (Syscall.chdir(fs.top_level_dir, slice)) {
        .result => {
            // When we update the cwd from JS, we have to update the bundler's version as well
            // However, this might be called many times in a row, so we use a pre-allocated buffer
            // that way we don't have to worry about garbage collector
            const into_cwd_buf = switch (bun.sys.getcwd(&buf)) {
                .result => |r| r,
                .err => |err| {
                    _ = Syscall.chdir(fs.top_level_dir, fs.top_level_dir);
                    return globalObject.throwValue(err.toJSC(globalObject));
                },
            };
            @memcpy(fs.top_level_dir_buf[0..into_cwd_buf.len], into_cwd_buf);
            fs.top_level_dir_buf[into_cwd_buf.len] = 0;
            fs.top_level_dir = fs.top_level_dir_buf[0..into_cwd_buf.len :0];

            const len = fs.top_level_dir.len;
            // Ensure the path ends with a slash
            if (fs.top_level_dir_buf[len - 1] != std.fs.path.sep) {
                fs.top_level_dir_buf[len] = std.fs.path.sep;
                fs.top_level_dir_buf[len + 1] = 0;
                fs.top_level_dir = fs.top_level_dir_buf[0 .. len + 1 :0];
            }
            const withoutTrailingSlash = if (Environment.isWindows) strings.withoutTrailingSlashWindowsPath else strings.withoutTrailingSlash;
            var str = bun.String.createUTF8(withoutTrailingSlash(fs.top_level_dir));
            return str.transferToJS(globalObject);
        },
        .err => |e| {
            return globalObject.throwValue(e.toJSC(globalObject));
        },
    }
}

// TODO(@190n) this may need to be noreturn
pub fn exit(globalObject: *JSC.JSGlobalObject, code: u8) callconv(.c) void {
    var vm = globalObject.bunVM();
    vm.exit_handler.exit_code = code;
    if (vm.worker) |worker| {
        // TODO(@190n) we may need to use requestTerminate or throwTerminationException
        // instead to terminate the worker sooner
        worker.exit();
    } else {
        vm.onExit();
        vm.globalExit();
    }
}

// TODO: switch this to using *bun.wtf.String when it is added
pub fn Bun__Process__editWindowsEnvVar(k: bun.String, v: bun.String) callconv(.C) void {
    comptime bun.assert(bun.Environment.isWindows);
    if (k.tag == .Empty) return;
    const wtf1 = k.value.WTFStringImpl;
    var fixed_stack_allocator = std.heap.stackFallback(1025, bun.default_allocator);
    const allocator = fixed_stack_allocator.get();
    var buf1 = allocator.alloc(u16, k.utf16ByteLength() + 1) catch bun.outOfMemory();
    defer allocator.free(buf1);
    var buf2 = allocator.alloc(u16, v.utf16ByteLength() + 1) catch bun.outOfMemory();
    defer allocator.free(buf2);
    const len1: usize = switch (wtf1.is8Bit()) {
        true => bun.strings.copyLatin1IntoUTF16([]u16, buf1, []const u8, wtf1.latin1Slice()).written,
        false => b: {
            @memcpy(buf1[0..wtf1.length()], wtf1.utf16Slice());
            break :b wtf1.length();
        },
    };
    buf1[len1] = 0;
    const str2: ?[*:0]const u16 = if (v.tag != .Dead) str: {
        if (v.tag == .Empty) break :str (&[_]u16{0})[0..0 :0];
        const wtf2 = v.value.WTFStringImpl;
        const len2: usize = switch (wtf2.is8Bit()) {
            true => bun.strings.copyLatin1IntoUTF16([]u16, buf2, []const u8, wtf2.latin1Slice()).written,
            false => b: {
                @memcpy(buf2[0..wtf2.length()], wtf2.utf16Slice());
                break :b wtf2.length();
            },
        };
        buf2[len2] = 0;
        break :str buf2[0..len2 :0].ptr;
    } else null;
    _ = bun.c.SetEnvironmentVariableW(buf1[0..len1 :0].ptr, str2);
}

comptime {
    if (Environment.export_cpp_apis and Environment.isWindows) {
        @export(&Bun__Process__editWindowsEnvVar, .{ .name = "Bun__Process__editWindowsEnvVar" });
    }
}

pub export const Bun__version: [*:0]const u8 = "v" ++ bun.Global.package_json_version;
pub export const Bun__version_with_sha: [*:0]const u8 = "v" ++ bun.Global.package_json_version_with_sha;
pub export const Bun__versions_boringssl: [*:0]const u8 = bun.Global.versions.boringssl;
pub export const Bun__versions_libarchive: [*:0]const u8 = bun.Global.versions.libarchive;
pub export const Bun__versions_mimalloc: [*:0]const u8 = bun.Global.versions.mimalloc;
pub export const Bun__versions_picohttpparser: [*:0]const u8 = bun.Global.versions.picohttpparser;
pub export const Bun__versions_uws: [*:0]const u8 = bun.Environment.git_sha;
pub export const Bun__versions_webkit: [*:0]const u8 = bun.Global.versions.webkit;
pub export const Bun__versions_zig: [*:0]const u8 = bun.Global.versions.zig;
pub export const Bun__versions_zlib: [*:0]const u8 = bun.Global.versions.zlib;
pub export const Bun__versions_tinycc: [*:0]const u8 = bun.Global.versions.tinycc;
pub export const Bun__versions_lolhtml: [*:0]const u8 = bun.Global.versions.lolhtml;
pub export const Bun__versions_c_ares: [*:0]const u8 = bun.Global.versions.c_ares;
pub export const Bun__versions_libdeflate: [*:0]const u8 = bun.Global.versions.libdeflate;
pub export const Bun__versions_usockets: [*:0]const u8 = bun.Environment.git_sha;
pub export const Bun__version_sha: [*:0]const u8 = bun.Environment.git_sha;
pub export const Bun__versions_lshpack: [*:0]const u8 = bun.Global.versions.lshpack;
pub export const Bun__versions_zstd: [*:0]const u8 = bun.Global.versions.zstd;

const std = @import("std");
const Environment = bun.Environment;
const bun = @import("bun");
const JSC = bun.JSC;
const JSGlobalObject = JSC.JSGlobalObject;
const JSValue = JSC.JSValue;
const ZigString = JSC.ZigString;
const Syscall = bun.sys;
const strings = bun.strings;
