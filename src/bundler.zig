usingnamespace @import("global.zig");

const std = @import("std");
const lex = @import("js_lexer.zig");
const logger = @import("logger.zig");
const alloc = @import("alloc.zig");
const options = @import("options.zig");
const js_parser = @import("js_parser.zig");
const json_parser = @import("json_parser.zig");
const js_printer = @import("js_printer.zig");
const js_ast = @import("js_ast.zig");
const linker = @import("linker.zig");
usingnamespace @import("ast/base.zig");
usingnamespace @import("defines.zig");
const panicky = @import("panic_handler.zig");
const fs = @import("fs.zig");
const Api = @import("api/schema.zig").Api;

pub const Bundler = struct {
    options: options.BundleOptions,
    log: *logger.Log,
    allocator: *std.mem.Allocator,
    result: ?options.TransformResult = null,

    pub fn init(
        allocator: *std.mem.Allocator,
        log: *logger.Log,
        opts: Api.TransformOptions,
    ) !Bundler {}

    pub fn bundle(
        allocator: *std.mem.Allocator,
        log: *logger.Log,
        opts: Api.TransformOptions,
    ) !options.TransformResult {
        Global.notimpl();
    }
};

pub const Transformer = struct {
    options: options.TransformOptions,
    log: *logger.Log,
    allocator: *std.mem.Allocator,
    result: ?options.TransformResult = null,

    pub fn transform(
        allocator: *std.mem.Allocator,
        log: *logger.Log,
        opts: Api.TransformOptions,
    ) !options.TransformResult {
        var raw_defines = try options.stringHashMapFromArrays(RawDefines, allocator, opts.define_keys, opts.define_values);
        if (opts.define_keys.len == 0) {
            try raw_defines.put("process.env.NODE_ENV", "\"development\"");
        }

        var user_defines = try DefineData.from_input(raw_defines, log, alloc.static);
        var define = try Define.init(
            alloc.static,
            user_defines,
        );

        const cwd = opts.absolute_working_dir orelse try std.process.getCwdAlloc(allocator);
        const output_dir_parts = [_]string{ cwd, opts.output_dir orelse "out" };
        const output_dir = try std.fs.path.join(allocator, &output_dir_parts);
        var output_files = try std.ArrayList(options.OutputFile).initCapacity(allocator, opts.entry_points.len);
        var loader_values = try allocator.alloc(options.Loader, opts.loader_values.len);
        for (loader_values) |_, i| {
            const loader = switch (opts.loader_values[i]) {
                .jsx => options.Loader.jsx,
                .js => options.Loader.js,
                .ts => options.Loader.ts,
                .css => options.Loader.css,
                .tsx => options.Loader.tsx,
                .json => options.Loader.json,
                else => unreachable,
            };

            loader_values[i] = loader;
        }
        var loader_map = try options.stringHashMapFromArrays(
            std.StringHashMap(options.Loader),
            allocator,
            opts.loader_keys,
            loader_values,
        );
        var use_default_loaders = loader_map.count() == 0;

        var jsx = if (opts.jsx) |_jsx| options.JSX.Pragma.fromApi(_jsx) else options.JSX.Pragma{};

        var output_i: usize = 0;
        for (opts.entry_points) |entry_point, i| {
            var _log = logger.Log.init(allocator);
            var __log = &_log;
            var paths = [_]string{ cwd, entry_point };
            const absolutePath = try std.fs.path.resolve(alloc.dynamic, &paths);

            const file = try std.fs.openFileAbsolute(absolutePath, std.fs.File.OpenFlags{ .read = true });
            defer file.close();
            const stat = try file.stat();

            const code = try file.readToEndAlloc(alloc.dynamic, stat.size);
            defer {
                if (_log.msgs.items.len == 0) {
                    allocator.free(code);
                }
                alloc.dynamic.free(absolutePath);
                _log.appendTo(log) catch {};
            }
            const _file = fs.File{ .path = fs.Path.init(entry_point), .contents = code };
            var source = try logger.Source.initFile(_file, alloc.dynamic);
            var loader: options.Loader = undefined;
            if (use_default_loaders) {
                loader = options.defaultLoaders.get(std.fs.path.extension(absolutePath)) orelse continue;
            } else {
                loader = options.Loader.forFileName(
                    entry_point,
                    loader_map,
                ) orelse continue;
            }

            jsx.parse = loader.isJSX();

            const parser_opts = js_parser.Parser.Options.init(jsx, loader);
            var _source = &source;
            const res = _transform(allocator, allocator, __log, parser_opts, loader, define, _source) catch continue;

            const relative_path = try std.fs.path.relative(allocator, cwd, absolutePath);
            var out_parts = [_]string{ output_dir, relative_path };
            const out_path = try std.fs.path.join(allocator, &out_parts);
            try output_files.append(options.OutputFile{ .path = out_path, .contents = res.js });
        }

        return try options.TransformResult.init(output_files.toOwnedSlice(), log, allocator);
    }

    pub fn _transform(
        allocator: *std.mem.Allocator,
        result_allocator: *std.mem.Allocator,
        log: *logger.Log,
        opts: js_parser.Parser.Options,
        loader: options.Loader,
        define: *Define,
        source: *logger.Source,
    ) !js_printer.PrintResult {
        var ast: js_ast.Ast = undefined;

        switch (loader) {
            .json => {
                var expr = try json_parser.ParseJSON(source, log, allocator);
                var stmt = js_ast.Stmt.alloc(allocator, js_ast.S.ExportDefault{
                    .value = js_ast.StmtOrExpr{ .expr = expr },
                    .default_name = js_ast.LocRef{ .loc = logger.Loc{}, .ref = Ref{} },
                }, logger.Loc{ .start = 0 });

                var part = js_ast.Part{
                    .stmts = &([_]js_ast.Stmt{stmt}),
                };

                ast = js_ast.Ast.initTest(&([_]js_ast.Part{part}));
            },
            .jsx, .tsx, .ts, .js => {
                var parser = try js_parser.Parser.init(opts, log, source, define, alloc.dynamic);
                var res = try parser.parse();
                ast = res.ast;
            },
            else => {
                Global.panic("Unsupported loader: {s}", .{loader});
            },
        }

        var _linker = linker.Linker{};
        var symbols: [][]js_ast.Symbol = &([_][]js_ast.Symbol{ast.symbols});

        return try js_printer.printAst(
            result_allocator,
            ast,
            js_ast.Symbol.Map.initList(symbols),
            source,
            false,
            js_printer.Options{ .to_module_ref = ast.module_ref orelse js_ast.Ref{ .inner_index = 0 } },
            &_linker,
        );
    }
};
