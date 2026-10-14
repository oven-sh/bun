//! Is the control flow that [`super::blocks`] reconstructs by disassembly sound? Compare it with the compiler's own.
//!
//! LLVM can record every machine basic block and its successors (`SHT_LLVM_BB_ADDR_MAP` with branch probabilities:
//! `--lto-basic-block-address-map -mllvm -pgo-analysis-map=br-prob`, which add no code). ELF only. For each function
//! that holds markers and each combination of excluded features, walk the compiler's graph from the entry, taking each
//! marker's side. Every block reached that way has to be live in the reconstruction. The reverse only costs bytes.

use std::collections::HashMap;
use std::fmt::Write as _;
use std::io::{BufRead, BufReader};
use std::path::Path;
use std::process::{Command, Stdio};

use super::blocks::Marker;
use super::{Result, fail};

pub(super) struct Reconstruction {
    /// {name, start, end, {first block, how many}}
    pub(super) functions: Vec<(String, u64, u64, (usize, usize))>,
    pub(super) blocks: Vec<(u64, u64)>,
    pub(super) markers: Vec<(u64, Marker)>,
    /// {the features excluded, which blocks are live}
    pub(super) combinations: Vec<(Vec<u32>, Vec<bool>)>,
}

#[derive(Default)]
struct Theirs {
    id: u64,
    start: u64,
    size: u64,
    succ: Vec<u64>,
}

fn number(text: &str) -> u64 {
    match text.strip_prefix("0x") {
        Some(hex) => u64::from_str_radix(hex, 16).unwrap_or(0),
        None => text.parse().unwrap_or(0),
    }
}

pub(super) fn check(binary: &Path, readobj: &Path, ours: &Reconstruction) -> Result<String> {
    // The dump of the whole binary is large: stream it and keep the functions that hold markers.
    let mut compiler: HashMap<u64, Vec<Theirs>> = HashMap::new();
    let mut dump = Command::new(readobj)
        .arg("--bb-addr-map")
        .arg(binary)
        .stdout(Stdio::piped())
        .spawn()
        .map_err(|e| format!("{}: {e}", readobj.display()))?;
    let (mut current, mut base, mut in_analyses, mut analysed) = (None, 0, false, 0usize);
    for line in BufReader::new(dump.stdout.take().ok_or("no output")?).lines() {
        let line = line.map_err(|e| e.to_string())?;
        // `  Key: value`
        let (key, value) = line.trim_start().split_once(": ").unwrap_or(("", ""));
        let value = number(value.split_whitespace().next().unwrap_or(""));
        if key == "At" {
            current = ours.functions.iter().any(|f| f.1 == value).then_some(value);
            if let Some(at) = current {
                compiler.insert(at, Vec::new());
            }
            (in_analyses, analysed) = (false, 0);
        }
        let Some(blocks) = current.and_then(|at| compiler.get_mut(&at)) else {
            continue;
        };
        if line.contains("PGO analyses") {
            in_analyses = true;
        } else if key == "Base Address" {
            base = value;
        } else if in_analyses && line.contains("Successors [") {
            analysed += 1;
        } else if in_analyses && key == "ID" {
            blocks[analysed - 1].succ.push(value);
        } else if !in_analyses && key == "ID" {
            blocks.push(Theirs {
                id: value,
                ..Default::default()
            });
        } else if let (false, Some(last)) = (in_analyses, blocks.last_mut()) {
            match key {
                "Offset" => last.start = base + value,
                "Size" => last.size = value,
                _ => {}
            }
        }
    }
    dump.wait().map_err(|e| e.to_string())?;

    let mut report = String::new();
    let (mut checked, mut unsound, mut extra_bytes, mut live_bytes) = (0, 0, 0, 0);
    for (name, start, end, (first, count)) in &ours.functions {
        let theirs = compiler
            .get(start)
            .ok_or_else(|| format!("the compiler's map has no {name}"))?;
        let holding = |a: u64| {
            theirs
                .iter()
                .position(|b| a >= b.start && a < b.start + b.size)
        };
        let mut marker_of: HashMap<usize, Marker> = HashMap::new();
        for (site, marker) in ours.markers.iter().filter(|m| m.0 >= *start && m.0 < *end) {
            marker_of.insert(holding(*site).ok_or("a marker is in no block")?, *marker);
        }
        for (excluded, live) in &ours.combinations {
            let mut reached = vec![holding(*start).ok_or("the entry is in no block")?];
            let mut i = 0;
            while let Some(&b) = reached.get(i) {
                i += 1;
                for id in &theirs[b].succ {
                    let next = theirs
                        .iter()
                        .position(|t| t.id == *id)
                        .ok_or("an unknown successor")?;
                    // the marker's two successors: the `false` side, and whatever follows the marker
                    let is_other_side = marker_of.get(&b).is_some_and(|m| {
                        (theirs[next].start == m.skip) != excluded.contains(&m.id)
                            && theirs[b].succ.len() > 1
                    });
                    if !is_other_side && !reached.contains(&next) {
                        reached.push(next);
                    }
                }
            }
            for i in *first..first + count {
                let (start, end) = ours.blocks[i];
                let overlaps = |&b: &usize| {
                    theirs[b].size != 0
                        && start < theirs[b].start + theirs[b].size
                        && theirs[b].start < end
                };
                let is_live_there = reached.iter().any(overlaps);
                checked += 1;
                if is_live_there && !live[i] {
                    unsound += 1;
                    let _ = writeln!(
                        report,
                        "UNSOUND: {name} {start:x}-{end:x} runs with {excluded:?} excluded, and is taken for dead"
                    );
                }
                if live[i] {
                    live_bytes += end - start;
                    if !is_live_there {
                        extra_bytes += end - start;
                    }
                }
            }
        }
        let _ = writeln!(
            report,
            "{name:.90}: {} compiler blocks, {count} reconstructed",
            theirs.len()
        );
    }
    let _ = writeln!(
        report,
        "{} functions x {} combinations, {checked} block states checked: {unsound} unsound; kept though the compiler's graph \
         does not reach it: {extra_bytes} of {live_bytes} live bytes",
        ours.functions.len(),
        ours.combinations.len(),
    );
    if unsound != 0 {
        fail!("{report}");
    }
    Ok(report)
}
