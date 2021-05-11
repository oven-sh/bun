usingnamespace @import("../global.zig");
const std = @import("std");
const options = @import("../options.zig");
const log = @import("../logger.zig");
const cache = @import("../cache.zig");
const logger = @import("../logger.zig");
const js_ast = @import("../js_ast.zig");
const alloc = @import("../alloc.zig");
const fs = @import("../fs.zig");
const resolver = @import("./resolver.zig");

const MainFieldMap = std.StringHashMap(string);
const BrowserMap = std.StringHashMap(string);

pub const PackageJSON = struct {
    source: logger.Source,
    main_fields: MainFieldMap,
    module_type: options.ModuleType,

    // Present if the "browser" field is present. This field is intended to be
    // used by bundlers and lets you redirect the paths of certain 3rd-party
    // modules that don't work in the browser to other modules that shim that
    // functionality. That way you don't have to rewrite the code for those 3rd-
    // party modules. For example, you might remap the native "util" node module
    // to something like https://www.npmjs.com/package/util so it works in the
    // browser.
    //
    // This field contains a mapping of absolute paths to absolute paths. Mapping
    // to an empty path indicates that the module is disabled. As far as I can
    // tell, the official spec is an abandoned GitHub repo hosted by a user account:
    // https://github.com/defunctzombie/package-browser-field-spec. The npm docs
    // say almost nothing: https://docs.npmjs.com/files/package.json.
    //
    // Note that the non-package "browser" map has to be checked twice to match
    // Webpack's behavior: once before resolution and once after resolution. It
    // leads to some unintuitive failure cases that we must emulate around missing
    // file extensions:
    //
    // * Given the mapping "./no-ext": "./no-ext-browser.js" the query "./no-ext"
    //   should match but the query "./no-ext.js" should NOT match.
    //
    // * Given the mapping "./ext.js": "./ext-browser.js" the query "./ext.js"
    //   should match and the query "./ext" should ALSO match.
    //
    browser_map: BrowserMap,

    pub fn parse(r: *resolver.Resolver, input_path: string) ?*PackageJSON {
        if (!has_set_default_main_fields) {
            has_set_default_main_fields = true;
        }

        const parts = [_]string{ input_path, "package.json" };
        const package_json_path = std.fs.path.join(r.allocator, &parts) catch unreachable;
        errdefer r.allocator.free(package_json_path);

        const entry: *r.caches.fs.Entry = try r.caches.fs.readFile(r.fs, input_path) catch |err| {
            r.log.addErrorFmt(null, .empty, r.allocator, "Cannot read file \"{s}\": {s}", .{ r.prettyPath(fs.Path.init(input_path)), @errorName(err) }) catch unreachable;
            return null;
        };

        if (r.debug_logs) |debug| {
            debug.addNoteFmt("The file \"{s}\" exists", .{package_json_path}) catch unreachable;
        }

        const key_path = fs.Path.init(allocator.dupe(package_json_path) catch unreachable);

        var json_source = logger.Source.initPathString(key_path);
        json_source.contents = entry.contents;
        json_source.path.pretty = r.prettyPath(json_source.path);

        const json: js_ast.Expr = (r.caches.json.parseJSON(r.log, json_source, r.allocator) catch |err| {
            if (isDebug) {
                Output.printError("{s}: JSON parse error: {s}", .{ package_json_path, @errorName(err) });
            }
            return null;
        } orelse return null);

        var package_json = PackageJSON{
            .source = json_source,
            .browser_map = BrowserMap.init(r.allocator),
            .main_fields_map = MainFieldMap.init(r.allocator),
        };

        if (json.getProperty("type")) |type_json| {
            if (type_json.expr.getString(r.allocator)) |type_str| {
                switch (options.ModuleType.List.get(type_str) orelse options.ModuleType.unknown) {
                    .cjs => {
                        package_json.module_type = .cjs;
                    },
                    .esm => {
                        package_json.module_type = .esm;
                    },
                    .unknown => {
                        r.log.addRangeWarningFmt(
                            &json_source,
                            json_source.rangeOfString(type_json.loc),
                            r.allocator,
                            "\"{s}\" is not a valid value for \"type\" field (must be either \"commonjs\" or \"module\")",
                            .{type_str},
                        ) catch unreachable;
                    },
                }
            } else {
                r.log.addWarning(&json_source, type_json.loc, "The value for \"type\" must be a string") catch unreachable;
            }
        }

        // Read the "main" fields
        for (r.opts.main_fields) |main| {
            if (json.getProperty(main)) |main_json| {
                const expr: js_ast.Expr = main_json.expr;

                if ((main_json.getString(r.allocator) catch null)) |str| {
                    if (str.len > 0) {
                        package_json.main_fields.put(main, str) catch unreachable;
                    }
                }
            }
        }

        // Read the "browser" property, but only when targeting the browser
        if (r.opts.platform == .browser) {
            // We both want the ability to have the option of CJS vs. ESM and the
            // option of having node vs. browser. The way to do this is to use the
            // object literal form of the "browser" field like this:
            //
            //   "main": "dist/index.node.cjs.js",
            //   "module": "dist/index.node.esm.js",
            //   "browser": {
            //     "./dist/index.node.cjs.js": "./dist/index.browser.cjs.js",
            //     "./dist/index.node.esm.js": "./dist/index.browser.esm.js"
            //   },
            //
            if (json.getProperty("browser")) |browser_prop| {
                switch (browser_prop.data) {
                    .e_object => |obj| {
                        // The value is an object

                        // Remap all files in the browser field
                        for (obj.properties) |prop| {
                            var _key_str = (prop.key orelse continue).getString(r.allocator) catch unreachable;
                            const value: js_ast.Expr = prop.value orelse continue;

                            // Normalize the path so we can compare against it without getting
                            // confused by "./". There is no distinction between package paths and
                            // relative paths for these values because some tools (i.e. Browserify)
                            // don't make such a distinction.
                            //
                            // This leads to weird things like a mapping for "./foo" matching an
                            // import of "foo", but that's actually not a bug. Or arguably it's a
                            // bug in Browserify but we have to replicate this bug because packages
                            // do this in the wild.
                            const key = fs.Path.normalize(_key_str, r.allocator);

                            switch (value.data) {
                                .e_string => |str| {
                                    // If this is a string, it's a replacement package
                                    package_json.browser_map.put(key, str) catch unreachable;
                                },
                                .e_boolean => |boolean| {
                                    if (!boolean.value) {
                                        package_json.browser_map.put(key, "") catch unreachable;
                                    }
                                },
                                else => {
                                    r.log.addWarning("Each \"browser\" mapping must be a string or boolean", value.loc) catch unreachable;
                                },
                            }
                        }
                    },
                    else => {},
                }
            }
        }

        // TODO: side effects
        // TODO: exports map

        return package_json;
    }
};
