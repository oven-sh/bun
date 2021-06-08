const schema = @import("./api/schema.zig");
const Api = schema.Api;
const std = @import("std");
usingnamespace @import("global.zig");

pub const NodeModuleBundle = struct {
    container: Api.JavascriptBundleContainer,
    bundle: Api.JavascriptBundle,
    allocator: *std.mem.Allocator,
    bytes_ptr: []u8 = undefined,
    bytes: []u8 = undefined,
    fd: FileDescriptorType = 0,

    pub const magic_bytes = "#!/usr/bin/env speedy\n\n";
    threadlocal var jsbundle_prefix: [magic_bytes.len + 5]u8 = undefined;

    pub fn init(container: Api.JavascriptBundleContainer, allocator: *std.mem.Allocator) NodeModuleBundle {
        return NodeModuleBundle{
            .container = container,
            .bundle = container.bundle.?,
            .allocator = allocator,
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

    pub fn loadBundle(allocator: *std.mem.Allocator, stream: anytype) !NodeModuleBundle {
        const end = try getCodeEndPosition(stream, false);
        try stream.seekTo(end);
        const file_end = try stream.getEndPos();
        var file_bytes = try allocator.alloc(u8, file_end - end);
        var read_count = try stream.read(file_bytes);
        var read_bytes = file_bytes[0..read_count];
        var reader = schema.Reader.init(read_bytes, allocator);
        var container = try Api.JavascriptBundleContainer.decode(&reader);

        return NodeModuleBundle{
            .allocator = allocator,
            .container = container,
            .bundle = container.bundle.?,
            .fd = stream.handle,
            .bytes = read_bytes,
            .bytes_ptr = file_bytes,
        };
    }

    pub fn str(bundle: *const NodeModuleBundle, pointer: Api.StringPointer) string {
        return bundle.bundle.manifest_string[pointer.offset .. pointer.offset + pointer.length];
    }

    pub fn getPackageSize(this: *const NodeModuleBundle, pkg: Api.JavascriptBundledPackage) usize {
        const modules = this.bundle.modules[pkg.modules_offset .. pkg.modules_offset + pkg.modules_length];
        var size: usize = 0;
        for (modules) |module| {
            size += module.code.length;
        }
        return size;
    }

    pub fn isPackageBigger(
        this: *const NodeModuleBundle,
        a: Api.JavascriptBundledPackage,
        b: Api.JavascriptBundledPackage,
    ) bool {
        return this.getPackageSize(a) < this.getPackageSize(b);
    }

    pub fn printSummary(this: *const NodeModuleBundle) void {
        const last = this.bundle.packages.len - 1;
        const indent = comptime "   ";
        for (this.bundle.packages) |pkg, i| {
            const modules = this.bundle.modules[pkg.modules_offset .. pkg.modules_offset + pkg.modules_length];

            Output.prettyln(
                "<r><blue><b>{s}</r> v{s}",
                .{ this.str(pkg.name), this.str(pkg.version) },
            );

            for (modules) |module| {
                const size_level = switch (module.code.length) {
                    0...5_000 => SizeLevel.good,
                    5_001...74_999 => SizeLevel.neutral,
                    else => SizeLevel.bad,
                };

                Output.print(indent, .{});
                prettySize(module.code.length, size_level, ">");
                Output.prettyln(
                    indent ++ "<d>{s}</r>" ++ std.fs.path.sep_str ++ "{s}\n",
                    .{
                        this.str(pkg.name),
                        this.str(module.path),
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

    pub fn printSummaryFromDisk(
        comptime StreamType: type,
        input: StreamType,
        comptime DestinationStreamType: type,
        output: DestinationStreamType,
        allocator: *std.mem.Allocator,
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
        if (isMac) {
            // darwin only allows reading ahead on/off, not specific amount
            _ = std.os.fcntl(input.handle, std.os.F_RDAHEAD, 1) catch 0;
        }
        const end = (try getCodeEndPosition(input, false)) - @intCast(u32, jsbundle_prefix.len);

        try BufferStreamContext.run(
            input,
            output,
            end,
        );
    }
};
