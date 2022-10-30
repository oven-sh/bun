const bun = @import("global.zig");
const string = bun.string;
const Output = bun.Output;
const Global = bun.Global;
const Environment = bun.Environment;
const strings = bun.strings;
const MutableString = bun.MutableString;
const stringZ = bun.stringZ;
const default_allocator = bun.default_allocator;
const FileDescriptorType = bun.FileDescriptorType;
const C = bun.C;
const Ref = @import("./ast/base.zig").Ref;

const std = @import("std");
const lex = @import("js_lexer.zig");
const logger = @import("logger.zig");
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
const _import_record = @import("./import_record.zig");
const ImportRecord = _import_record.ImportRecord;
const ImportKind = _import_record.ImportKind;
const allocators = @import("./allocators.zig");
const MimeType = @import("./http/mime_type.zig");
const resolve_path = @import("./resolver/resolve_path.zig");
const _bundler = @import("./bundler.zig");
const Bundler = _bundler.Bundler;
const ResolveQueue = _bundler.ResolveQueue;
const ResolverType = Resolver.Resolver;
const Runtime = @import("./runtime.zig").Runtime;
const URL = @import("url.zig").URL;
const JSC = @import("javascript_core");
const PluginRunner = @import("./bundler.zig").PluginRunner;
pub const CSSResolveError = error{ResolveError};

pub const OnImportCallback = fn (resolve_result: *const Resolver.Result, import_record: *ImportRecord, origin: URL) void;

pub const Linker = struct {
    const HashedFileNameMap = std.AutoHashMap(u64, string);
    const ThisLinker = @This();
    allocator: std.mem.Allocator,
    options: *Options.BundleOptions,
    fs: *Fs.FileSystem,
    log: *logger.Log,
    resolve_queue: *ResolveQueue,
    resolver: *ResolverType,
    resolve_results: *_bundler.ResolveResults,
    any_needs_runtime: bool = false,
    runtime_import_record: ?ImportRecord = null,
    hashed_filenames: HashedFileNameMap,
    import_counter: usize = 0,
    tagged_resolutions: TaggedResolution = TaggedResolution{},

    plugin_runner: ?*PluginRunner = null,

    onImportCSS: ?OnImportCallback = null,

    pub const runtime_source_path = "bun:wrap";

    pub const TaggedResolution = struct {
        react_refresh: ?Resolver.Result = null,

        // These tags cannot safely be used
        // Projects may use different JSX runtimes across folders
        // jsx_import: ?Resolver.Result = null,
        // jsx_classic: ?Resolver.Result = null,
    };

    pub fn init(
        allocator: std.mem.Allocator,
        log: *logger.Log,
        resolve_queue: *ResolveQueue,
        options: *Options.BundleOptions,
        resolver: *ResolverType,
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
            .hashed_filenames = HashedFileNameMap.init(allocator),
        };
    }

    pub fn getModKey(
        this: *ThisLinker,
        file_path: Fs.Path,
        fd: ?FileDescriptorType,
    ) !Fs.FileSystem.RealFS.ModKey {
        var file: std.fs.File = if (fd) |_fd| std.fs.File{ .handle = _fd } else try std.fs.openFileAbsolute(file_path.text, .{ .mode = .read_only });
        Fs.FileSystem.setMaxFd(file.handle);
        const modkey = try Fs.FileSystem.RealFS.ModKey.generate(&this.fs.fs, file_path.text, file);

        if (fd == null)
            file.close();
        return modkey;
    }

    pub fn getHashedFilename(
        this: *ThisLinker,
        file_path: Fs.Path,
        fd: ?FileDescriptorType,
    ) !string {
        if (Bundler.isCacheEnabled) {
            var hashed = std.hash.Wyhash.hash(0, file_path.text);
            var hashed_result = try this.hashed_filenames.getOrPut(hashed);
            if (hashed_result.found_existing) {
                return hashed_result.value_ptr.*;
            }
        }

        const modkey = try this.getModKey(file_path, fd);
        const hash_name = modkey.hashName(file_path.text);

        if (Bundler.isCacheEnabled) {
            var hashed = std.hash.Wyhash.hash(0, file_path.text);
            try this.hashed_filenames.put(hashed, try this.allocator.dupe(u8, hash_name));
        }

        return hash_name;
    }

    pub fn resolveCSS(
        this: anytype,
        path: Fs.Path,
        url: string,
        range: logger.Range,
        kind: ImportKind,
        origin: URL,
        comptime import_path_format: Options.BundleOptions.ImportPathFormat,
        comptime resolve_only: bool,
    ) !string {
        const dir = path.name.dirWithTrailingSlash();
        if (strings.hasPrefix(url, "/")) {
            if (comptime import_path_format == .absolute_url) {
                return try origin.joinAlloc(this.allocator, "", url, "", "", url);
            }

            return url;
        }

        var resolve_result = try this.resolver.resolve(dir, url, kind);

        if (resolve_result.is_external) {
            return url;
        }

        if (resolve_only) {
            return resolve_result.path_pair.primary.text;
        }

        var import_record = ImportRecord{ .range = range, .path = resolve_result.path_pair.primary, .kind = kind };
        const loader = this.options.loaders.get(resolve_result.path_pair.primary.name.ext) orelse .file;

        this.processImportRecord(loader, dir, &resolve_result, &import_record, origin, import_path_format) catch unreachable;
        return import_record.path.text;
    }

    pub inline fn nodeModuleBundleImportPath(this: *const ThisLinker, origin: URL) string {
        if (this.options.platform.isBun()) return "/node_modules.server.bun";

        return std.fmt.allocPrint(this.allocator, "{s}://{}{s}", .{ origin.displayProtocol(), origin.displayHost(), this.options.node_modules_bundle.?.bundle.import_from_name }) catch unreachable;
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
    threadlocal var require_part: js_ast.Part = undefined;
    threadlocal var require_part_stmts: [1]js_ast.Stmt = undefined;
    threadlocal var require_part_import_statement: js_ast.S.Import = undefined;
    threadlocal var require_part_import_clauses: [1]js_ast.ClauseItem = undefined;
    const require_alias: string = "__require";
    pub fn link(
        linker: *ThisLinker,
        file_path: Fs.Path,
        result: *_bundler.ParseResult,
        origin: URL,
        comptime import_path_format: Options.BundleOptions.ImportPathFormat,
        comptime ignore_runtime: bool,
        comptime is_bun: bool,
    ) !void {
        return linkAllowImportingFromBundle(linker, file_path, result, origin, import_path_format, ignore_runtime, true, is_bun);
    }

    pub fn linkAllowImportingFromBundle(
        linker: *ThisLinker,
        file_path: Fs.Path,
        result: *_bundler.ParseResult,
        origin: URL,
        comptime import_path_format: Options.BundleOptions.ImportPathFormat,
        comptime ignore_runtime: bool,
        comptime allow_import_from_bundle: bool,
        comptime is_bun: bool,
    ) !void {
        const source_dir = file_path.sourceDir();
        var externals = std.ArrayList(u32).init(linker.allocator);
        var needs_bundle = false;
        var had_resolve_errors = false;
        var needs_require = false;
        var node_module_bundle_import_path: ?string = null;

        var import_records = result.ast.import_records;
        defer {
            result.ast.import_records = import_records;
        }
        // Step 1. Resolve imports & requires
        switch (result.loader) {
            .jsx, .js, .ts, .tsx => {
                var record_i: u32 = 0;
                const record_count = @truncate(u32, import_records.len);

                outer: while (record_i < record_count) : (record_i += 1) {
                    var import_record = &import_records[record_i];
                    if (import_record.is_unused) continue;

                    const record_index = record_i;
                    if (comptime !ignore_runtime) {
                        if (strings.eqlComptime(import_record.path.namespace, "runtime")) {
                            // runtime is included in the bundle, so we don't need to dynamically import it
                            if (linker.options.node_modules_bundle != null) {
                                node_module_bundle_import_path = node_module_bundle_import_path orelse
                                    linker.nodeModuleBundleImportPath(origin);
                                import_record.path.text = node_module_bundle_import_path.?;
                                result.ast.runtime_import_record_id = record_index;
                            } else {
                                if (import_path_format == .absolute_url) {
                                    import_record.path = Fs.Path.initWithNamespace(try origin.joinAlloc(linker.allocator, "", "", "bun:wrap", "", ""), "bun");
                                } else {
                                    import_record.path = try linker.generateImportPath(
                                        source_dir,
                                        Linker.runtime_source_path,
                                        false,
                                        "bun",
                                        origin,
                                        import_path_format,
                                    );
                                }

                                result.ast.runtime_import_record_id = record_index;
                                result.ast.needs_runtime = true;
                            }
                            continue;
                        }
                    }

                    if (comptime is_bun) {
                        if (JSC.HardcodedModule.Aliases.get(import_record.path.text)) |replacement| {
                            import_record.path.text = replacement;
                            import_record.tag = if (strings.eqlComptime(replacement, "bun")) ImportRecord.Tag.bun else .hardcoded;
                            externals.append(record_index) catch unreachable;
                            continue;
                        }

                        if (JSC.DisabledModule.has(import_record.path.text)) {
                            import_record.path.is_disabled = true;
                            import_record.do_commonjs_transform_in_printer = true;
                            continue;
                        }

                        // if (strings.eqlComptime(import_record.path.text, "process")) {
                        //     import_record.path.text = "node:process";
                        //     externals.append(record_index) catch unreachable;
                        //     continue;
                        // }

                        // TODO: this is technical debt
                        if (linker.options.rewrite_jest_for_tests) {
                            if (strings.eqlComptime(
                                import_record.path.text,
                                "@jest/globals",
                            ) or strings.eqlComptime(
                                import_record.path.text,
                                "vitest",
                            )) {
                                import_record.path.namespace = "bun";
                                import_record.tag = .bun_test;
                                import_record.path.text = "test";
                                continue;
                            }
                        }

                        if (import_record.path.text.len > 4 and strings.eqlComptimeIgnoreLen(import_record.path.text[0.."bun:".len], "bun:")) {
                            import_record.path = Fs.Path.init(import_record.path.text["bun:".len..]);
                            import_record.path.namespace = "bun";

                            if (strings.eqlComptime(import_record.path.text, "test")) {
                                import_record.tag = .bun_test;
                            }

                            // don't link bun
                            continue;
                        }

                        // Resolve dynamic imports lazily for perf
                        if (import_record.kind == .dynamic) {
                            continue;
                        }
                    }

                    if (linker.plugin_runner) |runner| {
                        if (PluginRunner.couldBePlugin(import_record.path.text)) {
                            if (runner.onResolve(
                                import_record.path.text,
                                file_path.text,
                                linker.log,
                                import_record.range.loc,
                                if (is_bun)
                                    JSC.JSGlobalObject.BunPluginTarget.bun
                                else if (linker.options.platform == .browser)
                                    JSC.JSGlobalObject.BunPluginTarget.browser
                                else
                                    JSC.JSGlobalObject.BunPluginTarget.node,
                            )) |path| {
                                import_record.path = try linker.generateImportPath(
                                    source_dir,
                                    path.text,
                                    false,
                                    path.namespace,
                                    origin,
                                    import_path_format,
                                );
                                import_record.print_namespace_in_path = true;
                                continue;
                            }
                        }
                    }

                    if (comptime allow_import_from_bundle) {
                        if (linker.options.node_modules_bundle) |node_modules_bundle| {
                            if (Resolver.isPackagePath(import_record.path.text)) {
                                const text = import_record.path.text;

                                var package_name = text;
                                if (text[0] == '@') {
                                    if (std.mem.indexOfScalar(u8, text, '/')) |i| {
                                        if (std.mem.indexOfScalar(u8, text[i + 1 ..], '/')) |j| {
                                            package_name = text[0 .. i + 1 + j];
                                        }
                                    }
                                } else {
                                    if (std.mem.indexOfScalar(u8, text, '/')) |i| {
                                        package_name = text[0..i];
                                    }
                                }
                                if (package_name.len != text.len) {
                                    if (node_modules_bundle.getPackage(package_name)) |pkg| {
                                        const import_path = text[@minimum(text.len, package_name.len + 1)..];
                                        if (node_modules_bundle.findModuleIDInPackageIgnoringExtension(pkg, import_path)) |found_module| {
                                            import_record.is_bundled = true;
                                            node_module_bundle_import_path = node_module_bundle_import_path orelse
                                                linker.nodeModuleBundleImportPath(origin);

                                            import_record.path.text = node_module_bundle_import_path.?;
                                            import_record.module_id = node_modules_bundle.bundle.modules[found_module].id;
                                            needs_bundle = true;
                                            continue :outer;
                                        }
                                    }
                                }
                            }
                        }
                    }

                    var resolved_import_ = brk: {
                        switch (import_record.tag) {
                            else => {},
                            // for fast refresh, attempt to read the version directly from the bundle instead of resolving it
                            .react_refresh => {
                                if (comptime allow_import_from_bundle) {
                                    if (linker.options.node_modules_bundle) |node_modules_bundle| {
                                        const runtime = linker.options.jsx.refresh_runtime;
                                        const package_name = runtime[0 .. strings.indexOfChar(runtime, '/') orelse runtime.len];

                                        if (node_modules_bundle.getPackage(package_name)) |pkg| {
                                            const import_path = runtime[@minimum(runtime.len, package_name.len + 1)..];
                                            if (node_modules_bundle.findModuleInPackage(pkg, import_path)) |found_module| {
                                                import_record.is_bundled = true;
                                                node_module_bundle_import_path = node_module_bundle_import_path orelse
                                                    linker.nodeModuleBundleImportPath(origin);

                                                import_record.path.text = node_module_bundle_import_path.?;
                                                import_record.module_id = found_module.id;
                                                needs_bundle = true;
                                                continue :outer;
                                            }
                                        }
                                    }
                                }

                                if (linker.options.jsx.use_embedded_refresh_runtime) {
                                    import_record.path = Fs.Path.initWithNamespace(try origin.joinAlloc(linker.allocator, "", "", linker.options.jsx.refresh_runtime, "", ""), "bun");
                                    continue :outer;
                                }

                                if (linker.tagged_resolutions.react_refresh != null) {
                                    break :brk linker.tagged_resolutions.react_refresh.?;
                                }
                            },
                        }

                        if (comptime is_bun) {
                            var bundler: *Bundler = @fieldParentPtr(Bundler, "linker", linker);
                            if (bundler.options.enable_auto_install and bundler.package_manager == null and Resolver.isPackagePath(import_record.path.text)) {
                                _ = bundler.getPackageManager();
                            }

                            switch (linker.resolver.resolveAndAutoInstall(
                                source_dir,
                                import_record.path.text,
                                import_record.kind,
                                bundler.options.enable_auto_install,
                            )) {
                                .success => |_resolved_import| {
                                    switch (import_record.tag) {
                                        else => {},
                                        .react_refresh => {
                                            linker.tagged_resolutions.react_refresh = _resolved_import;
                                            linker.tagged_resolutions.react_refresh.?.path_pair.primary = linker.tagged_resolutions.react_refresh.?.path().?.dupeAlloc(bun.default_allocator) catch unreachable;
                                        },
                                    }

                                    break :brk _resolved_import;
                                },
                                .failure => |err| {
                                    break :brk err;
                                },
                                else => unreachable,
                            }
                        } else {
                            if (linker.resolver.resolve(source_dir, import_record.path.text, import_record.kind)) |_resolved_import| {
                                switch (import_record.tag) {
                                    else => {},
                                    .react_refresh => {
                                        linker.tagged_resolutions.react_refresh = _resolved_import;
                                        linker.tagged_resolutions.react_refresh.?.path_pair.primary = linker.tagged_resolutions.react_refresh.?.path().?.dupeAlloc(bun.default_allocator) catch unreachable;
                                    },
                                }

                                break :brk _resolved_import;
                            } else |err| {
                                break :brk err;
                            }
                        }
                    };

                    if (resolved_import_) |*resolved_import| {
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
                            if (comptime allow_import_from_bundle) {
                                bundled: {
                                    if (linker.options.node_modules_bundle) |node_modules_bundle| {
                                        const package_json = resolved_import.package_json orelse break :bundled;
                                        const package_base_dir = package_json.source.path.sourceDir();
                                        if (node_modules_bundle.getPackageIDByHash(package_json.hash)) |pkg_id| {
                                            const package = node_modules_bundle.bundle.packages[pkg_id];

                                            if (comptime Environment.isDebug) {
                                                std.debug.assert(strings.eql(node_modules_bundle.str(package.name), package_json.name));
                                                std.debug.assert(strings.eql(node_modules_bundle.str(package.version), package_json.version));
                                            }

                                            const package_relative_path = linker.fs.relative(
                                                package_base_dir,
                                                if (!strings.eqlComptime(path.namespace, "node")) path.pretty else path.text,
                                            );

                                            const found_module = node_modules_bundle.findModuleInPackage(&package, package_relative_path) orelse {
                                                // linker.log.addErrorFmt(
                                                //     null,
                                                //     logger.Loc.Empty,
                                                //     linker.allocator,
                                                //     "New dependency import: \"{s}/{s}\"\nPlease run `bun bun` to update the .bun.",
                                                //     .{
                                                //         package_json.name,
                                                //         package_relative_path,
                                                //     },
                                                // ) catch {};
                                                break :bundled;
                                            };

                                            if (comptime Environment.isDebug) {
                                                const module_path = node_modules_bundle.str(found_module.path);
                                                std.debug.assert(
                                                    strings.eql(
                                                        module_path,
                                                        package_relative_path,
                                                    ),
                                                );
                                            }

                                            import_record.is_bundled = true;
                                            node_module_bundle_import_path = node_module_bundle_import_path orelse
                                                linker.nodeModuleBundleImportPath(origin);
                                            import_record.path.text = node_module_bundle_import_path.?;
                                            import_record.module_id = found_module.id;
                                            needs_bundle = true;
                                            continue;
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
                            origin,
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
                        if (loader != .napi and resolved_import.shouldAssumeCommonJS(import_record.kind)) {
                            import_record.do_commonjs_transform_in_printer = true;
                            import_record.module_id = @truncate(u32, std.hash.Wyhash.hash(0, path.pretty));
                            result.ast.needs_runtime = true;
                            needs_require = true;
                        }
                    } else |err| {
                        switch (err) {
                            error.ModuleNotFound => {
                                if (import_record.handles_import_errors) {
                                    import_record.path.is_disabled = true;
                                    continue;
                                }

                                if (comptime is_bun) {
                                    // make these happen at runtime
                                    if (import_record.kind == .require or import_record.kind == .require_resolve) {
                                        continue;
                                    }
                                }

                                had_resolve_errors = true;

                                if (import_record.path.text.len > 0 and Resolver.isPackagePath(import_record.path.text)) {
                                    if (linker.options.platform.isWebLike() and Options.ExternalModules.isNodeBuiltin(import_record.path.text)) {
                                        try linker.log.addResolveError(
                                            &result.source,
                                            import_record.range,
                                            linker.allocator,
                                            "Could not resolve: \"{s}\". Try setting --platform=\"node\" (after bun build exists)",
                                            .{import_record.path.text},
                                            import_record.kind,
                                        );
                                        continue;
                                    } else {
                                        try linker.log.addResolveError(
                                            &result.source,
                                            import_record.range,
                                            linker.allocator,
                                            "Could not resolve: \"{s}\". Maybe you need to \"bun install\"?",
                                            .{import_record.path.text},
                                            import_record.kind,
                                        );
                                        continue;
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
                                had_resolve_errors = true;

                                try linker.log.addResolveError(
                                    &result.source,
                                    import_record.range,
                                    linker.allocator,
                                    "{s} resolving \"{s}\"",
                                    .{
                                        @errorName(err),
                                        import_record.path.text,
                                    },
                                    import_record.kind,
                                );
                                continue;
                            },
                        }
                    }
                }
            },

            else => {},
        }
        if (had_resolve_errors) return error.ResolveError;
        result.ast.externals = externals.toOwnedSlice();

        if (result.ast.needs_runtime and result.ast.runtime_import_record_id == null) {
            var new_import_records = try linker.allocator.alloc(ImportRecord, import_records.len + 1);
            std.mem.copy(ImportRecord, new_import_records, import_records);

            new_import_records[new_import_records.len - 1] = ImportRecord{
                .kind = .stmt,
                .path = if (linker.options.node_modules_bundle != null)
                    Fs.Path.init(node_module_bundle_import_path orelse linker.nodeModuleBundleImportPath(origin))
                else if (import_path_format == .absolute_url)
                    Fs.Path.initWithNamespace(try origin.joinAlloc(linker.allocator, "", "", "bun:wrap", "", ""), "bun")
                else
                    try linker.generateImportPath(source_dir, Linker.runtime_source_path, false, "bun", origin, import_path_format),

                .range = logger.Range{ .loc = logger.Loc{ .start = 0 }, .len = 0 },
            };
            result.ast.runtime_import_record_id = @truncate(u32, new_import_records.len - 1);
            import_records = new_import_records;
        }

        // We _assume_ you're importing ESM.
        // But, that assumption can be wrong without parsing code of the imports.
        // That's where in here, we inject
        // > import {require} from 'bun:wrap';
        // Since they definitely aren't using require, we don't have to worry about the symbol being renamed.
        if (needs_require and !result.ast.uses_require_ref) {
            result.ast.uses_require_ref = true;
            require_part_import_clauses[0] = js_ast.ClauseItem{
                .alias = require_alias,
                .original_name = "",
                .alias_loc = logger.Loc.Empty,
                .name = js_ast.LocRef{
                    .loc = logger.Loc.Empty,
                    .ref = result.ast.require_ref,
                },
            };

            require_part_import_statement = js_ast.S.Import{
                .namespace_ref = Ref.None,
                .items = std.mem.span(&require_part_import_clauses),
                .import_record_index = result.ast.runtime_import_record_id.?,
            };
            require_part_stmts[0] = js_ast.Stmt{
                .data = .{ .s_import = &require_part_import_statement },
                .loc = logger.Loc.Empty,
            };

            result.ast.prepend_part = js_ast.Part{ .stmts = std.mem.span(&require_part_stmts) };
        }
    }

    const ImportPathsList = allocators.BSSStringList(512, 128);
    pub var relative_paths_list: *ImportPathsList = undefined;

    pub fn generateImportPath(
        linker: *ThisLinker,
        source_dir: string,
        source_path: string,
        use_hashed_name: bool,
        namespace: string,
        origin: URL,
        comptime import_path_format: Options.BundleOptions.ImportPathFormat,
    ) !Fs.Path {
        switch (import_path_format) {
            .absolute_path => {
                if (strings.eqlComptime(namespace, "node")) {
                    return Fs.Path.initWithNamespace(source_path, "node");
                }

                if (strings.eqlComptime(namespace, "bun") or strings.eqlComptime(namespace, "file") or namespace.len == 0) {
                    var relative_name = linker.fs.relative(source_dir, source_path);
                    return Fs.Path.initWithPretty(source_path, relative_name);
                } else {
                    return Fs.Path.initWithNamespace(source_path, namespace);
                }
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

            .absolute_url => {
                if (strings.eqlComptime(namespace, "node")) {
                    if (comptime Environment.isDebug) std.debug.assert(strings.eqlComptime(source_path[0..5], "node:"));

                    return Fs.Path.init(try std.fmt.allocPrint(
                        linker.allocator,
                        // assumption: already starts with "node:"
                        "{s}/{s}",
                        .{
                            strings.withoutTrailingSlash(origin.href),
                            strings.withoutLeadingSlash(source_path),
                        },
                    ));
                } else {
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

                        if (linker.options.serve) {
                            var hash_buf: [64]u8 = undefined;
                            const modkey = try linker.getModKey(basepath, null);

                            return Fs.Path.init(try origin.joinAlloc(
                                linker.allocator,
                                std.fmt.bufPrint(&hash_buf, "hash:{x}/", .{modkey.hash()}) catch unreachable,
                                dirname,
                                basename,
                                absolute_pathname.ext,
                                source_path,
                            ));
                        }

                        basename = try linker.getHashedFilename(basepath, null);
                    }

                    return Fs.Path.init(try origin.joinAlloc(
                        linker.allocator,
                        linker.options.routes.asset_prefix_path,
                        dirname,
                        basename,
                        absolute_pathname.ext,
                        source_path,
                    ));
                }
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
        origin: URL,
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
            if (path.is_symlink and import_path_format == .absolute_url and linker.options.platform.isNotBun()) path.pretty else path.text,
            loader == .file or loader == .wasm,
            path.namespace,
            origin,
            import_path_format,
        );

        switch (loader) {
            .css => {
                if (linker.onImportCSS) |callback| {
                    callback(resolve_result, import_record, origin);
                }
                // This saves us a less reliable string check
                import_record.print_mode = .css;
            },
            .napi => {
                import_record.print_mode = .napi_module;
            },
            .wasm => {
                import_record.print_mode = .import_path;
            },
            .file => {

                // if we're building for web/node, always print as import path
                // if we're building for bun
                // it's more complicated
                // loader plugins could be executed between when this is called and the import is evaluated
                // but we want to preserve the semantics of "file" returning import paths for compatibiltiy with frontend frameworkss
                if (!linker.options.platform.isBun()) {
                    import_record.print_mode = .import_path;
                }
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
