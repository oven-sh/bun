//! Terminal module build options for ghostty-vt.
//! These are normally set by Zig build.zig but we hardcode them for Bun's integration.

pub const Artifact = enum {
    ghostty,
    lib,
};

/// The target artifact - we're building as a library
pub const artifact: Artifact = .lib;

/// C ABI is not needed for Zig-only usage
pub const c_abi = false;

/// Oniguruma regex support - disabled for minimal build
pub const oniguruma = false;

/// SIMD acceleration - disabled for simpler integration
pub const simd = false;

/// Slow runtime safety checks - disabled in production
pub const slow_runtime_safety = false;

/// Kitty graphics protocol - requires oniguruma
pub const kitty_graphics = false;

/// Tmux control mode - requires oniguruma
pub const tmux_control_mode = false;
