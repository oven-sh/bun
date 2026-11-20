#![allow(clippy::disallowed_macros)]

fn main() {
    // cfgs `scripts/bench-json-rust.sh` sets when the comparison C libraries are available.
    println!("cargo:rustc-check-cfg=cfg(pugixml)");
    println!("cargo:rustc-check-cfg=cfg(expat)");
    println!("cargo:rustc-check-cfg=cfg(libxml2)");
    println!("cargo:rerun-if-changed=build.rs");
}
