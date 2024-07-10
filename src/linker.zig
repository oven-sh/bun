// Most of this file should eventually be replaced with `bundle_v2.zig` or
// `bundle_v2` should be split into several files.
const bun = @import("root").bun;
const string = bun.string;
const Output = bun.Output;
const Global = bun.Global;
const Environment = bun.Environment;
const strings = bun.strings;
const MutableString = bun.MutableString;
const stringZ = bun.stringZ;
const default_allocator = bun.default_allocator;
const FileDescriptorType = bun.FileDescriptor;
const C = bun.C;
const Ref = @import("./ast/base.zig").Ref;

const std = @import("std");
const lex = bun.js_lexer;
const logger = bun.logger;
const Options = @import("options.zig");
const js_parser = bun.js_parser;
const json_parser = bun.JSON;
const js_printer = bun.js_printer;
const js_ast = bun.JSAst;

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
const _bundler = bun.bundler;
const Bundler = _bundler.Bundler;
const ResolveQueue = _bundler.ResolveQueue;
const ResolverType = Resolver.Resolver;
const ESModule = @import("./resolver/package_json.zig").ESModule;
const Runtime = @import("./runtime.zig").Runtime;
const URL = @import("url.zig").URL;
const JSC = bun.JSC;
const PluginRunner = bun.bundler.PluginRunner;
pub const CSSResolveError = error{ResolveMessage};

pub const OnImportCallback = *const fn (resolve_result: *const Resolver.Result, import_record: *ImportRecord, origin: URL) void;

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
        var file: std.fs.File = if (fd) |_fd| _fd.asFile() else try std.fs.openFileAbsolute(file_path.text, .{ .mode = .read_only });
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
            const hashed = bun.hash(file_path.text);
            const hashed_result = try this.hashed_filenames.getOrPut(hashed);
            if (hashed_result.found_existing) {
                return hashed_result.value_ptr.*;
            }
        }

        const modkey = try this.getModKey(file_path, fd);
        const hash_name = modkey.hashName(file_path.text);

        if (Bundler.isCacheEnabled) {
            const hashed = bun.hash(file_path.text);
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
        if (this.options.target.isBun()) return "/node_modules.server.bun";

        return std.fmt.allocPrint(this.allocator, "{s}://{}{s}", .{ origin.displayProtocol(), origin.displayHost(), this.options.node_modules_bundle.?.bundle.import_from_name }) catch unreachable;
    }

    // This modifies the Ast in-place!
    // But more importantly, this does the following:
    // - Wrap CommonJS files
    pub fn link(
        linker: *ThisLinker,
        file_path: Fs.Path,
        result: *_bundler.ParseResult,
        origin: URL,
        comptime import_path_format: Options.BundleOptions.ImportPathFormat,
        comptime ignore_runtime: bool,
        comptime is_bun: bool,
    ) !void {
        const source_dir = file_path.sourceDir();
        var externals = std.ArrayList(u32).init(linker.allocator);
        var had_resolve_errors = false;

        const is_deferred = result.pending_imports.len > 0;

        const import_records = result.ast.import_records.listManaged(linker.allocator);
        defer {
            result.ast.import_records = ImportRecord.List.fromList(import_records);
        }
        // Step 1. Resolve imports & requires
        switch (result.loader) {
            .jsx, .js, .ts, .tsx => {
                for (import_records.items, 0..) |*import_record, record_i| {
                    if (import_record.is_unused or
                        (is_bun and is_deferred and !result.isPendingImport(@intCast(record_i)))) continue;

                    const record_index = record_i;
                    if (comptime !ignore_runtime) {
                        if (strings.eqlComptime(import_record.path.namespace, "runtime")) {
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

                            result.ast.runtime_import_record_id = @intCast(record_index);
                            result.ast.needs_runtime = true;
                            continue;
                        }
                    }

                    if (comptime is_bun) {
                        if (JSC.HardcodedModule.Aliases.get(import_record.path.text, linker.options.target)) |replacement| {
                            import_record.path.text = replacement.path;
                            import_record.tag = replacement.tag;
                            import_record.is_external_without_side_effects = true;
                            if (replacement.tag != .none) {
                                externals.append(@intCast(record_index)) catch unreachable;
                                continue;
                            }
                        }
                        if (strings.startsWith(import_record.path.text, "node:")) {
                            // if a module is not found here, it is not found at all
                            // so we can just disable it
                            had_resolve_errors = try whenModuleNotFound(linker, import_record, result, is_bun);

                            if (had_resolve_errors) return error.ResolveMessage;
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

                        if (strings.hasPrefixComptime(import_record.path.text, "bun:")) {
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
                                else if (linker.options.target == .browser)
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

                    // var resolved_import_: anyerror!Resolver.Result = brk: {
                    //     switch (import_record.tag) {
                    //         else => {},
                    //         // for fast refresh, attempt to read the version directly from the bundle instead of resolving it
                    //         .react_refresh => {
                    //             if (linker.options.jsx.use_embedded_refresh_runtime) {
                    //                 import_record.path = Fs.Path.initWithNamespace(try origin.joinAlloc(linker.allocator, "", "", linker.options.jsx.refresh_runtime, "", ""), "bun");
                    //                 continue :outer;
                    //             }

                    //             if (linker.tagged_resolutions.react_refresh != null) {
                    //                 break :brk linker.tagged_resolutions.react_refresh.?;
                    //             }
                    //         },
                    //     }

                    //     if (comptime is_bun) {
                    //         switch (linker.resolver.resolveAndAutoInstall(
                    //             source_dir,
                    //             import_record.path.text,
                    //             import_record.kind,
                    //             linker.options.global_cache,
                    //         )) {
                    //             .success => |_resolved_import| {
                    //                 switch (import_record.tag) {
                    //                     else => {},
                    //                     .react_refresh => {
                    //                         linker.tagged_resolutions.react_refresh = _resolved_import;
                    //                         linker.tagged_resolutions.react_refresh.?.path_pair.primary = linker.tagged_resolutions.react_refresh.?.path().?.dupeAlloc(bun.default_allocator) catch unreachable;
                    //                     },
                    //                 }

                    //                 break :brk _resolved_import;
                    //             },
                    //             .failure => |err| {
                    //                 break :brk err;
                    //             },
                    //             .pending => |pending1| {
                    //                 var pending = pending1;
                    //                 if (!linker.resolver.opts.global_cache.canInstall()) {
                    //                     break :brk error.InstallationPending;
                    //                 }

                    //                 pending.import_record_id = record_i;
                    //                 try result.pending_imports.append(linker.allocator, pending);
                    //                 continue;
                    //             },
                    //             .not_found => break :brk error.ModuleNotFound,
                    //             // else => unreachable,
                    //         }
                    //     } else {
                    //         if (linker.resolver.resolve(source_dir, import_record.path.text, import_record.kind)) |_resolved_import| {
                    //             switch (import_record.tag) {
                    //                 else => {},
                    //                 .react_refresh => {
                    //                     linker.tagged_resolutions.react_refresh = _resolved_import;
                    //                     linker.tagged_resolutions.react_refresh.?.path_pair.primary = linker.tagged_resolutions.react_refresh.?.path().?.dupeAlloc(bun.default_allocator) catch unreachable;
                    //                 },
                    //             }

                    //             break :brk _resolved_import;
                    //         } else |err| {
                    //             break :brk err;
                    //         }
                    //     }
                    // };

                    // if (resolved_import_) |*resolved_import| {
                    //     if (resolved_import.is_external or resolved_import.is_standalone_module) {
                    //         if (resolved_import.is_external)
                    //             externals.append(record_index) catch unreachable;
                    //         continue;
                    //     }

                    //     const path = resolved_import.pathConst() orelse {
                    //         import_record.path.is_disabled = true;
                    //         continue;
                    //     };

                    //     const loader = linker.options.loader(path.name.ext);

                    //     linker.processImportRecord(
                    //         loader,

                    //         // Include trailing slash
                    //         source_dir,
                    //         resolved_import,
                    //         import_record,
                    //         origin,
                    //         import_path_format,
                    //     ) catch continue;

                    //     // If we're importing a CommonJS module as ESM
                    //     // We need to do the following transform:
                    //     //      import React from 'react';
                    //     //      =>
                    //     //      import {_require} from 'RUNTIME_IMPORTS';
                    //     //      import * as react_module from 'react';
                    //     //      var React = _require(react_module).default;
                    //     // UNLESS it's a namespace import
                    //     // If it's a namespace import, assume it's safe.
                    //     // We can do this in the printer instead of creating a bunch of AST nodes here.
                    //     // But we need to at least tell the printer that this needs to happen.
                    //     if (loader != .napi and resolved_import.shouldAssumeCommonJS(import_record.kind) and !is_bun) {
                    //         import_record.do_commonjs_transform_in_printer = true;
                    //         import_record.module_id = @as(u32, @truncate(bun.hash(path.pretty)));
                    //     }
                    // } else |err| {
                    //     switch (err) {
                    //         error.VersionSpecifierNotAllowedHere => {
                    //             var subpath_buf: [512]u8 = undefined;

                    //             if (ESModule.Package.parse(import_record.path.text, &subpath_buf)) |pkg| {
                    //                 linker.log.addResolveError(
                    //                     &result.source,
                    //                     import_record.range,
                    //                     linker.allocator,
                    //                     "Unexpected version \"{s}\" in import specifier \"{s}\". When a package.json is present, please use one of the \"dependencies\" fields in package.json for setting dependency versions",
                    //                     .{ pkg.version, import_record.path.text },
                    //                     import_record.kind,
                    //                     err,
                    //                 ) catch {};
                    //             } else {
                    //                 linker.log.addResolveError(
                    //                     &result.source,
                    //                     import_record.range,
                    //                     linker.allocator,
                    //                     "Unexpected version in import specifier \"{s}\". When a package.json is present, please use one of the \"dependencies\" fields in package.json to specify the version",
                    //                     .{import_record.path.text},
                    //                     import_record.kind,
                    //                     err,
                    //                 ) catch {};
                    //             }
                    //             had_resolve_errors = true;
                    //             continue;
                    //         },

                    //         error.NoMatchingVersion => {
                    //             if (import_record.handles_import_errors) {
                    //                 import_record.path.is_disabled = true;
                    //                 continue;
                    //             }

                    //             had_resolve_errors = true;

                    //             var package_name = import_record.path.text;
                    //             var subpath_buf: [512]u8 = undefined;
                    //             if (ESModule.Package.parse(import_record.path.text, &subpath_buf)) |pkg| {
                    //                 package_name = pkg.name;
                    //                 if (pkg.version.len > 0) {
                    //                     linker.log.addResolveError(
                    //                         &result.source,
                    //                         import_record.range,
                    //                         linker.allocator,
                    //                         "Version \"{s}\" not found for package \"{s}\" (while resolving \"{s}\")",
                    //                         .{ pkg.version, package_name, import_record.path.text },
                    //                         import_record.kind,
                    //                         err,
                    //                     ) catch {};
                    //                 } else {
                    //                     linker.log.addResolveError(
                    //                         &result.source,
                    //                         import_record.range,
                    //                         linker.allocator,
                    //                         "No matching version found for package \"{s}\" (while resolving \"{s}\")",
                    //                         .{ package_name, import_record.path.text },
                    //                         import_record.kind,
                    //                         err,
                    //                     ) catch {};
                    //                 }
                    //             } else {
                    //                 linker.log.addResolveError(
                    //                     &result.source,
                    //                     import_record.range,
                    //                     linker.allocator,
                    //                     "Package version not found: \"{s}\"",
                    //                     .{import_record.path.text},
                    //                     import_record.kind,
                    //                     err,
                    //                 ) catch {};
                    //             }
                    //             continue;
                    //         },

                    //         error.DistTagNotFound => {
                    //             if (import_record.handles_import_errors) {
                    //                 import_record.path.is_disabled = true;
                    //                 continue;
                    //             }

                    //             had_resolve_errors = true;

                    //             var package_name = import_record.path.text;
                    //             var subpath_buf: [512]u8 = undefined;
                    //             if (ESModule.Package.parse(import_record.path.text, &subpath_buf)) |pkg| {
                    //                 package_name = pkg.name;
                    //                 linker.log.addResolveError(
                    //                     &result.source,
                    //                     import_record.range,
                    //                     linker.allocator,
                    //                     "Version \"{s}\" not found for package \"{s}\" (while resolving \"{s}\")",
                    //                     .{ pkg.version, package_name, import_record.path.text },
                    //                     import_record.kind,
                    //                     err,
                    //                 ) catch {};
                    //             } else {
                    //                 linker.log.addResolveError(
                    //                     &result.source,
                    //                     import_record.range,
                    //                     linker.allocator,
                    //                     "Package tag not found: \"{s}\"",
                    //                     .{import_record.path.text},
                    //                     import_record.kind,
                    //                     err,
                    //                 ) catch {};
                    //             }

                    //             continue;
                    //         },

                    //         error.PackageManifestHTTP404 => {
                    //             if (import_record.handles_import_errors) {
                    //                 import_record.path.is_disabled = true;
                    //                 continue;
                    //             }

                    //             had_resolve_errors = true;

                    //             var package_name = import_record.path.text;
                    //             var subpath_buf: [512]u8 = undefined;
                    //             if (ESModule.Package.parse(import_record.path.text, &subpath_buf)) |pkg| {
                    //                 package_name = pkg.name;
                    //                 linker.log.addResolveError(
                    //                     &result.source,
                    //                     import_record.range,
                    //                     linker.allocator,
                    //                     "Package not found: \"{s}\" (while resolving \"{s}\")",
                    //                     .{ package_name, import_record.path.text },
                    //                     import_record.kind,
                    //                     err,
                    //                 ) catch {};
                    //             } else {
                    //                 linker.log.addResolveError(
                    //                     &result.source,
                    //                     import_record.range,
                    //                     linker.allocator,
                    //                     "Package not found: \"{s}\"",
                    //                     .{package_name},
                    //                     import_record.kind,
                    //                     err,
                    //                 ) catch {};
                    //             }
                    //             continue;
                    //         },
                    //         error.ModuleNotFound => {
                    //             had_resolve_errors = try whenModuleNotFound(linker, import_record, result, is_bun);
                    //         },
                    //         else => {
                    //             had_resolve_errors = true;

                    //             try linker.log.addResolveError(
                    //                 &result.source,
                    //                 import_record.range,
                    //                 linker.allocator,
                    //                 "{s} resolving \"{s}\"",
                    //                 .{
                    //                     @errorName(err),
                    //                     import_record.path.text,
                    //                 },
                    //                 import_record.kind,
                    //                 err,
                    //             );
                    //             continue;
                    //         },
                    //     }
                    // }
                }
            },

            else => {},
        }
        if (had_resolve_errors) return error.ResolveMessage;
        result.ast.externals = try externals.toOwnedSlice();
    }

    fn whenModuleNotFound(
        linker: *ThisLinker,
        import_record: *ImportRecord,
        result: *_bundler.ParseResult,
        comptime is_bun: bool,
    ) !bool {
        if (import_record.handles_import_errors) {
            import_record.path.is_disabled = true;
            return false;
        }

        if (comptime is_bun) {
            // make these happen at runtime
            if (import_record.kind == .require or import_record.kind == .require_resolve) {
                return false;
            }
        }

        if (import_record.path.text.len > 0 and Resolver.isPackagePath(import_record.path.text)) {
            if (linker.options.target.isWebLike() and Options.ExternalModules.isNodeBuiltin(import_record.path.text)) {
                try linker.log.addResolveError(
                    &result.source,
                    import_record.range,
                    linker.allocator,
                    "Could not resolve: \"{s}\". Try setting --target=\"node\"",
                    .{import_record.path.text},
                    import_record.kind,
                    error.ModuleNotFound,
                );
            } else {
                try linker.log.addResolveError(
                    &result.source,
                    import_record.range,
                    linker.allocator,
                    "Could not resolve: \"{s}\". Maybe you need to \"bun install\"?",
                    .{import_record.path.text},
                    import_record.kind,
                    error.ModuleNotFound,
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
                error.ModuleNotFound,
            );
        }
        return true;
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
                    const relative_name = linker.fs.relative(source_dir, source_path);
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
                    const dir = basepath.name.dirWithTrailingSlash();
                    var _pretty = try linker.allocator.alloc(u8, dir.len + basename.len + basepath.name.ext.len);
                    bun.copy(u8, _pretty, dir);
                    var remaining_pretty = _pretty[dir.len..];
                    bun.copy(u8, remaining_pretty, basename);
                    remaining_pretty = remaining_pretty[basename.len..];
                    bun.copy(u8, remaining_pretty, basepath.name.ext);
                    pretty = _pretty;
                    relative_name = try linker.allocator.dupe(u8, relative_name);
                } else {
                    if (relative_name.len > 1 and !(relative_name[0] == std.fs.path.sep or relative_name[0] == '.')) {
                        pretty = try strings.concat(linker.allocator, &.{ "./", relative_name });
                    } else {
                        pretty = try linker.allocator.dupe(u8, relative_name);
                    }

                    relative_name = pretty;
                }

                return Fs.Path.initWithPretty(pretty, relative_name);
            },

            .absolute_url => {
                if (strings.eqlComptime(namespace, "node")) {
                    if (comptime Environment.isDebug) bun.assert(strings.eqlComptime(source_path[0..5], "node:"));

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

                    const dirname = std.fs.path.dirname(base) orelse "";

                    var basename = std.fs.path.basename(base);

                    if (use_hashed_name) {
                        const basepath = Fs.Path.init(source_path);

                        if (linker.options.serve) {
                            var hash_buf: [64]u8 = undefined;
                            const modkey = try linker.getModKey(basepath, null);
                            return Fs.Path.init(try origin.joinAlloc(
                                linker.allocator,
                                std.fmt.bufPrint(&hash_buf, "hash:{any}/", .{bun.fmt.hexIntLower(modkey.hash())}) catch unreachable,
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

        const path = resolve_result.pathConst() orelse unreachable;

        import_record.path = try linker.generateImportPath(
            source_dir,
            if (path.is_symlink and import_path_format == .absolute_url and linker.options.target.isNotBun()) path.pretty else path.text,
            loader == .file or loader == .wasm,
            path.namespace,
            origin,
            import_path_format,
        );

        switch (loader) {
            .css => {
                if (!linker.options.target.isBun())
                    _ = try linker.enqueueResolveResult(resolve_result);

                if (linker.onImportCSS) |callback| {
                    callback(resolve_result, import_record, origin);
                }
                // This saves us a less reliable string check
                import_record.print_mode = .css;
            },
            .napi => {
                import_record.print_mode = .napi_module;
            },

            .wasm, .file => {

                // if we're building for web/node, always print as import path
                // if we're building for bun
                // it's more complicated
                // loader plugins could be executed between when this is called and the import is evaluated
                // but we want to preserve the semantics of "file" returning import paths for compatibiltiy with frontend frameworkss
                if (!linker.options.target.isBun()) {
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

        return bun.hash(hash_key);
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
