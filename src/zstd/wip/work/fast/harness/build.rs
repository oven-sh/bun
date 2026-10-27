use std::process::Command;

fn main() {
    let variant = std::env::var("ZSTD_REF").unwrap_or_else(|_| "ref".into());
    println!("cargo:rerun-if-env-changed=ZSTD_REF");
    println!("cargo:rerun-if-changed=c/shim.c");
    println!("cargo:rerun-if-changed=c/shim_cctx.inc");
    let out = std::env::var("OUT_DIR").unwrap();
    let ok = Command::new("clang-23")
        .args(["-c", "-O2", "-g", "-fPIC", "-march=nehalem", "-DZSTD_MULTITHREAD", "-DZSTD_LEGACY_SUPPORT=0", "-DXXH_NAMESPACE=ZSTD_"])
        .args(["-I/root/zstd-ref/zstd/lib", "-I/root/zstd-ref/zstd/lib/common", "c/shim.c", "-o"])
        .arg(format!("{out}/shim.o")).status().unwrap().success();
    assert!(ok);
    let _ = std::fs::remove_file(format!("{out}/libshim.a"));
    let ok = Command::new("llvm-ar-23").arg("rcs").arg(format!("{out}/libshim.a")).arg(format!("{out}/shim.o")).status().unwrap().success();
    assert!(ok);
    println!("cargo:rustc-link-search=native={out}");
    println!("cargo:rustc-link-lib=static=shim");
    println!("cargo:rustc-link-search=native=/root/zstd-ref/build/{variant}");
    println!("cargo:rustc-link-lib=static=zstd");
}
