const std = @import("std");
const resolve_path = @import("./src/resolver/resolve_path.zig");

pub fn addPicoHTTP(step: *std.build.LibExeObjStep) void {
    step.addPackagePath("picohttp", "src/deps/picohttp.zig");
    step.addIncludeDir("src/deps");
    step.addCSourceFile("src/deps/picohttpparser.c", &.{});
}

pub fn addMimalloc(step: *std.build.LibExeObjStep) void {
    step.addIncludeDir("src/deps/mimalloc/include");
    step.addCSourceFiles(&.{
        "src/deps/mimalloc/src/stats.c",
        "src/deps/mimalloc/src/random.c",
        "src/deps/mimalloc/src/os.c",
        "src/deps/mimalloc/src/bitmap.c",
        "src/deps/mimalloc/src/arena.c",
        "src/deps/mimalloc/src/region.c",
        "src/deps/mimalloc/src/segment.c",
        "src/deps/mimalloc/src/page.c",
        "src/deps/mimalloc/src/alloc.c",
        "src/deps/mimalloc/src/alloc-aligned.c",
        "src/deps/mimalloc/src/alloc-posix.c",
        "src/deps/mimalloc/src/heap.c",
        "src/deps/mimalloc/src/options.c",
        "src/deps/mimalloc/src/init.c",
    }, &.{});
}

fn panicIfNotFound(comptime filepath: []const u8) []const u8 {
    var file = std.fs.cwd().openFile(filepath, .{ .read = true }) catch |err| {
        const linux_only = "\nOn Linux, you'll need to compile libiconv manually and copy the .a file into src/deps.";

        std.debug.panic("error: {s} opening {s}. Please ensure you've downloaded git submodules, and ran `make vendor`, `make jsc`." ++ linux_only, .{ filepath, @errorName(err) });
    };
    file.close();

    return filepath;
}

const x64 = "x64";

pub fn build(b: *std.build.Builder) !void {
    var target = b.standardTargetOptions(.{});
    const mode = b.standardReleaseOptions();

    const cwd: []const u8 = b.pathFromRoot(".");
    var exe: *std.build.LibExeObjStep = undefined;
    var output_dir_buf = std.mem.zeroes([4096]u8);
    const bin_label = if (mode == std.builtin.Mode.Debug) "packages/debug-bun-" else "packages/bun-";

    const cpu_arch: std.Target.Cpu.Arch = target.getCpuArch();

    var os_tag_name = @tagName(target.getOs().tag);
    if (std.mem.eql(u8, os_tag_name, "macos")) {
        os_tag_name = "darwin";
        if (cpu_arch.isAARCH64()) {
            target.os_version_min = std.build.Target.OsVersion{ .semver = .{ .major = 11, .minor = 0, .patch = 0 } };
        } else if (cpu_arch.isX86()) {
            target.os_version_min = std.build.Target.OsVersion{ .semver = .{ .major = 10, .minor = 14, .patch = 0 } };
        }
    }

    var triplet_buf: [64]u8 = undefined;
    std.mem.copy(u8, &triplet_buf, os_tag_name);
    const os_name = triplet_buf[0..os_tag_name.len];
    triplet_buf[os_name.len] = '-';

    std.mem.copy(u8, triplet_buf[os_name.len + 1 ..], @tagName(target.getCpuArch()));
    var cpu_arch_name = triplet_buf[os_name.len + 1 ..][0..@tagName(target.getCpuArch()).len];
    std.mem.replaceScalar(u8, cpu_arch_name, '_', '-');
    if (std.mem.eql(u8, cpu_arch_name, "x86-64")) {
        std.mem.copy(u8, cpu_arch_name, "x64");
        cpu_arch_name = cpu_arch_name[0..3];
    }

    const triplet = triplet_buf[0 .. os_name.len + cpu_arch_name.len + 1];

    const output_dir_base = try std.fmt.bufPrint(&output_dir_buf, "{s}{s}", .{ bin_label, triplet });
    const output_dir = b.pathFromRoot(output_dir_base);
    const bun_executable_name = if (mode == std.builtin.Mode.Debug) "bun-debug" else "bun";

    if (target.getOsTag() == .wasi) {
        exe.enable_wasmtime = true;
        exe = b.addExecutable(bun_executable_name, "src/main_wasi.zig");
        exe.linkage = .dynamic;
        exe.setOutputDir(output_dir);
    } else if (target.getCpuArch().isWasm()) {
        const lib = b.addExecutable(bun_executable_name, "src/main_wasm.zig");
        lib.single_threaded = true;
        // exe.want_lto = true;
        // exe.linkLibrary(lib);

        if (mode == std.builtin.Mode.Debug) {
            // exception_handling
            target.cpu_features_add.addFeature(2);
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

    exe.linkLibC();
    exe.addPackagePath("clap", "src/deps/zig-clap/clap.zig");

    exe.setOutputDir(output_dir);

    const cwd_dir = std.fs.cwd();

    const runtime_hash = read: {
        const runtime_out_file = try cwd_dir.openFile("src/runtime.out.js", .{ .read = true });
        defer runtime_out_file.close();
        break :read std.hash.Wyhash.hash(0, try runtime_out_file.readToEndAlloc(b.allocator, try runtime_out_file.getEndPos()));
    };

    const runtime_version_file = cwd_dir.createFile("src/runtime.version", .{ .truncate = true }) catch std.debug.panic("Failed to create src/runtime.version", .{});
    defer runtime_version_file.close();
    runtime_version_file.writer().print("{x}", .{runtime_hash}) catch unreachable;

    const fallback_hash = read: {
        const fallback_out_file = try cwd_dir.openFile("src/fallback.out.js", .{ .read = true });
        defer fallback_out_file.close();
        break :read std.hash.Wyhash.hash(0, try fallback_out_file.readToEndAlloc(b.allocator, try fallback_out_file.getEndPos()));
    };

    const fallback_version_file = cwd_dir.createFile("src/fallback.version", .{ .truncate = true }) catch std.debug.panic("Failed to create src/fallback.version", .{});
    defer fallback_version_file.close();

    fallback_version_file.writer().print("{x}", .{fallback_hash}) catch unreachable;

    exe.setTarget(target);
    exe.setBuildMode(mode);
    b.install_path = output_dir;

    const javascript = b.addExecutable("spjs", "src/main_javascript.zig");
    const typings_exe = b.addExecutable("typescript-decls", "src/javascript/jsc/typescript.zig");

    exe.setMainPkgPath(b.pathFromRoot("."));
    javascript.setMainPkgPath(b.pathFromRoot("."));
    typings_exe.setMainPkgPath(b.pathFromRoot("."));

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
        const headers_step = b.step("headers-obj", "JSC headers Step #1");
        var headers_obj: *std.build.LibExeObjStep = b.addObject("headers", "src/javascript/jsc/bindings/bindings-generator.zig");
        headers_obj.setMainPkgPath(javascript.main_pkg_path.?);
        headers_step.dependOn(&headers_obj.step);

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
            const steps = [_]*std.build.LibExeObjStep{ exe, javascript, typings_exe };

            // const single_threaded = b.option(bool, "single-threaded", "Build single-threaded") orelse false;

            for (steps) |step| {
                step.linkLibC();
                step.linkLibCpp();
                addPicoHTTP(step);
                addMimalloc(step);

                step.addObjectFile(panicIfNotFound("src/deps/libJavaScriptCore.a"));
                step.addObjectFile(panicIfNotFound("src/deps/libWTF.a"));
                step.addObjectFile(panicIfNotFound("src/deps/libcrypto.a"));
                step.addObjectFile(panicIfNotFound("src/deps/libbmalloc.a"));
                step.addObjectFile(panicIfNotFound("src/deps/libarchive.a"));
                step.addObjectFile(panicIfNotFound("src/deps/libs2n.a"));
                step.addObjectFile(panicIfNotFound("src/deps/zlib/libz.a"));

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
            obj.setBuildMode(mode);

            addPicoHTTP(obj);
            obj.addPackagePath("clap", "src/deps/zig-clap/clap.zig");

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
            headers_obj.setTarget(target);
            headers_obj.addPackagePath("clap", "src/deps/zig-clap/clap.zig");

            headers_obj.setOutputDir(output_dir);
            headers_obj.setBuildMode(mode);
            headers_obj.linkLibC();
            headers_obj.linkLibCpp();
            headers_obj.bundle_compiler_rt = true;

            if (target.getOsTag() == .linux) {
                // obj.want_lto = tar;
                headers_obj.link_emit_relocs = true;
                headers_obj.link_function_sections = true;
            }
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
