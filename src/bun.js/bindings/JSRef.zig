pub const JSRef = union(enum) {
    weak: JSC.JSValue,
    strong: JSC.Strong.Optional,
    finalized: void,

    pub fn initWeak(value: JSC.JSValue) @This() {
        return .{ .weak = value };
    }

    pub fn initStrong(value: JSC.JSValue, globalThis: *JSC.JSGlobalObject) @This() {
        return .{ .strong = .create(value, globalThis) };
    }

    pub fn empty() @This() {
        return .{ .weak = .zero };
    }

    pub fn get(this: *@This()) JSC.JSValue {
        return switch (this.*) {
            .weak => this.weak,
            .strong => this.strong.get() orelse .zero,
            .finalized => .zero,
        };
    }

    pub fn tryGet(this: *@This()) ?JSC.JSValue {
        return switch (this.*) {
            .weak => if (this.weak != .zero) this.weak else null,
            .strong => this.strong.get(),
            .finalized => null,
        };
    }
    pub fn setWeak(this: *@This(), value: JSC.JSValue) void {
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

    pub fn setStrong(this: *@This(), value: JSC.JSValue, globalThis: *JSC.JSGlobalObject) void {
        if (this.* == .strong) {
            this.strong.set(globalThis, value);
            return;
        }
        this.* = .{ .strong = .create(value, globalThis) };
    }

    pub fn upgrade(this: *@This(), globalThis: *JSC.JSGlobalObject) void {
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

const JSC = bun.JSC;
const JSValue = JSC.JSValue;
const bun = @import("bun");
