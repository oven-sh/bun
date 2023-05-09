const schema = @import("./api/schema.zig");
const Api = schema.Api;
const std = @import("std");
const Fs = @import("./fs.zig");
const bun = @import("root").bun;
const string = bun.string;
const Output = bun.Output;
const Global = bun.Global;
const Environment = bun.Environment;
const strings = bun.strings;
const MutableString = bun.MutableString;
const FileDescriptorType = bun.FileDescriptor;
const StoredFileDescriptorType = bun.StoredFileDescriptorType;
const stringZ = bun.stringZ;
const default_allocator = bun.default_allocator;
const C = bun.C;

pub fn modulesIn(bundle: *const Api.JavascriptBundle, pkg: *const Api.JavascriptBundledPackage) []const Api.JavascriptBundledModule {
    return bundle.modules[pkg.modules_offset .. pkg.modules_offset + pkg.modules_length];
}

// This corresponds to Api.JavascriptBundledPackage.hash
pub const BundledPackageHash = u32;
// This is the offset in the array of packages
pub const BundledPackageID = u32;

const PackageIDMap = std.AutoHashMap(BundledPackageHash, BundledPackageID);

const PackageNameMap = bun.StringHashMap([]BundledPackageID);

pub const AllocatedString = struct {
    str: string,
    len: u32,
    allocator: std.mem.Allocator,
};

pub const NodeModuleBundle = struct {
    container: Api.JavascriptBundleContainer,
    bundle: Api.JavascriptBundle,
    allocator: std.mem.Allocator,
    bytes_ptr: []u8 = undefined,
    bytes: []u8 = &[_]u8{},
    fd: FileDescriptorType = 0,
    code_end_pos: u32 = 0,

    // Lookup packages by ID - hash(name@version)
    package_id_map: PackageIDMap,

    // Lookup packages by name. Remember that you can have multiple versions of the same package.
    package_name_map: PackageNameMap,

    // This is stored as a single pre-allocated, flat array so we can avoid dynamic allocations.
    package_name_ids_ptr: []BundledPackageID = &([_]BundledPackageID{}),

    code_string: ?AllocatedString = null,

    pub const magic_bytes = "#!/usr/bin/env bun\n\n";
    threadlocal var jsbundle_prefix: [magic_bytes.len + 5]u8 = undefined;

    // TODO: support preact-refresh, others by not hard coding
    pub fn hasFastRefresh(this: *const NodeModuleBundle) bool {
        return this.package_name_map.contains("react-refresh");
    }

    pub fn readCodeAsStringSlow(this: *NodeModuleBundle, allocator: std.mem.Allocator) !string {
        if (this.code_string) |code| {
            return code.str;
        }

        var file = std.fs.File{ .handle = this.fd };

        var buf = try allocator.alloc(u8, this.code_end_pos);
        const count = try file.preadAll(buf, this.codeStartOffset());
        this.code_string = AllocatedString{ .str = buf[0..count], .len = @truncate(u32, buf.len), .allocator = allocator };
        return this.code_string.?.str;
    }

    pub fn loadPackageMap(this: *NodeModuleBundle) !void {
        this.package_name_map = PackageNameMap.init(this.allocator);
        this.package_id_map = PackageIDMap.init(this.allocator);

        const package_count = @truncate(u32, this.bundle.packages.len);

        // this.package_has_multiple_versions = try std.bit_set.DynamicBitSet.initFull(package_count, this.allocator);

        try this.package_id_map.ensureTotalCapacity(
            package_count,
        );
        this.package_name_ids_ptr = try this.allocator.alloc(BundledPackageID, this.bundle.packages.len);
        var remaining_names = this.package_name_ids_ptr;
        try this.package_name_map.ensureTotalCapacity(
            package_count,
        );
        var prev_package_ids_for_name: []u32 = &[_]u32{};

        for (this.bundle.packages, 0..) |package, _package_id| {
            const package_id = @truncate(u32, _package_id);
            std.debug.assert(package.hash != 0);
            this.package_id_map.putAssumeCapacityNoClobber(package.hash, @truncate(u32, package_id));

            const package_name = this.str(package.name);
            var entry = this.package_name_map.getOrPutAssumeCapacity(package_name);

            if (entry.found_existing) {
                // this.package_has_multiple_versions.set(prev_package_ids_for_name[prev_package_ids_for_name.len - 1]);
                // Assert that multiple packages with the same name come immediately after another
                // This catches any issues with the sorting order, which would cause all sorts of weird bugs
                // This also allows us to simply extend the length of the previous slice to the new length
                // Saving us an allocation
                if (@ptrToInt(prev_package_ids_for_name.ptr) != @ptrToInt(entry.value_ptr.ptr)) {
                    Output.prettyErrorln(
                        \\<r><red>Fatal<r>: incorrect package sorting order detected in .bun file.\n
                        \\This is a bug! Please create an issue.\n
                        \\If this bug blocks you from doing work, for now 
                        \\please <b>avoid having multiple versions of <cyan>"{s}"<r> in the same bundle.\n
                        \\\n
                        \\- Jarred"
                    ,
                        .{
                            package_name,
                        },
                    );
                    Global.crash();
                }

                const end = prev_package_ids_for_name.len + 1;
                // Assert we have enough room to add another package
                std.debug.assert(end < remaining_names.len);
                entry.value_ptr.* = prev_package_ids_for_name.ptr[0..end];
                entry.value_ptr.*[end - 1] = package_id;
            } else {
                prev_package_ids_for_name = remaining_names[0..1];
                prev_package_ids_for_name[0] = package_id;
                entry.value_ptr.* = prev_package_ids_for_name;
                remaining_names = remaining_names[1..];
            }
        }
    }

    pub fn getPackageIDByHash(this: *const NodeModuleBundle, hash: BundledPackageID) ?u32 {
        return this.package_id_map.get(hash);
    }

    pub fn getPackageIDByName(this: *const NodeModuleBundle, name: string) ?[]u32 {
        return this.package_name_map.get(name);
    }

    pub fn getPackage(this: *const NodeModuleBundle, name: string) ?*const Api.JavascriptBundledPackage {
        const package_id = this.getPackageIDByName(name) orelse return null;
        return &this.bundle.packages[@intCast(usize, package_id[0])];
    }

    pub fn hasModule(this: *const NodeModuleBundle, name: string) ?*const Api.JavascriptBundledPackage {
        const package_id = this.getPackageID(name) orelse return null;
        return &this.bundle.packages[@intCast(usize, package_id)];
    }

    pub const ModuleQuery = struct {
        package: *const Api.JavascriptBundledPackage,
        relative_path: string,
        extensions: []string,
    };

    pub fn allocModuleImport(
        this: *const NodeModuleBundle,
        to: *const Api.JavascriptBundledModule,
        allocator: std.mem.Allocator,
    ) !string {
        const fmt = bun.fmt.hexIntLower(this.bundle.packages[to.package_id].hash);
        return try std.fmt.allocPrint(
            allocator,
            "{any}/{s}",
            .{
                fmt,
                this.str(to.path),
                123,
            },
        );
    }

    pub fn findModuleInPackage(
        this: *const NodeModuleBundle,
        package: *const Api.JavascriptBundledPackage,
        _query: string,
    ) ?*const Api.JavascriptBundledModule {
        if (this.findModuleIDInPackage(package, _query)) |id| {
            return &this.bundle.modules[id];
        }

        return null;
    }

    pub fn findModuleIDInPackageStupid(
        this: *const NodeModuleBundle,
        package: *const Api.JavascriptBundledPackage,
        _query: string,
    ) ?u32 {
        for (modulesIn(&this.bundle, package), 0..) |mod, i| {
            if (strings.eql(this.str(mod.path), _query)) {
                return @truncate(u32, i + package.modules_offset);
            }
        }

        return null;
    }

    pub fn findModuleIDInPackage(
        this: *const NodeModuleBundle,
        package: *const Api.JavascriptBundledPackage,
        _query: string,
    ) ?u32 {
        const ModuleFinder = struct {
            const Self = @This();
            ctx: *const NodeModuleBundle,
            pkg: *const Api.JavascriptBundledPackage,
            query: string,

            // Since the module doesn't necessarily exist, we use an integer overflow as the module name
            pub fn moduleName(context: *const Self, module: *const Api.JavascriptBundledModule) string {
                return if (module.path.offset == context.ctx.bundle.manifest_string.len) context.query else context.ctx.str(module.path);
            }

            pub fn cmpAsc(context: Self, lhs: Api.JavascriptBundledModule, rhs: Api.JavascriptBundledModule) std.math.Order {
                // Comapre the module name
                const lhs_name = context.moduleName(&lhs);
                const rhs_name = context.moduleName(&rhs);

                const traversal_length = std.math.min(lhs_name.len, rhs_name.len);

                for (lhs_name[0..traversal_length], 0..) |char, i| {
                    switch (std.math.order(char, rhs_name[i])) {
                        .lt, .gt => |order| {
                            return order;
                        },
                        .eq => {},
                    }
                }

                return std.math.order(lhs_name.len, rhs_name.len);
            }
        };
        var to_find = Api.JavascriptBundledModule{
            .package_id = 0,
            .code = .{},
            .path = .{
                .offset = @truncate(u32, this.bundle.manifest_string.len),
            },
        };

        var finder = ModuleFinder{ .ctx = this, .pkg = package, .query = _query };

        const modules = modulesIn(&this.bundle, package);
        return @intCast(u32, std.sort.binarySearch(
            Api.JavascriptBundledModule,
            to_find,
            modules,
            finder,
            ModuleFinder.cmpAsc,
        ) orelse return null) + package.modules_offset;
    }

    pub fn findModuleIDInPackageIgnoringExtension(
        this: *const NodeModuleBundle,
        package: *const Api.JavascriptBundledPackage,
        _query: string,
    ) ?u32 {
        const ModuleFinder = struct {
            const Self = @This();
            ctx: *const NodeModuleBundle,
            pkg: *const Api.JavascriptBundledPackage,
            query: string,

            // Since the module doesn't necessarily exist, we use an integer overflow as the module name
            pub fn moduleName(context: *const Self, module: *const Api.JavascriptBundledModule) string {
                return if (module.path.offset == context.ctx.bundle.manifest_string.len) context.query else context.ctx.str(.{
                    .offset = module.path.offset,
                    .length = module.path.length - @as(u32, module.path_extname_length),
                });
            }

            pub fn cmpAsc(context: Self, lhs: Api.JavascriptBundledModule, rhs: Api.JavascriptBundledModule) std.math.Order {
                // Comapre the module name
                const lhs_name = context.moduleName(&lhs);
                const rhs_name = context.moduleName(&rhs);

                const traversal_length = std.math.min(lhs_name.len, rhs_name.len);

                for (lhs_name[0..traversal_length], 0..) |char, i| {
                    switch (std.math.order(char, rhs_name[i])) {
                        .lt, .gt => |order| {
                            return order;
                        },
                        .eq => {},
                    }
                }

                return std.math.order(lhs_name.len, rhs_name.len);
            }
        };
        var to_find = Api.JavascriptBundledModule{
            .package_id = 0,
            .code = .{},
            .path = .{
                .offset = @truncate(u32, this.bundle.manifest_string.len),
            },
        };

        var finder = ModuleFinder{ .ctx = this, .pkg = package, .query = _query[0 .. _query.len - std.fs.path.extension(_query).len] };

        const modules = modulesIn(&this.bundle, package);
        return @intCast(u32, std.sort.binarySearch(
            Api.JavascriptBundledModule,
            to_find,
            modules,
            finder,
            ModuleFinder.cmpAsc,
        ) orelse return null) + package.modules_offset;
    }

    pub fn init(container: Api.JavascriptBundleContainer, allocator: std.mem.Allocator) NodeModuleBundle {
        return NodeModuleBundle{
            .container = container,
            .bundle = container.bundle.?,
            .allocator = allocator,
            .package_id_map = undefined,
            .package_name_map = undefined,
            .package_name_ids_ptr = undefined,
        };
    }

    pub fn getCodeEndPosition(stream: anytype, comptime needs_seek: bool) !u32 {
        if (needs_seek) try stream.seekTo(0);

        const read_bytes = try stream.read(&jsbundle_prefix);
        if (read_bytes != jsbundle_prefix.len) {
            return error.JSBundleBadHeaderTooShort;
        }

        return std.mem.readIntNative(u32, jsbundle_prefix[magic_bytes.len .. magic_bytes.len + 4]);
    }

    pub fn loadBundle(allocator: std.mem.Allocator, stream: anytype) !NodeModuleBundle {
        const end = try getCodeEndPosition(stream, false);
        try stream.seekTo(end);
        const file_end = try stream.getEndPos();
        var file_bytes = try allocator.alloc(u8, file_end - end);
        var read_count = try stream.read(file_bytes);
        var read_bytes = file_bytes[0..read_count];
        var reader = schema.Reader.init(read_bytes, allocator);
        var container = try Api.JavascriptBundleContainer.decode(&reader);
        if (container.bundle == null) return error.InvalidBundle;
        var bundle = NodeModuleBundle{
            .allocator = allocator,
            .container = container,
            .bundle = container.bundle.?,
            .fd = stream.handle,
            // sorry you can't have 4 GB of node_modules
            .code_end_pos = end - @intCast(u32, jsbundle_prefix.len),
            .bytes = read_bytes,
            .bytes_ptr = file_bytes,
            .package_id_map = undefined,
            .package_name_map = undefined,
            .package_name_ids_ptr = undefined,
        };
        try bundle.loadPackageMap();
        return bundle;
    }

    pub fn str(bundle: *const NodeModuleBundle, pointer: Api.StringPointer) string {
        return bundle.bundle.manifest_string[pointer.offset .. pointer.offset + pointer.length];
    }

    pub fn printSummary(this: *const NodeModuleBundle) void {
        const indent = comptime "   ";
        for (this.bundle.packages) |pkg| {
            const modules = this.bundle.modules[pkg.modules_offset .. pkg.modules_offset + pkg.modules_length];

            Output.prettyln(
                "<r><blue><b>{s}</r> v{s}",
                .{ this.str(pkg.name), this.str(pkg.version) },
            );

            for (modules, 0..) |module, module_i| {
                const size_level: SizeLevel =
                    switch (module.code.length) {
                    0...5_000 => .good,
                    5_001...74_999 => .neutral,
                    else => .bad,
                };

                Output.print(indent, .{});
                prettySize(module.code.length, size_level, ">");
                Output.prettyln(
                    indent ++ "<d>{s}</r>" ++ std.fs.path.sep_str ++ "{s} <r><d>[{d}]<r>\n",
                    .{
                        this.str(pkg.name),
                        this.str(module.path),
                        module_i + pkg.modules_offset,
                    },
                );
            }

            Output.print("\n", .{});
        }
        const source_code_size = this.container.code_length.? - @intCast(u32, jsbundle_prefix.len);

        Output.pretty("<b>", .{});
        prettySize(source_code_size, .neutral, ">");
        Output.prettyln("<b> JavaScript<r>", .{});
        Output.prettyln(indent ++ "<b>{d:6} modules", .{this.bundle.modules.len});
        Output.prettyln(indent ++ "<b>{d:6} packages", .{this.bundle.packages.len});
    }

    pub inline fn codeStartOffset(_: *const NodeModuleBundle) u32 {
        return @intCast(u32, jsbundle_prefix.len);
    }

    pub fn printSummaryFromDisk(
        comptime StreamType: type,
        input: StreamType,
        comptime DestinationStreamType: type,
        _: DestinationStreamType,
        allocator: std.mem.Allocator,
    ) !void {
        const this = try loadBundle(allocator, input);
        this.printSummary();
    }

    const SizeLevel = enum { good, neutral, bad };
    fn prettySize(size: u32, level: SizeLevel, comptime align_char: []const u8) void {
        switch (size) {
            0...1024 * 1024 => {
                switch (level) {
                    .bad => Output.pretty("<red>{d: " ++ align_char ++ "6.2} KB</r>", .{@intToFloat(f64, size) / 1024.0}),
                    .neutral => Output.pretty("{d: " ++ align_char ++ "6.2} KB</r>", .{@intToFloat(f64, size) / 1024.0}),
                    .good => Output.pretty("<green>{d: " ++ align_char ++ "6.2} KB</r>", .{@intToFloat(f64, size) / 1024.0}),
                }
            },
            else => {
                switch (level) {
                    .bad => Output.pretty("<red>{d: " ++ align_char ++ "6.2} MB</r>", .{@intToFloat(f64, size) / (1024 * 1024.0)}),
                    .neutral => Output.pretty("{d: " ++ align_char ++ "6.2} MB</r>", .{@intToFloat(f64, size) / (1024 * 1024.0)}),
                    .good => Output.pretty("<green>{d: " ++ align_char ++ "6.2} MB</r>", .{@intToFloat(f64, size) / (1024 * 1024.0)}),
                }
            },
        }
    }

    pub fn printBundle(
        comptime StreamType: type,
        input: StreamType,
        comptime DestinationStreamType: type,
        output: DestinationStreamType,
    ) !void {
        const BufferStreamContext = struct {
            pub fn run(in: StreamType, out: DestinationStreamType, end_at: u32) !void {
                var buf: [4096]u8 = undefined;
                var remain = @intCast(i64, end_at);
                var read_amount: i64 = 99999;
                while (remain > 0 and read_amount > 0) {
                    read_amount = @intCast(i64, in.read(&buf) catch 0);
                    remain -= @intCast(i64, try out.write(buf[0..@intCast(usize, std.math.min(read_amount, remain))]));
                }
            }
        };

        if (comptime Environment.isMac) {
            // darwin only allows reading ahead on/off, not specific amount
            _ = std.os.fcntl(input.handle, std.os.F.RDAHEAD, 1) catch 0;
        }
        const end = (try getCodeEndPosition(input, false)) - @intCast(u32, jsbundle_prefix.len);

        try BufferStreamContext.run(
            input,
            output,
            end,
        );
    }
};
