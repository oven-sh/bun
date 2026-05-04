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

pub mod angle;
pub mod ident;
pub mod css_string;
pub use self::css_string as string;
pub mod color;
pub mod image;
pub mod number;
pub mod calc;
pub mod percentage;
pub mod length;
pub mod position;
pub mod syntax;
pub mod alpha;
pub mod ratio;
pub mod size;
pub mod rect;
pub mod time;
pub mod easing;
pub mod url;
pub mod resolution;
pub mod gradient;

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/css/values/values.zig (36 lines)
//   confidence: high
//   todos:      1
//   notes:      thin re-export module; Specifier.file slice ownership needs Phase B verification (CSS arena)
// ──────────────────────────────────────────────────────────────────────────
