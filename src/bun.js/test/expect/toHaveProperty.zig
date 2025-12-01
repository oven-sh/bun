pub fn toHaveProperty(this: *Expect, globalThis: *JSGlobalObject, callFrame: *CallFrame) bun.JSError!JSValue {
    defer this.postMatch(globalThis);

    const thisValue = callFrame.this();
    const _arguments = callFrame.arguments_old(2);
    const arguments: []const JSValue = _arguments.ptr[0.._arguments.len];

    if (arguments.len < 1) {
        return globalThis.throwInvalidArguments("toHaveProperty() requires at least 1 argument", .{});
    }

    this.incrementExpectCallCounter();

    const expected_property_path = arguments[0];
    expected_property_path.ensureStillAlive();
    const expected_property: ?JSValue = if (arguments.len > 1) arguments[1] else null;
    if (expected_property) |ev| ev.ensureStillAlive();

    const value: JSValue = try this.getValue(globalThis, thisValue, "toHaveProperty", "<green>path<r><d>, <r><green>value<r>");

    if (!expected_property_path.isString() and !try expected_property_path.isIterable(globalThis)) {
        return globalThis.throw("Expected path must be a string or an array", .{});
    }

    const not = this.flags.not;
    var path_string = ZigString.Empty;
    try expected_property_path.toZigString(&path_string, globalThis);

    var pass = !value.isUndefinedOrNull();
    var received_property: JSValue = .zero;

    if (pass) {
        received_property = try value.getIfPropertyExistsFromPath(globalThis, expected_property_path);
        pass = received_property != .zero;
    }

    if (pass and expected_property != null) {
        pass = try received_property.jestDeepEquals(expected_property.?, globalThis);
    }

    if (not) pass = !pass;
    if (pass) return .js_undefined;

    // handle failure
    var formatter = jsc.ConsoleObject.Formatter{ .globalThis = globalThis, .quote_strings = true };
    defer formatter.deinit();
    if (not) {
        if (expected_property != null) {
            const signature = comptime getSignature("toHaveProperty", "<green>path<r><d>, <r><green>value<r>", true);
            if (received_property != .zero) {
                return this.throw(globalThis, signature, "\n\nExpected path: <green>{f}<r>\n\nExpected value: not <green>{f}<r>\n", .{
                    expected_property_path.toFmt(&formatter),
                    expected_property.?.toFmt(&formatter),
                });
            }
        }

        const signature = comptime getSignature("toHaveProperty", "<green>path<r>", true);
        return this.throw(globalThis, signature, "\n\nExpected path: not <green>{f}<r>\n\nReceived value: <red>{f}<r>\n", .{
            expected_property_path.toFmt(&formatter),
            received_property.toFmt(&formatter),
        });
    }

    if (expected_property != null) {
        const signature = comptime getSignature("toHaveProperty", "<green>path<r><d>, <r><green>value<r>", false);
        if (received_property != .zero) {
            // deep equal case
            const diff_format = DiffFormatter{
                .received = received_property,
                .expected = expected_property.?,
                .globalThis = globalThis,
            };

            return this.throw(globalThis, signature, "\n\n{f}\n", .{diff_format});
        }

        const fmt = "\n\nExpected path: <green>{f}<r>\n\nExpected value: <green>{f}<r>\n\n" ++
            "Unable to find property\n";
        return this.throw(globalThis, signature, fmt, .{
            expected_property_path.toFmt(&formatter),
            expected_property.?.toFmt(&formatter),
        });
    }

    const signature = comptime getSignature("toHaveProperty", "<green>path<r>", false);
    return this.throw(globalThis, signature, "\n\nExpected path: <green>{f}<r>\n\nUnable to find property\n", .{expected_property_path.toFmt(&formatter)});
}

const DiffFormatter = @import("../diff_format.zig").DiffFormatter;

const bun = @import("bun");
const ZigString = bun.ZigString;

const jsc = bun.jsc;
const CallFrame = bun.jsc.CallFrame;
const JSGlobalObject = bun.jsc.JSGlobalObject;
const JSValue = bun.jsc.JSValue;

const Expect = bun.jsc.Expect.Expect;
const getSignature = Expect.getSignature;
