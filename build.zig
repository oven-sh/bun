const std = @import("std");
const pathRel = std.fs.path.relative;
const builtin = @import("builtin");
const Wyhash11 = @import("./src/wyhash.zig").Wyhash11;

const zig_version = builtin.zig_version;

/// Do not rename this constant. It is scanned by some scripts to determine which zig version to install.
const recommended_zig_version = "0.12.0-dev.1828";

var is_debug_build = false;

fn exists(path: []const u8) bool {
    _ = std.fs.openFileAbsolute(path, .{ .mode = .read_only }) catch return false;
    return true;
}

fn addInternalPackages(b: *Build, step: *CompileStep, _: std.mem.Allocator, _: []const u8, target: anytype) !void {
    const os_tag = target.result.os.tag;
    const io: *Module = brk: {
        if (os_tag == .macos or os_tag == .ios or os_tag == .watchos or os_tag == .tvos) {
            break :brk b.createModule(.{
                .root_source_file = LazyPath.relative("src/io/io_darwin.zig"),
            });
        } else if (os_tag == .linux) {
            break :brk b.createModule(.{
                .root_source_file = LazyPath.relative("src/io/io_linux.zig"),
            });
        } else if (os_tag == .windows) {
            break :brk b.createModule(.{
                .root_source_file = LazyPath.relative("src/io/io_windows.zig"),
            });
        }

        break :brk b.createModule(.{
            .root_source_file = LazyPath.relative("src/io/io_stub.zig"),
        });
    };

    step.root_module.addImport("async_io", io);

    step.root_module.addImport("zlib-internal", brk: {
        if (os_tag == .windows) {
            break :brk b.createModule(.{ .root_source_file = LazyPath.relative("src/deps/zlib.win32.zig") });
        }

        break :brk b.createModule(.{ .root_source_file = LazyPath.relative("src/deps/zlib.posix.zig") });
    });

    const async_: *Module = brk: {
        if (os_tag == .macos or os_tag == .watchos or os_tag == .tvos or os_tag == .ios or os_tag == .linux or os_tag == .freebsd) {
            break :brk b.createModule(.{
                .root_source_file = LazyPath.relative("src/async/posix_event_loop.zig"),
            });
        } else if (os_tag == .windows) {
            break :brk b.createModule(.{
                .root_source_file = LazyPath.relative("src/async/windows_event_loop.zig"),
            });
        }

        break :brk b.createModule(.{
            .root_source_file = LazyPath.relative("src/async/stub_event_loop.zig"),
        });
    };
    step.root_module.addImport("async", async_);
}

const BunBuildOptions = struct {
    enable_logs: bool = false,
    is_canary: bool = false,
    canary_revision: u32 = 0,
    sha: [:0]const u8 = "",
    version: []const u8 = "",
    baseline: bool = false,
    bindgen: bool = false,
    sizegen: bool = false,
    base_path: [:0]const u8 = "",
    tracy_callstack_depth: u16,

    runtime_js_version: u64 = 0,
    fallback_html_version: u64 = 0,

    tinycc: bool = true,
    project: [:0]const u8 = "",

    pub fn updateRuntime(this: *BunBuildOptions) anyerror!void {
        if (std.fs.cwd().openFile("src/runtime.out.js", .{ .mode = .read_only })) |file| {
            defer file.close();
            const runtime_hash = Wyhash11.hash(
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
            const fallback_hash = Wyhash11.hash(
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

    pub fn step(this: BunBuildOptions, b: anytype) *std.Build.Step.Options {
        var opts = b.addOptions();
        opts.addOption(@TypeOf(this.enable_logs), "enable_logs", this.enable_logs);
        opts.addOption(@TypeOf(this.is_canary), "is_canary", this.is_canary);
        opts.addOption(@TypeOf(this.canary_revision), "canary_revision", this.canary_revision);
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

var optimize: std.builtin.OptimizeMode = .Debug;

const Build = std.Build;
const CrossTarget = std.zig.CrossTarget;
const OptimizeMode = std.builtin.OptimizeMode;
const CompileStep = std.Build.Step.Compile;
const LazyPath = std.Build.LazyPath;
const Module = std.Build.Module;
const fs = std.fs;

pub fn build(b: *Build) !void {
    build_(b) catch |err| {
        if (@errorReturnTrace()) |trace| {
            (std.debug).dumpStackTrace(trace.*);
        }

        return err;
    };
}

pub fn build_(b: *Build) !void {
    switch (comptime zig_version.order(std.SemanticVersion.parse(recommended_zig_version) catch unreachable)) {
        .eq => {},
        .lt => {
            @compileError("The minimum version of Zig required to compile Bun is " ++ recommended_zig_version ++ ", found " ++ @import("builtin").zig_version_string ++ ". Please follow the instructions at https://bun.sh/docs/project/contributing. You may need to re-run `bun setup`.");
        },
        .gt => {
            const colors = std.io.getStdErr().supportsAnsiEscapeCodes();
            std.debug.print(
                "{s}WARNING:\nBun recommends Zig version '{s}', but found '{s}', build may fail...\nMake sure you are following the instructions at https://bun.sh/docs/project/contributing\n{s}You can update to the right version using 'zigup {s}'\n\n",
                .{
                    if (colors) "\x1b[1;33m" else "",
                    recommended_zig_version,
                    builtin.zig_version_string,
                    if (colors) "\x1b[0m" else "",
                    recommended_zig_version,
                },
            );
        },
    }

    // Standard target options allows the person running `zig build` to choose
    // what target to build for. Here we do not override the defaults, which
    // means any target is allowed, and the default is native. Other options
    // for restricting supported target set are available.
    var target = b.standardTargetOptions(.{});
    // Standard release options allow the person running `zig build` to select
    // between Debug, ReleaseSafe, ReleaseFast, and ReleaseSmall.
    optimize = b.standardOptimizeOption(.{});

    var generated_code_directory = b.option([]const u8, "generated-code", "Set the generated code directory") orelse "";

    if (generated_code_directory.len == 0) {
        generated_code_directory = b.pathFromRoot("build/codegen");
    }

    var output_dir_buf = std.mem.zeroes([4096]u8);
    const bin_label = if (optimize == std.builtin.OptimizeMode.Debug) "packages/debug-bun-" else "packages/bun-";

    var triplet_buf: [64]u8 = undefined;

    const arch: std.Target.Cpu.Arch = target.result.cpu.arch;

    var os_tagname = @tagName(target.result.os.tag);

    switch (target.result.os.tag) {
        .macos => {
            os_tagname = "darwin";
            target.query.os_version_min = std.zig.CrossTarget.OsVersion{ .semver = .{ .major = 11, .minor = 0, .patch = 0 } };
        },
        .windows => {
            target.query.os_version_min = std.zig.CrossTarget.OsVersion{
                // Windows 1809
                // Minimum version for a syscall related to bun.sys.renameat
                // if you update this please update install.ps1
                .windows = .win10_rs5,
            };
        },
        .linux => {
            target.query.setGnuLibCVersion(2, 27, 0);
        },
        else => {},
    }

    @memcpy(triplet_buf[0..].ptr, os_tagname);
    const osname = triplet_buf[0..os_tagname.len];
    triplet_buf[osname.len] = '-';

    @memcpy(triplet_buf[osname.len + 1 ..].ptr, @tagName(target.result.cpu.arch));
    var cpu_arch_name = triplet_buf[osname.len + 1 ..][0..@tagName(target.result.cpu.arch).len];
    std.mem.replaceScalar(u8, cpu_arch_name, '_', '-');
    if (std.mem.eql(u8, cpu_arch_name, "x86-64")) {
        @memcpy(cpu_arch_name.ptr, "x64");
        cpu_arch_name = cpu_arch_name[0..3];
    }

    const triplet = triplet_buf[0 .. osname.len + cpu_arch_name.len + 1];

    const outfile_maybe = b.option([]const u8, "output-file", "target to install to");

    if (outfile_maybe) |outfile| {
        output_dir = try pathRel(b.allocator, b.install_prefix, std.fs.path.dirname(outfile) orelse "");
    } else {
        const output_dir_base = try std.fmt.bufPrint(&output_dir_buf, "{s}{s}", .{ bin_label, triplet });
        output_dir = try pathRel(b.allocator, b.install_prefix, output_dir_base);
    }

    is_debug_build = optimize == OptimizeMode.Debug;
    const bun_executable_name = if (outfile_maybe) |outfile| std.fs.path.basename(outfile[0 .. outfile.len - std.fs.path.extension(outfile).len]) else if (is_debug_build) "bun-debug" else "bun";
    const root_src = if (target.result.os.tag == std.Target.Os.Tag.freestanding)
        "root_wasm.zig"
    else
        "root.zig";

    const min_version: std.SemanticVersion = if (!(target.result.os.tag == .windows or target.result.os.tag == .freestanding))
        target.result.os.getVersionRange().semver.min
    else
        .{ .major = 0, .minor = 0, .patch = 0 };

    const max_version: std.SemanticVersion = if (!(target.result.os.tag == .windows or target.result.os.tag == .freestanding))
        target.result.os.getVersionRange().semver.max
    else
        .{ .major = 0, .minor = 0, .patch = 0 };

    var default_build_options: BunBuildOptions = brk: {
        const is_baseline = arch.isX86() and (target.query.cpu_model == .baseline or
            !std.Target.x86.featureSetHas(target.result.cpu.features, .avx2));

        var git_sha: [:0]const u8 = "";
        if (b.env_map.get("GITHUB_SHA") orelse b.env_map.get("GIT_SHA")) |sha| {
            git_sha = b.allocator.dupeZ(u8, sha) catch unreachable;
        } else {
            sha: {
                const result = std.ChildProcess.run(.{
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

        const enable_logs = if (b.option(bool, "enable_logs", "Enable logs in release")) |l| l else false;

        const is_canary, const canary_revision = if (b.option(u32, "canary", "Treat this as a canary build")) |rev|
            if (rev == 0)
                .{ false, 0 }
            else
                .{ true, rev }
        else
            .{ false, 0 };
        break :brk .{
            .enable_logs = enable_logs,
            .is_canary = is_canary,
            .canary_revision = canary_revision,
            .version = b.option([]const u8, "version", "Value of `Bun.version`") orelse "0.0.0",
            .sha = git_sha,
            .baseline = is_baseline,
            .bindgen = false,
            .base_path = try b.allocator.dupeZ(u8, b.pathFromRoot(".")),
            .tracy_callstack_depth = b.option(u16, "tracy_callstack_depth", "") orelse 10,
        };
    };

    if (default_build_options.baseline) {
        target.query.cpu_model = .{ .explicit = &std.Target.x86.cpu.x86_64_v2 };
    } else if (arch.isX86()) {
        target.query.cpu_model = .{ .explicit = &std.Target.x86.cpu.haswell };
    } else if (arch.isAARCH64()) {
        if (target.result.os.tag == .macos or target.result.os.tag == .watchos or target.result.os.tag == .ios or target.result.os.tag == .tvos) {
            target.query.cpu_model = .{ .explicit = &std.Target.aarch64.cpu.apple_m1 };
        } else {
            target.query.cpu_model = .{ .explicit = &std.Target.aarch64.cpu.generic };
        }
    }

    var obj_step = b.step("obj", "Build bun as a .o file");
    var obj = b.addObject(.{
        .name = bun_executable_name,
        .root_source_file = LazyPath.relative(root_src),
        .target = target,
        .optimize = optimize,
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

    b.reference_trace = if (b.option(u32, "reference-trace", "Set the reference trace")) |trace|
        if (trace == 0)
            null
        else
            trace
    else
        16;

    {
        try addInternalPackages(
            b,
            obj,
            b.allocator,
            b.zig_exe,
            target,
        );

        try default_build_options.updateRuntime();

        // we have to dump to stderr because stdout is read by zls
        std.io.getStdErr().writer().print("Build {s} v{} - v{} ({s})\n", .{
            triplet,
            min_version,
            max_version,
            target.result.cpu.model.name,
        }) catch {};
        std.io.getStdErr().writer().print("Zig v{s}\n", .{builtin.zig_version_string}) catch {};

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

        actual_build_options.project = "bun";
        obj.root_module.addOptions("build_options", actual_build_options.step(b));

        // Generated Code
        // TODO: exit with a better error early if these files do not exist. it is an indication someone ran `zig build` directly without the code generators.
        obj.root_module.addImport("ZigGeneratedClasses", b.createModule(.{
            .root_source_file = .{ .path = b.pathJoin(&.{ generated_code_directory, "ZigGeneratedClasses.zig" }) },
        }));
        obj.root_module.addImport("ResolvedSourceTag", b.createModule(.{
            .root_source_file = .{ .path = b.pathJoin(&.{ generated_code_directory, "ResolvedSourceTag.zig" }) },
        }));

        obj.linkLibC();
        if (target.result.os.tag == .windows) obj.dll_export_fns = true;
        obj.root_module.strip = false;
        obj.root_module.omit_frame_pointer = false;
        obj.subsystem = .Console;

        // Disable stack probing on x86 so we don't need to include compiler_rt
        if (target.result.cpu.arch.isX86() or target.result.os.tag == .windows) obj.root_module.stack_check = false;

        if (b.option(bool, "for-editor", "Do not emit bin, just check for errors") orelse false) {
            // obj.emit_bin = .no_emit;
            obj.generated_bin = null;
        }

        if (target.result.os.tag == .linux) {
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
            .root_source_file = LazyPath.relative("src/bindgen.zig"),
            .target = target,
            .optimize = optimize,
        });
        defer headers_step.dependOn(&headers_obj.step);
        try configureObjectStep(b, headers_obj, headers_step, @TypeOf(target), target);
        var headers_build_options = default_build_options;
        headers_build_options.bindgen = true;
        headers_obj.root_module.addOptions("build_options", default_build_options.step(b));
        headers_obj.linkLibCpp();
    }

    {
        const wasm_step = b.step("bun-wasm", "Build WASM");
        var wasm = b.addStaticLibrary(.{
            .name = "bun-wasm",
            .root_source_file = LazyPath.relative("root_wasm.zig"),
            .target = target,
            .optimize = optimize,
        });
        defer wasm_step.dependOn(&wasm.step);
        wasm.root_module.strip = false;
        // wasm_step.link_function_sections = true;
        // wasm_step.link_emit_relocs = true;
        // wasm_step.single_threaded = true;
        try configureObjectStep(b, wasm, wasm_step, @TypeOf(target), target);
        var build_opts = default_build_options;
        wasm.root_module.addOptions("build_options", build_opts.step(b));
    }

    {
        const headers_step = b.step("httpbench-obj", "Build HTTPBench tool (object files)");
        var headers_obj = b.addObject(.{
            .name = "httpbench",
            .root_source_file = LazyPath.relative("misctools/http_bench.zig"),
            .target = target,
            .optimize = optimize,
        });
        defer headers_step.dependOn(&headers_obj.step);
        try configureObjectStep(b, headers_obj, headers_step, @TypeOf(target), target);
        headers_obj.root_module.addOptions("build_options", default_build_options.step(b));
    }

    {
        const headers_step = b.step("machbench-obj", "Build Machbench tool (object files)");
        var headers_obj = b.addObject(.{
            .name = "machbench",
            .root_source_file = LazyPath.relative("misctools/machbench.zig"),
            .target = target,
            .optimize = optimize,
        });
        defer headers_step.dependOn(&headers_obj.step);
        try configureObjectStep(b, headers_obj, headers_step, @TypeOf(target), target);
        headers_obj.root_module.addOptions("build_options", default_build_options.step(b));
    }

    {
        const headers_step = b.step("fetch-obj", "Build fetch (object files)");
        var headers_obj = b.addObject(.{
            .name = "fetch",
            .root_source_file = LazyPath.relative("misctools/fetch.zig"),
            .target = target,
            .optimize = optimize,
        });
        defer headers_step.dependOn(&headers_obj.step);
        try configureObjectStep(b, headers_obj, headers_step, @TypeOf(target), target);
        headers_obj.root_module.addOptions("build_options", default_build_options.step(b));
    }

    {
        const headers_step = b.step("string-bench", "Build string bench");
        var headers_obj = b.addExecutable(.{
            .name = "string-bench",
            .root_source_file = LazyPath.relative("src/bench/string-handling.zig"),
            .target = target,
            .optimize = optimize,
        });
        defer headers_step.dependOn(&headers_obj.step);
        try configureObjectStep(b, headers_obj, headers_step, @TypeOf(target), target);
        headers_obj.root_module.addOptions("build_options", default_build_options.step(b));
    }

    {
        const headers_step = b.step("sha-bench-obj", "Build sha bench");
        var headers_obj = b.addObject(.{
            .name = "sha",
            .root_source_file = LazyPath.relative("src/sha.zig"),
            .target = target,
            .optimize = optimize,
        });
        defer headers_step.dependOn(&headers_obj.step);
        try configureObjectStep(b, headers_obj, headers_step, @TypeOf(target), target);
        headers_obj.root_module.addOptions("build_options", default_build_options.step(b));
    }

    {
        const headers_step = b.step("vlq-bench", "Build vlq bench");
        var headers_obj: *CompileStep = b.addExecutable(.{
            .name = "vlq-bench",
            .root_source_file = LazyPath.relative("src/sourcemap/vlq_bench.zig"),
            .target = target,
            .optimize = optimize,
        });
        defer headers_step.dependOn(&headers_obj.step);
        try configureObjectStep(b, headers_obj, headers_step, @TypeOf(target), target);
        headers_obj.root_module.addOptions("build_options", default_build_options.step(b));
    }

    {
        const headers_step = b.step("tgz-obj", "Build tgz (object files)");
        var headers_obj: *CompileStep = b.addObject(.{
            .name = "tgz",
            .root_source_file = LazyPath.relative("misctools/tgz.zig"),
            .target = target,
            .optimize = optimize,
        });
        defer headers_step.dependOn(&headers_obj.step);
        try configureObjectStep(b, headers_obj, headers_step, @TypeOf(target), target);
        headers_obj.root_module.addOptions("build_options", default_build_options.step(b));
    }

    {
        const headers_step = b.step("test", "Build test");

        const test_file = b.option([]const u8, "test-file", "Input file for test");
        const test_bin_ = b.option([]const u8, "test-bin", "Emit bin to");
        const test_filter = b.option([]const u8, "test-filter", "Filter for test");

        var headers_obj: *CompileStep = b.addTest(.{
            .root_source_file = LazyPath.relative(test_file orelse "src/main.zig"),
            .target = target,
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
        headers_obj.root_module.addOptions("build_options", default_build_options.step(b));
    }

    // Running `zig build` with no arguments is almost always a mistake.
    const mistake_message = b.addSystemCommand(&.{
        "echo",
        \\
        \\error: To build Bun from source, please use `bun run setup` instead of `zig build`"
        \\
        \\If you want to build the zig code only, run:
        \\  'zig build obj -Dgenerated-code=./build/codegen [...opts]'
        \\
        \\For more info, see https://bun.sh/docs/project/contributing
        \\
    });

    b.default_step.dependOn(&mistake_message.step);
}

pub var original_make_fn: ?*const fn (step: *std.build.Step) anyerror!void = null;

pub fn configureObjectStep(b: *std.Build, obj: *CompileStep, obj_step: *std.Build.Step, comptime Target: type, target: Target) !void {
    // obj.setTarget(target);
    try addInternalPackages(b, obj, std.heap.page_allocator, b.zig_exe, target);

    obj.root_module.strip = false;

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
    if (target.result.os.tag != .freestanding) obj.linkLibC();
    if (target.result.os.tag != .freestanding) obj.bundle_compiler_rt = false;

    // Disable stack probing on x86 so we don't need to include compiler_rt
    // Needs to be disabled here too so headers object will build without the `__zig_probe_stack` symbol
    if (target.result.cpu.arch.isX86()) obj.root_module.stack_check = false;

    if (target.result.os.tag == .linux) {
        // obj.want_lto = tar;
        obj.link_emit_relocs = true;
        obj.link_eh_frame_hdr = true;
        obj.link_function_sections = true;
    }
}
