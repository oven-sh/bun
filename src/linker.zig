usingnamespace @import("global.zig");
usingnamespace @import("./ast/base.zig");

const std = @import("std");
const lex = @import("js_lexer.zig");
const logger = @import("logger.zig");
const alloc = @import("alloc.zig");
const Options = @import("options.zig");
const js_parser = @import("js_parser.zig");
const json_parser = @import("json_parser.zig");
const js_printer = @import("js_printer.zig");
const js_ast = @import("js_ast.zig");
const panicky = @import("panic_handler.zig");
const Fs = @import("fs.zig");
const Api = @import("api/schema.zig").Api;
const Resolver = @import("./resolver/resolver.zig");
const sync = @import("sync.zig");
const ThreadPool = sync.ThreadPool;
const ThreadSafeHashMap = @import("./thread_safe_hash_map.zig");
const _import_record = @import("./import_record.zig");
const ImportRecord = _import_record.ImportRecord;
const ImportKind = _import_record.ImportKind;
const allocators = @import("./allocators.zig");
const MimeType = @import("./http/mime_type.zig");
const resolve_path = @import("./resolver/resolve_path.zig");
const _bundler = @import("./bundler.zig");
const Bundler = _bundler.Bundler;
const ResolveQueue = _bundler.ResolveQueue;
const Runtime = @import("./runtime.zig").Runtime;

pub const CSSResolveError = error{ResolveError};

pub const OnImportCallback = fn (resolve_result: *const Resolver.Result, import_record: *ImportRecord, source_dir: string) void;

pub fn NewLinker(comptime BundlerType: type) type {
    return struct {
        const HashedFileNameMap = std.AutoHashMap(u64, string);
        const ThisLinker = @This();
        allocator: *std.mem.Allocator,
        options: *Options.BundleOptions,
        fs: *Fs.FileSystem,
        log: *logger.Log,
        resolve_queue: *ResolveQueue,
        resolver: *BundlerType.Resolver,
        resolve_results: *_bundler.ResolveResults,
        any_needs_runtime: bool = false,
        runtime_import_record: ?ImportRecord = null,
        runtime_source_path: string,
        hashed_filenames: HashedFileNameMap,
        import_counter: usize = 0,

        onImportCSS: ?OnImportCallback = null,

        pub fn init(
            allocator: *std.mem.Allocator,
            log: *logger.Log,
            resolve_queue: *ResolveQueue,
            options: *Options.BundleOptions,
            resolver: *BundlerType.Resolver,
            resolve_results: *_bundler.ResolveResults,
            fs: *Fs.FileSystem,
        ) ThisLinker {
            relative_paths_list = ImportPathsList.init(allocator);

            return ThisLinker{
                .allocator = allocator,
                .options = options,
                .fs = fs,
                .log = log,
                .resolve_queue = resolve_queue,
                .resolver = resolver,
                .resolve_results = resolve_results,
                .runtime_source_path = fs.absAlloc(allocator, &([_]string{"__runtime.js"})) catch unreachable,
                .hashed_filenames = HashedFileNameMap.init(allocator),
            };
        }

        // fs: fs.FileSystem,
        // TODO:
        pub fn requireOrImportMetaForSource(c: ThisLinker, source_index: Ref.Int) RequireOrImportMeta {
            return RequireOrImportMeta{};
        }

        pub fn getHashedFilename(
            this: *ThisLinker,
            file_path: Fs.Path,
            fd: ?FileDescriptorType,
        ) !string {
            if (BundlerType.isCacheEnabled) {
                var hashed = std.hash.Wyhash.hash(0, file_path.text);
                var hashed_result = try this.hashed_filenames.getOrPut(hashed);
                if (hashed_result.found_existing) {
                    return hashed_result.value_ptr.*;
                }
            }

            var file: std.fs.File = if (fd) |_fd| std.fs.File{ .handle = _fd } else try std.fs.openFileAbsolute(file_path.text, .{ .read = true });
            Fs.FileSystem.setMaxFd(file.handle);
            var modkey = try Fs.FileSystem.RealFS.ModKey.generate(&this.fs.fs, file_path.text, file);
            const hash_name = try modkey.hashName(file_path.name.base);

            if (BundlerType.isCacheEnabled) {
                var hashed = std.hash.Wyhash.hash(0, file_path.text);
                try this.hashed_filenames.put(hashed, try this.allocator.dupe(u8, hash_name));
            }

            if (this.fs.fs.needToCloseFiles() and fd == null) {
                file.close();
            }

            return hash_name;
        }

        pub fn resolveCSS(
            this: anytype,
            path: Fs.Path,
            url: string,
            range: logger.Range,
            kind: ImportKind,
            comptime import_path_format: Options.BundleOptions.ImportPathFormat,
            comptime resolve_only: bool,
        ) !string {
            const dir = path.name.dirWithTrailingSlash();

            switch (kind) {
                .at => {
                    var resolve_result = try this.resolver.resolve(dir, url, .at);
                    if (resolve_only or resolve_result.is_external) {
                        return resolve_result.path_pair.primary.text;
                    }

                    var import_record = ImportRecord{ .range = range, .path = resolve_result.path_pair.primary, .kind = kind };

                    const loader = this.options.loaders.get(resolve_result.path_pair.primary.name.ext) orelse .file;

                    this.processImportRecord(loader, dir, &resolve_result, &import_record, import_path_format) catch unreachable;
                    return import_record.path.text;
                },
                .at_conditional => {
                    var resolve_result = try this.resolver.resolve(dir, url, .at_conditional);
                    if (resolve_only or resolve_result.is_external) {
                        return resolve_result.path_pair.primary.text;
                    }

                    var import_record = ImportRecord{ .range = range, .path = resolve_result.path_pair.primary, .kind = kind };
                    const loader = this.options.loaders.get(resolve_result.path_pair.primary.name.ext) orelse .file;

                    this.processImportRecord(loader, dir, &resolve_result, &import_record, import_path_format) catch unreachable;
                    return import_record.path.text;
                },
                .url => {
                    var resolve_result = try this.resolver.resolve(dir, url, .url);
                    if (resolve_only or resolve_result.is_external) {
                        return resolve_result.path_pair.primary.text;
                    }

                    var import_record = ImportRecord{ .range = range, .path = resolve_result.path_pair.primary, .kind = kind };
                    const loader = this.options.loaders.get(resolve_result.path_pair.primary.name.ext) orelse .file;

                    this.processImportRecord(loader, dir, &resolve_result, &import_record, import_path_format) catch unreachable;
                    return import_record.path.text;
                },
                else => unreachable,
            }
            unreachable;
        }

        pub inline fn nodeModuleBundleImportPath(this: *const ThisLinker) string {
            return if (this.options.node_modules_bundle_url.len > 0) this.options.node_modules_bundle_url else this.options.node_modules_bundle.?.bundle.import_from_name;
        }

        // pub const Scratch = struct {
        //     threadlocal var externals: std.ArrayList(u32) = undefined;
        //     threadlocal var has_externals: std.ArrayList(u32) = undefined;
        //     pub fn externals() {

        //     }
        // };
        // This modifies the Ast in-place!
        // But more importantly, this does the following:
        // - Wrap CommonJS files
        pub fn link(
            linker: *ThisLinker,
            file_path: Fs.Path,
            result: *_bundler.ParseResult,
            comptime import_path_format: Options.BundleOptions.ImportPathFormat,
            comptime ignore_runtime: bool,
        ) !void {
            var needs_runtime = result.ast.uses_exports_ref or result.ast.uses_module_ref or result.ast.runtime_imports.hasAny();
            const source_dir = if (file_path.is_symlink and file_path.pretty.len > 0 and import_path_format == .absolute_url and linker.options.platform != .bun)
                Fs.PathName.init(file_path.pretty).dirWithTrailingSlash()
            else
                file_path.sourceDir();
            var externals = std.ArrayList(u32).init(linker.allocator);
            var needs_bundle = false;
            var first_bundled_index: ?u32 = null;

            // Step 1. Resolve imports & requires
            switch (result.loader) {
                .jsx, .js, .ts, .tsx => {
                    for (result.ast.import_records) |*import_record, _record_index| {
                        if (import_record.is_unused) continue;

                        const record_index = @truncate(u32, _record_index);
                        if (comptime !ignore_runtime) {
                            if (strings.eqlComptime(import_record.path.text, Runtime.Imports.Name)) {
                                // runtime is included in the bundle, so we don't need to dynamically import it
                                if (linker.options.node_modules_bundle != null) {
                                    import_record.path.text = linker.nodeModuleBundleImportPath();
                                } else {
                                    import_record.path = try linker.generateImportPath(
                                        source_dir,
                                        linker.runtime_source_path,
                                        Runtime.version(),
                                        false,
                                        import_path_format,
                                    );
                                    result.ast.runtime_import_record_id = record_index;
                                    result.ast.needs_runtime = true;
                                }
                                continue;
                            }
                        }

                        if (linker.resolver.resolve(source_dir, import_record.path.text, import_record.kind)) |*_resolved_import| {
                            const resolved_import: *const Resolver.Result = _resolved_import;
                            if (resolved_import.is_external) {
                                externals.append(record_index) catch unreachable;
                                continue;
                            }

                            const path = resolved_import.pathConst() orelse {
                                import_record.path.is_disabled = true;
                                continue;
                            };

                            const loader = linker.options.loader(path.name.ext);
                            if (loader.isJavaScriptLikeOrJSON()) {
                                bundled: {
                                    if (linker.options.node_modules_bundle) |node_modules_bundle| {
                                        const package_json_ = resolved_import.package_json orelse brk: {
                                            if (resolved_import.isLikelyNodeModule()) {
                                                break :brk linker.resolver.packageJSONForResolvedNodeModule(resolved_import);
                                            }

                                            break :bundled;
                                        };
                                        if (package_json_) |package_json| {
                                            const package_base_dir = package_json.source.path.sourceDir();
                                            const node_module_root = std.fs.path.sep_str ++ "node_modules" ++ std.fs.path.sep_str;
                                            if (strings.lastIndexOf(package_base_dir, node_module_root)) |last_node_modules| {
                                                if (node_modules_bundle.getPackageIDByName(package_json.name)) |possible_pkg_ids| {
                                                    const pkg_id: u32 = brk: {
                                                        for (possible_pkg_ids) |pkg_id| {
                                                            const pkg = node_modules_bundle.bundle.packages[pkg_id];
                                                            if (pkg.hash == package_json.hash) {
                                                                break :brk pkg_id;
                                                            }
                                                        }

                                                        linker.log.addErrorFmt(
                                                            null,
                                                            logger.Loc.Empty,
                                                            linker.allocator,
                                                            "\"{s}\" version changed, please regenerate the .bun.\nOld version: \"{s}\"\nNew version: \"{s}\"\nRun this command:\nbun bun",
                                                            .{
                                                                package_json.name,
                                                                node_modules_bundle.str(node_modules_bundle.bundle.packages[possible_pkg_ids[0]].version),
                                                                package_json.version,
                                                            },
                                                        ) catch {};
                                                        return error.RunBunBun;
                                                    };

                                                    const package = &node_modules_bundle.bundle.packages[pkg_id];

                                                    if (comptime isDebug) {
                                                        std.debug.assert(strings.eql(node_modules_bundle.str(package.name), package_json.name));
                                                    }

                                                    const package_relative_path = linker.fs.relative(
                                                        package_base_dir,
                                                        if (!strings.eqlComptime(path.namespace, "node")) path.pretty else path.text,
                                                    );

                                                    const found_module = node_modules_bundle.findModuleInPackage(package, package_relative_path) orelse {
                                                        linker.log.addErrorFmt(
                                                            null,
                                                            logger.Loc.Empty,
                                                            linker.allocator,
                                                            "New dependency import: \"{s}/{s}\"\nPlease run `bun bun` to update the .bun.",
                                                            .{
                                                                package_json.name,
                                                                package_relative_path,
                                                            },
                                                        ) catch {};
                                                        break :bundled;
                                                    };

                                                    if (comptime isDebug) {
                                                        const module_path = node_modules_bundle.str(found_module.path);
                                                        std.debug.assert(
                                                            strings.eql(
                                                                module_path,
                                                                package_relative_path,
                                                            ),
                                                        );
                                                    }

                                                    import_record.is_bundled = true;
                                                    import_record.path.text = linker.nodeModuleBundleImportPath();
                                                    import_record.module_id = found_module.id;
                                                    needs_bundle = true;
                                                    continue;
                                                }
                                            }
                                        }
                                    }
                                }
                            }

                            linker.processImportRecord(
                                loader,

                                // Include trailing slash
                                source_dir,
                                resolved_import,
                                import_record,
                                import_path_format,
                            ) catch continue;

                            // If we're importing a CommonJS module as ESM
                            // We need to do the following transform:
                            //      import React from 'react';
                            //      =>
                            //      import {_require} from 'RUNTIME_IMPORTS';
                            //      import * as react_module from 'react';
                            //      var React = _require(react_module).default;
                            // UNLESS it's a namespace import
                            // If it's a namespace import, assume it's safe.
                            // We can do this in the printer instead of creating a bunch of AST nodes here.
                            // But we need to at least tell the printer that this needs to happen.
                            if (result.ast.exports_kind != .cjs and (import_record.kind == .require or (import_record.kind == .stmt and resolved_import.shouldAssumeCommonJS(import_record)))) {
                                import_record.wrap_with_to_module = true;
                                result.ast.needs_runtime = true;
                            }
                        } else |err| {
                            switch (err) {
                                error.ModuleNotFound => {
                                    if (Resolver.isPackagePath(import_record.path.text)) {
                                        if (linker.options.platform.isWebLike() and Options.ExternalModules.isNodeBuiltin(import_record.path.text)) {
                                            try linker.log.addResolveError(
                                                &result.source,
                                                import_record.range,
                                                linker.allocator,
                                                "Could not resolve: \"{s}\". Try setting --platform=\"node\"",
                                                .{import_record.path.text},
                                                import_record.kind,
                                            );
                                        } else {
                                            try linker.log.addResolveError(
                                                &result.source,
                                                import_record.range,
                                                linker.allocator,
                                                "Could not resolve: \"{s}\". Maybe you need to \"npm install\" (or yarn/pnpm)?",
                                                .{import_record.path.text},
                                                import_record.kind,
                                            );
                                        }
                                    } else {
                                        try linker.log.addResolveError(
                                            &result.source,
                                            import_record.range,
                                            linker.allocator,
                                            "Could not resolve: \"{s}\"",
                                            .{
                                                import_record.path.text,
                                            },
                                            import_record.kind,
                                        );
                                        continue;
                                    }
                                },
                                else => {
                                    continue;
                                },
                            }
                        }
                    }
                },
                else => {},
            }
            result.ast.externals = externals.toOwnedSlice();

            if (result.ast.needs_runtime and result.ast.runtime_import_record_id == null) {
                var import_records = try linker.allocator.alloc(ImportRecord, result.ast.import_records.len + 1);
                std.mem.copy(ImportRecord, import_records, result.ast.import_records);
                import_records[import_records.len - 1] = ImportRecord{
                    .kind = .stmt,
                    .path = try linker.generateImportPath(
                        source_dir,
                        linker.runtime_source_path,
                        Runtime.version(),
                        false,
                        import_path_format,
                    ),
                    .range = logger.Range{ .loc = logger.Loc{ .start = 0 }, .len = 0 },
                };
            }

            // This is a bad idea
            // I don't think it's safe to do this
            const ImportStatementSorter = struct {
                import_records: []ImportRecord,
                pub fn lessThan(ctx: @This(), lhs: js_ast.Stmt, rhs: js_ast.Stmt) bool {
                    switch (lhs.data) {
                        .s_import => |li| {
                            switch (rhs.data) {
                                .s_import => |ri| {
                                    const a = ctx.import_records[li.import_record_index];
                                    const b = ctx.import_records[ri.import_record_index];
                                    if (a.is_bundled and !b.is_bundled) {
                                        return false;
                                    } else {
                                        return true;
                                    }
                                },
                                else => {
                                    return true;
                                },
                            }
                        },
                        else => {
                            switch (rhs.data) {
                                .s_import => |ri| {
                                    const a = ctx.import_records[ri.import_record_index];
                                    if (!a.is_bundled) {
                                        return false;
                                    } else {
                                        return true;
                                    }
                                },
                                else => {
                                    return true;
                                },
                            }
                        },
                    }
                }
            };

            // std.sort.sort(comptime T: type, items: []T, context: anytype, comptime lessThan: fn(context:@TypeOf(context), lhs:T, rhs:T)bool)

            // Change the import order so that any bundled imports appear last
            // This is to make it so the bundle (which should be quite large) is least likely to block rendering
            // if (needs_bundle) {
            //     const sorter = ImportStatementSorter{ .import_records = result.ast.import_records };
            //     for (result.ast.parts) |*part, i| {
            //         std.sort.sort(js_ast.Stmt, part.stmts, sorter, ImportStatementSorter.lessThan);
            //     }
            // }
        }

        const ImportPathsList = allocators.BSSStringList(512, 128);
        pub var relative_paths_list: *ImportPathsList = undefined;

        pub fn generateImportPath(
            linker: *ThisLinker,
            source_dir: string,
            source_path: string,
            package_version: ?string,
            use_hashed_name: bool,
            comptime import_path_format: Options.BundleOptions.ImportPathFormat,
        ) !Fs.Path {
            switch (import_path_format) {
                .absolute_path => {
                    var relative_name = linker.fs.relative(source_dir, source_path);

                    return Fs.Path.initWithPretty(source_path, relative_name);
                },
                .relative => {
                    var relative_name = linker.fs.relative(source_dir, source_path);

                    var pretty: string = undefined;
                    if (use_hashed_name) {
                        var basepath = Fs.Path.init(source_path);
                        const basename = try linker.getHashedFilename(basepath, null);
                        var dir = basepath.name.dirWithTrailingSlash();
                        var _pretty = try linker.allocator.alloc(u8, dir.len + basename.len + basepath.name.ext.len);
                        std.mem.copy(u8, _pretty, dir);
                        var remaining_pretty = _pretty[dir.len..];
                        std.mem.copy(u8, remaining_pretty, basename);
                        remaining_pretty = remaining_pretty[basename.len..];
                        std.mem.copy(u8, remaining_pretty, basepath.name.ext);
                        pretty = _pretty;
                        relative_name = try linker.allocator.dupe(u8, relative_name);
                    } else {
                        pretty = try linker.allocator.dupe(u8, relative_name);
                        relative_name = pretty;
                    }

                    return Fs.Path.initWithPretty(pretty, relative_name);
                },
                .relative_nodejs => {
                    var relative_name = linker.fs.relative(source_dir, source_path);
                    var pretty: string = undefined;
                    if (use_hashed_name) {
                        var basepath = Fs.Path.init(source_path);
                        const basename = try linker.getHashedFilename(basepath, null);
                        var dir = basepath.name.dirWithTrailingSlash();
                        var _pretty = try linker.allocator.alloc(u8, dir.len + basename.len + basepath.name.ext.len);
                        std.mem.copy(u8, _pretty, dir);
                        var remaining_pretty = _pretty[dir.len..];
                        std.mem.copy(u8, remaining_pretty, basename);
                        remaining_pretty = remaining_pretty[basename.len..];
                        std.mem.copy(u8, remaining_pretty, basepath.name.ext);
                        pretty = _pretty;
                        relative_name = try linker.allocator.dupe(u8, relative_name);
                    } else {
                        pretty = try linker.allocator.dupe(u8, relative_name);
                        relative_name = pretty;
                    }

                    var pathname = Fs.PathName.init(pretty);
                    var path = Fs.Path.initWithPretty(pretty, relative_name);
                    path.text = path.text[0 .. path.text.len - path.name.ext.len];
                    return path;
                },

                .absolute_url => {
                    var absolute_pathname = Fs.PathName.init(source_path);

                    if (!linker.options.preserve_extensions) {
                        if (linker.options.out_extensions.get(absolute_pathname.ext)) |ext| {
                            absolute_pathname.ext = ext;
                        }
                    }

                    var base = linker.fs.relativeTo(source_path);
                    if (strings.lastIndexOfChar(base, '.')) |dot| {
                        base = base[0..dot];
                    }

                    var dirname = std.fs.path.dirname(base) orelse "";

                    var basename = std.fs.path.basename(base);

                    if (use_hashed_name) {
                        var basepath = Fs.Path.init(source_path);
                        basename = try linker.getHashedFilename(basepath, null);
                    }

                    return Fs.Path.init(try linker.options.origin.joinAlloc(
                        linker.allocator,
                        linker.options.routes.asset_prefix_path,
                        dirname,
                        basename,
                        absolute_pathname.ext,
                    ));
                },

                else => unreachable,
            }
        }

        pub fn processImportRecord(
            linker: *ThisLinker,
            loader: Options.Loader,
            source_dir: string,
            resolve_result: *const Resolver.Result,
            import_record: *ImportRecord,
            comptime import_path_format: Options.BundleOptions.ImportPathFormat,
        ) !void {
            linker.import_counter += 1;
            // lazy means:
            // Run the resolver
            // Don't parse/print automatically.
            if (linker.options.resolve_mode != .lazy) {
                _ = try linker.enqueueResolveResult(resolve_result);
            }
            const path = resolve_result.pathConst() orelse unreachable;

            import_record.path = try linker.generateImportPath(
                source_dir,
                if (path.is_symlink and import_path_format == .absolute_url and linker.options.platform != .bun) path.pretty else path.text,
                if (resolve_result.package_json) |package_json| package_json.version else "",
                BundlerType.isCacheEnabled and loader == .file,
                import_path_format,
            );

            switch (loader) {
                .css => {
                    if (linker.onImportCSS) |callback| {
                        callback(resolve_result, import_record, source_dir);
                    }
                    // This saves us a less reliable string check
                    import_record.print_mode = .css;
                },
                .file => {
                    import_record.print_mode = .import_path;
                },
                else => {},
            }
        }

        pub fn resolveResultHashKey(linker: *ThisLinker, resolve_result: *const Resolver.Result) u64 {
            const path = resolve_result.pathConst() orelse unreachable;
            var hash_key = path.text;

            // Shorter hash key is faster to hash
            if (strings.startsWith(path.text, linker.fs.top_level_dir)) {
                hash_key = path.text[linker.fs.top_level_dir.len..];
            }

            return std.hash.Wyhash.hash(0, hash_key);
        }

        pub fn enqueueResolveResult(linker: *ThisLinker, resolve_result: *const Resolver.Result) !bool {
            const hash_key = linker.resolveResultHashKey(resolve_result);

            const get_or_put_entry = try linker.resolve_results.getOrPut(hash_key);

            if (!get_or_put_entry.found_existing) {
                try linker.resolve_queue.writeItem(resolve_result.*);
            }

            return !get_or_put_entry.found_existing;
        }
    };
}

pub const Linker = NewLinker(_bundler.Bundler);
pub const ServeLinker = NewLinker(_bundler.ServeBundler);
