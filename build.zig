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

fn addInternalPackages(step: *std.build.LibExeObjStep, allocator: *std.mem.Allocator, target: anytype) !void {
    var boringssl: std.build.Pkg = .{
        .name = "boringssl",
        .path = pkgPath("src/deps/boringssl.zig"),
    };

    var thread_pool: std.build.Pkg = .{
        .name = "thread_pool",
        .path = pkgPath("src/thread_pool.zig"),
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

    var network_thread: std.build.Pkg = .{
        .name = "network_thread",
        .path = pkgPath("src/http/network_thread.zig"),
    };

    network_thread.dependencies = &.{
        io,
        thread_pool,
    };
    http.dependencies = &.{ io, network_thread, strings, boringssl, picohttp };

    thread_pool.dependencies = &.{ io, http };
    http.dependencies = &.{ io, network_thread, thread_pool, strings, boringssl, picohttp };

    step.addPackage(thread_pool);
    step.addPackage(picohttp);
    step.addPackage(io);
    step.addPackage(strings);
    step.addPackage(clap);
    step.addPackage(http);
    step.addPackage(network_thread);
}
var output_dir: []const u8 = "";
fn panicIfNotFound(comptime filepath: []const u8) []const u8 {
    var file = std.fs.cwd().openFile(filepath, .{ .read = true }) catch |err| {
        const linux_only = "\nOn Linux, you'll need to compile libiconv manually and copy the .a file into src/deps.";

        std.debug.panic("error: {s} opening {s}. Please ensure you've downloaded git submodules, and ran `make vendor`, `make jsc`." ++ linux_only, .{ filepath, @errorName(err) });
    };
    file.close();

    return filepath;
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

    var cwd_buf: [std.fs.MAX_PATH_BYTES]u8 = undefined;
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
            target.os_version_min = std.build.Target.OsVersion{ .semver = .{ .major = 11, .minor = 0, .patch = 0 } };
        } else if (arch.isX86()) {
            target.os_version_min = std.build.Target.OsVersion{ .semver = .{ .major = 10, .minor = 14, .patch = 0 } };
        }
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

    if (target.getOsTag() == .wasi) {
        exe.enable_wasmtime = true;
        exe = b.addExecutable(bun_executable_name, "src/main_wasi.zig");
        exe.linkage = .dynamic;
        exe.setOutputDir(output_dir);
    } else if (target.getCpuArch().isWasm()) {
        // exe = b.addExecutable(
        //     "bun",
        //     "src/main_wasm.zig",
        // );
        // exe.is_linking_libc = false;
        // exe.is_dynamic = true;
        var lib = b.addExecutable(bun_executable_name, "src/main_wasm.zig");
        lib.single_threaded = true;
        // exe.want_lto = true;
        // exe.linkLibrary(lib);

        if (mode == std.builtin.Mode.Debug) {
            // exception_handling
            var features = target.getCpuFeatures();
            features.addFeature(2);
            target.updateCpuFeatures(&features);
        } else {
            // lib.strip = true;
        }

        lib.setOutputDir(output_dir);
        lib.want_lto = true;
        b.install_path = lib.getOutputSource().getPath(b);

        std.debug.print("Build: ./{s}\n", .{b.install_path});
        b.default_step.dependOn(&lib.step);
        b.verbose_link = true;
        lib.setTarget(target);
        lib.setBuildMode(mode);

        std.fs.deleteTreeAbsolute(std.fs.path.join(b.allocator, &.{ cwd, lib.getOutputSource().getPath(b) }) catch unreachable) catch {};
        var install = b.getInstallStep();
        lib.strip = false;
        lib.install();

        const run_cmd = lib.run();
        run_cmd.step.dependOn(b.getInstallStep());
        if (b.args) |args| {
            run_cmd.addArgs(args);
        }

        const run_step = b.step("run", "Run the app");
        run_step.dependOn(&run_cmd.step);

        return;
    } else {
        exe = b.addExecutable(bun_executable_name, "src/main.zig");
    }
    // exe.setLibCFile("libc.txt");
    exe.linkLibC();
    // exe.linkLibCpp();

    exe.setOutputDir(output_dir);
    var cwd_dir = std.fs.cwd();
    var runtime_out_file = try std.fs.cwd().openFile("src/runtime.out.js", .{ .read = true });
    const runtime_hash = std.hash.Wyhash.hash(
        0,
        try runtime_out_file.readToEndAlloc(b.allocator, try runtime_out_file.getEndPos()),
    );
    const runtime_version_file = std.fs.cwd().createFile("src/runtime.version", .{ .truncate = true }) catch std.debug.panic("Failed to create src/runtime.version", .{});
    defer runtime_version_file.close();
    runtime_version_file.writer().print("{x}", .{runtime_hash}) catch unreachable;
    var fallback_out_file = try std.fs.cwd().openFile("src/fallback.out.js", .{ .read = true });
    const fallback_hash = std.hash.Wyhash.hash(
        0,
        try fallback_out_file.readToEndAlloc(b.allocator, try fallback_out_file.getEndPos()),
    );

    const fallback_version_file = std.fs.cwd().createFile("src/fallback.version", .{ .truncate = true }) catch std.debug.panic("Failed to create src/fallback.version", .{});

    fallback_version_file.writer().print("{x}", .{fallback_hash}) catch unreachable;

    defer fallback_version_file.close();

    exe.setTarget(target);
    exe.setBuildMode(mode);
    b.install_path = output_dir;

    var javascript = b.addExecutable("spjs", "src/main_javascript.zig");
    var typings_exe = b.addExecutable("typescript-decls", "src/javascript/jsc/typescript.zig");
    javascript.setMainPkgPath(b.pathFromRoot("."));
    typings_exe.setMainPkgPath(b.pathFromRoot("."));
    exe.setMainPkgPath(b.pathFromRoot("."));

    // exe.want_lto = true;
    if (!target.getCpuArch().isWasm()) {
        b.default_step.dependOn(&exe.step);

        const bindings_dir = std.fs.path.join(
            b.allocator,
            &.{
                cwd,
                "src",
                "javascript",
                "jsc",
                "bindings-obj",
            },
        ) catch unreachable;

        var bindings_dir_ = cwd_dir.openDir(bindings_dir, .{ .iterate = true }) catch std.debug.panic("Error opening bindings directory. Please make sure you ran `make jsc`. {s} should exist", .{bindings_dir});
        var bindings_walker = bindings_dir_.walk(b.allocator) catch std.debug.panic("Error reading bindings directory {s}", .{bindings_dir});

        var bindings_files = std.ArrayList([]const u8).init(b.allocator);

        while (bindings_walker.next() catch unreachable) |entry| {
            if (std.mem.eql(u8, std.fs.path.extension(entry.basename), ".o")) {
                bindings_files.append(bindings_dir_.realpathAlloc(b.allocator, entry.path) catch unreachable) catch unreachable;
            }
        }

        // // References:
        // // - https://github.com/mceSystems/node-jsc/blob/master/deps/jscshim/webkit.gyp
        // // - https://github.com/mceSystems/node-jsc/blob/master/deps/jscshim/docs/webkit_fork_and_compilation.md#webkit-port-and-compilation
        // const flags = [_][]const u8{
        //     "-Isrc/JavaScript/jsc/WebKit/WebKitBuild/Release/JavaScriptCore/PrivateHeaders",
        //     "-Isrc/JavaScript/jsc/WebKit/WebKitBuild/Release/WTF/Headers",
        //     "-Isrc/javascript/jsc/WebKit/WebKitBuild/Release/ICU/Headers",
        //     "-DSTATICALLY_LINKED_WITH_JavaScriptCore=1",
        //     "-DSTATICALLY_LINKED_WITH_WTF=1",
        //     "-DBUILDING_WITH_CMAKE=1",
        //     "-DNOMINMAX",
        //     "-DENABLE_INSPECTOR_ALTERNATE_DISPATCHERS=0",
        //     "-DBUILDING_JSCONLY__",
        //     "-DASSERT_ENABLED=0", // missing symbol errors like this will happen "JSC::DFG::DoesGCCheck::verifyCanGC(JSC::VM&)"
        //     "-Isrc/JavaScript/jsc/WebKit/WebKitBuild/Release/", // config.h,
        //     "-Isrc/JavaScript/jsc/bindings/",
        //     "-Isrc/javascript/jsc/WebKit/Source/bmalloc",
        //     "-std=gnu++17",
        //     if (target.getOsTag() == .macos) "-DUSE_FOUNDATION=1" else "",
        //     if (target.getOsTag() == .macos) "-DUSE_CF_RETAIN_PTR=1" else "",
        // };

        {
            b.default_step.dependOn(&b.addLog(
                "Build {s} v{} - v{}",
                .{
                    triplet,
                    target.getOsVersionMin().semver,
                    target.getOsVersionMax().semver,
                },
            ).step);
        }
        b.default_step.dependOn(&exe.step);

        {
            var steps = [_]*std.build.LibExeObjStep{ exe, javascript, typings_exe };

            // const single_threaded = b.option(bool, "single-threaded", "Build single-threaded") orelse false;

            for (steps) |step, i| {
                step.linkLibC();
                step.linkLibCpp();
                addPicoHTTP(
                    step,
                    true,
                );
                try addInternalPackages(step, b.allocator, target);

                step.addObjectFile(panicIfNotFound("src/deps/libJavaScriptCore.a"));
                step.addObjectFile(panicIfNotFound("src/deps/libWTF.a"));
                step.addObjectFile(panicIfNotFound("src/deps/libcrypto.a"));
                step.addObjectFile(panicIfNotFound("src/deps/libbmalloc.a"));
                step.addObjectFile(panicIfNotFound("src/deps/libarchive.a"));
                step.addObjectFile(panicIfNotFound("src/deps/zlib/libz.a"));
                step.addObjectFile(panicIfNotFound("src/deps/mimalloc/libmimalloc.a"));
                step.addLibPath("src/deps/mimalloc");
                step.addIncludeDir("src/deps/mimalloc");

                // step.single_threaded = single_threaded;

                if (target.getOsTag() == .macos) {
                    const homebrew_prefix = comptime if (std.Target.current.cpu.arch == .aarch64)
                        "/opt/homebrew/"
                    else
                        "/usr/local/";

                    // We must link ICU statically
                    step.addObjectFile(panicIfNotFound(homebrew_prefix ++ "opt/icu4c/lib/libicudata.a"));
                    step.addObjectFile(panicIfNotFound(homebrew_prefix ++ "opt/icu4c/lib/libicui18n.a"));
                    step.addObjectFile(panicIfNotFound(homebrew_prefix ++ "opt/icu4c/lib/libicuuc.a"));
                    step.addObjectFile(panicIfNotFound(homebrew_prefix ++ "opt/libiconv/lib/libiconv.a"));

                    // icucore is a weird macOS only library
                    step.linkSystemLibrary("icucore");
                    step.addLibPath(panicIfNotFound(homebrew_prefix ++ "opt/icu4c/lib"));
                    step.addIncludeDir(panicIfNotFound(homebrew_prefix ++ "opt/icu4c/include"));
                } else {
                    step.linkSystemLibrary("icuuc");
                    step.linkSystemLibrary("icudata");
                    step.linkSystemLibrary("icui18n");
                    step.addObjectFile(panicIfNotFound("src/deps/libiconv.a"));
                }

                for (bindings_files.items) |binding| {
                    step.addObjectFile(
                        binding,
                    );
                }
            }
        }

        {
            var obj_step = b.step("obj", "Build Bun as a .o file");
            var obj = b.addObject(bun_executable_name, exe.root_src.?.path);
            obj.setTarget(target);
            addPicoHTTP(obj, false);

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

            obj.strip = false;
            obj.bundle_compiler_rt = true;

            if (target.getOsTag() == .linux) {
                // obj.want_lto = tar;
                obj.link_emit_relocs = true;
                obj.link_function_sections = true;
            }
        }

        {
            const headers_step = b.step("headers-obj", "Build JavaScriptCore headers");
            var headers_obj: *std.build.LibExeObjStep = b.addObject("headers", "src/bindgen.zig");
            defer headers_step.dependOn(&headers_obj.step);
            try configureObjectStep(headers_obj, target, exe.main_pkg_path.?);
        }

        {
            const headers_step = b.step("httpbench-obj", "Build HTTPBench tool (object files)");
            var headers_obj: *std.build.LibExeObjStep = b.addObject("httpbench", "misctools/http_bench.zig");
            defer headers_step.dependOn(&headers_obj.step);
            try configureObjectStep(headers_obj, target, exe.main_pkg_path.?);
        }

        {
            const headers_step = b.step("fetch-obj", "Build fetch (object files)");
            var headers_obj: *std.build.LibExeObjStep = b.addObject("fetch", "misctools/fetch.zig");
            defer headers_step.dependOn(&headers_obj.step);
            try configureObjectStep(headers_obj, target, exe.main_pkg_path.?);
        }

        {
            const headers_step = b.step("tgz-obj", "Build tgz (object files)");
            var headers_obj: *std.build.LibExeObjStep = b.addObject("tgz", "misctools/tgz.zig");
            defer headers_step.dependOn(&headers_obj.step);
            try configureObjectStep(headers_obj, target, exe.main_pkg_path.?);
        }
    } else {
        b.default_step.dependOn(&exe.step);
    }

    javascript.strip = false;
    javascript.packages = std.ArrayList(std.build.Pkg).fromOwnedSlice(b.allocator, b.allocator.dupe(std.build.Pkg, exe.packages.items) catch unreachable);

    javascript.setOutputDir(output_dir);
    javascript.setBuildMode(mode);

    const run_cmd = exe.run();
    run_cmd.step.dependOn(b.getInstallStep());
    if (b.args) |args| {
        run_cmd.addArgs(args);
    }

    const run_step = b.step("run", "Run the app");
    run_step.dependOn(&run_cmd.step);

    var log_step = b.addLog("Destination: {s}/{s}\n", .{ output_dir, bun_executable_name });
    log_step.step.dependOn(&exe.step);

    var typings_cmd: *std.build.RunStep = typings_exe.run();
    typings_cmd.cwd = cwd;
    typings_cmd.addArg(cwd);
    typings_cmd.addArg("types");
    typings_cmd.step.dependOn(&typings_exe.step);

    typings_exe.linkLibC();

    typings_exe.linkLibCpp();
    typings_exe.setMainPkgPath(cwd);

    var typings_step = b.step("types", "Build TypeScript types");
    typings_step.dependOn(&typings_cmd.step);

    var javascript_cmd = b.step("spjs", "Build standalone JavaScript runtime. Must run \"make jsc\" first.");
    javascript_cmd.dependOn(&javascript.step);
}

pub var original_make_fn: ?fn (step: *std.build.Step) anyerror!void = null;

pub fn configureObjectStep(obj: *std.build.LibExeObjStep, target: anytype, main_pkg_path: []const u8) !void {
    obj.setMainPkgPath(main_pkg_path);
    obj.setTarget(target);

    try addInternalPackages(obj, std.heap.page_allocator, target);
    addPicoHTTP(obj, false);

    obj.setOutputDir(output_dir);
    obj.setBuildMode(mode);
    obj.linkLibC();
    obj.linkLibCpp();
    obj.bundle_compiler_rt = true;

    if (target.getOsTag() == .linux) {
        // obj.want_lto = tar;
        obj.link_emit_relocs = true;
        obj.link_function_sections = true;
    }
}
