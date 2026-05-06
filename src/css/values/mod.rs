pub use crate::css_parser as css;

pub mod css_modules {
    /// Defines where the class names referenced in the `composes` property are located.
    ///
    /// See [Composes](Composes).
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
gated_value!(number);
gated_value!(angle);
gated_value!(css_string);
pub use self::css_string as string;
gated_value!(alpha);
gated_value!(ratio);
gated_value!(resolution);
gated_value!(time);
gated_value!(calc);
gated_value!(percentage);
gated_value!(length);
gated_value!(position);
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
gated_value!(ident, { pub use crate::values_stub::ident::*; });
gated_value!(url,   { pub use crate::values_stub::url::*; });

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/css/values/values.zig (36 lines)
//   confidence: high
//   todos:      1
//   notes:      thin re-export module; Specifier.file slice ownership needs Phase B verification (CSS arena)
// ──────────────────────────────────────────────────────────────────────────
