pub const JSRef = union(enum) {
    weak: jsc.JSValue,
    strong: jsc.Strong.Optional,
    finalized: void,

    pub fn initWeak(value: jsc.JSValue) @This() {
        return .{ .weak = value };
    }

    pub fn initStrong(value: jsc.JSValue, globalThis: *jsc.JSGlobalObject) @This() {
        return .{ .strong = .create(value, globalThis) };
    }

    pub fn empty() @This() {
        return .{ .weak = .zero };
    }

    pub fn get(this: *@This()) jsc.JSValue {
        return switch (this.*) {
            .weak => this.weak,
            .strong => this.strong.get() orelse .zero,
            .finalized => .zero,
        };
    }

    pub fn tryGet(this: *@This()) ?jsc.JSValue {
        return switch (this.*) {
            .weak => if (this.weak != .zero) this.weak else null,
            .strong => this.strong.get(),
            .finalized => null,
        };
    }
    pub fn setWeak(this: *@This(), value: jsc.JSValue) void {
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
        if (this.* == .strong) {
            this.strong.set(globalThis, value);
            return;
        }
        this.* = .{ .strong = .create(value, globalThis) };
    }

    pub fn upgrade(this: *@This(), globalThis: *jsc.JSGlobalObject) void {
        switch (this.*) {
            .weak => {
                bun.assert(this.weak != .zero);
                this.* = .{ .strong = .create(this.weak, globalThis) };
            },
            .strong => {},
            .finalized => {
                bun.debugAssert(false);
            },
        }
    }

    pub fn deinit(this: *@This()) void {
        switch (this.*) {
            .weak => {
                this.weak = .zero;
            },
            .strong => {
                this.strong.deinit();
            },
            .finalized => {},
        }
    }
};

const bun = @import("bun");

const jsc = bun.jsc;
const JSValue = jsc.JSValue;
