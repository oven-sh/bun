pub const AuthenticationState = union(enum) {
    pending: void,
    none: void,
    ok: void,
    SASL: SASL,
    md5: void,

    pub fn zero(this: *AuthenticationState) void {
        switch (this.*) {
            .SASL => |*sasl| {
                sasl.deinit();
            },
            else => {},
        }
        this.* = .{ .none = {} };
    }
};

const SASL = @import("./SASL.zig");
