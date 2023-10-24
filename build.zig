const required_zig_version = "0.12.0-dev.899+027aabf49";

const std = @import("std");
const pathRel = std.fs.path.relative;
const Wyhash = @import("./src/wyhash.zig").Wyhash;
var is_debug_build = false;
fn moduleSource(comptime out: []const u8) FileSource {
    if (comptime std.fs.path.dirname(@src().file)) |base| {
        const outpath = comptime base ++ std.fs.path.sep_str ++ out;
        return FileSource.relative(outpath);
    } else {
        return FileSource.relative(out);
    }
}

fn exists(path: []const u8) bool {
    _ = std.fs.openFileAbsolute(path, .{ .mode = .read_only }) catch return false;
    return true;
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
        } else if (target.isWindows()) {
            break :brk b.createModule(.{
                .source_file = FileSource.relative("src/io/io_windows.zig"),
            });
        }

        break :brk b.createModule(.{
            .source_file = FileSource.relative("src/io/io_stub.zig"),
        });
    };

    step.addModule("async_io", io);

    step.addModule("zlib-internal", brk: {
        if (target.isWindows()) {
            break :brk b.createModule(.{ .source_file = FileSource.relative("src/deps/zlib.win32.zig") });
        }

        break :brk b.createModule(.{ .source_file = FileSource.relative("src/deps/zlib.posix.zig") });
    });

    var async_: *Module = brk: {
        if (target.isDarwin() or target.isLinux() or target.isFreeBSD()) {
            break :brk b.createModule(.{
                .source_file = FileSource.relative("src/async/posix_event_loop.zig"),
            });
        } else if (target.isWindows()) {
            break :brk b.createModule(.{
                .source_file = FileSource.relative("src/async/windows_event_loop.zig"),
            });
        }

        break :brk b.createModule(.{
            .source_file = FileSource.relative("src/async/stub_event_loop.zig"),
        });
    };
    step.addModule("async", async_);
}

const BunBuildOptions = struct {
    canary: bool = false,
    sha: [:0]const u8 = "",
    version: []const u8 = "",
    baseline: bool = false,
    bindgen: bool = false,
    sizegen: bool = false,
    base_path: [:0]const u8 = "",

    runtime_js_version: u64 = 0,
    fallback_html_version: u64 = 0,

    tinycc: bool = true,

    pub fn updateRuntime(this: *BunBuildOptions) anyerror!void {
        if (std.fs.cwd().openFile("src/runtime.out.js", .{ .mode = .read_only })) |file| {
            defer file.close();
            const runtime_hash = Wyhash.hash(
                0,
                try file.readToEndAlloc(std.heap.page_allocator, try file.getEndPos()),
            );
            this.runtime_js_version = runtime_hash;
        } else |_| {
            if (!is_debug_build) {
                @panic("Runtime file was not read successfully. Please run `make setup`");
            }
        }

        if (std.fs.cwd().openFile("src/fallback.out.js", .{ .mode = .read_only })) |file| {
            defer file.close();
            const fallback_hash = Wyhash.hash(
                0,
                try file.readToEndAlloc(std.heap.page_allocator, try file.getEndPos()),
            );
            this.fallback_html_version = fallback_hash;
        } else |_| {
            if (!is_debug_build) {
                @panic("Fallback file was not read successfully. Please run `make setup`");
            }
        }
    }

    pub fn step(this: BunBuildOptions, b: anytype) *std.build.OptionsStep {
        var opts = b.addOptions();
        opts.addOption(@TypeOf(this.canary), "is_canary", this.canary);
        opts.addOption(
            std.SemanticVersion,
            "version",
            std.SemanticVersion.parse(this.version) catch @panic(b.fmt("Invalid version: {s}", .{this.version})),
        );
        opts.addOption(@TypeOf(this.sha), "sha", this.sha);
        opts.addOption(@TypeOf(this.baseline), "baseline", this.baseline);
        opts.addOption(@TypeOf(this.bindgen), "bindgen", this.bindgen);
        opts.addOption(@TypeOf(this.sizegen), "sizegen", this.sizegen);
        opts.addOption(@TypeOf(this.base_path), "base_path", this.base_path);
        opts.addOption(@TypeOf(this.runtime_js_version), "runtime_js_version", this.runtime_js_version);
        opts.addOption(@TypeOf(this.fallback_html_version), "fallback_html_version", this.fallback_html_version);
        opts.addOption(@TypeOf(this.tinycc), "tinycc", this.tinycc);
        return opts;
    }
};

// relative to the prefix
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
    build_(b) catch |err| {
        if (@errorReturnTrace()) |trace| {
            std.debug.dumpStackTrace(trace.*);
        }

        return err;
    };
}

pub fn build_(b: *Build) !void {
    if (!std.mem.eql(u8, @import("builtin").zig_version_string, required_zig_version)) {
        const colors = std.io.getStdErr().supportsAnsiEscapeCodes();
        std.debug.print(
            "{s}WARNING:\nBun requires Zig version '{s}', but found '{s}', build may fail...\nMake sure you installed the right version as per https://bun.sh/docs/project/contributing#install-zig\n{s}You can update to the right version using 'zigup {s}'\n\n",
            .{
                if (colors) "\x1b[1;33m" else "",
                required_zig_version,
                @import("builtin").zig_version_string,
                if (colors) "\x1b[0m" else "",
                required_zig_version,
            },
        );
    }

    // Standard target options allows the person running `zig build` to choose
    // what target to build for. Here we do not override the defaults, which
    // means any target is allowed, and the default is native. Other options
    // for restricting supported target set are available.
    var target = b.standardTargetOptions(.{});
    // Standard release options allow the person running `zig build` to select
    // between Debug, ReleaseSafe, ReleaseFast, and ReleaseSmall.
    optimize = b.standardOptimizeOption(.{});

    const generated_code_directory = b.option([]const u8, "generated-code", "Set the generated code directory") orelse "./";

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

    const outfile_maybe = b.option([]const u8, "output-file", "target to install to");

    if (outfile_maybe) |outfile| {
        output_dir = try pathRel(b.allocator, b.install_prefix, std.fs.path.dirname(outfile) orelse "");
    } else {
        const output_dir_base = try std.fmt.bufPrint(&output_dir_buf, "{s}{s}", .{ bin_label, triplet });
        output_dir = try pathRel(b.allocator, b.install_prefix, output_dir_base);
    }

    is_debug_build = optimize == OptimizeMode.Debug;
    const bun_executable_name = if (outfile_maybe) |outfile| std.fs.path.basename(outfile[0 .. outfile.len - std.fs.path.extension(outfile).len]) else if (is_debug_build) "bun-debug" else "bun";
    const root_src = if (target.getOsTag() == std.Target.Os.Tag.freestanding)
        "root_wasm.zig"
    else
        "root.zig";

    const min_version: std.SemanticVersion = if (!(target.isWindows() or target.getOsTag() == .freestanding))
        target.getOsVersionMin().semver
    else
        .{ .major = 0, .minor = 0, .patch = 0 };

    const max_version: std.SemanticVersion = if (!(target.isWindows() or target.getOsTag() == .freestanding))
        target.getOsVersionMax().semver
    else
        .{ .major = 0, .minor = 0, .patch = 0 };

    var obj_step = b.step("obj", "Build bun as a .o file");
    var obj = b.addObject(.{
        .name = bun_executable_name,
        .root_source_file = FileSource.relative(root_src),
        .target = target,
        .optimize = optimize,
        .main_mod_path = .{ .cwd_relative = b.pathFromRoot(".") },
    });

    if (!exists(b.pathFromRoot(try std.fs.path.join(b.allocator, &.{
        "src",
        "js_lexer",
        "id_continue_bitset.blob",
    })))) {
        const identifier_data = b.pathFromRoot(try std.fs.path.join(b.allocator, &.{ "src", "js_lexer", "identifier_data.zig" }));
        var run_step = b.addSystemCommand(&.{
            b.zig_exe,
            "run",
            identifier_data,
        });
        run_step.has_side_effects = true;
        obj.step.dependOn(&run_step.step);
    }

    b.reference_trace = 16;

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
                        "HEAD",
                    },
                    .cwd = b.pathFromRoot("."),
                    .expand_arg0 = .expand,
                }) catch break :sha;

                git_sha = b.allocator.dupeZ(u8, std.mem.trim(u8, result.stdout, "\n \t")) catch unreachable;
            }
        }

        const is_canary =
            b.option(bool, "canary", "Treat this as a canary build") orelse
            ((b.env_map.get("BUN_CANARY") orelse "0")[0] == '1');
        break :brk .{
            .canary = is_canary,
            .version = b.option([]const u8, "version", "Value of `Bun.version`") orelse "0.0.0",
            .sha = git_sha,
            .baseline = is_baseline,
            .bindgen = false,
            .base_path = try b.allocator.dupeZ(u8, b.pathFromRoot(".")),
        };
    };

    {
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

        var install = b.addInstallFileWithDir(
            obj.getEmittedBin(),
            .{ .custom = output_dir },
            b.fmt("{s}.o", .{bun_executable_name}),
        );
        install.step.dependOn(&obj.step);
        obj_step.dependOn(&install.step);

        var actual_build_options = default_build_options;
        if (b.option(bool, "generate-sizes", "Generate sizes of things") orelse false) {
            actual_build_options.sizegen = true;
        }

        obj.addOptions("build_options", actual_build_options.step(b));

        // Generated Code
        obj.addModule("generated/ZigGeneratedClasses.zig", b.createModule(.{
            .source_file = .{ .path = b.fmt("{s}/ZigGeneratedClasses.zig", .{generated_code_directory}) },
        }));
        obj.addModule("generated/ResolvedSourceTag.zig", b.createModule(.{
            .source_file = .{ .path = b.fmt("{s}/ResolvedSourceTag.zig", .{generated_code_directory}) },
        }));

        obj.linkLibC();
        obj.dll_export_fns = true;
        obj.strip = false;
        obj.omit_frame_pointer = optimize != .Debug;
        obj.subsystem = .Console;
        // Disable stack probing on x86 so we don't need to include compiler_rt
        if (target.getCpuArch().isX86() or target.isWindows()) obj.disable_stack_probing = true;

        if (b.option(bool, "for-editor", "Do not emit bin, just check for errors") orelse false) {
            // obj.emit_bin = .no_emit;
            obj.generated_bin = null;
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
            .main_mod_path = obj.main_mod_path,
        });
        defer headers_step.dependOn(&headers_obj.step);
        try configureObjectStep(b, headers_obj, headers_step, @TypeOf(target), target);
        var headers_build_options = default_build_options;
        headers_build_options.bindgen = true;
        headers_obj.addOptions("build_options", default_build_options.step(b));
        headers_obj.linkLibCpp();
    }

    {
        const wasm_step = b.step("bun-wasm", "Build WASM");
        var wasm = b.addStaticLibrary(.{
            .name = "bun-wasm",
            .root_source_file = FileSource.relative("root_wasm.zig"),
            .target = target,
            .optimize = optimize,
            .main_mod_path = obj.main_mod_path,
        });
        defer wasm_step.dependOn(&wasm.step);
        wasm.strip = false;
        // wasm_step.link_function_sections = true;
        // wasm_step.link_emit_relocs = true;
        // wasm_step.single_threaded = true;
        try configureObjectStep(b, wasm, wasm_step, @TypeOf(target), target);
        var build_opts = default_build_options;
        wasm.addOptions("build_options", build_opts.step(b));
    }

    {
        const headers_step = b.step("httpbench-obj", "Build HTTPBench tool (object files)");
        var headers_obj = b.addObject(.{
            .name = "httpbench",
            .root_source_file = FileSource.relative("misctools/http_bench.zig"),
            .target = target,
            .optimize = optimize,
            .main_mod_path = obj.main_mod_path,
        });
        defer headers_step.dependOn(&headers_obj.step);
        try configureObjectStep(b, headers_obj, headers_step, @TypeOf(target), target);
        headers_obj.addOptions("build_options", default_build_options.step(b));
    }

    {
        const headers_step = b.step("machbench-obj", "Build Machbench tool (object files)");
        var headers_obj = b.addObject(.{
            .name = "machbench",
            .root_source_file = FileSource.relative("misctools/machbench.zig"),
            .target = target,
            .optimize = optimize,
            .main_mod_path = obj.main_mod_path,
        });
        defer headers_step.dependOn(&headers_obj.step);
        try configureObjectStep(b, headers_obj, headers_step, @TypeOf(target), target);
        headers_obj.addOptions("build_options", default_build_options.step(b));
    }

    {
        const headers_step = b.step("fetch-obj", "Build fetch (object files)");
        var headers_obj = b.addObject(.{
            .name = "fetch",
            .root_source_file = FileSource.relative("misctools/fetch.zig"),
            .target = target,
            .optimize = optimize,
            .main_mod_path = obj.main_mod_path,
        });
        defer headers_step.dependOn(&headers_obj.step);
        try configureObjectStep(b, headers_obj, headers_step, @TypeOf(target), target);
        headers_obj.addOptions("build_options", default_build_options.step(b));
    }

    {
        const headers_step = b.step("string-bench", "Build string bench");
        var headers_obj = b.addExecutable(.{
            .name = "string-bench",
            .root_source_file = FileSource.relative("src/bench/string-handling.zig"),
            .target = target,
            .optimize = optimize,
            .main_mod_path = obj.main_mod_path,
        });
        defer headers_step.dependOn(&headers_obj.step);
        try configureObjectStep(b, headers_obj, headers_step, @TypeOf(target), target);
        headers_obj.addOptions("build_options", default_build_options.step(b));
    }

    {
        const headers_step = b.step("sha-bench-obj", "Build sha bench");
        var headers_obj = b.addObject(.{
            .name = "sha",
            .root_source_file = FileSource.relative("src/sha.zig"),
            .target = target,
            .optimize = optimize,
            .main_mod_path = obj.main_mod_path,
        });
        defer headers_step.dependOn(&headers_obj.step);
        try configureObjectStep(b, headers_obj, headers_step, @TypeOf(target), target);
        headers_obj.addOptions("build_options", default_build_options.step(b));
    }

    {
        const headers_step = b.step("vlq-bench", "Build vlq bench");
        var headers_obj: *CompileStep = b.addExecutable(.{
            .name = "vlq-bench",
            .root_source_file = FileSource.relative("src/sourcemap/vlq_bench.zig"),
            .target = target,
            .optimize = optimize,
            .main_mod_path = obj.main_mod_path,
        });
        defer headers_step.dependOn(&headers_obj.step);
        try configureObjectStep(b, headers_obj, headers_step, @TypeOf(target), target);
        headers_obj.addOptions("build_options", default_build_options.step(b));
    }

    {
        const headers_step = b.step("tgz-obj", "Build tgz (object files)");
        var headers_obj: *CompileStep = b.addObject(.{
            .name = "tgz",
            .root_source_file = FileSource.relative("misctools/tgz.zig"),
            .target = target,
            .optimize = optimize,
            .main_mod_path = obj.main_mod_path,
        });
        defer headers_step.dependOn(&headers_obj.step);
        try configureObjectStep(b, headers_obj, headers_step, @TypeOf(target), target);
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
            .main_mod_path = obj.main_mod_path,
        });
        headers_obj.filter = test_filter;
        if (test_bin_) |test_bin| {
            headers_obj.name = std.fs.path.basename(test_bin);
            if (std.fs.path.dirname(test_bin)) |dir| {
                var install = b.addInstallFileWithDir(
                    headers_obj.getEmittedBin(),
                    .{ .custom = try std.fs.path.relative(b.allocator, output_dir, dir) },
                    headers_obj.name,
                );
                install.step.dependOn(&headers_obj.step);
                headers_step.dependOn(&install.step);
            }
        }

        try configureObjectStep(b, headers_obj, headers_step, @TypeOf(target), target);

        headers_step.dependOn(&headers_obj.step);
        headers_obj.addOptions("build_options", default_build_options.step(b));
    }

    b.default_step.dependOn(obj_step);
}

pub var original_make_fn: ?*const fn (step: *std.build.Step) anyerror!void = null;

pub fn configureObjectStep(b: *std.build.Builder, obj: *CompileStep, obj_step: *std.build.Step, comptime Target: type, target: Target) !void {
    // obj.setTarget(target);
    try addInternalPackages(b, obj, std.heap.page_allocator, b.zig_exe, target);

    obj.strip = false;

    // obj.setBuildMode(optimize);
    obj.bundle_compiler_rt = false;
    if (obj.emit_directory == null) {
        var install = b.addInstallFileWithDir(
            obj.getEmittedBin(),
            .{ .custom = output_dir },
            b.fmt("{s}.o", .{obj.name}),
        );

        install.step.dependOn(&obj.step);
        obj_step.dependOn(&install.step);
    }
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
