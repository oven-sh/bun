pub fn toMatchObject(this: *Expect, globalThis: *JSGlobalObject, callFrame: *CallFrame) bun.JSError!JSValue {
    jsc.markBinding(@src());

    defer this.postMatch(globalThis);
    const thisValue = callFrame.this();
    const args = callFrame.arguments_old(1).slice();

    this.incrementExpectCallCounter();

    const not = this.flags.not;

    const received_object: JSValue = try this.getValue(globalThis, thisValue, "toMatchObject", "<green>expected<r>");

    if (!received_object.isObject()) {
        const matcher_error = "\n\n<b>Matcher error<r>: <red>received<r> value must be a non-null object\n";
        if (not) {
            const signature = comptime getSignature("toMatchObject", "<green>expected<r>", true);
            return this.throw(globalThis, signature, matcher_error, .{});
        }

        const signature = comptime getSignature("toMatchObject", "<green>expected<r>", false);
        return this.throw(globalThis, signature, matcher_error, .{});
    }

    if (args.len < 1 or !args[0].isObject()) {
        const matcher_error = "\n\n<b>Matcher error<r>: <green>expected<r> value must be a non-null object\n";
        if (not) {
            const signature = comptime getSignature("toMatchObject", "", true);
            return this.throw(globalThis, signature, matcher_error, .{});
        }
        const signature = comptime getSignature("toMatchObject", "", false);
        return this.throw(globalThis, signature, matcher_error, .{});
    }

    const property_matchers = args[0];

    var pass = try received_object.jestDeepMatch(property_matchers, globalThis, true);

    if (not) pass = !pass;
    if (pass) return .js_undefined;

    // handle failure
    const diff_formatter = DiffFormatter{
        .received = received_object,
        .expected = property_matchers,
        .globalThis = globalThis,
        .not = not,
    };

    if (not) {
        const signature = comptime getSignature("toMatchObject", "<green>expected<r>", true);
        return this.throw(globalThis, signature, "\n\n{f}\n", .{diff_formatter});
    }

    const signature = comptime getSignature("toMatchObject", "<green>expected<r>", false);
    return this.throw(globalThis, signature, "\n\n{f}\n", .{diff_formatter});
}

const bun = @import("bun");
const DiffFormatter = @import("../diff_format.zig").DiffFormatter;

const jsc = bun.jsc;
const CallFrame = bun.jsc.CallFrame;
const JSGlobalObject = bun.jsc.JSGlobalObject;
const JSValue = bun.jsc.JSValue;

const Expect = bun.jsc.Expect.Expect;
const getSignature = Expect.getSignature;
