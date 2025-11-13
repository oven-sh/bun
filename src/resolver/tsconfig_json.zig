// Heuristic: you probably don't have 100 of these
// Probably like 5-10
// Array iteration is faster and deterministically ordered in that case.
const PathsMap = bun.StringArrayHashMap([]string);

fn FlagSet(comptime Type: type) type {
    return std.EnumSet(std.meta.FieldEnum(Type));
}

const JSXFieldSet = FlagSet(options.JSX.Pragma);

pub const TSConfigJSON = struct {
    pub const new = bun.TrivialNew(@This());

    abs_path: string,

    // The absolute path of "compilerOptions.baseUrl"
    base_url: string = "",

    // This is used if "Paths" is non-nil. It's equal to "BaseURL" except if
    // "BaseURL" is missing, in which case it is as if "BaseURL" was ".". This
    // is to implement the "paths without baseUrl" feature from TypeScript 4.1.
    // More info: https://github.com/microsoft/TypeScript/issues/31869
    base_url_for_paths: string = "",

    extends: string = "",
    // The verbatim values of "compilerOptions.paths". The keys are patterns to
    // match and the values are arrays of fallback paths to search. Each key and
    // each fallback path can optionally have a single "*" wildcard character.
    // If both the key and the value have a wildcard, the substring matched by
    // the wildcard is substituted into the fallback path. The keys represent
    // module-style path names and the fallback paths are relative to the
    // "baseUrl" value in the "tsconfig.json" file.
    paths: PathsMap,

    jsx: options.JSX.Pragma = options.JSX.Pragma{},
    jsx_flags: JSXFieldSet = JSXFieldSet{},

    use_define_for_class_fields: ?bool = null,

    preserve_imports_not_used_as_values: ?bool = false,

    emit_decorator_metadata: bool = false,

    pub fn hasBaseURL(tsconfig: *const TSConfigJSON) bool {
        return tsconfig.base_url.len > 0;
    }

    pub const ImportsNotUsedAsValue = enum {
        preserve,
        err,
        remove,
        invalid,

        pub const List = bun.ComptimeStringMap(ImportsNotUsedAsValue, .{
            .{ "preserve", .preserve },
            .{ "error", .err },
            .{ "remove", .remove },
        });
    };

    pub fn mergeJSX(this: *const TSConfigJSON, current: options.JSX.Pragma) options.JSX.Pragma {
        var out = current;

        if (this.jsx_flags.contains(.factory)) {
            out.factory = this.jsx.factory;
        }

        if (this.jsx_flags.contains(.fragment)) {
            out.fragment = this.jsx.fragment;
        }

        if (this.jsx_flags.contains(.import_source)) {
            out.import_source = this.jsx.import_source;
        }

        if (this.jsx_flags.contains(.runtime)) {
            out.runtime = this.jsx.runtime;
        }

        if (this.jsx_flags.contains(.development)) {
            out.development = this.jsx.development;
        }

        return out;
    }

    /// Support ${configDir}, but avoid allocating when possible.
    ///
    /// https://github.com/microsoft/TypeScript/issues/57485
    ///
    /// https://www.typescriptlang.org/docs/handbook/release-notes/typescript-5-5.html#the-configdir-template-variable-for-configuration-files
    ///
    /// https://github.com/oven-sh/bun/issues/11752
    ///
    // Note that the way tsc does this is slightly different. They replace
    // "${configDir}" with "./" and then convert it to an absolute path sometimes.
    // We convert it to an absolute path during module resolution, so we shouldn't need to do that here.
    // https://github.com/microsoft/TypeScript/blob/ef802b1e4ddaf8d6e61d6005614dd796520448f8/src/compiler/commandLineParser.ts#L3243-L3245
    fn strReplacingTemplates(allocator: std.mem.Allocator, input: string, source: *const logger.Source) bun.OOM!string {
        var remaining = input;
        var string_builder = bun.StringBuilder{};
        const configDir = source.path.sourceDir();

        // There's only one template variable we support, so we can keep this simple for now.
        while (strings.indexOf(remaining, "${configDir}")) |index| {
            string_builder.count(remaining[0..index]);
            string_builder.count(configDir);
            remaining = remaining[index + "${configDir}".len ..];
        }

        // If we didn't find any template variables, return the original string without allocating.
        if (remaining.len == input.len) {
            return input;
        }

        string_builder.countZ(remaining);
        try string_builder.allocate(allocator);

        remaining = input;
        while (strings.indexOf(remaining, "${configDir}")) |index| {
            _ = string_builder.append(remaining[0..index]);
            _ = string_builder.append(configDir);
            remaining = remaining[index + "${configDir}".len ..];
        }

        // The extra null-byte here is unnecessary. But it's kind of nice in the debugger sometimes.
        _ = string_builder.appendZ(remaining);

        return string_builder.allocatedSlice()[0 .. string_builder.len - 1];
    }

    pub fn parse(
        allocator: std.mem.Allocator,
        log: *logger.Log,
        source: *const logger.Source,
        json_cache: *cache.Json,
    ) anyerror!?*TSConfigJSON {
        // Unfortunately "tsconfig.json" isn't actually JSON. It's some other
        // format that appears to be defined by the implementation details of the
        // TypeScript compiler.
        //
        // Attempt to parse it anyway by modifying the JSON parser, but just for
        // these particular files. This is likely not a completely accurate
        // emulation of what the TypeScript compiler does (e.g. string escape
        // behavior may also be different).
        const json: js_ast.Expr = (json_cache.parseTSConfig(log, source, allocator) catch null) orelse return null;

        bun.analytics.Features.tsconfig += 1;

        var result: TSConfigJSON = TSConfigJSON{ .abs_path = source.path.text, .paths = PathsMap.init(allocator) };
        errdefer allocator.free(result.paths);
        if (json.asProperty("extends")) |extends_value| {
            if (!source.path.isNodeModule()) {
                if (extends_value.expr.asString(allocator) orelse null) |str| {
                    result.extends = str;
                }
            }
        }
        var has_base_url = false;

        // Parse "compilerOptions"
        if (json.asProperty("compilerOptions")) |compiler_opts| {

            // Parse "baseUrl"
            if (compiler_opts.expr.asProperty("baseUrl")) |base_url_prop| {
                if ((base_url_prop.expr.asString(allocator))) |base_url| {
                    result.base_url = strReplacingTemplates(allocator, base_url, source) catch return null;
                    has_base_url = true;
                }
            }

            // Parse "emitDecoratorMetadata"
            if (compiler_opts.expr.asProperty("emitDecoratorMetadata")) |emit_decorator_metadata_prop| {
                if (emit_decorator_metadata_prop.expr.asBool()) |val| {
                    result.emit_decorator_metadata = val;
                }
            }

            // Parse "jsxFactory"
            if (compiler_opts.expr.asProperty("jsxFactory")) |jsx_prop| {
                if (jsx_prop.expr.asString(allocator)) |str| {
                    result.jsx.factory = try parseMemberExpressionForJSX(log, source, jsx_prop.loc, str, allocator);
                    result.jsx_flags.insert(.factory);
                }
            }

            // Parse "jsxFragmentFactory"
            if (compiler_opts.expr.asProperty("jsxFragmentFactory")) |jsx_prop| {
                if (jsx_prop.expr.asString(allocator)) |str| {
                    result.jsx.fragment = try parseMemberExpressionForJSX(log, source, jsx_prop.loc, str, allocator);
                    result.jsx_flags.insert(.fragment);
                }
            }

            // https://www.typescriptlang.org/docs/handbook/jsx.html#basic-usages
            if (compiler_opts.expr.asProperty("jsx")) |jsx_prop| {
                if (jsx_prop.expr.asString(allocator)) |str| {
                    const str_lower = allocator.alloc(u8, str.len) catch unreachable;
                    defer allocator.free(str_lower);
                    _ = strings.copyLowercase(str, str_lower);
                    // - We don't support "preserve" yet
                    if (options.JSX.RuntimeMap.get(str_lower)) |runtime| {
                        result.jsx.runtime = runtime.runtime;
                        result.jsx_flags.insert(.runtime);

                        if (runtime.development) |dev| {
                            result.jsx.development = dev;
                            result.jsx_flags.insert(.development);
                        }
                    }
                }
            }

            // Parse "jsxImportSource"
            if (compiler_opts.expr.asProperty("jsxImportSource")) |jsx_prop| {
                if (jsx_prop.expr.asString(allocator)) |str| {
                    if (str.len >= "solid-js".len and strings.eqlComptime(str[0.."solid-js".len], "solid-js")) {
                        result.jsx.runtime = .solid;
                        result.jsx_flags.insert(.runtime);
                    }

                    result.jsx.package_name = str;
                    result.jsx.setImportSource(allocator);
                    result.jsx_flags.insert(.import_source);
                }
            }

            // Parse "useDefineForClassFields"
            if (compiler_opts.expr.asProperty("useDefineForClassFields")) |use_define_value_prop| {
                if (use_define_value_prop.expr.asBool()) |val| {
                    result.use_define_for_class_fields = val;
                }
            }

            // Parse "importsNotUsedAsValues"
            if (compiler_opts.expr.asProperty("importsNotUsedAsValues")) |jsx_prop| {
                // This should never allocate since it will be utf8
                if ((jsx_prop.expr.asString(allocator))) |str| {
                    switch (ImportsNotUsedAsValue.List.get(str) orelse ImportsNotUsedAsValue.invalid) {
                        .preserve, .err => {
                            result.preserve_imports_not_used_as_values = true;
                        },
                        .remove => {},
                        else => {
                            log.addRangeWarningFmt(source, source.rangeOfString(jsx_prop.loc), allocator, "Invalid value \"{s}\" for \"importsNotUsedAsValues\"", .{str}) catch {};
                        },
                    }
                }
            }

            if (compiler_opts.expr.asProperty("moduleSuffixes")) |prefixes| {
                if (!source.path.isNodeModule()) handle_module_prefixes: {
                    var array = prefixes.expr.asArray() orelse break :handle_module_prefixes;
                    while (array.next()) |*element| {
                        if (element.asString(allocator)) |str| {
                            if (str.len > 0) {
                                // Only warn when there is actually content
                                // Sometimes, people do "moduleSuffixes": [""]
                                log.addWarning(source, prefixes.loc, "moduleSuffixes is not supported yet") catch {};
                                break :handle_module_prefixes;
                            }
                        }
                    }
                }
            }

            // Parse "paths"
            if (compiler_opts.expr.asProperty("paths")) |paths_prop| {
                switch (paths_prop.expr.data) {
                    .e_object => {
                        defer {
                            bun.analytics.Features.tsconfig_paths += 1;
                        }
                        var paths = paths_prop.expr.data.e_object;
                        result.base_url_for_paths = if (result.base_url.len > 0) result.base_url else ".";
                        result.paths = PathsMap.init(allocator);
                        for (paths.properties.slice()) |property| {
                            const key_prop = property.key orelse continue;
                            const key = (key_prop.asString(allocator)) orelse continue;

                            if (!TSConfigJSON.isValidTSConfigPathPattern(key, log, source, key_prop.loc, allocator)) {
                                continue;
                            }

                            const value_prop = property.value orelse continue;

                            // The "paths" field is an object which maps a pattern to an
                            // array of remapping patterns to try, in priority order. See
                            // the documentation for examples of how this is used:
                            // https://www.typescriptlang.org/docs/handbook/module-resolution.html#path-mapping.
                            //
                            // One particular example:
                            //
                            //   {
                            //     "compilerOptions": {
                            //       "baseUrl": "projectRoot",
                            //       "paths": {
                            //         "*": [
                            //           "*",
                            //           "generated/*"
                            //         ]
                            //       }
                            //     }
                            //   }
                            //
                            // Matching "folder1/file2" should first check "projectRoot/folder1/file2"
                            // and then, if that didn't work, also check "projectRoot/generated/folder1/file2".
                            switch (value_prop.data) {
                                .e_array => {
                                    const array = value_prop.data.e_array.slice();

                                    if (array.len > 0) {
                                        var values = allocator.alloc(string, array.len) catch unreachable;
                                        errdefer allocator.free(values);
                                        var count: usize = 0;
                                        for (array) |expr| {
                                            if ((expr.asString(allocator))) |str_| {
                                                const str = strReplacingTemplates(allocator, str_, source) catch return null;
                                                errdefer allocator.free(str);
                                                if (TSConfigJSON.isValidTSConfigPathPattern(
                                                    str,
                                                    log,
                                                    source,
                                                    expr.loc,
                                                    allocator,
                                                ) and
                                                    (has_base_url or
                                                        TSConfigJSON.isValidTSConfigPathNoBaseURLPattern(
                                                            str,
                                                            log,
                                                            source,
                                                            allocator,
                                                            expr.loc,
                                                        )))
                                                {
                                                    values[count] = str;
                                                    count += 1;
                                                }
                                            }
                                        }
                                        if (count > 0) {
                                            result.paths.put(
                                                key,
                                                values[0..count],
                                            ) catch unreachable;
                                        }
                                    }
                                },
                                else => {
                                    log.addRangeWarningFmt(
                                        source,
                                        source.rangeOfString(key_prop.loc),
                                        allocator,
                                        "Substitutions for pattern \"{s}\" should be an array",
                                        .{key},
                                    ) catch {};
                                },
                            }
                        }
                    },
                    else => {},
                }
            }
        }

        if (Environment.isDebug and has_base_url) {
            assert(result.base_url.len > 0);
        }

        return TSConfigJSON.new(result);
    }

    pub fn isValidTSConfigPathPattern(text: string, log: *logger.Log, source: *const logger.Source, loc: logger.Loc, allocator: std.mem.Allocator) bool {
        var found_asterisk = false;
        for (text) |c| {
            if (c == '*') {
                if (found_asterisk) {
                    const r = source.rangeOfString(loc);
                    log.addRangeWarningFmt(source, r, allocator, "Invalid pattern \"{s}\", must have at most one \"*\" character", .{text}) catch {};
                    return false;
                }
                found_asterisk = true;
            }
        }

        return true;
    }

    pub fn parseMemberExpressionForJSX(log: *logger.Log, source: *const logger.Source, loc: logger.Loc, text: string, allocator: std.mem.Allocator) ![]string {
        if (text.len == 0) {
            return &([_]string{});
        }
        // foo.bar == 2
        // foo.bar. == 2
        // foo == 1
        // foo.bar.baz == 3
        // foo.bar.baz.bun == 4
        const parts_count = std.mem.count(u8, text, ".") + @as(usize, @intFromBool(text[text.len - 1] != '.'));
        var parts = std.array_list.Managed(string).initCapacity(allocator, parts_count) catch unreachable;

        if (parts_count == 1) {
            if (!js_lexer.isIdentifier(text)) {
                const warn = source.rangeOfString(loc);
                log.addRangeWarningFmt(source, warn, allocator, "Invalid JSX member expression: \"{s}\"", .{text}) catch {};
                parts.deinit();
                return &([_]string{});
            }

            parts.appendAssumeCapacity(text);
            return parts.items;
        }

        var iter = std.mem.tokenizeScalar(u8, text, '.');

        while (iter.next()) |part| {
            if (!js_lexer.isIdentifier(part)) {
                const warn = source.rangeOfString(loc);
                log.addRangeWarningFmt(source, warn, allocator, "Invalid JSX member expression: \"{s}\"", .{part}) catch {};
                parts.deinit();
                return &([_]string{});
            }
            parts.appendAssumeCapacity(part);
        }

        return parts.items;
    }

    pub fn isSlash(c: u8) bool {
        return c == '/' or c == '\\';
    }

    pub fn isValidTSConfigPathNoBaseURLPattern(text: string, log: *logger.Log, source: *const logger.Source, allocator: std.mem.Allocator, loc: logger.Loc) bool {
        var c0: u8 = 0;
        var c1: u8 = 0;
        var c2: u8 = 0;
        const n = text.len;

        switch (n) {
            0 => {
                return false;
            },
            // Relative "." or ".."

            1 => {
                return text[0] == '.';
            },
            // "..", ".\", "./"
            2 => {
                return text[0] == '.' and (text[1] == '.' or text[1] == '\\' or text[1] == '/');
            },
            else => {
                c0 = text[0];
                c1 = text[1];
                c2 = text[2];
            },
        }

        // Relative "./" or "../" or ".\\" or "..\\"
        if (c0 == '.' and (TSConfigJSON.isSlash(c1) or (c1 == '.' and TSConfigJSON.isSlash(c2)))) {
            return true;
        }

        // Absolute DOS "c:/" or "c:\\"
        if (c1 == ':' and TSConfigJSON.isSlash(c2)) {
            switch (c0) {
                'a'...'z', 'A'...'Z' => {
                    return true;
                },
                else => {},
            }
        }

        // Absolute unix "/"
        if (TSConfigJSON.isSlash(c0)) {
            return true;
        }

        const r = source.rangeOfString(loc);
        log.addRangeWarningFmt(source, r, allocator, "Non-relative path \"{s}\" is not allowed when \"baseUrl\" is not set (did you forget a leading \"./\"?)", .{text}) catch {};
        return false;
    }

    pub fn deinit(this: *TSConfigJSON) void {
        this.paths.deinit();
        bun.destroy(this);
    }
};

const string = []const u8;

const cache = @import("../cache.zig");
const options = @import("../options.zig");
const std = @import("std");

const bun = @import("bun");
const Environment = bun.Environment;
const assert = bun.assert;
const js_ast = bun.ast;
const js_lexer = bun.js_lexer;
const logger = bun.logger;
const strings = bun.strings;
