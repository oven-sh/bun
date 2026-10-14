//! The host tool of Bun's build (scripts/build/feature-table.ts).
//!
//! `table` and `order` have to run in the directory the link ran in.
//!
//! ```text
//! bun-exe-features order <linked> <map> <printed> <LTO cache> <order file before, or /dev/null> <out>
//! bun-exe-features table <linked> <map> <printed> <LTO cache>
//! bun-exe-features without <executable> <out> [feature...]
//! bun-exe-features names <executable>
//! ```

// A program of its own, that runs on the machine that builds bun: there is no bun_sys here.
#![allow(
    clippy::disallowed_methods,
    clippy::disallowed_types,
    clippy::print_stdout,
    clippy::print_stderr
)]

use std::fs::{read, write};
use std::path::Path;
use std::process::ExitCode;

use bun_exe_features::{Features, Link, make_order, make_table};

fn run(args: &[String]) -> Result<(), Box<dyn core::error::Error>> {
    let args: Vec<&str> = args.iter().map(|a| &a[..]).collect();
    let link = |linked, map, printed, lto_cache| Link {
        linked: Path::new(linked),
        map: Path::new(map),
        printed: Path::new(printed),
        lto_cache: Path::new(lto_cache),
    };
    match args[..] {
        ["order", linked, map, printed, cache, before, out] => write(
            out,
            make_order(&link(linked, map, printed, cache), &read(before)?)?,
        )?,
        ["table", linked, map, printed, cache] => {
            print!("{}", make_table(&link(linked, map, printed, cache))?)
        }
        ["without", executable, out, ref excluded @ ..] => {
            let excluded: Vec<&[u8]> = excluded.iter().map(|name| name.as_bytes()).collect();
            write(out, Features::of(&read(executable)?)?.without(&excluded)?)?;
            std::fs::set_permissions(out, std::fs::metadata(executable)?.permissions())?;
        }
        ["names", executable] => {
            for name in Features::of(&read(executable)?)?.names() {
                println!("{}", String::from_utf8_lossy(name));
            }
        }
        _ => return Err("see the top of src/exe_features/main.rs".into()),
    }
    Ok(())
}

fn main() -> ExitCode {
    match run(&std::env::args().skip(1).collect::<Vec<_>>()) {
        Ok(()) => ExitCode::SUCCESS,
        Err(error) => {
            eprintln!("bun-exe-features: {error}");
            ExitCode::FAILURE
        }
    }
}
