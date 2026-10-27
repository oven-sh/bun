fn main() {
    let dir = std::env::var("BROTLI_CREF").unwrap_or_else(|_| format!("{}/cref", env!("CARGO_MANIFEST_DIR")));
    println!("cargo:rustc-link-search=native={dir}");
    println!("cargo:rustc-link-lib=static=brotliref");
    println!("cargo:rerun-if-changed={dir}/libbrotliref.a");
    println!("cargo:rerun-if-env-changed=BROTLI_CREF");
}
