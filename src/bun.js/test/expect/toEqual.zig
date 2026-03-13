pub fn toEqual(this: *Expect, globalThis: *JSGlobalObject, callFrame: *CallFrame) bun.JSError!JSValue {
    defer this.postMatch(globalThis);

    const thisValue = callFrame.this();
    const _arguments = callFrame.arguments_old(1);
    const arguments: []const JSValue = _arguments.ptr[0.._arguments.len];

    if (arguments.len < 1) {
        return globalThis.throwInvalidArguments("toEqual() requires 1 argument", .{});
    }

    this.incrementExpectCallCounter();

    const expected = arguments[0];
    const value: JSValue = try this.getValue(globalThis, thisValue, "toEqual", "<green>expected<r>");

    const not = this.flags.not;
    var pass = try value.jestDeepEquals(expected, globalThis);

    if (not) pass = !pass;
    if (pass) return .js_undefined;

    // handle failure
    const diff_formatter = DiffFormatter{
        .received = value,
        .expected = expected,
        .globalThis = globalThis,
        .not = not,
    };

    if (not) {
        const signature = comptime getSignature("toEqual", "<green>expected<r>", true);
        return this.throw(globalThis, signature, "\n\n{f}\n", .{diff_formatter});
    }

    const signature = comptime getSignature("toEqual", "<green>expected<r>", false);
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
