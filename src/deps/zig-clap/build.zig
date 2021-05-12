const builtin = @import("builtin");
const std = @import("std");

const Builder = std.build.Builder;
const Mode = std.builtin.Mode;

pub fn build(b: *Builder) void {
    const mode = b.standardReleaseOptions();
    const target = b.standardTargetOptions(.{});

    const test_all_step = b.step("test", "Run all tests in all modes.");
    inline for ([_]Mode{ Mode.Debug, Mode.ReleaseFast, Mode.ReleaseSafe, Mode.ReleaseSmall }) |test_mode| {
        const mode_str = comptime modeToString(test_mode);

        const tests = b.addTest("clap.zig");
        tests.setBuildMode(test_mode);
        tests.setTarget(target);
        tests.setNamePrefix(mode_str ++ " ");

        const test_step = b.step("test-" ++ mode_str, "Run all tests in " ++ mode_str ++ ".");
        test_step.dependOn(&tests.step);
        test_all_step.dependOn(test_step);
    }

    const example_step = b.step("examples", "Build examples");
    inline for ([_][]const u8{
        "simple",
        "simple-ex",
        //"simple-error",
        "streaming-clap",
        "help",
        "usage",
    }) |example_name| {
        const example = b.addExecutable(example_name, "example/" ++ example_name ++ ".zig");
        example.addPackagePath("clap", "clap.zig");
        example.setBuildMode(mode);
        example.setTarget(target);
        example.install();
        example_step.dependOn(&example.step);
    }

    const all_step = b.step("all", "Build everything and runs all tests");
    all_step.dependOn(test_all_step);

    b.default_step.dependOn(all_step);
}

fn modeToString(mode: Mode) []const u8 {
    return switch (mode) {
        Mode.Debug => "debug",
        Mode.ReleaseFast => "release-fast",
        Mode.ReleaseSafe => "release-safe",
        Mode.ReleaseSmall => "release-small",
    };
}
