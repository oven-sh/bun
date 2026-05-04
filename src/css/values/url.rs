use crate::css_parser as css;
use css::Printer;
use css::PrintErr;
use css::dependencies::UrlDependency;

use bun_collections::BabyList;
use bun_options_types::ImportRecord;
use bun_str::strings;

/// A CSS [url()](https://www.w3.org/TR/css-values-4/#urls) value and its source location.
pub struct Url {
    /// The url string.
    pub import_record_idx: u32,
    /// The location where the `url()` was seen in the CSS source file.
    pub loc: css::dependencies::Location,
}

impl Url {
    pub fn parse(input: &mut css::Parser) -> css::Result<Url> {
        let start_pos = input.position();
        let loc = input.current_source_location();
        let url = input.expect_url()?;
        let import_record_idx = input.add_import_record(url, start_pos, bun_options_types::ImportKind::Url)?;
        Ok(Url {
            import_record_idx,
            loc: css::dependencies::Location::from_source_location(loc),
        })
    }

    /// Returns whether the URL is absolute, and not relative.
    pub fn is_absolute(&self, import_records: &BabyList<ImportRecord>) -> bool {
        let url: &[u8] = import_records.at(self.import_record_idx).path.pretty;

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
            let Ok(()) = css::serializer::serialize_string(d.placeholder, dest) else {
                return dest.add_fmt_error();
            };
            dest.write_char(')')?;

            if let Some(dependencies) = &mut dest.dependencies {
                // PORT NOTE: bun.handleOom dropped — Vec::push aborts on OOM via global allocator
                dependencies.push(css::Dependency::Url(d));
            }

            return Ok(());
        }

        let import_record = dest.import_record(self.import_record_idx)?;
        let url = dest.get_import_record_url(self.import_record_idx)?;

        if dest.minify && !import_record.flags.is_internal {
            // PERF(port): was std.Io.Writer.Allocating with dest.allocator — using Vec<u8>; profile in Phase B
            let mut buf: Vec<u8> = Vec::new();
            // PERF(alloc) we could use stack fallback here?
            let Ok(()) = css::Token::to_css_generic(&css::Token::UnquotedUrl(url), &mut buf) else {
                return dest.add_fmt_error();
            };

            // If the unquoted url is longer than it would be quoted (e.g. `url("...")`)
            // then serialize as a string and choose the shorter version.
            if buf.len() > url.len() + 7 {
                let mut buf2: Vec<u8> = Vec::new();
                // PERF(alloc) we could use stack fallback here?
                let Ok(()) = css::serializer::serialize_string(url, &mut buf2) else {
                    return dest.add_fmt_error();
                };
                if buf2.len() + 5 < buf.len() {
                    dest.write_str("url(")?;
                    dest.write_str(&buf2)?;
                    return dest.write_char(')');
                }
            }

            dest.write_str(&buf)?;
        } else {
            dest.write_str("url(")?;
            let Ok(()) = css::serializer::serialize_string(url, dest) else {
                return dest.add_fmt_error();
            };
            dest.write_char(')')?;
        }
        Ok(())
    }

    pub fn deep_clone(&self, allocator: &dyn bun_alloc::Allocator) -> Self {
        // TODO(port): css::implement_deep_clone is reflection-based in Zig (@typeInfo); Phase B should derive or hand-impl
        css::implement_deep_clone(self, allocator)
    }

    // TODO: dedupe import records??
    // This might not fucking work
    pub fn eql(&self, other: &Url) -> bool {
        self.import_record_idx == other.import_record_idx
    }

    // TODO: dedupe import records??
    // This might not fucking work
    pub fn hash(&self, hasher: &mut bun_wyhash::Wyhash) {
        // TODO(port): css::implement_hash is reflection-based in Zig (@typeInfo); Phase B should derive or hand-impl
        css::implement_hash(self, hasher)
    }
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/css/values/url.zig (141 lines)
//   confidence: medium
//   todos:      3
//   notes:      implement_deep_clone/implement_hash are @typeInfo reflection helpers; to_css scratch buffers swapped to Vec<u8>; borrowck may need reshaping around dest.dependencies/import_record
// ──────────────────────────────────────────────────────────────────────────
