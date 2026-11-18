//! The version of the serialized form: a hash of the sources that decide which bytes a text turns into.

#![allow(
    clippy::disallowed_methods,
    clippy::disallowed_types,
    clippy::disallowed_macros
)]

use std::fs;
use std::path::Path;

const CRATES: [&str; 7] = [
    "bigint", "bytecode", "number", "regexp", "syntax", "text", "unicode",
];

/// FNV-1a. Neither the line ends of the checkout nor the order of a directory show.
fn hash_of(path: &Path, hash: u32) -> u32 {
    if path.is_dir() {
        let entries = fs::read_dir(path).unwrap();
        let mut inside: Vec<_> = entries.map(|entry| entry.unwrap().path()).collect();
        inside.retain(|path| !path.ends_with("tests") && !path.ends_with("unit_tests"));
        inside.sort();
        return inside.iter().fold(hash, |hash, path| hash_of(path, hash));
    }
    let extension = path.extension().and_then(|it| it.to_str());
    if !matches!(extension, Some("rs" | "txt" | "bin")) {
        return hash;
    }
    println!("cargo:rerun-if-changed={}", path.display());
    let bytes = fs::read(path).unwrap().into_iter();
    (bytes.filter(|&byte| byte != b'\r')).fold(hash, |hash, byte| {
        (hash ^ u32::from(byte)).wrapping_mul(0x100_0193)
    })
}

fn main() {
    let crates = CRATES.map(|name| Path::new("..").join(name));
    let version = (crates.iter()).fold(0x811c_9dc5, |hash, path| hash_of(path, hash));
    println!("cargo:rustc-env=BYTECODE_VERSION={version}");
}
