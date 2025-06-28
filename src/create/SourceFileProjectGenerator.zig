// Generate project files based on the entry point and dependencies
pub fn generate(_: Command.Context, _: Example.Tag, entry_point: string, result: *BundleV2.DependenciesScanner.Result) !void {
    const react_component_export = findReactComponentExport(result.bundle_v2) orelse {
        Output.errGeneric("No component export found in <b>{s}<r>", .{bun.fmt.quote(entry_point)});
        Output.flush();
        const writer = Output.errorWriterBuffered();
        try writer.writeAll(
            \\
            \\Please add an export to your file. For example:
            \\
            \\   export default function MyApp() {{
            \\     return <div>Hello World</div>;
            \\   }};
            \\
        );

        Output.flush();
        Global.crash();
    };

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

    // We are JSX-only for now.
    // The versions of react & react-dom need to match up, and it's SO easy to mess that up.
    // So we have to be a little opinionated here.
    // Add react-dom if react is used
    _ = result.dependencies.swapRemove("react");
    _ = result.dependencies.swapRemove("react-dom");
    try result.dependencies.insert("react-dom@19");
    try result.dependencies.insert("react@19");

    // Choose template based on dependencies and example type
    const template: Template = brk: {
        if (needs_to_inject_shadcn_ui) {
            break :brk .{ .ReactShadcnSpa = .{ .components = shadcn } };
        } else if (uses_tailwind) {
            break :brk .ReactTailwindSpa;
        } else {
            break :brk .ReactSpa;
        }
    };

    // Generate project files from template
    try generateFiles(default_allocator, entry_point, result.dependencies.keys(), template, react_component_export);

    Global.exit(0);
}

// Create a file with given contents, returns if file was newly created
fn createFile(filename: []const u8, contents: []const u8) bun.JSC.Maybe(bool) {
    // Check if file exists and has same contents
    if (bun.sys.File.readFrom(bun.FD.cwd(), filename, default_allocator).asValue()) |source_contents| {
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
    const fd = switch (bun.sys.openatA(.cwd(), filename, bun.O.WRONLY | bun.O.CREAT | bun.O.TRUNC, 0o644)) {
        .result => |fd| fd,
        .err => |err| return .{ .err = err },
    };
    defer fd.close();

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
fn stringWithReplacements(original_input: []const u8, basename: []const u8, relative_name: []const u8, react_component_export: []const u8, allocator: std.mem.Allocator) ![]const u8 {
    var input = original_input;

    if (strings.contains(input, "REPLACE_ME_WITH_YOUR_REACT_COMPONENT_EXPORT")) {
        input = try replaceAllOccurrencesOfString(allocator, input, "REPLACE_ME_WITH_YOUR_REACT_COMPONENT_EXPORT", react_component_export);
    }

    if (strings.contains(input, "REPLACE_ME_WITH_YOUR_APP_BASE_NAME")) {
        input = try replaceAllOccurrencesOfString(allocator, input, "REPLACE_ME_WITH_YOUR_APP_BASE_NAME", basename);
    }

    if (strings.contains(input, "REPLACE_ME_WITH_YOUR_APP_FILE_NAME")) {
        input = try replaceAllOccurrencesOfString(allocator, input, "REPLACE_ME_WITH_YOUR_APP_FILE_NAME", relative_name);
    }

    return input;
}

// Generate all project files from template
pub fn generateFiles(allocator: std.mem.Allocator, entry_point: string, dependencies: []const []const u8, template: Template, react_component_export: []const u8) !void {
    var log = template.logger();
    var basename = std.fs.path.basename(entry_point);
    const extension = std.fs.path.extension(basename);
    if (extension.len > 0) {
        basename = basename[0 .. basename.len - extension.len];
    }

    // Normalize file paths
    var normalized_buf: bun.PathBuffer = undefined;
    var normalized_name: []const u8 = if (std.fs.path.isAbsolute(entry_point))
        bun.path.relativeNormalizedBuf(&normalized_buf, bun.fs.FileSystem.instance.top_level_dir, entry_point, .loose, true)
    else
        bun.path.normalizeBuf(entry_point, &normalized_buf, .loose);

    if (extension.len > 0) {
        normalized_name = normalized_name[0 .. normalized_name.len - extension.len];
    }

    // Generate files based on template type
    switch (@as(Template.Tag, template)) {
        inline else => |active| {
            const current = @field(SourceFileProjectGenerator, @tagName(active));
            const files: []const TemplateFile = current.files;

            var max_filename_len: usize = 0;
            var filenames: [files.len]string = undefined;
            var created_files: [files.len]bool = .{false} ** files.len;

            // Create all template files
            inline for (0..files.len) |index| {
                const file = &files[index];
                const file_name = try stringWithReplacements(file.name, basename, normalized_name, react_component_export, allocator);
                if (file.overwrite or !bun.sys.exists(file_name)) {
                    switch (createFile(file_name, try stringWithReplacements(file.content, basename, normalized_name, react_component_export, default_allocator))) {
                        .result => |new| {
                            if (new) {
                                created_files[index] = true;
                                filenames[index] = file_name;
                                max_filename_len = @max(max_filename_len, file_name.len);
                            }
                        },
                        .err => |err| {
                            Output.err(err, "failed to create {s}", .{file_name});
                            Global.crash();
                        },
                    }
                }
            }

            for (files, filenames, created_files) |*file, filename, created| {
                if (created) {
                    log.file(file, filename, max_filename_len);
                }
            }
        },
    }

    if (dependencies.len > 0) {
        // Install dependencies
        var argv = std.ArrayList([]const u8).init(default_allocator);
        try argv.append("bun");
        try argv.append("--only-missing");
        try argv.append("install");
        try argv.appendSlice(dependencies);
        if (log.has_written_initial_message) {
            Output.print("\n", .{});
        }
        Output.pretty("<r>📦 <b>Auto-installing {d} detected dependencies<r>\n", .{dependencies.len});

        // print "bun" but use bun.selfExePath()
        Output.commandOut(argv.items);

        Output.flush();

        argv.items[0] = try bun.selfExePath();

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
    }

    // Show success message and start dev server

    switch (template) {
        .ReactShadcnSpa => |*shadcn| {
            if (shadcn.components.keys().len > 0) {
                // Add shadcn components
                var shadcn_argv = try std.ArrayList([]const u8).initCapacity(default_allocator, 10);
                try shadcn_argv.append("bun");
                try shadcn_argv.append("x");
                try shadcn_argv.append("shadcn@canary");
                try shadcn_argv.append("add");
                if (strings.contains(normalized_name, "/src")) {
                    try shadcn_argv.append("--src-dir");
                }
                try shadcn_argv.append("-y");
                try shadcn_argv.appendSlice(shadcn.components.keys());

                // print "bun" but use bun.selfExePath()
                Output.prettyln("\n<r>😎 <b>Setting up shadcn/ui components<r>", .{});
                Output.commandOut(shadcn_argv.items);
                Output.flush();
                shadcn_argv.items[0] = try bun.selfExePath();

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

                Output.print("\n", .{});

                log.ifNew();
            }
        },
        .ReactSpa, .ReactTailwindSpa => {
            log.ifNew();
        },
    }

    Output.flush();

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

fn findReactComponentExport(bundler: *BundleV2) ?[]const u8 {
    const input_files = bundler.graph.input_files.slice();
    const loaders = input_files.items(.loader);
    const resolved_exports: []const bun.bundle_v2.ResolvedExports = bundler.linker.graph.meta.items(.resolved_exports);
    const sources = input_files.items(.source);

    const entry_point_ids = bundler.graph.entry_points.items;
    for (entry_point_ids) |entry_point_id| {
        const loader = loaders[entry_point_id.get()];
        if (loader == .jsx or loader == .tsx) {
            const source: *const bun.logger.Source = &sources[entry_point_id.get()];
            const exports = &resolved_exports[entry_point_id.get()];

            // 1. Prioritize the default export
            if (exports.contains("default")) {
                return "default";
            }

            const export_names = exports.keys();
            if (export_names.len == 1) {
                // If there's only one export it can only be this.
                return export_names[0];
            }

            if (export_names.len == 0) {
                // If there are no exports, we can't determine the component name.
                continue;
            }

            const filename = source.path.name.nonUniqueNameStringBase();
            if (filename.len == 0) {
                @branchHint(.unlikely);
                continue;
            }

            // 2. Prioritize the export matching the filename with an uppercase first letter
            // such as export const App = () => { ... }
            if (filename[0] >= 'A' and filename[0] <= 'Z') {
                if (bun.js_lexer.isIdentifier(filename)) {
                    if (exports.contains(filename)) {
                        return filename;
                    }
                }
            }

            if (filename[0] >= 'a' and filename[0] <= 'z') {
                const duped = default_allocator.dupe(u8, filename) catch bun.outOfMemory();
                duped[0] = duped[0] - 32;
                if (bun.js_lexer.isIdentifier(duped)) {
                    if (exports.contains(duped)) {
                        return duped;
                    }
                }

                {
                    // Extremely naive pascal case conversion
                    // - Does not handle unicode.
                    var input_index: usize = 0;
                    var output_index: usize = 0;
                    var capitalize_next = false;
                    while (input_index < duped.len) : (input_index += 1) {
                        if (duped[input_index] == ' ' or duped[input_index] == '-' or duped[input_index] == '_' or (output_index == 0 and !bun.js_lexer.isIdentifierStart(duped[input_index]))) {
                            capitalize_next = true;
                            continue;
                        }
                        if (output_index == 0 or capitalize_next) {
                            if (duped[input_index] >= 'a' and duped[input_index] <= 'z') {
                                duped[output_index] = duped[input_index] - 32;
                            } else {
                                duped[output_index] = duped[input_index];
                            }
                            capitalize_next = false;
                            output_index += 1;
                        } else {
                            duped[output_index] = duped[input_index];
                            output_index += 1;
                        }
                    }

                    // Try the pascal case version
                    // - "my-app" -> "MyApp"
                    // - "my_app" -> "MyApp"
                    // - "My-App" -> "MyApp"
                    if (exports.contains(duped[0..output_index])) {
                        return duped[0..output_index];
                    }

                    // Okay that didn't work. Try the version that's the current
                    // filename with the first letter capitalized
                    // - "my-app" -> "Myapp"
                    // - "My-App" -> "Myapp"
                    if (output_index > 1) {
                        for (duped[1..output_index]) |*c| {
                            switch (c.*) {
                                'A'...'Z' => {
                                    c.* = c.* + 32;
                                },
                                else => {},
                            }
                        }
                    }

                    if (exports.contains(duped[0..output_index])) {
                        return duped[0..output_index];
                    }
                }

                default_allocator.free(duped);
            }

            const name_to_try = MutableString.ensureValidIdentifier(filename, default_allocator) catch return null;
            if (exports.contains(name_to_try)) {
                return name_to_try;
            }

            // Okay we really have no idea now.
            // Let's just pick one that looks like a react component I guess.
            for (export_names) |export_name| {
                if (export_name.len > 0 and export_name[0] >= 'A' and export_name[0] <= 'Z') {
                    return export_name;
                }
            }

            // Okay now we just have to pick one.
            if (export_names.len > 0) {
                return export_names[0];
            }
        }
    }

    return null;
}

const bun = @import("bun");
const string = bun.string;
const Output = bun.Output;
const Global = bun.Global;
const Environment = bun.Environment;
const strings = bun.strings;
const MutableString = bun.MutableString;
const default_allocator = bun.default_allocator;

const std = @import("std");

const logger = bun.logger;

const js_ast = bun.JSAst;
const linker = @import("../linker.zig");

const BundleV2 = bun.bundle_v2.BundleV2;
const Command = bun.CLI.Command;
const Example = @import("../cli/create_command.zig").Example;

// Disabled until Tailwind v4 is supported.
const enable_shadcn_ui = true;

const TemplateFile = struct {
    name: []const u8,
    content: []const u8,
    reason: Reason,
    overwrite: bool = true,
};

const Reason = enum {
    shadcn,
    bun,
    css,
    tsc,
    build,
    html,
    npm,
};

// Template for React + Tailwind project
const ReactTailwindSpa = struct {
    pub const files = &[_]TemplateFile{
        .{
            .name = "REPLACE_ME_WITH_YOUR_APP_FILE_NAME.build.ts",
            .content = shared_build_ts,
            .reason = .build,
        },
        .{
            .name = "REPLACE_ME_WITH_YOUR_APP_FILE_NAME.css",
            .content = @embedFile("projects/react-tailwind-spa/REPLACE_ME_WITH_YOUR_APP_FILE_NAME.css"),
            .reason = .css,
        },
        .{
            .name = "REPLACE_ME_WITH_YOUR_APP_FILE_NAME.html",
            .content = shared_html,
            .reason = .html,
        },
        .{
            .name = "REPLACE_ME_WITH_YOUR_APP_FILE_NAME.client.tsx",
            .content = shared_client_tsx,
            .reason = .bun,
        },
        .{
            .name = "bunfig.toml",
            .content = shared_bunfig_toml,
            .reason = .bun,
            .overwrite = false,
        },
        .{
            .name = "package.json",
            .content = shared_package_json,
            .reason = .npm,
            .overwrite = false,
        },
    };

    pub const init_files = &[_]TemplateFile{};
};

const shared_build_ts = @embedFile("projects/react-shadcn-spa/REPLACE_ME_WITH_YOUR_APP_FILE_NAME.build.ts");
const shared_client_tsx = @embedFile("projects/react-shadcn-spa/REPLACE_ME_WITH_YOUR_APP_FILE_NAME.client.tsx");
const shared_html = @embedFile("projects/react-shadcn-spa/REPLACE_ME_WITH_YOUR_APP_FILE_NAME.html");
const shared_package_json = @embedFile("projects/react-shadcn-spa/package.json");
const shared_bunfig_toml = @embedFile("projects/react-shadcn-spa/bunfig.toml");

// Template for basic React project
const ReactSpa = struct {
    pub const files = &[_]TemplateFile{
        .{
            .name = "REPLACE_ME_WITH_YOUR_APP_FILE_NAME.build.ts",
            .content = shared_build_ts,
            .reason = .build,
        },
        .{
            .name = "REPLACE_ME_WITH_YOUR_APP_FILE_NAME.css",
            .content = @embedFile("projects/react-spa/REPLACE_ME_WITH_YOUR_APP_FILE_NAME.css"),
            .reason = .css,
            .overwrite = false,
        },
        .{
            .name = "REPLACE_ME_WITH_YOUR_APP_FILE_NAME.html",
            .content = shared_html,
            .reason = .html,
        },
        .{
            .name = "REPLACE_ME_WITH_YOUR_APP_FILE_NAME.client.tsx",
            .content = shared_client_tsx,
            .reason = .bun,
        },
        .{
            .name = "package.json",
            .content = @embedFile("projects/react-spa/package.json"),
            .reason = .npm,
            .overwrite = false,
        },
    };
};

// Template for React + Shadcn project
const ReactShadcnSpa = struct {
    pub const files = &[_]TemplateFile{
        .{
            .name = "lib/utils.ts",
            .content = @embedFile("projects/react-shadcn-spa/lib/utils.ts"),
            .reason = .shadcn,
        },
        .{
            .name = "index.css",
            .content = @embedFile("projects/react-shadcn-spa/styles/index.css"),
            .reason = .shadcn,
        },
        .{
            .name = "REPLACE_ME_WITH_YOUR_APP_FILE_NAME.build.ts",
            .content = shared_build_ts,
            .reason = .bun,
        },
        .{
            .name = "REPLACE_ME_WITH_YOUR_APP_FILE_NAME.client.tsx",
            .content = shared_client_tsx,
            .reason = .bun,
        },
        .{
            .name = "REPLACE_ME_WITH_YOUR_APP_FILE_NAME.css",
            .content = @embedFile("projects/react-shadcn-spa/REPLACE_ME_WITH_YOUR_APP_FILE_NAME.css"),
            .reason = .css,
        },
        .{
            .name = "REPLACE_ME_WITH_YOUR_APP_FILE_NAME.html",
            .content = shared_html,
            .reason = .html,
        },
        .{
            .name = "styles/globals.css",
            .content = @embedFile("projects/react-shadcn-spa/styles/globals.css"),
            .reason = .shadcn,
        },
        .{
            .name = "bunfig.toml",
            .content = shared_bunfig_toml,
            .reason = .bun,
            .overwrite = false,
        },
        .{
            .name = "package.json",
            .content = shared_package_json,
            .reason = .npm,
            .overwrite = false,
        },
        .{
            .name = "tsconfig.json",
            .content = @embedFile("projects/react-shadcn-spa/tsconfig.json"),
            .reason = .tsc,
            .overwrite = false,
        },
        .{
            .name = "components.json",
            .content = @embedFile("projects/react-shadcn-spa/components.json"),
            .reason = .shadcn,
            .overwrite = false,
        },
    };
};

// Template type to handle different project types
pub const Template = union(Tag) {
    ReactTailwindSpa: void,
    ReactSpa: void,
    ReactShadcnSpa: struct {
        components: bun.StringSet,
    },

    pub const Tag = enum {
        ReactTailwindSpa,
        ReactSpa,
        ReactShadcnSpa,

        pub fn logger(self: Tag) Logger {
            return Logger{ .template = self };
        }

        pub fn label(self: Tag) []const u8 {
            return switch (self) {
                .ReactTailwindSpa => "React + Tailwind",
                .ReactSpa => "React",
                .ReactShadcnSpa => "React + shadcn/ui + Tailwind",
            };
        }
    };

    pub fn logger(self: Template) Logger {
        return Logger{ .template = self };
    }

    pub const Logger = struct {
        has_written_initial_message: bool = false,
        template: Tag,

        pub fn file(this: *Logger, template_file: *const TemplateFile, name: []const u8, max_name_len: usize) void {
            this.has_written_initial_message = true;
            Output.pretty(" <green>create<r>  ", .{});
            Output.pretty("{s}", .{name});
            const name_len = name.len;
            var padding: usize = max_name_len - name_len;
            while (padding > 0) : (padding -= 1) {
                Output.pretty(" ", .{});
            }
            Output.prettyln("   <d>{s}<r>", .{@tagName(template_file.reason)});
        }

        pub fn ifNew(this: *Logger) void {
            if (!this.has_written_initial_message) return;

            Output.prettyln(
                \\<r><d>--------------------------------<r>
                \\✨ <b>{s}<r> project configured
                \\
                \\<b><cyan>Development<r><d> - frontend dev server with hot reload<r>
                \\
                \\  <cyan><b>bun dev<r>
                \\
                \\<b><green>Production<r><d> - build optimized assets<r>
                \\
                \\  <green><b>bun run build<r>
                \\
                \\<blue>Happy bunning! 🐇<r>
            , .{this.template.label()});
        }
    };
};

const SourceFileProjectGenerator = @This();
