pub use crate::css_parser as css;
pub use css::Result;
pub use css::Printer;
pub use css::PrintErr;

/// A quoted CSS string.
// TODO(port): arena-owned slice in CSS crate — may need `&'bump [u8]` threading in Phase B.
pub type CssString<'a> = &'a [u8];

pub struct CssStringFns;
impl CssStringFns {
    pub fn parse<'i>(input: &mut css::Parser<'i>) -> Result<CssString<'i>> {
        input.expect_string()
    }

    pub fn to_css(this: &&[u8], dest: &mut Printer) -> core::result::Result<(), PrintErr> {
        let Ok(v) = css::serializer::serialize_string(*this, dest) else {
            return dest.add_fmt_error();
        };
        Ok(v)
    }
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/css/values/css_string.zig (16 lines)
//   confidence: medium
//   todos:      1
//   notes:      CssString lifetime tied to parser arena; Phase B may need explicit 'bump threading.
// ──────────────────────────────────────────────────────────────────────────
