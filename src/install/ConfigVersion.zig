pub const ConfigVersion = enum {
    v0,
    v1,
    v2,

    /// The configVersion written to lockfiles that don't already have one
    /// (fresh projects, `bun pm migrate`).
    ///
    /// Bumping this is how breaking changes to install defaults are rolled
    /// out: `.v2` enables a 2-day default `minimumReleaseAge` for new
    /// projects. It ships in Bun 1.4; until then `breaking_changes_1_4`
    /// keeps it at `.v1` and the `BUN_FEATURE_FLAG_INSTALL_CONFIG_V2`
    /// environment variable can be used to opt in at runtime for testing.
    pub const current: ConfigVersion = if (bun.FeatureFlags.breaking_changes_1_4) .v2 else .v1;

    /// Highest configVersion this build understands. Lockfiles from a newer
    /// Bun are clamped to this. May be ahead of `current` while a new version
    /// is gated behind `breaking_changes_1_4`.
    pub const max_known: ConfigVersion = .v2;

    pub fn fromExpr(expr: bun.ast.Expr) ?ConfigVersion {
        if (expr.data != .e_number) {
            return null;
        }

        const version = expr.data.e_number.value;
        if (version == 0) {
            return .v0;
        } else if (version == 1) {
            return .v1;
        } else if (version == 2) {
            return .v2;
        }

        if (@trunc(version) != version) {
            return null;
        }

        if (version > @intFromEnum(max_known)) {
            return max_known;
        }

        return null;
    }

    pub fn fromInt(int: u64) ?ConfigVersion {
        return switch (int) {
            0 => .v0,
            1 => .v1,
            2 => .v2,
            else => {
                if (int > @intFromEnum(max_known)) {
                    return max_known;
                }

                return null;
            },
        };
    }
};

const bun = @import("bun");
