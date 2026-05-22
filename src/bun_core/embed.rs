// ── runtime_embed_file ────────────────────────────────────────────────────
// Port of `bun.runtimeEmbedFile` (bun.zig:2938). The Zig version comptime-
// captures `sub_path` to manufacture a per-call-site `static once` cache; Rust
// can't do that from a plain fn without leaking, so the canonical port is the
// `runtime_embed_file!` macro below (per-site `OnceLock<String>` — sanctioned
// by PORTING.md §Forbidden, "true process-lifetime singleton"). The fn form is
// kept so existing draft callers type-check; it's only reachable when the
// `codegen_embed` feature is off (debug fast-iteration), where panicking with a
// migration hint is the same UX as the Zig `Output.panic` on read failure.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum EmbedKind {
    Codegen,
    CodegenEager,
    Src,
    SrcEager,
}
/// The original drafts spelled this both ways; alias keeps both compiling.
pub type EmbedDir = EmbedKind;

pub fn runtime_embed_file(_root: EmbedKind, sub_path: &'static str) -> &'static str {
    panic!(
        "runtime_embed_file({sub_path}): non-embedded debug load requires a per-site \
         static cache — migrate this call to `bun_core::runtime_embed_file!` or rebuild \
         with codegen_embed",
    );
}

#[doc(hidden)]
pub fn __runtime_embed_load(kind: EmbedKind, sub: &'static str) -> String {
    // SAFETY: CODEGEN_PATH/BASE_PATH originate from `option_env!` (`&'static str`
    // → bytes), so the bytes are valid UTF-8 by construction.
    let from = |b: &'static [u8]| unsafe { ::core::str::from_utf8_unchecked(b) };
    let mut p = match kind {
        EmbedKind::Codegen | EmbedKind::CodegenEager => {
            ::std::path::PathBuf::from(from(crate::build_options::CODEGEN_PATH))
        }
        EmbedKind::Src | EmbedKind::SrcEager => {
            let mut b = ::std::path::PathBuf::from(from(crate::build_options::BASE_PATH));
            b.push("src");
            b
        }
    };
    p.push(sub);
    ::std::fs::read_to_string(&p).unwrap_or_else(|e| {
        panic!(
            "Failed to load '{}': {e}\n\nTo improve iteration speed, some files are not embedded but loaded at runtime, at the cost of making the binary non-portable. To fix this, build with codegen_embed.",
            p.display(),
        )
    })
}

/// Per-call-site embedded file. `($root, $sub_path)` mirrors the Zig
/// signature; `$root` must be one of the bare idents `Codegen` /
/// `CodegenEager` / `Src` / `SrcEager` and `$sub_path` a string literal.
///
/// The `cfg(bun_codegen_embed)` split lives **inside** the macro so call
/// sites never repeat the `#[cfg]`/`#[cfg(not)]` pair (which is error-prone
/// — a missed pair leaves a release binary that panics with "Failed to load
/// '<build-machine-path>/…'"). Under the cfg, the file is `include_str!`-ed
/// at compile time; otherwise it's read once at runtime into a per-site
/// `OnceLock<String>` for fast iteration.
///
/// `Src` paths are relative to `<repo>/src/`; `Codegen` paths are relative
/// to `BUN_CODEGEN_DIR`. The embed arm resolves both via the *call-site
/// crate's* `CARGO_MANIFEST_DIR` / `BUN_CODEGEN_DIR` (every workspace crate
/// lives at `src/<crate>/`, so `../../src/` is the repo `src/`;
/// `BUN_CODEGEN_DIR` is exported to every rustc by `scripts/build/rust.ts`
/// whenever `bun_codegen_embed` is set).
#[macro_export]
macro_rules! runtime_embed_file {
    (Codegen,      $sub:literal) => { $crate::__runtime_embed_impl!(@codegen $sub) };
    (CodegenEager, $sub:literal) => { $crate::__runtime_embed_impl!(@codegen $sub) };
    (Src,          $sub:literal) => { $crate::__runtime_embed_impl!(@src     $sub) };
    (SrcEager,     $sub:literal) => { $crate::__runtime_embed_impl!(@src     $sub) };
}

#[doc(hidden)]
#[macro_export]
macro_rules! __runtime_embed_impl {
    (@codegen $sub:literal) => {{
        // `bun_codegen_embed` is set via RUSTFLAGS by scripts/build/rust.ts;
        // plain `cargo check` doesn't pass `--check-cfg` for it.
        #[allow(unexpected_cfgs)]
        let __s: &'static str = {
            #[cfg(bun_codegen_embed)]
            { ::core::include_str!(::core::concat!(::core::env!("BUN_CODEGEN_DIR"), "/", $sub)) }
            #[cfg(not(bun_codegen_embed))]
            { $crate::__runtime_embed_impl!(@load $crate::EmbedKind::Codegen, $sub) }
        };
        __s
    }};
    (@src $sub:literal) => {{
        #[allow(unexpected_cfgs)]
        let __s: &'static str = {
            #[cfg(bun_codegen_embed)]
            {
                // Every workspace crate's manifest is at `<repo>/src/<crate>/`,
                // so `../../src/` is `<repo>/src/` regardless of call site.
                ::core::include_str!(::core::concat!(
                    ::core::env!("CARGO_MANIFEST_DIR"), "/../../src/", $sub
                ))
            }
            #[cfg(not(bun_codegen_embed))]
            { $crate::__runtime_embed_impl!(@load $crate::EmbedKind::Src, $sub) }
        };
        __s
    }};
    (@load $kind:expr, $sub:literal) => {{
        static __CELL: $crate::Once<String> = $crate::Once::new();
        __CELL.get_or_init(|| $crate::__runtime_embed_load($kind, $sub)).as_str()
    }};
}
