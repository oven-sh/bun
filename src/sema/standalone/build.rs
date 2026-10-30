#![allow(
    clippy::disallowed_methods,
    clippy::disallowed_types,
    clippy::disallowed_macros
)]

use std::env;
use std::path::PathBuf;

const SOURCES: [&str; 26] = [
    "common/debug.c",
    "common/entropy_common.c",
    "common/error_private.c",
    "common/fse_decompress.c",
    "common/pool.c",
    "common/threading.c",
    "common/xxhash.c",
    "common/zstd_common.c",
    "compress/fse_compress.c",
    "compress/hist.c",
    "compress/huf_compress.c",
    "compress/zstd_compress.c",
    "compress/zstd_compress_literals.c",
    "compress/zstd_compress_sequences.c",
    "compress/zstd_compress_superblock.c",
    "compress/zstd_double_fast.c",
    "compress/zstd_fast.c",
    "compress/zstd_lazy.c",
    "compress/zstd_ldm.c",
    "compress/zstd_opt.c",
    "compress/zstd_preSplit.c",
    "compress/zstdmt_compress.c",
    "decompress/huf_decompress.c",
    "decompress/zstd_ddict.c",
    "decompress/zstd_decompress.c",
    "decompress/zstd_decompress_block.c",
];

fn main() {
    let manifest = PathBuf::from(env::var("CARGO_MANIFEST_DIR").unwrap());
    let repository = manifest
        .ancestors()
        .nth(3)
        .expect("repository root from CARGO_MANIFEST_DIR");
    let library = repository.join("vendor/zstd/lib");
    let header = library.join("zstd.h");
    println!("cargo:rerun-if-changed={}", header.display());

    if env::var("TARGET").unwrap() != env::var("HOST").unwrap() {
        return;
    }
    if !header.exists() {
        println!(
            "cargo:warning=vendor/zstd is missing: a program that reads Bun's own modules will not link. Run bun scripts/build.ts --target=clone-zstd"
        );
        return;
    }

    let mut decoder = cc::Build::new();
    decoder
        .files(SOURCES.map(|source| library.join(source)))
        .include(&library)
        .include(library.join("common"))
        .define("ZSTD_DISABLE_ASM", "1")
        .define("ZSTD_LEGACY_SUPPORT", "0")
        .define("XXH_NAMESPACE", "ZSTD_")
        .opt_level(2)
        .warnings(false);
    if env::var_os("CARGO_CFG_WINDOWS").is_some() {
        decoder.compiler("clang-cl").define("ZSTD_HEAPMODE", "0");
    }
    decoder.compile("bun_sema_standalone_zstd");
}
