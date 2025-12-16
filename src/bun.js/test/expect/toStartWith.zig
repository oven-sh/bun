pub fn toStartWith(this: *Expect, globalThis: *JSGlobalObject, callFrame: *CallFrame) bun.JSError!JSValue {
    defer this.postMatch(globalThis);

    const thisValue = callFrame.this();
    const arguments_ = callFrame.arguments_old(1);
    const arguments = arguments_.slice();

    if (arguments.len < 1) {
        return globalThis.throwInvalidArguments("toStartWith() requires 1 argument", .{});
    }

    const expected = arguments[0];
    expected.ensureStillAlive();

    if (!expected.isString()) {
        return globalThis.throw("toStartWith() requires the first argument to be a string", .{});
    }

    const value: JSValue = try this.getValue(globalThis, thisValue, "toStartWith", "<green>expected<r>");

    this.incrementExpectCallCounter();

    var pass = value.isString();
    if (pass) {
        const value_string = try value.toSliceOrNull(globalThis);
        defer value_string.deinit();
        const expected_string = try expected.toSliceOrNull(globalThis);
        defer expected_string.deinit();
        pass = strings.startsWith(value_string.slice(), expected_string.slice()) or expected_string.len == 0;
    }

    const not = this.flags.not;
    if (not) pass = !pass;

    if (pass) return .js_undefined;

    var formatter = jsc.ConsoleObject.Formatter{ .globalThis = globalThis, .quote_strings = true };
    defer formatter.deinit();
    const value_fmt = value.toFmt(&formatter);
    const expected_fmt = expected.toFmt(&formatter);

    if (not) {
        const expected_line = "Expected to not start with: <green>{f}<r>\n";
        const received_line = "Received: <red>{f}<r>\n";
        const signature = comptime getSignature("toStartWith", "<green>expected<r>", true);
        return this.throw(globalThis, signature, "\n\n" ++ expected_line ++ received_line, .{ expected_fmt, value_fmt });
    }

    const expected_line = "Expected to start with: <green>{f}<r>\n";
    const received_line = "Received: <red>{f}<r>\n";
    const signature = comptime getSignature("toStartWith", "<green>expected<r>", false);
    return this.throw(globalThis, signature, "\n\n" ++ expected_line ++ received_line, .{ expected_fmt, value_fmt });
}

const bun = @import("bun");
const strings = bun.strings;

const jsc = bun.jsc;
const CallFrame = bun.jsc.CallFrame;
const JSGlobalObject = bun.jsc.JSGlobalObject;
const JSValue = bun.jsc.JSValue;

const Expect = bun.jsc.Expect.Expect;
const getSignature = Expect.getSignature;
