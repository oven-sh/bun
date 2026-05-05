pub fn Result(comptime T: type, comptime E: type) type {
    return union(enum) {
        ok: T,
        err: E,

        pub inline fn asErr(this: *const @This()) ?E {
            if (this.* == .err) return this.err;
            return null;
        }
    };
}
