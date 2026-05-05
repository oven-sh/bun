#![allow(unused, non_snake_case, non_camel_case_types, non_upper_case_globals, clippy::all)]
// AUTOGEN: mod declarations only — real exports added in B-1.

pub mod NodeLinker;

// ──────────────────────────────────────────────────────────────────────────
// B-1 GATE: Phase-A drafts of ExternalString / SlicedString / SemverString
// duplicate the canonical defs now living in `bun_semver`. They reference
// lower-tier symbols not yet on stub surfaces (bun_collections::IdentityContext,
// bun_core::fmt, bun_str::strings, bun_wyhash::hash, Lockfile). Gate the draft
// bodies and re-export the bun_semver versions as the minimal public surface.
// Un-gating + reconciliation in B-2.
// ──────────────────────────────────────────────────────────────────────────

#[cfg(any())]
pub mod ExternalString;
#[cfg(not(any()))]
pub mod ExternalString {
    pub use bun_semver::ExternalString;
}

#[cfg(any())]
pub mod SlicedString;
#[cfg(not(any()))]
pub mod SlicedString {
    pub use bun_semver::SlicedString;
}

#[cfg(any())]
pub mod SemverString;
#[cfg(not(any()))]
pub mod SemverString {
    // Re-export the full bun_semver string module surface (String, Formatter,
    // Pointer, Builder, etc.) so downstream `install_types::SemverString::*`
    // paths resolve.
    pub use bun_semver::string::*;
    pub use bun_semver::String;
}
