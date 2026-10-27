fn main() {
    let variant = std::env::var("ZSTD_REF").unwrap_or_else(|_| "ref".into());
    println!("cargo:rerun-if-env-changed=ZSTD_REF");
    println!("cargo:rustc-link-search=native=/root/zstd-ref/build/{variant}");
    println!("cargo:rustc-link-lib=static=zstd");
}
