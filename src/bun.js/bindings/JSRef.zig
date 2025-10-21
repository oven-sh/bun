/// Holds a reference to a JSValue.
///
/// This reference can be either weak (a JSValue) or may be strong, in which
/// case it prevents the garbage collector from collecting the value.
pub const JSRef = union(enum) {
    weak: jsc.JSValue,
    strong: jsc.Strong.Optional,
    finalized: void,

    pub fn initWeak(value: jsc.JSValue) @This() {
        bun.assert(!value.isEmptyOrUndefinedOrNull());
        return .{ .weak = value };
    }

    pub fn initStrong(value: jsc.JSValue, globalThis: *jsc.JSGlobalObject) @This() {
        bun.assert(!value.isEmptyOrUndefinedOrNull());
        return .{ .strong = .create(value, globalThis) };
    }

    pub fn empty() @This() {
        return .{ .weak = .js_undefined };
    }

    pub fn tryGet(this: *const @This()) ?jsc.JSValue {
        return switch (this.*) {
            .weak => if (this.weak.isEmptyOrUndefinedOrNull()) null else this.weak,
            .strong => this.strong.get(),
            .finalized => null,
        };
    }
    pub fn setWeak(this: *@This(), value: jsc.JSValue) void {
        bun.assert(!value.isEmptyOrUndefinedOrNull());
        switch (this.*) {
            .weak => {},
            .strong => {
                this.strong.deinit();
            },
            .finalized => {
                return;
            },
        }
        this.* = .{ .weak = value };
    }

    pub fn setStrong(this: *@This(), value: jsc.JSValue, globalThis: *jsc.JSGlobalObject) void {
        bun.assert(!value.isEmptyOrUndefinedOrNull());
        if (this.* == .strong) {
            this.strong.set(globalThis, value);
            return;
        }
        this.* = .{ .strong = .create(value, globalThis) };
    }

    pub fn upgrade(this: *@This(), globalThis: *jsc.JSGlobalObject) void {
        switch (this.*) {
            .weak => {
                bun.assert(!this.weak.isEmptyOrUndefinedOrNull());
                this.* = .{ .strong = .create(this.weak, globalThis) };
            },
            .strong => {},
            .finalized => {
                bun.debugAssert(false);
            },
        }
    }

    pub fn downgrade(this: *@This()) void {
        switch (this.*) {
            .weak => {},
            .strong => |*strong| {
                const value = strong.trySwap() orelse .js_undefined;
                value.ensureStillAlive();
                strong.deinit();
                this.* = .{ .weak = value };
            },
            .finalized => {
                bun.debugAssert(false);
            },
        }
    }

    pub fn isEmpty(this: *const @This()) bool {
        return switch (this.*) {
            .weak => this.weak.isEmptyOrUndefinedOrNull(),
            .strong => !this.strong.has(),
            .finalized => true,
        };
    }

    pub fn isNotEmpty(this: *const @This()) bool {
        return switch (this.*) {
            .weak => !this.weak.isEmptyOrUndefinedOrNull(),
            .strong => this.strong.has(),
            .finalized => false,
        };
    }

    /// Test whether this reference is a strong reference.
    pub fn isStrong(this: *const @This()) bool {
        return this.* == .strong;
    }

    pub fn deinit(this: *@This()) void {
        switch (this.*) {
            .weak => {
                this.weak = .js_undefined;
            },
            .strong => {
                this.strong.deinit();
            },
            .finalized => {},
        }
    }

    pub fn finalize(this: *@This()) void {
        this.deinit();
        this.* = .{ .finalized = {} };
    }
};

const bun = @import("bun");

const jsc = bun.jsc;
const JSValue = jsc.JSValue;
