#![allow(non_snake_case, non_camel_case_types, non_upper_case_globals)]
#![warn(unused_must_use)]

pub mod dependency_jsc;
pub mod hosted_git_info_jsc;
pub mod ini_jsc;
pub mod install_binding;
pub mod npm_jsc;
pub mod update_request_jsc;

pub use hosted_git_info_jsc::HostedGitInfoJsc;
pub use ini_jsc::IniTestingAPIs;
pub use npm_jsc::ManifestBindings;
