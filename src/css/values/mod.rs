pub use crate::css_parser as css;

pub mod css_modules {
    // Back-compat re-export. Canonical home is `properties::css_modules::Specifier`;
    // all in-tree callers (`values::ident`, `properties::custom`) now reference
    // that path directly. Kept so out-of-tree / gated code that still spells
    // `values::css_modules::Specifier` resolves to the same single type.
    pub use crate::properties::css_modules::Specifier;
}

// ─── B-2 round 2 status ───────────────────────────────────────────────────
// Value types form a deep dependency lattice rooted at `calc.rs`:
//   number→calc, angle→{calc,percentage}, alpha→percentage, time→calc,
//   percentage→{calc,length}, length→{calc,percentage},
//   color→{calc,angle,percentage}, gradient→{color,angle,length,position},
//   image→{gradient,url}, ident→properties/css_modules.
// Every leaf transitively reaches `calc` (or properties/), and `calc` itself
// uses `css::Result`-as-tagged-enum semantics that diverge from the now-real
// `css_parser::CssResult<T>` alias. Un-gating the lattice is a follow-up
// round (rewrite calc's `.as_value()/.result()` callsites first); for this
// round the value modules stay gated and re-export the crate-root data-only
// stubs so `crate::values::{color,ident,url}::*` resolve for printer/parser.
// (round 6: all callers removed — every `values/*.rs` is now `pub mod`.)
// ─── B-2 round 3: calc lattice leaves un-gated ───────────────────────────
// number/angle/time/percentage/css_string + calc are now real. calc.rs
// internally ``-gates its Length/DimensionPercentage<LengthValue>
// CalcValue impls until length.rs un-gates; percentage.rs likewise gates the
// generic-D `DimensionPercentage<D>` method block on the missing
// Zero/MulF32/TryAdd protocol traits.
// ─── B-2 round 4: scalar leaves + ident/url un-gated ─────────────────────
// alpha/ratio/resolution are real. ident.rs is real (Ident/DashedIdent/
// CustomIdent parse + IdentOrRef packing + DashedIdentReference::
// parse_with_options); DashedIdentReference::to_css stays gated on
// CssModule::reference_dashed. url.rs is real (struct +
// is_absolute); parse/to_css gated on Parser::add_import_record + WriteAll
// for Vec<u8>. position.rs stays gated on length::LengthPercentage.
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
// ─── B-2 round 5: remaining lattice leaves un-gated ──────────────────────
// length/position/size/rect/easing/syntax now compile for real (parse + to_css
// + protocol-trait impls). `DimensionPercentage<D>` method block is real;
// `Calc<V>` CalcValue impls for Length / DimensionPercentage<LengthValue|Angle>
// are real. The `protocol` submodule below supplies the numeric protocol
// traits (`Zero`/`MulF32`/`TryAdd`/`Parse`) that `crate::generics` only
// defines inside its still-gated `parse_tocss_numeric_gated` block.
pub mod easing;
pub mod length;
pub mod position;
pub mod rect;
pub mod size;
pub mod syntax;
// ─── B-2 round 6: cross-module hubs un-gated ─────────────────────────────
// color/gradient/image now compile as real `pub mod`s. `color.rs` exposes
// the full data-type surface (CssColor / RGBA / colorspaces / LABColor /
// PredefinedColor / FloatColor / ColorFallbackKind) with real `is_compatible`
// / `eql` / `deep_clone`; the heavy parse/to_css/conversion bodies stay
// inside `color::gated_full_impl` (``) until
// `color_generated.rs` (color_via.ts → Rust) lands. `gradient.rs` types are
// real (Gradient / Linear/Radial/Conic / WebKitGradient / GradientItem /
// ColorStop / LineDirection / EndingShape / ShapeExtent); parse paths that
// need the not-yet-threaded `'bump` arena lifetime on `Parser` are
// internally gated. `image.rs` types are real (Image / ImageSet /
// ImageSetOption); `Image::parse`/`to_css` await the DeriveParse/DeriveToCss
// proc-macro.
pub mod color;
pub mod gradient;
pub mod image;
// `color_generated.rs` is the codegen'd named-color tables (47KB). Its parent
// in Zig was `color.zig`'s `pub usingnamespace`; here it's a sibling module
// re-exported through `color::*` so the stub-set re-export at crate root
// (`pub use values::color::{CssColor, RGBA, ...}`) keeps resolving.
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

// ported from: src/css/values/values.zig
