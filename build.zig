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

const OperatingSystem = @import("src/env.zig").OperatingSystem;

const pathRel = fs.path.relative;

/// Do not rename this constant. It is scanned by some scripts to determine which zig version to install.
const recommended_zig_version = "0.13.0";

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
    /// enable debug logs in release builds
    enable_logs: bool = false,
    tracy_callstack_depth: u16,
    reported_nodejs_version: Version,
    /// To make iterating on some '@embedFile's faster, we load them at runtime
    /// instead of at compile time. This is disabled in release or if this flag
    /// is set (to allow CI to build a portable executable). Affected files:
    ///
    /// - src/bake/runtime.ts (bundled)
    /// - src/bun.js/api/FFI.h
    ///
    /// A similar technique is used in C++ code for JavaScript builtins
    codegen_embed: bool = false,

    /// `./build/codegen` or equivalent
    codegen_path: []const u8,
    no_llvm: bool,

    cached_options_module: ?*Module = null,
    windows_shim: ?WindowsShim = null,

    pub fn isBaseline(this: *const BunBuildOptions) bool {
        return this.arch.isX86() and
            !Target.x86.featureSetHas(this.target.result.cpu.features, .avx2);
    }

    pub fn shouldEmbedCode(opts: *const BunBuildOptions) bool {
        return opts.optimize != .Debug or opts.codegen_embed;
    }

    pub fn buildOptionsModule(this: *BunBuildOptions, b: *Build) *Module {
        if (this.cached_options_module) |mod| {
            return mod;
        }

        var opts = b.addOptions();
        opts.addOption([]const u8, "base_path", b.pathFromRoot("."));
        opts.addOption([]const u8, "codegen_path", std.fs.path.resolve(b.graph.arena, &.{
            b.build_root.path.?,
            this.codegen_path,
        }) catch @panic("OOM"));

        opts.addOption(bool, "codegen_embed", this.shouldEmbedCode());
        opts.addOption(u32, "canary_revision", this.canary_revision orelse 0);
        opts.addOption(bool, "is_canary", this.canary_revision != null);
        opts.addOption(Version, "version", this.version);
        opts.addOption([:0]const u8, "sha", b.allocator.dupeZ(u8, this.sha) catch @panic("OOM"));
        opts.addOption(bool, "baseline", this.isBaseline());
        opts.addOption(bool, "enable_logs", this.enable_logs);
        opts.addOption([]const u8, "reported_nodejs_version", b.fmt("{}", .{this.reported_nodejs_version}));

        const mod = opts.createModule();
        this.cached_options_module = mod;
        return mod;
    }

    pub fn windowsShim(this: *BunBuildOptions, b: *Build) WindowsShim {
        return this.windows_shim orelse {
            this.windows_shim = WindowsShim.create(b);
            return this.windows_shim.?;
        };
    }
};

pub fn getOSVersionMin(os: OperatingSystem) ?Target.Query.OsVersion {
    return switch (os) {
        .mac => .{
            .semver = .{ .major = 13, .minor = 0, .patch = 0 },
        },

        // Windows 10 1809 is the minimum supported version
        // One case where this is specifically required is in `deleteOpenedFile`
        .windows => .{
            .windows = .win10_rs5,
        },

        else => null,
    };
}

pub fn getOSGlibCVersion(os: OperatingSystem) ?Version {
    return switch (os) {
        // Compiling with a newer glibc than this will break certain cloud environments.
        .linux => .{ .major = 2, .minor = 27, .patch = 0 },

        else => null,
    };
}

pub fn getCpuModel(os: OperatingSystem, arch: Arch) ?Target.Query.CpuModel {
    // https://github.com/oven-sh/bun/issues/12076
    if (os == .linux and arch == .aarch64) {
        return .{ .explicit = &Target.aarch64.cpu.cortex_a35 };
    }

    // Be explicit and ensure we do not accidentally target a newer M-series chip
    if (os == .mac and arch == .aarch64) {
        return .{ .explicit = &Target.aarch64.cpu.apple_m1 };
    }

    // note: x86_64 is dealt with in the CMake config and passed in.
    // the reason for the explicit handling on aarch64 is due to troubles
    // passing the exact target in via flags.
    return null;
}

pub fn build(b: *Build) !void {
    std.log.info("zig compiler v{s}", .{builtin.zig_version_string});
    checked_file_exists = std.AutoHashMap(u64, void).init(b.allocator);

    b.zig_lib_dir = b.zig_lib_dir orelse b.path("vendor/zig/lib");

    // TODO: Upgrade path for 0.14.0
    // b.graph.zig_lib_directory = brk: {
    //     const sub_path = "vendor/zig/lib";
    //     const dir = try b.build_root.handle.openDir(sub_path, .{});
    //     break :brk .{ .handle = dir, .path = try b.build_root.join(b.graph.arena, &.{sub_path}) };
    // };

    var target_query = b.standardTargetOptionsQueryOnly(.{});
    const optimize = b.standardOptimizeOption(.{});

    const os, const arch, const abi = brk: {
        // resolve the target query to pick up what operating system and cpu
        // architecture that is desired. this information is used to slightly
        // refine the query.
        const temp_resolved = b.resolveTargetQuery(target_query);
        const arch = temp_resolved.result.cpu.arch;
        const os: OperatingSystem = if (arch.isWasm())
            .wasm
        else switch (temp_resolved.result.os.tag) {
            .macos => .mac,
            .linux => .linux,
            .windows => .windows,
            else => |t| std.debug.panic("Unsupported OS tag {}", .{t}),
        };
        const abi = temp_resolved.result.abi;
        break :brk .{ os, arch, abi };
    };

    // target must be refined to support older but very popular devices on
    // aarch64, this means moving the minimum supported CPU to support certain
    // raspberry PIs. there are also a number of cloud hosts that use virtual
    // machines with surprisingly out of date versions of glibc.
    if (getCpuModel(os, arch)) |cpu_model| {
        target_query.cpu_model = cpu_model;
    }

    target_query.os_version_min = getOSVersionMin(os);
    target_query.glibc_version = if (abi.isGnu()) getOSGlibCVersion(os) else null;

    const target = b.resolveTargetQuery(target_query);

    const codegen_path = b.pathFromRoot(
        b.option([]const u8, "codegen_path", "Set the generated code directory") orelse
            "build/debug/codegen",
    );
    const codegen_embed = b.option(bool, "codegen_embed", "If codegen files should be embedded in the binary") orelse switch (b.release_mode) {
        .off => false,
        else => true,
    };

    const bun_version = b.option([]const u8, "version", "Value of `Bun.version`") orelse "0.0.0";

    b.reference_trace = ref_trace: {
        const trace = b.option(u32, "reference-trace", "Set the reference trace") orelse 16;
        break :ref_trace if (trace == 0) null else trace;
    };

    const obj_format = b.option(ObjectFormat, "obj_format", "Output file for object files") orelse .obj;

    const no_llvm = b.option(bool, "no_llvm", "Experiment with Zig self hosted backends. No stability guaranteed") orelse false;

    var build_options = BunBuildOptions{
        .target = target,
        .optimize = optimize,

        .os = os,
        .arch = arch,

        .codegen_path = codegen_path,
        .codegen_embed = codegen_embed,
        .no_llvm = no_llvm,

        .version = try Version.parse(bun_version),
        .canary_revision = canary: {
            const rev = b.option(u32, "canary", "Treat this as a canary build") orelse 0;
            break :canary if (rev == 0) null else rev;
        },

        .reported_nodejs_version = try Version.parse(
            b.option([]const u8, "reported_nodejs_version", "Reported Node.js version") orelse
                "0.0.0-unset",
        ),

        .sha = sha: {
            const sha_buildoption = b.option([]const u8, "sha", "Force the git sha");
            const sha_github = b.graph.env_map.get("GITHUB_SHA");
            const sha_env = b.graph.env_map.get("GIT_SHA");
            const sha = sha_buildoption orelse sha_github orelse sha_env orelse fetch_sha: {
                const result = std.process.Child.run(.{
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
        .enable_logs = b.option(bool, "enable_logs", "Enable logs in release") orelse false,
    };

    // zig build obj
    {
        var step = b.step("obj", "Build Bun's Zig code as a .o file");
        var bun_obj = addBunObject(b, &build_options);
        step.dependOn(&bun_obj.step);
        step.dependOn(addInstallObjectFile(b, bun_obj, "bun-zig", obj_format));
    }

    // zig build windows-shim
    {
        var step = b.step("windows-shim", "Build the Windows shim (bun_shim_impl.exe + bun_shim_debug.exe)");
        var windows_shim = build_options.windowsShim(b);
        step.dependOn(&b.addInstallFile(windows_shim.exe.getEmittedBin(), "bun_shim_impl.exe").step);
        step.dependOn(&b.addInstallFile(windows_shim.dbg.getEmittedBin(), "bun_shim_debug.exe").step);
    }

    // zig build check
    {
        var step = b.step("check", "Check for semantic analysis errors");
        var bun_check_obj = addBunObject(b, &build_options);
        bun_check_obj.generated_bin = null;
        step.dependOn(&bun_check_obj.step);

        // The default install step will run zig build check. This is so ZLS
        // identifies the codebase, as well as performs checking if build on
        // save is enabled.

        // For building Bun itself, one should run `bun setup`
        b.default_step.dependOn(step);
    }

    // zig build check-all
    {
        const step = b.step("check-all", "Check for semantic analysis errors on all supported platforms");
        addMultiCheck(b, step, build_options, &.{
            .{ .os = .windows, .arch = .x86_64 },
            .{ .os = .mac, .arch = .x86_64 },
            .{ .os = .mac, .arch = .aarch64 },
            .{ .os = .linux, .arch = .x86_64 },
            .{ .os = .linux, .arch = .aarch64 },
            .{ .os = .linux, .arch = .x86_64, .musl = true },
            .{ .os = .linux, .arch = .aarch64, .musl = true },
        });
    }

    // zig build check-windows
    {
        const step = b.step("check-windows", "Check for semantic analysis errors on Windows");
        addMultiCheck(b, step, build_options, &.{
            .{ .os = .windows, .arch = .x86_64 },
        });
    }

    // zig build translate-c-headers
    {
        const step = b.step("translate-c", "Copy generated translated-c-headers.zig to zig-out");
        step.dependOn(&b.addInstallFile(getTranslateC(b, b.host, .Debug).getOutput(), "translated-c-headers.zig").step);
    }

    // zig build enum-extractor
    {
        // const step = b.step("enum-extractor", "Extract enum definitions (invoked by a code generator)");
        // const exe = b.addExecutable(.{
        //     .name = "enum_extractor",
        //     .root_source_file = b.path("./src/generated_enum_extractor.zig"),
        //     .target = b.graph.host,
        //     .optimize = .Debug,
        // });
        // const run = b.addRunArtifact(exe);
        // step.dependOn(&run.step);
    }
}

pub fn addMultiCheck(
    b: *Build,
    parent_step: *Step,
    root_build_options: BunBuildOptions,
    to_check: []const struct { os: OperatingSystem, arch: Arch, musl: bool = false },
) void {
    for (to_check) |check| {
        for ([_]std.builtin.Mode{ .Debug, .ReleaseFast }) |mode| {
            const check_target = b.resolveTargetQuery(.{
                .os_tag = OperatingSystem.stdOSTag(check.os),
                .cpu_arch = check.arch,
                .cpu_model = getCpuModel(check.os, check.arch) orelse .determined_by_cpu_arch,
                .os_version_min = getOSVersionMin(check.os),
                .glibc_version = if (check.musl) null else getOSGlibCVersion(check.os),
            });

            var options: BunBuildOptions = .{
                .target = check_target,
                .os = check.os,
                .arch = check_target.result.cpu.arch,
                .optimize = mode,

                .canary_revision = root_build_options.canary_revision,
                .sha = root_build_options.sha,
                .tracy_callstack_depth = root_build_options.tracy_callstack_depth,
                .version = root_build_options.version,
                .reported_nodejs_version = root_build_options.reported_nodejs_version,
                .codegen_path = root_build_options.codegen_path,
                .no_llvm = root_build_options.no_llvm,
            };

            var obj = addBunObject(b, &options);
            obj.generated_bin = null;
            parent_step.dependOn(&obj.step);
        }
    }
}

fn getTranslateC(b: *Build, target: std.Build.ResolvedTarget, optimize: std.builtin.OptimizeMode) *Step.TranslateC {
    const translate_c = b.addTranslateC(.{
        .root_source_file = b.path("src/c-headers-for-zig.h"),
        .target = target,
        .optimize = optimize,
        .link_libc = true,
    });
    inline for ([_](struct { []const u8, bool }){
        .{ "WINDOWS", translate_c.target.result.os.tag == .windows },
        .{ "POSIX", translate_c.target.result.os.tag != .windows },
        .{ "LINUX", translate_c.target.result.os.tag == .linux },
        .{ "DARWIN", translate_c.target.result.os.tag.isDarwin() },
    }) |entry| {
        const str, const value = entry;
        translate_c.defineCMacroRaw(b.fmt("{s}={d}", .{ str, @intFromBool(value) }));
    }
    return translate_c;
}

pub fn addBunObject(b: *Build, opts: *BunBuildOptions) *Compile {
    const obj = b.addObject(.{
        .name = if (opts.optimize == .Debug) "bun-debug" else "bun",
        .root_source_file = switch (opts.os) {
            .wasm => b.path("root_wasm.zig"),
            else => b.path("root.zig"),
            // else => b.path("root_css.zig"),
        },
        .target = opts.target,
        .optimize = opts.optimize,
        .use_llvm = !opts.no_llvm,
        .use_lld = if (opts.os == .mac) false else !opts.no_llvm,

        // https://github.com/ziglang/zig/issues/17430
        .pic = true,

        .omit_frame_pointer = false,
        .strip = false, // stripped at the end
    });
    obj.bundle_compiler_rt = false;
    obj.formatted_panics = true;
    obj.root_module.omit_frame_pointer = false;

    // Link libc
    if (opts.os != .wasm) {
        obj.linkLibC();
        obj.linkLibCpp();
    }

    // Disable stack probing on x86 so we don't need to include compiler_rt
    if (opts.arch.isX86()) {
        obj.root_module.stack_check = false;
        obj.root_module.stack_protector = false;
    }

    if (opts.os == .linux) {
        obj.link_emit_relocs = false;
        obj.link_eh_frame_hdr = false;
        obj.link_function_sections = true;
        obj.link_data_sections = true;

        if (opts.optimize == .Debug) {
            obj.root_module.valgrind = true;
        }
    }
    addInternalPackages(b, obj, opts);
    obj.root_module.addImport("build_options", opts.buildOptionsModule(b));

    const translate_c = getTranslateC(b, opts.target, opts.optimize);
    obj.root_module.addImport("translated-c-headers", translate_c.createModule());

    return obj;
}

const ObjectFormat = enum {
    bc,
    obj,
};

pub fn addInstallObjectFile(
    b: *Build,
    compile: *Compile,
    name: []const u8,
    out_mode: ObjectFormat,
) *Step {
    // bin always needed to be computed or else the compilation will do nothing. zig build system bug?
    const bin = compile.getEmittedBin();
    return &b.addInstallFile(switch (out_mode) {
        .obj => bin,
        .bc => compile.getEmittedLlvmBc(),
    }, b.fmt("{s}.o", .{name})).step;
}

var checked_file_exists: std.AutoHashMap(u64, void) = undefined;
fn exists(path: []const u8) bool {
    const entry = checked_file_exists.getOrPut(std.hash.Wyhash.hash(0, path)) catch unreachable;
    if (entry.found_existing) {
        // It would've panicked.
        return true;
    }

    std.fs.accessAbsolute(path, .{ .mode = .read_only }) catch return false;
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
        .root_source_file = b.path(io_path),
    });

    const zlib_internal_path = switch (os) {
        .windows => "src/deps/zlib.win32.zig",
        .linux, .mac => "src/deps/zlib.posix.zig",
        else => null,
    };
    if (zlib_internal_path) |path| {
        obj.root_module.addAnonymousImport("zlib-internal", .{
            .root_source_file = b.path(path),
        });
    }

    const async_path = switch (os) {
        .linux, .mac => "src/async/posix_event_loop.zig",
        .windows => "src/async/windows_event_loop.zig",
        else => "src/async/stub_event_loop.zig",
    };
    obj.root_module.addAnonymousImport("async", .{
        .root_source_file = b.path(async_path),
    });

    // Generated code exposed as individual modules.
    inline for (.{
        .{ .file = "ZigGeneratedClasses.zig", .import = "ZigGeneratedClasses" },
        .{ .file = "ResolvedSourceTag.zig", .import = "ResolvedSourceTag" },
        .{ .file = "ErrorCode.zig", .import = "ErrorCode" },
        .{ .file = "runtime.out.js", .enable = opts.shouldEmbedCode() },
        .{ .file = "bake.client.js", .import = "bake-codegen/bake.client.js", .enable = opts.shouldEmbedCode() },
        .{ .file = "bake.error.js", .import = "bake-codegen/bake.error.js", .enable = opts.shouldEmbedCode() },
        .{ .file = "bake.server.js", .import = "bake-codegen/bake.server.js", .enable = opts.shouldEmbedCode() },
        .{ .file = "bun-error/index.js", .enable = opts.shouldEmbedCode() },
        .{ .file = "bun-error/bun-error.css", .enable = opts.shouldEmbedCode() },
        .{ .file = "fallback-decoder.js", .enable = opts.shouldEmbedCode() },
        .{ .file = "node-fallbacks/assert.js", .enable = opts.shouldEmbedCode() },
        .{ .file = "node-fallbacks/buffer.js", .enable = opts.shouldEmbedCode() },
        .{ .file = "node-fallbacks/console.js", .enable = opts.shouldEmbedCode() },
        .{ .file = "node-fallbacks/constants.js", .enable = opts.shouldEmbedCode() },
        .{ .file = "node-fallbacks/crypto.js", .enable = opts.shouldEmbedCode() },
        .{ .file = "node-fallbacks/domain.js", .enable = opts.shouldEmbedCode() },
        .{ .file = "node-fallbacks/events.js", .enable = opts.shouldEmbedCode() },
        .{ .file = "node-fallbacks/http.js", .enable = opts.shouldEmbedCode() },
        .{ .file = "node-fallbacks/https.js", .enable = opts.shouldEmbedCode() },
        .{ .file = "node-fallbacks/net.js", .enable = opts.shouldEmbedCode() },
        .{ .file = "node-fallbacks/os.js", .enable = opts.shouldEmbedCode() },
        .{ .file = "node-fallbacks/path.js", .enable = opts.shouldEmbedCode() },
        .{ .file = "node-fallbacks/process.js", .enable = opts.shouldEmbedCode() },
        .{ .file = "node-fallbacks/punycode.js", .enable = opts.shouldEmbedCode() },
        .{ .file = "node-fallbacks/querystring.js", .enable = opts.shouldEmbedCode() },
        .{ .file = "node-fallbacks/stream.js", .enable = opts.shouldEmbedCode() },
        .{ .file = "node-fallbacks/string_decoder.js", .enable = opts.shouldEmbedCode() },
        .{ .file = "node-fallbacks/sys.js", .enable = opts.shouldEmbedCode() },
        .{ .file = "node-fallbacks/timers.js", .enable = opts.shouldEmbedCode() },
        .{ .file = "node-fallbacks/tty.js", .enable = opts.shouldEmbedCode() },
        .{ .file = "node-fallbacks/url.js", .enable = opts.shouldEmbedCode() },
        .{ .file = "node-fallbacks/util.js", .enable = opts.shouldEmbedCode() },
        .{ .file = "node-fallbacks/zlib.js", .enable = opts.shouldEmbedCode() },
    }) |entry| {
        if (!@hasField(@TypeOf(entry), "enable") or entry.enable) {
            const path = b.pathJoin(&.{ opts.codegen_path, entry.file });
            validateGeneratedPath(path);
            const import_path = if (@hasField(@TypeOf(entry), "import"))
                entry.import
            else
                entry.file;
            obj.root_module.addAnonymousImport(import_path, .{
                .root_source_file = .{ .cwd_relative = path },
            });
        }
    }

    if (os == .windows) {
        obj.root_module.addAnonymousImport("bun_shim_impl.exe", .{
            .root_source_file = opts.windowsShim(b).exe.getEmittedBin(),
        });
    }
}

fn validateGeneratedPath(path: []const u8) void {
    if (!exists(path)) {
        std.debug.panic(
            \\Generated file '{s}' is missing!
            \\
            \\Make sure to use CMake and Ninja, or pass a manual codegen folder with '-Dgenerated-code=...'
        , .{path});
    }
}

const WindowsShim = struct {
    exe: *Compile,
    dbg: *Compile,

    fn create(b: *Build) WindowsShim {
        const target = b.resolveTargetQuery(.{
            .cpu_model = .{ .explicit = &std.Target.x86.cpu.nehalem },
            .cpu_arch = .x86_64,
            .os_tag = .windows,
            .os_version_min = getOSVersionMin(.windows),
        });

        const path = b.path("src/install/windows-shim/bun_shim_impl.zig");

        const exe = b.addExecutable(.{
            .name = "bun_shim_impl",
            .root_source_file = path,
            .target = target,
            .optimize = .ReleaseFast,
            .use_llvm = true,
            .use_lld = true,
            .unwind_tables = false,
            .omit_frame_pointer = true,
            .strip = true,
            .linkage = .static,
            .sanitize_thread = false,
            .single_threaded = true,
            .link_libc = false,
        });

        const dbg = b.addExecutable(.{
            .name = "bun_shim_debug",
            .root_source_file = path,
            .target = target,
            .optimize = .Debug,
            .use_llvm = true,
            .use_lld = true,
            .linkage = .static,
            .single_threaded = true,
            .link_libc = false,
        });

        return .{ .exe = exe, .dbg = dbg };
    }
};
