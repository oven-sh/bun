const JSRef = union(enum) {
    weak: JSC.JSValue,
    strong: JSC.Strong,

    pub fn initWeak(value: JSC.JSValue) @This() {
        return .{ .weak = value };
    }

    pub fn initStrong(value: JSC.JSValue, globalThis: *JSC.JSGlobalObject) @This() {
        return .{ .strong = JSC.Strong.create(value, globalThis) };
    }

    pub fn empty() @This() {
        return .{ .weak = .zero };
    }

    pub fn get(this: *@This()) JSC.JSValue {
        return switch (this.*) {
            .weak => this.weak,
            .strong => this.strong.get() orelse .zero,
        };
    }
    pub fn setWeak(this: *@This(), value: JSC.JSValue) void {
        if (this == .strong) {
            this.strong.deinit();
        }
        this.* = .{ .weak = value };
    }

    pub fn setStrong(this: *@This(), value: JSC.JSValue, globalThis: *JSC.JSGlobalObject) void {
        if (this == .strong) {
            this.strong.set(globalThis, value);
            return;
        }
        this.* = .{ .strong = JSC.Strong.create(value, globalThis) };
    }

    pub fn upgrade(this: *@This(), globalThis: *JSC.JSGlobalObject) void {
        switch (this.*) {
            .weak => {
                bun.assert(this.weak != .zero);
                this.* = .{ .strong = JSC.Strong.create(this.weak, globalThis) };
            },
            .strong => {},
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
        }
    }
};

const JSC = bun.JSC;
const bun = @import("root").bun;
