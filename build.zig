const std = @import("std");

pub fn addPicoHTTP(step: *std.build.LibExeObjStep, comptime dir: []const u8) void {
    step.addCSourceFile(dir ++ "/picohttpparser/picohttpparser.c", &[_][]const u8{});
    step.addIncludeDir(dir ++ "/picohttpparser");

    step.addPackage(.{
        .name = "picohttp",
        .path = dir ++ "/picohttp.zig",
    });
}

pub fn build(b: *std.build.Builder) void {
    // Standard target options allows the person running `zig build` to choose
    // what target to build for. Here we do not override the defaults, which
    // means any target is allowed, and the default is native. Other options
    // for restricting supported target set are available.
    const target = b.standardTargetOptions(.{});

    // Standard release options allow the person running `zig build` to select
    // between Debug, ReleaseSafe, ReleaseFast, and ReleaseSmall.
    const mode = b.standardReleaseOptions();

    var cwd_buf = [_]u8{0} ** 4096;
    var cwd = std.os.getcwd(&cwd_buf) catch unreachable;
    var exe: *std.build.LibExeObjStep = undefined;

    var output_dir_buf = std.mem.zeroes([4096]u8);
    var bin_label = if (mode == std.builtin.Mode.Debug) "/debug/" else "/";
    const output_dir = std.fmt.bufPrint(&output_dir_buf, "build{s}{s}-{s}", .{ bin_label, @tagName(target.getOs().tag), @tagName(target.getCpuArch()) }) catch unreachable;

    if (target.getOsTag() == .wasi) {
        exe.enable_wasmtime = true;
        exe = b.addExecutable("esdev", "src/main_wasi.zig");
        exe.is_dynamic = true;
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
        b.install_path = lib.getOutputPath();

        std.debug.print("Build: ./{s}\n", .{lib.getOutputPath()});
        b.default_step.dependOn(&lib.step);
        b.verbose_link = true;
        lib.setTarget(target);
        lib.setBuildMode(mode);

        std.fs.deleteTreeAbsolute(std.fs.path.join(std.heap.page_allocator, &.{ cwd, lib.getOutputPath() }) catch unreachable) catch {};
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
        exe.linkLibC();
    }

    exe.addPackage(.{
        .name = "clap",
        .path = "src/deps/zig-clap/clap.zig",
    });

    exe.setOutputDir(output_dir);
    std.debug.print("Build: ./{s}\n", .{exe.getOutputPath()});
    var walker = std.fs.walkPath(std.heap.page_allocator, cwd) catch unreachable;
    if (std.builtin.is_test) {
        while (walker.next() catch unreachable) |entry| {
            if (std.mem.endsWith(u8, entry.basename, "_test.zig")) {
                std.debug.print("[test] Added {s}", .{entry.basename});
                _ = b.addTest(entry.path);
            }
        }
    }
    exe.setTarget(target);
    exe.setBuildMode(mode);
    b.install_path = output_dir;

    if (!target.getCpuArch().isWasm()) {
        exe.addLibPath("/usr/local/lib");
        addPicoHTTP(exe, "src/deps");
    }

    exe.install();

    const run_cmd = exe.run();
    run_cmd.step.dependOn(b.getInstallStep());
    if (b.args) |args| {
        run_cmd.addArgs(args);
    }

    const run_step = b.step("run", "Run the app");
    run_step.dependOn(&run_cmd.step);
}
