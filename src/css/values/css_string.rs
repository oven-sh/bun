pub use crate::css_parser as css;
pub use css::PrintErr;
pub use css::Printer;

/// A quoted CSS string.
pub type CssString<'bump> = &'bump [u8];

pub struct CssStringFns;
impl CssStringFns {
    pub fn to_css(this: &CssString, dest: &mut Printer) -> core::result::Result<(), PrintErr> {
        dest.serialize_string(this)
    }
}
