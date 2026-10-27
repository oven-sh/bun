fn main() {
    // TJREF_DIR: where libtjref.a is, to time against a build with other flags.
    let dir = std::env::var("TJREF_DIR").unwrap_or_else(|_| "/root/ref/build".into());
    println!("cargo:rustc-link-search=native={dir}");
    println!("cargo:rustc-link-lib=static=tjref");
    println!("cargo:rerun-if-changed={dir}/libtjref.a");
    println!("cargo:rerun-if-env-changed=TJREF_DIR");
}
