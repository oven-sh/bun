const std = @import("std");

pub fn build(b: *std.Build) void {
    const target = b.standardTargetOptions(.{
        .default_target = (std.zig.CrossTarget.parse(.{
            .arch_os_abi = "x86_64-windows-msvc",
        }) catch unreachable),
    });

    const exe = b.addExecutable(.{
        .name = "bun_shim_impl",
        .root_source_file = .{ .path = "bun_shim_impl.zig" },
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
        .root_source_file = .{ .path = "bun_shim_impl.zig" },
        .target = target,
        .optimize = .Debug,
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

    b.installArtifact(exe);
    b.installArtifact(dbg);
}
