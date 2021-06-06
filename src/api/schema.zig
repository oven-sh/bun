const std = @import("std");

pub const Api = struct {
    pub const Loader = enum(u8) {
        _none,
        /// jsx
        jsx,

        /// js
        js,

        /// ts
        ts,

        /// tsx
        tsx,

        /// css
        css,

        /// file
        file,

        /// json
        json,

        _,

        pub fn jsonStringify(self: *const @This(), opts: anytype, o: anytype) !void {
            return try std.json.stringify(@tagName(self), opts, o);
        }
    };

    pub const ResolveMode = enum(u8) {
        _none,
        /// disable
        disable,

        /// lazy
        lazy,

        /// dev
        dev,

        /// bundle
        bundle,

        _,

        pub fn jsonStringify(self: *const @This(), opts: anytype, o: anytype) !void {
            return try std.json.stringify(@tagName(self), opts, o);
        }
    };

    pub const Platform = enum(u8) {
        _none,
        /// browser
        browser,

        /// node
        node,

        _,

        pub fn jsonStringify(self: *const @This(), opts: anytype, o: anytype) !void {
            return try std.json.stringify(@tagName(self), opts, o);
        }
    };

    pub const JsxRuntime = enum(u8) {
        _none,
        /// automatic
        automatic,

        /// classic
        classic,

        _,

        pub fn jsonStringify(self: *const @This(), opts: anytype, o: anytype) !void {
            return try std.json.stringify(@tagName(self), opts, o);
        }
    };

    pub const Jsx = struct {
        /// factory
        factory: []const u8,

        /// runtime
        runtime: JsxRuntime,

        /// fragment
        fragment: []const u8,

        /// development
        development: bool = false,

        /// import_source
        import_source: []const u8,

        /// react_fast_refresh
        react_fast_refresh: bool = false,

        pub fn decode(allocator: *std.mem.Allocator, reader: anytype) anyerror!Jsx {
            var obj = std.mem.zeroes(Jsx);
            try update(&obj, allocator, reader);
            return obj;
        }
        pub fn update(result: *Jsx, allocator: *std.mem.Allocator, reader: anytype) anyerror!void {
            var length: usize = 0;
            length = try reader.readIntNative(u32);
            if (result.factory.len != length) {
                result.factory = try allocator.alloc(u8, length);
            }
            _ = try reader.readAll(result.factory);
            result.runtime = try reader.readEnum(JsxRuntime, .Little);
            length = try reader.readIntNative(u32);
            if (result.fragment.len != length) {
                result.fragment = try allocator.alloc(u8, length);
            }
            _ = try reader.readAll(result.fragment);
            result.development = (try reader.readByte()) == @as(u8, 1);
            length = try reader.readIntNative(u32);
            if (result.import_source.len != length) {
                result.import_source = try allocator.alloc(u8, length);
            }
            _ = try reader.readAll(result.import_source);
            result.react_fast_refresh = (try reader.readByte()) == @as(u8, 1);
            return;
        }

        pub fn encode(result: *const @This(), writer: anytype) anyerror!void {
            try writer.writeIntNative(u32, @intCast(u32, result.factory.len));
            try writer.writeAll(std.mem.sliceAsBytes(result.factory));

            try writer.writeIntNative(@TypeOf(@enumToInt(result.runtime)), @enumToInt(result.runtime));

            try writer.writeIntNative(u32, @intCast(u32, result.fragment.len));
            try writer.writeAll(std.mem.sliceAsBytes(result.fragment));

            try writer.writeByte(@boolToInt(result.development));

            try writer.writeIntNative(u32, @intCast(u32, result.import_source.len));
            try writer.writeAll(std.mem.sliceAsBytes(result.import_source));

            try writer.writeByte(@boolToInt(result.react_fast_refresh));
            return;
        }
    };

    pub const StringPointer = struct {
        /// offset
        offset: u32 = 0,

        /// length
        length: u32 = 0,

        pub fn decode(allocator: *std.mem.Allocator, reader: anytype) anyerror!StringPointer {
            var obj = std.mem.zeroes(StringPointer);
            try update(&obj, allocator, reader);
            return obj;
        }
        pub fn update(result: *StringPointer, allocator: *std.mem.Allocator, reader: anytype) anyerror!void {
            _ = try reader.readAll(std.mem.asBytes(&result.offset));
            _ = try reader.readAll(std.mem.asBytes(&result.length));
            return;
        }

        pub fn encode(result: *const @This(), writer: anytype) anyerror!void {
            try writer.writeIntNative(u32, result.offset);

            try writer.writeIntNative(u32, result.length);
            return;
        }
    };

    pub const JavascriptBundledModule = struct {
        /// path
        path: StringPointer,

        /// code
        code: StringPointer,

        /// package_id
        package_id: u32 = 0,

        pub fn decode(allocator: *std.mem.Allocator, reader: anytype) anyerror!JavascriptBundledModule {
            var obj = std.mem.zeroes(JavascriptBundledModule);
            try update(&obj, allocator, reader);
            return obj;
        }
        pub fn update(result: *JavascriptBundledModule, allocator: *std.mem.Allocator, reader: anytype) anyerror!void {
            result.path = try StringPointer.decode(allocator, reader);
            result.code = try StringPointer.decode(allocator, reader);
            _ = try reader.readAll(std.mem.asBytes(&result.package_id));
            return;
        }

        pub fn encode(result: *const @This(), writer: anytype) anyerror!void {
            try result.path.encode(writer);

            try result.code.encode(writer);

            try writer.writeIntNative(u32, result.package_id);
            return;
        }
    };

    pub const JavascriptBundledPackage = struct {
        /// name
        name: StringPointer,

        /// version
        version: StringPointer,

        /// hash
        hash: u32 = 0,

        /// modules_offset
        modules_offset: u32 = 0,

        /// modules_length
        modules_length: u32 = 0,

        pub fn decode(allocator: *std.mem.Allocator, reader: anytype) anyerror!JavascriptBundledPackage {
            var obj = std.mem.zeroes(JavascriptBundledPackage);
            try update(&obj, allocator, reader);
            return obj;
        }
        pub fn update(result: *JavascriptBundledPackage, allocator: *std.mem.Allocator, reader: anytype) anyerror!void {
            result.name = try StringPointer.decode(allocator, reader);
            result.version = try StringPointer.decode(allocator, reader);
            _ = try reader.readAll(std.mem.asBytes(&result.hash));
            _ = try reader.readAll(std.mem.asBytes(&result.modules_offset));
            _ = try reader.readAll(std.mem.asBytes(&result.modules_length));
            return;
        }

        pub fn encode(result: *const @This(), writer: anytype) anyerror!void {
            try result.name.encode(writer);

            try result.version.encode(writer);

            try writer.writeIntNative(u32, result.hash);

            try writer.writeIntNative(u32, result.modules_offset);

            try writer.writeIntNative(u32, result.modules_length);
            return;
        }
    };

    pub const JavascriptBundle = struct {
        /// modules
        modules: []JavascriptBundledModule,

        /// packages
        packages: []JavascriptBundledPackage,

        /// etag
        etag: []const u8,

        /// generated_at
        generated_at: u32 = 0,

        /// app_package_json_dependencies_hash
        app_package_json_dependencies_hash: []const u8,

        /// import_from_name
        import_from_name: []const u8,

        /// manifest_string
        manifest_string: []const u8,

        pub fn decode(allocator: *std.mem.Allocator, reader: anytype) anyerror!JavascriptBundle {
            var obj = std.mem.zeroes(JavascriptBundle);
            try update(&obj, allocator, reader);
            return obj;
        }
        pub fn update(result: *JavascriptBundle, allocator: *std.mem.Allocator, reader: anytype) anyerror!void {
            var length: usize = 0;
            length = try reader.readIntNative(u32);
            result.modules = try allocator.alloc(JavascriptBundledModule, length);
            {
                var j: usize = 0;
                while (j < length) : (j += 1) {
                    result.modules[j] = try JavascriptBundledModule.decode(allocator, reader);
                }
            }
            length = try reader.readIntNative(u32);
            result.packages = try allocator.alloc(JavascriptBundledPackage, length);
            {
                var j: usize = 0;
                while (j < length) : (j += 1) {
                    result.packages[j] = try JavascriptBundledPackage.decode(allocator, reader);
                }
            }
            length = @intCast(usize, try reader.readIntNative(u32));
            if (result.etag != length) {
                result.etag = try allocator.alloc(u8, length);
            }
            _ = try reader.readAll(result.etag);
            _ = try reader.readAll(std.mem.asBytes(&result.generated_at));
            length = @intCast(usize, try reader.readIntNative(u32));
            if (result.app_package_json_dependencies_hash != length) {
                result.app_package_json_dependencies_hash = try allocator.alloc(u8, length);
            }
            _ = try reader.readAll(result.app_package_json_dependencies_hash);
            length = @intCast(usize, try reader.readIntNative(u32));
            if (result.import_from_name != length) {
                result.import_from_name = try allocator.alloc(u8, length);
            }
            _ = try reader.readAll(result.import_from_name);
            length = @intCast(usize, try reader.readIntNative(u32));
            if (result.manifest_string != length) {
                result.manifest_string = try allocator.alloc(u8, length);
            }
            _ = try reader.readAll(result.manifest_string);
            return;
        }

        pub fn encode(result: *const @This(), writer: anytype) anyerror!void {
            var n: usize = 0;
            n = result.modules.len;
            _ = try writer.writeIntNative(u32, @intCast(u32, n));
            {
                var j: usize = 0;
                while (j < n) : (j += 1) {
                    try result.modules[j].encode(writer);
                }
            }

            n = result.packages.len;
            _ = try writer.writeIntNative(u32, @intCast(u32, n));
            {
                var j: usize = 0;
                while (j < n) : (j += 1) {
                    try result.packages[j].encode(writer);
                }
            }

            try writer.writeIntNative(u32, @intCast(u32, result.etag.len));
            try writer.writeAll(result.etag);

            try writer.writeIntNative(u32, result.generated_at);

            try writer.writeIntNative(u32, @intCast(u32, result.app_package_json_dependencies_hash.len));
            try writer.writeAll(result.app_package_json_dependencies_hash);

            try writer.writeIntNative(u32, @intCast(u32, result.import_from_name.len));
            try writer.writeAll(result.import_from_name);

            try writer.writeIntNative(u32, @intCast(u32, result.manifest_string.len));
            try writer.writeAll(result.manifest_string);
            return;
        }
    };

    pub const JavascriptBundleContainer = struct {
        /// bundle_format_version
        bundle_format_version: ?u32 = null,

        /// bundle
        bundle: ?JavascriptBundle = null,

        /// code_length
        code_length: ?u32 = null,

        pub fn decode(allocator: *std.mem.Allocator, reader: anytype) anyerror!JavascriptBundleContainer {
            var obj = std.mem.zeroes(JavascriptBundleContainer);
            try update(&obj, allocator, reader);
            return obj;
        }
        pub fn update(result: *JavascriptBundleContainer, allocator: *std.mem.Allocator, reader: anytype) anyerror!void {
            while (true) {
                const field_type: u8 = try reader.readByte();
                switch (field_type) {
                    0 => {
                        return;
                    },

                    1 => {
                        _ = try reader.readAll(std.mem.asBytes(&result.bundle_format_version));
                    },
                    2 => {
                        result.bundle = try JavascriptBundle.decode(allocator, reader);
                    },
                    3 => {
                        _ = try reader.readAll(std.mem.asBytes(&result.code_length));
                    },
                    else => {
                        return error.InvalidMessage;
                    },
                }
            }
        }

        pub fn encode(result: *const @This(), writer: anytype) anyerror!void {
            if (result.bundle_format_version) |bundle_format_version| {
                try writer.writeByte(1);
                try writer.writeIntNative(u32, bundle_format_version);
            }

            if (result.bundle) |bundle| {
                try writer.writeByte(2);
                try bundle.encode(writer);
            }

            if (result.code_length) |code_length| {
                try writer.writeByte(3);
                try writer.writeIntNative(u32, code_length);
            }
            try writer.writeByte(0);
            return;
        }
    };

    pub const ScanDependencyMode = enum(u8) {
        _none,
        /// app
        app,

        /// all
        all,

        _,

        pub fn jsonStringify(self: *const @This(), opts: anytype, o: anytype) !void {
            return try std.json.stringify(@tagName(self), opts, o);
        }
    };

    pub const ModuleImportType = enum(u8) {
        _none,
        /// import
        import,

        /// require
        require,

        _,

        pub fn jsonStringify(self: *const @This(), opts: anytype, o: anytype) !void {
            return try std.json.stringify(@tagName(self), opts, o);
        }
    };

    pub const ModuleImportRecord = struct {
        /// kind
        kind: ModuleImportType,

        /// path
        path: []const u8,

        /// dynamic
        dynamic: bool = false,

        pub fn decode(allocator: *std.mem.Allocator, reader: anytype) anyerror!ModuleImportRecord {
            var obj = std.mem.zeroes(ModuleImportRecord);
            try update(&obj, allocator, reader);
            return obj;
        }
        pub fn update(result: *ModuleImportRecord, allocator: *std.mem.Allocator, reader: anytype) anyerror!void {
            var length: usize = 0;
            result.kind = try reader.readEnum(ModuleImportType, .Little);
            length = try reader.readIntNative(u32);
            if (result.path.len != length) {
                result.path = try allocator.alloc(u8, length);
            }
            _ = try reader.readAll(result.path);
            result.dynamic = (try reader.readByte()) == @as(u8, 1);
            return;
        }

        pub fn encode(result: *const @This(), writer: anytype) anyerror!void {
            try writer.writeIntNative(@TypeOf(@enumToInt(result.kind)), @enumToInt(result.kind));

            try writer.writeIntNative(u32, @intCast(u32, result.path.len));
            try writer.writeAll(std.mem.sliceAsBytes(result.path));

            try writer.writeByte(@boolToInt(result.dynamic));
            return;
        }
    };

    pub const Module = struct {
        /// path
        path: []const u8,

        /// imports
        imports: []ModuleImportRecord,

        pub fn decode(allocator: *std.mem.Allocator, reader: anytype) anyerror!Module {
            var obj = std.mem.zeroes(Module);
            try update(&obj, allocator, reader);
            return obj;
        }
        pub fn update(result: *Module, allocator: *std.mem.Allocator, reader: anytype) anyerror!void {
            var length: usize = 0;
            length = try reader.readIntNative(u32);
            if (result.path.len != length) {
                result.path = try allocator.alloc(u8, length);
            }
            _ = try reader.readAll(result.path);
            length = try reader.readIntNative(u32);
            result.imports = try allocator.alloc(ModuleImportRecord, length);
            {
                var j: usize = 0;
                while (j < length) : (j += 1) {
                    result.imports[j] = try ModuleImportRecord.decode(allocator, reader);
                }
            }
            return;
        }

        pub fn encode(result: *const @This(), writer: anytype) anyerror!void {
            var n: usize = 0;
            try writer.writeIntNative(u32, @intCast(u32, result.path.len));
            try writer.writeAll(std.mem.sliceAsBytes(result.path));

            n = result.imports.len;
            _ = try writer.writeIntNative(u32, @intCast(u32, n));
            {
                var j: usize = 0;
                while (j < n) : (j += 1) {
                    try result.imports[j].encode(writer);
                }
            }
            return;
        }
    };

    pub const TransformOptions = struct {
        /// jsx
        jsx: ?Jsx = null,

        /// tsconfig_override
        tsconfig_override: ?[]const u8 = null,

        /// resolve
        resolve: ?ResolveMode = null,

        /// public_url
        public_url: ?[]const u8 = null,

        /// absolute_working_dir
        absolute_working_dir: ?[]const u8 = null,

        /// define_keys
        define_keys: []const []const u8,

        /// define_values
        define_values: []const []const u8,

        /// preserve_symlinks
        preserve_symlinks: ?bool = null,

        /// entry_points
        entry_points: []const []const u8,

        /// write
        write: ?bool = null,

        /// inject
        inject: []const []const u8,

        /// output_dir
        output_dir: ?[]const u8 = null,

        /// external
        external: []const []const u8,

        /// loader_keys
        loader_keys: []const []const u8,

        /// loader_values
        loader_values: []const Loader,

        /// main_fields
        main_fields: []const []const u8,

        /// platform
        platform: ?Platform = null,

        /// serve
        serve: ?bool = null,

        /// extension_order
        extension_order: []const []const u8,

        /// public_dir
        public_dir: ?[]const u8 = null,

        /// only_scan_dependencies
        only_scan_dependencies: ?ScanDependencyMode = null,

        /// generate_node_module_bundle
        generate_node_module_bundle: ?bool = null,

        pub fn decode(allocator: *std.mem.Allocator, reader: anytype) anyerror!TransformOptions {
            var obj = std.mem.zeroes(TransformOptions);
            try update(&obj, allocator, reader);
            return obj;
        }
        pub fn update(result: *TransformOptions, allocator: *std.mem.Allocator, reader: anytype) anyerror!void {
            var length: usize = 0;
            while (true) {
                const field_type: u8 = try reader.readByte();
                switch (field_type) {
                    0 => {
                        return;
                    },

                    1 => {
                        result.jsx = try Jsx.decode(allocator, reader);
                    },
                    2 => {
                        length = try reader.readIntNative(u32);
                        if ((result.tsconfig_override orelse &([_]u8{})).len != length) {
                            result.tsconfig_override = try allocator.alloc(u8, length);
                        }
                        _ = try reader.readAll(result.tsconfig_override.?);
                    },
                    3 => {
                        result.resolve = try reader.readEnum(ResolveMode, .Little);
                    },
                    4 => {
                        length = try reader.readIntNative(u32);
                        if ((result.public_url orelse &([_]u8{})).len != length) {
                            result.public_url = try allocator.alloc(u8, length);
                        }
                        _ = try reader.readAll(result.public_url.?);
                    },
                    5 => {
                        length = try reader.readIntNative(u32);
                        if ((result.absolute_working_dir orelse &([_]u8{})).len != length) {
                            result.absolute_working_dir = try allocator.alloc(u8, length);
                        }
                        _ = try reader.readAll(result.absolute_working_dir.?);
                    },
                    6 => {
                        {
                            var array_count = try reader.readIntNative(u32);
                            if (array_count != result.define_keys.len) {
                                result.define_keys = try allocator.alloc([]const u8, array_count);
                            }
                            length = try reader.readIntNative(u32);
                            for (result.define_keys) |content, j| {
                                if (result.define_keys[j].len != length and length > 0) {
                                    result.define_keys[j] = try allocator.alloc(u8, length);
                                }
                                _ = try reader.readAll(result.define_keys[j].?);
                            }
                        }
                    },
                    7 => {
                        {
                            var array_count = try reader.readIntNative(u32);
                            if (array_count != result.define_values.len) {
                                result.define_values = try allocator.alloc([]const u8, array_count);
                            }
                            length = try reader.readIntNative(u32);
                            for (result.define_values) |content, j| {
                                if (result.define_values[j].len != length and length > 0) {
                                    result.define_values[j] = try allocator.alloc(u8, length);
                                }
                                _ = try reader.readAll(result.define_values[j].?);
                            }
                        }
                    },
                    8 => {
                        result.preserve_symlinks = (try reader.readByte()) == @as(u8, 1);
                    },
                    9 => {
                        {
                            var array_count = try reader.readIntNative(u32);
                            if (array_count != result.entry_points.len) {
                                result.entry_points = try allocator.alloc([]const u8, array_count);
                            }
                            length = try reader.readIntNative(u32);
                            for (result.entry_points) |content, j| {
                                if (result.entry_points[j].len != length and length > 0) {
                                    result.entry_points[j] = try allocator.alloc(u8, length);
                                }
                                _ = try reader.readAll(result.entry_points[j].?);
                            }
                        }
                    },
                    10 => {
                        result.write = (try reader.readByte()) == @as(u8, 1);
                    },
                    11 => {
                        {
                            var array_count = try reader.readIntNative(u32);
                            if (array_count != result.inject.len) {
                                result.inject = try allocator.alloc([]const u8, array_count);
                            }
                            length = try reader.readIntNative(u32);
                            for (result.inject) |content, j| {
                                if (result.inject[j].len != length and length > 0) {
                                    result.inject[j] = try allocator.alloc(u8, length);
                                }
                                _ = try reader.readAll(result.inject[j].?);
                            }
                        }
                    },
                    12 => {
                        length = try reader.readIntNative(u32);
                        if ((result.output_dir orelse &([_]u8{})).len != length) {
                            result.output_dir = try allocator.alloc(u8, length);
                        }
                        _ = try reader.readAll(result.output_dir.?);
                    },
                    13 => {
                        {
                            var array_count = try reader.readIntNative(u32);
                            if (array_count != result.external.len) {
                                result.external = try allocator.alloc([]const u8, array_count);
                            }
                            length = try reader.readIntNative(u32);
                            for (result.external) |content, j| {
                                if (result.external[j].len != length and length > 0) {
                                    result.external[j] = try allocator.alloc(u8, length);
                                }
                                _ = try reader.readAll(result.external[j].?);
                            }
                        }
                    },
                    14 => {
                        {
                            var array_count = try reader.readIntNative(u32);
                            if (array_count != result.loader_keys.len) {
                                result.loader_keys = try allocator.alloc([]const u8, array_count);
                            }
                            length = try reader.readIntNative(u32);
                            for (result.loader_keys) |content, j| {
                                if (result.loader_keys[j].len != length and length > 0) {
                                    result.loader_keys[j] = try allocator.alloc(u8, length);
                                }
                                _ = try reader.readAll(result.loader_keys[j].?);
                            }
                        }
                    },
                    15 => {
                        length = try reader.readIntNative(u32);
                        if (result.loader_values != length) {
                            result.loader_values = try allocator.alloc(Loader, length);
                        }
                        {
                            var j: usize = 0;
                            while (j < length) : (j += 1) {
                                result.loader_values[j] = try reader.readEnum(Loader, .Little);
                            }
                        }
                    },
                    16 => {
                        {
                            var array_count = try reader.readIntNative(u32);
                            if (array_count != result.main_fields.len) {
                                result.main_fields = try allocator.alloc([]const u8, array_count);
                            }
                            length = try reader.readIntNative(u32);
                            for (result.main_fields) |content, j| {
                                if (result.main_fields[j].len != length and length > 0) {
                                    result.main_fields[j] = try allocator.alloc(u8, length);
                                }
                                _ = try reader.readAll(result.main_fields[j].?);
                            }
                        }
                    },
                    17 => {
                        result.platform = try reader.readEnum(Platform, .Little);
                    },
                    18 => {
                        result.serve = (try reader.readByte()) == @as(u8, 1);
                    },
                    19 => {
                        {
                            var array_count = try reader.readIntNative(u32);
                            if (array_count != result.extension_order.len) {
                                result.extension_order = try allocator.alloc([]const u8, array_count);
                            }
                            length = try reader.readIntNative(u32);
                            for (result.extension_order) |content, j| {
                                if (result.extension_order[j].len != length and length > 0) {
                                    result.extension_order[j] = try allocator.alloc(u8, length);
                                }
                                _ = try reader.readAll(result.extension_order[j].?);
                            }
                        }
                    },
                    20 => {
                        length = try reader.readIntNative(u32);
                        if ((result.public_dir orelse &([_]u8{})).len != length) {
                            result.public_dir = try allocator.alloc(u8, length);
                        }
                        _ = try reader.readAll(result.public_dir.?);
                    },
                    21 => {
                        result.only_scan_dependencies = try reader.readEnum(ScanDependencyMode, .Little);
                    },
                    22 => {
                        result.generate_node_module_bundle = (try reader.readByte()) == @as(u8, 1);
                    },
                    else => {
                        return error.InvalidMessage;
                    },
                }
            }
        }

        pub fn encode(result: *const @This(), writer: anytype) anyerror!void {
            var n: usize = 0;
            if (result.jsx) |jsx| {
                try writer.writeByte(1);
                try jsx.encode(writer);
            }

            if (result.tsconfig_override) |tsconfig_override| {
                try writer.writeByte(2);
                try writer.writeIntNative(u32, @intCast(u32, tsconfig_override.len));
                try writer.writeAll(std.mem.sliceAsBytes(tsconfig_override));
            }

            if (result.resolve) |resolve| {
                try writer.writeByte(3);
                try writer.writeIntNative(@TypeOf(@enumToInt(result.resolve orelse unreachable)), @enumToInt(result.resolve orelse unreachable));
            }

            if (result.public_url) |public_url| {
                try writer.writeByte(4);
                try writer.writeIntNative(u32, @intCast(u32, public_url.len));
                try writer.writeAll(std.mem.sliceAsBytes(public_url));
            }

            if (result.absolute_working_dir) |absolute_working_dir| {
                try writer.writeByte(5);
                try writer.writeIntNative(u32, @intCast(u32, absolute_working_dir.len));
                try writer.writeAll(std.mem.sliceAsBytes(absolute_working_dir));
            }

            if (result.define_keys) |define_keys| {
                try writer.writeByte(6);
                n = result.define_keys.len;
                _ = try writer.writeIntNative(u32, @intCast(u32, n));
                {
                    var j: usize = 0;
                    while (j < n) : (j += 1) {
                        _ = try writer.writeIntNative(u32, @intCast(u32, result.define_keys[j].len));
                        try writer.writeAll(std.mem.sliceAsBytes(define_keys[j]));
                    }
                }
            }

            if (result.define_values) |define_values| {
                try writer.writeByte(7);
                n = result.define_values.len;
                _ = try writer.writeIntNative(u32, @intCast(u32, n));
                {
                    var j: usize = 0;
                    while (j < n) : (j += 1) {
                        _ = try writer.writeIntNative(u32, @intCast(u32, result.define_values[j].len));
                        try writer.writeAll(std.mem.sliceAsBytes(define_values[j]));
                    }
                }
            }

            if (result.preserve_symlinks) |preserve_symlinks| {
                try writer.writeByte(8);
                try writer.writeByte(@boolToInt(preserve_symlinks));
            }

            if (result.entry_points) |entry_points| {
                try writer.writeByte(9);
                n = result.entry_points.len;
                _ = try writer.writeIntNative(u32, @intCast(u32, n));
                {
                    var j: usize = 0;
                    while (j < n) : (j += 1) {
                        _ = try writer.writeIntNative(u32, @intCast(u32, result.entry_points[j].len));
                        try writer.writeAll(std.mem.sliceAsBytes(entry_points[j]));
                    }
                }
            }

            if (result.write) |write| {
                try writer.writeByte(10);
                try writer.writeByte(@boolToInt(write));
            }

            if (result.inject) |inject| {
                try writer.writeByte(11);
                n = result.inject.len;
                _ = try writer.writeIntNative(u32, @intCast(u32, n));
                {
                    var j: usize = 0;
                    while (j < n) : (j += 1) {
                        _ = try writer.writeIntNative(u32, @intCast(u32, result.inject[j].len));
                        try writer.writeAll(std.mem.sliceAsBytes(inject[j]));
                    }
                }
            }

            if (result.output_dir) |output_dir| {
                try writer.writeByte(12);
                try writer.writeIntNative(u32, @intCast(u32, output_dir.len));
                try writer.writeAll(std.mem.sliceAsBytes(output_dir));
            }

            if (result.external) |external| {
                try writer.writeByte(13);
                n = result.external.len;
                _ = try writer.writeIntNative(u32, @intCast(u32, n));
                {
                    var j: usize = 0;
                    while (j < n) : (j += 1) {
                        _ = try writer.writeIntNative(u32, @intCast(u32, result.external[j].len));
                        try writer.writeAll(std.mem.sliceAsBytes(external[j]));
                    }
                }
            }

            if (result.loader_keys) |loader_keys| {
                try writer.writeByte(14);
                n = result.loader_keys.len;
                _ = try writer.writeIntNative(u32, @intCast(u32, n));
                {
                    var j: usize = 0;
                    while (j < n) : (j += 1) {
                        _ = try writer.writeIntNative(u32, @intCast(u32, result.loader_keys[j].len));
                        try writer.writeAll(std.mem.sliceAsBytes(loader_keys[j]));
                    }
                }
            }

            if (result.loader_values) |loader_values| {
                try writer.writeByte(15);
                n = result.loader_values.len;
                _ = try writer.writeIntNative(u32, @intCast(u32, n));
                {
                    var j: usize = 0;
                    while (j < n) : (j += 1) {
                        try writer.writeByte(@enumToInt(result.loader_values[j] orelse unreachable));
                    }
                }
            }

            if (result.main_fields) |main_fields| {
                try writer.writeByte(16);
                n = result.main_fields.len;
                _ = try writer.writeIntNative(u32, @intCast(u32, n));
                {
                    var j: usize = 0;
                    while (j < n) : (j += 1) {
                        _ = try writer.writeIntNative(u32, @intCast(u32, result.main_fields[j].len));
                        try writer.writeAll(std.mem.sliceAsBytes(main_fields[j]));
                    }
                }
            }

            if (result.platform) |platform| {
                try writer.writeByte(17);
                try writer.writeIntNative(@TypeOf(@enumToInt(result.platform orelse unreachable)), @enumToInt(result.platform orelse unreachable));
            }

            if (result.serve) |serve| {
                try writer.writeByte(18);
                try writer.writeByte(@boolToInt(serve));
            }

            if (result.extension_order) |extension_order| {
                try writer.writeByte(19);
                n = result.extension_order.len;
                _ = try writer.writeIntNative(u32, @intCast(u32, n));
                {
                    var j: usize = 0;
                    while (j < n) : (j += 1) {
                        _ = try writer.writeIntNative(u32, @intCast(u32, result.extension_order[j].len));
                        try writer.writeAll(std.mem.sliceAsBytes(extension_order[j]));
                    }
                }
            }

            if (result.public_dir) |public_dir| {
                try writer.writeByte(20);
                try writer.writeIntNative(u32, @intCast(u32, public_dir.len));
                try writer.writeAll(std.mem.sliceAsBytes(public_dir));
            }

            if (result.only_scan_dependencies) |only_scan_dependencies| {
                try writer.writeByte(21);
                try writer.writeIntNative(@TypeOf(@enumToInt(result.only_scan_dependencies orelse unreachable)), @enumToInt(result.only_scan_dependencies orelse unreachable));
            }

            if (result.generate_node_module_bundle) |generate_node_module_bundle| {
                try writer.writeByte(22);
                try writer.writeByte(@boolToInt(generate_node_module_bundle));
            }
            try writer.writeByte(0);
            return;
        }
    };

    pub const FileHandle = struct {
        /// path
        path: []const u8,

        /// size
        size: u32 = 0,

        /// fd
        fd: u32 = 0,

        pub fn decode(allocator: *std.mem.Allocator, reader: anytype) anyerror!FileHandle {
            var obj = std.mem.zeroes(FileHandle);
            try update(&obj, allocator, reader);
            return obj;
        }
        pub fn update(result: *FileHandle, allocator: *std.mem.Allocator, reader: anytype) anyerror!void {
            var length: usize = 0;
            length = try reader.readIntNative(u32);
            if (result.path.len != length) {
                result.path = try allocator.alloc(u8, length);
            }
            _ = try reader.readAll(result.path);
            _ = try reader.readAll(std.mem.asBytes(&result.size));
            _ = try reader.readAll(std.mem.asBytes(&result.fd));
            return;
        }

        pub fn encode(result: *const @This(), writer: anytype) anyerror!void {
            try writer.writeIntNative(u32, @intCast(u32, result.path.len));
            try writer.writeAll(std.mem.sliceAsBytes(result.path));

            try writer.writeIntNative(u32, result.size);

            try writer.writeIntNative(u32, result.fd);
            return;
        }
    };

    pub const Transform = struct {
        /// handle
        handle: ?FileHandle = null,

        /// path
        path: ?[]const u8 = null,

        /// contents
        contents: []const u8,

        /// loader
        loader: ?Loader = null,

        /// options
        options: ?TransformOptions = null,

        pub fn decode(allocator: *std.mem.Allocator, reader: anytype) anyerror!Transform {
            var obj = std.mem.zeroes(Transform);
            try update(&obj, allocator, reader);
            return obj;
        }
        pub fn update(result: *Transform, allocator: *std.mem.Allocator, reader: anytype) anyerror!void {
            var length: usize = 0;
            while (true) {
                const field_type: u8 = try reader.readByte();
                switch (field_type) {
                    0 => {
                        return;
                    },

                    1 => {
                        result.handle = try FileHandle.decode(allocator, reader);
                    },
                    2 => {
                        length = try reader.readIntNative(u32);
                        if ((result.path orelse &([_]u8{})).len != length) {
                            result.path = try allocator.alloc(u8, length);
                        }
                        _ = try reader.readAll(result.path.?);
                    },
                    3 => {
                        length = @intCast(usize, try reader.readIntNative(u32));
                        if (result.contents != length) {
                            result.contents = try allocator.alloc(u8, length);
                        }
                        _ = try reader.readAll(result.contents);
                    },
                    4 => {
                        result.loader = try reader.readEnum(Loader, .Little);
                    },
                    5 => {
                        result.options = try TransformOptions.decode(allocator, reader);
                    },
                    else => {
                        return error.InvalidMessage;
                    },
                }
            }
        }

        pub fn encode(result: *const @This(), writer: anytype) anyerror!void {
            if (result.handle) |handle| {
                try writer.writeByte(1);
                try handle.encode(writer);
            }

            if (result.path) |path| {
                try writer.writeByte(2);
                try writer.writeIntNative(u32, @intCast(u32, path.len));
                try writer.writeAll(std.mem.sliceAsBytes(path));
            }

            if (result.contents) |contents| {
                try writer.writeByte(3);
                try writer.writeIntNative(u32, @intCast(u32, contents.len));
                try writer.writeAll(contents);
            }

            if (result.loader) |loader| {
                try writer.writeByte(4);
                try writer.writeIntNative(@TypeOf(@enumToInt(result.loader orelse unreachable)), @enumToInt(result.loader orelse unreachable));
            }

            if (result.options) |options| {
                try writer.writeByte(5);
                try options.encode(writer);
            }
            try writer.writeByte(0);
            return;
        }
    };

    pub const TransformResponseStatus = enum(u32) {
        _none,
        /// success
        success,

        /// fail
        fail,

        _,

        pub fn jsonStringify(self: *const @This(), opts: anytype, o: anytype) !void {
            return try std.json.stringify(@tagName(self), opts, o);
        }
    };

    pub const OutputFile = struct {
        /// data
        data: []const u8,

        /// path
        path: []const u8,

        pub fn decode(allocator: *std.mem.Allocator, reader: anytype) anyerror!OutputFile {
            var obj = std.mem.zeroes(OutputFile);
            try update(&obj, allocator, reader);
            return obj;
        }
        pub fn update(result: *OutputFile, allocator: *std.mem.Allocator, reader: anytype) anyerror!void {
            var length: usize = 0;
            length = @intCast(usize, try reader.readIntNative(u32));
            if (result.data != length) {
                result.data = try allocator.alloc(u8, length);
            }
            _ = try reader.readAll(result.data);
            length = try reader.readIntNative(u32);
            if (result.path.len != length) {
                result.path = try allocator.alloc(u8, length);
            }
            _ = try reader.readAll(result.path);
            return;
        }

        pub fn encode(result: *const @This(), writer: anytype) anyerror!void {
            try writer.writeIntNative(u32, @intCast(u32, result.data.len));
            try writer.writeAll(result.data);

            try writer.writeIntNative(u32, @intCast(u32, result.path.len));
            try writer.writeAll(std.mem.sliceAsBytes(result.path));
            return;
        }
    };

    pub const TransformResponse = struct {
        /// status
        status: TransformResponseStatus,

        /// files
        files: []OutputFile,

        /// errors
        errors: []Message,

        pub fn decode(allocator: *std.mem.Allocator, reader: anytype) anyerror!TransformResponse {
            var obj = std.mem.zeroes(TransformResponse);
            try update(&obj, allocator, reader);
            return obj;
        }
        pub fn update(result: *TransformResponse, allocator: *std.mem.Allocator, reader: anytype) anyerror!void {
            var length: usize = 0;
            result.status = try reader.readEnum(TransformResponseStatus, .Little);
            length = try reader.readIntNative(u32);
            result.files = try allocator.alloc(OutputFile, length);
            {
                var j: usize = 0;
                while (j < length) : (j += 1) {
                    result.files[j] = try OutputFile.decode(allocator, reader);
                }
            }
            length = try reader.readIntNative(u32);
            result.errors = try allocator.alloc(Message, length);
            {
                var j: usize = 0;
                while (j < length) : (j += 1) {
                    result.errors[j] = try Message.decode(allocator, reader);
                }
            }
            return;
        }

        pub fn encode(result: *const @This(), writer: anytype) anyerror!void {
            var n: usize = 0;
            try writer.writeIntNative(@TypeOf(@enumToInt(result.status)), @enumToInt(result.status));

            n = result.files.len;
            _ = try writer.writeIntNative(u32, @intCast(u32, n));
            {
                var j: usize = 0;
                while (j < n) : (j += 1) {
                    try result.files[j].encode(writer);
                }
            }

            n = result.errors.len;
            _ = try writer.writeIntNative(u32, @intCast(u32, n));
            {
                var j: usize = 0;
                while (j < n) : (j += 1) {
                    try result.errors[j].encode(writer);
                }
            }
            return;
        }
    };

    pub const MessageKind = enum(u32) {
        _none,
        /// err
        err,

        /// warn
        warn,

        /// note
        note,

        /// debug
        debug,

        _,

        pub fn jsonStringify(self: *const @This(), opts: anytype, o: anytype) !void {
            return try std.json.stringify(@tagName(self), opts, o);
        }
    };

    pub const Location = struct {
        /// file
        file: []const u8,

        /// namespace
        namespace: []const u8,

        /// line
        line: i32 = 0,

        /// column
        column: i32 = 0,

        /// line_text
        line_text: []const u8,

        /// suggestion
        suggestion: []const u8,

        /// offset
        offset: u32 = 0,

        pub fn decode(allocator: *std.mem.Allocator, reader: anytype) anyerror!Location {
            var obj = std.mem.zeroes(Location);
            try update(&obj, allocator, reader);
            return obj;
        }
        pub fn update(result: *Location, allocator: *std.mem.Allocator, reader: anytype) anyerror!void {
            var length: usize = 0;
            length = try reader.readIntNative(u32);
            if (result.file.len != length) {
                result.file = try allocator.alloc(u8, length);
            }
            _ = try reader.readAll(result.file);
            length = try reader.readIntNative(u32);
            if (result.namespace.len != length) {
                result.namespace = try allocator.alloc(u8, length);
            }
            _ = try reader.readAll(result.namespace);
            _ = try reader.readAll(std.mem.asBytes(&result.line));
            _ = try reader.readAll(std.mem.asBytes(&result.column));
            length = try reader.readIntNative(u32);
            if (result.line_text.len != length) {
                result.line_text = try allocator.alloc(u8, length);
            }
            _ = try reader.readAll(result.line_text);
            length = try reader.readIntNative(u32);
            if (result.suggestion.len != length) {
                result.suggestion = try allocator.alloc(u8, length);
            }
            _ = try reader.readAll(result.suggestion);
            _ = try reader.readAll(std.mem.asBytes(&result.offset));
            return;
        }

        pub fn encode(result: *const @This(), writer: anytype) anyerror!void {
            try writer.writeIntNative(u32, @intCast(u32, result.file.len));
            try writer.writeAll(std.mem.sliceAsBytes(result.file));

            try writer.writeIntNative(u32, @intCast(u32, result.namespace.len));
            try writer.writeAll(std.mem.sliceAsBytes(result.namespace));

            try writer.writeIntNative(i32, result.line);

            try writer.writeIntNative(i32, result.column);

            try writer.writeIntNative(u32, @intCast(u32, result.line_text.len));
            try writer.writeAll(std.mem.sliceAsBytes(result.line_text));

            try writer.writeIntNative(u32, @intCast(u32, result.suggestion.len));
            try writer.writeAll(std.mem.sliceAsBytes(result.suggestion));

            try writer.writeIntNative(u32, result.offset);
            return;
        }
    };

    pub const MessageData = struct {
        /// text
        text: ?[]const u8 = null,

        /// location
        location: ?Location = null,

        pub fn decode(allocator: *std.mem.Allocator, reader: anytype) anyerror!MessageData {
            var obj = std.mem.zeroes(MessageData);
            try update(&obj, allocator, reader);
            return obj;
        }
        pub fn update(result: *MessageData, allocator: *std.mem.Allocator, reader: anytype) anyerror!void {
            var length: usize = 0;
            while (true) {
                const field_type: u8 = try reader.readByte();
                switch (field_type) {
                    0 => {
                        return;
                    },

                    1 => {
                        length = try reader.readIntNative(u32);
                        if ((result.text orelse &([_]u8{})).len != length) {
                            result.text = try allocator.alloc(u8, length);
                        }
                        _ = try reader.readAll(result.text.?);
                    },
                    2 => {
                        result.location = try Location.decode(allocator, reader);
                    },
                    else => {
                        return error.InvalidMessage;
                    },
                }
            }
        }

        pub fn encode(result: *const @This(), writer: anytype) anyerror!void {
            if (result.text) |text| {
                try writer.writeByte(1);
                try writer.writeIntNative(u32, @intCast(u32, text.len));
                try writer.writeAll(std.mem.sliceAsBytes(text));
            }

            if (result.location) |location| {
                try writer.writeByte(2);
                try location.encode(writer);
            }
            try writer.writeByte(0);
            return;
        }
    };

    pub const Message = struct {
        /// kind
        kind: MessageKind,

        /// data
        data: MessageData,

        /// notes
        notes: []MessageData,

        pub fn decode(allocator: *std.mem.Allocator, reader: anytype) anyerror!Message {
            var obj = std.mem.zeroes(Message);
            try update(&obj, allocator, reader);
            return obj;
        }
        pub fn update(result: *Message, allocator: *std.mem.Allocator, reader: anytype) anyerror!void {
            var length: usize = 0;
            result.kind = try reader.readEnum(MessageKind, .Little);
            result.data = try MessageData.decode(allocator, reader);
            length = try reader.readIntNative(u32);
            result.notes = try allocator.alloc(MessageData, length);
            {
                var j: usize = 0;
                while (j < length) : (j += 1) {
                    result.notes[j] = try MessageData.decode(allocator, reader);
                }
            }
            return;
        }

        pub fn encode(result: *const @This(), writer: anytype) anyerror!void {
            var n: usize = 0;
            try writer.writeIntNative(@TypeOf(@enumToInt(result.kind)), @enumToInt(result.kind));

            try result.data.encode(writer);

            n = result.notes.len;
            _ = try writer.writeIntNative(u32, @intCast(u32, n));
            {
                var j: usize = 0;
                while (j < n) : (j += 1) {
                    try result.notes[j].encode(writer);
                }
            }
            return;
        }
    };

    pub const Log = struct {
        /// warnings
        warnings: u32 = 0,

        /// errors
        errors: u32 = 0,

        /// msgs
        msgs: []Message,

        pub fn decode(allocator: *std.mem.Allocator, reader: anytype) anyerror!Log {
            var obj = std.mem.zeroes(Log);
            try update(&obj, allocator, reader);
            return obj;
        }
        pub fn update(result: *Log, allocator: *std.mem.Allocator, reader: anytype) anyerror!void {
            var length: usize = 0;
            _ = try reader.readAll(std.mem.asBytes(&result.warnings));
            _ = try reader.readAll(std.mem.asBytes(&result.errors));
            length = try reader.readIntNative(u32);
            result.msgs = try allocator.alloc(Message, length);
            {
                var j: usize = 0;
                while (j < length) : (j += 1) {
                    result.msgs[j] = try Message.decode(allocator, reader);
                }
            }
            return;
        }

        pub fn encode(result: *const @This(), writer: anytype) anyerror!void {
            var n: usize = 0;
            try writer.writeIntNative(u32, result.warnings);

            try writer.writeIntNative(u32, result.errors);

            n = result.msgs.len;
            _ = try writer.writeIntNative(u32, @intCast(u32, n));
            {
                var j: usize = 0;
                while (j < n) : (j += 1) {
                    try result.msgs[j].encode(writer);
                }
            }
            return;
        }
    };
};
