use crate::css_parser as css;
use css::{CssResult, PrintErr, Printer};

use bun_ast::ImportRecord;
use bun_collections::VecExt;
use bun_core::strings;

/// A CSS [url()](https://www.w3.org/TR/css-values-4/#urls) value and its source location.
pub struct Url {
    /// The url string.
    pub import_record_idx: u32,
    /// The location where the `url()` was seen in the CSS source file.
    pub loc: crate::dependencies::Location,
}

impl Url {
    pub fn parse(input: &mut css::Parser) -> CssResult<Url> {
        let start_pos = input.position();
        let loc = input.current_source_location();
        let url = input.expect_url_cloned()?;
        let import_record_idx =
            input.add_import_record(url, start_pos, bun_ast::ImportKind::Url)?;
        Ok(Url {
            import_record_idx,
            loc: crate::dependencies::Location::from_source_location(loc),
        })
    }

    /// Returns whether the URL is absolute, and not relative.
    pub fn is_absolute(&self, import_records: &Vec<ImportRecord>) -> bool {
        let url: &[u8] = import_records
            .at(self.import_record_idx as usize)
            .path
            .pretty;

        // Quick checks. If the url starts with '.', it is relative.
        if strings::starts_with_char(url, b'.') {
            return false;
        }

        // If the url starts with '/' it is absolute.
        if strings::starts_with_char(url, b'/') {
            return true;
        }

        // If the url starts with '#' we have a fragment URL.
        // These are resolved relative to the document rather than the CSS file.
        // https://drafts.csswg.org/css-values-4/#local-urls
        if strings::starts_with_char(url, b'#') {
            return true;
        }

        // Otherwise, we might have a scheme. These must start with an ascii alpha character.
        // https://url.spec.whatwg.org/#scheme-start-state
        if url.is_empty() || !url[0].is_ascii_alphabetic() {
            return false;
        }

        // https://url.spec.whatwg.org/#scheme-state
        for &c in url {
            match c {
                b'a'..=b'z' | b'A'..=b'Z' | b'0'..=b'9' | b'+' | b'-' | b'.' => {}
                b':' => return true,
                _ => break,
            }
        }

        false
    }

    pub fn to_css(&self, dest: &mut Printer) -> Result<(), PrintErr> {
        use crate::dependencies::UrlDependency;
        let dep: Option<UrlDependency> = if dest.dependencies.is_some() {
            // PORT NOTE: hoist `get_import_records` (mut borrow) out of the arg
            // list so `filename()` (shared borrow) can run; result is `&'a _`.
            let import_records = dest.get_import_records()?;
            Some(UrlDependency::new(
                dest.arena,
                self,
                dest.filename(),
                import_records,
            ))
        } else {
            None
        };

        // If adding dependencies, always write url() with quotes so that the placeholder can
        // be replaced without escaping more easily. Quotes may be removed later during minification.
        if let Some(d) = dep {
            dest.write_str("url(")?;
            // SAFETY: placeholder borrows the printer arena.
            let placeholder = unsafe { crate::arena_str(d.placeholder) };
            dest.serialize_string(placeholder)?;
            dest.write_char(b')')?;

            if let Some(dependencies) = &mut dest.dependencies {
                // PORT NOTE: bun.handleOom dropped — Vec::push aborts on OOM via global arena
                dependencies.push(crate::Dependency::Url(d));
            }

            return Ok(());
        }

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
            // PERF(port): was std.Io.Writer.Allocating with dest.arena — using Vec<u8>; profile in Phase B
            let mut buf: Vec<u8> = Vec::new();
            // PERF(alloc) we could use stack fallback here?
            // PORT NOTE: inlined `Token::to_css_generic(UnquotedUrl(url))` —
            // `Token` payloads are `&'static [u8]` placeholders in Phase A and
            // we only have `&'a [u8]` here.
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

    pub fn deep_clone(&self, _bump: &bun_alloc::Arena) -> Self {
        // PORT NOTE: Zig `css.implementDeepClone` is field-wise reflection; both
        // fields (`u32`, `dependencies::Location`) are `Copy`, so identity copy.
        Url {
            import_record_idx: self.import_record_idx,
            loc: self.loc,
        }
    }

    // TODO: dedupe import records??
    // This might not fucking work
    pub fn eql(&self, other: &Url) -> bool {
        self.import_record_idx == other.import_record_idx
    }

    // TODO: dedupe import records??
    // This might not fucking work
    pub fn hash(&self, hasher: &mut bun_wyhash::Wyhash) {
        // PORT NOTE: Zig `css.implementHash` is field-wise reflection. Only
        // `import_record_idx` participates in identity (matches `eql` above);
        // `loc` is presentation metadata.
        hasher.update(&self.import_record_idx.to_ne_bytes());
    }
}

// ported from: src/css/values/url.zig
