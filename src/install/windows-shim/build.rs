//! Reproducible PE for the standalone `.bin/` launcher (oven-sh/bun#12738).
//!
//! lld-link (and MSVC link.exe) default to writing the wall-clock link time
//! into the COFF `TimeDateStamp` field, and rustc passes `/DEBUG` regardless
//! of `strip = "symbols"`, which embeds an `RSDS` CodeView record whose GUID
//! is a hash of the `.pdb` (and so of absolute object paths). Both make the
//! shim a fresh binary on every build. `/Brepro` turns the timestamps into a
//! content hash; `/DEBUG:NONE` drops the PDB and its `RSDS` record. Both are
//! appended after the driver's own `/DEBUG`, so the override wins.

fn main() {
    println!("cargo:rerun-if-changed=build.rs");
    if std::env::var_os("CARGO_FEATURE_SHIM_STANDALONE").is_some()
        && std::env::var("CARGO_CFG_TARGET_OS").as_deref() == Ok("windows")
    {
        println!("cargo:rustc-link-arg=/Brepro");
        println!("cargo:rustc-link-arg=/DEBUG:NONE");
    }
}
