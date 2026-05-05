#![allow(unused, non_snake_case, non_camel_case_types, non_upper_case_globals, clippy::all)]
// AUTOGEN: mod declarations only — real exports added in B-1.

// TODO(b1): both modules depend on `bun_jsc` (broken dep, see Cargo.toml) and
// `bun_str` (crate is named `bun_string`). Phase-A draft bodies are preserved
// on disk and gated here; un-gate in B-2 once bun_jsc compiles.
#[cfg(any())]
pub mod SemverString_jsc;
#[cfg(any())]
pub mod SemverObject;

// ── minimal stub surface ──────────────────────────────────────────────────
#[cfg(not(any()))]
pub mod SemverString_jsc {
    /// Stub: real impl gated until `bun_jsc` is green.
    pub trait SemverStringJsc {}
}

#[cfg(not(any()))]
pub mod SemverObject {
    /// Stub: real impl gated until `bun_jsc` is green.
    pub fn create(_global: &()) -> () {
        todo!("bun_semver_jsc::SemverObject::create — gated on bun_jsc")
    }
    pub fn order() -> () {
        todo!("bun_semver_jsc::SemverObject::order — gated on bun_jsc")
    }
    pub fn satisfies() -> () {
        todo!("bun_semver_jsc::SemverObject::satisfies — gated on bun_jsc")
    }
}
