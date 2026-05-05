#![allow(unused, non_snake_case, non_camel_case_types, non_upper_case_globals, clippy::all)]
//! JSC bridge for `bun_semver`. Keeps `src/semver/` free of JSC types.

// ──────────────────────────────────────────────────────────────────────────
// B-2 local JSC stub surface
//
// `bun_jsc` is currently red (concurrent B-2 un-gating in that crate causes
// E0255/E0428 dup-symbol errors), so it is dropped from Cargo.toml and the
// handful of JSC types this crate needs are stubbed locally as opaque
// newtypes — same pattern as `bun_logger_jsc`. Function bodies that touch
// JSC methods remain `#[cfg(any())]`-gated in-place with `// TODO(b2-blocked)`
// markers; signatures compile against these stubs so downstream callers
// type-check.
// ──────────────────────────────────────────────────────────────────────────
pub mod jsc_stub {
    // TODO(b2-blocked): bun_jsc::JSGlobalObject
    #[repr(transparent)]
    pub struct JSGlobalObject(pub usize);
    // TODO(b2-blocked): bun_jsc::JSValue
    #[repr(transparent)]
    #[derive(Clone, Copy, Debug, Default)]
    pub struct JSValue(pub usize);
    // TODO(b2-blocked): bun_jsc::CallFrame
    #[repr(transparent)]
    pub struct CallFrame(pub usize);
    // TODO(b2-blocked): bun_jsc::JSFunction
    #[repr(transparent)]
    pub struct JSFunction(pub usize);
    // TODO(b2-blocked): bun_jsc::JsResult
    pub type JsResult<T> = core::result::Result<T, JSValue>;
}
pub use jsc_stub::JsResult;

#[path = "SemverString_jsc.rs"]
pub mod SemverString_jsc;
#[path = "SemverObject.rs"]
pub mod SemverObject;

pub use SemverString_jsc::SemverStringJsc;
