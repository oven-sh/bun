//! Dev-server error-page rendering (moved from `bun_js_parser::parser::Runtime` — its only consumer is RequestContext).

use bun_options_types::schema;
use bun_options_types::schema::api;
use core::fmt;
use std::sync::atomic::{AtomicU32, Ordering};

pub struct Fallback;

impl Fallback {
    pub const HTML_TEMPLATE: &'static [u8] = include_bytes!("../../fallback.html");
    pub const HTML_BACKEND_TEMPLATE: &'static [u8] = include_bytes!("../../fallback-backend.html");

    #[inline]
    pub fn error_js() -> &'static [u8] {
        bun_core::runtime_embed_file!(Codegen, "bun-error/index.js").as_bytes()
    }

    #[inline]
    pub fn error_css() -> &'static [u8] {
        bun_core::runtime_embed_file!(Codegen, "bun-error/bun-error.css").as_bytes()
    }

    #[inline]
    pub fn fallback_decoder_js() -> &'static [u8] {
        bun_core::runtime_embed_file!(Codegen, "fallback-decoder.js").as_bytes()
    }

    // Wired via build.rs.
    pub const VERSION_HASH: &'static str = bun_core::build_options::FALLBACK_HTML_VERSION;

    pub fn version_hash() -> u32 {
        static CACHED: AtomicU32 = AtomicU32::new(0);
        let v = CACHED.load(Ordering::Relaxed);
        if v != 0 {
            return v;
        }
        let parsed = u64::from_str_radix(Self::version(), 16).expect("unreachable") as u32; // @truncate
        CACHED.store(parsed, Ordering::Relaxed);
        parsed
    }

    pub fn version() -> &'static str {
        Self::VERSION_HASH
    }

    pub fn render(
        msg: &api::FallbackMessageContainer,
        preload: &[u8],
        entry_point: &[u8],
        writer: &mut impl bun_io::Write,
    ) -> core::result::Result<(), bun_core::Error> {
        // The embedded template uses `{[name]s}`-style named placeholders;
        // substitute by scanning it byte-for-byte.
        let blob = Base64FallbackMessage { msg };
        let fallback = Self::fallback_decoder_js();
        render_named_template(writer, Self::HTML_TEMPLATE, &mut |w, name| match name {
            b"blob" => w.write_fmt(format_args!("{}", blob)),
            b"preload" => w.write_all(preload),
            b"fallback" => w.write_all(fallback),
            b"entry_point" => w.write_all(entry_point),
            _ => Ok(()),
        })
    }

    pub fn render_backend(
        msg: &api::FallbackMessageContainer,
        writer: &mut impl bun_io::Write,
    ) -> core::result::Result<(), bun_core::Error> {
        let blob = Base64FallbackMessage { msg };
        let bun_error_css = Self::error_css();
        let bun_error = Self::error_js();
        let bun_error_page_css: &[u8] = b"";
        let fallback = Self::fallback_decoder_js();
        render_named_template(
            writer,
            Self::HTML_BACKEND_TEMPLATE,
            &mut |w, name| match name {
                b"blob" => w.write_fmt(format_args!("{}", blob)),
                b"bun_error_css" => w.write_all(bun_error_css),
                b"bun_error" => w.write_all(bun_error),
                b"bun_error_page_css" => w.write_all(bun_error_page_css),
                b"fallback" => w.write_all(fallback),
                _ => Ok(()),
            },
        )
    }
}

/// Tiny substitutor for `{[name]s}` / `{[name]f}` named placeholders
/// (the only specifiers used in fallback.html / fallback-backend.html).
fn render_named_template<W: bun_io::Write>(
    writer: &mut W,
    template: &'static [u8],
    subst: &mut dyn FnMut(&mut W, &[u8]) -> core::result::Result<(), bun_core::Error>,
) -> core::result::Result<(), bun_core::Error> {
    let mut i = 0usize;
    let mut last = 0usize;
    let bytes = template;
    while i + 1 < bytes.len() {
        if bytes[i] == b'{' && bytes[i + 1] == b'[' {
            let mut j = i + 2;
            while j < bytes.len() && bytes[j] != b']' {
                j += 1;
            }
            if j + 2 < bytes.len() && bytes[j] == b']' && bytes[j + 2] == b'}' {
                writer.write_all(&bytes[last..i])?;
                let name = &bytes[i + 2..j];
                subst(writer, name)?;
                i = j + 3;
                last = i;
                continue;
            }
        }
        i += 1;
    }
    writer.write_all(&bytes[last..])
}

pub(crate) struct Base64FallbackMessage<'a> {
    pub msg: &'a api::FallbackMessageContainer,
}

impl fmt::Display for Base64FallbackMessage<'_> {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        let mut bb: Vec<u8> = Vec::new();
        let mut encoder = schema::Writer::new(&mut bb);
        self.msg.encode(&mut encoder); // catch {}
        // Standard alphabet, no '=' padding.
        let enc = &bun_base64::zig_base64::STANDARD_NO_PAD.encoder;
        let mut out = vec![0u8; enc.calc_size(bb.len())];
        let s = enc.encode(&mut out, &bb); // catch {}
        // SAFETY: STANDARD_ALPHABET_CHARS is pure ASCII; encoder output contains only those bytes.
        f.write_str(unsafe { core::str::from_utf8_unchecked(s) })
    }
}
