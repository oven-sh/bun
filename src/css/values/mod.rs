pub use crate::css_parser as css;

pub mod css_modules {
    /// Defines where the class names referenced in the `composes` property are located.
    ///
    /// See [Composes](Composes).
    #[derive(Debug, Clone, Copy)]
    pub enum Specifier {
        /// The referenced name is global.
        Global,
        /// The referenced name comes from the specified file.
        // TODO(port): arena-owned slice in CSS crate — verify lifetime/ownership in Phase B
        File(*const [u8]),
        /// The referenced name comes from a source index (used during bundling).
        SourceIndex(u32),
    }
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
macro_rules! gated_value {
    ($name:ident) => {
        #[cfg(any())] pub mod $name;
        #[cfg(not(any()))] pub mod $name {}
    };
    ($name:ident, { $($body:tt)* }) => {
        #[cfg(any())] pub mod $name;
        #[cfg(not(any()))] pub mod $name { $($body)* }
    };
}
// ─── B-2 round 3: calc lattice leaves un-gated ───────────────────────────
// number/angle/time/percentage/css_string + calc are now real. calc.rs
// internally `#[cfg(any())]`-gates its Length/DimensionPercentage<LengthValue>
// CalcValue impls until length.rs un-gates; percentage.rs likewise gates the
// generic-D `DimensionPercentage<D>` method block on the missing
// Zero/MulF32/TryAdd protocol traits.
// ─── B-2 round 4: scalar leaves + ident/url un-gated ─────────────────────
// alpha/ratio/resolution are real. ident.rs is real (Ident/DashedIdent/
// CustomIdent parse + IdentOrRef packing); to_css/deep_clone stay gated on
// Printer::write_ident/write_dashed_ident. url.rs is real (struct +
// is_absolute); parse/to_css gated on Parser::add_import_record + WriteAll
// for Vec<u8>. position.rs stays gated on length::LengthPercentage.
pub mod number;
pub mod angle;
pub mod css_string;
pub use self::css_string as string;
pub mod alpha;
pub mod ratio;
pub mod resolution;
pub mod time;
pub mod calc;
pub mod percentage;
// ─── B-2 round 5: remaining lattice leaves un-gated ──────────────────────
// length/position/size/rect/easing/syntax now compile for real (parse + to_css
// + protocol-trait impls). `DimensionPercentage<D>` method block is real;
// `Calc<V>` CalcValue impls for Length / DimensionPercentage<LengthValue|Angle>
// are real. The `protocol` submodule below supplies the numeric protocol
// traits (`Zero`/`MulF32`/`TryAdd`/`Parse`) that `crate::generics` only
// defines inside its still-gated `parse_tocss_numeric_gated` block.
//
// gradient/image/color stay gated_value! — they are NOT calc-lattice leaves
// but cross-module hubs:
//   gradient.rs  blocked_on: `Parser<'bump,'_>` two-lifetime arity (current
//                Parser<'a> has one), `values::color::CssColor` real impl,
//                BumpVec<'bump,_> arena threading, AnglePercentage to_css.
//   image.rs     blocked_on: `#[derive(css::Parse, css::ToCss)]` proc-macro
//                (does not exist yet), gradient un-gate, `ColorFallbackKind`,
//                `prefixes::Feature::is_webkit_gradient`, `add_import_record`.
//   color.rs     blocked_on: `color_generated::generated_color_conversions`
//                (codegen stub is empty — color_via.ts needs Rust output),
//                `generics::CssHash for <colorspace>`, `bun_wyhash::Wyhash`
//                concrete type. The `values_stub::color` set is kept as the
//                public surface so `crate::CssColor` / `RGBA` / colorspace
//                structs resolve unchanged for printer/parser callers.
pub mod length;
pub mod position;
pub mod size;
pub mod rect;
pub mod easing;
pub mod syntax;
// ─── B-2 round 6: cross-module hubs un-gated ─────────────────────────────
// color/gradient/image now compile as real `pub mod`s. `color.rs` exposes
// the full data-type surface (CssColor / RGBA / colorspaces / LABColor /
// PredefinedColor / FloatColor / ColorFallbackKind) with real `is_compatible`
// / `eql` / `deep_clone`; the heavy parse/to_css/conversion bodies stay
// inside `color::gated_full_impl` (`#[cfg(any())]`) until
// `color_generated.rs` (color_via.ts → Rust) lands. `gradient.rs` types are
// real (Gradient / Linear/Radial/Conic / WebKitGradient / GradientItem /
// ColorStop / LineDirection / EndingShape / ShapeExtent); parse paths that
// need the not-yet-threaded `'bump` arena lifetime on `Parser` are
// internally gated. `image.rs` types are real (Image / ImageSet /
// ImageSetOption); `Image::parse`/`to_css` await the DeriveParse/DeriveToCss
// proc-macro.
pub mod color;
// reconciler-3: gradient/image still reference `bun_str`/`ColorFallbackKind`/
// `'bump`-DeepClone/`#[derive(css::Parse)]` that aren't on this track yet.
gated_value!(gradient);
gated_value!(image);
// `gated_value!` retained for any future leaf that re-gates during a bisect.
#[allow(unused_macros)]
macro_rules! _gated_value_retired { () => {}; }
// `color_generated.rs` is the codegen'd named-color tables (47KB). Its parent
// in Zig was `color.zig`'s `pub usingnamespace`; here it's a sibling module
// re-exported through `color::*` so the stub-set re-export at crate root
// (`pub use values::color::{CssColor, RGBA, ...}`) keeps resolving.
#[path = "color_generated.rs"]
pub mod color_generated;
pub mod ident;
pub mod url;

/// Numeric protocol traits referenced by `DimensionPercentage<D>` and the
/// `CalcValue for DimensionPercentage<D>` impls. These mirror the shapes in
/// `crate::generics::parse_tocss_numeric_gated` (still `#[cfg(any())]`-gated);
/// once that block un-gates these become `pub use crate::generics::{...}`.
pub mod protocol {
    use crate::css_parser as css;
    use crate::values::angle::Angle;

    /// `D::zero()` / `d.is_zero()` — additive identity.
    pub trait Zero: Sized {
        fn zero() -> Self;
        fn is_zero(&self) -> bool;
    }
    /// `d.mul_f32(rhs)` — scalar multiplication.
    pub trait MulF32: Sized {
        fn mul_f32(self, rhs: f32) -> Self;
    }
    /// `d.try_add(&rhs)` — same-unit addition, `None` if incompatible.
    pub trait TryAdd: Sized {
        fn try_add(&self, rhs: &Self) -> Option<Self>;
    }
    /// `D::try_from_angle(a)` — convert an angle into `D`, if representable.
    pub trait TryFromAngle: Sized {
        fn try_from_angle(angle: Angle) -> Option<Self>;
    }
    /// Minimal `Parse` shape so `DimensionPercentage<D>::parse` can bound `D`.
    /// Intentionally lifetime-free: the value-type parsers all take
    /// `&mut Parser` (Phase-A `'static`-slice placeholder) and return owned
    /// values. Phase B threads `'bump` and this aliases `generics::Parse`.
    pub trait Parse: Sized {
        fn parse(input: &mut css::Parser) -> css::CssResult<Self>;
    }

    // Re-export the un-gated shapes from `crate::generics` so
    // `crate::values::protocol::*` is a one-stop bound set.
    pub use crate::generics::{IsCompatible, PartialCmp, ToCss, TryMap, TryOp, TryOpTo, TrySign};
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/css/values/values.zig (36 lines)
//   confidence: high
//   todos:      1
//   notes:      thin re-export module; Specifier.file slice ownership needs Phase B verification (CSS arena)
// ──────────────────────────────────────────────────────────────────────────
