#![warn(unused_must_use)]
//! JSC bridge surface for `bun_install`. Keeps `src/install/` free of
//! `JSValue`/`JSGlobalObject` references.

pub(crate) mod generated_bindgen;
pub(crate) mod hosted_git_info_jsc;
pub(crate) mod ini_jsc;
pub(crate) mod install_binding;
pub(crate) mod npm_jsc;
