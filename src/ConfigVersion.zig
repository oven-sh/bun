pub const ConfigVersion = enum {
    v0,
    v1,

    pub const current: ConfigVersion = .v1;

    pub fn fromExpr(expr: bun.ast.Expr) ?ConfigVersion {
        if (expr.data != .e_number) {
            return null;
        }

        const version = expr.data.e_number.value;
        if (version == 0) {
            return .v0;
        } else if (version == 1) {
            return .v1;
        }

        if (@trunc(version) != version) {
            return null;
        }

        if (version > @intFromEnum(current)) {
            return current;
        }

        return null;
    }

    pub fn fromInt(int: u64) ?ConfigVersion {
        return switch (int) {
            0 => .v0,
            1 => .v1,
            else => {
                if (int > @intFromEnum(current)) {
                    return current;
                }

                return null;
            },
        };
    }
};

const bun = @import("bun");
