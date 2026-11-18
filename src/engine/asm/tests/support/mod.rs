#![allow(
    dead_code,
    clippy::disallowed_methods,
    clippy::disallowed_types,
    clippy::disallowed_macros
)]

use std::fmt::Write as _;
use std::io::Write as _;
use std::process::{Command, Stdio};

fn llvm_mc() -> Option<&'static str> {
    [
        "llvm-mc",
        "llvm-mc-23",
        "/usr/lib/llvm-23/bin/llvm-mc",
        "/opt/homebrew/opt/llvm/bin/llvm-mc",
    ]
    .into_iter()
    .find(|path| {
        Command::new(path)
            .arg("--version")
            .output()
            .is_ok_and(|output| output.status.success())
    })
}

/// What it prints. `None` without LLVM.
fn run_llvm_mc(mode: &str, arguments: &[&str], input: String) -> Option<String> {
    let mut child = Command::new(llvm_mc()?)
        .arg(mode)
        .args(arguments)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .unwrap();
    let mut stdin = child.stdin.take().unwrap();
    let writer = std::thread::spawn(move || stdin.write_all(input.as_bytes()).unwrap());
    let output = child.wait_with_output().unwrap();
    writer.join().unwrap();
    assert_eq!(String::from_utf8_lossy(&output.stderr), "");
    Some(String::from_utf8(output.stdout).unwrap())
}

/// One line for each instruction, with single spaces and no comments. `None` without LLVM.
pub(crate) fn disassemble(arguments: &[&str], bytes: &[u8]) -> Option<Vec<String>> {
    let mut input = String::new();
    for byte in bytes {
        write!(input, "0x{byte:02x} ").unwrap();
    }
    let text = run_llvm_mc("--disassemble", arguments, input)?;
    let lines = text.lines().map(|line| {
        let code = line
            .split(" # ")
            .next()
            .unwrap()
            .split("//")
            .next()
            .unwrap();
        code.split_whitespace().collect::<Vec<_>>().join(" ")
    });
    Some(
        lines
            .filter(|line| !line.is_empty() && !line.starts_with('.'))
            .collect(),
    )
}

pub(crate) fn assert_disassembly(arguments: &[&str], bytes: &[u8], expected: &[String]) {
    let Some(actual) = disassemble(arguments, bytes) else {
        eprintln!("skipped: llvm-mc is not installed");
        return;
    };
    for (index, (actual, expected)) in actual.iter().zip(expected).enumerate() {
        assert_eq!(actual, expected, "instruction {index}");
    }
    assert_eq!(actual.len(), expected.len());
}

pub(crate) const ARM64: [&str; 2] = [
    "-triple=aarch64",
    "-mattr=+lse,+jsconv,+fptoint,+dotprod,+sha3",
];

/// Each line is one AArch64 instruction, and `bytes` are what LLVM makes of them.
pub(crate) fn assert_arm64_assembly(bytes: &[u8], lines: &[String]) {
    let Some(text) = run_llvm_mc("--show-encoding", &ARM64, lines.join("\n") + "\n") else {
        eprintln!("skipped: llvm-mc is not installed");
        return;
    };
    let expected: Vec<u32> = text
        .lines()
        .filter_map(|line| line.split_once("encoding: [")?.1.split_once(']'))
        .map(|(list, _)| {
            list.rsplit(',').fold(0, |word, byte| {
                word << 8 | u32::from_str_radix(&byte[2..], 16).unwrap()
            })
        })
        .collect();
    assert_eq!(expected.len(), lines.len());
    for ((actual, expected), line) in bytes.as_chunks().0.iter().zip(expected).zip(lines) {
        let word = u32::from_le_bytes(*actual);
        assert!(
            word == expected,
            "{line}: {word:08x} instead of {expected:08x}, which is {:?}",
            disassemble(&ARM64, actual)
        );
    }
    assert_eq!(bytes.len(), 4 * lines.len());
}
