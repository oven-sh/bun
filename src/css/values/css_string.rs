pub use crate::css_parser as css;
pub use css::CssResult as Result;
pub use css::PrintErr;
pub use css::Printer;

/// A quoted CSS string.
///
/// INVARIANT: the pointee is a sub-slice of the parser source buffer / arena
/// and remains valid for the lifetime of the parse + print session (i.e. as
/// long as the originating `ParserInput`/arena lives). Stored as a raw slice
/// pointer rather than `&'static [u8]` so the arena lifetime is not laundered
/// to `'static` (see PORTING.md §Forbidden patterns); Phase B threads an
/// explicit `'bump` lifetime here.
pub type CssString = *const [u8];

pub struct CssStringFns;
impl CssStringFns {
    pub fn parse(input: &mut css::Parser) -> Result<CssString> {
        // No lifetime laundering: capture the arena slice as a raw pointer.
        input.expect_string().map(|s| std::ptr::from_ref::<[u8]>(s))
    }

    pub fn to_css(this: &CssString, dest: &mut Printer) -> core::result::Result<(), PrintErr> {
        // SAFETY: per the `CssString` invariant above, the pointee borrows the
        // parser arena which outlives the `Printer` it is being written to.
        let s = unsafe { crate::arena_str(*this) };
        dest.serialize_string(s)
    }
}

// ported from: src/css/values/css_string.zig
