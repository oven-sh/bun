#![allow(
    clippy::disallowed_methods,
    clippy::disallowed_types,
    clippy::disallowed_macros
)]

use std::env;
use std::fs;
use std::path::PathBuf;

const HIGHWAY_SOURCES: [&str; 3] = ["hwy/abort.cc", "hwy/per_target.cc", "hwy/targets.cc"];
const KERNELS: &[&str] = &[
    "highway_strings.cpp",
    "highway_byte_set.cpp",
    "highway_elements.cpp",
    "highway_json_text.cpp",
    "highway_text.cpp",
    "highway_utf8.cpp",
    "xxhash3.cpp",
];
const HEADERS: [&str; 2] = ["highway_dispatch.h", "BufferStringSearch.h"];

fn main() {
    // It links nothing.
    if cfg!(rootcheck) {
        return;
    }
    let manifest = PathBuf::from(env::var("CARGO_MANIFEST_DIR").unwrap());
    let repository = manifest
        .ancestors()
        .nth(3)
        .expect("repository root from CARGO_MANIFEST_DIR");
    let vendor = repository.join("vendor");
    let bindings = repository.join("src/jsc/bindings");
    let out = PathBuf::from(env::var("OUT_DIR").unwrap());

    for library in ["highway", "simdutf", "mimalloc"] {
        if !vendor.join(library).exists() {
            println!(
                "cargo:warning=vendor/{library} is missing. Run bun scripts/build.ts --target=clone-{library}"
            );
            return;
        }
    }

    let transcoder = repository.join("src/simdutf_sys/bun-simdutf.cpp");
    println!("cargo:rerun-if-changed={}", transcoder.display());

    let mut native = cc::Build::new();
    if env::var_os("CXX").is_none() {
        native.compiler("clang++");
    }
    native
        .cpp(true)
        .std("c++23")
        .opt_level(3)
        .warnings(false)
        .flag("-fno-exceptions")
        .flag("-fno-omit-frame-pointer")
        .include(&out)
        .include(manifest.join("include"))
        .include(vendor.join("highway"))
        .include(vendor.join("simdutf/include"))
        .include(vendor.join("simdutf/src"))
        .include(vendor.join("mimalloc/include"))
        .define("HWY_STATIC_DEFINE", None)
        .define("HWY_DISABLED_TARGETS", "HWY_ALL_SVE-HWY_SVE2_128")
        .define("MI_STATIC_LIB", None)
        .define("MI_SKIP_COLLECT_ON_EXIT", "1")
        .define("MI_NO_PROCESS_DETACH", "1")
        .define("MI_FREE_USE_PAGEMAP", "1")
        .define("MI_BUILD_RELEASE", None)
        .define("MI_DEFAULT_ALLOW_THP", "0")
        .files(HIGHWAY_SOURCES.map(|source| vendor.join("highway").join(source)))
        .file(vendor.join("simdutf/src/simdutf.cpp"))
        .file(transcoder);

    let recipe = repository.join("scripts/build/deps/simdutf.ts");
    println!("cargo:rerun-if-changed={}", recipe.display());
    let recipe = fs::read_to_string(recipe).unwrap();
    let unused = (recipe.lines()).find(|line| line.starts_with("export const unusedFeatures"));
    for feature in unused.unwrap().split('"').skip(1).step_by(2) {
        native.define(feature, "0");
    }

    if env::var("CARGO_CFG_TARGET_ARCH").unwrap() == "x86_64" {
        native.flag("-march=nehalem");
    }

    // With `-Clinker-plugin-lto` the Rust code reaches the linker as bitcode; the kernels have to as well, or a
    // call into one stays a call. The archiver then has to be the one that reads bitcode.
    if env::var("CARGO_ENCODED_RUSTFLAGS")
        .or_else(|_| env::var("RUSTFLAGS"))
        .is_ok_and(|flags| flags.contains("linker-plugin-lto"))
    {
        native.flag("-flto=thin").flag("-fno-split-lto-unit");
        if env::var_os("AR").is_none() {
            native.archiver("llvm-ar");
        }
    }
    println!("cargo:rerun-if-env-changed=CARGO_ENCODED_RUSTFLAGS");

    // A kernel includes "root.h", which is looked for beside the source first: the copy finds this crate's.
    for name in KERNELS.iter().chain(&HEADERS) {
        let source = bindings.join(name);
        println!("cargo:rerun-if-changed={}", source.display());
        fs::copy(&source, out.join(name)).unwrap();
    }
    native.files(KERNELS.iter().map(|name| out.join(name)));

    let allocator = out.join("mimalloc.cpp");
    fs::write(&allocator, "#include \"../src/static.c\"\n").unwrap();
    native.file(allocator);

    if let Err(error) = native.try_compile("bun_engine_standalone") {
        // `cargo check --target` links nothing, and works without the headers of that system.
        assert!(env::var("HOST") != env::var("TARGET"), "{error}");
        println!("cargo:warning=no native libraries for this target");
    }
    if env::var("CARGO_CFG_TARGET_OS").unwrap() == "macos" {
        println!("cargo:rustc-link-lib=icucore");
    } else {
        // A static build with `include` and `lib` folders, in place of the system's.
        if let Ok(root) = env::var("BUN_ICU_ROOT") {
            println!("cargo:rustc-link-search=native={root}/lib");
        }
        for library in ["icui18n", "icuuc", "icudata"] {
            println!("cargo:rustc-link-lib={library}");
        }
    }
    println!("cargo:rerun-if-env-changed=BUN_ICU_ROOT");
    println!("cargo:rerun-if-changed=include/root.h");
    println!("cargo:rerun-if-changed=build.rs");
}
