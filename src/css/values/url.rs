use crate::css_parser as css;
use css::{CssResult, PrintErr, Printer};

use bun_collections::BabyList;
use bun_options_types::ImportRecord;
use bun_string::strings;

/// A CSS [url()](https://www.w3.org/TR/css-values-4/#urls) value and its source location.
pub struct Url {
    /// The url string.
    pub import_record_idx: u32,
    /// The location where the `url()` was seen in the CSS source file.
    pub loc: crate::dependencies::Location,
}

impl Url {
     // blocked_on: Parser::add_import_record (BabyList push/len + ImportRecord Default)
    pub fn parse(input: &mut css::Parser) -> CssResult<Url> {
        let start_pos = input.position();
        let loc = input.current_source_location();
        let url = input.expect_url()?;
        // SAFETY: `url` borrows the parser source/arena which outlives the
        // `add_import_record` call. Detach the borrow so `input` is reusable
        // (same trick as `css_parser::src_str` — Token payloads are arena-static).
        let url: &'static [u8] = unsafe { &*(url as *const [u8]) };
        let import_record_idx =
            input.add_import_record(url, start_pos, bun_options_types::ImportKind::Url)?;
        Ok(Url {
            import_record_idx,
            loc: crate::dependencies::Location::from_source_location(loc),
        })
    }

    /// Returns whether the URL is absolute, and not relative.
    pub fn is_absolute(&self, import_records: &BabyList<ImportRecord>) -> bool {
        let url: &[u8] = import_records.at(self.import_record_idx as usize).path.pretty;

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

    // blocked_on: WriteAll for Vec<u8> (or a growable arena writer) so the
    // minify-compare path can serialize into scratch buffers; ImportRecord
    // tag/flags shape (`is_internal` lives on Tag, not Flags); UrlDependency
    // .placeholder deref. The non-minify path is straight-line and could
    // un-gate sooner once `serialize_string` accepts a non-Printer writer.
    
    pub fn to_css(&self, dest: &mut Printer) -> Result<(), PrintErr> {
        use crate::dependencies::UrlDependency;
        let dep: Option<UrlDependency> = if dest.dependencies.is_some() {
            // TODO(port): allocator param — Printer.allocator is arena-backed in CSS crate; verify UrlDependency::new signature in Phase B
            Some(UrlDependency::new(
                dest.allocator,
                self,
                dest.filename(),
                dest.get_import_records()?,
            ))
        } else {
            None
        };

        // If adding dependencies, always write url() with quotes so that the placeholder can
        // be replaced without escaping more easily. Quotes may be removed later during minification.
        if let Some(d) = dep {
            dest.write_str("url(")?;
            // SAFETY: placeholder borrows the printer arena.
            let placeholder = unsafe { &*d.placeholder };
            if css::serializer::serialize_string(placeholder, dest).is_err() {
                return Err(dest.add_fmt_error());
            }
            dest.write_char(b')')?;

            if let Some(dependencies) = &mut dest.dependencies {
                // PORT NOTE: bun.handleOom dropped — Vec::push aborts on OOM via global allocator
                dependencies.push(crate::Dependency::Url(d));
            }

            return Ok(());
        }

        let import_record = dest.import_record(self.import_record_idx)?;
        let is_internal = import_record.tag.is_internal();
        let url = dest.get_import_record_url(self.import_record_idx)?;

        if dest.minify && !is_internal {
            // PERF(port): was std.Io.Writer.Allocating with dest.allocator — using Vec<u8>; profile in Phase B
            let mut buf: Vec<u8> = Vec::new();
            // PERF(alloc) we could use stack fallback here?
            if css::Token::to_css_generic(&css::Token::UnquotedUrl(url), &mut buf).is_err() {
                return Err(dest.add_fmt_error());
            }

            // If the unquoted url is longer than it would be quoted (e.g. `url("...")`)
            // then serialize as a string and choose the shorter version.
            if buf.len() > url.len() + 7 {
                let mut buf2: Vec<u8> = Vec::new();
                // PERF(alloc) we could use stack fallback here?
                if css::serializer::serialize_string(url, &mut buf2).is_err() {
                    return Err(dest.add_fmt_error());
                }
                if buf2.len() + 5 < buf.len() {
                    dest.write_str("url(")?;
                    dest.write_str(&buf2)?;
                    return dest.write_char(b')');
                }
            }

            dest.write_str(&buf)?;
        } else {
            dest.write_str("url(")?;
            if css::serializer::serialize_string(url, dest).is_err() {
                return Err(dest.add_fmt_error());
            }
            dest.write_char(b')')?;
        }
        Ok(())
    }

    pub fn deep_clone(&self, _bump: &bun_alloc::Arena) -> Self {
        // PORT NOTE: Zig `css.implementDeepClone` is field-wise reflection; both
        // fields (`u32`, `dependencies::Location`) are `Copy`, so identity copy.
        Url { import_record_idx: self.import_record_idx, loc: self.loc }
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

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/css/values/url.zig (141 lines)
//   confidence: medium
//   todos:      3
//   notes:      implement_deep_clone/implement_hash are @typeInfo reflection helpers; to_css scratch buffers need a WriteAll Vec impl + ImportRecord tag/flags shape fix; parse is real (expect_url + add_import_record).
// ──────────────────────────────────────────────────────────────────────────
