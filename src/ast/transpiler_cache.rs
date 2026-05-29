//! `bun.jsc.RuntimeTranspilerCache` (src/jsc/RuntimeTranspilerCache.zig).
//!
//! Single canonical struct, lowered to `bun_ast` so both the parser
//! (`Features.runtime_transpiler_cache`) and the printer
//! (`Options.runtime_transpiler_cache`) can name it without a `bun_js_parser`
//! edge. `bun_bundler::cache` re-exports it and adds disk-I/O / `js_printer`
//! dispatch via an extension trait (those need `bun_js_printer` / `bun_sys`
//! which sit a tier above). The parser writes `input_hash` / `features_hash` /
//! `exports_kind` and calls `get()` through the vtable; the bundler/jsc tier
//! owns `entry` and the on-disk encode/decode (`Metadata` / `Entry` live in
//! `bun_bundler::cache` and are stored here type-erased as `*mut ()`).

use crate::{ExportsKind, Source};
use core::ptr::NonNull;

pub struct RuntimeTranspilerCache {
    pub input_hash: Option<u64>,
    pub input_byte_length: Option<u64>,
    pub features_hash: Option<u64>,
    pub exports_kind: ExportsKind,
    /// Set by `put()` / `get()` when a cache hit returns transpiled output.
    /// Zig: `?bun.String` — bundler/parser only store/read the bytes; T6 owns
    /// the `bun.String` wrapper when surfacing to JS.
    pub output_code: Option<Box<[u8]>>,
    /// Opaque storage for `bun_bundler::cache::RuntimeTranspilerCacheEntry` —
    /// the concrete type lives a tier up and is round-tripped via cast.
    pub entry: Option<*mut ()>,

    /// Dispatch slot — `bun_jsc` sets `Some(TranspilerCacheImplKind::Jsc)` at
    /// init. `None` ⇒ caching disabled (e.g. wasm builds, `--no-transpiler-cache`).
    pub r#impl: Option<TranspilerCacheImplKind>,
}

impl Default for RuntimeTranspilerCache {
    fn default() -> Self {
        Self {
            input_hash: None,
            input_byte_length: None,
            features_hash: None,
            exports_kind: ExportsKind::None,
            output_code: None,
            entry: None,
            r#impl: None,
        }
    }
}

bun_dispatch::link_interface! {
    pub TranspilerCacheImpl[Jsc] {
        fn get(source: &Source, parser_options: NonNull<()>, used_jsx: bool) -> bool;
        fn put(output_code: &[u8], sourcemap: &[u8], esm_record: &[u8]);
        fn is_disabled() -> bool;
    }
}

impl RuntimeTranspilerCache {
    #[inline]
    fn handle(kind: TranspilerCacheImplKind, this: *mut Self) -> TranspilerCacheImpl {
        // SAFETY: `this` is non-null, aligned, and live for the immediate
        // dispatch at every call site (`get`/`put`: `&mut self`-derived with
        // write provenance; `is_disabled`: `&self`-derived, impl ignores
        // `this`). See `link_interface!` `new()` contract.
        unsafe { TranspilerCacheImpl::new(kind, this) }
    }

    #[inline]
    pub fn get(&mut self, source: &Source, parser_options: NonNull<()>, used_jsx: bool) -> bool {
        match self.r#impl {
            Some(k) => Self::handle(k, self).get(source, parser_options, used_jsx),
            None => false,
        }
    }

    #[inline]
    pub fn put(&mut self, output_code: &[u8], sourcemap: &[u8], esm_record: &[u8]) {
        match self.r#impl {
            Some(k) => Self::handle(k, self).put(output_code, sourcemap, esm_record),
            None => {
                if self.input_hash.is_none() {
                    return;
                }
                debug_assert!(self.entry.is_none());
                self.output_code = Some(Box::<[u8]>::from(output_code));
            }
        }
    }

    #[inline]
    pub fn is_disabled(&self) -> bool {
        match self.r#impl {
            Some(k) => Self::handle(k, core::ptr::from_ref(self).cast_mut()).is_disabled(),
            None => true,
        }
    }
}
