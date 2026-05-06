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
gated_value!(length);
gated_value!(position); // blocked_on: length::LengthPercentage
gated_value!(size);
gated_value!(rect);
gated_value!(easing);
gated_value!(syntax);
gated_value!(gradient);
gated_value!(image);
// color/ident/url: re-export the crate-root data-only stub sets so
// `crate::values::color::{CssColor, RGBA, LAB, ...}` and
// `crate::values::ident::{Ident, DashedIdent, ...}` resolve for printer.rs /
// css_parser.rs. Real impls (3.5kL color.rs colorspace traits + into_hsl/
// into_lab matrix chains; ident.rs IdentOrRef) un-gate with the calc lattice.
gated_value!(color, { pub use crate::values_stub::color::*; });
pub mod ident;
pub mod url;

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/css/values/values.zig (36 lines)
//   confidence: high
//   todos:      1
//   notes:      thin re-export module; Specifier.file slice ownership needs Phase B verification (CSS arena)
// ──────────────────────────────────────────────────────────────────────────
