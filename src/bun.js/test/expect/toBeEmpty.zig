pub fn toBeEmpty(this: *Expect, globalThis: *JSGlobalObject, callFrame: *CallFrame) bun.JSError!JSValue {
    defer this.postMatch(globalThis);

    const thisValue = callFrame.this();
    const value: JSValue = try this.getValue(globalThis, thisValue, "toBeEmpty", "");

    this.incrementExpectCallCounter();

    const not = this.flags.not;
    var pass = false;
    var formatter = jsc.ConsoleObject.Formatter{ .globalThis = globalThis, .quote_strings = true };
    defer formatter.deinit();

    const actual_length = try value.getLengthIfPropertyExistsInternal(globalThis);

    if (actual_length == std.math.inf(f64)) {
        if (value.jsTypeLoose().isObject()) {
            if (try value.isIterable(globalThis)) {
                var any_properties_in_iterator = false;
                try value.forEach(globalThis, &any_properties_in_iterator, struct {
                    pub fn anythingInIterator(
                        _: *jsc.VM,
                        _: *JSGlobalObject,
                        any_: ?*anyopaque,
                        _: JSValue,
                    ) callconv(.c) void {
                        bun.cast(*bool, any_.?).* = true;
                    }
                }.anythingInIterator);
                pass = !any_properties_in_iterator;
            } else {
                const cell = value.toCell() orelse {
                    return globalThis.throwTypeError("Expected value to be a string, object, or iterable", .{});
                };
                var props_iter = try jsc.JSPropertyIterator(.{
                    .skip_empty_name = false,
                    .own_properties_only = false,
                    .include_value = true,
                    // FIXME: can we do this?
                }).init(globalThis, cell.toObject(globalThis));
                defer props_iter.deinit();
                pass = props_iter.len == 0;
            }
        } else {
            const signature = comptime getSignature("toBeEmpty", "", false);
            const fmt = signature ++ "\n\nExpected value to be a string, object, or iterable" ++
                "\n\nReceived: <red>{f}<r>\n";
            return globalThis.throwPretty(fmt, .{value.toFmt(&formatter)});
        }
    } else if (std.math.isNan(actual_length)) {
        return globalThis.throw("Received value has non-number length property: {}", .{actual_length});
    } else {
        pass = actual_length == 0;
    }

    if (not and pass) {
        const signature = comptime getSignature("toBeEmpty", "", true);
        const fmt = signature ++ "\n\nExpected value <b>not<r> to be a string, object, or iterable" ++
            "\n\nReceived: <red>{f}<r>\n";
        return globalThis.throwPretty(fmt, .{value.toFmt(&formatter)});
    }

    if (not) pass = !pass;
    if (pass) return .js_undefined;

    if (not) {
        const signature = comptime getSignature("toBeEmpty", "", true);
        const fmt = signature ++ "\n\nExpected value <b>not<r> to be empty" ++
            "\n\nReceived: <red>{f}<r>\n";
        return globalThis.throwPretty(fmt, .{value.toFmt(&formatter)});
    }

    const signature = comptime getSignature("toBeEmpty", "", false);
    const fmt = signature ++ "\n\nExpected value to be empty" ++
        "\n\nReceived: <red>{f}<r>\n";
    return globalThis.throwPretty(fmt, .{value.toFmt(&formatter)});
}

const bun = @import("bun");
const std = @import("std");

const jsc = bun.jsc;
const CallFrame = bun.jsc.CallFrame;
const JSGlobalObject = bun.jsc.JSGlobalObject;
const JSValue = bun.jsc.JSValue;

const Expect = bun.jsc.Expect.Expect;
const getSignature = Expect.getSignature;
