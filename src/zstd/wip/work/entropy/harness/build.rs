use std::process::Command;

fn main() {
    let variant = std::env::var("ZSTD_REF").unwrap_or_else(|_| "ref".into());
    println!("cargo:rerun-if-env-changed=ZSTD_REF");
    println!("cargo:rustc-link-search=native=/root/zstd-ref/build/{variant}");
    println!("cargo:rustc-link-lib=static=zstd");

    // The inline functions of fse.h.
    println!("cargo:rerun-if-changed=entropy_shim.c");
    let out = std::env::var("OUT_DIR").unwrap();
    let ok = Command::new("clang-23")
        .args(["-c", "-O2", "-g", "-fPIC", "-march=nehalem", "-I/root/zstd-ref/zstd/lib", "-I/root/zstd-ref/zstd/lib/common", "entropy_shim.c", "-o"])
        .arg(format!("{out}/entropy_shim.o")).status().unwrap().success();
    assert!(ok);
    let ok = Command::new("llvm-ar-23").args(["rcs", &format!("{out}/libentropy_shim.a"), &format!("{out}/entropy_shim.o")]).status().unwrap().success();
    assert!(ok);
    println!("cargo:rustc-link-search=native={out}");
    println!("cargo:rustc-link-lib=static=entropy_shim");
}
