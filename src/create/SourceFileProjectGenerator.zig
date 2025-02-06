// Generate project files based on the entry point and dependencies
pub fn generate(_: Command.Context, example_tag: Example.Tag, entry_point: string, result: *BundleV2.DependenciesScanner.Result) !void {
    // Check if Tailwind is already in dependencies
    const has_tailwind_in_dependencies = result.dependencies.contains("tailwindcss") or result.dependencies.contains("bun-plugin-tailwind");
    var needs_to_inject_tailwind = false;
    if (!has_tailwind_in_dependencies) {
        // Scan source files for Tailwind classes if not already in dependencies
        needs_to_inject_tailwind = hasAnyTailwindClassesInSourceFiles(result.bundle_v2, result.reachable_files);
    }

    // Get any shadcn components used in the project
    const shadcn = if (enable_shadcn_ui) try getShadcnComponents(result.bundle_v2, result.reachable_files) else bun.StringSet.init(default_allocator);
    const needs_to_inject_shadcn_ui = shadcn.keys().len > 0;

    // Add Tailwind dependencies if needed
    if (needs_to_inject_tailwind) {
        try result.dependencies.insert("tailwindcss");
        try result.dependencies.insert("bun-plugin-tailwind");
    }

    // Add shadcn-ui dependencies if needed
    if (needs_to_inject_shadcn_ui) {
        // https://ui.shadcn.com/docs/installation/manual
        // This will probably be tricky to keep updated.
        // but hopefully the dependency scanning will just handle it for us.
        try result.dependencies.insert("tailwindcss-animate");
        try result.dependencies.insert("class-variance-authority");
        try result.dependencies.insert("clsx");
        try result.dependencies.insert("tailwind-merge");
        try result.dependencies.insert("lucide-react");
    }

    const uses_tailwind = has_tailwind_in_dependencies or needs_to_inject_tailwind;
    // Add react-dom if react is used
    if (result.dependencies.contains("react")) {
        try result.dependencies.insert("react-dom");
    }

    // Choose template based on dependencies and example type
    const template: Template = brk: {
        if (needs_to_inject_shadcn_ui and example_tag == .jslike_file) {
            break :brk .{ .ReactShadcnSpa = .{ .components = shadcn } };
        } else if (uses_tailwind and example_tag == .jslike_file) {
            break :brk .ReactTailwindSpa;
        } else {
            Global.exit(0);
        }
    };

    // Generate project files from template
    try generateFiles(default_allocator, entry_point, result, template);

    Global.exit(0);
}

// Create a file with given contents, returns if file was newly created
fn createFile(filename: []const u8, contents: []const u8) bun.JSC.Maybe(bool) {
    // Check if file exists and has same contents
    if (bun.sys.File.readFrom(bun.toFD(std.fs.cwd()), filename, default_allocator).asValue()) |source_contents| {
        defer default_allocator.free(source_contents);
        if (strings.eqlLong(source_contents, contents, true)) {
            return .{ .result = false };
        }
    }

    // Create parent directories if needed
    if (std.fs.path.dirname(filename)) |dirname| {
        bun.makePath(std.fs.cwd(), dirname) catch {};
    }

    // Open file for writing
    const fd = switch (bun.sys.openatA(bun.toFD(std.fs.cwd()), filename, bun.O.WRONLY | bun.O.CREAT | bun.O.TRUNC, 0o644)) {
        .result => |fd| fd,
        .err => |err| return .{ .err = err },
    };
    defer _ = bun.sys.close(fd);

    // Write contents
    switch (bun.sys.File.writeAll(.{ .handle = fd }, contents)) {
        .result => return .{ .result = true },
        .err => |err| return .{ .err = err },
    }
}

// Count number of occurrences to calculate buffer size
fn countReplaceAllOccurrences(input: []const u8, needle: []const u8, replacement: []const u8) usize {
    var remaining = input;
    var count: usize = 0;
    while (remaining.len > 0) {
        if (std.mem.indexOf(u8, remaining, needle)) |index| {
            remaining = remaining[index + needle.len ..];
            count += 1;
        } else {
            break;
        }
    }

    return input.len + (count * (replacement.len -| needle.len));
}

// Replace all occurrences of needle with replacement
fn replaceAllOccurrencesOfString(allocator: std.mem.Allocator, input: []const u8, needle: []const u8, replacement: []const u8) ![]u8 {
    var result = try std.ArrayList(u8).initCapacity(allocator, countReplaceAllOccurrences(input, needle, replacement));
    var remaining = input;
    while (remaining.len > 0) {
        if (std.mem.indexOf(u8, remaining, needle)) |index| {
            const new_remaining = remaining[index + needle.len ..];
            try result.appendSlice(remaining[0..index]);
            try result.appendSlice(replacement);
            remaining = new_remaining;
        } else {
            try result.appendSlice(remaining);
            break;
        }
    }

    return result.items;
}

// Replace template placeholders with actual values
fn stringWithReplacements(input: []const u8, basename: []const u8, relative_name: []const u8, allocator: std.mem.Allocator) ![]u8 {
    if (strings.contains(input, "REPLACE_ME_WITH_YOUR_APP_BASE_NAME")) {
        return try replaceAllOccurrencesOfString(allocator, input, "REPLACE_ME_WITH_YOUR_APP_BASE_NAME", basename);
    }

    return try replaceAllOccurrencesOfString(allocator, input, "REPLACE_ME_WITH_YOUR_APP_FILE_NAME", relative_name);
}

// Template for React + Shadcn project
const ReactShadcnSpa = struct {
    pub const files = .{
        .@"lib/utils.ts" = @embedFile("projects/react-shadcn-spa/lib/utils.ts"),
        .@"src/index.css" = @embedFile("projects/react-shadcn-spa/styles/index.css"),
        .@"REPLACE_ME_WITH_YOUR_APP_FILE_NAME.build.ts" = @embedFile("projects/react-shadcn-spa/REPLACE_ME_WITH_YOUR_APP_FILE_NAME.build.ts"),
        .@"REPLACE_ME_WITH_YOUR_APP_FILE_NAME.client.tsx" = @embedFile("projects/react-shadcn-spa/REPLACE_ME_WITH_YOUR_APP_FILE_NAME.client.tsx"),
        .@"REPLACE_ME_WITH_YOUR_APP_FILE_NAME.css" = @embedFile("projects/react-shadcn-spa/REPLACE_ME_WITH_YOUR_APP_FILE_NAME.css"),
        .@"REPLACE_ME_WITH_YOUR_APP_FILE_NAME.html" = @embedFile("projects/react-shadcn-spa/REPLACE_ME_WITH_YOUR_APP_FILE_NAME.html"),
        .@"styles/globals.css" = @embedFile("projects/react-shadcn-spa/styles/globals.css"),
    };

    pub const bunfig = @embedFile("projects/react-shadcn-spa/bunfig.toml");
    pub const package_json = @embedFile("projects/react-shadcn-spa/package.json");
    pub const tailwind_config = @embedFile("projects/react-shadcn-spa/tailwind.config.js");
    pub const tsconfig = @embedFile("projects/react-shadcn-spa/tsconfig.json");
    pub const components_json = @embedFile("projects/react-shadcn-spa/components.json");
};

// Template for React + Tailwind project
const ReactTailwindSpa = struct {
    pub const files = .{
        .@"REPLACE_ME_WITH_YOUR_APP_FILE_NAME.build.ts" = @embedFile("projects/react-tailwind-spa/REPLACE_ME_WITH_YOUR_APP_FILE_NAME.build.ts"),
        .@"REPLACE_ME_WITH_YOUR_APP_FILE_NAME.css" = @embedFile("projects/react-tailwind-spa/REPLACE_ME_WITH_YOUR_APP_FILE_NAME.css"),
        .@"REPLACE_ME_WITH_YOUR_APP_FILE_NAME.html" = @embedFile("projects/react-tailwind-spa/REPLACE_ME_WITH_YOUR_APP_FILE_NAME.html"),
        .@"REPLACE_ME_WITH_YOUR_APP_FILE_NAME.client.tsx" = @embedFile("projects/react-tailwind-spa/REPLACE_ME_WITH_YOUR_APP_FILE_NAME.client.tsx"),
    };

    pub const bunfig = @embedFile("projects/react-tailwind-spa/bunfig.toml");
    pub const package_json = @embedFile("projects/react-tailwind-spa/package.json");
    pub const tailwind_config = "";
    pub const tsconfig = "";
    pub const components_json = "";
};

// Template type to handle different project types
const Template = union(Tag) {
    ReactTailwindSpa: void,
    ReactShadcnSpa: struct {
        components: bun.StringSet,
    },

    pub const Tag = enum {
        ReactTailwindSpa,
        ReactShadcnSpa,
    };
};

const SourceFileProjectGenerator = @This();

// Generate all project files from template
fn generateFiles(allocator: std.mem.Allocator, entry_point: string, result: *BundleV2.DependenciesScanner.Result, template: Template) !void {
    var is_new = false;
    var basename = std.fs.path.basename(entry_point);
    const extension = std.fs.path.extension(basename);
    if (extension.len > 0) {
        basename = basename[0 .. basename.len - extension.len];
    }

    // Normalize file paths
    var normalized_buf: bun.PathBuffer = undefined;
    var normalized_name: []const u8 = if (std.fs.path.isAbsolute(entry_point))
        bun.path.relativeNormalizedBuf(&normalized_buf, bun.fs.FileSystem.instance.top_level_dir, entry_point, .posix, true)
    else
        bun.path.normalizeBuf(entry_point, &normalized_buf, .posix);

    if (extension.len > 0) {
        normalized_name = normalized_name[0 .. normalized_name.len - extension.len];
    }

    // Generate files based on template type
    switch (@as(Template.Tag, template)) {
        inline else => |active| {
            const current = @field(SourceFileProjectGenerator, @tagName(active));

            // Create tailwind config if needed
            if (current.tailwind_config.len > 0) {
                if (!bun.sys.exists("tailwind.config.js")) {
                    switch (createFile("tailwind.config.js", current.tailwind_config)) {
                        .result => |new| {
                            if (new) {
                                is_new = true;
                                Output.prettyln("<r> <green>✓<r> tailwind.config.js created\n", .{});
                            }
                        },
                        .err => |err| {
                            Output.err(err, "failed to create tailwind.config.js", .{});
                            Global.crash();
                        },
                    }
                }
            }

            // Create components.json if needed
            if (current.components_json.len > 0) {
                if (!bun.sys.exists("components.json")) {
                    switch (createFile("components.json", current.components_json)) {
                        .result => |new| {
                            if (new) {
                                is_new = true;
                                Output.prettyln("<r> <green>✓<r> components.json created\n", .{});
                            }
                        },
                        .err => |err| {
                            Output.err(err, "failed to create components.json", .{});
                            Global.crash();
                        },
                    }
                }
            }

            // Create package.json if needed
            if (!bun.sys.exists("package.json")) {
                switch (createFile("package.json", current.package_json)) {
                    .result => |new| {
                        if (new) {
                            is_new = true;
                            Output.prettyln("<r> <green>✓<r> package.json created\n", .{});
                        }
                    },
                    .err => |err| {
                        Output.err(err, "failed to create package.json", .{});
                        Global.crash();
                    },
                }
            }

            // Create tsconfig.json if needed
            if (!bun.sys.exists("tsconfig.json")) {
                switch (createFile("tsconfig.json", current.tsconfig)) {
                    .result => |new| {
                        if (new) {
                            is_new = true;
                            Output.prettyln("<r> <green>✓<r> tsconfig.json created\n", .{});
                        }
                    },
                    .err => |err| {
                        Output.err(err, "failed to create tsconfig.json", .{});
                        Global.crash();
                    },
                }
            }

            // Create bunfig.toml if needed
            if (!bun.sys.exists("bunfig.toml")) {
                switch (createFile("bunfig.toml", current.bunfig)) {
                    .result => |new| {
                        if (new) {
                            is_new = true;
                            Output.prettyln("<r> <green>✓<r> bunfig.toml created\n", .{});
                        }
                    },
                    .err => |err| {
                        Output.err(err, "failed to create bunfig.toml", .{});
                        Global.crash();
                    },
                }
            }

            // Create all template files
            inline for (comptime std.meta.fieldNames(@TypeOf(current.files))) |name| {
                const file_name = try stringWithReplacements(name, basename, normalized_name, allocator);
                switch (createFile(file_name, try stringWithReplacements(@field(current.files, name), basename, normalized_name, default_allocator))) {
                    .result => |new| {
                        if (new) {
                            is_new = true;
                            Output.prettyln("<r> <green>✓<r> {s} created\n", .{file_name});
                        }
                    },
                    .err => |err| {
                        Output.err(err, "failed to create {s}", .{file_name});
                        Global.crash();
                    },
                }
            }
        },
    }

    // We leak all these, but it's pretty much fine.

    // Install dependencies
    var argv = std.ArrayList([]const u8).init(default_allocator);
    try argv.append(try bun.selfExePath());
    try argv.append("--only-missing");
    try argv.append("install");
    try argv.appendSlice(result.dependencies.keys());

    const process = bun.spawnSync(&.{
        .argv = argv.items,
        .envp = null,
        .cwd = bun.fs.FileSystem.instance.top_level_dir,
        .stderr = .inherit,
        .stdout = .inherit,
        .stdin = .inherit,

        .windows = if (Environment.isWindows) .{
            .loop = bun.JSC.EventLoopHandle.init(bun.JSC.MiniEventLoop.initGlobal(null)),
        },
    }) catch |err| {
        Output.err(err, "failed to install dependencies", .{});
        Global.crash();
    };

    switch (process) {
        .err => |err| {
            Output.err(err, "failed to install dependencies", .{});
            Global.crash();
        },
        .result => |spawn_result| {
            if (!spawn_result.status.isOK()) {
                if (spawn_result.status.signalCode()) |signal| {
                    if (signal.toExitCode()) |exit_code| {
                        Global.exit(exit_code);
                    }
                }

                if (spawn_result.status == .exited) {
                    Global.exit(spawn_result.status.exited.code);
                }

                Global.crash();
            }
        },
    }

    // Show success message and start dev server
    if (is_new) {
        switch (template) {
            .ReactShadcnSpa => |*shadcn| {
                if (shadcn.components.keys().len > 0) {
                    // Add shadcn components
                    var shadcn_argv = try std.ArrayList([]const u8).initCapacity(default_allocator, 10);
                    try shadcn_argv.append(try bun.selfExePath());
                    try shadcn_argv.append("x");
                    try shadcn_argv.append("shadcn@canary");
                    try shadcn_argv.append("add");
                    if (strings.contains(normalized_name, "/src")) {
                        try shadcn_argv.append("--src-dir");
                    }
                    try shadcn_argv.append("-y");
                    try shadcn_argv.appendSlice(shadcn.components.keys());
                    // Now we need to run shadcn to add the components to the project
                    const shadcn_process = bun.spawnSync(&.{
                        .argv = shadcn_argv.items,
                        .envp = null,
                        .cwd = bun.fs.FileSystem.instance.top_level_dir,
                        .stderr = .inherit,
                        .stdout = .inherit,
                        .stdin = .inherit,
                    }) catch |err| {
                        Output.err(err, "failed to add shadcn components", .{});
                        Global.crash();
                    };

                    switch (shadcn_process) {
                        .err => |err| {
                            Output.err(err, "failed to add shadcn components", .{});
                            Global.crash();
                        },
                        .result => |spawn_result| {
                            if (!spawn_result.status.isOK()) {
                                if (spawn_result.status.signalCode()) |signal| {
                                    if (signal.toExitCode()) |exit_code| {
                                        Global.exit(exit_code);
                                    }
                                }

                                if (spawn_result.status == .exited) {
                                    Global.exit(spawn_result.status.exited.code);
                                }

                                Global.crash();
                            }
                        },
                    }

                    Output.prettyln(
                        \\<r> <green>✓<r> Shadcn SPA created successfully!
                        \\
                        \\To start your app, run<d>:<r>
                        \\
                        \\    <b><cyan>bun dev<r>
                        \\
                        \\To open your app in the browser<d>:<r>
                        \\
                        \\    <b><cyan>open http://localhost:3000/{s}<r>
                        \\
                        \\To build your app<d>:<r>
                        \\
                        \\    <b><cyan>bun run build<r>
                        \\
                    , .{
                        basename,
                    });
                }
            },
            .ReactTailwindSpa => {
                Output.prettyln(
                    \\<r> <green>✓<r> React Tailwind SPA created successfully!
                    \\
                    \\To start your app, run<d>:<r>
                    \\
                    \\    <b><cyan>bun dev<r>
                    \\
                    \\To open your app in the browser<d>:<r>
                    \\
                    \\    <b><cyan>open http://localhost:3000/{s}<r>
                    \\
                    \\To build your app<d>:<r>
                    \\
                    \\    <b><cyan>bun run build<r>
                    \\
                , .{
                    basename,
                });
            },
        }

        Output.flush();
    }

    // Start dev server
    const start = bun.spawnSync(&.{
        .argv = &.{
            try bun.selfExePath(),
            "dev",
        },
        .envp = null,
        .cwd = bun.fs.FileSystem.instance.top_level_dir,
        .stderr = .inherit,
        .stdout = .inherit,
        .stdin = .inherit,

        .windows = if (Environment.isWindows) .{
            .loop = bun.JSC.EventLoopHandle.init(bun.JSC.MiniEventLoop.initGlobal(null)),
        },
    }) catch |err| {
        Output.err(err, "failed to start app", .{});
        Global.crash();
    };

    switch (start) {
        .err => |err| {
            Output.err(err, "failed to start app", .{});
            Global.crash();
        },
        .result => |spawn_result| {
            if (!spawn_result.status.isOK()) {
                if (spawn_result.status.signalCode()) |signal| {
                    if (signal.toExitCode()) |exit_code| {
                        Global.exit(exit_code);
                    }
                }

                if (spawn_result.status == .exited) {
                    Global.exit(spawn_result.status.exited.code);
                }

                Global.crash();
            }
        },
    }

    Global.exit(0);
}

// Check if any source files contain Tailwind classes
fn hasAnyTailwindClassesInSourceFiles(bundler: *BundleV2, reachable_files: []const js_ast.Index) bool {
    const input_files = bundler.graph.input_files.slice();
    const sources = input_files.items(.source);
    const loaders = input_files.items(.loader);

    // Common Tailwind class patterns to look for
    const common_tailwind_patterns = [_][]const u8{ "bg-", "text-", "p-", "m-", "flex", "grid", "border", "rounded", "shadow", "hover:", "focus:", "dark:", "sm:", "md:", "lg:", "xl:", "w-", "h-", "space-", "gap-", "items-", "justify-", "font-" };

    for (reachable_files) |file| {
        switch (loaders[file.get()]) {
            .tsx, .jsx => {
                const source: *const bun.logger.Source = &sources[file.get()];
                var source_code: []const u8 = source.contents;

                // First check for className=" or className='
                while (strings.indexOf(source_code, "className=")) |index| {
                    source_code = source_code[index + "className=".len ..];
                    if (source_code.len < 1) return false;
                    switch (source_code[0]) {
                        '\'', '"' => |quote| {
                            source_code = source_code[1..];
                            const end_quote = strings.indexOfChar(source_code, quote) orelse continue;
                            const class_name = source_code[0..end_quote];
                            // search for tailwind patterns
                            for (common_tailwind_patterns) |pattern| {
                                if (std.mem.indexOf(u8, class_name, pattern) != null) {
                                    return true;
                                }
                            }
                        },
                        else => {
                            source_code = source_code[1..];
                        },
                    }
                }
            },
            .html => {
                const source: *const bun.logger.Source = &sources[file.get()];
                const source_code: []const u8 = source.contents;

                // Look for class=" or class='
                var i: usize = 0;
                while (i < source_code.len) : (i += 1) {
                    if (i + 7 >= source_code.len) break;

                    if (strings.hasPrefixComptime(source_code, "class")) {
                        // Skip whitespace
                        var j = i + 5;
                        while (j < source_code.len and (source_code[j] == ' ' or source_code[j] == '=')) : (j += 1) {}
                        if (j < source_code.len and (source_code[j] == '"' or source_code[j] == '\'')) {
                            // Found a class attribute, now check for Tailwind patterns
                            for (common_tailwind_patterns) |pattern| {
                                if (std.mem.indexOf(u8, source_code[j..@min(j + 1000, source_code.len)], pattern) != null) {
                                    return true;
                                }
                            }
                        }
                        i = j;
                    }
                }
            },
            else => {},
        }
    }

    return false;
}

// Get list of shadcn components used in source files
fn getShadcnComponents(bundler: *BundleV2, reachable_files: []const js_ast.Index) !bun.StringSet {
    const input_files = bundler.graph.input_files.slice();
    const loaders = input_files.items(.loader);
    const all = bundler.graph.ast.items(.import_records);
    var icons = bun.StringSet.init(default_allocator);
    for (reachable_files) |file| {
        switch (loaders[file.get()]) {
            .tsx, .jsx => {
                const import_records = all[file.get()];
                for (import_records.slice()) |*import_record| {
                    if (strings.hasPrefixComptime(import_record.path.text, "@/components/ui/")) {
                        try icons.insert(import_record.path.text["@/components/ui/".len..]);
                    }
                }
            },
            else => {},
        }
    }

    return icons;
}

const bun = @import("root").bun;
const string = bun.string;
const Output = bun.Output;
const Global = bun.Global;
const Environment = bun.Environment;
const strings = bun.strings;
const MutableString = bun.MutableString;
const stringZ = bun.stringZ;
const default_allocator = bun.default_allocator;
const C = bun.C;
const std = @import("std");
const Progress = bun.Progress;

const lex = bun.js_lexer;
const logger = bun.logger;

const js_parser = bun.js_parser;
const js_ast = bun.JSAst;
const linker = @import("../linker.zig");

const Api = @import("../api/schema.zig").Api;
const resolve_path = @import("../resolver/resolve_path.zig");
const BundleV2 = bun.bundle_v2.BundleV2;
const Command = bun.CLI.Command;
const Example = @import("../cli/create_command.zig").Example;

// Disabled until Tailwind v4 is supported.
const enable_shadcn_ui = true;
