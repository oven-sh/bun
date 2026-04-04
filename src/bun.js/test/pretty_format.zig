//! Jest snapshot formatting now lives in `ConsoleObject.Formatter` behind the
//! `jest_snapshot` flag. Only the asymmetric-matcher printer remains here
//! because it is shared by both the console and snapshot paths via `anytype`.

pub const JestPrettyFormat = struct {
    fn printAsymmetricMatcherPromisePrefix(flags: expect.Expect.Flags, matcher: anytype, writer: anytype) void {
        if (flags.promise != .none) {
            switch (flags.promise) {
                .resolves => {
                    matcher.addForNewLine("promise resolved to ".len);
                    writer.writeAll("promise resolved to ");
                },
                .rejects => {
                    matcher.addForNewLine("promise rejected to ".len);
                    writer.writeAll("promise rejected to ");
                },
                else => {},
            }
        }
    }

    pub fn printAsymmetricMatcher(
        // the Formatter instance
        this: anytype,
        comptime Format: anytype,
        /// The WrappedWriter
        writer: anytype,
        /// The raw writer
        writer_: anytype,
        /// Buf used to print strings
        name_buf: [512]u8,
        value: JSValue,
        comptime enable_ansi_colors: bool,
    ) bun.JSError!bool {
        _ = Format;

        if (value.as(expect.ExpectAnything)) |matcher| {
            printAsymmetricMatcherPromisePrefix(matcher.flags, this, writer);
            if (matcher.flags.not) {
                this.addForNewLine("NotAnything".len);
                writer.writeAll("NotAnything");
            } else {
                this.addForNewLine("Anything".len);
                writer.writeAll("Anything");
            }
        } else if (value.as(expect.ExpectAny)) |matcher| {
            const constructor_value = expect.ExpectAny.js.constructorValueGetCached(value) orelse return true;

            printAsymmetricMatcherPromisePrefix(matcher.flags, this, writer);
            if (matcher.flags.not) {
                this.addForNewLine("NotAny<".len);
                writer.writeAll("NotAny<");
            } else {
                this.addForNewLine("Any<".len);
                writer.writeAll("Any<");
            }

            var class_name = ZigString.init(&name_buf);
            try constructor_value.getClassName(this.globalThis, &class_name);
            this.addForNewLine(class_name.len);
            writer.print(comptime Output.prettyFmt("<cyan>{f}<r>", enable_ansi_colors), .{class_name});
            this.addForNewLine(1);
            writer.writeAll(">");
        } else if (value.as(expect.ExpectCloseTo)) |matcher| {
            const number_value = expect.ExpectCloseTo.js.numberValueGetCached(value) orelse return true;
            const digits_value = expect.ExpectCloseTo.js.digitsValueGetCached(value) orelse return true;

            const number = number_value.toInt32();
            const digits = digits_value.toInt32();

            printAsymmetricMatcherPromisePrefix(matcher.flags, this, writer);
            if (matcher.flags.not) {
                this.addForNewLine("NumberNotCloseTo".len);
                writer.writeAll("NumberNotCloseTo");
            } else {
                this.addForNewLine("NumberCloseTo ".len);
                writer.writeAll("NumberCloseTo ");
            }
            writer.print("{d} ({d} digit{s})", .{ number, digits, if (digits == 1) "" else "s" });
        } else if (value.as(expect.ExpectObjectContaining)) |matcher| {
            const object_value = expect.ExpectObjectContaining.js.objectValueGetCached(value) orelse return true;

            printAsymmetricMatcherPromisePrefix(matcher.flags, this, writer);
            if (matcher.flags.not) {
                this.addForNewLine("ObjectNotContaining ".len);
                writer.writeAll("ObjectNotContaining ");
            } else {
                this.addForNewLine("ObjectContaining ".len);
                writer.writeAll("ObjectContaining ");
            }
            try this.printAs(.Object, @TypeOf(writer_), writer_, object_value, .Object, enable_ansi_colors);
        } else if (value.as(expect.ExpectStringContaining)) |matcher| {
            const substring_value = expect.ExpectStringContaining.js.stringValueGetCached(value) orelse return true;

            printAsymmetricMatcherPromisePrefix(matcher.flags, this, writer);
            if (matcher.flags.not) {
                this.addForNewLine("StringNotContaining ".len);
                writer.writeAll("StringNotContaining ");
            } else {
                this.addForNewLine("StringContaining ".len);
                writer.writeAll("StringContaining ");
            }
            try this.printAs(.String, @TypeOf(writer_), writer_, substring_value, .String, enable_ansi_colors);
        } else if (value.as(expect.ExpectStringMatching)) |matcher| {
            const test_value = expect.ExpectStringMatching.js.testValueGetCached(value) orelse return true;

            printAsymmetricMatcherPromisePrefix(matcher.flags, this, writer);
            if (matcher.flags.not) {
                this.addForNewLine("StringNotMatching ".len);
                writer.writeAll("StringNotMatching ");
            } else {
                this.addForNewLine("StringMatching ".len);
                writer.writeAll("StringMatching ");
            }

            const original_quote_strings = this.quote_strings;
            if (test_value.isRegExp()) this.quote_strings = false;
            try this.printAs(.String, @TypeOf(writer_), writer_, test_value, .String, enable_ansi_colors);
            this.quote_strings = original_quote_strings;
        } else if (value.as(expect.ExpectCustomAsymmetricMatcher)) |instance| {
            const printed = instance.customPrint(value, this.globalThis, writer_, true) catch unreachable;
            if (!printed) { // default print (non-overridden by user)
                const flags = instance.flags;
                const args_value = expect.ExpectCustomAsymmetricMatcher.js.capturedArgsGetCached(value) orelse return true;
                const matcher_fn = expect.ExpectCustomAsymmetricMatcher.js.matcherFnGetCached(value) orelse return true;
                const matcher_name = try matcher_fn.getName(this.globalThis);

                printAsymmetricMatcherPromisePrefix(flags, this, writer);
                if (flags.not) {
                    this.addForNewLine("not ".len);
                    writer.writeAll("not ");
                }
                this.addForNewLine(matcher_name.length() + 1);
                writer.print("{f}", .{matcher_name});
                writer.writeAll(" ");
                try this.printAs(.Array, @TypeOf(writer_), writer_, args_value, .Array, enable_ansi_colors);
            }
        } else {
            return false;
        }
        return true;
    }
};

const expect = @import("./expect.zig");

const bun = @import("bun");
const Output = bun.Output;

const jsc = bun.jsc;
const JSValue = jsc.JSValue;
const ZigString = jsc.ZigString;
