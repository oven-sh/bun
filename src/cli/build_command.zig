const std = @import("std");
const Command = @import("../cli.zig").Command;
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

const lex = bun.js_lexer;
const logger = bun.logger;

const options = @import("../options.zig");
const js_parser = bun.js_parser;
const json_parser = bun.JSON;
const js_printer = bun.js_printer;
const js_ast = bun.JSAst;
const linker = @import("../linker.zig");

const sync = @import("../sync.zig");
const Api = @import("../api/schema.zig").Api;
const resolve_path = @import("../resolver/resolve_path.zig");
const configureTransformOptionsForBun = @import("../bun.js/config.zig").configureTransformOptionsForBun;
const bundler = bun.bundler;

const DotEnv = @import("../env_loader.zig");

const fs = @import("../fs.zig");
const Router = @import("../router.zig");
const BundleV2 = @import("../bundler/bundle_v2.zig").BundleV2;
var estimated_input_lines_of_code_: usize = undefined;

pub const BuildCommand = struct {
    const compile_define_keys = &.{
        "process.platform",
        "process.arch",
    };

    pub fn exec(
        ctx: Command.Context,
    ) !void {
        Global.configureAllocator(.{ .long_running = true });
        const allocator = ctx.allocator;
        var log = ctx.log;
        estimated_input_lines_of_code_ = 0;
        if (ctx.bundler_options.compile) {
            // set this early so that externals are set up correctly and define is right
            ctx.args.target = .bun;
        }

        const compile_target = &ctx.bundler_options.compile_target;

        if (ctx.bundler_options.compile) {
            const compile_define_values = compile_target.defineValues();
            if (ctx.args.define == null) {
                ctx.args.define = .{
                    .keys = compile_define_keys,
                    .values = compile_define_values,
                };
            } else if (ctx.args.define) |*define| {
                var keys = try std.ArrayList(string).initCapacity(bun.default_allocator, compile_define_keys.len + define.keys.len);
                keys.appendSliceAssumeCapacity(compile_define_keys);
                keys.appendSliceAssumeCapacity(define.keys);
                var values = try std.ArrayList(string).initCapacity(bun.default_allocator, compile_define_values.len + define.values.len);
                values.appendSliceAssumeCapacity(compile_define_values);
                values.appendSliceAssumeCapacity(define.values);

                define.keys = keys.items;
                define.values = values.items;
            }
        }

        var this_bundler = try bundler.Bundler.init(allocator, log, ctx.args, null);

        this_bundler.options.source_map = options.SourceMapOption.fromApi(ctx.args.source_map);
        this_bundler.resolver.opts.source_map = options.SourceMapOption.fromApi(ctx.args.source_map);

        this_bundler.options.compile = ctx.bundler_options.compile;
        this_bundler.resolver.opts.compile = ctx.bundler_options.compile;

        if (this_bundler.options.source_map == .external and ctx.bundler_options.outdir.len == 0 and !ctx.bundler_options.compile) {
            Output.prettyErrorln("<r><red>error<r><d>:<r> cannot use an external source map without --outdir", .{});
            Global.exit(1);
            return;
        }
        var outfile = ctx.bundler_options.outfile;

        this_bundler.options.public_path = ctx.bundler_options.public_path;
        this_bundler.resolver.opts.public_path = ctx.bundler_options.public_path;

        this_bundler.options.entry_naming = ctx.bundler_options.entry_naming;
        this_bundler.options.chunk_naming = ctx.bundler_options.chunk_naming;
        this_bundler.options.asset_naming = ctx.bundler_options.asset_naming;
        this_bundler.resolver.opts.entry_naming = ctx.bundler_options.entry_naming;
        this_bundler.resolver.opts.chunk_naming = ctx.bundler_options.chunk_naming;
        this_bundler.resolver.opts.asset_naming = ctx.bundler_options.asset_naming;

        this_bundler.options.react_server_components = ctx.bundler_options.react_server_components;
        this_bundler.resolver.opts.react_server_components = ctx.bundler_options.react_server_components;

        this_bundler.options.code_splitting = ctx.bundler_options.code_splitting;
        this_bundler.resolver.opts.code_splitting = ctx.bundler_options.code_splitting;

        this_bundler.options.minify_syntax = ctx.bundler_options.minify_syntax;
        this_bundler.resolver.opts.minify_syntax = ctx.bundler_options.minify_syntax;

        this_bundler.options.minify_whitespace = ctx.bundler_options.minify_whitespace;
        this_bundler.resolver.opts.minify_whitespace = ctx.bundler_options.minify_whitespace;

        this_bundler.options.minify_identifiers = ctx.bundler_options.minify_identifiers;
        this_bundler.resolver.opts.minify_identifiers = ctx.bundler_options.minify_identifiers;

        if (ctx.bundler_options.compile) {
            if (ctx.bundler_options.code_splitting) {
                Output.prettyErrorln("<r><red>error<r><d>:<r> cannot use --compile with --splitting", .{});
                Global.exit(1);
                return;
            }

            if (this_bundler.options.entry_points.len > 1) {
                Output.prettyErrorln("<r><red>error<r><d>:<r> multiple entry points are not supported with --compile", .{});
                Global.exit(1);
                return;
            }

            if (ctx.bundler_options.outdir.len > 0) {
                Output.prettyErrorln("<r><red>error<r><d>:<r> cannot use --compile with --outdir", .{});
                Global.exit(1);
                return;
            }

            const base_public_path = bun.StandaloneModuleGraph.targetBasePublicPath(compile_target.os, "root/");

            this_bundler.options.public_path = base_public_path;
            this_bundler.resolver.opts.public_path = base_public_path;

            if (outfile.len == 0) {
                outfile = std.fs.path.basename(this_bundler.options.entry_points[0]);
                const ext = std.fs.path.extension(outfile);
                if (ext.len > 0) {
                    outfile = outfile[0 .. outfile.len - ext.len];
                }

                if (strings.eqlComptime(outfile, "index")) {
                    outfile = std.fs.path.basename(std.fs.path.dirname(this_bundler.options.entry_points[0]) orelse "index");
                }

                if (strings.eqlComptime(outfile, "bun")) {
                    outfile = std.fs.path.basename(std.fs.path.dirname(this_bundler.options.entry_points[0]) orelse "bun");
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

        if (ctx.bundler_options.outdir.len == 0) {
            if (this_bundler.options.entry_points.len > 1) {
                Output.prettyErrorln("<r><red>error<r><d>:<r> Must use <b>--outdir<r> when specifying more than one entry point.", .{});
                Global.exit(1);
                return;
            }
            if (this_bundler.options.code_splitting) {
                Output.prettyErrorln("<r><red>error<r><d>:<r> Must use <b>--outdir<r> when code splitting is enabled", .{});
                Global.exit(1);
                return;
            }
        }

        this_bundler.options.output_dir = ctx.bundler_options.outdir;
        this_bundler.resolver.opts.output_dir = ctx.bundler_options.outdir;

        var src_root_dir_buf: bun.PathBuffer = undefined;
        const src_root_dir: string = brk1: {
            const path = brk2: {
                if (ctx.bundler_options.root_dir.len > 0) {
                    break :brk2 ctx.bundler_options.root_dir;
                }

                if (this_bundler.options.entry_points.len == 1) {
                    break :brk2 std.fs.path.dirname(this_bundler.options.entry_points[0]) orelse ".";
                }

                break :brk2 resolve_path.getIfExistsLongestCommonPath(this_bundler.options.entry_points) orelse ".";
            };

            var dir = bun.openDirForPath(&(try std.posix.toPosixPath(path))) catch |err| {
                Output.prettyErrorln("<r><red>{s}<r> opening root directory {}", .{ @errorName(err), bun.fmt.quote(path) });
                Global.exit(1);
            };
            defer dir.close();

            break :brk1 bun.getFdPath(bun.toFD(dir.fd), &src_root_dir_buf) catch |err| {
                Output.prettyErrorln("<r><red>{s}<r> resolving root directory {}", .{ @errorName(err), bun.fmt.quote(path) });
                Global.exit(1);
            };
        };

        this_bundler.options.root_dir = src_root_dir;
        this_bundler.resolver.opts.root_dir = src_root_dir;

        this_bundler.options.react_server_components = ctx.bundler_options.react_server_components;
        this_bundler.resolver.opts.react_server_components = ctx.bundler_options.react_server_components;
        this_bundler.options.code_splitting = ctx.bundler_options.code_splitting;
        this_bundler.resolver.opts.code_splitting = ctx.bundler_options.code_splitting;
        this_bundler.options.transform_only = ctx.bundler_options.transform_only;
        if (this_bundler.options.transform_only) {
            this_bundler.options.resolve_mode = .disable;
        }

        this_bundler.configureLinker();

        // This step is optional
        // If it fails for any reason, ignore it and continue bundling
        // This is partially a workaround for the 'error.MissingRoutesDir' error
        this_bundler.configureRouter(true) catch {
            this_bundler.options.routes.routes_enabled = false;
            this_bundler.options.framework = null;
            if (this_bundler.router) |*router| {
                router.config.routes_enabled = false;
                router.config.single_page_app_routing = false;
                router.config.static_dir_enabled = false;
                this_bundler.router = null;
            }
        };

        this_bundler.options.jsx.development = !this_bundler.options.production;
        this_bundler.resolver.opts.jsx.development = this_bundler.options.jsx.development;

        switch (ctx.debug.macros) {
            .disable => {
                this_bundler.options.no_macros = true;
            },
            .map => |macros| {
                this_bundler.options.macro_remap = macros;
            },
            .unspecified => {},
        }

        // var env_loader = this_bundler.env;

        if (ctx.debug.dump_environment_variables) {
            this_bundler.dumpEnvironmentVariables();
            return;
        }

        var reachable_file_count: usize = 0;
        var minify_duration: u64 = 0;
        var input_code_length: u64 = 0;

        const output_files: []options.OutputFile = brk: {
            if (ctx.bundler_options.transform_only) {
                this_bundler.options.import_path_format = .relative;
                this_bundler.options.allow_runtime = false;
                this_bundler.resolver.opts.allow_runtime = false;

                // TODO: refactor this .transform function
                const result = try this_bundler.transform(
                    ctx.allocator,
                    ctx.log,
                    ctx.args,
                );

                if (log.hasErrors()) {
                    try log.printForLogLevel(Output.errorWriter());

                    if (result.errors.len > 0 or result.output_files.len == 0) {
                        Output.flush();
                        exitOrWatch(1, ctx.debug.hot_reload == .watch);
                        unreachable;
                    }
                }

                break :brk result.output_files;
            }

            break :brk (BundleV2.generateFromCLI(
                &this_bundler,
                allocator,
                bun.JSC.AnyEventLoop.init(ctx.allocator),
                std.crypto.random.int(u64),
                ctx.debug.hot_reload == .watch,
                &reachable_file_count,
                &minify_duration,
                &input_code_length,
            ) catch |err| {
                if (log.msgs.items.len > 0) {
                    try log.printForLogLevel(Output.errorWriter());
                } else {
                    try Output.errorWriter().print("error: {s}", .{@errorName(err)});
                }

                Output.flush();
                exitOrWatch(1, ctx.debug.hot_reload == .watch);
                unreachable;
            }).items;
        };
        const bundled_end = std.time.nanoTimestamp();

        {
            var write_summary = false;
            {
                dump: {
                    defer Output.flush();
                    var writer = Output.writer();
                    var output_dir = this_bundler.options.output_dir;

                    const will_be_one_file =
                        // --outdir is not supported with --compile
                        // but you can still use --outfile
                        // in which case, we should set the output dir to the dirname of the outfile
                        // https://github.com/oven-sh/bun/issues/8697
                        ctx.bundler_options.compile or
                        (output_files.len == 1 and output_files[0].value == .buffer);

                    if (output_dir.len == 0 and outfile.len > 0 and will_be_one_file) {
                        output_dir = std.fs.path.dirname(outfile) orelse ".";
                        output_files[0].dest_path = std.fs.path.basename(outfile);
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
                            Output.prettyErrorln("<r><red>{s}<r> while attemping to open output directory {}", .{ @errorName(err), bun.fmt.quote(root_path) });
                            exitOrWatch(1, ctx.debug.hot_reload == .watch);
                            unreachable;
                        };

                    const all_paths = try ctx.allocator.alloc([]const u8, output_files.len);
                    var max_path_len: usize = 0;
                    for (all_paths, output_files) |*dest, src| {
                        dest.* = src.dest_path;
                    }

                    const from_path = resolve_path.longestCommonPath(all_paths);

                    for (output_files) |f| {
                        max_path_len = @max(
                            @max(from_path.len, f.dest_path.len) + 2 - from_path.len,
                            max_path_len,
                        );
                    }

                    if (ctx.bundler_options.compile) {
                        printSummary(
                            bundled_end,
                            minify_duration,
                            this_bundler.options.minify_identifiers or this_bundler.options.minify_whitespace or this_bundler.options.minify_syntax,
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
                        }

                        try bun.StandaloneModuleGraph.toExecutable(
                            compile_target,
                            allocator,
                            output_files,
                            root_dir,
                            this_bundler.options.public_path,
                            outfile,
                            this_bundler.env,
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

                    // On posix, file handles automatically close on process exit by the OS
                    // Closing files shows up in profiling.
                    // So don't do that unless we actually need to.
                    // const do_we_need_to_close = !FeatureFlags.store_file_descriptors or (@intCast(usize, root_dir.fd) + open_file_limit) < output_files.len;

                    var filepath_buf: bun.PathBuffer = undefined;
                    filepath_buf[0] = '.';
                    filepath_buf[1] = '/';

                    for (output_files) |f| {
                        var rel_path: []const u8 = undefined;
                        switch (f.value) {
                            // Nothing to do in this case
                            .saved => {
                                rel_path = f.dest_path;
                                if (f.dest_path.len > from_path.len) {
                                    rel_path = resolve_path.relative(from_path, f.dest_path);
                                }
                            },

                            // easy mode: write the buffer
                            .buffer => |value| {
                                rel_path = f.dest_path;
                                if (f.dest_path.len > from_path.len) {
                                    rel_path = resolve_path.relative(from_path, f.dest_path);
                                    if (std.fs.path.dirname(rel_path)) |parent| {
                                        if (parent.len > root_path.len) {
                                            try root_dir.makePath(parent);
                                        }
                                    }
                                }
                                const JSC = bun.JSC;
                                var path_buf: bun.PathBuffer = undefined;
                                switch (JSC.Node.NodeFS.writeFileWithPathBuffer(
                                    &path_buf,
                                    JSC.Node.Arguments.WriteFile{
                                        .data = JSC.Node.StringOrBuffer{
                                            .buffer = JSC.Buffer{
                                                .buffer = .{
                                                    .ptr = @constCast(value.bytes.ptr),
                                                    // TODO: handle > 4 GB files
                                                    .len = @as(u32, @truncate(value.bytes.len)),
                                                    .byte_len = @as(u32, @truncate(value.bytes.len)),
                                                },
                                            },
                                        },
                                        .encoding = .buffer,
                                        .mode = if (f.is_executable) 0o755 else 0o644,
                                        .dirfd = bun.toFD(root_dir.fd),
                                        .file = .{
                                            .path = JSC.Node.PathLike{
                                                .string = JSC.PathString.init(rel_path),
                                            },
                                        },
                                    },
                                )) {
                                    .err => |err| {
                                        Output.prettyErrorln("<r><red>error<r><d>:<r> failed to write file <b>{}<r>\n{}", .{ bun.fmt.quote(rel_path), err });
                                    },
                                    .result => {},
                                }
                            },
                            .move => |value| {
                                const primary = f.dest_path[from_path.len..];
                                bun.copy(u8, filepath_buf[2..], primary);
                                rel_path = filepath_buf[0 .. primary.len + 2];
                                rel_path = value.pathname;

                                try f.moveTo(root_path, @constCast(rel_path), bun.toFD(root_dir.fd));
                            },
                            .copy => |value| {
                                rel_path = value.pathname;

                                try f.copyTo(root_path, @constCast(rel_path), bun.toFD(root_dir.fd));
                            },
                            .noop => {},
                            .pending => unreachable,
                        }

                        // Print summary
                        _ = try writer.write("\n");
                        const padding_count = 2 + (@max(rel_path.len, max_path_len) - rel_path.len);
                        try writer.writeByteNTimes(' ', 2);
                        try writer.writeAll(rel_path);
                        try writer.writeByteNTimes(' ', padding_count);
                        const size = @as(f64, @floatFromInt(f.size)) / 1000.0;
                        try std.fmt.formatType(size, "d", .{ .precision = 2 }, writer, 1);
                        try writer.writeAll(" KB\n");
                    }

                    write_summary = true;
                }
                if (write_summary and log.errors == 0) {
                    Output.prettyln("\n", .{});
                    Output.printElapsedStdoutTrim(
                        @as(f64, @floatFromInt((@divTrunc(@as(i64, @truncate(std.time.nanoTimestamp() - bun.CLI.start_time)), @as(i64, std.time.ns_per_ms))))),
                    );
                    if (this_bundler.options.transform_only) {
                        Output.prettyln(" <green>transpile<r>", .{});
                    } else {
                        Output.prettyln(" <green>bundle<r> {d} modules", .{
                            reachable_file_count,
                        });
                    }
                }
            }

            try log.printForLogLevel(Output.errorWriter());
            exitOrWatch(0, ctx.debug.hot_reload == .watch);
        }
    }
};

fn exitOrWatch(code: u8, watch: bool) void {
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
                    bun.fmt.size(@as(usize, @intCast(delta))),
                },
            );
        } else if (-delta > 1024) {
            Output.prettyln(
                "  <b>minify<r>   +{} <d>(estimate)<r>",
                .{
                    bun.fmt.size(@as(usize, @intCast(-delta))),
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
