use std::process::Command;
fn main() {
    let variant = std::env::var("ZSTD_REF").unwrap_or_else(|_| "ref".into());
    println!("cargo:rerun-if-env-changed=ZSTD_REF");
    println!("cargo:rerun-if-changed=shim.c");
    let out = std::env::var("OUT_DIR").unwrap();
    let ok = Command::new("clang-23")
        .args(["-c", "-O2", "-fPIC", "-march=nehalem", "-DZSTD_MULTITHREAD", "-DZSTD_LEGACY_SUPPORT=0", "-DXXH_NAMESPACE=ZSTD_",
               "-I/root/zstd-ref/zstd/lib", "-I/root/zstd-ref/zstd/lib/common", "shim.c", "-o"])
        .arg(format!("{out}/shim.o")).status().unwrap().success();
    assert!(ok);
    let _ = std::fs::remove_file(format!("{out}/libshim.a"));
    assert!(Command::new("llvm-ar-23").args(["rcs", &format!("{out}/libshim.a"), &format!("{out}/shim.o")]).status().unwrap().success());
    println!("cargo:rustc-link-search=native={out}");
    println!("cargo:rustc-link-lib=static=shim");
    println!("cargo:rustc-link-search=native={}", if variant.starts_with("/") { variant.clone() } else { format!("/root/zstd-ref/build/{variant}") });
    println!("cargo:rustc-link-lib=static=zstd");
}
