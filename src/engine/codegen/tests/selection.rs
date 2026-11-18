//! The instructions that are chosen for typical snippets.
//!
//! A case has three lines: the snippet, and what it becomes for AArch64 and for x86-64, without entering and leaving
//! the frame. With `CODEGEN_BLESS` set, the file is brought up to date.

#![allow(clippy::disallowed_macros, clippy::disallowed_methods)]

mod support;

use bun_engine_asm::{
    Arm64Features, Code, Label, MacroAssembly, Options as AssemblerOptions, X64Features,
};
use bun_engine_codegen::ir::Token;
use bun_engine_codegen::passes::Level;
use bun_engine_codegen::{
    Arm64Compiler, CallSite, Client, ExitSite, Frame, Options, PatchpointSite, Target, X64Compiler,
};
use support::disassembly::disassemble;
use support::snippet::function;

struct Silent;

impl<M: MacroAssembly> Client<M> for Silent {
    fn prologue(&mut self, _: &mut M, _: usize, _: &Frame) {}
    fn shared_exit(&mut self, _: &mut M, _: Token) -> Option<Label> {
        None
    }
    fn exit(&mut self, masm: &mut M, _: &ExitSite<'_>) {
        masm.nop();
    }
    fn patchpoint(&mut self, _: &mut M, _: &PatchpointSite<'_>) {}
    fn after_call(&mut self, _: &mut M, _: &CallSite<'_>) {}
    fn out_of_line(&mut self, _: &mut M) {}
}

fn new_masm<M: MacroAssembly>(features: M::Features) -> M {
    M::new(AssemblerOptions {
        features,
        shorten_jumps: true,
        seed: 0,
    })
}

fn compile(snippet: &str, target: Target) -> Code {
    let mut function = function(snippet, target);
    let options = Options {
        level: Level::Quick,
        records_origins: false,
    };
    match target {
        Target::X64(features) => {
            let (mut compiler, mut masm) = (X64Compiler::default(), new_masm(features));
            let compiled = compiler.compile(&mut function, options, &mut masm, &mut Silent);
            compiled.unwrap();
            masm.finish().unwrap()
        }
        Target::Arm64(features) => {
            let (mut compiler, mut masm) = (Arm64Compiler::default(), new_masm(features));
            let compiled = compiler.compile(&mut function, options, &mut masm, &mut Silent);
            compiled.unwrap();
            masm.finish().unwrap()
        }
    }
}

/// `[basic]` before a snippet stands for a processor without optional features.
fn listings(snippets: &[&str], [basic, full]: [Target; 2]) -> Option<Vec<String>> {
    const LEAVING: [&str; 4] = ["mov sp, x29", "ldp x29, x30, [sp], #16", "leave", "ret"];
    let (mut bytes, mut ends) = (Vec::new(), Vec::new());
    for snippet in snippets {
        let code = match snippet.strip_prefix("[basic]") {
            Some(snippet) => compile(snippet, basic),
            None => compile(snippet, full),
        };
        bytes.extend(&code.bytes()[..code.instructions_end() as usize]);
        ends.push(bytes.len());
    }
    let (mut instructions, mut offset) = (disassemble(full, &bytes)?.into_iter(), 0);
    let listing = |end| {
        let mut kept = Vec::new();
        while offset < end {
            let (size, text) = instructions.next().unwrap();
            offset += size;
            if !LEAVING.contains(&text.as_str()) {
                kept.push(text);
            }
        }
        format!("    {}", kept.join("; "))
    };
    Some(ends.into_iter().map(listing).collect())
}

#[test]
fn snippets() {
    let text = include_str!("selection.txt");
    let is_snippet = |line: &str| line.starts_with(['(', '[']);
    let snippets: Vec<&str> = text.lines().filter(|line| is_snippet(line)).collect();
    let arm64 = [Arm64Features::empty(), Arm64Features::all()].map(Target::Arm64);
    let x64 = [X64Features::empty(), X64Features::all()].map(Target::X64);
    let (Some(arm64), Some(x64)) = (listings(&snippets, arm64), listings(&snippets, x64)) else {
        // llvm-mc is not installed.
        return;
    };
    let mut listings = arm64.iter().zip(&x64);
    let mut actual = String::new();
    for line in text.lines().filter(|line| !line.starts_with(' ')) {
        actual.extend([line, "\n"]);
        if is_snippet(line) {
            let (arm64, x64) = listings.next().unwrap();
            actual.extend([arm64, "\n", x64, "\n"]);
        }
    }
    if std::env::var_os("CODEGEN_BLESS").is_some() {
        let path = concat!(env!("CARGO_MANIFEST_DIR"), "/tests/selection.txt");
        return std::fs::write(path, actual).unwrap();
    }
    let mut snippet = "";
    for (actual, expected) in actual.lines().zip(text.lines()) {
        snippet = if is_snippet(actual) { actual } else { snippet };
        assert_eq!(actual, expected, "{snippet}");
    }
    assert_eq!(actual.len(), text.len());
}
