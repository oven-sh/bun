pub use crate::css_parser as css;
pub use css::CssResult as Result;
pub use css::PrintErr;
pub use css::Printer;

/// A quoted CSS string.
// TODO(port): arena-owned slice in CSS crate — may need `&'bump [u8]` threading in Phase B.
pub type CssString = &'static [u8];

pub struct CssStringFns;
impl CssStringFns {
    pub fn parse(input: &mut css::Parser) -> Result<CssString> {
        input.expect_string()
    }

    pub fn to_css(this: &&[u8], dest: &mut Printer) -> core::result::Result<(), PrintErr> {
        match css::serializer::serialize_string(*this, dest) {
            Ok(v) => Ok(v),
            Err(_) => Err(dest.add_fmt_error()),
        }
    }
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/css/values/css_string.zig (16 lines)
//   confidence: medium
//   todos:      1
//   notes:      CssString lifetime tied to parser arena; Phase B may need explicit 'bump threading.
// ──────────────────────────────────────────────────────────────────────────
