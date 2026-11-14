use crate::css_parser as css;
use css::{CssResult, PrintErr, Printer};

/// A CSS [url()](https://www.w3.org/TR/css-values-4/#urls) value.
#[derive(Clone)]
pub struct Url<'bump> {
    /// The url as written.
    text: &'bump [u8],
    /// The import record of this `url()`.
    pub(crate) import_record_idx: u32,
}

impl<'bump> Url<'bump> {
    pub(crate) fn new(text: &'bump [u8], import_record_idx: u32) -> Url<'bump> {
        Url {
            text,
            import_record_idx,
        }
    }

    pub fn parse(input: &mut css::Parser<'_, 'bump>) -> CssResult<'bump, Url<'bump>> {
        let start_pos = input.position();
        let url = input.expect_url()?;
        let end_pos = input.position();
        let import_record_idx =
            input.add_import_record(url, start_pos, end_pos, bun_ast::ImportKind::Url)?;
        Ok(Url::new(url, import_record_idx))
    }

    pub fn to_css(&self, dest: &mut Printer) -> Result<(), PrintErr> {
        let import_record = dest.import_record(self.import_record_idx)?;
        let is_internal = import_record
            .flags
            .contains(bun_ast::ImportRecordFlags::IS_INTERNAL);
        let (url, is_placeholder) = dest.get_import_record_url(self.import_record_idx)?;

        // The path that replaces a placeholder can hold a space or a parenthesis: keep the quotes.
        if dest.minify && !is_internal && !is_placeholder {
            let mut buf: Vec<u8> = Vec::new();
            // PERF(alloc) we could use stack fallback here?
            use css::WriteAll;
            if buf
                .write_all(b"url(")
                .and_then(|_| css::serializer::serialize_unquoted_url(url, &mut buf))
                .and_then(|_| buf.write_all(b")"))
                .is_err()
            {
                return Err(dest.add_fmt_error());
            }

            // If the unquoted url is longer than it would be quoted (e.g. `url("...")`)
            // then serialize as a string and choose the shorter version.
            if buf.len() > url.len() + 7 {
                let mut buf2: Vec<u8> = Vec::new();
                // PERF(alloc) we could use stack fallback here?
                // `Vec<u8>: WriteAll<Error = Infallible>` — cannot fail.
                let _ = css::serializer::serialize_string(url, &mut buf2);
                if buf2.len() + 5 < buf.len() {
                    dest.write_str("url(")?;
                    dest.write_str(&buf2)?;
                    return dest.write_char(b')');
                }
            }

            dest.write_str(&buf)?;
        } else {
            dest.write_str("url(")?;
            dest.serialize_string(url)?;
            dest.write_char(b')')?;
        }
        Ok(())
    }

    pub(crate) fn deep_clone(&self, _bump: &bun_alloc::Arena) -> Self {
        self.clone()
    }

    /// Each `url()` has its own import record, so the text decides.
    pub fn eql(&self, other: &Url) -> bool {
        self.text == other.text
    }

    pub(crate) fn hash(&self, hasher: &mut bun_wyhash::Wyhash) {
        hasher.update(self.text);
    }
}
