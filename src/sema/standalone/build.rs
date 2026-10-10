//! Links zstd as Bun's build has compiled it: the archive of the runtime's own modules is compressed with it. And mimalloc: what the tool measures is what Bun does.

fn main() {
    println!("cargo:rerun-if-env-changed=BUN_CODEGEN_DIR");
    let codegen = std::env::var("BUN_CODEGEN_DIR").expect("BUN_CODEGEN_DIR: the codegen directory of a build of Bun");
    if std::env::var_os("CARGO_FEATURE_MIMALLOC").is_some() {
        let object = std::path::Path::new(&codegen).join("../obj/vendor/mimalloc/src/static.c.o");
        assert!(object.exists(), "the build of Bun has compiled mimalloc: {}", object.display());
        println!("cargo:rustc-link-arg-bins={}", object.display());
    }
    let library = std::path::Path::new(&codegen).join("../obj/vendor/zstd/lib");
    for directory in ["common", "compress", "decompress"] {
        let entries = std::fs::read_dir(library.join(directory)).expect("the build of Bun has compiled zstd");
        let mut objects: Vec<_> = entries.filter_map(|entry| Some(entry.ok()?.path())).filter(|path| path.extension().is_some_and(|it| it == "o")).collect();
        objects.sort();
        for object in objects {
            println!("cargo:rustc-link-arg-bins={}", object.display());
        }
    }
}
