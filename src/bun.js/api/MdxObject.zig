pub fn create(globalThis: *jsc.JSGlobalObject) jsc.JSValue {
    const object = JSValue.createEmptyObject(globalThis, 1);
    object.put(
        globalThis,
        ZigString.static("compile"),
        jsc.JSFunction.create(globalThis, "compile", compile, 2, .{}),
    );
    return object;
}

pub fn compile(
    globalThis: *jsc.JSGlobalObject,
    callframe: *jsc.CallFrame,
) bun.JSError!jsc.JSValue {
    const input_value, const opts_value = callframe.argumentsAsArray(2);

    if (input_value.isEmptyOrUndefinedOrNull()) {
        return globalThis.throwInvalidArguments("Expected a string or buffer to compile", .{});
    }

    var arena: bun.ArenaAllocator = .init(bun.default_allocator);
    defer arena.deinit();

    const buffer = try jsc.Node.StringOrBuffer.fromJS(globalThis, arena.allocator(), input_value) orelse {
        return globalThis.throwInvalidArguments("Expected a string or buffer to compile", .{});
    };
    const input = buffer.slice();

    const options = try parseOptions(globalThis, arena.allocator(), opts_value);
    const result = mdx.compile(input, arena.allocator(), options) catch |err| return switch (err) {
        error.OutOfMemory => globalThis.throwOutOfMemory(),
        else => globalThis.throwValue(globalThis.createSyntaxErrorInstance("MDX compile error: {s}", .{@errorName(err)})),
    };

    return bun.String.createUTF8ForJS(globalThis, result);
}

fn parseOptions(globalThis: *jsc.JSGlobalObject, allocator: std.mem.Allocator, opts_value: JSValue) bun.JSError!mdx.MdxOptions {
    var options: mdx.MdxOptions = .{};

    if (opts_value.isObject()) {
        inline for (@typeInfo(md.Options).@"struct".fields) |field| {
            comptime if (field.type != bool) continue;
            const camel = comptime camelCaseOf(field.name);
            if (try opts_value.getBooleanLoose(globalThis, camel)) |val| {
                @field(options.md_options, field.name) = val;
            } else if (comptime !std.mem.eql(u8, camel, field.name)) {
                if (try opts_value.getBooleanLoose(globalThis, field.name)) |val| {
                    @field(options.md_options, field.name) = val;
                }
            }
        }

        if (try opts_value.get(globalThis, "jsxImportSource")) |import_source_value| {
            if (!import_source_value.isString()) {
                return globalThis.throwInvalidArguments("jsxImportSource must be a string", .{});
            }
            var zig_str = jsc.ZigString.init("");
            try import_source_value.toZigString(&zig_str, globalThis);
            if (zig_str.len > 0) {
                options.jsx_import_source = try allocator.dupe(u8, zig_str.slice());
            }
        }
    }

    return options;
}

fn camelCaseOf(comptime snake: []const u8) []const u8 {
    return comptime brk: {
        var count: usize = 0;
        for (snake) |c| {
            if (c != '_') count += 1;
        }
        if (count == snake.len) break :brk snake;

        var buf: [count]u8 = undefined;
        var i: usize = 0;
        var cap_next = false;
        for (snake) |c| {
            if (c == '_') {
                cap_next = true;
            } else {
                buf[i] = if (cap_next and c >= 'a' and c <= 'z') c - 32 else c;
                i += 1;
                cap_next = false;
            }
        }
        const final = buf;
        break :brk &final;
    };
}

const bun = @import("bun");
const jsc = bun.jsc;
const md = bun.md;
const mdx = bun.md.mdx;
const std = @import("std");
const JSValue = jsc.JSValue;
const ZigString = jsc.ZigString;
