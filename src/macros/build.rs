// Build scripts run on the host before bun_* crates are compiled; std is the only option.
#![allow(
    clippy::disallowed_methods,
    clippy::disallowed_types,
    clippy::disallowed_macros
)]
//! §8 Step 13.3: track `#[path]`-mounted source dirs outside CARGO_MANIFEST_DIR.

fn main() {
    for dir in [
        "bun_core_macros",
        "clap_macros",
        "jsc_macros",
        "css_derive",
        "dispatch",
    ] {
        println!("cargo:rerun-if-changed=../{dir}/");
    }
}
