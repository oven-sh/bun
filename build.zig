const std = @import("std");
const Wyhash = @import("./src/wyhash.zig").Wyhash;

fn moduleSource(comptime out: []const u8) FileSource {
    if (comptime std.fs.path.dirname(@src().file)) |base| {
        const outpath = comptime base ++ std.fs.path.sep_str ++ out;
        return FileSource.relative(outpath);
    } else {
        return FileSource.relative(out);
    }
}
pub fn addPicoHTTP(step: *CompileStep, comptime with_obj: bool) void {
    step.addIncludePath("src/deps");

    if (with_obj) {
        step.addObjectFile("src/deps/picohttpparser.o");
    }

    step.addIncludePath("src/deps");

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

fn addInternalPackages(b: *Build, step: *CompileStep, _: std.mem.Allocator, _: []const u8, target: anytype) !void {
    var io: *Module = brk: {
        if (target.isDarwin()) {
            break :brk b.createModule(.{
                .source_file = FileSource.relative("src/io/io_darwin.zig"),
            });
        } else if (target.isLinux()) {
            break :brk b.createModule(.{
                .source_file = FileSource.relative("src/io/io_linux.zig"),
            });
        }

        break :brk b.createModule(.{
            .source_file = FileSource.relative("src/io/io_stub.zig"),
        });
    };

    step.addModule("async_io", io);
}

const BunBuildOptions = struct {
    canary: bool = false,
    sha: [:0]const u8 = "",
    baseline: bool = false,
    bindgen: bool = false,
    sizegen: bool = false,
    base_path: [:0]const u8 = "",

    runtime_js_version: u64 = 0,
    fallback_html_version: u64 = 0,

    pub fn updateRuntime(this: *BunBuildOptions) anyerror!void {
        var runtime_out_file = try std.fs.cwd().openFile("src/runtime.out.js", .{ .mode = .read_only });
        const runtime_hash = Wyhash.hash(
            0,
            try runtime_out_file.readToEndAlloc(std.heap.page_allocator, try runtime_out_file.getEndPos()),
        );
        this.runtime_js_version = runtime_hash;
        var fallback_out_file = try std.fs.cwd().openFile("src/fallback.out.js", .{ .mode = .read_only });
        const fallback_hash = Wyhash.hash(
            0,
            try fallback_out_file.readToEndAlloc(std.heap.page_allocator, try fallback_out_file.getEndPos()),
        );
        this.fallback_html_version = fallback_hash;
    }

    pub fn step(this: BunBuildOptions, b: anytype) *std.build.OptionsStep {
        var opts = b.addOptions();
        opts.addOption(@TypeOf(this.canary), "is_canary", this.canary);
        opts.addOption(@TypeOf(this.sha), "sha", this.sha);
        opts.addOption(@TypeOf(this.baseline), "baseline", this.baseline);
        opts.addOption(@TypeOf(this.bindgen), "bindgen", this.bindgen);
        opts.addOption(@TypeOf(this.sizegen), "sizegen", this.sizegen);
        opts.addOption(@TypeOf(this.base_path), "base_path", this.base_path);
        opts.addOption(@TypeOf(this.runtime_js_version), "runtime_js_version", this.runtime_js_version);
        opts.addOption(@TypeOf(this.fallback_html_version), "fallback_html_version", this.fallback_html_version);
        return opts;
    }
};

var output_dir: []const u8 = "";
fn panicIfNotFound(comptime filepath: []const u8) []const u8 {
    var file = std.fs.cwd().openFile(filepath, .{ .optimize = .read_only }) catch |err| {
        std.debug.panic("error: {s} opening {s}. Please ensure you've downloaded git submodules, and ran `make vendor`, `make jsc`.", .{ filepath, @errorName(err) });
    };
    file.close();

    return filepath;
}

const fmt = struct {
    pub usingnamespace @import("std").fmt;

    pub fn hexInt(value: anytype) @TypeOf(std.fmt.fmtSliceHexLower("")) {
        return std.fmt.fmtSliceHexLower(std.mem.asBytes(&value));
    }

    pub fn hexIntUp(value: anytype) @TypeOf(std.fmt.fmtSliceHexUpper("")) {
        return std.fmt.fmtSliceHexUpper(std.mem.asBytes(&value));
    }
};

var x64 = "x64";
var optimize: std.builtin.OptimizeMode = undefined;

const Build = std.Build;
const CrossTarget = std.zig.CrossTarget;
const OptimizeMode = std.builtin.OptimizeMode;
const CompileStep = std.build.CompileStep;
const FileSource = std.build.FileSource;
const Module = std.build.Module;
const fs = std.fs;

pub fn build(b: *Build) !void {
    // Standard target options allows the person running `zig build` to choose
    // what target to build for. Here we do not override the defaults, which
    // means any target is allowed, and the default is native. Other options
    // for restricting supported target set are available.
    var target = b.standardTargetOptions(.{});
    // Standard release options allow the person running `zig build` to select
    // between Debug, ReleaseSafe, ReleaseFast, and ReleaseSmall.
    optimize = b.standardOptimizeOption(.{});

    var output_dir_buf = std.mem.zeroes([4096]u8);
    var bin_label = if (optimize == std.builtin.OptimizeMode.Debug) "packages/debug-bun-" else "packages/bun-";

    var triplet_buf: [64]u8 = undefined;
    var os_tagname = @tagName(target.getOs().tag);

    const arch: std.Target.Cpu.Arch = target.getCpuArch();

    if (std.mem.eql(u8, os_tagname, "macos")) {
        os_tagname = "darwin";
        target.os_version_min = std.zig.CrossTarget.OsVersion{ .semver = .{ .major = 11, .minor = 0, .patch = 0 } };
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

    if (b.option([]const u8, "output-dir", "target to install to") orelse std.os.getenv("OUTPUT_DIR")) |output_dir_| {
        output_dir = b.pathFromRoot(output_dir_);
    } else {
        const output_dir_base = try std.fmt.bufPrint(&output_dir_buf, "{s}{s}", .{ bin_label, triplet });
        output_dir = b.pathFromRoot(output_dir_base);
    }

    std.fs.cwd().makePath(output_dir) catch {};
    const bun_executable_name = if (optimize == std.builtin.OptimizeMode.Debug) "bun-debug" else "bun";
    const root_src = if (target.getOsTag() == std.Target.Os.Tag.freestanding)
        "src/main_wasm.zig"
    else
        "root.zig";

    const min_version: std.builtin.Version = if (target.getOsTag() != .freestanding)
        target.getOsVersionMin().semver
    else
        .{ .major = 0, .minor = 0, .patch = 0 };

    const max_version: std.builtin.Version = if (target.getOsTag() != .freestanding)
        target.getOsVersionMax().semver
    else
        .{ .major = 0, .minor = 0, .patch = 0 };

    var obj_step = b.step("obj", "Build bun as a .o file");
    var obj = b.addObject(.{
        .name = bun_executable_name,
        .root_source_file = FileSource.relative(root_src),
        .target = target,
        .optimize = optimize,
    });

    var default_build_options: BunBuildOptions = brk: {
        const is_baseline = arch.isX86() and (target.cpu_model == .baseline or
            !std.Target.x86.featureSetHas(target.getCpuFeatures(), .avx2));

        var git_sha: [:0]const u8 = "";
        if (b.env_map.get("GITHUB_SHA") orelse b.env_map.get("GIT_SHA")) |sha| {
            git_sha = b.allocator.dupeZ(u8, sha) catch unreachable;
        } else {
            sha: {
                const result = std.ChildProcess.exec(.{
                    .allocator = b.allocator,
                    .argv = &.{
                        "git",
                        "rev-parse",
                        "--short",
                        "HEAD",
                    },
                    .cwd = b.pathFromRoot("."),
                    .expand_arg0 = .expand,
                }) catch break :sha;

                git_sha = b.allocator.dupeZ(u8, std.mem.trim(u8, result.stdout, "\n \t")) catch unreachable;
            }
        }

        const is_canary = (std.os.getenvZ("BUN_CANARY") orelse "0")[0] == '1';
        break :brk .{
            .canary = is_canary,
            .sha = git_sha,
            .baseline = is_baseline,
            .bindgen = false,
            .base_path = try b.allocator.dupeZ(u8, b.pathFromRoot(".")),
        };
    };

    {
        addPicoHTTP(obj, false);
        obj.setMainPkgPath(b.pathFromRoot("."));

        try addInternalPackages(
            b,
            obj,
            b.allocator,
            b.zig_exe,
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

        try default_build_options.updateRuntime();

        // we have to dump to stderr because stdout is read by zls
        std.io.getStdErr().writer().print("Build {s} v{} - v{} ({s})\n", .{
            triplet,
            min_version,
            max_version,
            obj.target.getCpuModel().name,
        }) catch unreachable;
        std.io.getStdErr().writer().print("Output: {s}/{s}\n\n", .{ output_dir, bun_executable_name }) catch unreachable;

        defer obj_step.dependOn(&obj.step);
        obj.emit_bin = .{
            .emit_to = b.fmt("{s}/{s}.o", .{ output_dir, bun_executable_name }),
        };
        var actual_build_options = default_build_options;
        if (b.option(bool, "generate-sizes", "Generate sizes of things") orelse false) {
            actual_build_options.sizegen = true;
        }

        obj.addOptions("build_options", actual_build_options.step(b));

        obj.linkLibC();

        obj.strip = false;
        obj.bundle_compiler_rt = false;
        obj.omit_frame_pointer = optimize != .Debug;
        // Disable stack probing on x86 so we don't need to include compiler_rt
        if (target.getCpuArch().isX86()) obj.disable_stack_probing = true;

        if (b.option(bool, "for-editor", "Do not emit bin, just check for errors") orelse false) {
            obj.emit_bin = .no_emit;
        }

        if (target.getOsTag() == .linux) {
            // obj.want_lto = tar;
            obj.link_emit_relocs = true;
            obj.link_eh_frame_hdr = true;
            obj.link_function_sections = true;
        }
    }

    {
        const headers_step = b.step("headers-obj", "Build JavaScriptCore headers");
        var headers_obj = b.addObject(.{
            .name = "headers",
            .root_source_file = FileSource.relative("src/bindgen.zig"),
            .target = target,
            .optimize = optimize,
        });
        defer headers_step.dependOn(&headers_obj.step);
        try configureObjectStep(b, headers_obj, @TypeOf(target), target, obj.main_pkg_path.?);
        var headers_build_options = default_build_options;
        headers_build_options.bindgen = true;
        headers_obj.addOptions("build_options", default_build_options.step(b));
        headers_obj.linkLibCpp();
    }

    {
        const wasm = b.step("bun-wasm", "Build WASM");
        var wasm_step = b.addStaticLibrary(.{
            .name = "bun-wasm",
            .root_source_file = FileSource.relative("src/main_wasm.zig"),
            .target = target,
            .optimize = optimize,
        });
        defer wasm.dependOn(&wasm_step.step);
        wasm_step.strip = false;
        // wasm_step.link_function_sections = true;
        // wasm_step.link_emit_relocs = true;
        // wasm_step.single_threaded = true;
        try configureObjectStep(b, wasm_step, @TypeOf(target), target, obj.main_pkg_path.?);
    }

    {
        const headers_step = b.step("httpbench-obj", "Build HTTPBench tool (object files)");
        var headers_obj = b.addObject(.{
            .name = "httpbench",
            .root_source_file = FileSource.relative("misctools/http_bench.zig"),
            .target = target,
            .optimize = optimize,
        });
        defer headers_step.dependOn(&headers_obj.step);
        try configureObjectStep(b, headers_obj, @TypeOf(target), target, obj.main_pkg_path.?);
        headers_obj.addOptions("build_options", default_build_options.step(b));
    }

    {
        const headers_step = b.step("machbench-obj", "Build Machbench tool (object files)");
        var headers_obj = b.addObject(.{
            .name = "machbench",
            .root_source_file = FileSource.relative("misctools/machbench.zig"),
            .target = target,
            .optimize = optimize,
        });
        defer headers_step.dependOn(&headers_obj.step);
        try configureObjectStep(b, headers_obj, @TypeOf(target), target, obj.main_pkg_path.?);
        headers_obj.addOptions("build_options", default_build_options.step(b));
    }

    {
        const headers_step = b.step("fetch-obj", "Build fetch (object files)");
        var headers_obj = b.addObject(.{
            .name = "fetch",
            .root_source_file = FileSource.relative("misctools/fetch.zig"),
            .target = target,
            .optimize = optimize,
        });
        defer headers_step.dependOn(&headers_obj.step);
        try configureObjectStep(b, headers_obj, @TypeOf(target), target, obj.main_pkg_path.?);
        headers_obj.addOptions("build_options", default_build_options.step(b));
    }

    {
        const headers_step = b.step("string-bench", "Build string bench");
        var headers_obj = b.addExecutable(.{
            .name = "string-bench",
            .root_source_file = FileSource.relative("src/bench/string-handling.zig"),
            .target = target,
            .optimize = optimize,
        });
        defer headers_step.dependOn(&headers_obj.step);
        try configureObjectStep(b, headers_obj, @TypeOf(target), target, obj.main_pkg_path.?);
        headers_obj.addOptions("build_options", default_build_options.step(b));
    }

    {
        const headers_step = b.step("sha-bench-obj", "Build sha bench");
        var headers_obj = b.addObject(.{
            .name = "sha",
            .root_source_file = FileSource.relative("src/sha.zig"),
            .target = target,
            .optimize = optimize,
        });
        defer headers_step.dependOn(&headers_obj.step);
        try configureObjectStep(b, headers_obj, @TypeOf(target), target, obj.main_pkg_path.?);
        headers_obj.addOptions("build_options", default_build_options.step(b));
    }

    {
        const headers_step = b.step("vlq-bench", "Build vlq bench");
        var headers_obj: *CompileStep = b.addExecutable(.{
            .name = "vlq-bench",
            .root_source_file = FileSource.relative("src/sourcemap/vlq_bench.zig"),
            .target = target,
            .optimize = optimize,
        });
        defer headers_step.dependOn(&headers_obj.step);
        try configureObjectStep(b, headers_obj, @TypeOf(target), target, obj.main_pkg_path.?);
        headers_obj.addOptions("build_options", default_build_options.step(b));
    }

    {
        const headers_step = b.step("tgz-obj", "Build tgz (object files)");
        var headers_obj: *CompileStep = b.addObject(.{
            .name = "tgz",
            .root_source_file = FileSource.relative("misctools/tgz.zig"),
            .target = target,
            .optimize = optimize,
        });
        defer headers_step.dependOn(&headers_obj.step);
        try configureObjectStep(b, headers_obj, @TypeOf(target), target, obj.main_pkg_path.?);
        headers_obj.addOptions("build_options", default_build_options.step(b));
    }

    {
        const headers_step = b.step("test", "Build test");

        var test_file = b.option([]const u8, "test-file", "Input file for test");
        var test_bin_ = b.option([]const u8, "test-bin", "Emit bin to");
        var test_filter = b.option([]const u8, "test-filter", "Filter for test");

        var headers_obj: *CompileStep = b.addTest(.{
            .root_source_file = FileSource.relative(test_file orelse "src/main.zig"),
            .target = target,
        });
        headers_obj.filter = test_filter;
        if (test_bin_) |test_bin| {
            headers_obj.name = std.fs.path.basename(test_bin);
            if (std.fs.path.dirname(test_bin)) |dir| headers_obj.emit_bin = .{
                .emit_to = b.fmt("{s}/{s}", .{ dir, headers_obj.name }),
            };
        }

        try configureObjectStep(b, headers_obj, @TypeOf(target), target, obj.main_pkg_path.?);

        headers_step.dependOn(&headers_obj.step);
        headers_obj.addOptions("build_options", default_build_options.step(b));
    }

    b.default_step.dependOn(obj_step);
}

pub var original_make_fn: ?*const fn (step: *std.build.Step) anyerror!void = null;

pub fn configureObjectStep(b: *std.build.Builder, obj: *CompileStep, comptime Target: type, target: Target, main_pkg_path: []const u8) !void {
    obj.setMainPkgPath(main_pkg_path);

    // obj.setTarget(target);
    try addInternalPackages(b, obj, std.heap.page_allocator, b.zig_exe, target);
    if (target.getOsTag() != .freestanding)
        addPicoHTTP(obj, false);

    obj.strip = false;

    // obj.setBuildMode(optimize);
    obj.bundle_compiler_rt = false;
    if (obj.emit_bin == .default)
        obj.emit_bin = .{
            .emit_to = b.fmt("{s}/{s}.o", .{ output_dir, obj.name }),
        };

    if (target.getOsTag() != .freestanding) obj.linkLibC();
    if (target.getOsTag() != .freestanding) obj.bundle_compiler_rt = false;

    // Disable stack probing on x86 so we don't need to include compiler_rt
    // Needs to be disabled here too so headers object will build without the `__zig_probe_stack` symbol
    if (target.getCpuArch().isX86()) obj.disable_stack_probing = true;

    if (target.getOsTag() == .linux) {
        // obj.want_lto = tar;
        obj.link_emit_relocs = true;
        obj.link_eh_frame_hdr = true;
        obj.link_function_sections = true;
    }
}
