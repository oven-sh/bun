const std = @import("std");
const Command = @import("../cli.zig").Command;
const bun = @import("bun");
const string = bun.string;
const Output = bun.Output;
const Global = bun.Global;
const strings = bun.strings;
const default_allocator = bun.default_allocator;

const options = @import("../options.zig");

const resolve_path = @import("../resolver/resolve_path.zig");
const transpiler = bun.transpiler;

const fs = @import("../fs.zig");
const BundleV2 = @import("../bundler/bundle_v2.zig").BundleV2;

pub const BuildCommand = struct {
    const compile_define_keys = &.{
        "process.platform",
        "process.arch",
        "process.versions.bun",
    };

    pub fn exec(ctx: Command.Context, fetcher: ?*BundleV2.DependenciesScanner) !void {
        Global.configureAllocator(.{ .long_running = true });
        const allocator = ctx.allocator;
        var log = ctx.log;
        if (ctx.bundler_options.compile or ctx.bundler_options.bytecode) {
            // set this early so that externals are set up correctly and define is right
            ctx.args.target = .bun;
        }

        if (ctx.bundler_options.bake) {
            return bun.bake.production.buildCommand(ctx);
        }

        if (fetcher != null) {
            ctx.args.packages = .external;
            ctx.bundler_options.compile = false;
        }

        const compile_target = &ctx.bundler_options.compile_target;

        if (ctx.bundler_options.compile) {
            const compile_define_values = compile_target.defineValues();
            if (ctx.args.define) |*define| {
                var keys = try std.ArrayList(string).initCapacity(bun.default_allocator, compile_define_keys.len + define.keys.len);
                keys.appendSliceAssumeCapacity(compile_define_keys);
                keys.appendSliceAssumeCapacity(define.keys);
                var values = try std.ArrayList(string).initCapacity(bun.default_allocator, compile_define_values.len + define.values.len);
                values.appendSliceAssumeCapacity(compile_define_values);
                values.appendSliceAssumeCapacity(define.values);

                define.keys = keys.items;
                define.values = values.items;
            } else {
                ctx.args.define = .{
                    .keys = compile_define_keys,
                    .values = compile_define_values,
                };
            }
        }

        var this_transpiler = try transpiler.Transpiler.init(allocator, log, ctx.args, null);
        if (fetcher) |fetch| {
            this_transpiler.options.entry_points = fetch.entry_points;
            this_transpiler.resolver.opts.entry_points = fetch.entry_points;
            this_transpiler.options.ignore_module_resolution_errors = true;
            this_transpiler.resolver.opts.ignore_module_resolution_errors = true;
        }

        this_transpiler.options.source_map = options.SourceMapOption.fromApi(ctx.args.source_map);

        this_transpiler.options.compile = ctx.bundler_options.compile;

        if (this_transpiler.options.source_map == .external and ctx.bundler_options.outdir.len == 0 and !ctx.bundler_options.compile) {
            Output.prettyErrorln("<r><red>error<r><d>:<r> cannot use an external source map without --outdir", .{});
            Global.exit(1);
            return;
        }

        var outfile = ctx.bundler_options.outfile;
        const output_to_stdout = !ctx.bundler_options.compile and outfile.len == 0 and ctx.bundler_options.outdir.len == 0;

        this_transpiler.options.supports_multiple_outputs = !(output_to_stdout or outfile.len > 0);

        this_transpiler.options.public_path = ctx.bundler_options.public_path;
        this_transpiler.options.entry_naming = ctx.bundler_options.entry_naming;
        this_transpiler.options.chunk_naming = ctx.bundler_options.chunk_naming;
        this_transpiler.options.asset_naming = ctx.bundler_options.asset_naming;
        this_transpiler.options.server_components = ctx.bundler_options.server_components;
        this_transpiler.options.react_fast_refresh = ctx.bundler_options.react_fast_refresh;
        this_transpiler.options.inline_entrypoint_import_meta_main = ctx.bundler_options.inline_entrypoint_import_meta_main;
        this_transpiler.options.code_splitting = ctx.bundler_options.code_splitting;
        this_transpiler.options.minify_syntax = ctx.bundler_options.minify_syntax;
        this_transpiler.options.minify_whitespace = ctx.bundler_options.minify_whitespace;
        this_transpiler.options.minify_identifiers = ctx.bundler_options.minify_identifiers;
        this_transpiler.options.emit_dce_annotations = ctx.bundler_options.emit_dce_annotations;
        this_transpiler.options.ignore_dce_annotations = ctx.bundler_options.ignore_dce_annotations;

        this_transpiler.options.banner = ctx.bundler_options.banner;
        this_transpiler.options.footer = ctx.bundler_options.footer;
        this_transpiler.options.drop = ctx.args.drop;

        this_transpiler.options.css_chunking = ctx.bundler_options.css_chunking;

        this_transpiler.options.output_dir = ctx.bundler_options.outdir;
        this_transpiler.options.output_format = ctx.bundler_options.output_format;

        if (ctx.bundler_options.output_format == .internal_bake_dev) {
            this_transpiler.options.tree_shaking = false;
        }

        this_transpiler.options.bytecode = ctx.bundler_options.bytecode;
        var was_renamed_from_index = false;

        if (ctx.bundler_options.compile) {
            if (ctx.bundler_options.code_splitting) {
                Output.prettyErrorln("<r><red>error<r><d>:<r> cannot use --compile with --splitting", .{});
                Global.exit(1);
                return;
            }

            if (ctx.bundler_options.outdir.len > 0) {
                Output.prettyErrorln("<r><red>error<r><d>:<r> cannot use --compile with --outdir", .{});
                Global.exit(1);
                return;
            }

            const base_public_path = bun.StandaloneModuleGraph.targetBasePublicPath(compile_target.os, "root/");

            this_transpiler.options.public_path = base_public_path;

            if (outfile.len == 0) {
                outfile = std.fs.path.basename(this_transpiler.options.entry_points[0]);
                const ext = std.fs.path.extension(outfile);
                if (ext.len > 0) {
                    outfile = outfile[0 .. outfile.len - ext.len];
                }

                if (strings.eqlComptime(outfile, "index")) {
                    outfile = std.fs.path.basename(std.fs.path.dirname(this_transpiler.options.entry_points[0]) orelse "index");
                    was_renamed_from_index = !strings.eqlComptime(outfile, "index");
                }

                if (strings.eqlComptime(outfile, "bun")) {
                    outfile = std.fs.path.basename(std.fs.path.dirname(this_transpiler.options.entry_points[0]) orelse "bun");
                }
            }

            // If argv[0] is "bun" or "bunx", we don't check if the binary is standalone
            if (strings.eqlComptime(outfile, "bun") or strings.eqlComptime(outfile, "bunx")) {
                Output.prettyErrorln("<r><red>error<r><d>:<r> cannot use --compile with an output file named 'bun' because bun won't realize it's a standalone executable. Please choose a different name for --outfile", .{});
                Global.exit(1);
                return;
            }

            if (ctx.bundler_options.transform_only) {
                Output.prettyErrorln("<r><red>error<r><d>:<r> --compile does not support --no-bundle", .{});
                Global.exit(1);
                return;
            }
        }

        if (ctx.bundler_options.outdir.len == 0 and !ctx.bundler_options.compile and fetcher == null) {
            if (this_transpiler.options.entry_points.len > 1) {
                Output.prettyErrorln("<r><red>error<r><d>:<r> Must use <b>--outdir<r> when specifying more than one entry point.", .{});
                Global.exit(1);
                return;
            }
            if (this_transpiler.options.code_splitting) {
                Output.prettyErrorln("<r><red>error<r><d>:<r> Must use <b>--outdir<r> when code splitting is enabled", .{});
                Global.exit(1);
                return;
            }
        }

        var src_root_dir_buf: bun.PathBuffer = undefined;
        const src_root_dir: string = brk1: {
            const path = brk2: {
                if (ctx.bundler_options.root_dir.len > 0) {
                    break :brk2 ctx.bundler_options.root_dir;
                }

                if (this_transpiler.options.entry_points.len == 1) {
                    break :brk2 std.fs.path.dirname(this_transpiler.options.entry_points[0]) orelse ".";
                }

                break :brk2 resolve_path.getIfExistsLongestCommonPath(this_transpiler.options.entry_points) orelse ".";
            };

            var dir = bun.FD.fromStdDir(bun.openDirForPath(&(try std.posix.toPosixPath(path))) catch |err| {
                Output.prettyErrorln("<r><red>{s}<r> opening root directory {}", .{ @errorName(err), bun.fmt.quote(path) });
                Global.exit(1);
            });
            defer dir.close();

            break :brk1 dir.getFdPath(&src_root_dir_buf) catch |err| {
                Output.prettyErrorln("<r><red>{s}<r> resolving root directory {}", .{ @errorName(err), bun.fmt.quote(path) });
                Global.exit(1);
            };
        };

        this_transpiler.options.root_dir = src_root_dir;
        this_transpiler.options.code_splitting = ctx.bundler_options.code_splitting;
        this_transpiler.options.transform_only = ctx.bundler_options.transform_only;

        this_transpiler.options.env.behavior = ctx.bundler_options.env_behavior;
        this_transpiler.options.env.prefix = ctx.bundler_options.env_prefix;

        if (ctx.bundler_options.production) {
            try this_transpiler.env.map.put("NODE_ENV", "production");
        }

        try this_transpiler.configureDefines();
        this_transpiler.configureLinker();

        if (ctx.bundler_options.production) {
            bun.assert(!this_transpiler.options.jsx.development);
        }

        if (!this_transpiler.options.production) {
            try this_transpiler.options.conditions.appendSlice(&.{"development"});
        }

        this_transpiler.resolver.opts = this_transpiler.options;
        this_transpiler.resolver.env_loader = this_transpiler.env;
        this_transpiler.options.jsx.development = !this_transpiler.options.production;
        this_transpiler.resolver.opts.jsx.development = this_transpiler.options.jsx.development;

        switch (ctx.debug.macros) {
            .disable => {
                this_transpiler.options.no_macros = true;
            },
            .map => |macros| {
                this_transpiler.options.macro_remap = macros;
            },
            .unspecified => {},
        }

        var client_transpiler: transpiler.Transpiler = undefined;
        if (this_transpiler.options.server_components) {
            client_transpiler = try transpiler.Transpiler.init(allocator, log, ctx.args, null);
            client_transpiler.options = this_transpiler.options;
            client_transpiler.options.target = .browser;
            client_transpiler.options.server_components = true;
            client_transpiler.options.conditions = try this_transpiler.options.conditions.clone();
            try this_transpiler.options.conditions.appendSlice(&.{"react-server"});
            this_transpiler.options.react_fast_refresh = false;
            this_transpiler.options.minify_syntax = true;
            client_transpiler.options.minify_syntax = true;
            client_transpiler.options.define = try options.Define.init(
                allocator,
                if (ctx.args.define) |user_defines|
                    try options.Define.Data.fromInput(try options.stringHashMapFromArrays(
                        options.defines.RawDefines,
                        allocator,
                        user_defines.keys,
                        user_defines.values,
                    ), ctx.args.drop, log, allocator)
                else
                    null,
                null,
                this_transpiler.options.define.drop_debugger,
            );

            try bun.bake.addImportMetaDefines(allocator, this_transpiler.options.define, .development, .server);
            try bun.bake.addImportMetaDefines(allocator, client_transpiler.options.define, .development, .client);

            this_transpiler.resolver.opts = this_transpiler.options;
            this_transpiler.resolver.env_loader = this_transpiler.env;
            client_transpiler.resolver.opts = client_transpiler.options;
            client_transpiler.resolver.env_loader = client_transpiler.env;
        }

        // var env_loader = this_transpiler.env;

        if (ctx.debug.dump_environment_variables) {
            this_transpiler.dumpEnvironmentVariables();
            return;
        }

        var reachable_file_count: usize = 0;
        var minify_duration: u64 = 0;
        var input_code_length: u64 = 0;

        const output_files: []options.OutputFile = brk: {
            if (ctx.bundler_options.transform_only) {
                this_transpiler.options.import_path_format = .relative;
                this_transpiler.options.allow_runtime = false;
                this_transpiler.resolver.opts.allow_runtime = false;

                // TODO: refactor this .transform function
                const result = try this_transpiler.transform(
                    ctx.allocator,
                    ctx.log,
                    ctx.args,
                );

                if (log.hasErrors()) {
                    try log.print(Output.errorWriter());

                    if (result.errors.len > 0 or result.output_files.len == 0) {
                        Output.flush();
                        exitOrWatch(1, ctx.debug.hot_reload == .watch);
                        unreachable;
                    }
                }

                break :brk result.output_files;
            }

            if (ctx.bundler_options.outdir.len == 0 and outfile.len > 0 and !ctx.bundler_options.compile) {
                this_transpiler.options.entry_naming = try std.fmt.allocPrint(allocator, "./{s}", .{
                    std.fs.path.basename(outfile),
                });
                if (std.fs.path.dirname(outfile)) |dir|
                    ctx.bundler_options.outdir = dir;
                this_transpiler.resolver.opts.entry_naming = this_transpiler.options.entry_naming;
            }

            break :brk (BundleV2.generateFromCLI(
                &this_transpiler,
                allocator,
                bun.JSC.AnyEventLoop.init(ctx.allocator),
                ctx.debug.hot_reload == .watch,
                &reachable_file_count,
                &minify_duration,
                &input_code_length,
                fetcher,
            ) catch |err| {
                if (log.msgs.items.len > 0) {
                    try log.print(Output.errorWriter());
                } else {
                    try Output.errorWriter().print("error: {s}", .{@errorName(err)});
                }

                Output.flush();
                exitOrWatch(1, ctx.debug.hot_reload == .watch);
            }).items;
        };
        const bundled_end = std.time.nanoTimestamp();

        var had_err = false;
        dump: {
            defer Output.flush();
            var writer = Output.writer();
            var output_dir = this_transpiler.options.output_dir;

            const will_be_one_file =
                // --outdir is not supported with --compile
                // but you can still use --outfile
                // in which case, we should set the output dir to the dirname of the outfile
                // https://github.com/oven-sh/bun/issues/8697
                ctx.bundler_options.compile or
                (output_files.len == 1 and output_files[0].value == .buffer);

            if (output_dir.len == 0 and outfile.len > 0 and will_be_one_file) {
                output_dir = std.fs.path.dirname(outfile) orelse ".";
                if (ctx.bundler_options.compile) {
                    // If the first output file happens to be a client-side chunk imported server-side
                    // then don't rename it to something else, since an HTML
                    // import manifest might depend on the file path being the
                    // one we think it should be.
                    for (output_files) |*f| {
                        if (f.output_kind == .@"entry-point" and (f.side orelse .server) == .server) {
                            f.dest_path = std.fs.path.basename(outfile);
                            break;
                        }
                    }
                } else {
                    output_files[0].dest_path = std.fs.path.basename(outfile);
                }
            }

            if (!ctx.bundler_options.compile) {
                if (outfile.len == 0 and output_files.len == 1 and ctx.bundler_options.outdir.len == 0) {
                    // if --no-bundle is passed, it won't have an output dir
                    if (output_files[0].value == .buffer)
                        try writer.writeAll(output_files[0].value.buffer.bytes);
                    break :dump;
                }
            }

            var root_path = output_dir;
            if (root_path.len == 0 and ctx.args.entry_points.len == 1)
                root_path = std.fs.path.dirname(ctx.args.entry_points[0]) orelse ".";

            const root_dir = if (root_path.len == 0 or strings.eqlComptime(root_path, "."))
                std.fs.cwd()
            else
                std.fs.cwd().makeOpenPath(root_path, .{}) catch |err| {
                    Output.err(err, "could not open output directory {}", .{bun.fmt.quote(root_path)});
                    exitOrWatch(1, ctx.debug.hot_reload == .watch);
                    unreachable;
                };

            const all_paths = try ctx.allocator.alloc([]const u8, output_files.len);
            var max_path_len: usize = 0;
            for (all_paths, output_files) |*dest, src| {
                dest.* = src.dest_path;
            }

            const from_path = resolve_path.longestCommonPath(all_paths);

            var size_padding: usize = 0;

            for (output_files) |f| {
                max_path_len = @max(
                    @max(from_path.len, f.dest_path.len) + 2 - from_path.len,
                    max_path_len,
                );
                size_padding = @max(size_padding, std.fmt.count("{}", .{bun.fmt.size(f.size, .{})}));
            }

            if (ctx.bundler_options.compile) {
                printSummary(
                    bundled_end,
                    minify_duration,
                    this_transpiler.options.minify_identifiers or this_transpiler.options.minify_whitespace or this_transpiler.options.minify_syntax,
                    input_code_length,
                    reachable_file_count,
                    output_files,
                );

                Output.flush();

                const is_cross_compile = !compile_target.isDefault();

                if (outfile.len == 0 or strings.eqlComptime(outfile, ".") or strings.eqlComptime(outfile, "..") or strings.eqlComptime(outfile, "../")) {
                    outfile = "index";
                }

                if (compile_target.os == .windows and !strings.hasSuffixComptime(outfile, ".exe")) {
                    outfile = try std.fmt.allocPrint(allocator, "{s}.exe", .{outfile});
                } else if (was_renamed_from_index and !bun.strings.eqlComptime(outfile, "index")) {
                    // If we're going to fail due to EISDIR, we should instead pick a different name.
                    if (bun.sys.directoryExistsAt(bun.FD.fromStdDir(root_dir), outfile).asValue() orelse false) {
                        outfile = "index";
                    }
                }

                try bun.StandaloneModuleGraph.toExecutable(
                    compile_target,
                    allocator,
                    output_files,
                    root_dir,
                    this_transpiler.options.public_path,
                    outfile,
                    this_transpiler.env,
                    this_transpiler.options.output_format,
                    ctx.bundler_options.windows_hide_console,
                    ctx.bundler_options.windows_icon,
                );
                const compiled_elapsed = @divTrunc(@as(i64, @truncate(std.time.nanoTimestamp() - bundled_end)), @as(i64, std.time.ns_per_ms));
                const compiled_elapsed_digit_count: isize = switch (compiled_elapsed) {
                    0...9 => 3,
                    10...99 => 2,
                    100...999 => 1,
                    1000...9999 => 0,
                    else => 0,
                };
                const padding_buf = [_]u8{' '} ** 16;
                const padding_ = padding_buf[0..@as(usize, @intCast(compiled_elapsed_digit_count))];
                Output.pretty("{s}", .{padding_});

                Output.printElapsedStdoutTrim(@as(f64, @floatFromInt(compiled_elapsed)));

                Output.pretty(" <green>compile<r>  <b><blue>{s}{s}<r>", .{
                    outfile,
                    if (compile_target.os == .windows and !strings.hasSuffixComptime(outfile, ".exe")) ".exe" else "",
                });

                if (is_cross_compile) {
                    Output.pretty(" <r><d>{s}<r>\n", .{compile_target});
                } else {
                    Output.pretty("\n", .{});
                }

                break :dump;
            }

            if (log.errors == 0) {
                if (this_transpiler.options.transform_only) {
                    Output.prettyln("<green>Transpiled file in {d}ms<r>", .{
                        @divFloor(std.time.nanoTimestamp() - bun.CLI.start_time, std.time.ns_per_ms),
                    });
                } else {
                    Output.prettyln("<green>Bundled {d} module{s} in {d}ms<r>", .{
                        reachable_file_count,
                        if (reachable_file_count == 1) "" else "s",
                        @divFloor(std.time.nanoTimestamp() - bun.CLI.start_time, std.time.ns_per_ms),
                    });
                }
                Output.prettyln("\n", .{});
                Output.flush();
            }

            for (output_files) |f| {
                size_padding = @max(size_padding, std.fmt.count("{}", .{bun.fmt.size(f.size, .{})}));
            }

            for (output_files) |f| {
                f.writeToDisk(root_dir, from_path) catch |err| {
                    Output.err(err, "failed to write file '{}'", .{bun.fmt.quote(f.dest_path)});
                    had_err = true;
                    continue;
                };

                bun.debugAssert(!std.fs.path.isAbsolute(f.dest_path));

                const rel_path = bun.strings.trimPrefixComptime(u8, f.dest_path, "./");

                // Print summary
                const padding_count = @max(2, @max(rel_path.len, max_path_len) - rel_path.len);
                try writer.writeByteNTimes(' ', 2);

                if (Output.enable_ansi_colors_stdout) try writer.writeAll(switch (f.output_kind) {
                    .@"entry-point" => Output.prettyFmt("<blue>", true),
                    .chunk => Output.prettyFmt("<cyan>", true),
                    .asset => Output.prettyFmt("<magenta>", true),
                    .sourcemap => Output.prettyFmt("<d>", true),
                    .bytecode => Output.prettyFmt("<d>", true),
                });

                try writer.writeAll(rel_path);
                if (Output.enable_ansi_colors_stdout) {
                    // highlight big files
                    const warn_threshold: usize = switch (f.output_kind) {
                        .@"entry-point", .chunk => 128 * 1024,
                        .asset => 16 * 1024 * 1024,
                        else => std.math.maxInt(usize),
                    };
                    if (f.size > warn_threshold) {
                        try writer.writeAll(Output.prettyFmt("<yellow>", true));
                    } else {
                        try writer.writeAll("\x1b[0m");
                    }
                }

                try writer.writeByteNTimes(' ', padding_count);
                try writer.print("{s}  ", .{bun.fmt.size(f.size, .{})});
                try writer.writeByteNTimes(' ', size_padding - std.fmt.count("{}", .{bun.fmt.size(f.size, .{})}));

                if (Output.enable_ansi_colors_stdout) {
                    try writer.writeAll("\x1b[2m");
                }
                try writer.print("({s})", .{switch (f.output_kind) {
                    .@"entry-point" => "entry point",
                    .chunk => "chunk",
                    .asset => "asset",
                    .sourcemap => "source map",
                    .bytecode => "bytecode",
                }});
                if (Output.enable_ansi_colors_stdout)
                    try writer.writeAll("\x1b[0m");
                try writer.writeAll("\n");
            }

            Output.prettyln("\n", .{});
        }

        try log.print(Output.errorWriter());
        exitOrWatch(if (had_err) 1 else 0, ctx.debug.hot_reload == .watch);
    }
};

fn exitOrWatch(code: u8, watch: bool) noreturn {
    if (watch) {
        // the watcher thread will exit the process
        std.time.sleep(std.math.maxInt(u64) - 1);
    }
    Global.exit(code);
}

fn printSummary(bundled_end: i128, minify_duration: u64, minified: bool, input_code_length: usize, reachable_file_count: usize, output_files: []const options.OutputFile) void {
    const padding_buf = [_]u8{' '} ** 16;

    const bundle_until_now = @divTrunc(@as(i64, @truncate(bundled_end - bun.CLI.start_time)), @as(i64, std.time.ns_per_ms));

    const bundle_elapsed = if (minified)
        bundle_until_now - @as(i64, @intCast(@as(u63, @truncate(minify_duration))))
    else
        bundle_until_now;

    const minified_digit_count: usize = switch (minify_duration) {
        0...9 => 3,
        10...99 => 2,
        100...999 => 1,
        1000...9999 => 0,
        else => 0,
    };
    if (minified) {
        Output.pretty("{s}", .{padding_buf[0..@as(usize, @intCast(minified_digit_count))]});
        Output.printElapsedStdoutTrim(@as(f64, @floatFromInt(minify_duration)));
        const output_size = brk: {
            var total_size: u64 = 0;
            for (output_files) |f| {
                if (f.loader == .js) {
                    total_size += f.size_without_sourcemap;
                }
            }

            break :brk total_size;
        };
        // this isn't an exact size
        // we may inject sourcemaps or comments or import paths
        const delta: i64 = @as(i64, @truncate(@as(i65, @intCast(input_code_length)) - @as(i65, @intCast(output_size))));
        if (delta > 1024) {
            Output.prettyln(
                "  <green>minify<r>  -{} <d>(estimate)<r>",
                .{
                    bun.fmt.size(@as(usize, @intCast(delta)), .{}),
                },
            );
        } else if (-delta > 1024) {
            Output.prettyln(
                "  <b>minify<r>   +{} <d>(estimate)<r>",
                .{
                    bun.fmt.size(@as(usize, @intCast(-delta)), .{}),
                },
            );
        } else {
            Output.prettyln("  <b>minify<r>", .{});
        }
    }

    const bundle_elapsed_digit_count: usize = switch (bundle_elapsed) {
        0...9 => 3,
        10...99 => 2,
        100...999 => 1,
        1000...9999 => 0,
        else => 0,
    };

    Output.pretty("{s}", .{padding_buf[0..@as(usize, @intCast(bundle_elapsed_digit_count))]});
    Output.printElapsedStdoutTrim(@as(f64, @floatFromInt(bundle_elapsed)));
    Output.prettyln(
        "  <green>bundle<r>  {d} modules",
        .{
            reachable_file_count,
        },
    );
}
