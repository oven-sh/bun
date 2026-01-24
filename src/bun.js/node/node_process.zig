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
    @export(&bun.jsc.host_fn.wrap1(createExecArgv), .{ .name = "Bun__Process__createExecArgv" });
    @export(&getEval, .{ .name = "Bun__Process__getEval" });
}

var title_mutex = bun.Mutex{};

pub fn getTitle(_: *JSGlobalObject, title: *bun.String) callconv(.c) void {
    title_mutex.lock();
    defer title_mutex.unlock();
    const str = bun.cli.Bun__Node__ProcessTitle;
    title.* = bun.String.cloneUTF8(str orelse "bun");
}

// TODO: https://github.com/nodejs/node/blob/master/deps/uv/src/unix/darwin-proctitle.c
pub fn setTitle(globalObject: *JSGlobalObject, newvalue: *bun.String) callconv(.c) void {
    defer newvalue.deref();
    title_mutex.lock();
    defer title_mutex.unlock();

    const new_title = newvalue.toOwnedSlice(bun.default_allocator) catch {
        globalObject.throwOutOfMemory() catch {};
        return;
    };

    if (bun.cli.Bun__Node__ProcessTitle) |slice| bun.default_allocator.free(slice);
    bun.cli.Bun__Node__ProcessTitle = new_title;
}

pub fn createArgv0(globalObject: *jsc.JSGlobalObject) callconv(.c) jsc.JSValue {
    return jsc.ZigString.fromUTF8(bun.argv[0]).toJS(globalObject);
}

pub fn getExecPath(globalObject: *jsc.JSGlobalObject) callconv(.c) jsc.JSValue {
    const out = bun.selfExePath() catch {
        // if for any reason we are unable to get the executable path, we just return argv[0]
        return createArgv0(globalObject);
    };

    return jsc.ZigString.fromUTF8(out).toJS(globalObject);
}

fn createExecArgv(globalObject: *jsc.JSGlobalObject) bun.JSError!jsc.JSValue {
    var sfb = std.heap.stackFallback(4096, globalObject.allocator());
    const temp_alloc = sfb.get();
    const vm = globalObject.bunVM();

    if (vm.worker) |worker| {
        // was explicitly overridden for the worker?
        if (worker.execArgv) |execArgv| {
            const array = try jsc.JSValue.createEmptyArray(globalObject, execArgv.len);
            for (0..execArgv.len) |i| {
                try array.putIndex(globalObject, @intCast(i), try bun.String.init(execArgv[i]).toJS(globalObject));
            }
            return array;
        }
    }

    // For compiled/standalone executables, execArgv should contain compile_exec_argv and BUN_OPTIONS.
    // Use appendOptionsEnv for BUN_OPTIONS to correctly handle quoted values.
    if (vm.standalone_module_graph) |graph| {
        if (graph.compile_exec_argv.len > 0 or bun.bun_options_argc > 0) {
            var args = std.array_list.Managed(bun.String).init(temp_alloc);
            defer args.deinit();
            defer for (args.items) |*arg| arg.deref();

            // Process BUN_OPTIONS first using appendOptionsEnv for proper quote handling.
            // appendOptionsEnv inserts starting at index 1, so we need a placeholder.
            if (bun.bun_options_argc > 0) {
                if (bun.env_var.BUN_OPTIONS.get()) |opts| {
                    try args.append(bun.String.empty); // placeholder for insert-at-1
                    try bun.appendOptionsEnv(opts, bun.String, &args);
                    _ = args.orderedRemove(0); // remove placeholder
                }
            }

            if (graph.compile_exec_argv.len > 0) {
                var tokenizer = std.mem.tokenizeAny(u8, graph.compile_exec_argv, " \t\n\r");
                while (tokenizer.next()) |token| {
                    try args.append(bun.String.cloneUTF8(token));
                }
            }

            const array = try jsc.JSValue.createEmptyArray(globalObject, args.items.len);
            for (0..args.items.len) |idx| {
                try array.putIndex(globalObject, @intCast(idx), try args.items[idx].toJS(globalObject));
            }
            return array;
        }
        return try jsc.JSValue.createEmptyArray(globalObject, 0);
    }

    var args = try std.array_list.Managed(bun.String).initCapacity(temp_alloc, bun.argv.len - 1);
    defer args.deinit();
    defer for (args.items) |*arg| arg.deref();

    var seen_run = false;
    var prev: ?[]const u8 = null;

    // we re-parse the process argv to extract execArgv, since this is a very uncommon operation
    // it isn't worth doing this as a part of the CLI
    for (bun.argv[@min(1, bun.argv.len)..]) |arg| {
        defer prev = arg;

        if (arg.len >= 1 and arg[0] == '-') {
            try args.append(bun.String.cloneUTF8(arg));
            continue;
        }

        if (!seen_run and bun.strings.eqlComptime(arg, "run")) {
            seen_run = true;
            continue;
        }

        // A set of execArgv args consume an extra argument, so we do not want to
        // confuse these with script names.
        const map = bun.ComptimeStringMap(void, comptime brk: {
            const auto_params = bun.cli.Arguments.auto_params;
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
            try args.append(bun.String.cloneUTF8(arg));
            continue;
        };

        // we hit the script name
        break;
    }

    return bun.String.toJSArray(globalObject, args.items);
}

fn createArgv(globalObject: *jsc.JSGlobalObject) callconv(.c) jsc.JSValue {
    const vm = globalObject.bunVM();

    // Allocate up to 32 strings in stack
    var stack_fallback_allocator = std.heap.stackFallback(
        32 * @sizeOf(jsc.ZigString) + (bun.MAX_PATH_BYTES + 1) + 32,
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
    ) catch |err| bun.handleOom(err);
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
            if (exe_path) |str| bun.String.borrowUTF8(str) else bun.String.static("bun"),
        );
    }

    if (vm.main.len > 0 and
        !strings.endsWithComptime(vm.main, bun.pathLiteral("/[eval]")) and
        !strings.endsWithComptime(vm.main, bun.pathLiteral("/[stdin]")))
    {
        if (vm.worker != null and vm.worker.?.eval_mode) {
            args_list.appendAssumeCapacity(bun.String.static("[worker eval]"));
        } else {
            args_list.appendAssumeCapacity(bun.String.borrowUTF8(vm.main));
        }
    }

    if (vm.worker) |worker| {
        for (worker.argv) |arg| {
            args_list.appendAssumeCapacity(bun.String.init(arg));
        }
    } else {
        for (vm.argv) |arg| {
            const str = bun.String.borrowUTF8(arg);
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

pub fn getEval(globalObject: *jsc.JSGlobalObject) callconv(.c) jsc.JSValue {
    const vm = globalObject.bunVM();
    if (vm.module_loader.eval_source) |source| {
        return jsc.ZigString.init(source.contents).toJS(globalObject);
    }
    return .js_undefined;
}

pub const getCwd = jsc.host_fn.wrap1(getCwd_);
fn getCwd_(globalObject: *jsc.JSGlobalObject) bun.JSError!jsc.JSValue {
    var buf: bun.PathBuffer = undefined;
    switch (bun.api.node.path.getCwd(&buf)) {
        .result => |r| return jsc.ZigString.init(r).withEncoding().toJS(globalObject),
        .err => |e| {
            return globalObject.throwValue(try e.toJS(globalObject));
        },
    }
}

pub const setCwd = jsc.host_fn.wrap2(setCwd_);
fn setCwd_(globalObject: *jsc.JSGlobalObject, to: *jsc.ZigString) bun.JSError!jsc.JSValue {
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
                    return globalObject.throwValue(try err.toJS(globalObject));
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
            var str = bun.String.cloneUTF8(withoutTrailingSlash(fs.top_level_dir));
            return str.transferToJS(globalObject);
        },
        .err => |e| {
            return globalObject.throwValue(try e.toJS(globalObject));
        },
    }
}

// TODO(@190n) this may need to be noreturn
pub fn exit(globalObject: *jsc.JSGlobalObject, code: u8) callconv(.c) void {
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
pub fn Bun__Process__editWindowsEnvVar(k: bun.String, v: bun.String) callconv(.c) void {
    comptime bun.assert(bun.Environment.isWindows);
    if (k.tag == .Empty) return;
    const wtf1 = k.value.WTFStringImpl;
    var fixed_stack_allocator = std.heap.stackFallback(1025, bun.default_allocator);
    const allocator = fixed_stack_allocator.get();
    var buf1 = bun.handleOom(allocator.alloc(u16, k.utf16ByteLength() + 1));
    defer allocator.free(buf1);
    var buf2 = bun.handleOom(allocator.alloc(u16, v.utf16ByteLength() + 1));
    defer allocator.free(buf2);
    const len1: usize = switch (wtf1.is8Bit()) {
        true => bun.strings.copyLatin1IntoUTF16([]u16, buf1, wtf1.latin1Slice()).written,
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
            true => bun.strings.copyLatin1IntoUTF16([]u16, buf2, wtf2.latin1Slice()).written,
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

pub export fn Bun__NODE_NO_WARNINGS() bool {
    return bun.feature_flag.NODE_NO_WARNINGS.get();
}

pub export fn Bun__suppressCrashOnProcessKillSelfIfDesired() void {
    if (bun.feature_flag.BUN_INTERNAL_SUPPRESS_CRASH_ON_PROCESS_KILL_SELF.get()) {
        bun.crash_handler.suppressReporting();
    }
}

pub export const Bun__version: [*:0]const u8 = "v" ++ bun.Global.package_json_version;
pub export const Bun__version_with_sha: [*:0]const u8 = "v" ++ bun.Global.package_json_version_with_sha;
// Version exports removed - now handled by CMake-generated header (bun_dependency_versions.h)
// The C++ code in BunProcess.cpp uses the generated header directly
pub export const Bun__versions_uws: [*:0]const u8 = bun.Environment.git_sha;
pub export const Bun__versions_usockets: [*:0]const u8 = bun.Environment.git_sha;
pub export const Bun__version_sha: [*:0]const u8 = bun.Environment.git_sha;

const std = @import("std");

const bun = @import("bun");
const Environment = bun.Environment;
const Syscall = bun.sys;
const strings = bun.strings;

const jsc = bun.jsc;
const JSGlobalObject = jsc.JSGlobalObject;
const JSValue = jsc.JSValue;
const ZigString = jsc.ZigString;
