//! What LLVM makes of machine code.

use std::fmt::Write as _;
use std::io::Write as _;
use std::process::{Command, Stdio};
use std::sync::OnceLock;

use bun_engine_asm::Code;
use bun_engine_codegen::Target;

fn llvm_mc() -> Option<&'static str> {
    static PATH: OnceLock<Option<&str>> = OnceLock::new();
    *PATH.get_or_init(|| {
        [
            "llvm-mc",
            "llvm-mc-23",
            "/usr/lib/llvm-23/bin/llvm-mc",
            "/opt/homebrew/opt/llvm/bin/llvm-mc",
        ]
        .into_iter()
        .find(|path| {
            let output = Command::new(path).arg("--version").output();
            output.is_ok_and(|output| output.status.success())
        })
    })
}

/// The size and text of each instruction. `None` without LLVM.
pub(crate) fn disassemble(target: Target, bytes: &[u8]) -> Option<Vec<(usize, String)>> {
    let arguments = if target.is_x64() {
        ["-triple=x86_64", "--output-asm-variant=1"]
    } else {
        ["-triple=aarch64", "-mattr=+all"]
    };
    let mut input = String::new();
    for byte in bytes {
        write!(input, "0x{byte:02x} ").unwrap();
    }
    let mut child = Command::new(llvm_mc()?)
        .args(["--disassemble", "--show-encoding"])
        .args(arguments)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .spawn()
        .unwrap();
    let mut stdin = child.stdin.take().unwrap();
    let writer = std::thread::spawn(move || stdin.write_all(input.as_bytes()).unwrap());
    let output = child.wait_with_output().unwrap();
    writer.join().unwrap();
    let text = String::from_utf8(output.stdout).unwrap();
    let parse = |line: &str| {
        let (instruction, encoding) = line.split_once("encoding: [")?;
        let words = instruction.split_whitespace();
        let words: Vec<_> = words
            .take_while(|&word| word != "#" && word != "//")
            .collect();
        Some((encoding.split(',').count(), words.join(" ")))
    };
    Some(text.lines().filter_map(parse).collect())
}

/// With offsets.
pub(crate) fn listing(target: Target, code: &Code) -> Option<String> {
    let (mut text, mut offset) = (String::new(), 0);
    let bytes = &code.bytes()[..code.instructions_end() as usize];
    for (size, instruction) in disassemble(target, bytes)? {
        writeln!(text, "{offset:6x}  {instruction}").unwrap();
        offset += size;
    }
    Some(text)
}
