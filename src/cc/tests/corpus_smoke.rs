//! Runs `bun-cc-corpus` on the two smallest members of the corpus when they are on disk:
//! picohttpparser and the SQLite amalgamation.

// A test that spawns the driver binary: std only, like the rest of this crate.
#![allow(
    clippy::disallowed_methods,
    clippy::disallowed_macros,
    clippy::disallowed_types
)]

use std::process::Command;

#[test]
fn corpus_driver_compiles_picohttpparser_and_sqlite() {
    let repo = env!("CARGO_MANIFEST_DIR")
        .strip_suffix("/src/cc")
        .unwrap_or(env!("CARGO_MANIFEST_DIR"));
    let sqlite = format!("{repo}/src/jsc/bindings/sqlite/sqlite3.c");
    let pico = [
        format!("{repo}/vendor/picohttpparser"),
        format!(
            "{}/code/bun/vendor/picohttpparser",
            std::env::var("HOME").unwrap_or_default()
        ),
    ];
    if std::fs::metadata(&sqlite).is_err() || !pico.iter().any(|p| std::fs::metadata(p).is_ok()) {
        return;
    }
    let output = Command::new(env!("CARGO_BIN_EXE_bun-cc-corpus"))
        .args([
            "--lib",
            "picohttpparser",
            "--lib",
            "sqlite",
            "--timeout",
            "50",
        ])
        .output()
        .expect("the driver runs");
    let text = String::from_utf8_lossy(&output.stdout).into_owned();
    assert!(output.status.success(), "{text}");
    let line = |name: &str| -> String {
        text.lines()
            .find(|l| l.starts_with(name))
            .unwrap_or_else(|| panic!("no line for {name} in\n{text}"))
            .to_string()
    };
    assert!(
        line("picohttpparser:").starts_with("picohttpparser: 2 ok / 0 failed / 1 skipped"),
        "{text}"
    );
    assert!(
        line("sqlite:").starts_with("sqlite: 1 ok / 0 failed / 0 skipped"),
        "{text}"
    );
    assert!(
        line("total:").starts_with("total: 3 ok / 0 failed / 1 skipped"),
        "{text}"
    );

    // An unknown library is an error that names the ones there are.
    let output = Command::new(env!("CARGO_BIN_EXE_bun-cc-corpus"))
        .args(["--lib", "nope"])
        .output()
        .expect("the driver runs");
    assert!(!output.status.success());
    assert!(
        String::from_utf8_lossy(&output.stderr)
            .lines()
            .any(|l| l.trim() == "zstd")
    );
}
