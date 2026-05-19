// PORT NOTE: the install crate's JSON layer routes through `bun_ast::js_ast`
// (see `crate::bun_json`), not the full `bun_js_parser` AST. `from_expr` is
// only ever fed nodes from the lockfile JSON parse, so type against that.
use bun_ast::{Expr, ExprData};

#[repr(u8)]
#[derive(Copy, Clone, PartialEq, Eq, Debug)]
pub enum ConfigVersion {
    V0 = 0,
    V1 = 1,
    V2 = 2,
}

impl ConfigVersion {
    /// The configVersion written to lockfiles that don't already have one
    /// (fresh projects, `bun pm migrate`).
    ///
    /// Bumping this is how breaking changes to install defaults are rolled
    /// out: `V2` enables a 2-day default `minimumReleaseAge` for new
    /// projects. It ships in Bun 1.4; until then `BREAKING_CHANGES_1_4`
    /// keeps it at `V1` and the `BUN_FEATURE_FLAG_INSTALL_CONFIG_V2`
    /// environment variable can be used to opt in at runtime for testing.
    pub const CURRENT: ConfigVersion = if bun_core::feature_flags::BREAKING_CHANGES_1_4 {
        ConfigVersion::V2
    } else {
        ConfigVersion::V1
    };

    /// Highest configVersion this build understands. Lockfiles from a newer
    /// Bun are clamped to this. May be ahead of `CURRENT` while a new version
    /// is gated behind `BREAKING_CHANGES_1_4`.
    pub const MAX_KNOWN: ConfigVersion = ConfigVersion::V2;

    pub fn from_expr(expr: &Expr) -> Option<ConfigVersion> {
        let ExprData::ENumber(e_number) = &expr.data else {
            return None;
        };
        let version: f64 = e_number.value;

        if version == 0.0 {
            return Some(ConfigVersion::V0);
        } else if version == 1.0 {
            return Some(ConfigVersion::V1);
        } else if version == 2.0 {
            return Some(ConfigVersion::V2);
        }

        if version.trunc() != version {
            return None;
        }

        if version > (Self::MAX_KNOWN as u8) as f64 {
            return Some(Self::MAX_KNOWN);
        }

        None
    }

    pub fn from_int(int: u64) -> Option<ConfigVersion> {
        match int {
            0 => Some(ConfigVersion::V0),
            1 => Some(ConfigVersion::V1),
            2 => Some(ConfigVersion::V2),
            _ => {
                if int > Self::MAX_KNOWN as u64 {
                    return Some(Self::MAX_KNOWN);
                }

                None
            }
        }
    }
}

// ported from: src/install/ConfigVersion.zig
