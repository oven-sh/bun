const std = @import("std");

pub fn build(b: *std.Build) void {
    const target = b.standardTargetOptions(.{});
    const optimize = b.standardOptimizeOption(.{});

    // Reference ziggit as a dependency from the local path
    const ziggit_dep = b.dependency("ziggit", .{
        .target = target,
        .optimize = optimize,
    });

    const ziggit_module = ziggit_dep.module("ziggit");

    // git_vs_ziggit benchmark (non-default, use "run" step)
    const bench = b.addExecutable(.{
        .name = "git_vs_ziggit",
        .root_source_file = b.path("git_vs_ziggit.zig"),
        .target = target,
        .optimize = optimize,
    });
    bench.root_module.addImport("ziggit", ziggit_module);

    const install_bench = b.addInstallArtifact(bench, .{});

    const run_cmd = b.addRunArtifact(bench);
    run_cmd.step.dependOn(&install_bench.step);
    if (b.args) |args| {
        run_cmd.addArgs(args);
    }
    const run_step = b.step("run", "Run the git_vs_ziggit benchmark");
    run_step.dependOn(&run_cmd.step);

    // findCommit benchmark (default install target)
    const fc_bench = b.addExecutable(.{
        .name = "findcommit_bench",
        .root_source_file = b.path("findcommit_bench.zig"),
        .target = target,
        .optimize = optimize,
    });
    fc_bench.root_module.addImport("ziggit", ziggit_module);
    b.installArtifact(fc_bench);

    const fc_run = b.addRunArtifact(fc_bench);
    fc_run.step.dependOn(b.getInstallStep());
    if (b.args) |args| {
        fc_run.addArgs(args);
    }
    const fc_step = b.step("findcommit", "Run findCommit benchmark");
    fc_step.dependOn(&fc_run.step);
}
