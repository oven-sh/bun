pub use crate::css_parser as css;

pub mod css_modules {
    // Back-compat re-export. Canonical home is `properties::css_modules::Specifier`;
    // all in-tree callers (`values::ident`, `properties::custom`) now reference
    // that path directly. Kept so out-of-tree / gated code that still spells
    // `values::css_modules::Specifier` resolves to the same single type.
    pub use crate::properties::css_modules::Specifier;
}

// Value types form a deep dependency lattice rooted at `calc.rs`:
//   number→calc, angle→{calc,percentage}, alpha→percentage, time→calc,
//   percentage→{calc,length}, length→{calc,percentage},
//   color→{calc,angle,percentage}, gradient→{color,angle,length,position},
//   image→{gradient,url}, ident→properties/css_modules.
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
pub mod easing;
pub mod gradient;
pub mod image;
pub mod length;
pub mod position;
pub mod rect;
pub mod size;
pub mod syntax;
// `color_generated.rs` is the codegen'd named-color tables (47KB). It's a
// sibling module re-exported through `color::*` so the stub-set re-export at
// crate root (`pub use values::color::{CssColor, RGBA, ...}`) keeps resolving.
#[path = "color_generated.rs"]
pub mod color_generated;
pub mod ident;
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
