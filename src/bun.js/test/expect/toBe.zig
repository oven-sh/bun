/// Object.is()
pub fn toBe(
    this: *Expect,
    globalThis: *JSGlobalObject,
    callframe: *CallFrame,
) bun.JSError!JSValue {
    defer this.postMatch(globalThis);
    const thisValue = callframe.this();
    const arguments_ = callframe.arguments_old(2);
    const arguments = arguments_.slice();

    if (arguments.len < 1) {
        return globalThis.throwInvalidArguments("toBe() takes 1 argument", .{});
    }

    this.incrementExpectCallCounter();
    const right = arguments[0];
    right.ensureStillAlive();
    const left = try this.getValue(globalThis, thisValue, "toBe", "<green>expected<r>");

    const not = this.flags.not;
    var pass = try right.isSameValue(left, globalThis);

    if (not) pass = !pass;
    if (pass) return .js_undefined;

    // handle failure
    var formatter = jsc.ConsoleObject.Formatter{ .globalThis = globalThis, .quote_strings = true };
    defer formatter.deinit();

    switch (this.custom_label.isEmpty()) {
        inline else => |has_custom_label| {
            if (not) {
                const signature = comptime getSignature("toBe", "<green>expected<r>", true);
                return this.throw(globalThis, signature, "\n\nExpected: not <green>{f}<r>\n", .{right.toFmt(&formatter)});
            }

            const signature = comptime getSignature("toBe", "<green>expected<r>", false);
            if (try left.deepEquals(right, globalThis) or try left.strictDeepEquals(right, globalThis)) {
                const fmt =
                    (if (!has_custom_label) "\n\n<d>If this test should pass, replace \"toBe\" with \"toEqual\" or \"toStrictEqual\"<r>" else "") ++
                    "\n\nExpected: <green>{f}<r>\n" ++
                    "Received: serializes to the same string\n";
                return this.throw(globalThis, signature, fmt, .{right.toFmt(&formatter)});
            }

            if (right.isString() and left.isString()) {
                const diff_format = DiffFormatter{
                    .expected = right,
                    .received = left,
                    .globalThis = globalThis,
                    .not = not,
                };
                return this.throw(globalThis, signature, "\n\n{f}\n", .{diff_format});
            }

            return this.throw(globalThis, signature, "\n\nExpected: <green>{f}<r>\nReceived: <red>{f}<r>\n", .{
                right.toFmt(&formatter),
                left.toFmt(&formatter),
            });
        },
    }
}

const bun = @import("bun");
const DiffFormatter = @import("../diff_format.zig").DiffFormatter;

const jsc = bun.jsc;
const CallFrame = bun.jsc.CallFrame;
const JSGlobalObject = bun.jsc.JSGlobalObject;
const JSValue = bun.jsc.JSValue;

const Expect = bun.jsc.Expect.Expect;
const getSignature = Expect.getSignature;
