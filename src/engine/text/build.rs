//! Turns `names.txt` into the static atoms and symbols. A line is `name`, `name = text`, `@@wellKnownSymbol` or
//! `@privateName`.

#![allow(
    clippy::disallowed_methods,
    clippy::disallowed_types,
    clippy::disallowed_macros
)]
#![allow(dead_code, unreachable_pub, reason = "names need a part of `hash.rs`")]

use std::collections::BTreeMap;
use std::fmt::Write;
use std::path::PathBuf;
use std::{env, fs};

#[path = "hash.rs"]
mod hash;

fn identifier(name: &str) -> String {
    match name {
        "super" | "self" | "Self" | "crate" => format!("{name}_"),
        _ => format!("r#{name}"),
    }
}

/// Linear probing from the low bits of the hash. A slot is an index plus one, or zero.
fn slots(hashes: &[u32], capacity: usize) -> Vec<u16> {
    let mut slots = vec![0; capacity];
    for (index, &hash) in hashes.iter().enumerate() {
        let mut slot = hash as usize & (capacity - 1);
        while slots[slot] != 0 {
            slot = (slot + 1) & (capacity - 1);
        }
        slots[slot] = u16::try_from(index + 1).unwrap();
    }
    slots
}

fn main() {
    println!("cargo:rerun-if-changed=names.txt");
    println!("cargo:rerun-if-changed=hash.rs");
    let manifest = PathBuf::from(env::var("CARGO_MANIFEST_DIR").unwrap());
    let list = fs::read_to_string(manifest.join("names.txt")).unwrap();

    let mut names = BTreeMap::new();
    let mut symbols = BTreeMap::new();
    let mut private_names = BTreeMap::new();
    for line in list.lines().filter(|line| !line.is_empty()) {
        if let Some(name) = line.strip_prefix("@@") {
            symbols.insert(name, format!("Symbol.{name}"));
        } else if let Some(name) = line.strip_prefix('@') {
            private_names.insert(name, name.to_owned());
        } else {
            let (name, text) = line.split_once(" = ").unwrap_or((line, line));
            names.insert(name, text);
        }
    }

    let mut atoms: Vec<Vec<u8>> = (0..=u8::MAX).map(|character| vec![character]).collect();
    let mut constants = String::new();
    for (name, text) in &names {
        let index = match text.as_bytes() {
            &[character] => usize::from(character),
            text => {
                assert!(
                    !atoms.iter().any(|atom| atom == text),
                    "{name} is listed twice"
                );
                atoms.push(text.to_vec());
                atoms.len() - 1
            }
        };
        let name = identifier(name);
        writeln!(constants, "pub const {name}: PropertyName<'static> = PropertyName::from_static_atom(&ATOMS[{index}]);").unwrap();
    }

    let hashes: Vec<u32> = atoms.iter().map(|atom| hash::hash_latin1(atom)).collect();
    let capacity = (atoms.len() * 3).next_power_of_two();
    let mut out = String::new();
    writeln!(
        out,
        "#[unsafe(export_name = \"engine_static_atoms\")] pub(crate) static ATOMS: [StaticString; {}] = [",
        atoms.len()
    )
    .unwrap();
    for (atom, hash) in atoms.iter().zip(&hashes) {
        writeln!(
            out,
            "StaticString::atom(b\"{}\", {hash}),",
            atom.escape_ascii()
        )
        .unwrap();
    }
    writeln!(out, "];").unwrap();
    let seed: Vec<u32> = slots(&hashes, capacity)
        .iter()
        .map(|&slot| match slot {
            0 => 0,
            _ => hashes[usize::from(slot) - 1] >> 8 << 16 | u32::from(slot),
        })
        .collect();
    writeln!(
        out,
        "pub(crate) static ATOM_SLOTS: [u32; {capacity}] = {seed:?};"
    )
    .unwrap();
    writeln!(out, "pub mod names {{ use super::*; {constants} }}").unwrap();

    for (module, table, constructor, entries) in [
        ("symbols", "WELL_KNOWN_SYMBOLS", "well_known", &symbols),
        ("private_names", "PRIVATE_NAMES", "private", &private_names),
    ] {
        writeln!(
            out,
            "#[unsafe(export_name = \"engine_{module}\")] pub(crate) static {table}: [StaticSymbol; {}] = [",
            entries.len()
        )
        .unwrap();
        for description in entries.values() {
            writeln!(out, "StaticSymbol::{constructor}(b\"{description}\"),").unwrap();
        }
        writeln!(out, "];\npub mod {module} {{ use super::*;").unwrap();
        for (index, name) in entries.keys().enumerate() {
            let name = identifier(name);
            writeln!(out, "pub const {name}: PropertyName<'static> = PropertyName::from_static_symbol(&{table}[{index}]);").unwrap();
        }
        writeln!(out, "}}").unwrap();
    }
    let hashes: Vec<u32> = private_names
        .values()
        .map(|name| hash::hash_latin1(name.as_bytes()))
        .collect();
    let capacity = (hashes.len() * 2).next_power_of_two();
    let slots = slots(&hashes, capacity);
    writeln!(
        out,
        "pub(crate) static PRIVATE_NAME_SLOTS: [u16; {capacity}] = {slots:?};"
    )
    .unwrap();

    let out_dir = PathBuf::from(env::var("OUT_DIR").unwrap());
    fs::write(out_dir.join("static_names.rs"), out).unwrap();
}
