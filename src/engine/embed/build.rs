//! Turns each line of `Layout.h` into an assertion about the Rust types.

#![allow(
    clippy::disallowed_methods,
    clippy::disallowed_types,
    clippy::disallowed_macros
)]

use std::fmt::Write;
use std::path::PathBuf;
use std::{env, fs};

fn main() {
    const HEADER: &str = "include/engine/api/Layout.h";
    println!("cargo:rerun-if-changed={HEADER}");
    let manifest = PathBuf::from(env::var("CARGO_MANIFEST_DIR").unwrap());
    let header = fs::read_to_string(manifest.join(HEADER)).unwrap();

    let mut out = String::new();
    for line in header.lines() {
        let Some((kind, rest)) = line
            .strip_prefix("ENGINE_")
            .and_then(|line| line.split_once('('))
        else {
            continue;
        };
        let rest = rest.strip_suffix(')').unwrap();
        let (first, rest) = rest.split_once(", ").unwrap();
        let (second, third) = rest.split_once(", ").unwrap_or((rest, ""));
        let (name, value, actual) = match kind {
            "OFFSET" => (
                format!("{first}_{second}"),
                third,
                format!("{first}::offset_of_field(\"{second}\")"),
            ),
            "SIZE" => (
                format!("sizeOf{first}"),
                second,
                format!("size_of::<{first}>()"),
            ),
            _ => (first.to_owned(), second, format!("({third}) as usize")),
        };
        writeln!(out, "const {name}: usize = {value};").unwrap();
        if kind == "LIMIT" {
            writeln!(out, "const _: () = assert!({actual} <= {name});").unwrap();
        } else {
            writeln!(out, "const _: Is<{name}> = Is::<{{ {actual} }}>;").unwrap();
        }
    }
    let out_dir = PathBuf::from(env::var("OUT_DIR").unwrap());
    fs::write(out_dir.join("layout.rs"), out).unwrap();
}
