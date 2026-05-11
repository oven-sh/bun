// PORT NOTE: the install crate's JSON layer routes through `bun_ast::js_ast`
// (see `crate::bun_json`), not the full `bun_js_parser` AST. `from_expr` is
// only ever fed nodes from the lockfile JSON parse, so type against that.
use bun_ast::{Expr, ExprData};

#[repr(u8)]
#[derive(Copy, Clone, PartialEq, Eq, Debug)]
pub enum ConfigVersion {
    V0 = 0,
    V1 = 1,
}

impl ConfigVersion {
    pub const CURRENT: ConfigVersion = ConfigVersion::V1;

    pub fn from_expr(expr: &Expr) -> Option<ConfigVersion> {
        let ExprData::ENumber(e_number) = &expr.data else {
            return None;
        };
        let version: f64 = e_number.value;

        if version == 0.0 {
            return Some(ConfigVersion::V0);
        } else if version == 1.0 {
            return Some(ConfigVersion::V1);
        }

        if version.trunc() != version {
            return None;
        }

        if version > (Self::CURRENT as u8) as f64 {
            return Some(Self::CURRENT);
        }

        None
    }

    pub fn from_int(int: u64) -> Option<ConfigVersion> {
        match int {
            0 => Some(ConfigVersion::V0),
            1 => Some(ConfigVersion::V1),
            _ => {
                if int > Self::CURRENT as u64 {
                    return Some(Self::CURRENT);
                }

                None
            }
        }
    }
}

// ported from: src/install/ConfigVersion.zig
