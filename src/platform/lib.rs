#![allow(unused, non_snake_case, non_camel_case_types, non_upper_case_globals, clippy::all)]
// TODO(b2-blocked): linux.rs/darwin.rs need bun_sys (T1 sibling; gen-cargo's
// same-tier alphabetical rule drops platform→sys). These are OS-specific
// syscall shims (preadv2, RWF_NONBLOCK) — likely belong IN bun_sys directly.
#[cfg(any())] pub mod linux;
#[cfg(any())] pub mod darwin;
