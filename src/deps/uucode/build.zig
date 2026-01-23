pub fn build(b: *std.Build) void {
    const target = b.standardTargetOptions(.{});
    const optimize = b.standardOptimizeOption(.{});

    const fields = b.option(
        []const []const u8,
        "fields",
        "Fields to build into table for `get` (alias for `fields_0`)",
    );

    const fields_0 = b.option(
        []const []const u8,
        "fields_0",
        "Fields to build into table 0 for `get`",
    );

    const fields_1 = b.option(
        []const []const u8,
        "fields_1",
        "Fields to build into table 1 for `get`",
    );

    const fields_2 = b.option(
        []const []const u8,
        "fields_2",
        "Fields to build into table 2 for `get`",
    );

    const fields_3 = b.option(
        []const []const u8,
        "fields_3",
        "Fields to build into table 3 for `get`",
    );

    const fields_4 = b.option(
        []const []const u8,
        "fields_4",
        "Fields to build into table 4 for `get`",
    );

    const fields_5 = b.option(
        []const []const u8,
        "fields_5",
        "Fields to build into table 5 for `get`",
    );

    const fields_6 = b.option(
        []const []const u8,
        "fields_6",
        "Fields to build into table 6 for `get`",
    );

    const fields_7 = b.option(
        []const []const u8,
        "fields_7",
        "Fields to build into table 7 for `get`",
    );

    const fields_8 = b.option(
        []const []const u8,
        "fields_8",
        "Fields to build into table 8 for `get`",
    );

    const fields_9 = b.option(
        []const []const u8,
        "fields_9",
        "Fields to build into table 9 for `get`",
    );

    const extensions = b.option(
        []const []const u8,
        "extensions",
        "Extensions to build into table for `get` (alias for `extensions_0`)",
    );

    const extensions_0 = b.option(
        []const []const u8,
        "extensions_0",
        "Extensions to build into table 0 for `get`",
    );

    const extensions_1 = b.option(
        []const []const u8,
        "extensions_1",
        "Extensions to build into table 1 for `get`",
    );

    const extensions_2 = b.option(
        []const []const u8,
        "extensions_2",
        "Extensions to build into table 2 for `get`",
    );

    const extensions_3 = b.option(
        []const []const u8,
        "extensions_3",
        "Extensions to build into table 3 for `get`",
    );

    const extensions_4 = b.option(
        []const []const u8,
        "extensions_4",
        "Extensions to build into table 4 for `get`",
    );

    const extensions_5 = b.option(
        []const []const u8,
        "extensions_5",
        "Extensions to build into table 5 for `get`",
    );

    const extensions_6 = b.option(
        []const []const u8,
        "extensions_6",
        "Extensions to build into table 6 for `get`",
    );

    const extensions_7 = b.option(
        []const []const u8,
        "extensions_7",
        "Extensions to build into table 7 for `get`",
    );

    const extensions_8 = b.option(
        []const []const u8,
        "extensions_8",
        "Extensions to build into table 8 for `get`",
    );

    const extensions_9 = b.option(
        []const []const u8,
        "extensions_9",
        "Extensions to build into table 9 for `get`",
    );

    const build_log_level = b.option(
        std.log.Level,
        "build_log_level",
        "Log level to use when building tables",
    );

    const build_config_zig_opt = b.option(
        []const u8,
        "build_config.zig",
        "Build config source code",
    );

    const build_config_path_opt = b.option(
        std.Build.LazyPath,
        "build_config_path",
        "Path to uucode_build_config.zig file",
    );

    const tables_path_opt = b.option(
        std.Build.LazyPath,
        "tables_path",
        "Path to built tables source file",
    );

    const test_filters = b.option(
        []const []const u8,
        "test-filter",
        "Filter for test. Only applies to Zig tests.",
    ) orelse &[0][]const u8{};

    const build_config_path = build_config_path_opt orelse blk: {
        const build_config_zig = build_config_zig_opt orelse buildBuildConfig(
            b.allocator,
            fields orelse fields_0,
            fields_1,
            fields_2,
            fields_3,
            fields_4,
            fields_5,
            fields_6,
            fields_7,
            fields_8,
            fields_9,
            extensions orelse extensions_0,
            extensions_1,
            extensions_2,
            extensions_3,
            extensions_4,
            extensions_5,
            extensions_6,
            extensions_7,
            extensions_8,
            extensions_9,
            build_log_level,
        );

        break :blk b.addWriteFiles().add("build_config.zig", build_config_zig);
    };

    const mod = createLibMod(
        b,
        target,
        optimize,

        // There's a bug where building tables in ReleaseFast doesn't work,
        // that I'll be investigating in a follow up commit.
        .Debug,
        tables_path_opt,
        build_config_path,
    );

    // b.addModule with an existing module
    _ = b.modules.put(b.dupe("uucode"), mod.lib) catch @panic("OOM");
    b.addNamedLazyPath("tables.zig", mod.tables_path);

    const test_mod = createLibMod(
        b,
        target,
        optimize,

        // There's a bug where building tables in ReleaseFast doesn't work,
        // that I'll be investigating in a follow up commit.
        .Debug,
        null,
        b.path("src/build/test_build_config.zig"),
    );

    const src_tests = b.addTest(.{
        .root_module = test_mod.lib,
        .filters = test_filters,
    });

    const build_tables_tests = b.addTest(.{
        .root_module = test_mod.build_tables.?,
        .filters = test_filters,
    });

    const build_tests = b.addTest(.{
        .root_module = b.createModule(.{
            .root_source_file = b.path("build.zig"),
            .target = target,
            .optimize = optimize,
        }),
        .filters = test_filters,
    });

    const run_src_tests = b.addRunArtifact(src_tests);
    const run_build_tables_tests = b.addRunArtifact(build_tables_tests);
    const run_build_tests = b.addRunArtifact(build_tests);

    const test_step = b.step("test", "Run tests");
    test_step.dependOn(&run_src_tests.step);
    test_step.dependOn(&run_build_tables_tests.step);
    test_step.dependOn(&run_build_tests.step);
}

fn buildBuildConfig(
    allocator: std.mem.Allocator,
    fields_0: ?[]const []const u8,
    fields_1: ?[]const []const u8,
    fields_2: ?[]const []const u8,
    fields_3: ?[]const []const u8,
    fields_4: ?[]const []const u8,
    fields_5: ?[]const []const u8,
    fields_6: ?[]const []const u8,
    fields_7: ?[]const []const u8,
    fields_8: ?[]const []const u8,
    fields_9: ?[]const []const u8,
    extensions_0: ?[]const []const u8,
    extensions_1: ?[]const []const u8,
    extensions_2: ?[]const []const u8,
    extensions_3: ?[]const []const u8,
    extensions_4: ?[]const []const u8,
    extensions_5: ?[]const []const u8,
    extensions_6: ?[]const []const u8,
    extensions_7: ?[]const []const u8,
    extensions_8: ?[]const []const u8,
    extensions_9: ?[]const []const u8,
    build_log_level: ?std.log.Level,
) []const u8 {
    var bytes = std.Io.Writer.Allocating.init(allocator);
    defer bytes.deinit();
    const writer = &bytes.writer;

    if (fields_0 == null) {
        return bytes.toOwnedSlice() catch @panic("OOM");
    }

    writer.writeAll(
        \\const config = @import("./config.zig");
        \\const config_x = @import("./config.x.zig");
        \\const d = config.default;
        \\
        \\
    ) catch @panic("OOM");

    if (build_log_level) |level| {
        writer.print(
            \\pub const log_level = .{s};
            \\
            \\
        , .{@tagName(level)}) catch @panic("OOM");
    }

    writer.writeAll(
        \\pub const tables = [_]config.Table{
        \\
    ) catch @panic("OOM");

    const fields_lists = [_]?[]const []const u8{
        fields_0,
        fields_1,
        fields_2,
        fields_3,
        fields_4,
        fields_5,
        fields_6,
        fields_7,
        fields_8,
        fields_9,
    };

    const extensions_lists = [_]?[]const []const u8{
        extensions_0,
        extensions_1,
        extensions_2,
        extensions_3,
        extensions_4,
        extensions_5,
        extensions_6,
        extensions_7,
        extensions_8,
        extensions_9,
    };

    for (fields_lists, extensions_lists) |fields_opt, extensions_opt| {
        if (fields_opt) |fields| {
            writer.writeAll(
                \\    .{
                \\        .extensions = &.{
                \\
            ) catch @panic("OOM");

            if (extensions_opt) |extensions_list| {
                for (extensions_list) |ext| {
                    writer.print("            config_x.{s},\n", .{ext}) catch @panic("OOM");
                }
            }

            writer.writeAll(
                \\        },
                \\        .fields = &config._resolveFields(
                \\            config_x,
                \\            &.{
                \\
            ) catch @panic("OOM");

            for (fields) |f| {
                writer.print("                \"{s}\",\n", .{f}) catch @panic("OOM");
            }

            writer.writeAll(
                \\            },
                \\            &.{
                \\
            ) catch @panic("OOM");

            if (extensions_opt) |extensions_list| {
                for (extensions_list) |ext| {
                    writer.print("                \"{s}\",\n", .{ext}) catch @panic("OOM");
                }
            }

            writer.writeAll(
                \\            },
                \\        ),
                \\     },
                \\
            ) catch @panic("OOM");
        } else {
            break;
        }
    }

    writer.writeAll(
        \\};
        \\
    ) catch @panic("OOM");

    return bytes.toOwnedSlice() catch @panic("OOM");
}

fn buildTables(
    b: *std.Build,
    build_config_path: std.Build.LazyPath,
    build_tables_optimize: std.builtin.OptimizeMode,
) struct {
    build_tables: *std.Build.Module,
    tables: std.Build.LazyPath,
} {
    const target = b.graph.host;

    const config_mod = b.createModule(.{
        .root_source_file = b.path("src/config.zig"),
        .target = target,
        .optimize = build_tables_optimize,
    });

    const types_mod = b.createModule(.{
        .root_source_file = b.path("src/types.zig"),
        .target = target,
        .optimize = build_tables_optimize,
    });
    types_mod.addImport("config.zig", config_mod);
    config_mod.addImport("types.zig", types_mod);

    const config_x_mod = b.createModule(.{
        .root_source_file = b.path("src/x/config.x.zig"),
        .target = target,
        .optimize = build_tables_optimize,
    });

    const types_x_mod = b.createModule(.{
        .root_source_file = b.path("src/x/types.x.zig"),
        .target = target,
        .optimize = build_tables_optimize,
    });
    types_x_mod.addImport("config.x.zig", config_x_mod);
    config_x_mod.addImport("types.x.zig", types_x_mod);
    config_x_mod.addImport("types.zig", types_mod);
    config_x_mod.addImport("config.zig", config_mod);

    // Create build_config
    const build_config_mod = b.createModule(.{
        .root_source_file = build_config_path,
        .target = target,
        .optimize = build_tables_optimize,
    });
    build_config_mod.addImport("types.zig", types_mod);
    build_config_mod.addImport("config.zig", config_mod);
    build_config_mod.addImport("types.x.zig", types_x_mod);
    build_config_mod.addImport("config.x.zig", config_x_mod);

    // Generate tables.zig with build_config
    const build_tables_mod = b.createModule(.{
        .root_source_file = b.path("src/build/tables.zig"),
        .target = b.graph.host,
        .optimize = build_tables_optimize,
    });
    const build_tables_exe = b.addExecutable(.{
        .name = "uucode_build_tables",
        .root_module = build_tables_mod,

        // Zig's x86 backend is segfaulting, so we choose the LLVM backend always.
        .use_llvm = true,
    });
    build_tables_mod.addImport("config.zig", config_mod);
    build_tables_mod.addImport("build_config", build_config_mod);
    build_tables_mod.addImport("types.zig", types_mod);
    const run_build_tables_exe = b.addRunArtifact(build_tables_exe);
    run_build_tables_exe.setCwd(b.path(""));
    const tables_path = run_build_tables_exe.addOutputFileArg("tables.zig");

    return .{
        .tables = tables_path,
        .build_tables = build_tables_mod,
    };
}

fn createLibMod(
    b: *std.Build,
    target: std.Build.ResolvedTarget,
    optimize: std.builtin.OptimizeMode,
    build_tables_optimize: std.builtin.OptimizeMode,
    tables_path_opt: ?std.Build.LazyPath,
    build_config_path: std.Build.LazyPath,
) struct {
    lib: *std.Build.Module,
    build_tables: ?*std.Build.Module,
    tables_path: std.Build.LazyPath,
} {
    const config_mod = b.createModule(.{
        .root_source_file = b.path("src/config.zig"),
        .target = target,
        .optimize = optimize,
    });

    const types_mod = b.createModule(.{
        .root_source_file = b.path("src/types.zig"),
        .target = target,
        .optimize = optimize,
    });
    types_mod.addImport("config.zig", config_mod);
    config_mod.addImport("types.zig", types_mod);

    const config_x_mod = b.createModule(.{
        .root_source_file = b.path("src/x/config.x.zig"),
        .target = target,
        .optimize = optimize,
    });

    const types_x_mod = b.createModule(.{
        .root_source_file = b.path("src/x/types.x.zig"),
        .target = target,
        .optimize = optimize,
    });
    types_x_mod.addImport("config.x.zig", config_x_mod);
    config_x_mod.addImport("types.x.zig", types_x_mod);
    config_x_mod.addImport("types.zig", types_mod);
    config_x_mod.addImport("config.zig", config_mod);

    // TODO: expose this to see if importing can work?
    const build_config_mod = b.createModule(.{
        .root_source_file = build_config_path,
        .target = target,
    });
    build_config_mod.addImport("types.zig", types_mod);
    build_config_mod.addImport("config.zig", config_mod);
    build_config_mod.addImport("types.x.zig", types_x_mod);
    build_config_mod.addImport("config.x.zig", config_x_mod);

    var build_tables: ?*std.Build.Module = null;
    const tables_path = tables_path_opt orelse blk: {
        const t = buildTables(b, build_config_path, build_tables_optimize);
        build_tables = t.build_tables;
        break :blk t.tables;
    };

    const tables_mod = b.createModule(.{
        .root_source_file = tables_path,
        .target = target,
        .optimize = optimize,
    });
    tables_mod.addImport("types.zig", types_mod);
    tables_mod.addImport("types.x.zig", types_x_mod);
    tables_mod.addImport("config.zig", config_mod);
    tables_mod.addImport("build_config", build_config_mod);

    const get_mod = b.createModule(.{
        .root_source_file = b.path("src/get.zig"),
        .target = target,
        .optimize = optimize,
    });
    get_mod.addImport("types.zig", types_mod);
    get_mod.addImport("tables", tables_mod);
    types_mod.addImport("get.zig", get_mod);

    const lib_mod = b.createModule(.{
        .root_source_file = b.path("src/root.zig"),
        .target = target,
        .optimize = optimize,
    });

    lib_mod.addImport("types.zig", types_mod);
    lib_mod.addImport("config.zig", config_mod);
    lib_mod.addImport("types.x.zig", types_x_mod);
    lib_mod.addImport("tables", tables_mod);
    lib_mod.addImport("get.zig", get_mod);

    return .{
        .lib = lib_mod,
        .build_tables = build_tables,
        .tables_path = tables_path,
    };
}

test "simple build config with just fields/fields_0" {
    const build_config = buildBuildConfig(
        std.testing.allocator,
        &.{ "name", "is_emoji", "bidi_class" },
        null,
        null,
        null,
        null,
        null,
        null,
        null,
        null,
        null,
        null,
        null,
        null,
        null,
        null,
        null,
        null,
        null,
        null,
        null,
        .debug,
    );
    defer std.testing.allocator.free(build_config);

    errdefer std.debug.print("build_config: {s}", .{build_config});

    const expected =
        \\const config = @import("./config.zig");
        \\const config_x = @import("./config.x.zig");
        \\const d = config.default;
        \\
        \\pub const log_level = .debug;
        \\
        \\pub const tables = [_]config.Table{
        \\    .{
        \\        .extensions = &.{
        \\        },
        \\        .fields = &config._resolveFields(
        \\            config_x,
        \\            &.{
        \\                "name",
        \\                "is_emoji",
        \\                "bidi_class",
        \\            },
        \\            &.{
        \\            },
        \\        ),
        \\     },
        \\};
        \\
    ;

    try std.testing.expect(std.mem.eql(u8, build_config, expected));
}

test "complex build config with all fields_0 through fields_9 and extensions_0 through extensions_9" {
    const build_config = buildBuildConfig(
        std.testing.allocator,
        &.{ "name", "field_0a", "field_0b" },
        &.{ "general_category", "field_1" },
        &.{ "decomposition_type", "field_2a", "field_2b" },
        &.{ "numeric_type", "field_3" },
        &.{ "unicode_1_name", "field_4a", "field_4b" },
        &.{ "simple_lowercase_mapping", "field_5" },
        &.{ "case_folding_simple", "field_6" },
        &.{ "special_lowercase_mapping", "field_7a", "field_7b", "field_7c" },
        &.{ "lowercase_mapping", "field_8" },
        &.{ "uppercase_mapping", "field_9" },
        &.{ "ext_0a", "ext_0b" },
        &.{"ext_1"},
        &.{ "ext_2a", "ext_2b" },
        &.{"ext_3"},
        &.{ "ext_4a", "ext_4b", "ext_4c" },
        &.{"ext_5"},
        &.{"ext_6"},
        &.{ "ext_7a", "ext_7b" },
        &.{"ext_8"},
        &.{"ext_9"},
        .info,
    );
    defer std.testing.allocator.free(build_config);

    errdefer std.debug.print("build_config: {s}", .{build_config});

    const substrings = [_][]const u8{
        "pub const log_level = .info;",
        "Table{",
        "extensions",
        "config_x.ext_0a",
        "config_x.ext_0b",
        "name",
        "field_0a",
        "field_0b",
        "\"ext_0a\"",
        "\"ext_0b\"",
        "extensions",
        "config_x.ext_1",
        "general_category",
        "field_1",
        "\"ext_1\"",
        "extensions",
        "config_x.ext_2a",
        "config_x.ext_2b",
        "decomposition_type",
        "field_2a",
        "field_2b",
        "\"ext_2a\"",
        "\"ext_2b\"",
        "extensions",
        "config_x.ext_3",
        "numeric_type",
        "field_3",
        "\"ext_3\"",
        "extensions",
        "config_x.ext_4a",
        "config_x.ext_4b",
        "config_x.ext_4c",
        "unicode_1_name",
        "field_4a",
        "field_4b",
        "\"ext_4a\"",
        "\"ext_4b\"",
        "\"ext_4c\"",
        "extensions",
        "config_x.ext_5",
        "simple_lowercase_mapping",
        "field_5",
        "\"ext_5\"",
        "extensions",
        "config_x.ext_6",
        "case_folding_simple",
        "field_6",
        "\"ext_6\"",
        "extensions",
        "config_x.ext_7a",
        "config_x.ext_7b",
        "special_lowercase_mapping",
        "field_7a",
        "field_7b",
        "field_7c",
        "\"ext_7a\"",
        "\"ext_7b\"",
        "extensions",
        "config_x.ext_8",
        "lowercase_mapping",
        "field_8",
        "\"ext_8\"",
        "extensions",
        "config_x.ext_9",
        "uppercase_mapping",
        "field_9",
        "\"ext_9\"",
        "};",
    };

    var i: usize = 0;

    for (substrings) |substring| {
        const foundI = std.mem.indexOfPos(u8, build_config, i, substring);
        try std.testing.expect(foundI != null);
        try std.testing.expect(foundI.? > i);
        i = foundI.?;
    }
}

const std = @import("std");
