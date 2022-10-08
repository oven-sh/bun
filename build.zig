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
        .source = pkgPath("src/boringssl.zig"),
    };

    var datetime: std.build.Pkg = .{
        .name = "datetime",
        .source = pkgPath("src/deps/zig-datetime/src/datetime.zig"),
    };

    var thread_pool: std.build.Pkg = .{
        .name = "thread_pool",
        .source = pkgPath("src/thread_pool.zig"),
    };

    var crash_reporter: std.build.Pkg = .{
        .name = "crash_reporter",
        .source = pkgPath("src/deps/backtrace.zig"),
    };

    var picohttp: std.build.Pkg = .{
        .name = "picohttp",
        .source = pkgPath("src/deps/picohttp.zig"),
    };

    var io_darwin: std.build.Pkg = .{
        .name = "io",
        .source = pkgPath("src/io/io_darwin.zig"),
    };
    var io_linux: std.build.Pkg = .{
        .name = "io",
        .source = pkgPath("src/io/io_linux.zig"),
    };
    var io_stub: std.build.Pkg = .{
        .name = "io",
        .source = pkgPath("src/io/io_stub.zig"),
    };

    var lol_html: std.build.Pkg = .{
        .name = "lolhtml",
        .source = pkgPath("src/deps/lol-html.zig"),
    };

    var io = if (target.isDarwin())
        io_darwin
    else if (target.isLinux())
        io_linux
    else
        io_stub;

    var strings: std.build.Pkg = .{
        .name = "strings",
        .source = pkgPath("src/string_immutable.zig"),
    };

    var clap: std.build.Pkg = .{
        .name = "clap",
        .source = pkgPath("src/deps/zig-clap/clap.zig"),
    };

    var http: std.build.Pkg = .{
        .name = "http",
        .source = pkgPath("src/http_client_async.zig"),
    };

    var javascript_core_real: std.build.Pkg = .{
        .name = "javascript_core",
        .source = pkgPath("src/jsc.zig"),
    };

    var javascript_core_stub: std.build.Pkg = .{
        .name = "javascript_core",
        .source = pkgPath("src/jsc_stub.zig"),
    };

    var uws: std.build.Pkg = .{
        .name = "uws",
        .source = pkgPath("src/deps/uws.zig"),
    };

    var javascript_core = if (target.getOsTag() == .freestanding)
        javascript_core_stub
    else
        javascript_core_real;

    var analytics: std.build.Pkg = .{
        .name = "analytics",
        .source = pkgPath("src/analytics.zig"),
    };

    io.dependencies = &.{analytics};
    uws.dependencies = &.{boringssl};
    javascript_core.dependencies = &.{ http, strings, picohttp, io, uws };
    http.dependencies = &.{
        strings,
        picohttp,
        io,
        boringssl,
        thread_pool,
        uws,
    };
    thread_pool.dependencies = &.{ io, http };
    http.dependencies = &.{
        strings,
        picohttp,
        io,
        boringssl,
        thread_pool,
        uws,
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
    step.addPackage(datetime);
    step.addPackage(lol_html);
    step.addPackage(uws);
}

const BunBuildOptions = struct {
    canary: bool = false,
    sha: [:0]const u8 = "",
    baseline: bool = false,
    bindgen: bool = false,
    sizegen: bool = false,

    pub fn step(this: BunBuildOptions, b: anytype) *std.build.OptionsStep {
        var opts = b.addOptions();
        opts.addOption(@TypeOf(this.canary), "is_canary", this.canary);
        opts.addOption(@TypeOf(this.sha), "sha", this.sha);
        opts.addOption(@TypeOf(this.baseline), "baseline", this.baseline);
        opts.addOption(@TypeOf(this.bindgen), "bindgen", this.bindgen);
        opts.addOption(@TypeOf(this.sizegen), "sizegen", this.sizegen);
        return opts;
    }
};

var output_dir: []const u8 = "";
fn panicIfNotFound(comptime filepath: []const u8) []const u8 {
    var file = std.fs.cwd().openFile(filepath, .{ .mode = .read_only }) catch |err| {
        std.debug.panic("error: {s} opening {s}. Please ensure you've downloaded git submodules, and ran `make vendor`, `make jsc`.", .{ filepath, @errorName(err) });
    };
    file.close();

    return filepath;
}

fn updateRuntime() anyerror!void {
    var runtime_out_file = try std.fs.cwd().openFile("src/runtime.out.js", .{ .mode = .read_only });
    const runtime_hash = std.hash.Wyhash.hash(
        0,
        try runtime_out_file.readToEndAlloc(std.heap.page_allocator, try runtime_out_file.getEndPos()),
    );
    const runtime_version_file = std.fs.cwd().createFile("src/runtime.version", .{ .truncate = true }) catch std.debug.panic("Failed to create src/runtime.version", .{});
    defer runtime_version_file.close();
    runtime_version_file.writer().print("{x}", .{runtime_hash}) catch unreachable;
    var fallback_out_file = try std.fs.cwd().openFile("src/fallback.out.js", .{ .mode = .read_only });
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

const Builder = std.build.Builder;
const CrossTarget = std.zig.CrossTarget;
const Mode = std.builtin.Mode;
const fs = std.fs;

pub fn build(b: *std.build.Builder) !void {
    // Standard target options allows the person running `zig build` to choose
    // what target to build for. Here we do not override the defaults, which
    // means any target is allowed, and the default is native. Other options
    // for restricting supported target set are available.
    var target = b.standardTargetOptions(.{});
    // Standard release options allow the person running `zig build` to select
    // between Debug, ReleaseSafe, ReleaseFast, and ReleaseSmall.
    mode = b.standardReleaseOptions();

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

    if (std.os.getenv("OUTPUT_DIR")) |output_dir_| {
        output_dir = output_dir_;
    } else {
        const output_dir_base = try std.fmt.bufPrint(&output_dir_buf, "{s}{s}", .{ bin_label, triplet });
        output_dir = b.pathFromRoot(output_dir_base);
    }

    std.fs.cwd().makePath(output_dir) catch {};
    const bun_executable_name = if (mode == std.builtin.Mode.Debug) "bun-debug" else "bun";
    exe = b.addExecutable(bun_executable_name, if (target.getOsTag() == std.Target.Os.Tag.freestanding)
        "src/main_wasm.zig"
    else
        "src/main.zig");
    // exe.setLibCFile("libc.txt");
    exe.linkLibC();
    // exe.linkLibCpp();

    exe.setOutputDir(output_dir);
    updateRuntime() catch {};

    exe.setTarget(target);
    exe.setBuildMode(mode);
    b.install_path = output_dir;

    const min_version: std.builtin.Version = if (target.getOsTag() != .freestanding)
        target.getOsVersionMin().semver
    else .{ .major = 0, .minor = 0, .patch = 0 };

    const max_version: std.builtin.Version = if (target.getOsTag() != .freestanding)
        target.getOsVersionMax().semver
    else .{ .major = 0, .minor = 0, .patch = 0 };

    // exe.want_lto = true;
    defer b.default_step.dependOn(&b.addLog("Output: {s}/{s}\n", .{ output_dir, bun_executable_name }).step);
    defer b.default_step.dependOn(&b.addLog(
        "Build {s} v{} - v{}\n",
        .{
            triplet,
            min_version,
            max_version,
        },
    ).step);

    var obj_step = b.step("obj", "Build bun as a .o file");
    var obj = b.addObject(bun_executable_name, exe.root_src.?.path);

    var default_build_options: BunBuildOptions = brk: {
        const is_baseline = arch.isX86() and (target.cpu_model == .baseline or
            !std.Target.x86.featureSetHas(target.getCpuFeatures(), .avx2));

        var git_sha: [:0]const u8 = "";
        if (std.os.getenvZ("GITHUB_SHA") orelse std.os.getenvZ("GIT_SHA")) |sha| {
            git_sha = std.heap.page_allocator.dupeZ(u8, sha) catch unreachable;
        } else {
            sha: {
                const result = std.ChildProcess.exec(.{
                    .allocator = std.heap.page_allocator,
                    .argv = &.{
                        "git",
                        "rev-parse",
                        "--short",
                        "HEAD",
                    },
                    .cwd = b.pathFromRoot("."),
                    .expand_arg0 = .expand,
                }) catch {
                    std.debug.print("Warning: failed to get git HEAD", .{});
                    break :sha;
                };

                git_sha = std.heap.page_allocator.dupeZ(u8, std.mem.trim(u8, result.stdout, "\n \t")) catch unreachable;
            }
        }

        const is_canary = (std.os.getenvZ("BUN_CANARY") orelse "0")[0] == '1';
        break :brk .{
            .canary = is_canary,
            .sha = git_sha,
            .baseline = is_baseline,
            .bindgen = false,
        };
    };

    {
        obj.setTarget(target);
        addPicoHTTP(obj, false);
        obj.setMainPkgPath(b.pathFromRoot("."));

        try addInternalPackages(
            obj,
            b.allocator,
            target,
        );

        if (default_build_options.baseline) {
            obj.target.cpu_model = .{ .explicit = &std.Target.x86.cpu.x86_64_v2 };
        } else if (arch.isX86()) {
            obj.target.cpu_model = .{ .explicit = &std.Target.x86.cpu.haswell };
        } else if (arch.isAARCH64() and target.isDarwin()) {
            obj.target.cpu_model = .{ .explicit = &std.Target.aarch64.cpu.apple_m1 };
        } else if (arch.isAARCH64() and target.isLinux()) {
            obj.target.cpu_model = .{ .explicit = &std.Target.aarch64.cpu.generic };
        }

        {
            obj_step.dependOn(&b.addLog(
                "Build {s} v{} - v{} ({s})\n",
                .{
                    triplet,
                    min_version,
                    max_version,
                    obj.target.getCpuModel().name,
                },
            ).step);
        }

        obj_step.dependOn(&obj.step);

        obj.setOutputDir(output_dir);
        obj.setBuildMode(mode);

        var actual_build_options = default_build_options;
        if (b.option(bool, "generate-sizes", "Generate sizes of things") orelse false) {
            actual_build_options.sizegen = true;
            obj.setOutputDir(b.pathFromRoot("misctools/sizegen"));
        }

        obj.addOptions("build_options", actual_build_options.step(b));

        obj.linkLibC();

        obj.strip = false;
        obj.bundle_compiler_rt = true;
        obj.omit_frame_pointer = mode != .Debug;

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
        try configureObjectStep(b, headers_obj, target, obj.main_pkg_path.?);
        var headers_build_options = default_build_options;
        headers_build_options.bindgen = true;
        headers_obj.addOptions("build_options", default_build_options.step(b));
        headers_obj.linkLibCpp();
    }

    {
        const wasm = b.step("bun-wasm", "Build WASM");
        var wasm_step: *std.build.LibExeObjStep = b.addStaticLibrary("bun-wasm", "src/main_wasm.zig");
        defer wasm.dependOn(&wasm_step.step);
        wasm_step.strip = false;
        // wasm_step.link_function_sections = true;
        // wasm_step.link_emit_relocs = true;
        // wasm_step.single_threaded = true;
        try configureObjectStep(b, wasm_step, target, obj.main_pkg_path.?);
    }

    {
        const headers_step = b.step("httpbench-obj", "Build HTTPBench tool (object files)");
        var headers_obj: *std.build.LibExeObjStep = b.addObject("httpbench", "misctools/http_bench.zig");
        defer headers_step.dependOn(&headers_obj.step);
        try configureObjectStep(b, headers_obj, target, obj.main_pkg_path.?);
        headers_obj.addOptions("build_options", default_build_options.step(b));
    }

    {
        const headers_step = b.step("machbench-obj", "Build Machbench tool (object files)");
        var headers_obj: *std.build.LibExeObjStep = b.addObject("machbench", "misctools/machbench.zig");
        defer headers_step.dependOn(&headers_obj.step);
        try configureObjectStep(b, headers_obj, target, obj.main_pkg_path.?);
        headers_obj.addOptions("build_options", default_build_options.step(b));
    }

    {
        const headers_step = b.step("fetch-obj", "Build fetch (object files)");
        var headers_obj: *std.build.LibExeObjStep = b.addObject("fetch", "misctools/fetch.zig");
        defer headers_step.dependOn(&headers_obj.step);
        try configureObjectStep(b, headers_obj, target, obj.main_pkg_path.?);
        headers_obj.addOptions("build_options", default_build_options.step(b));
    }

    {
        const headers_step = b.step("string-bench", "Build string bench");
        var headers_obj: *std.build.LibExeObjStep = b.addExecutable("string-bench", "src/bench/string-handling.zig");
        defer headers_step.dependOn(&headers_obj.step);
        try configureObjectStep(b, headers_obj, target, obj.main_pkg_path.?);
        headers_obj.addOptions("build_options", default_build_options.step(b));
    }

    {
        const headers_step = b.step("sha-bench-obj", "Build sha bench");
        var headers_obj: *std.build.LibExeObjStep = b.addObject("sha", "src/sha.zig");
        defer headers_step.dependOn(&headers_obj.step);
        try configureObjectStep(b, headers_obj, target, obj.main_pkg_path.?);
        headers_obj.addOptions("build_options", default_build_options.step(b));
    }

    {
        const headers_step = b.step("vlq-bench", "Build vlq bench");
        var headers_obj: *std.build.LibExeObjStep = b.addExecutable("vlq-bench", "src/sourcemap/vlq_bench.zig");
        defer headers_step.dependOn(&headers_obj.step);
        try configureObjectStep(b, headers_obj, target, obj.main_pkg_path.?);
        headers_obj.addOptions("build_options", default_build_options.step(b));
    }

    {
        const headers_step = b.step("tgz-obj", "Build tgz (object files)");
        var headers_obj: *std.build.LibExeObjStep = b.addObject("tgz", "misctools/tgz.zig");
        defer headers_step.dependOn(&headers_obj.step);
        try configureObjectStep(b, headers_obj, target, obj.main_pkg_path.?);
        headers_obj.addOptions("build_options", default_build_options.step(b));
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

        try configureObjectStep(b, headers_obj, target, obj.main_pkg_path.?);
        try linkObjectFiles(b, headers_obj, target);

        {
            var before = b.addLog("\x1b[" ++ color_map.get("magenta").? ++ "\x1b[" ++ color_map.get("b").? ++ "[{s} tests]" ++ "\x1b[" ++ color_map.get("d").? ++ " ----\n\n" ++ "\x1b[0m", .{"bun"});
            var after = b.addLog("\x1b[" ++ color_map.get("d").? ++ "–––---\n\n" ++ "\x1b[0m", .{});
            headers_step.dependOn(&before.step);
            headers_step.dependOn(&headers_obj.step);
            headers_step.dependOn(&after.step);
            headers_obj.addOptions("build_options", default_build_options.step(b));
        }

        for (headers_obj.packages.items) |pkg_| {
            const pkg: std.build.Pkg = pkg_;
            if (std.mem.eql(u8, pkg.name, "clap")) continue;
            var test_ = b.addTestSource(pkg.source);

            test_.setMainPkgPath(obj.main_pkg_path.?);
            test_.setTarget(target);
            try configureObjectStep(b, test_, target, obj.main_pkg_path.?);
            try linkObjectFiles(b, test_, target);
            test_.addOptions("build_options", default_build_options.step(b));

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
}

pub var original_make_fn: ?fn (step: *std.build.Step) anyerror!void = null;

// Due to limitations in std.build.Builder
// we cannot use this with debugging
// so I am leaving this here for now, with the eventual intent to switch to std.build.Builder
// but it is dead code
pub fn linkObjectFiles(b: *std.build.Builder, obj: *std.build.LibExeObjStep, target: anytype) !void {
    if (target.getOsTag() == .freestanding)
        return;
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
        .{ "liblolhtml.a", "liblolhtml.a" },
        .{ "uSockets.a", "uSockets.a" },
    });

    for (dirs_to_search.slice()) |deps_path| {
        var deps_dir = std.fs.cwd().openDir(deps_path, .{ .iterate = true }) catch continue;
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

pub fn configureObjectStep(_: *std.build.Builder, obj: *std.build.LibExeObjStep, target: anytype, main_pkg_path: []const u8) !void {
    obj.setMainPkgPath(main_pkg_path);

    obj.setTarget(target);
    try addInternalPackages(obj, std.heap.page_allocator, target);
    if (target.getOsTag() != .freestanding)
        addPicoHTTP(obj, false);

    obj.strip = false;
    obj.setOutputDir(output_dir);
    obj.setBuildMode(mode);
    if (target.getOsTag() != .freestanding) obj.linkLibC();
    if (target.getOsTag() != .freestanding) obj.bundle_compiler_rt = true;

    if (target.getOsTag() == .linux) {
        // obj.want_lto = tar;
        obj.link_emit_relocs = true;
        obj.link_eh_frame_hdr = true;
        obj.link_function_sections = true;
    }
}
