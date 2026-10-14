// Runs on the machine that builds bun and links none of it but this crate: there is no bun_sys or bun_core::output here.
#![allow(clippy::disallowed_methods, clippy::disallowed_macros)]
//! The host tool of Bun's build.
//!
//! ```text
//! bun-exe-features table   <linked executable> <linker's map> <what the linker printed> <llvm-objdump> <out> [--keep-temporary-files]
//! bun-exe-features compact <executable as it ships> <table from `table`> <out>
//! bun-exe-features embed   <executable as it ships> <table from `compact`, compressed> <out>
//! ```
//! What `bun build --compile` does with the result:
//! ```text
//! bun-exe-features remove        <executable> <table from `compact`> <out> [feature...]
//! bun-exe-features without-table <executable> <out>
//! ```
//! The controls, on a table from `table`:
//! ```text
//! bun-exe-features control      <executable> <table> <out> [--keep-everything] [--scatter <n>] [--gap <bytes>] [feature...]
//! bun-exe-features check-blocks <linked executable> <linker's map> <what the linker printed> <llvm-objdump> <llvm-readobj>
//! bun-exe-features canonical    <table> <out>
//! ```

use std::fs::{read, write};
use std::path::Path;
use std::process::ExitCode;

use bun_exe_features::{
    Features, Link, Testing, canonical, check_blocks, compact, embed, make_table, without_table,
};

/// `bytes` were made from the executable at `from`, and can be run like it.
fn write_executable(out: &str, bytes: Vec<u8>, from: &str) -> std::io::Result<()> {
    write(out, bytes)?;
    std::fs::set_permissions(out, std::fs::metadata(from)?.permissions())
}

fn run(args: &[String]) -> Result<(), Box<dyn core::error::Error>> {
    let args: Vec<&str> = args.iter().map(|a| &a[..]).collect();
    let link = |linked, map, printed, objdump| Link {
        linked: Path::new(linked),
        map: Path::new(map),
        printed: Path::new(printed),
        objdump: Path::new(objdump),
    };
    match args[..] {
        ["table", linked, map, printed, objdump, out, ref keep @ ..] => {
            let keep = keep == ["--keep-temporary-files"];
            let (table, report) = make_table(&link(linked, map, printed, objdump), keep)?;
            print!("{report}");
            write(out, table)?;
        }
        ["compact", executable, table, out] => {
            write(out, compact(&read(executable)?, &read(table)?)?)?
        }
        ["embed", executable, table, out] => {
            write_executable(out, embed(&read(executable)?, &read(table)?)?, executable)?;
        }
        ["remove", executable, table, out, ref excluded @ ..] => {
            let excluded: Vec<&[u8]> = excluded.iter().map(|name| name.as_bytes()).collect();
            let removed = Features::open(&read(executable)?, &read(table)?)?.remove(&excluded)?;
            write_executable(out, removed, executable)?;
        }
        ["without-table", executable, out] => {
            let bytes = read(executable)?;
            write_executable(out, without_table(&bytes).unwrap_or(bytes), executable)?;
        }
        ["control", executable, table, out, ref rest @ ..] => {
            let mut testing = Testing::default();
            let mut excluded: Vec<&[u8]> = Vec::new();
            let mut rest = rest.iter();
            while let Some(&arg) = rest.next() {
                match arg {
                    "--keep-everything" => testing.keep_everything = true,
                    "--scatter" => testing.scatter = rest.next().ok_or("--scatter <n>")?.parse()?,
                    "--gap" => testing.gap = rest.next().ok_or("--gap <bytes>")?.parse()?,
                    name => excluded.push(name.as_bytes()),
                }
            }
            let (bytes, table) = (read(executable)?, read(table)?);
            let removed = Features::open_written_out(&bytes, &table)?
                .remove_for_testing(&excluded, testing)?;
            write_executable(out, removed, executable)?;
        }
        ["check-blocks", linked, map, printed, objdump, readobj] => {
            print!(
                "{}",
                check_blocks(&link(linked, map, printed, objdump), Path::new(readobj))?
            );
        }
        ["canonical", table, out] => write(out, canonical(&read(table)?)?)?,
        _ => return Err("see the top of src/exe_features/main.rs".into()),
    }
    Ok(())
}

fn main() -> ExitCode {
    let args: Vec<String> = std::env::args().skip(1).collect();
    match run(&args) {
        Ok(()) => ExitCode::SUCCESS,
        Err(e) => {
            eprintln!("bun-exe-features: {e}");
            ExitCode::FAILURE
        }
    }
}
