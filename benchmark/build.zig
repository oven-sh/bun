const std = @import("std");

pub fn build(b: *std.Build) void {
    const target = b.standardTargetOptions(.{});
    const optimize = b.standardOptimizeOption(.{});

    const ziggit_dep = b.dependency("ziggit", .{
        .target = target,
        .optimize = optimize,
    });

    const exe = b.addExecutable(.{
        .name = "lib_bench",
        .root_module = b.createModule(.{
            .root_source_file = b.path("lib_bench.zig"),
            .target = target,
            .optimize = optimize,
            .imports = &.{
                .{ .name = "ziggit", .module = ziggit_dep.module("ziggit") },
            },
        }),
    });
    exe.linkLibC();
    exe.linkSystemLibrary("z");
    exe.linkSystemLibrary("deflate");
    b.installArtifact(exe);
}
