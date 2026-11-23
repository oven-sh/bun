// Environment.allow_assert and Environment.isMac and !Environment.enable_asan
// (`bun_asan` is set via RUSTFLAGS `--cfg=bun_asan` in scripts/build/rust.ts.)
pub const ENABLED: bool = cfg!(debug_assertions) && cfg!(target_os = "macos") && !cfg!(bun_asan);
