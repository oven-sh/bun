/// Embed an asset zstd-compressed and inflate it on first use. Only for bytes
/// Bun never executes or parses itself: the shell completion scripts and the
/// JS/CSS bundles that are shipped to a browser (dev-server client runtime,
/// error overlay/page). Anything that runs inside Bun stays uncompressed.
///
/// The exception is text that only `bun lint`, `bun fmt` and `bun check`
/// read. It may be compressed because it isn't on the path of running a program.
///
/// Release (`bun_codegen_embed`) builds include the `.zst` twin that
/// `scripts/build/codegen.ts` (`emitCompressedEmbeds`) writes to
/// `<codegen>/compressed/<name>.zst`; other builds evaluate `$fallback`.
#[macro_export]
macro_rules! embed_compressed {
    // A codegen output (`<codegen>/$sub`); debug builds read it at runtime.
    (codegen $sub:literal) => {
        $crate::embed_compressed!(
            ("codegen/", $sub),
            ::bun_core::runtime_embed_file!(Codegen, $sub).as_bytes()
        )
    };
    // Same, with a trailing NUL included in the slice (for C-string consumers).
    (codegen_nul $sub:literal) => {{
        #[allow(unexpected_cfgs)]
        let __bytes: &'static [u8] = {
            #[cfg(bun_codegen_embed)]
            {
                static __INFLATED: ::bun_core::Once<::std::boxed::Box<[u8]>> = ::bun_core::Once::new();
                __INFLATED
                    .get_or_init(|| {
                        $crate::inflate_embedded_nul(::core::include_bytes!(::core::concat!(
                            ::core::env!("BUN_CODEGEN_DIR"),
                            "/compressed/codegen/",
                            $sub,
                            ".zst"
                        )))
                    })
            }
            #[cfg(not(bun_codegen_embed))]
            {
                static __COPY: ::std::sync::OnceLock<::std::boxed::Box<[u8]>> = ::std::sync::OnceLock::new();
                &__COPY.get_or_init(|| {
                    let text = ::bun_core::runtime_embed_file!(Codegen, $sub).as_bytes();
                    let mut copy = ::std::vec::Vec::with_capacity(text.len() + 1);
                    copy.extend_from_slice(text);
                    copy.push(0);
                    copy.into_boxed_slice()
                })[..]
            }
        };
        __bytes
    }};
    // A file under `src/`; debug builds read it from the source tree at runtime.
    (src $sub:literal) => {
        $crate::embed_compressed!(("src/", $sub), ::bun_core::runtime_embed_file!(Src, $sub).as_bytes())
    };
    ($name:literal, $fallback:expr) => {
        $crate::embed_compressed!(($name), $fallback)
    };
    (($($name:literal),+), $fallback:expr) => {{
        #[allow(unexpected_cfgs)]
        let __bytes: &'static [u8] = {
            #[cfg(bun_codegen_embed)]
            {
                static __INFLATED: ::bun_core::Once<::std::boxed::Box<[u8]>> = ::bun_core::Once::new();
                __INFLATED
                    .get_or_init(|| {
                        $crate::inflate_embedded(::core::include_bytes!(::core::concat!(
                            ::core::env!("BUN_CODEGEN_DIR"),
                            "/compressed/",
                            $($name,)+
                            ".zst"
                        )))
                    })
            }
            #[cfg(not(bun_codegen_embed))]
            {
                $fallback
            }
        };
        __bytes
    }};
}

/// Cold, shared body of [`embed_compressed!`]'s release arm.
#[cold]
#[inline(never)]
pub fn inflate_embedded(compressed: &'static [u8]) -> Box<[u8]> {
    crate::decompress_alloc(compressed)
        .expect("embedded asset: invalid zstd frame")
        .into_boxed_slice()
}

/// [`inflate_embedded`] plus a trailing NUL byte.
#[cold]
#[inline(never)]
pub fn inflate_embedded_nul(compressed: &'static [u8]) -> Box<[u8]> {
    let mut inflated =
        crate::decompress_alloc(compressed).expect("embedded asset: invalid zstd frame");
    inflated.reserve_exact(1);
    inflated.push(0);
    inflated.into_boxed_slice()
}
