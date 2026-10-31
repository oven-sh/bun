use std::path::Path;
use std::process::Command;

fn run(command: &mut Command) {
    let status = command.status().unwrap_or_else(|e| panic!("{command:?}: {e}"));
    assert!(status.success(), "{command:?}");
}

/// The Highway kernels that bun_jpeg calls, which Bun's own build compiles with the rest of its C++.
/// vendor/highway is there after any build of Bun (scripts/build/deps/highway.ts has the commit).
fn kernels() {
    let out = std::env::var("OUT_DIR").unwrap();
    let cxx = std::env::var("CXX").unwrap_or_else(|_| "clang++-23".into());
    // KERNEL_CXXFLAGS: to time with the flags of a release build.
    let flags = std::env::var("KERNEL_CXXFLAGS").unwrap_or_else(|_| "-O2 -g -march=nehalem".into());
    let sources = [
        "../../src/jsc/bindings/highway_jpeg.cpp",
        "../../vendor/highway/hwy/targets.cc",
        "../../vendor/highway/hwy/abort.cc",
        "../../vendor/highway/hwy/print.cc",
        "src/target.cpp",
    ];
    let mut archive = Command::new("llvm-ar-23");
    archive.arg("rcs").arg(format!("{out}/libkernels.a"));
    for source in sources {
        let object = format!("{out}/{}.o", Path::new(source).file_stem().unwrap().to_str().unwrap());
        run(Command::new(&cxx)
            .args(flags.split_whitespace())
            .args(["-std=c++23", "-fPIC", "-fno-exceptions", "-fno-rtti", "-DHWY_STATIC_DEFINE"])
            .arg("-DHWY_DISABLED_TARGETS=HWY_ALL_SVE-HWY_SVE2_128")
            .args(["-I../../vendor/highway", "-I../../src/jsc/bindings", "-c", source, "-o", &object]));
        archive.arg(object);
        println!("cargo:rerun-if-changed={source}");
    }
    let _ = std::fs::remove_file(format!("{out}/libkernels.a"));
    run(&mut archive);
    println!("cargo:rustc-link-search=native={out}");
    println!("cargo:rustc-link-lib=static:+whole-archive=kernels");
    println!("cargo:rustc-link-lib=dylib=stdc++");
    println!("cargo:rerun-if-changed=../../src/jsc/bindings/highway_dispatch.h");
    println!("cargo:rerun-if-env-changed=KERNEL_CXXFLAGS");
    println!("cargo:rerun-if-env-changed=CXX");
}

fn main() {
    // TJREF_DIR: where libtjref.a is, to time against a build with other flags.
    let dir = std::env::var("TJREF_DIR").unwrap_or_else(|_| "/root/ref/build".into());
    println!("cargo:rustc-link-search=native={dir}");
    println!("cargo:rustc-link-lib=static=tjref");
    println!("cargo:rerun-if-changed={dir}/libtjref.a");
    println!("cargo:rerun-if-env-changed=TJREF_DIR");
    kernels();
}
