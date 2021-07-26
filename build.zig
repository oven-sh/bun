const std = @import("std");
const resolve_path = @import("./src/resolver/resolve_path.zig");

pub fn addPicoHTTP(step: *std.build.LibExeObjStep) void {
    const picohttp = step.addPackage(.{
        .name = "picohttp",
        .path = .{ .path = "src/deps/picohttp.zig" },
    });

    step.addObjectFile("src/deps/picohttpparser.o");
    step.addIncludeDir("src/deps");
    // step.add("/Users/jarred/Code/WebKit/WebKitBuild/Release/lib/libWTF.a");

    // ./Tools/Scripts/build-jsc --jsc-only  --cmakeargs="-DENABLE_STATIC_JSC=ON"
    // set -gx ICU_INCLUDE_DIRS "/usr/local/opt/icu4c/include"
    // homebrew-provided icu4c
}

pub var original_make_fn: ?fn (step: *std.build.Step) anyerror!void = null;
pub var headers_zig_file: ?[]const u8 = null;
const HeadersMaker = struct {
    pub fn make(self: *std.build.Step) anyerror!void {
        try original_make_fn.?(self);
        var headers_zig: std.fs.File = try std.fs.openFileAbsolute(headers_zig_file.?, .{ .write = true });
        const contents = try headers_zig.readToEndAlloc(std.heap.page_allocator, 99999);
        const last_extern_i = std.mem.lastIndexOf(u8, contents, "pub extern fn") orelse @panic("Expected contents");
        const last_newline = std.mem.indexOf(u8, contents[last_extern_i..], "\n") orelse @panic("Expected newline");
        try headers_zig.seekTo(0);
        try headers_zig.setEndPos(last_newline + last_extern_i);
    }
};

pub fn build(b: *std.build.Builder) void {
    // Standard target options allows the person running `zig build` to choose
    // what target to build for. Here we do not override the defaults, which
    // means any target is allowed, and the default is native. Other options
    // for restricting supported target set are available.
    const target = b.standardTargetOptions(.{});
    // Standard release options allow the person running `zig build` to select
    // between Debug, ReleaseSafe, ReleaseFast, and ReleaseSmall.
    const mode = b.standardReleaseOptions();

    var cwd_buf: [std.fs.MAX_PATH_BYTES]u8 = undefined;
    const cwd: []const u8 = b.pathFromRoot(".");
    var exe: *std.build.LibExeObjStep = undefined;
    var output_dir_buf = std.mem.zeroes([4096]u8);
    var bin_label = if (mode == std.builtin.Mode.Debug) "/debug/" else "/";
    const output_dir = std.fmt.bufPrint(&output_dir_buf, "build{s}{s}-{s}", .{ bin_label, @tagName(target.getOs().tag), @tagName(target.getCpuArch()) }) catch unreachable;

    if (target.getOsTag() == .wasi) {
        exe.enable_wasmtime = true;
        exe = b.addExecutable("esdev", "src/main_wasi.zig");
        exe.linkage = .dynamic;
        exe.setOutputDir(output_dir);
    } else if (target.getCpuArch().isWasm()) {
        // exe = b.addExecutable(
        //     "esdev",
        //     "src/main_wasm.zig",
        // );
        // exe.is_linking_libc = false;
        // exe.is_dynamic = true;
        var lib = b.addExecutable("esdev", "src/main_wasm.zig");
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
        exe = b.addExecutable("esdev", "src/main.zig");
    }
    // exe.setLibCFile("libc.txt");
    exe.linkLibC();
    // exe.linkLibCpp();
    exe.addPackage(.{
        .name = "clap",
        .path = .{ .path = "src/deps/zig-clap/clap.zig" },
    });

    exe.setOutputDir(output_dir);

    var walker = std.fs.walkPath(b.allocator, cwd) catch unreachable;
    if (std.builtin.is_test) {
        while (walker.next() catch unreachable) |entry| {
            if (std.mem.endsWith(u8, entry.basename, "_test.zig")) {
                std.debug.print("[test] Added {s}", .{entry.basename});
                _ = b.addTest(entry.path);
            }
        }
    }

    const runtime_hash = std.hash.Wyhash.hash(0, @embedFile("./src/runtime.out.js"));
    const runtime_version_file = std.fs.cwd().openFile("src/runtime.version", .{ .write = true }) catch unreachable;
    runtime_version_file.writer().print("{x}", .{runtime_hash}) catch unreachable;
    defer runtime_version_file.close();

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

        var bindings_walker = std.fs.walkPath(b.allocator, bindings_dir) catch unreachable;
        var bindings_files = std.ArrayList([]const u8).init(b.allocator);

        while (bindings_walker.next() catch unreachable) |entry| {
            if (std.mem.eql(u8, std.fs.path.extension(entry.basename), ".o")) {
                bindings_files.append(b.allocator.dupe(u8, entry.path) catch unreachable) catch unreachable;
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
        const headers_step = b.step("headers", "JSC headers");
        var headers_exec: *std.build.LibExeObjStep = b.addExecutable("headers", "src/javascript/jsc/bindings/bindings-generator.zig");
        var headers_runner = headers_exec.run();
        headers_exec.setMainPkgPath(javascript.main_pkg_path.?);
        headers_step.dependOn(&headers_runner.step);
        var translate_c: *std.build.TranslateCStep = b.addTranslateC(.{ .path = b.pathFromRoot("src/javascript/jsc/bindings/headers.h") });
        translate_c.out_basename = "headers";
        translate_c.output_dir = b.pathFromRoot("src/javascript/jsc/bindings/");
        headers_step.dependOn(&translate_c.step);

        headers_zig_file = b.pathFromRoot("src/javascript/jsc/bindings/headers.zig");

        original_make_fn = headers_step.makeFn;
        headers_step.makeFn = HeadersMaker.make;
        b.default_step.dependOn(&exe.step);

        var steps = [_]*std.build.LibExeObjStep{ exe, javascript, typings_exe };

        for (steps) |step| {
            step.linkLibC();
            step.linkLibCpp();
            addPicoHTTP(
                step,
            );

            step.addObjectFile("src/JavaScript/jsc/WebKit/WebKitBuild/Release/lib/libJavaScriptCore.a");
            step.addObjectFile("src/JavaScript/jsc/WebKit/WebKitBuild/Release/lib/libWTF.a");
            step.addObjectFile("src/JavaScript/jsc/WebKit/WebKitBuild/Release/lib/libbmalloc.a");

            // We must link ICU statically
            step.addObjectFile("/usr/local/opt/icu4c/lib/libicudata.a");
            step.addObjectFile("/usr/local/opt/icu4c/lib/libicui18n.a");
            step.addObjectFile("/usr/local/opt/icu4c/lib/libicuuc.a");

            if (target.getOsTag() == .macos) {
                // icucore is a weird macOS only library
                step.linkSystemLibrary("icucore");
                step.addLibPath("/usr/local/opt/icu4c/lib");
                step.addIncludeDir("/usr/local/opt/icu4c/include");
            }

            // for (bindings_files.items) |binding| {
            //     step.addObjectFile(
            //         binding,
            //     );
            // }
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

    var log_step = b.addLog("Destination: {s}/{s}\n", .{ output_dir, "esdev" });
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
