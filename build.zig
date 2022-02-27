const std = @import("std");
const resolve_path = @import("./src/resolver/resolve_path.zig");

fn pkgPath(comptime out: []const u8) std.build.FileSource {
    const outpath = comptime std.fs.path.dirname(@src().file).? ++ std.fs.path.sep_str ++ out;
    return .{ .path = outpath };
}
pub fn addPicoHTTP(step: *std.build.LibExeObjStep, comptime with_obj: bool) void {
    step.addIncludeDir("src/deps");

    if (with_obj) {
        step.addObjectFile("src/deps/picohttpparser.o");
    }

    step.addIncludeDir("src/deps");

    if (with_obj) {
        step.addObjectFile(panicIfNotFound("src/deps/picohttpparser.o"));
        step.addObjectFile(panicIfNotFound("src/deps/libssl.a"));
        step.addObjectFile(panicIfNotFound("src/deps/libcrypto.a"));
    }

    // step.add("/Users/jarred/Code/WebKit/WebKitBuild/Release/lib/libWTF.a");

    // ./Tools/Scripts/build-jsc --jsc-only  --cmakeargs="-DENABLE_STATIC_JSC=ON"
    // set -gx ICU_INCLUDE_DIRS "/usr/local/opt/icu4c/include"
    // homebrew-provided icu4c
}

const color_map = std.ComptimeStringMap([]const u8, .{
    &.{ "black", "30m" },
    &.{ "blue", "34m" },
    &.{ "b", "1m" },
    &.{ "d", "2m" },
    &.{ "cyan", "36m" },
    &.{ "green", "32m" },
    &.{ "magenta", "35m" },
    &.{ "red", "31m" },
    &.{ "white", "37m" },
    &.{ "yellow", "33m" },
});

fn addInternalPackages(step: *std.build.LibExeObjStep, _: std.mem.Allocator, target: anytype) !void {
    var boringssl: std.build.Pkg = .{
        .name = "boringssl",
        .path = pkgPath("src/deps/boringssl.zig"),
    };

    var thread_pool: std.build.Pkg = .{
        .name = "thread_pool",
        .path = pkgPath("src/thread_pool.zig"),
    };

    var crash_reporter: std.build.Pkg = .{
        .name = "crash_reporter",
        .path = pkgPath("src/deps/backtrace.zig"),
    };

    var picohttp: std.build.Pkg = .{
        .name = "picohttp",
        .path = pkgPath("src/deps/picohttp.zig"),
    };

    var io_darwin: std.build.Pkg = .{
        .name = "io",
        .path = pkgPath("src/io/io_darwin.zig"),
    };
    var io_linux: std.build.Pkg = .{
        .name = "io",
        .path = pkgPath("src/io/io_linux.zig"),
    };

    var io = if (target.isDarwin())
        io_darwin
    else
        io_linux;

    var strings: std.build.Pkg = .{
        .name = "strings",
        .path = pkgPath("src/string_immutable.zig"),
    };

    var clap: std.build.Pkg = .{
        .name = "clap",
        .path = pkgPath("src/deps/zig-clap/clap.zig"),
    };

    var http: std.build.Pkg = .{
        .name = "http",
        .path = pkgPath("src/http_client_async.zig"),
    };

    var javascript_core: std.build.Pkg = .{
        .name = "javascript_core",
        .path = pkgPath("src/jsc.zig"),
    };

    var analytics: std.build.Pkg = .{
        .name = "analytics",
        .path = pkgPath("src/analytics.zig"),
    };

    io.dependencies = &.{analytics};

    javascript_core.dependencies = &.{ http, strings, picohttp, io };
    http.dependencies = &.{
        strings,
        picohttp,
        io,
        boringssl,
        thread_pool,
    };
    thread_pool.dependencies = &.{ io, http };
    http.dependencies = &.{
        strings,
        picohttp,
        io,
        boringssl,
        thread_pool,
    };
    thread_pool.dependencies = &.{ io, http };

    thread_pool.dependencies = &.{
        io,
        http,
    };

    step.addPackage(thread_pool);
    step.addPackage(picohttp);
    step.addPackage(io);
    step.addPackage(strings);
    step.addPackage(clap);
    step.addPackage(http);
    step.addPackage(boringssl);
    step.addPackage(javascript_core);
    step.addPackage(crash_reporter);
}
var output_dir: []const u8 = "";
fn panicIfNotFound(comptime filepath: []const u8) []const u8 {
    var file = std.fs.cwd().openFile(filepath, .{ .read = true }) catch |err| {
        std.debug.panic("error: {s} opening {s}. Please ensure you've downloaded git submodules, and ran `make vendor`, `make jsc`.", .{ filepath, @errorName(err) });
    };
    file.close();

    return filepath;
}

fn updateRuntime() anyerror!void {
    var runtime_out_file = try std.fs.cwd().openFile("src/runtime.out.js", .{ .read = true });
    const runtime_hash = std.hash.Wyhash.hash(
        0,
        try runtime_out_file.readToEndAlloc(std.heap.page_allocator, try runtime_out_file.getEndPos()),
    );
    const runtime_version_file = std.fs.cwd().createFile("src/runtime.version", .{ .truncate = true }) catch std.debug.panic("Failed to create src/runtime.version", .{});
    defer runtime_version_file.close();
    runtime_version_file.writer().print("{x}", .{runtime_hash}) catch unreachable;
    var fallback_out_file = try std.fs.cwd().openFile("src/fallback.out.js", .{ .read = true });
    const fallback_hash = std.hash.Wyhash.hash(
        0,
        try fallback_out_file.readToEndAlloc(std.heap.page_allocator, try fallback_out_file.getEndPos()),
    );

    const fallback_version_file = std.fs.cwd().createFile("src/fallback.version", .{ .truncate = true }) catch std.debug.panic("Failed to create src/fallback.version", .{});

    fallback_version_file.writer().print("{x}", .{fallback_hash}) catch unreachable;

    fallback_version_file.close();
}

var x64 = "x64";
var mode: std.builtin.Mode = undefined;
pub fn build(b: *std.build.Builder) !void {
    // Standard target options allows the person running `zig build` to choose
    // what target to build for. Here we do not override the defaults, which
    // means any target is allowed, and the default is native. Other options
    // for restricting supported target set are available.
    var target = b.standardTargetOptions(.{});
    // Standard release options allow the person running `zig build` to select
    // between Debug, ReleaseSafe, ReleaseFast, and ReleaseSmall.
    mode = b.standardReleaseOptions();

    const cwd: []const u8 = b.pathFromRoot(".");
    var exe: *std.build.LibExeObjStep = undefined;
    var output_dir_buf = std.mem.zeroes([4096]u8);
    var bin_label = if (mode == std.builtin.Mode.Debug) "packages/debug-bun-" else "packages/bun-";

    var triplet_buf: [64]u8 = undefined;
    var os_tagname = @tagName(target.getOs().tag);

    const arch: std.Target.Cpu.Arch = target.getCpuArch();

    if (std.mem.eql(u8, os_tagname, "macos")) {
        os_tagname = "darwin";
        if (arch.isAARCH64()) {
            target.os_version_min = std.zig.CrossTarget.OsVersion{ .semver = .{ .major = 11, .minor = 0, .patch = 0 } };
        } else if (arch.isX86()) {
            target.os_version_min = std.zig.CrossTarget.OsVersion{ .semver = .{ .major = 10, .minor = 14, .patch = 0 } };
        }
    } else if (target.isLinux()) {
        target.setGnuLibCVersion(2, 27, 0);
    }

    std.mem.copy(
        u8,
        &triplet_buf,
        os_tagname,
    );
    var osname = triplet_buf[0..os_tagname.len];
    triplet_buf[osname.len] = '-';

    std.mem.copy(u8, triplet_buf[osname.len + 1 ..], @tagName(target.getCpuArch()));
    var cpuArchName = triplet_buf[osname.len + 1 ..][0..@tagName(target.getCpuArch()).len];
    std.mem.replaceScalar(u8, cpuArchName, '_', '-');
    if (std.mem.eql(u8, cpuArchName, "x86-64")) {
        std.mem.copy(u8, cpuArchName, "x64");
        cpuArchName = cpuArchName[0..3];
    }

    var triplet = triplet_buf[0 .. osname.len + cpuArchName.len + 1];

    const output_dir_base = try std.fmt.bufPrint(&output_dir_buf, "{s}{s}", .{ bin_label, triplet });
    output_dir = b.pathFromRoot(output_dir_base);
    const bun_executable_name = if (mode == std.builtin.Mode.Debug) "bun-debug" else "bun";
    exe = b.addExecutable(bun_executable_name, "src/main.zig");
    // exe.setLibCFile("libc.txt");
    exe.linkLibC();
    // exe.linkLibCpp();

    exe.setOutputDir(output_dir);
    updateRuntime() catch {};

    exe.setTarget(target);
    exe.setBuildMode(mode);
    b.install_path = output_dir;

    var typings_exe = b.addExecutable("typescript-decls", "src/typegen.zig");

    // exe.want_lto = true;
    defer b.default_step.dependOn(&b.addLog("Output: {s}/{s}\n", .{ output_dir, bun_executable_name }).step);
    defer b.default_step.dependOn(&b.addLog(
        "Build {s} v{} - v{}\n",
        .{
            triplet,
            target.getOsVersionMin().semver,
            target.getOsVersionMax().semver,
        },
    ).step);

    var obj_step = b.step("obj", "Build bun as a .o file");
    var obj = b.addObject(bun_executable_name, exe.root_src.?.path);

    {
        obj.setTarget(target);
        addPicoHTTP(obj, false);
        obj.setMainPkgPath(b.pathFromRoot("."));

        try addInternalPackages(
            obj,
            b.allocator,
            target,
        );

        {
            obj_step.dependOn(&b.addLog(
                "Build {s} v{} - v{}\n",
                .{
                    triplet,
                    obj.target.getOsVersionMin().semver,
                    obj.target.getOsVersionMax().semver,
                },
            ).step);
        }

        obj_step.dependOn(&obj.step);

        obj.setOutputDir(output_dir);
        obj.setBuildMode(mode);
        obj.linkLibC();
        obj.linkLibCpp();
        if (mode == std.builtin.Mode.Debug)
            obj.emit_llvm_ir = .{
                .emit_to = try std.fmt.allocPrint(b.allocator, "{s}/{s}.ll", .{ output_dir, bun_executable_name }),
            };

        obj.strip = false;
        obj.bundle_compiler_rt = true;
        obj.omit_frame_pointer = false;

        b.default_step.dependOn(&obj.step);

        if (target.getOsTag() == .linux) {
            // obj.want_lto = tar;
            obj.link_emit_relocs = true;
            obj.link_eh_frame_hdr = true;
            obj.link_function_sections = true;
        }

        var log_step = b.addLog("Destination: {s}/{s}\n", .{ output_dir, bun_executable_name });
        log_step.step.dependOn(&obj.step);
    }

    {
        const headers_step = b.step("headers-obj", "Build JavaScriptCore headers");
        var headers_obj: *std.build.LibExeObjStep = b.addObject("headers", "src/bindgen.zig");
        defer headers_step.dependOn(&headers_obj.step);
        try configureObjectStep(headers_obj, target, obj.main_pkg_path.?);
    }

    {
        const headers_step = b.step("httpbench-obj", "Build HTTPBench tool (object files)");
        var headers_obj: *std.build.LibExeObjStep = b.addObject("httpbench", "misctools/http_bench.zig");
        defer headers_step.dependOn(&headers_obj.step);
        try configureObjectStep(headers_obj, target, obj.main_pkg_path.?);
    }

    {
        const headers_step = b.step("fetch-obj", "Build fetch (object files)");
        var headers_obj: *std.build.LibExeObjStep = b.addObject("fetch", "misctools/fetch.zig");
        defer headers_step.dependOn(&headers_obj.step);
        try configureObjectStep(headers_obj, target, obj.main_pkg_path.?);
    }

    {
        const headers_step = b.step("tgz-obj", "Build tgz (object files)");
        var headers_obj: *std.build.LibExeObjStep = b.addObject("tgz", "misctools/tgz.zig");
        defer headers_step.dependOn(&headers_obj.step);
        try configureObjectStep(headers_obj, target, obj.main_pkg_path.?);
    }

    {
        const headers_step = b.step("test", "Build test");

        var test_file = b.option([]const u8, "test-file", "Input file for test");
        var test_bin_ = b.option([]const u8, "test-bin", "Emit bin to");
        var test_filter = b.option([]const u8, "test-filter", "Filter for test");

        var headers_obj: *std.build.LibExeObjStep = b.addTest(test_file orelse "src/main.zig");
        headers_obj.setFilter(test_filter);
        if (test_bin_) |test_bin| {
            headers_obj.name = std.fs.path.basename(test_bin);
            if (std.fs.path.dirname(test_bin)) |dir| headers_obj.setOutputDir(dir);
        }

        try configureObjectStep(headers_obj, target, obj.main_pkg_path.?);
        try linkObjectFiles(b, headers_obj, target);
        {
            var before = b.addLog("\x1b[" ++ color_map.get("magenta").? ++ "\x1b[" ++ color_map.get("b").? ++ "[{s} tests]" ++ "\x1b[" ++ color_map.get("d").? ++ " ----\n\n" ++ "\x1b[0m", .{"bun"});
            var after = b.addLog("\x1b[" ++ color_map.get("d").? ++ "–––---\n\n" ++ "\x1b[0m", .{});
            headers_step.dependOn(&before.step);
            headers_step.dependOn(&headers_obj.step);
            headers_step.dependOn(&after.step);
        }

        for (headers_obj.packages.items) |pkg_| {
            const pkg: std.build.Pkg = pkg_;
            if (std.mem.eql(u8, pkg.name, "clap")) continue;
            var test_ = b.addTestSource(pkg.path);

            test_.setMainPkgPath(obj.main_pkg_path.?);
            test_.setTarget(target);
            try linkObjectFiles(b, test_, target);
            if (pkg.dependencies) |children| {
                test_.packages = std.ArrayList(std.build.Pkg).init(b.allocator);
                try test_.packages.appendSlice(children);
            }

            var before = b.addLog("\x1b[" ++ color_map.get("magenta").? ++ "\x1b[" ++ color_map.get("b").? ++ "[{s} tests]" ++ "\x1b[" ++ color_map.get("d").? ++ " ----\n\n" ++ "\x1b[0m", .{pkg.name});
            var after = b.addLog("\x1b[" ++ color_map.get("d").? ++ "–––---\n\n" ++ "\x1b[0m", .{});
            headers_step.dependOn(&before.step);
            headers_step.dependOn(&test_.step);
            headers_step.dependOn(&after.step);
        }
    }

    try configureObjectStep(typings_exe, target, obj.main_pkg_path.?);
    try linkObjectFiles(b, typings_exe, target);

    var typings_cmd: *std.build.RunStep = typings_exe.run();
    typings_cmd.cwd = cwd;
    typings_cmd.addArg(cwd);
    typings_cmd.addArg("types");
    typings_cmd.step.dependOn(&typings_exe.step);
    if (target.getOsTag() == .macos) {
        typings_exe.linkSystemLibrary("icucore");
        typings_exe.linkSystemLibrary("iconv");
        typings_exe.addLibPath(
            "/Applications/Xcode.app/Contents/Developer/Platforms/MacOSX.platform/Developer/SDKs/MacOSX.sdk/usr/lib",
        );
    }

    var typings_step = b.step("types", "Build TypeScript types");
    typings_step.dependOn(&typings_cmd.step);
}

pub var original_make_fn: ?fn (step: *std.build.Step) anyerror!void = null;

// Due to limitations in std.build.Builder
// we cannot use this with debugging
// so I am leaving this here for now, with the eventual intent to switch to std.build.Builder
// but it is dead code
pub fn linkObjectFiles(b: *std.build.Builder, obj: *std.build.LibExeObjStep, target: anytype) !void {
    var dirs_to_search = std.BoundedArray([]const u8, 32).init(0) catch unreachable;
    const arm_brew_prefix: []const u8 = "/opt/homebrew";
    const x86_brew_prefix: []const u8 = "/usr/local";
    try dirs_to_search.append(b.env_map.get("BUN_DEPS_OUT_DIR") orelse b.env_map.get("BUN_DEPS_DIR") orelse @as([]const u8, b.pathFromRoot("src/deps")));
    if (target.getOsTag() == .macos) {
        if (target.getCpuArch().isAARCH64()) {
            try dirs_to_search.append(comptime arm_brew_prefix ++ "/opt/icu4c/lib/");
        } else {
            try dirs_to_search.append(comptime x86_brew_prefix ++ "/opt/icu4c/lib/");
        }
    }

    if (b.env_map.get("JSC_LIB")) |jsc| {
        try dirs_to_search.append(jsc);
    }

    var added = std.AutoHashMap(u64, void).init(b.allocator);

    const files_we_care_about = std.ComptimeStringMap([]const u8, .{
        .{ "libmimalloc.o", "libmimalloc.o" },
        .{ "libz.a", "libz.a" },
        .{ "libarchive.a", "libarchive.a" },
        .{ "libssl.a", "libssl.a" },
        .{ "picohttpparser.o", "picohttpparser.o" },
        .{ "libcrypto.boring.a", "libcrypto.boring.a" },
        .{ "libicuuc.a", "libicuuc.a" },
        .{ "libicudata.a", "libicudata.a" },
        .{ "libicui18n.a", "libicui18n.a" },
        .{ "libJavaScriptCore.a", "libJavaScriptCore.a" },
        .{ "libWTF.a", "libWTF.a" },
        .{ "libbmalloc.a", "libbmalloc.a" },
        .{ "libbacktrace.a", "libbacktrace.a" },
    });

    for (dirs_to_search.slice()) |deps_path| {
        var deps_dir = std.fs.cwd().openDir(deps_path, .{ .iterate = true }) catch @panic("Failed to open dependencies directory");
        var iterator = deps_dir.iterate();
        obj.addIncludeDir(deps_path);
        obj.addLibPath(deps_path);

        while (iterator.next() catch null) |entr| {
            const entry: std.fs.Dir.Entry = entr;
            if (files_we_care_about.get(entry.name)) |obj_name| {
                var has_added = try added.getOrPut(std.hash.Wyhash.hash(0, obj_name));
                if (!has_added.found_existing) {
                    var paths = [_][]const u8{ deps_path, obj_name };
                    obj.addObjectFile(try std.fs.path.join(b.allocator, &paths));
                }
            }
        }
    }
}

pub fn configureObjectStep(obj: *std.build.LibExeObjStep, target: anytype, main_pkg_path: []const u8) !void {
    obj.setMainPkgPath(main_pkg_path);
    obj.setTarget(target);

    try addInternalPackages(obj, std.heap.page_allocator, target);
    addPicoHTTP(obj, false);

    obj.strip = false;
    obj.setOutputDir(output_dir);
    obj.setBuildMode(mode);
    obj.linkLibC();
    obj.linkLibCpp();
    obj.bundle_compiler_rt = true;

    if (target.getOsTag() == .linux) {
        // obj.want_lto = tar;
        obj.link_emit_relocs = true;
        obj.link_eh_frame_hdr = true;
        obj.link_function_sections = true;
    }
}
