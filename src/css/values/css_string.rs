pub use crate::css_parser as css;
pub use css::CssResult as Result;
pub use css::PrintErr;
pub use css::Printer;

pub type CssString = *const [u8];

pub struct CssStringFns;
impl CssStringFns {
    pub fn parse(input: &mut css::Parser) -> Result<CssString> {
        // No lifetime laundering: capture the arena slice as a raw pointer.
        input.expect_string().map(std::ptr::from_ref::<[u8]>)
    }

    pub fn to_css(this: &CssString, dest: &mut Printer) -> core::result::Result<(), PrintErr> {
        // SAFETY: per the `CssString` invariant above, the pointee borrows the
        // parser arena which outlives the `Printer` it is being written to.
        let s = unsafe { crate::arena_str(*this) };
        dest.serialize_string(s)
    }
}

// ported from: src/css/values/css_string.zig
