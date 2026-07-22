use crate::css_parser as css;
use css::{CssResult, PrintErr, Printer};

/// A CSS [url()](https://www.w3.org/TR/css-values-4/#urls) value and its source location.
pub struct Url {
    /// The url string.
    pub(crate) import_record_idx: u32,
}

impl Url {
    pub(crate) fn parse(input: &mut css::Parser) -> CssResult<Url> {
        let start_pos = input.position();
        let url = input.expect_url_cloned()?;
        let import_record_idx =
            input.add_import_record(url, start_pos, bun_ast::ImportKind::Url)?;
        Ok(Url {
            import_record_idx,
        })
    }

    pub(crate) fn to_css(&self, dest: &mut Printer) -> Result<(), PrintErr> {
        let import_record = dest.import_record(self.import_record_idx)?;
        let is_internal = import_record
            .flags
            .contains(bun_ast::ImportRecordFlags::IS_INTERNAL);
        let url = dest.get_import_record_url(self.import_record_idx)?;
        // SAFETY: `url` borrows arena-backed `import_info` data valid for the
        // printer's `'a`; detach so `dest` can be re-borrowed mutably below.
        // Printer arena, not parser source — route to the raw primitive.
        let url: &[u8] = unsafe { bun_collections::detach_lifetime(url) };

        if dest.minify && !is_internal {
            let mut buf: Vec<u8> = Vec::new();
            // PERF(alloc) we could use stack fallback here?
            // `Token::to_css_generic(UnquotedUrl(url))` is inlined here —
            // `Token` payloads are `&'static [u8]` placeholders and we only
            // have `&'a [u8]`.
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
        Url {
            import_record_idx: self.import_record_idx,
        }
    }

    // TODO: dedupe import records??
    // This might not fucking work
    pub(crate) fn eql(&self, other: &Url) -> bool {
        self.import_record_idx == other.import_record_idx
    }

    // TODO: dedupe import records??
    // This might not fucking work
    pub(crate) fn hash(&self, hasher: &mut bun_wyhash::Wyhash) {
        // Only `import_record_idx` participates in identity (matches `eql`
        // above); `loc` is presentation metadata.
        hasher.update(&self.import_record_idx.to_ne_bytes());
    }
}
