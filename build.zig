const std = @import("std");

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
    if (target.getOsTag() == .wasi) {
        exe.enable_wasmtime = true;
        exe = b.addExecutable("esdev", "src/main_wasi.zig");
    } else if (target.getCpuArch().isWasm()) {
        exe = b.addExecutable("esdev", "src/main_wasm.zig");

        if (mode == std.builtin.Mode.Debug) {
            exe.setOutputDir("build/wasm/debug");
        } else {
            exe.setOutputDir("build/wasm");
        }
    } else {
        exe = b.addExecutable("esdev", "src/main.zig");
        exe.linkLibC();
    }

    if (mode == std.builtin.Mode.Debug) {
        exe.setOutputDir("build/bin/debug");
    } else {
        exe.setOutputDir("build/bin");
    }

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

    std.fs.deleteTreeAbsolute(exe.getOutputPath()) catch unreachable;

    exe.addLibPath("/usr/local/lib");
    exe.install();

    const run_cmd = exe.run();
    run_cmd.step.dependOn(b.getInstallStep());
    if (b.args) |args| {
        run_cmd.addArgs(args);
    }

    const run_step = b.step("run", "Run the app");
    run_step.dependOn(&run_cmd.step);
}
