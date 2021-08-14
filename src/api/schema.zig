
const std = @import("std");

pub const Reader = struct {
    const Self = @This();
    pub const ReadError = error{EOF};

    buf: []u8,
    remain: []u8,
    allocator: *std.mem.Allocator,

    pub fn init(buf: []u8, allocator: *std.mem.Allocator) Reader {
        return Reader{
            .buf = buf,
            .remain = buf,
            .allocator = allocator,
        };
    }

    pub fn read(this: *Self, count: usize) ![]u8 {
        const read_count = std.math.min(count, this.remain.len);
        if (read_count < count) {
            return error.EOF;
        }

        var slice = this.remain[0..read_count];

        this.remain = this.remain[read_count..];

        return slice;
    }

    pub fn readAs(this: *Self, comptime T: type) !T {
        if (!std.meta.trait.hasUniqueRepresentation(T)) {
            @compileError(@typeName(T) ++ " must have unique representation.");
        }

        return std.mem.bytesAsValue(T, try this.read(@sizeOf(T)));
    }

    pub fn readByte(this: *Self) !u8 {
        return (try this.read(1))[0];
    }

    pub fn readEnum(this: *Self, comptime Enum: type) !Enum {
        const E = error{
            /// An integer was read, but it did not match any of the tags in the supplied enum.
            InvalidValue,
        };
        const type_info = @typeInfo(Enum).Enum;
        const tag = try this.readInt(type_info.tag_type);

        inline for (std.meta.fields(Enum)) |field| {
            if (tag == field.value) {
                return @field(Enum, field.name);
            }
        }

        return E.InvalidValue;
    }

    pub fn readArray(this: *Self, comptime T: type) ![]const T {
        const length = try this.readInt(u32);
        if (length == 0) {
            return &([_]T{});
        }

        switch (T) {
            u8 => {
                return try this.read(length);
            },
            u16, u32, i8, i16, i32 => {
                return std.mem.readIntSliceNative(T, this.read(length * @sizeOf(T)));
            },
            []const u8 => {
                var i: u32 = 0;
                var array = try this.allocator.alloc([]const u8, length);
                while (i < length) : (i += 1) {
                    array[i] = try this.readArray(u8);
                }
                return array;
            },
            else => {
                switch (@typeInfo(T)) {
                    .Struct => |Struct| {
                        switch (Struct.layout) {
                            .Packed => {
                                const sizeof = @sizeOf(T);
                                var slice = try this.read(sizeof * length);
                                return std.mem.bytesAsSlice(T, slice);
                            },
                            else => {},
                        }
                    },
                    .Enum => |type_info| {
                        const enum_values = try this.read(length * @sizeOf(type_info.tag_type));
                        return @ptrCast([*]T, enum_values.ptr)[0..length];
                    },
                    else => {},
                }

                var i: u32 = 0;
                var array = try this.allocator.alloc(T, length);
                while (i < length) : (i += 1) {
                    array[i] = try this.readValue(T);
                }

                return array;
            },
        }
    }

    pub fn readByteArray(this: *Self) ![]u8 {
        const length = try this.readInt(u32);
        if (length == 0) {
            return &([_]u8{});
        }

        return try this.read(@intCast(usize, length));
    }

    pub fn readInt(this: *Self, comptime T: type) !T {
        var slice = try this.read(@sizeOf(T));

        return std.mem.readIntSliceNative(T, slice);
    }

    pub fn readBool(this: *Self) !bool {
        return (try this.readByte()) > 0;
    }

    pub fn readValue(this: *Self, comptime T: type) !T {
        switch (T) {
            bool => {
                return try this.readBool();
            },
            u8 => {
                return try this.readByte();
            },
            []const u8 => {
                return try this.readArray(u8);
            },

            []const []const u8 => {
                return try this.readArray([]const u8);
            },
            []u8 => {
                return try this.readArray([]u8);
            },
            u16, u32, i8, i16, i32 => {
                return std.mem.readIntSliceNative(T, try this.read(@sizeOf(T)));
            },
            else => {
                switch (@typeInfo(T)) {
                    .Struct => |Struct| {
                        switch (Struct.layout) {
                            .Packed => {
                                const sizeof = @sizeOf(T);
                                var slice = try this.read(sizeof);
                                return @ptrCast(*T, slice[0..sizeof]).*;
                            },
                            else => {},
                        }
                    },
                    .Enum => |type_info| {
                        return try this.readEnum(T);
                    },
                    else => {},
                }

                return try T.decode(this);
            },
        }

        @compileError("Invalid type passed to readValue");
    }
};

pub fn Writer(comptime WritableStream: type) type {
    return struct {
        const Self = @This();
        writable: WritableStream,

        pub fn init(writable: WritableStream) Self {
            return Self{ .writable = writable };
        }

        pub fn write(this: *Self, bytes: anytype) !void {
            _ = try this.writable.write(bytes);
        }

        pub fn writeByte(this: *Self, byte: u8) !void {
            _ = try this.writable.write(&[1]u8{byte});
        }

        pub fn writeInt(this: *Self, int: anytype) !void {
            try this.write(std.mem.asBytes(&int));
        }

        pub fn writeFieldID(this: *Self, comptime id: comptime_int) !void {
            try this.writeByte(id);
        }

        pub fn writeEnum(this: *Self, val: anytype) !void {
            try this.writeInt(@enumToInt(val));
        }

        pub fn writeValue(this: *Self, slice: anytype) !void {
            switch (@TypeOf(slice)) {
                []u16,
                []u32,
                []i16,
                []i32,
                []i8,
                []const u16,
                []const u32,
                []const i16,
                []const i32,
                []const i8,
                => {
                    try this.writeArray(@TypeOf(slice), slice);
                },

                []u8, []const u8 => {
                    try this.writeArray(u8, slice);
                },

                u8 => {
                    try this.write(slice);
                },
                u16, u32, i16, i32, i8 => {
                    try this.write(std.mem.asBytes(slice));
                },

                else => {
                    try slice.encode(this);
                },
            }
        }

        pub fn writeArray(this: *Self, comptime T: type, slice: anytype) !void {
            try this.writeInt(@truncate(u32, slice.len));

            switch (T) {
                u8 => {
                    try this.write(slice);
                },
                u16, u32, i16, i32, i8 => {
                    try this.write(std.mem.asBytes(slice));
                },
                []u8,
                []u16,
                []u32,
                []i16,
                []i32,
                []i8,
                []const u8,
                []const u16,
                []const u32,
                []const i16,
                []const i32,
                []const i8,
                => {
                    for (slice) |num_slice| {
                        try this.writeArray(std.meta.Child(@TypeOf(num_slice)), num_slice);
                    }
                },
                else => {
                    for (slice) |val| {
                        try val.encode(this);
                    }
                },
            }
        }

        pub fn endMessage(this: *Self) !void {
            try this.writeByte(0);
        }
    };
}

pub const ByteWriter = Writer(*std.io.FixedBufferStream([]u8));
pub const FileWriter = Writer(std.fs.File);




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

  /// speedy
  speedy,

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


pub fn decode(reader: anytype) anyerror!Jsx {
  var this = std.mem.zeroes(Jsx);

  this.factory = try reader.readValue([]const u8); 
  this.runtime = try reader.readValue(JsxRuntime); 
  this.fragment = try reader.readValue([]const u8); 
  this.development = try reader.readValue(bool); 
  this.import_source = try reader.readValue([]const u8); 
  this.react_fast_refresh = try reader.readValue(bool); 
   return this;
}

pub fn encode(this: *const @This(), writer: anytype) anyerror!void {
   try writer.writeValue(this.factory);
   try writer.writeEnum(this.runtime);
   try writer.writeValue(this.fragment);
   try writer.writeInt(@intCast(u8, @boolToInt(this.development)));
   try writer.writeValue(this.import_source);
   try writer.writeInt(@intCast(u8, @boolToInt(this.react_fast_refresh)));
}

};

pub const StringPointer = packed struct {
/// offset
offset: u32 = 0,

/// length
length: u32 = 0,


pub fn decode(reader: anytype) anyerror!StringPointer {
  var this = std.mem.zeroes(StringPointer);

  this.offset = try reader.readValue(u32); 
  this.length = try reader.readValue(u32); 
   return this;
}

pub fn encode(this: *const @This(), writer: anytype) anyerror!void {
   try writer.writeInt(this.offset);
   try writer.writeInt(this.length);
}

};

pub const JavascriptBundledModule = struct {
/// path
path: StringPointer,

/// code
code: StringPointer,

/// package_id
package_id: u32 = 0,

/// id
id: u32 = 0,

/// path_extname_length
path_extname_length: u8 = 0,


pub fn decode(reader: anytype) anyerror!JavascriptBundledModule {
  var this = std.mem.zeroes(JavascriptBundledModule);

  this.path = try reader.readValue(StringPointer); 
  this.code = try reader.readValue(StringPointer); 
  this.package_id = try reader.readValue(u32); 
  this.id = try reader.readValue(u32); 
  this.path_extname_length = try reader.readValue(u8); 
   return this;
}

pub fn encode(this: *const @This(), writer: anytype) anyerror!void {
   try writer.writeValue(this.path);
   try writer.writeValue(this.code);
   try writer.writeInt(this.package_id);
   try writer.writeInt(this.id);
   try writer.writeInt(this.path_extname_length);
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


pub fn decode(reader: anytype) anyerror!JavascriptBundledPackage {
  var this = std.mem.zeroes(JavascriptBundledPackage);

  this.name = try reader.readValue(StringPointer); 
  this.version = try reader.readValue(StringPointer); 
  this.hash = try reader.readValue(u32); 
  this.modules_offset = try reader.readValue(u32); 
  this.modules_length = try reader.readValue(u32); 
   return this;
}

pub fn encode(this: *const @This(), writer: anytype) anyerror!void {
   try writer.writeValue(this.name);
   try writer.writeValue(this.version);
   try writer.writeInt(this.hash);
   try writer.writeInt(this.modules_offset);
   try writer.writeInt(this.modules_length);
}

};

pub const JavascriptBundle = struct {
/// modules
modules: []const JavascriptBundledModule,

/// packages
packages: []const JavascriptBundledPackage,

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


pub fn decode(reader: anytype) anyerror!JavascriptBundle {
  var this = std.mem.zeroes(JavascriptBundle);

  this.modules = try reader.readArray(JavascriptBundledModule); 
  this.packages = try reader.readArray(JavascriptBundledPackage); 
  this.etag = try reader.readArray(u8); 
  this.generated_at = try reader.readValue(u32); 
  this.app_package_json_dependencies_hash = try reader.readArray(u8); 
  this.import_from_name = try reader.readArray(u8); 
  this.manifest_string = try reader.readArray(u8); 
   return this;
}

pub fn encode(this: *const @This(), writer: anytype) anyerror!void {
   try writer.writeArray(JavascriptBundledModule, this.modules);
   try writer.writeArray(JavascriptBundledPackage, this.packages);
   try writer.writeArray(u8, this.etag);
   try writer.writeInt(this.generated_at);
   try writer.writeArray(u8, this.app_package_json_dependencies_hash);
   try writer.writeArray(u8, this.import_from_name);
   try writer.writeArray(u8, this.manifest_string);
}

};

pub const JavascriptBundleContainer = struct {
/// bundle_format_version
bundle_format_version: ?u32 = null,

/// bundle
bundle: ?JavascriptBundle = null,

/// framework
framework: ?LoadedFramework = null,

/// routes
routes: ?LoadedRouteConfig = null,

/// code_length
code_length: ?u32 = null,


pub fn decode(reader: anytype) anyerror!JavascriptBundleContainer {
  var this = std.mem.zeroes(JavascriptBundleContainer);

  while(true) {
    switch (try reader.readByte()) {
      0 => { return this; },

      1 => {
        this.bundle_format_version = try reader.readValue(u32); 
},
      2 => {
        this.bundle = try reader.readValue(JavascriptBundle); 
},
      3 => {
        this.framework = try reader.readValue(LoadedFramework); 
},
      4 => {
        this.routes = try reader.readValue(LoadedRouteConfig); 
},
      5 => {
        this.code_length = try reader.readValue(u32); 
},
      else => {
      return error.InvalidMessage;
      },
      }
      }
unreachable;
}

pub fn encode(this: *const @This(), writer: anytype) anyerror!void {
if (this.bundle_format_version) |bundle_format_version| {
  try writer.writeFieldID(1);
   try writer.writeInt(bundle_format_version);
}
if (this.bundle) |bundle| {
  try writer.writeFieldID(2);
   try writer.writeValue(bundle);
}
if (this.framework) |framework| {
  try writer.writeFieldID(3);
   try writer.writeValue(framework);
}
if (this.routes) |routes| {
  try writer.writeFieldID(4);
   try writer.writeValue(routes);
}
if (this.code_length) |code_length| {
  try writer.writeFieldID(5);
   try writer.writeInt(code_length);
}
try writer.endMessage();
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


pub fn decode(reader: anytype) anyerror!ModuleImportRecord {
  var this = std.mem.zeroes(ModuleImportRecord);

  this.kind = try reader.readValue(ModuleImportType); 
  this.path = try reader.readValue([]const u8); 
  this.dynamic = try reader.readValue(bool); 
   return this;
}

pub fn encode(this: *const @This(), writer: anytype) anyerror!void {
   try writer.writeEnum(this.kind);
   try writer.writeValue(this.path);
   try writer.writeInt(@intCast(u8, @boolToInt(this.dynamic)));
}

};

pub const Module = struct {
/// path
path: []const u8,

/// imports
imports: []const ModuleImportRecord,


pub fn decode(reader: anytype) anyerror!Module {
  var this = std.mem.zeroes(Module);

  this.path = try reader.readValue([]const u8); 
  this.imports = try reader.readArray(ModuleImportRecord); 
   return this;
}

pub fn encode(this: *const @This(), writer: anytype) anyerror!void {
   try writer.writeValue(this.path);
   try writer.writeArray(ModuleImportRecord, this.imports);
}

};

pub const StringMap = struct {
/// keys
keys: []const []const u8,

/// values
values: []const []const u8,


pub fn decode(reader: anytype) anyerror!StringMap {
  var this = std.mem.zeroes(StringMap);

  this.keys = try reader.readArray([]const u8); 
  this.values = try reader.readArray([]const u8); 
   return this;
}

pub fn encode(this: *const @This(), writer: anytype) anyerror!void {
   try writer.writeArray([]const u8, this.keys);
   try writer.writeArray([]const u8, this.values);
}

};

pub const LoaderMap = struct {
/// extensions
extensions: []const []const u8,

/// loaders
loaders: []const Loader,


pub fn decode(reader: anytype) anyerror!LoaderMap {
  var this = std.mem.zeroes(LoaderMap);

  this.extensions = try reader.readArray([]const u8); 
  this.loaders = try reader.readArray(Loader); 
   return this;
}

pub fn encode(this: *const @This(), writer: anytype) anyerror!void {
   try writer.writeArray([]const u8, this.extensions);
   try writer.writeArray(Loader, this.loaders);
}

};

pub const FrameworkConfig = struct {
/// package
package: ?[]const u8 = null,

/// client
client: ?[]const u8 = null,

/// server
server: ?[]const u8 = null,

/// development
development: ?bool = null,

/// client_defines
client_defines: ?StringMap = null,

/// server_defines
server_defines: ?StringMap = null,

/// client_defines_prefix
client_defines_prefix: ?[]const u8 = null,

/// server_defines_prefix
server_defines_prefix: ?[]const u8 = null,


pub fn decode(reader: anytype) anyerror!FrameworkConfig {
  var this = std.mem.zeroes(FrameworkConfig);

  while(true) {
    switch (try reader.readByte()) {
      0 => { return this; },

      1 => {
        this.package = try reader.readValue([]const u8); 
},
      2 => {
        this.client = try reader.readValue([]const u8); 
},
      3 => {
        this.server = try reader.readValue([]const u8); 
},
      4 => {
        this.development = try reader.readValue(bool); 
},
      5 => {
        this.client_defines = try reader.readValue(StringMap); 
},
      6 => {
        this.server_defines = try reader.readValue(StringMap); 
},
      7 => {
        this.client_defines_prefix = try reader.readValue([]const u8); 
},
      8 => {
        this.server_defines_prefix = try reader.readValue([]const u8); 
},
      else => {
      return error.InvalidMessage;
      },
      }
      }
unreachable;
}

pub fn encode(this: *const @This(), writer: anytype) anyerror!void {
if (this.package) |package| {
  try writer.writeFieldID(1);
   try writer.writeValue(package);
}
if (this.client) |client| {
  try writer.writeFieldID(2);
   try writer.writeValue(client);
}
if (this.server) |server| {
  try writer.writeFieldID(3);
   try writer.writeValue(server);
}
if (this.development) |development| {
  try writer.writeFieldID(4);
   try writer.writeInt(@intCast(u8, @boolToInt(development)));
}
if (this.client_defines) |client_defines| {
  try writer.writeFieldID(5);
   try writer.writeValue(client_defines);
}
if (this.server_defines) |server_defines| {
  try writer.writeFieldID(6);
   try writer.writeValue(server_defines);
}
if (this.client_defines_prefix) |client_defines_prefix| {
  try writer.writeFieldID(7);
   try writer.writeValue(client_defines_prefix);
}
if (this.server_defines_prefix) |server_defines_prefix| {
  try writer.writeFieldID(8);
   try writer.writeValue(server_defines_prefix);
}
try writer.endMessage();
}

};

pub const LoadedFramework = struct {
/// entry_point
entry_point: []const u8,

/// package
package: []const u8,

/// development
development: bool = false,

/// client
client: bool = false,

/// define_defaults
define_defaults: StringMap,

/// define_prefix
define_prefix: []const u8,

/// has_define_prefix
has_define_prefix: bool = false,


pub fn decode(reader: anytype) anyerror!LoadedFramework {
  var this = std.mem.zeroes(LoadedFramework);

  this.entry_point = try reader.readValue([]const u8); 
  this.package = try reader.readValue([]const u8); 
  this.development = try reader.readValue(bool); 
  this.client = try reader.readValue(bool); 
  this.define_defaults = try reader.readValue(StringMap); 
  this.define_prefix = try reader.readValue([]const u8); 
  this.has_define_prefix = try reader.readValue(bool); 
   return this;
}

pub fn encode(this: *const @This(), writer: anytype) anyerror!void {
   try writer.writeValue(this.entry_point);
   try writer.writeValue(this.package);
   try writer.writeInt(@intCast(u8, @boolToInt(this.development)));
   try writer.writeInt(@intCast(u8, @boolToInt(this.client)));
   try writer.writeValue(this.define_defaults);
   try writer.writeValue(this.define_prefix);
   try writer.writeInt(@intCast(u8, @boolToInt(this.has_define_prefix)));
}

};

pub const LoadedRouteConfig = struct {
/// dir
dir: []const u8,

/// extensions
extensions: []const []const u8,

/// static_dir
static_dir: []const u8,

/// asset_prefix
asset_prefix: []const u8,


pub fn decode(reader: anytype) anyerror!LoadedRouteConfig {
  var this = std.mem.zeroes(LoadedRouteConfig);

  this.dir = try reader.readValue([]const u8); 
  this.extensions = try reader.readArray([]const u8); 
  this.static_dir = try reader.readValue([]const u8); 
  this.asset_prefix = try reader.readValue([]const u8); 
   return this;
}

pub fn encode(this: *const @This(), writer: anytype) anyerror!void {
   try writer.writeValue(this.dir);
   try writer.writeArray([]const u8, this.extensions);
   try writer.writeValue(this.static_dir);
   try writer.writeValue(this.asset_prefix);
}

};

pub const RouteConfig = struct {
/// dir
dir: ?[]const u8 = null,

/// extensions
extensions: []const []const u8,

/// static_dir
static_dir: ?[]const u8 = null,

/// asset_prefix
asset_prefix: ?[]const u8 = null,


pub fn decode(reader: anytype) anyerror!RouteConfig {
  var this = std.mem.zeroes(RouteConfig);

  while(true) {
    switch (try reader.readByte()) {
      0 => { return this; },

      1 => {
        this.dir = try reader.readValue([]const u8); 
},
      2 => {
        this.extensions = try reader.readArray([]const u8); 
},
      3 => {
        this.static_dir = try reader.readValue([]const u8); 
},
      4 => {
        this.asset_prefix = try reader.readValue([]const u8); 
},
      else => {
      return error.InvalidMessage;
      },
      }
      }
unreachable;
}

pub fn encode(this: *const @This(), writer: anytype) anyerror!void {
if (this.dir) |dir| {
  try writer.writeFieldID(1);
   try writer.writeValue(dir);
}
if (this.extensions) |extensions| {
  try writer.writeFieldID(2);
   try writer.writeArray([]const u8, extensions);
}
if (this.static_dir) |static_dir| {
  try writer.writeFieldID(3);
   try writer.writeValue(static_dir);
}
if (this.asset_prefix) |asset_prefix| {
  try writer.writeFieldID(4);
   try writer.writeValue(asset_prefix);
}
try writer.endMessage();
}

};

pub const TransformOptions = struct {
/// jsx
jsx: ?Jsx = null,

/// tsconfig_override
tsconfig_override: ?[]const u8 = null,

/// resolve
resolve: ?ResolveMode = null,

/// origin
origin: ?[]const u8 = null,

/// absolute_working_dir
absolute_working_dir: ?[]const u8 = null,

/// define
define: ?StringMap = null,

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

/// loaders
loaders: ?LoaderMap = null,

/// main_fields
main_fields: []const []const u8,

/// platform
platform: ?Platform = null,

/// serve
serve: ?bool = null,

/// extension_order
extension_order: []const []const u8,

/// only_scan_dependencies
only_scan_dependencies: ?ScanDependencyMode = null,

/// generate_node_module_bundle
generate_node_module_bundle: ?bool = null,

/// node_modules_bundle_path
node_modules_bundle_path: ?[]const u8 = null,

/// node_modules_bundle_path_server
node_modules_bundle_path_server: ?[]const u8 = null,

/// framework
framework: ?FrameworkConfig = null,

/// router
router: ?RouteConfig = null,


pub fn decode(reader: anytype) anyerror!TransformOptions {
  var this = std.mem.zeroes(TransformOptions);

  while(true) {
    switch (try reader.readByte()) {
      0 => { return this; },

      1 => {
        this.jsx = try reader.readValue(Jsx); 
},
      2 => {
        this.tsconfig_override = try reader.readValue([]const u8); 
},
      3 => {
        this.resolve = try reader.readValue(ResolveMode); 
},
      4 => {
        this.origin = try reader.readValue([]const u8); 
},
      5 => {
        this.absolute_working_dir = try reader.readValue([]const u8); 
},
      6 => {
        this.define = try reader.readValue(StringMap); 
},
      7 => {
        this.preserve_symlinks = try reader.readValue(bool); 
},
      8 => {
        this.entry_points = try reader.readArray([]const u8); 
},
      9 => {
        this.write = try reader.readValue(bool); 
},
      10 => {
        this.inject = try reader.readArray([]const u8); 
},
      11 => {
        this.output_dir = try reader.readValue([]const u8); 
},
      12 => {
        this.external = try reader.readArray([]const u8); 
},
      13 => {
        this.loaders = try reader.readValue(LoaderMap); 
},
      14 => {
        this.main_fields = try reader.readArray([]const u8); 
},
      15 => {
        this.platform = try reader.readValue(Platform); 
},
      16 => {
        this.serve = try reader.readValue(bool); 
},
      17 => {
        this.extension_order = try reader.readArray([]const u8); 
},
      18 => {
        this.only_scan_dependencies = try reader.readValue(ScanDependencyMode); 
},
      19 => {
        this.generate_node_module_bundle = try reader.readValue(bool); 
},
      20 => {
        this.node_modules_bundle_path = try reader.readValue([]const u8); 
},
      21 => {
        this.node_modules_bundle_path_server = try reader.readValue([]const u8); 
},
      22 => {
        this.framework = try reader.readValue(FrameworkConfig); 
},
      23 => {
        this.router = try reader.readValue(RouteConfig); 
},
      else => {
      return error.InvalidMessage;
      },
      }
      }
unreachable;
}

pub fn encode(this: *const @This(), writer: anytype) anyerror!void {
if (this.jsx) |jsx| {
  try writer.writeFieldID(1);
   try writer.writeValue(jsx);
}
if (this.tsconfig_override) |tsconfig_override| {
  try writer.writeFieldID(2);
   try writer.writeValue(tsconfig_override);
}
if (this.resolve) |resolve| {
  try writer.writeFieldID(3);
   try writer.writeEnum(resolve);
}
if (this.origin) |origin| {
  try writer.writeFieldID(4);
   try writer.writeValue(origin);
}
if (this.absolute_working_dir) |absolute_working_dir| {
  try writer.writeFieldID(5);
   try writer.writeValue(absolute_working_dir);
}
if (this.define) |define| {
  try writer.writeFieldID(6);
   try writer.writeValue(define);
}
if (this.preserve_symlinks) |preserve_symlinks| {
  try writer.writeFieldID(7);
   try writer.writeInt(@intCast(u8, @boolToInt(preserve_symlinks)));
}
if (this.entry_points) |entry_points| {
  try writer.writeFieldID(8);
   try writer.writeArray([]const u8, entry_points);
}
if (this.write) |write| {
  try writer.writeFieldID(9);
   try writer.writeInt(@intCast(u8, @boolToInt(write)));
}
if (this.inject) |inject| {
  try writer.writeFieldID(10);
   try writer.writeArray([]const u8, inject);
}
if (this.output_dir) |output_dir| {
  try writer.writeFieldID(11);
   try writer.writeValue(output_dir);
}
if (this.external) |external| {
  try writer.writeFieldID(12);
   try writer.writeArray([]const u8, external);
}
if (this.loaders) |loaders| {
  try writer.writeFieldID(13);
   try writer.writeValue(loaders);
}
if (this.main_fields) |main_fields| {
  try writer.writeFieldID(14);
   try writer.writeArray([]const u8, main_fields);
}
if (this.platform) |platform| {
  try writer.writeFieldID(15);
   try writer.writeEnum(platform);
}
if (this.serve) |serve| {
  try writer.writeFieldID(16);
   try writer.writeInt(@intCast(u8, @boolToInt(serve)));
}
if (this.extension_order) |extension_order| {
  try writer.writeFieldID(17);
   try writer.writeArray([]const u8, extension_order);
}
if (this.only_scan_dependencies) |only_scan_dependencies| {
  try writer.writeFieldID(18);
   try writer.writeEnum(only_scan_dependencies);
}
if (this.generate_node_module_bundle) |generate_node_module_bundle| {
  try writer.writeFieldID(19);
   try writer.writeInt(@intCast(u8, @boolToInt(generate_node_module_bundle)));
}
if (this.node_modules_bundle_path) |node_modules_bundle_path| {
  try writer.writeFieldID(20);
   try writer.writeValue(node_modules_bundle_path);
}
if (this.node_modules_bundle_path_server) |node_modules_bundle_path_server| {
  try writer.writeFieldID(21);
   try writer.writeValue(node_modules_bundle_path_server);
}
if (this.framework) |framework| {
  try writer.writeFieldID(22);
   try writer.writeValue(framework);
}
if (this.router) |router| {
  try writer.writeFieldID(23);
   try writer.writeValue(router);
}
try writer.endMessage();
}

};

pub const FileHandle = struct {
/// path
path: []const u8,

/// size
size: u32 = 0,

/// fd
fd: u32 = 0,


pub fn decode(reader: anytype) anyerror!FileHandle {
  var this = std.mem.zeroes(FileHandle);

  this.path = try reader.readValue([]const u8); 
  this.size = try reader.readValue(u32); 
  this.fd = try reader.readValue(u32); 
   return this;
}

pub fn encode(this: *const @This(), writer: anytype) anyerror!void {
   try writer.writeValue(this.path);
   try writer.writeInt(this.size);
   try writer.writeInt(this.fd);
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


pub fn decode(reader: anytype) anyerror!Transform {
  var this = std.mem.zeroes(Transform);

  while(true) {
    switch (try reader.readByte()) {
      0 => { return this; },

      1 => {
        this.handle = try reader.readValue(FileHandle); 
},
      2 => {
        this.path = try reader.readValue([]const u8); 
},
      3 => {
        this.contents = try reader.readArray(u8); 
},
      4 => {
        this.loader = try reader.readValue(Loader); 
},
      5 => {
        this.options = try reader.readValue(TransformOptions); 
},
      else => {
      return error.InvalidMessage;
      },
      }
      }
unreachable;
}

pub fn encode(this: *const @This(), writer: anytype) anyerror!void {
if (this.handle) |handle| {
  try writer.writeFieldID(1);
   try writer.writeValue(handle);
}
if (this.path) |path| {
  try writer.writeFieldID(2);
   try writer.writeValue(path);
}
if (this.contents) |contents| {
  try writer.writeFieldID(3);
   try writer.writeArray(u8, contents);
}
if (this.loader) |loader| {
  try writer.writeFieldID(4);
   try writer.writeEnum(loader);
}
if (this.options) |options| {
  try writer.writeFieldID(5);
   try writer.writeValue(options);
}
try writer.endMessage();
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


pub fn decode(reader: anytype) anyerror!OutputFile {
  var this = std.mem.zeroes(OutputFile);

  this.data = try reader.readArray(u8); 
  this.path = try reader.readValue([]const u8); 
   return this;
}

pub fn encode(this: *const @This(), writer: anytype) anyerror!void {
   try writer.writeArray(u8, this.data);
   try writer.writeValue(this.path);
}

};

pub const TransformResponse = struct {
/// status
status: TransformResponseStatus,

/// files
files: []const OutputFile,

/// errors
errors: []const Message,


pub fn decode(reader: anytype) anyerror!TransformResponse {
  var this = std.mem.zeroes(TransformResponse);

  this.status = try reader.readValue(TransformResponseStatus); 
  this.files = try reader.readArray(OutputFile); 
  this.errors = try reader.readArray(Message); 
   return this;
}

pub fn encode(this: *const @This(), writer: anytype) anyerror!void {
   try writer.writeEnum(this.status);
   try writer.writeArray(OutputFile, this.files);
   try writer.writeArray(Message, this.errors);
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


pub fn decode(reader: anytype) anyerror!Location {
  var this = std.mem.zeroes(Location);

  this.file = try reader.readValue([]const u8); 
  this.namespace = try reader.readValue([]const u8); 
  this.line = try reader.readValue(i32); 
  this.column = try reader.readValue(i32); 
  this.line_text = try reader.readValue([]const u8); 
  this.suggestion = try reader.readValue([]const u8); 
  this.offset = try reader.readValue(u32); 
   return this;
}

pub fn encode(this: *const @This(), writer: anytype) anyerror!void {
   try writer.writeValue(this.file);
   try writer.writeValue(this.namespace);
   try writer.writeInt(this.line);
   try writer.writeInt(this.column);
   try writer.writeValue(this.line_text);
   try writer.writeValue(this.suggestion);
   try writer.writeInt(this.offset);
}

};

pub const MessageData = struct {
/// text
text: ?[]const u8 = null,

/// location
location: ?Location = null,


pub fn decode(reader: anytype) anyerror!MessageData {
  var this = std.mem.zeroes(MessageData);

  while(true) {
    switch (try reader.readByte()) {
      0 => { return this; },

      1 => {
        this.text = try reader.readValue([]const u8); 
},
      2 => {
        this.location = try reader.readValue(Location); 
},
      else => {
      return error.InvalidMessage;
      },
      }
      }
unreachable;
}

pub fn encode(this: *const @This(), writer: anytype) anyerror!void {
if (this.text) |text| {
  try writer.writeFieldID(1);
   try writer.writeValue(text);
}
if (this.location) |location| {
  try writer.writeFieldID(2);
   try writer.writeValue(location);
}
try writer.endMessage();
}

};

pub const Message = struct {
/// kind
kind: MessageKind,

/// data
data: MessageData,

/// notes
notes: []const MessageData,


pub fn decode(reader: anytype) anyerror!Message {
  var this = std.mem.zeroes(Message);

  this.kind = try reader.readValue(MessageKind); 
  this.data = try reader.readValue(MessageData); 
  this.notes = try reader.readArray(MessageData); 
   return this;
}

pub fn encode(this: *const @This(), writer: anytype) anyerror!void {
   try writer.writeEnum(this.kind);
   try writer.writeValue(this.data);
   try writer.writeArray(MessageData, this.notes);
}

};

pub const Log = struct {
/// warnings
warnings: u32 = 0,

/// errors
errors: u32 = 0,

/// msgs
msgs: []const Message,


pub fn decode(reader: anytype) anyerror!Log {
  var this = std.mem.zeroes(Log);

  this.warnings = try reader.readValue(u32); 
  this.errors = try reader.readValue(u32); 
  this.msgs = try reader.readArray(Message); 
   return this;
}

pub fn encode(this: *const @This(), writer: anytype) anyerror!void {
   try writer.writeInt(this.warnings);
   try writer.writeInt(this.errors);
   try writer.writeArray(Message, this.msgs);
}

};

pub const Reloader = enum(u8) {

_none,
  /// disable
  disable,

  /// live
  live,

  /// fast_refresh
  fast_refresh,

_,

                pub fn jsonStringify(self: *const @This(), opts: anytype, o: anytype) !void {
                    return try std.json.stringify(@tagName(self), opts, o);
                }

                
};

pub const WebsocketMessageKind = enum(u8) {

_none,
  /// welcome
  welcome,

  /// file_change_notification
  file_change_notification,

  /// build_success
  build_success,

  /// build_fail
  build_fail,

  /// manifest_success
  manifest_success,

  /// manifest_fail
  manifest_fail,

_,

                pub fn jsonStringify(self: *const @This(), opts: anytype, o: anytype) !void {
                    return try std.json.stringify(@tagName(self), opts, o);
                }

                
};

pub const WebsocketCommandKind = enum(u8) {

_none,
  /// build
  build,

  /// manifest
  manifest,

_,

                pub fn jsonStringify(self: *const @This(), opts: anytype, o: anytype) !void {
                    return try std.json.stringify(@tagName(self), opts, o);
                }

                
};

pub const WebsocketMessage = struct {
/// timestamp
timestamp: u32 = 0,

/// kind
kind: WebsocketMessageKind,


pub fn decode(reader: anytype) anyerror!WebsocketMessage {
  var this = std.mem.zeroes(WebsocketMessage);

  this.timestamp = try reader.readValue(u32); 
  this.kind = try reader.readValue(WebsocketMessageKind); 
   return this;
}

pub fn encode(this: *const @This(), writer: anytype) anyerror!void {
   try writer.writeInt(this.timestamp);
   try writer.writeEnum(this.kind);
}

};

pub const WebsocketMessageWelcome = struct {
/// epoch
epoch: u32 = 0,

/// javascriptReloader
javascript_reloader: Reloader,


pub fn decode(reader: anytype) anyerror!WebsocketMessageWelcome {
  var this = std.mem.zeroes(WebsocketMessageWelcome);

  this.epoch = try reader.readValue(u32); 
  this.javascript_reloader = try reader.readValue(Reloader); 
   return this;
}

pub fn encode(this: *const @This(), writer: anytype) anyerror!void {
   try writer.writeInt(this.epoch);
   try writer.writeEnum(this.javascript_reloader);
}

};

pub const WebsocketMessageFileChangeNotification = struct {
/// id
id: u32 = 0,

/// loader
loader: Loader,


pub fn decode(reader: anytype) anyerror!WebsocketMessageFileChangeNotification {
  var this = std.mem.zeroes(WebsocketMessageFileChangeNotification);

  this.id = try reader.readValue(u32); 
  this.loader = try reader.readValue(Loader); 
   return this;
}

pub fn encode(this: *const @This(), writer: anytype) anyerror!void {
   try writer.writeInt(this.id);
   try writer.writeEnum(this.loader);
}

};

pub const WebsocketCommand = struct {
/// kind
kind: WebsocketCommandKind,

/// timestamp
timestamp: u32 = 0,


pub fn decode(reader: anytype) anyerror!WebsocketCommand {
  var this = std.mem.zeroes(WebsocketCommand);

  this.kind = try reader.readValue(WebsocketCommandKind); 
  this.timestamp = try reader.readValue(u32); 
   return this;
}

pub fn encode(this: *const @This(), writer: anytype) anyerror!void {
   try writer.writeEnum(this.kind);
   try writer.writeInt(this.timestamp);
}

};

pub const WebsocketCommandBuild = packed struct {
/// id
id: u32 = 0,


pub fn decode(reader: anytype) anyerror!WebsocketCommandBuild {
  var this = std.mem.zeroes(WebsocketCommandBuild);

  this.id = try reader.readValue(u32); 
   return this;
}

pub fn encode(this: *const @This(), writer: anytype) anyerror!void {
   try writer.writeInt(this.id);
}

};

pub const WebsocketCommandManifest = packed struct {
/// id
id: u32 = 0,


pub fn decode(reader: anytype) anyerror!WebsocketCommandManifest {
  var this = std.mem.zeroes(WebsocketCommandManifest);

  this.id = try reader.readValue(u32); 
   return this;
}

pub fn encode(this: *const @This(), writer: anytype) anyerror!void {
   try writer.writeInt(this.id);
}

};

pub const WebsocketMessageBuildSuccess = struct {
/// id
id: u32 = 0,

/// from_timestamp
from_timestamp: u32 = 0,

/// loader
loader: Loader,

/// module_path
module_path: []const u8,

/// blob_length
blob_length: u32 = 0,


pub fn decode(reader: anytype) anyerror!WebsocketMessageBuildSuccess {
  var this = std.mem.zeroes(WebsocketMessageBuildSuccess);

  this.id = try reader.readValue(u32); 
  this.from_timestamp = try reader.readValue(u32); 
  this.loader = try reader.readValue(Loader); 
  this.module_path = try reader.readValue([]const u8); 
  this.blob_length = try reader.readValue(u32); 
   return this;
}

pub fn encode(this: *const @This(), writer: anytype) anyerror!void {
   try writer.writeInt(this.id);
   try writer.writeInt(this.from_timestamp);
   try writer.writeEnum(this.loader);
   try writer.writeValue(this.module_path);
   try writer.writeInt(this.blob_length);
}

};

pub const WebsocketMessageBuildFailure = struct {
/// id
id: u32 = 0,

/// from_timestamp
from_timestamp: u32 = 0,

/// loader
loader: Loader,

/// module_path
module_path: []const u8,

/// log
log: Log,


pub fn decode(reader: anytype) anyerror!WebsocketMessageBuildFailure {
  var this = std.mem.zeroes(WebsocketMessageBuildFailure);

  this.id = try reader.readValue(u32); 
  this.from_timestamp = try reader.readValue(u32); 
  this.loader = try reader.readValue(Loader); 
  this.module_path = try reader.readValue([]const u8); 
  this.log = try reader.readValue(Log); 
   return this;
}

pub fn encode(this: *const @This(), writer: anytype) anyerror!void {
   try writer.writeInt(this.id);
   try writer.writeInt(this.from_timestamp);
   try writer.writeEnum(this.loader);
   try writer.writeValue(this.module_path);
   try writer.writeValue(this.log);
}

};

pub const DependencyManifest = struct {
/// ids
ids: []const u32,


pub fn decode(reader: anytype) anyerror!DependencyManifest {
  var this = std.mem.zeroes(DependencyManifest);

  this.ids = try reader.readArray(u32); 
   return this;
}

pub fn encode(this: *const @This(), writer: anytype) anyerror!void {
   try writer.writeArray(u32, this.ids);
}

};

pub const FileList = struct {
/// ptrs
ptrs: []const StringPointer,

/// files
files: []const u8,


pub fn decode(reader: anytype) anyerror!FileList {
  var this = std.mem.zeroes(FileList);

  this.ptrs = try reader.readArray(StringPointer); 
  this.files = try reader.readValue([]const u8); 
   return this;
}

pub fn encode(this: *const @This(), writer: anytype) anyerror!void {
   try writer.writeArray(StringPointer, this.ptrs);
   try writer.writeValue(this.files);
}

};

pub const WebsocketMessageResolveIDs = struct {
/// id
id: []const u32,

/// list
list: FileList,


pub fn decode(reader: anytype) anyerror!WebsocketMessageResolveIDs {
  var this = std.mem.zeroes(WebsocketMessageResolveIDs);

  this.id = try reader.readArray(u32); 
  this.list = try reader.readValue(FileList); 
   return this;
}

pub fn encode(this: *const @This(), writer: anytype) anyerror!void {
   try writer.writeArray(u32, this.id);
   try writer.writeValue(this.list);
}

};

pub const WebsocketCommandResolveIDs = struct {
/// ptrs
ptrs: []const StringPointer,

/// files
files: []const u8,


pub fn decode(reader: anytype) anyerror!WebsocketCommandResolveIDs {
  var this = std.mem.zeroes(WebsocketCommandResolveIDs);

  this.ptrs = try reader.readArray(StringPointer); 
  this.files = try reader.readValue([]const u8); 
   return this;
}

pub fn encode(this: *const @This(), writer: anytype) anyerror!void {
   try writer.writeArray(StringPointer, this.ptrs);
   try writer.writeValue(this.files);
}

};

pub const WebsocketMessageManifestSuccess = struct {
/// id
id: u32 = 0,

/// module_path
module_path: []const u8,

/// loader
loader: Loader,

/// manifest
manifest: DependencyManifest,


pub fn decode(reader: anytype) anyerror!WebsocketMessageManifestSuccess {
  var this = std.mem.zeroes(WebsocketMessageManifestSuccess);

  this.id = try reader.readValue(u32); 
  this.module_path = try reader.readValue([]const u8); 
  this.loader = try reader.readValue(Loader); 
  this.manifest = try reader.readValue(DependencyManifest); 
   return this;
}

pub fn encode(this: *const @This(), writer: anytype) anyerror!void {
   try writer.writeInt(this.id);
   try writer.writeValue(this.module_path);
   try writer.writeEnum(this.loader);
   try writer.writeValue(this.manifest);
}

};

pub const WebsocketMessageManifestFailure = struct {
/// id
id: u32 = 0,

/// from_timestamp
from_timestamp: u32 = 0,

/// loader
loader: Loader,

/// log
log: Log,


pub fn decode(reader: anytype) anyerror!WebsocketMessageManifestFailure {
  var this = std.mem.zeroes(WebsocketMessageManifestFailure);

  this.id = try reader.readValue(u32); 
  this.from_timestamp = try reader.readValue(u32); 
  this.loader = try reader.readValue(Loader); 
  this.log = try reader.readValue(Log); 
   return this;
}

pub fn encode(this: *const @This(), writer: anytype) anyerror!void {
   try writer.writeInt(this.id);
   try writer.writeInt(this.from_timestamp);
   try writer.writeEnum(this.loader);
   try writer.writeValue(this.log);
}

};


};


const ExamplePackedStruct = packed struct {
    len: u32 = 0,
    offset: u32 = 0,

    pub fn encode(this: *const ExamplePackedStruct, writer: anytype) !void {
        try writer.write(std.mem.asBytes(this));
    }

    pub fn decode(reader: anytype) !ExamplePackedStruct {
        return try reader.readAs(ExamplePackedStruct);
    }
};

const ExampleStruct = struct {
    name: []const u8 = "",
    age: u32 = 0,

    pub fn encode(this: *const ExampleStruct, writer: anytype) !void {
        try writer.writeArray(u8, this.name);
        try writer.writeInt(this.age);
    }

    pub fn decode(reader: anytype) !ExampleStruct {
        var this = std.mem.zeroes(ExampleStruct);
        this.name = try reader.readArray(u8);
        this.age = try reader.readInt(u32);

        return this;
    }
};

const EnumValue = enum(u8) { hey, hi, heyopoo };

const ExampleMessage = struct {
    examples: ?[]ExampleStruct = &([_]ExampleStruct{}),
    pack: ?[]ExamplePackedStruct = &([_]ExamplePackedStruct{}),
    hey: ?u8 = 0,
    hey16: ?u16 = 0,
    hey32: ?u16 = 0,
    heyi32: ?i32 = 0,
    heyi16: ?i16 = 0,
    heyi8: ?i8 = 0,
    boolean: ?bool = null,
    heyooo: ?EnumValue = null,

    pub fn encode(this: *const ExampleMessage, writer: anytype) !void {
        if (this.examples) |examples| {
            try writer.writeFieldID(1);
            try writer.writeArray(ExampleStruct, examples);
        }

        if (this.pack) |pack| {
            try writer.writeFieldID(2);
            try writer.writeArray(ExamplePackedStruct, pack);
        }

        if (this.hey) |hey| {
            try writer.writeFieldID(3);
            try writer.writeInt(hey);
        }
        if (this.hey16) |hey16| {
            try writer.writeFieldID(4);
            try writer.writeInt(hey16);
        }
        if (this.hey32) |hey32| {
            try writer.writeFieldID(5);
            try writer.writeInt(hey32);
        }
        if (this.heyi32) |heyi32| {
            try writer.writeFieldID(6);
            try writer.writeInt(heyi32);
        }
        if (this.heyi16) |heyi16| {
            try writer.writeFieldID(7);
            try writer.writeInt(heyi16);
        }
        if (this.heyi8) |heyi8| {
            try writer.writeFieldID(8);
            try writer.writeInt(heyi8);
        }
        if (this.boolean) |boolean| {
            try writer.writeFieldID(9);
            try writer.writeInt(boolean);
        }

        if (this.heyooo) |heyoo| {
            try writer.writeFieldID(10);
            try writer.writeEnum(heyoo);
        }

        try writer.endMessage();
    }

    pub fn decode(reader: anytype) !ExampleMessage {
        var this = std.mem.zeroes(ExampleMessage);
        while (true) {
            switch (try reader.readByte()) {
                0 => {
                    return this;
                },

                1 => {
                    this.examples = try reader.readArray(std.meta.Child(@TypeOf(this.examples.?)));
                },
                2 => {
                    this.pack = try reader.readArray(std.meta.Child(@TypeOf(this.pack.?)));
                },
                3 => {
                    this.hey = try reader.readValue(@TypeOf(this.hey.?));
                },
                4 => {
                    this.hey16 = try reader.readValue(@TypeOf(this.hey16.?));
                },
                5 => {
                    this.hey32 = try reader.readValue(@TypeOf(this.hey32.?));
                },
                6 => {
                    this.heyi32 = try reader.readValue(@TypeOf(this.heyi32.?));
                },
                7 => {
                    this.heyi16 = try reader.readValue(@TypeOf(this.heyi16.?));
                },
                8 => {
                    this.heyi8 = try reader.readValue(@TypeOf(this.heyi8.?));
                },
                9 => {
                    this.boolean = try reader.readValue(@TypeOf(this.boolean.?));
                },
                10 => {
                    this.heyooo = try reader.readValue(@TypeOf(this.heyooo.?));
                },
                else => {
                    return error.InvalidValue;
                },
            }
        }

        return this;
    }
};

test "ExampleMessage" {
    var base = std.mem.zeroes(ExampleMessage);
    base.hey = 1;
    var buf: [4096]u8 = undefined;
    var writable = std.io.fixedBufferStream(&buf);
    var writer = ByteWriter.init(writable);
    var examples = [_]ExamplePackedStruct{
        .{ .len = 2, .offset = 5 },
        .{ .len = 0, .offset = 10 },
    };

    var more_examples = [_]ExampleStruct{
        .{ .name = "bacon", .age = 10 },
        .{ .name = "slime", .age = 300 },
    };
    base.examples = &more_examples;
    base.pack = &examples;
    base.heyooo = EnumValue.hey;
    try base.encode(&writer);
    var reader = Reader.init(&buf, std.heap.c_allocator);
    var compare = try ExampleMessage.decode(&reader);
    try std.testing.expectEqual(base.hey orelse 255, 1);

    const cmp_pack = compare.pack.?;
    for (cmp_pack) |item, id| {
        try std.testing.expectEqual(item, examples[id]);
    }

    const cmp_ex = compare.examples.?;
    for (cmp_ex) |item, id| {
        try std.testing.expectEqualStrings(item.name, more_examples[id].name);
        try std.testing.expectEqual(item.age, more_examples[id].age);
    }

    try std.testing.expectEqual(cmp_pack[0].len, examples[0].len);
    try std.testing.expectEqual(base.heyooo, compare.heyooo);
}
