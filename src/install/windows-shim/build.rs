// Build scripts run on the host before bun_* crates are compiled; std is the only option.
#![allow(
    clippy::disallowed_methods,
    clippy::disallowed_types,
    clippy::disallowed_macros
)]

fn main() {
    println!("cargo:rerun-if-changed=build.rs");
    if std::env::var_os("CARGO_FEATURE_SHIM_STANDALONE").is_some()
        && std::env::var("CARGO_CFG_TARGET_OS").as_deref() == Ok("windows")
    {
        // oven-sh/bun#12738: byte-reproducible PE (no wall-clock TimeDateStamp / RSDS GUID).
        println!("cargo:rustc-link-arg=/Brepro");
        println!("cargo:rustc-link-arg=/DEBUG:NONE");
    }
}
