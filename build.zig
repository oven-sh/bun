const std = @import("std");
const builtin = @import("builtin");

const Build = std.Build;
const Step = Build.Step;
const Compile = Step.Compile;
const LazyPath = Step.LazyPath;
const Target = std.Target;
const ResolvedTarget = std.Build.ResolvedTarget;
const CrossTarget = std.zig.CrossTarget;
const OptimizeMode = std.builtin.OptimizeMode;
const Module = Build.Module;
const fs = std.fs;
const Version = std.SemanticVersion;
const Arch = std.Target.Cpu.Arch;

const Wyhash11 = @import("./src/wyhash.zig").Wyhash11;
const OperatingSystem = @import("src/env.zig").OperatingSystem;

const pathRel = fs.path.relative;

/// Do not rename this constant. It is scanned by some scripts to determine which zig version to install.
const recommended_zig_version = "0.12.0-dev.3518+d2be725e4";

comptime {
    if (!std.mem.eql(u8, builtin.zig_version_string, recommended_zig_version)) {
        @compileError(
            "" ++
                "Bun requires Zig version " ++ recommended_zig_version ++ ". This is" ++
                "automatically configured via Bun's CMake setup. You likely meant to run" ++
                "`bun setup`. If you are trying to upgrade the Zig compiler," ++
                "run `./scripts/download-zig.sh master` or comment this message out.",
        );
    }
}

const zero_sha = "0000000000000000000000000000000000000000";

const BunBuildOptions = struct {
    target: ResolvedTarget,
    optimize: OptimizeMode,
    os: OperatingSystem,
    arch: Arch,

    version: Version,
    canary_revision: ?u32,
    sha: []const u8,
    tracy_callstack_depth: u16,

    generated_code_dir: []const u8,

    // pub fn updateRuntime(this: *BunBuildOptions) anyerror!void {
    //     if (std.fs.cwd().openFile("src/runtime.out.js", .{ .mode = .read_only })) |file| {
    //         defer file.close();
    //         const runtime_hash = Wyhash11.hash(
    //             0,
    //             try file.readToEndAlloc(std.heap.page_allocator, try file.getEndPos()),
    //         );
    //         this.runtime_js_version = runtime_hash;
    //     } else |_| {
    //         if (!is_debug_build) {
    //             @panic("Runtime file was not read successfully. Please run `make setup`");
    //         }
    //     }

    //     if (std.fs.cwd().openFile("src/fallback.out.js", .{ .mode = .read_only })) |file| {
    //         defer file.close();
    //         const fallback_hash = Wyhash11.hash(
    //             0,
    //             try file.readToEndAlloc(std.heap.page_allocator, try file.getEndPos()),
    //         );
    //         this.fallback_html_version = fallback_hash;
    //     } else |_| {
    //         if (!is_debug_build) {
    //             @panic("Fallback file was not read successfully. Please run `make setup`");
    //         }
    //     }
    // }

    cached_options_module: ?*Module = null,

    pub fn isBaseline(this: *const BunBuildOptions) bool {
        // return this.arch.isX86() and (this.target.result.cpu.model == .baseline or
        //     !std.Target.x86.featureSetHas(this.target.result.getCpuFeatures(), .avx2));
        // TODO:
        _ = this;
        return false;
    }

    pub fn buildOptionsModule(this: *BunBuildOptions, b: *Build) *Module {
        if (this.cached_options_module) |mod| {
            return mod;
        }

        var opts = b.addOptions();
        opts.addOption([]const u8, "base_path", b.pathFromRoot("."));
        opts.addOption(u32, "canary_revision", this.canary_revision orelse 0);
        opts.addOption(bool, "is_canary", this.canary_revision != null);
        opts.addOption(Version, "version", this.version);
        opts.addOption([:0]const u8, "sha", b.allocator.dupeZ(u8, this.sha) catch @panic("OOM"));
        opts.addOption(bool, "baseline", this.isBaseline());

        const mod = opts.createModule();
        this.cached_options_module = mod;
        return mod;
    }
};

pub fn build(b: *Build) !void {
    std.io.getStdErr().writer().print("zig build v{s}\n", .{builtin.zig_version_string}) catch {};

    var target = b.standardTargetOptions(.{});
    const optimize = b.standardOptimizeOption(.{});

    const arch = target.result.cpu.arch;
    const os: OperatingSystem = if (arch.isWasm())
        .wasm
    else switch (target.result.os.tag) {
        .macos => .mac,
        .linux => .linux,
        .windows => .windows,
        else => |t| std.debug.panic("Unsupported OS tag {}", .{t}),
    };

    const generated_code_dir = b.pathFromRoot(
        b.option([]const u8, "generated-code", "Set the generated code directory") orelse
            "build/codegen",
    );
    const bun_version = b.option([]const u8, "version", "Value of `Bun.version`") orelse "0.0.0";

    // TODO: Remove this
    // const bin_label = if (optimize == .Debug) "packages/debug-bun-" else "packages/bun-";

    switch (os) {
        .mac => {
            target.result.os.version_range = .{ .semver = .{
                .min = .{ .major = 11, .minor = 0, .patch = 0 },
                .max = .{ .major = 9999, .minor = 9999, .patch = 9999 },
            } };
        },
        .windows => {
            target.result.os.version_range = .{ .windows = .{
                .min = .win10_rs5,
                .max = std.Target.Os.WindowsVersion.latest,
            } };
        },
        .linux => {
            target.result.os.version_range = .{ .semver = .{
                .min = .{ .major = 2, .minor = 27, .patch = 0 },
                .max = .{ .major = 9999, .minor = 9999, .patch = 9999 },
            } };
        },
        .wasm => {},
    }

    b.reference_trace = ref_trace: {
        const trace = b.option(u32, "reference-trace", "Set the reference trace") orelse 16;
        break :ref_trace if (trace == 0) null else trace;
    };

    var build_options = BunBuildOptions{
        .target = target,
        .optimize = optimize,

        .os = os,
        .arch = arch,

        .generated_code_dir = generated_code_dir,

        .version = try Version.parse(bun_version),
        .canary_revision = canary: {
            const rev = b.option(u32, "canary", "Treat this as a canary build") orelse 0;
            break :canary if (rev == 0) null else rev;
        },

        .sha = sha: {
            const sha = b.option([]const u8, "sha", "Force the git sha") orelse
                b.graph.env_map.get("GITHUB_SHA") orelse
                b.graph.env_map.get("GIT_SHA") orelse fetch_sha: {
                const result = std.ChildProcess.run(.{
                    .allocator = b.allocator,
                    .argv = &.{
                        "git",
                        "rev-parse",
                        "HEAD",
                    },
                    .cwd = b.pathFromRoot("."),
                    .expand_arg0 = .expand,
                }) catch |err| {
                    std.log.warn("Failed to execute 'git rev-parse HEAD': {s}", .{@errorName(err)});
                    std.log.warn("Falling back to zero sha", .{});
                    break :sha zero_sha;
                };

                break :fetch_sha b.dupe(std.mem.trim(u8, result.stdout, "\n \t"));
            };

            if (sha.len == 0) {
                std.log.warn("No git sha found, falling back to zero sha", .{});
                break :sha zero_sha;
            }
            if (sha.len != 40) {
                std.log.warn("Invalid git sha: {s}", .{sha});
                std.log.warn("Falling back to zero sha", .{});
                break :sha zero_sha;
            }

            break :sha sha;
        },

        .tracy_callstack_depth = b.option(u16, "tracy_callstack_depth", "") orelse 10,
    };

    // std.io.getStdErr().writer().print("Build {s} ({s})\n", .{
    // std.io.getStdErr().writer().print("Build {s} v{} - v{} ({s})\n", .{
    // triplet,
    // min_version,
    // max_version,
    // obj.target.getCpuModel().name,
    // }) catch {};

    // @memcpy(triplet_buf[0..].ptr, os_tagname);
    // const osname = triplet_buf[0..os_tagname.len];
    // triplet_buf[osname.len] = '-';

    // @memcpy(triplet_buf[osname.len + 1 ..].ptr, @tagName(target.result.cpu.arch));
    // var cpuArchName = triplet_buf[osname.len + 1 ..][0..@tagName(target.result.cpu.arch).len];
    // std.mem.replaceScalar(u8, cpuArchName, '_', '-');
    // if (std.mem.eql(u8, cpuArchName, "x86-64")) {
    //     @memcpy(cpuArchName.ptr, "x64");
    //     cpuArchName = cpuArchName[0..3];
    // }

    // const triplet = triplet_buf[0 .. osname.len + cpuArchName.len + 1];

    const outfile_maybe = b.option([]const u8, "output-file", "target to install to");

    // const output_dir = if (outfile_maybe) |outfile|
    //     try pathRel(b.allocator, b.install_prefix, std.fs.path.dirname(outfile) orelse "")
    // else
    //     try pathRel(b.allocator, b.install_prefix, b.fmt("{s}{s}", .{ bin_label, "[triplet]" }));

    // is_debug_build = optimize == OptimizeMode.Debug;
    const bun_executable_name = if (outfile_maybe) |outfile|
        std.fs.path.basename(outfile[0 .. outfile.len - std.fs.path.extension(outfile).len])
    else if (optimize == .Debug) "bun-debug" else "bun";

    var obj_step = b.step("obj", "Build Bun's Zig code as a .o file");
    var bun_obj = addBunObject(b, bun_executable_name, &build_options);
    obj_step.dependOn(&bun_obj.step);

    var check_step = b.step("check", "Check for semantic analysis errors");
    var bun_check_obj = addBunObject(b, "bun-check", &build_options);
    bun_check_obj.generated_bin = null;
    check_step.dependOn(&bun_check_obj.step);

    // if (!exists(b.pathFromRoot(try std.fs.path.join(b.allocator, &.{
    //     "src",
    //     "js_lexer",
    //     "id_continue_bitset.blob",
    // })))) {
    //     const identifier_data = b.pathFromRoot(try std.fs.path.join(b.allocator, &.{ "src", "js_lexer", "identifier_data.zig" }));
    //     var run_step = b.addSystemCommand(&.{
    //         b.zig_exe,
    //         "run",
    //         identifier_data,
    //     });
    //     run_step.has_side_effects = true;
    //     obj.step.dependOn(&run_step.step);
    // }

    // {
    //     try addInternalPackages(
    //         b,
    //         obj,
    //         b.allocator,
    //         b.zig_exe,
    //         target,
    //     );

    //     if (default_build_options.baseline) {
    //         obj.target.cpu_model = .{ .explicit = &std.Target.x86.cpu.x86_64_v2 };
    //     } else if (arch.isX86()) {
    //         obj.target.cpu_model = .{ .explicit = &std.Target.x86.cpu.haswell };
    //     } else if (arch.isAARCH64()) {
    //         if (target.isDarwin()) {
    //             obj.target.cpu_model = .{ .explicit = &std.Target.aarch64.cpu.apple_m1 };
    //         } else {
    //             obj.target.cpu_model = .{ .explicit = &std.Target.aarch64.cpu.generic };
    //         }
    //     }

    //     try default_build_options.updateRuntime();

    //     defer obj_step.dependOn(&obj.step);

    //     var install = b.addInstallFileWithDir(
    //         obj.getEmittedBin(),
    //         .{ .custom = output_dir },
    //         b.fmt("{s}.o", .{bun_executable_name}),
    //     );
    //     install.step.dependOn(&obj.step);
    //     obj_step.dependOn(&install.step);

    //     var actual_build_options = default_build_options;
    //     if (b.option(bool, "generate-sizes", "Generate sizes of things") orelse false) {
    //         actual_build_options.sizegen = true;
    //     }

    //     actual_build_options.project = "bun";
    //     obj.addOptions("build_options", actual_build_options.step(b));

    //     obj.linkLibC();
    //     obj.dll_export_fns = true;
    //     obj.strip = false;
    //     obj.omit_frame_pointer = optimize != .Debug;
    //     obj.subsystem = .Console;

    //     // Disable stack probing on x86 so we don't need to include compiler_rt
    //     if (target.getCpuArch().isX86() or target.isWindows()) obj.disable_stack_probing = true;

    //     if (b.option(bool, "for-editor", "Do not emit bin, just check for errors") orelse false) {
    //         // obj.emit_bin = .no_emit;
    //         obj.generated_bin = null;
    //     }

    //     if (target.getOsTag() == .linux) {
    //         // obj.want_lto = tar;
    //         obj.link_emit_relocs = true;
    //         obj.link_eh_frame_hdr = true;
    //         obj.link_function_sections = true;
    //     }
    // }

    // {
    //     const headers_step = b.step("headers-obj", "Build JavaScriptCore headers");
    //     var headers_obj = b.addObject(.{
    //         .name = "headers",
    //         .root_source_file = FileSource.relative("src/bindgen.zig"),
    //         .target = target,
    //         .optimize = optimize,
    //         .main_mod_path = obj.main_mod_path,
    //     });
    //     defer headers_step.dependOn(&headers_obj.step);
    //     try configureObjectStep(b, headers_obj, headers_step, @TypeOf(target), target);
    //     var headers_build_options = default_build_options;
    //     headers_build_options.bindgen = true;
    //     headers_obj.addOptions("build_options", default_build_options.step(b));
    //     headers_obj.linkLibCpp();
    // }

    // {
    //     const wasm_step = b.step("bun-wasm", "Build WASM");
    //     var wasm = b.addStaticLibrary(.{
    //         .name = "bun-wasm",
    //         .root_source_file = FileSource.relative("root_wasm.zig"),
    //         .target = target,
    //         .optimize = optimize,
    //         .main_mod_path = obj.main_mod_path,
    //     });
    //     defer wasm_step.dependOn(&wasm.step);
    //     wasm.strip = false;
    //     // wasm_step.link_function_sections = true;
    //     // wasm_step.link_emit_relocs = true;
    //     // wasm_step.single_threaded = true;
    //     try configureObjectStep(b, wasm, wasm_step, @TypeOf(target), target);
    //     var build_opts = default_build_options;
    //     wasm.addOptions("build_options", build_opts.step(b));
    // }

    // {
    //     const headers_step = b.step("httpbench-obj", "Build HTTPBench tool (object files)");
    //     var headers_obj = b.addObject(.{
    //         .name = "httpbench",
    //         .root_source_file = FileSource.relative("misctools/http_bench.zig"),
    //         .target = target,
    //         .optimize = optimize,
    //         .main_mod_path = obj.main_mod_path,
    //     });
    //     defer headers_step.dependOn(&headers_obj.step);
    //     try configureObjectStep(b, headers_obj, headers_step, @TypeOf(target), target);
    //     headers_obj.addOptions("build_options", default_build_options.step(b));
    // }

    // {
    //     const headers_step = b.step("machbench-obj", "Build Machbench tool (object files)");
    //     var headers_obj = b.addObject(.{
    //         .name = "machbench",
    //         .root_source_file = FileSource.relative("misctools/machbench.zig"),
    //         .target = target,
    //         .optimize = optimize,
    //         .main_mod_path = obj.main_mod_path,
    //     });
    //     defer headers_step.dependOn(&headers_obj.step);
    //     try configureObjectStep(b, headers_obj, headers_step, @TypeOf(target), target);
    //     headers_obj.addOptions("build_options", default_build_options.step(b));
    // }

    // {
    //     const headers_step = b.step("fetch-obj", "Build fetch (object files)");
    //     var headers_obj = b.addObject(.{
    //         .name = "fetch",
    //         .root_source_file = FileSource.relative("misctools/fetch.zig"),
    //         .target = target,
    //         .optimize = optimize,
    //         .main_mod_path = obj.main_mod_path,
    //     });
    //     defer headers_step.dependOn(&headers_obj.step);
    //     try configureObjectStep(b, headers_obj, headers_step, @TypeOf(target), target);
    //     headers_obj.addOptions("build_options", default_build_options.step(b));
    // }

    // {
    //     const headers_step = b.step("string-bench", "Build string bench");
    //     var headers_obj = b.addExecutable(.{
    //         .name = "string-bench",
    //         .root_source_file = FileSource.relative("src/bench/string-handling.zig"),
    //         .target = target,
    //         .optimize = optimize,
    //         .main_mod_path = obj.main_mod_path,
    //     });
    //     defer headers_step.dependOn(&headers_obj.step);
    //     try configureObjectStep(b, headers_obj, headers_step, @TypeOf(target), target);
    //     headers_obj.addOptions("build_options", default_build_options.step(b));
    // }

    // {
    //     const headers_step = b.step("sha-bench-obj", "Build sha bench");
    //     var headers_obj = b.addObject(.{
    //         .name = "sha",
    //         .root_source_file = FileSource.relative("src/sha.zig"),
    //         .target = target,
    //         .optimize = optimize,
    //         .main_mod_path = obj.main_mod_path,
    //     });
    //     defer headers_step.dependOn(&headers_obj.step);
    //     try configureObjectStep(b, headers_obj, headers_step, @TypeOf(target), target);
    //     headers_obj.addOptions("build_options", default_build_options.step(b));
    // }

    // {
    //     const headers_step = b.step("vlq-bench", "Build vlq bench");
    //     var headers_obj: *CompileStep = b.addExecutable(.{
    //         .name = "vlq-bench",
    //         .root_source_file = FileSource.relative("src/sourcemap/vlq_bench.zig"),
    //         .target = target,
    //         .optimize = optimize,
    //         .main_mod_path = obj.main_mod_path,
    //     });
    //     defer headers_step.dependOn(&headers_obj.step);
    //     try configureObjectStep(b, headers_obj, headers_step, @TypeOf(target), target);
    //     headers_obj.addOptions("build_options", default_build_options.step(b));
    // }

    // {
    //     const headers_step = b.step("tgz-obj", "Build tgz (object files)");
    //     var headers_obj: *CompileStep = b.addObject(.{
    //         .name = "tgz",
    //         .root_source_file = FileSource.relative("misctools/tgz.zig"),
    //         .target = target,
    //         .optimize = optimize,
    //         .main_mod_path = obj.main_mod_path,
    //     });
    //     defer headers_step.dependOn(&headers_obj.step);
    //     try configureObjectStep(b, headers_obj, headers_step, @TypeOf(target), target);
    //     headers_obj.addOptions("build_options", default_build_options.step(b));
    // }

    // {
    //     const headers_step = b.step("test", "Build test");

    //     const test_file = b.option([]const u8, "test-file", "Input file for test");
    //     const test_bin_ = b.option([]const u8, "test-bin", "Emit bin to");
    //     const test_filter = b.option([]const u8, "test-filter", "Filter for test");

    //     var headers_obj: *CompileStep = b.addTest(.{
    //         .root_source_file = FileSource.relative(test_file orelse "src/main.zig"),
    //         .target = target,
    //         .main_mod_path = obj.main_mod_path,
    //     });
    //     headers_obj.filter = test_filter;
    //     if (test_bin_) |test_bin| {
    //         headers_obj.name = std.fs.path.basename(test_bin);
    //         if (std.fs.path.dirname(test_bin)) |dir| {
    //             var install = b.addInstallFileWithDir(
    //                 headers_obj.getEmittedBin(),
    //                 .{ .custom = try std.fs.path.relative(b.allocator, output_dir, dir) },
    //                 headers_obj.name,
    //             );
    //             install.step.dependOn(&headers_obj.step);
    //             headers_step.dependOn(&install.step);
    //         }
    //     }

    //     try configureObjectStep(b, headers_obj, headers_step, @TypeOf(target), target);

    //     headers_step.dependOn(&headers_obj.step);
    //     headers_obj.addOptions("build_options", default_build_options.step(b));
    // }

    {
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
}

pub fn addBunObject(b: *Build, obj_name: []const u8, opts: *BunBuildOptions) *Compile {
    const obj = b.addObject(.{
        .name = obj_name,
        .root_source_file = .{
            .path = switch (opts.os) {
                .wasm => "root_wasm.zig",
                else => "root.zig",
            },
        },
        .target = opts.target,
        .optimize = opts.optimize,
    });
    addInternalPackages(b, obj, opts);
    obj.root_module.addImport("build_options", opts.buildOptionsModule(b));
    return obj;
}

// pub fn configureObjectStep(b: *std.build.Builder, obj: *CompileStep, obj_step: *std.build.Step) !void {
// obj.setTarget(target);
// try addInternalPackages(b, obj, obj

// obj.strip = false;

// // obj.setBuildMode(optimize);
// obj.bundle_compiler_rt = false;
// if (obj.emit_directory == null) {
//     var install = b.addInstallFileWithDir(
//         obj.getEmittedBin(),
//         .{ .custom = output_dir },
//         b.fmt("{s}.o", .{obj.name}),
//     );

//     install.step.dependOn(&obj.step);
//     obj_step.dependOn(&install.step);
// }
// if (target.getOsTag() != .freestanding) obj.linkLibC();
// if (target.getOsTag() != .freestanding) obj.bundle_compiler_rt = false;

// // Disable stack probing on x86 so we don't need to include compiler_rt
// // Needs to be disabled here too so headers object will build without the `__zig_probe_stack` symbol
// if (target.getCpuArch().isX86()) obj.disable_stack_probing = true;

// if (target.getOsTag() == .linux) {
//     // obj.want_lto = tar;
//     obj.link_emit_relocs = true;
//     obj.link_eh_frame_hdr = true;
//     obj.link_function_sections = true;
// }
// }

fn exists(path: []const u8) bool {
    const file = std.fs.openFileAbsolute(path, .{ .mode = .read_only }) catch return false;
    file.close();
    return true;
}

fn addInternalPackages(b: *Build, obj: *Compile, opts: *BunBuildOptions) void {
    const os = opts.os;

    const io_path = switch (os) {
        .mac => "src/io/io_darwin.zig",
        .linux => "src/io/io_linux.zig",
        .windows => "src/io/io_windows.zig",
        else => "src/io/io_stub.zig",
    };
    obj.root_module.addAnonymousImport("async_io", .{
        .root_source_file = .{ .path = io_path },
    });

    const zlib_internal_path = switch (os) {
        .windows => "src/deps/zlib.win32.zig",
        .linux, .mac => "src/deps/zlib.posix.zig",
        else => null,
    };
    if (zlib_internal_path) |path| {
        obj.root_module.addAnonymousImport("zlib-internal", .{
            .root_source_file = .{ .path = path },
        });
    }

    const async_path = switch (os) {
        .linux, .mac => "src/async/posix_event_loop.zig",
        .windows => "src/async/windows_event_loop.zig",
        else => "src/async/stub_event_loop.zig",
    };
    obj.root_module.addAnonymousImport("async", .{
        .root_source_file = .{ .path = async_path },
    });

    const zig_generated_classes_path = b.pathJoin(&.{ opts.generated_code_dir, "ZigGeneratedClasses.zig" });
    validateGeneratedPath(zig_generated_classes_path);
    obj.root_module.addAnonymousImport("ZigGeneratedClasses", .{
        .root_source_file = .{ .path = zig_generated_classes_path },
    });

    const resolved_source_tag_path = b.pathJoin(&.{ opts.generated_code_dir, "ResolvedSourceTag.zig" });
    validateGeneratedPath(resolved_source_tag_path);
    obj.root_module.addAnonymousImport("ResolvedSourceTag", .{
        .root_source_file = .{ .path = resolved_source_tag_path },
    });
}

fn validateGeneratedPath(path: []const u8) void {
    if (!exists(path)) {
        std.debug.panic("{s} does not exist in generated code directory!", .{std.fs.path.basename(path)});
    }
}
