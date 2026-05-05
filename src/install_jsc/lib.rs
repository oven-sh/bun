#![allow(unused, non_snake_case, non_camel_case_types, non_upper_case_globals, clippy::all)]
// AUTOGEN: mod declarations only — real exports added in B-1.

// TODO(b1): all modules gated — depend on bun_jsc / bun_str / bun_paths / bun_dotenv /
// bun_str_jsc / bun_logger_jsc crates that are not yet linked, plus missing stub surface
// from bun_install (package_manager::update_request, hosted_git_info, dependency::version,
// dependency::tarball, npm::{OperatingSystem,Libc,Architecture,registry,package_manifest},
// lockfile::{LoadResult,JsonWhitespace}, Subcommand) and bun_ini::config_iterator.
// Un-gate in B-2 once lower-tier crates expose these symbols.

#[cfg(any())]
pub mod update_request_jsc;
#[cfg(not(any()))]
pub mod update_request_jsc {
    // TODO(b1): stub — original at ./update_request_jsc.rs
}

#[cfg(any())]
pub mod install_binding;
#[cfg(not(any()))]
pub mod install_binding {
    // TODO(b1): stub — original at ./install_binding.rs
    pub mod bun_install_js_bindings {}
}

#[cfg(any())]
pub mod hosted_git_info_jsc;
#[cfg(not(any()))]
pub mod hosted_git_info_jsc {
    // TODO(b1): stub — original at ./hosted_git_info_jsc.rs
    pub trait HostedGitInfoJsc {}
}

#[cfg(any())]
pub mod npm_jsc;
#[cfg(not(any()))]
pub mod npm_jsc {
    // TODO(b1): stub — original at ./npm_jsc.rs
    pub struct ManifestBindings;
}

#[cfg(any())]
pub mod dependency_jsc;
#[cfg(not(any()))]
pub mod dependency_jsc {
    // TODO(b1): stub — original at ./dependency_jsc.rs
}

#[cfg(any())]
pub mod ini_jsc;
#[cfg(not(any()))]
pub mod ini_jsc {
    // TODO(b1): stub — original at ./ini_jsc.rs
    pub struct IniTestingAPIs;
}
