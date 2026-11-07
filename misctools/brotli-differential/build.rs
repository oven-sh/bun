fn main() {
    let dir = std::env::var("BROTLI_CREF").unwrap_or_else(|_| format!("{}/cref", env!("CARGO_MANIFEST_DIR")));
    let patch = concat!(env!("CARGO_MANIFEST_DIR"), "/cref.patch");
    assert!(std::fs::read(format!("{dir}/cref.patch")).ok() == std::fs::read(patch).ok(), "{dir} was not built with this cref.patch: run build-cref.sh");
    println!("cargo:rerun-if-changed={patch}");
    println!("cargo:rerun-if-changed={dir}/cref.patch");
    println!("cargo:rustc-link-search=native={dir}");
    println!("cargo:rustc-link-lib=static=brotliref");
    println!("cargo:rerun-if-changed={dir}/libbrotliref.a");
    println!("cargo:rerun-if-env-changed=BROTLI_CREF");
}
