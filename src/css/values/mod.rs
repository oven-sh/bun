pub use crate::css_parser as css;

pub mod css_modules {
    pub use crate::properties::css_modules::Specifier;
}

pub mod angle;
pub mod css_string;
pub mod number;
pub use self::css_string as string;
pub mod alpha;
pub mod calc;
pub mod percentage;
pub mod ratio;
pub mod resolution;
pub mod time;
// The `protocol` submodule below supplies the numeric protocol traits
// (`Zero`/`MulF32`/`TryAdd`/`Parse`) used by `Calc<V>` / `DimensionPercentage<D>`.
pub mod color;
#[path = "color_generated.rs"]
pub mod color_generated;
pub mod easing;
pub mod gradient;
pub mod ident;
pub mod image;
pub mod length;
pub mod position;
pub mod rect;
pub mod size;
pub mod syntax;
pub mod url;

/// Numeric protocol traits referenced by `DimensionPercentage<D>` and the
/// `CalcValue` supertrait set. Pure re-export of `crate::generics`; kept as a
/// module so `values::protocol::*` stays a one-stop bound set for `values/*.rs`.
pub mod protocol {
    pub use crate::generics::{
        IsCompatible, MulF32, Parse, ParseWithOptions, PartialCmp, ToCss, TryAdd, TryFromAngle,
        TryMap, TryOp, TryOpTo, TrySign, Zero,
    };
}

// ported from: src/css/values/values.zig
