pub fn generate(_: Command.Context, example_tag: Example.Tag, entry_point: string, result: *BundleV2.DependenciesScanner.Result) !void {
    const has_tailwind_in_dependencies = result.dependencies.contains("tailwindcss") or result.dependencies.contains("bun-plugin-tailwind");
    var needs_to_inject_tailwind = false;
    if (!has_tailwind_in_dependencies) {
        needs_to_inject_tailwind = hasAnyTailwindClassesInSourceFiles(result.bundle_v2, result.reachable_files);
    }

    const needs_to_inject_shadcn_ui = hasAnyShadcnImports(result.bundle_v2, result.reachable_files);

    if (needs_to_inject_tailwind) {
        try result.dependencies.insert("tailwindcss");
        try result.dependencies.insert("bun-plugin-tailwind");
    }

    if (needs_to_inject_shadcn_ui) {
        // https://ui.shadcn.com/docs/installation/manual
        // This will probably be tricky to keep updated.
        try result.dependencies.insert("tailwindcss-animate");
        try result.dependencies.insert("class-variance-authority");
        try result.dependencies.insert("clsx");
        try result.dependencies.insert("tailwind-merge");
        try result.dependencies.insert("lucide-react");

        // TODO: insert components.json and other boilerplate for `shadcn/ui add` to work.
    }

    const uses_tailwind = has_tailwind_in_dependencies or needs_to_inject_tailwind;
    if (result.dependencies.contains("react")) {
        try result.dependencies.insert("react-dom");
    }

    if (uses_tailwind and result.dependencies.contains("react") and example_tag == .jslike_file) {
        try ReactTailwindSpa.generate(entry_point, result);
    }

    Global.exit(0);
}

fn createFile(filename: []const u8, contents: []const u8) bun.JSC.Maybe(bool) {
    if (bun.sys.File.readFrom(bun.toFD(std.fs.cwd()), filename, default_allocator).asValue()) |source_contents| {
        defer default_allocator.free(source_contents);
        if (strings.eqlLong(source_contents, contents, true)) {
            return .{ .result = false };
        }
    }
    const fd = switch (bun.sys.openatA(bun.toFD(std.fs.cwd()), filename, bun.O.WRONLY | bun.O.CREAT | bun.O.TRUNC, 0o644)) {
        .result => |fd| fd,
        .err => |err| return .{ .err = err },
    };
    defer _ = bun.sys.close(fd);
    switch (bun.sys.File.writeAll(.{ .handle = fd }, contents)) {
        .result => return .{ .result = true },
        .err => |err| return .{ .err = err },
    }
}

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

fn stringWithReplacements(input: []const u8, basename: []const u8, allocator: std.mem.Allocator) ![]u8 {
    return try replaceAllOccurrencesOfString(allocator, input, "REPLACE_ME_WITH_YOUR_APP_FILE_NAME", basename);
}

const ReactTailwindSpa = struct {
    pub const files = .{
        .@"bunfig.toml" = @embedFile("projects/react-tailwind-spa/bunfig.toml"),
        .@"package.json" = @embedFile("projects/react-tailwind-spa/package.json"),
        .@"build.ts" = @embedFile("projects/react-tailwind-spa/REPLACE_ME_WITH_YOUR_APP_FILE_NAME.build.ts"),
        .css = @embedFile("projects/react-tailwind-spa/REPLACE_ME_WITH_YOUR_APP_FILE_NAME.css"),
        .html = @embedFile("projects/react-tailwind-spa/REPLACE_ME_WITH_YOUR_APP_FILE_NAME.html"),
        .@"init.tsx" = @embedFile("projects/react-tailwind-spa/REPLACE_ME_WITH_YOUR_APP_FILE_NAME.client.tsx"),
    };

    pub fn generate(entry_point: string, result: *BundleV2.DependenciesScanner.Result) !void {
        var basename = std.fs.path.basename(entry_point);
        const extension = std.fs.path.extension(basename);
        if (extension.len > 0) {
            basename = basename[0 .. basename.len - extension.len];
        }

        var is_new = false;

        if (!bun.sys.exists("package.json")) {
            switch (createFile("package.json", files.@"package.json")) {
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

        if (!bun.sys.exists("bunfig.toml")) {
            switch (createFile("bunfig.toml", files.@"bunfig.toml")) {
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

        // We leak all these, but it's pretty much fine.
        const css_filename = try stringWithReplacements("REPLACE_ME_WITH_YOUR_APP_FILE_NAME.css", basename, default_allocator);
        const html_filename = try stringWithReplacements("REPLACE_ME_WITH_YOUR_APP_FILE_NAME.html", basename, default_allocator);
        const init_filename = try stringWithReplacements("REPLACE_ME_WITH_YOUR_APP_FILE_NAME.client.tsx", basename, default_allocator);
        const build_filename = try stringWithReplacements("REPLACE_ME_WITH_YOUR_APP_FILE_NAME.build.ts", basename, default_allocator);
        const pairs = [_][2][]const u8{
            .{ try stringWithReplacements(files.css, basename, default_allocator), css_filename },
            .{ try stringWithReplacements(files.html, basename, default_allocator), html_filename },
            .{ try stringWithReplacements(files.@"init.tsx", basename, default_allocator), init_filename },
            .{ try stringWithReplacements(files.@"build.ts", basename, default_allocator), build_filename },
        };

        for (pairs) |pair| {
            switch (createFile(pair[1], pair[0])) {
                .result => |new| {
                    if (new) {
                        is_new = true;
                        Output.prettyln("<r> <green>✓<r> <b>{s}<r> generated\n", .{pair[1]});
                    }
                },
                .err => |err| {
                    Output.err(err, "failed to create file: {s}", .{pair[1]});
                    Global.crash();
                },
            }
        }
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

        if (is_new) {
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
            Output.flush();
        }

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
};

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

fn hasAnyShadcnImports(bundler: *BundleV2, reachable_files: []const js_ast.Index) bool {
    const input_files = bundler.graph.input_files.slice();
    const loaders = input_files.items(.loader);
    const all = bundler.graph.ast.items(.import_records);
    for (reachable_files) |file| {
        switch (loaders[file.get()]) {
            .tsx, .jsx => {
                const import_records = all[file.get()];
                for (import_records.slice()) |*import_record| {
                    if (strings.contains(import_record.path.text, "@/components/ui/")) {
                        return true;
                    }
                }
            },
            else => {},
        }
    }

    return false;
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
