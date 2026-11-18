use std::borrow::Cow;

use crate::input::{Encoding, Source};
use crate::record::Record;
use crate::{Punycode, Result, parse};

/// A valid URL for code that has no strings of the engine. It borrows its input if that is how it serializes.
pub type ByteUrl<'a> = Record<Cow<'a, [u8]>>;

impl<'a> ByteUrl<'a> {
    /// What is not well formed in `utf8` stands for U+FFFD.
    pub fn parse(utf8: &'a [u8], base: Option<&ByteUrl<'_>>) -> Result<ByteUrl<'a>> {
        parse::parse(
            Source::new(utf8, Encoding::UncheckedUtf8),
            base,
            Punycode::Unchecked,
            |href| Ok(Cow::Borrowed(href)),
        )
    }

    pub fn into_href(self) -> Cow<'a, [u8]> {
        self.text
    }
}
