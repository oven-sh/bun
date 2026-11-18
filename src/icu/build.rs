#![allow(
    clippy::disallowed_methods,
    clippy::disallowed_types,
    clippy::disallowed_macros
)]

use std::env;
use std::fs;
use std::path::Path;

/// For a check of a target whose headers are not here: nothing is linked, so any suffix will do.
const UNLINKED_MAJOR: &str = "0";

fn major_in_headers(include: &Path) -> Option<String> {
    let header = include.join("unicode/uvernum.h");
    let text = fs::read_to_string(&header).ok()?;
    println!("cargo:rerun-if-changed={}", header.display());
    text.lines()
        .find_map(|line| line.strip_prefix("#define U_ICU_VERSION_MAJOR_NUM "))
        .map(|major| major.trim().to_owned())
}

fn major_on_this_machine() -> Option<String> {
    if let Some(root) = env::var_os("BUN_ICU_ROOT") {
        return major_in_headers(&Path::new(&root).join("include"));
    }
    if env::var("HOST") != env::var("TARGET") {
        return None;
    }
    ["/usr/local/include", "/usr/include"]
        .into_iter()
        .find_map(|include| major_in_headers(Path::new(include)))
}

fn write_symbol_macro(suffix: &str) {
    let source = format!(
        "/// The name by which the linker knows a function of ICU.
#[macro_export]
macro_rules! icu_symbol {{ ($name:ident) => {{ concat!(stringify!($name), \"{suffix}\") }}; }}
"
    );
    let out_dir = env::var_os("OUT_DIR").unwrap();
    fs::write(Path::new(&out_dir).join("symbol.rs"), source).unwrap();
}

fn main() {
    println!("cargo:rerun-if-changed=build.rs");
    println!("cargo:rerun-if-env-changed=BUN_ICU_MAJOR_VERSION");
    println!("cargo:rerun-if-env-changed=BUN_ICU_ROOT");
    println!("cargo:rustc-check-cfg=cfg(bundled_icu, system_icucore, icu_before_79)");

    // The library of macOS keeps its names across releases; every other build appends the major version.
    if env::var("CARGO_CFG_TARGET_OS").unwrap() == "macos" {
        println!("cargo:rustc-cfg=system_icucore");
        println!("cargo:rustc-cfg=icu_before_79");
        write_symbol_macro("");
        return;
    }
    // Set by scripts/build/rust.ts when the build compiles ICU.
    let bundled = env::var("BUN_ICU_MAJOR_VERSION").ok();
    if let Some(major) = &bundled {
        println!("cargo:rustc-cfg=bundled_icu");
        println!("cargo:rustc-env=BUN_ICU_DATA_NAME=icudt{major}");
    }
    let major = bundled.or_else(major_on_this_machine);
    let major = major.as_deref().unwrap_or(UNLINKED_MAJOR);
    if major.parse::<u32>().unwrap() < 79 {
        println!("cargo:rustc-cfg=icu_before_79");
    }
    write_symbol_macro(&format!("_{major}"));
}
