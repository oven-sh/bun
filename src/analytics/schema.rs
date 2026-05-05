// GENERATED: re-run the analytics schema generator (peechy) with .rs output
// source: src/analytics/schema.zig
// TODO(port): regenerate Reader/Writer + remaining analytics::* types for Rust

// Hand-ported subset of `analytics::*` needed by lib.rs (OperatingSystem,
// Architecture, Platform). The full encode/decode machinery and the rest of
// the schema (EventKind, EventListHeader, …) are unused at runtime today and
// will be filled in by the peechy regen.
#[allow(dead_code, non_camel_case_types)]
pub mod analytics {
    /// Zig: `pub const OperatingSystem = enum(u8) { _none, linux, macos, windows, wsl, android, freebsd, _ }`
    // PORT NOTE: Zig's open enum (`_`) is dropped — Rust enums are closed; the
    // schema decoder is the only producer of unknown discriminants and it is
    // not yet ported.
    #[repr(u8)]
    #[derive(Copy, Clone, PartialEq, Eq, Debug)]
    pub enum OperatingSystem {
        _none = 0,
        /// linux
        linux,
        /// macos
        macos,
        /// windows
        windows,
        /// wsl
        wsl,
        /// android
        android,
        /// freebsd
        freebsd,
    }

    /// Zig: `pub const Architecture = enum(u8) { _none, x64, arm, _ }`
    #[repr(u8)]
    #[derive(Copy, Clone, PartialEq, Eq, Debug)]
    pub enum Architecture {
        _none = 0,
        /// x64
        x64,
        /// arm
        arm,
    }

    /// Zig: `pub const Platform = struct { os, arch, version: []const u8 }`
    #[derive(Copy, Clone)]
    pub struct Platform {
        /// os
        pub os: OperatingSystem,
        /// arch
        pub arch: Architecture,
        /// version
        pub version: &'static [u8],
    }
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/analytics/schema.zig (526 lines)
//   confidence: high
//   todos:      1
//   notes:      generated schema file — only the analytics::{OperatingSystem,Architecture,Platform} subset is hand-ported; Reader/Writer and the rest stay stubbed until peechy regen
// ──────────────────────────────────────────────────────────────────────────
