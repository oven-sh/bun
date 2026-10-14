//! Splits the functions that hold feature markers into basic blocks.
//!
//! x86-64 takes a disassembler. On arm64 every instruction has 4 bytes, and the few kinds that matter are told by their bits.
//!
//! [`super::check_blocks`] compares the result with the compiler's own control flow graph, where it writes one.

use std::collections::{BTreeSet, HashMap, HashSet};
use std::path::Path;
use std::process::Command;

use super::live::{Block, BlockMarker, Blocks};
use super::{Data, Nodes, Result, fail};
use crate::table::{Arch, Patch};

#[derive(Clone, Copy)]
pub(super) struct Marker {
    /// Where the `false` side starts.
    pub(super) skip: u64,
    pub(super) id: u32,
}

pub(super) struct Functions<'a> {
    pub(super) arch: Arch,
    /// x86-64: the disassembler, the file to give it, and what it adds to the addresses used here (PE: the image base).
    pub(super) objdump: &'a Path,
    pub(super) path: &'a Path,
    pub(super) bias: u64,
    pub(super) bytes: Data<'a>,
    pub(super) file_offset: &'a dyn Fn(u64) -> usize,
    /// By the address of the marker, in the order of their records.
    pub(super) markers: &'a [(u64, Marker)],
    pub(super) nodes: &'a Nodes,
    pub(super) is_code: &'a dyn Fn(usize) -> bool,
    /// Linker-made entries (.plt, stubs, import thunks) for imported functions that do not return.
    pub(super) does_not_return: &'a HashSet<u64>,
    /// arm64: the constants that the code in `[start, end)` takes the address of, each with the end of the piece that holds
    /// it. See [`Functions::jump_table_targets`].
    pub(super) constants_taken_by: &'a dyn Fn(u64, u64) -> Vec<(u64, u64)>,
}

/// What an instruction does to the flow of control.
#[derive(Clone, Copy, PartialEq)]
enum Kind {
    /// The next one follows.
    Plain,
    Call,
    Jump,
    ConditionalJump,
    /// arm64: a jump through a register. (On x86-64 it is a `Jump` without a target.)
    JumpThroughRegister,
    Return,
    Trap,
    /// arm64 `adr`
    Address,
}

struct Instruction {
    at: u64,
    kind: Kind,
    /// Where it jumps, what it calls, or the address it takes, if the instruction says.
    target: Option<u64>,
    /// arm64: it loads this many bytes from a base register plus an index register.
    indexed_load: Option<u64>,
}

impl Instruction {
    fn ends_block(&self, arch: Arch) -> bool {
        match self.kind {
            Kind::Plain | Kind::Address => false,
            // What follows a call starts a block where it matters whether the callee returns, which on x86-64 is asked only at
            // the end of a block.
            Kind::Call => arch == Arch::Arm64,
            _ => true,
        }
    }

    /// Whether it returns from the function `[start, end)` or may jump out of it.
    fn may_leave(&self, start: u64, end: u64) -> bool {
        match self.kind {
            Kind::Return | Kind::JumpThroughRegister => true,
            Kind::Jump | Kind::ConditionalJump => self.target.is_none_or(|t| t < start || t >= end),
            _ => false,
        }
    }
}

fn hex_prefix(text: &str) -> Option<(u64, &str)> {
    let digits = text
        .bytes()
        .take_while(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(b))
        .count();
    Some((
        u64::from_str_radix(&text[..digits], 16).ok()?,
        &text[digits..],
    ))
}

const X64_PREFIXES: [&str; 15] = [
    "lock", "rep", "repz", "repnz", "repne", "notrack", "bnd", "data16", "addr32", "cs", "ds",
    "es", "fs", "gs", "ss",
];

/// What the disassembler makes of `[start, end)`: of each instruction its address, its first word, and the rest.
pub(super) fn listing(
    objdump: &Path,
    path: &Path,
    start: u64,
    end: u64,
) -> Result<Vec<(u64, String, String)>> {
    let output = Command::new(objdump)
        .args(["-d", "--no-show-raw-insn", "--no-leading-headers"])
        .arg(format!("--start-address={start}"))
        .arg(format!("--stop-address={end}"))
        .arg(path)
        .output()
        .map_err(|e| format!("{}: {e}", objdump.display()))?;
    let mut out = Vec::new();
    for line in String::from_utf8_lossy(&output.stdout).lines() {
        // `  address:  word  rest`
        let Some((at, rest)) = hex_prefix(line.trim_start()) else {
            continue;
        };
        let Some(rest) = rest
            .strip_prefix(':')
            .filter(|r| r.starts_with(char::is_whitespace))
        else {
            continue;
        };
        let rest = rest.trim_start();
        let (word, rest) = rest.split_at(rest.find(char::is_whitespace).unwrap_or(rest.len()));
        if !word.is_empty() {
            out.push((at, word.to_owned(), rest.trim_start().to_owned()));
        }
    }
    Ok(out)
}

fn kind_x64(mnemonic: &str) -> Kind {
    let starts_with = |prefixes: &[&str]| prefixes.iter().any(|p| mnemonic.starts_with(p));
    if matches!(mnemonic, "jmp" | "jmpq") {
        Kind::Jump
    } else if starts_with(&["j", "loop"]) {
        Kind::ConditionalJump
    } else if starts_with(&["ret", "iret", "sysret"]) {
        Kind::Return
    } else if matches!(mnemonic, "ud2" | "hlt" | "int3") {
        Kind::Trap
    } else if starts_with(&["call"]) {
        Kind::Call
    } else {
        Kind::Plain
    }
}

fn decode_arm64(w: u32, at: u64) -> Instruction {
    // A field of `bits` bits at `shift` that counts instructions from this one.
    let relative = |shift: u32, bits: u32| {
        let words = (w >> shift << (32 - bits)).cast_signed() >> (32 - bits);
        Some(at.wrapping_add_signed(i64::from(words) * 4))
    };
    let (kind, target) = if w & 0xfc00_0000 == 0x1400_0000 {
        (Kind::Jump, relative(0, 26)) // b
    } else if w & 0xfc00_0000 == 0x9400_0000 {
        (Kind::Call, relative(0, 26)) // bl
    } else if w & 0xff00_0010 == 0x5400_0000 || w & 0x7e00_0000 == 0x3400_0000 {
        (Kind::ConditionalJump, relative(5, 19)) // b.cond, cbz, cbnz
    } else if w & 0x7e00_0000 == 0x3600_0000 {
        (Kind::ConditionalJump, relative(5, 14)) // tbz, tbnz
    } else if w & 0xfe00_0000 == 0xd600_0000 {
        // through a register, with or without pointer authentication
        match (w >> 21) & 7 {
            0 => (Kind::JumpThroughRegister, None), // br
            2 | 4 => (Kind::Return, None),          // ret, eret
            _ => (Kind::Plain, None),               // blr, which comes back
        }
    } else if w & 0xffe0_001f == 0xd420_0000 || w & 0xffff_0000 == 0 {
        (Kind::Trap, None) // brk, udf
    } else if w & 0x9f00_0000 == 0x1000_0000 {
        let bytes = ((((w >> 5) & 0x7_ffff) << 2) | ((w >> 29) & 3)) << 11;
        (
            Kind::Address,
            Some(at.wrapping_add_signed(i64::from(bytes.cast_signed() >> 11))),
        )
    } else {
        (Kind::Plain, None)
    };
    let indexed_load = match w & 0xffe0_0c00 {
        0x3860_0800 => Some(1), // ldrb
        0x7860_0800 => Some(2), // ldrh
        0xb8a0_0800 => Some(4), // ldrsw
        _ => None,
    };
    // Neither register is the stack pointer or the zero register.
    let has_registers = (w >> 5) & 31 != 31 && (w >> 16) & 31 != 31;
    Instruction {
        at,
        kind,
        target,
        indexed_load: indexed_load.filter(|_| has_registers),
    }
}

impl Functions<'_> {
    fn disassemble(&self, start: u64, end: u64) -> Result<Vec<Instruction>> {
        if self.arch == Arch::Arm64 {
            let code = &self.bytes.0[(self.file_offset)(start)..][..(end - start) as usize];
            let words = code.as_chunks::<4>().0.iter().zip((start..).step_by(4));
            return Ok(words
                .map(|(word, at)| decode_arm64(u32::from_le_bytes(*word), at))
                .collect());
        }
        let mut out = Vec::new();
        for (at, first, rest) in
            listing(self.objdump, self.path, start + self.bias, end + self.bias)?
        {
            // `[prefixes] mnemonic  operands`
            let (mut word, mut after) = (&first[..], &rest[..]);
            while X64_PREFIXES.contains(&word) && !after.is_empty() {
                (word, after) =
                    after.split_at(after.find(char::is_whitespace).unwrap_or(after.len()));
                after = after.trim_start();
            }
            let (mnemonic, operands) = (word, after);
            // Through a register or memory it is `*…`, and there is no address.
            let target = operands
                .strip_prefix("0x")
                .and_then(hex_prefix)
                .and_then(|t| t.0.checked_sub(self.bias));
            out.push(Instruction {
                at: at.wrapping_sub(self.bias),
                kind: kind_x64(mnemonic),
                target,
                indexed_load: None,
            });
        }
        Ok(out)
    }

    /// The nodes that hold markers, in the order of the markers.
    fn marked(&self) -> Result<Vec<usize>> {
        let mut nodes = Vec::new();
        for &(site, _) in self.markers {
            let n = self
                .nodes
                .find(site)
                .ok_or("a marker lies outside every piece")?;
            if !nodes.contains(&n) {
                nodes.push(n);
            }
        }
        Ok(nodes)
    }

    pub(super) fn split(&self) -> Result<Blocks> {
        let markers: HashMap<u64, Marker> = self.markers.iter().copied().collect();
        let mut returns = HashMap::new();
        let mut blocks = Blocks::default();
        for n in self.marked()? {
            let (start, end) = (self.nodes.addr[n], self.nodes.end(n));
            let inside = |a: Option<u64>| a.filter(|&a| a >= start && a < end);
            let code = self.disassemble(start, end)?;
            if code.first().map(|x| x.at) != Some(start) {
                fail!("cannot disassemble the function at {start:x}");
            }
            let is_instruction: HashSet<u64> = code.iter().map(|x| x.at).collect();
            let through_register = self.jump_table_targets(&code, &is_instruction, start, end);

            let mut leaders: BTreeSet<u64> =
                through_register.iter().copied().chain([start]).collect();
            for (i, x) in code.iter().enumerate() {
                let marker = markers.get(&x.at);
                if marker.is_none() && !x.ends_block(self.arch) {
                    continue;
                }
                leaders.extend(code.get(i + 1).map(|next| next.at));
                match marker {
                    Some(m) => leaders.extend([m.skip]),
                    None if x.kind != Kind::Call => leaders.extend(inside(x.target)),
                    None => {}
                }
            }
            let starts: Vec<u64> = leaders
                .iter()
                .copied()
                .filter(|a| is_instruction.contains(a))
                .collect();
            let first = blocks.all.len();
            let starting_at = |a: u64| starts.binary_search(&a).ok().map(|i| (first + i) as u32);
            for (i, &a) in starts.iter().enumerate() {
                let end = starts.get(i + 1).copied().unwrap_or(end);
                blocks.all.push(Block {
                    start: a,
                    end,
                    succ: Vec::new(),
                    marker: None,
                });
            }
            blocks.of.push((n, (first, starts.len())));

            for (i, x) in code.iter().enumerate() {
                let next_at = code.get(i + 1).map(|next| next.at);
                if next_at.is_some_and(|a| !leaders.contains(&a)) {
                    continue; // not the last instruction of its block
                }
                let next = next_at.and_then(starting_at);
                let to = inside(x.target).and_then(starting_at);
                let block = &mut blocks.all[first + starts.partition_point(|&a| a <= x.at) - 1];
                if let Some(m) = markers.get(&x.at) {
                    let no = starting_at(m.skip).ok_or("a marker skips out of its function")?;
                    block.marker = Some(BlockMarker {
                        id: m.id,
                        yes: next,
                        no,
                    });
                    continue;
                }
                match x.kind {
                    // x86-64: without a target it goes through a jump table, whose entries are relocations into this function.
                    Kind::Jump => block.succ.extend(to),
                    Kind::ConditionalJump => block.succ.extend(to.into_iter().chain(next)),
                    Kind::JumpThroughRegister => block
                        .succ
                        .extend(through_register.iter().filter_map(|&t| starting_at(t))),
                    Kind::Return | Kind::Trap => {}
                    Kind::Plain | Kind::Address => block.succ.extend(next),
                    Kind::Call => {
                        let comes_back = match x.target {
                            Some(callee) => !self.cannot_return(callee, &mut returns)?,
                            None => true,
                        };
                        block.succ.extend(next.filter(|_| comes_back));
                    }
                }
            }
        }
        Ok(blocks)
    }

    /// What follows a call is normally reached from it. Not if the callee cannot return, and compilers do place unrelated
    /// blocks right after such calls. A function with no return and no jump that leaves it cannot return.
    /// Everything else is taken to return: being wrong in that direction only keeps bytes.
    fn cannot_return(&self, callee: u64, known: &mut HashMap<usize, bool>) -> Result<bool> {
        if self.does_not_return.contains(&callee) {
            return Ok(true);
        }
        let Some(n) = self
            .nodes
            .find(callee)
            .filter(|&n| (self.is_code)(n) && self.nodes.addr[n] == callee)
        else {
            return Ok(false);
        };
        if let Some(&returns) = known.get(&n) {
            return Ok(!returns);
        }
        let (start, end) = (self.nodes.addr[n], self.nodes.end(n));
        let returns = self
            .disassemble(start, end)?
            .iter()
            .any(|x| x.may_leave(start, end));
        known.insert(n, returns);
        Ok(!returns)
    }

    /// arm64: where can a jump through a register go? A jump table holds offsets from an anchor inside the function: 32 bits,
    /// or 8 or 16 bits that count instructions. The assembler resolved them, so no relocation describes them, and nothing
    /// says how long a table is. LLVM writes the dispatch as one sequence, `adr anchor; ldrb|ldrh|ldrsw entry, [table,
    /// index]; add`, so what follows the `adr` says how wide the entries are; if it is something else, take every width.
    /// Which table goes with which anchor is not worked out. Take a superset: every constant the function takes the
    /// address of, read as a table from every anchor, up to the first entry that is no instruction of this function.
    fn jump_table_targets(
        &self,
        code: &[Instruction],
        is_instruction: &HashSet<u64>,
        start: u64,
        end: u64,
    ) -> BTreeSet<u64> {
        let mut anchors: Vec<(u64, u64)> = Vec::new();
        for (i, x) in code.iter().enumerate() {
            let Some(anchor) = x
                .target
                .filter(|&t| x.kind == Kind::Address && t >= start && t < end)
            else {
                continue;
            };
            match code.get(i + 1).and_then(|load| load.indexed_load) {
                Some(width) => anchors.push((anchor, width)),
                None => anchors.extend([1, 2, 4].map(|width| (anchor, width))),
            }
        }
        let mut targets = BTreeSet::new();
        if anchors.is_empty() {
            return targets;
        }
        for (table, table_end) in (self.constants_taken_by)(start, end) {
            for &(anchor, width) in &anchors {
                let mut a = table;
                while a + width <= table_end {
                    let o = (self.file_offset)(a);
                    let offset = match width {
                        4 => i64::from(self.bytes.i32(o)),
                        2 => 4 * i64::from(self.bytes.u16(o)),
                        _ => 4 * i64::from(self.bytes.u8(o)),
                    };
                    let target = anchor.wrapping_add_signed(offset);
                    if !is_instruction.contains(&target) {
                        break;
                    }
                    targets.insert(target);
                    a += width;
                }
            }
        }
        targets
    }
}

/// The bytes that replace a marker once its feature is excluded: a jump to the `false` side.
pub(super) fn marker_patch(
    arch: Arch,
    bytes: Data<'_>,
    at: usize,
    site: u64,
    marker: Marker,
) -> Result<Patch> {
    let distance = marker.skip.wrapping_sub(site).cast_signed();
    let jump: Vec<u8> = match arch {
        Arch::X64 => {
            // nopl id(%rax)
            if bytes.0[at..at + 3] != [0x0f, 0x1f, 0x80] || bytes.u32(at + 3) != marker.id {
                fail!("not a marker at {site:x}");
            }
            // jmp rel32, then a 2-byte nop
            [
                &[0xe9][..],
                &((distance - 5) as i32).to_le_bytes(),
                &[0x66, 0x90],
            ]
            .concat()
        }
        Arch::Arm64 => {
            // movz xzr, #id
            if bytes.u32(at) != 0xd280_001f | (marker.id << 5) {
                fail!("not a marker at {site:x}");
            }
            (0x1400_0000 | ((distance / 4) as u32 & 0x03ff_ffff))
                .to_le_bytes()
                .to_vec() // b skip
        }
    };
    Ok(Patch {
        place: site,
        feature: marker.id,
        bytes: jump.into(),
    })
}
