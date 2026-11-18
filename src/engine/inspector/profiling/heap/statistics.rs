use bun_engine_vm::{AsciiLiteral, FastHashMap, JsCell, Vm, ascii_literal};

use super::class_name;

/// By the address of the name. Classes may have equal names.
#[derive(Default)]
struct Counts(FastHashMap<usize, (AsciiLiteral, usize)>);

impl Counts {
    fn add(&mut self, cell: &JsCell) {
        let name = class_name(cell);
        let key = name.as_str().as_ptr().addr();
        self.0.entry(key).or_insert((name, 0)).1 += 1;
    }

    fn into_vec(self) -> Vec<(AsciiLiteral, usize)> {
        let mut counts: Vec<_> = self.0.into_values().collect();
        counts.sort_unstable_by_key(|(name, _)| name.as_str());
        counts.dedup_by(|next, kept| {
            let is_same = next.0.as_str() == kept.0.as_str();
            kept.1 += if is_same { next.1 } else { 0 };
            is_same
        });
        counts
    }
}

/// How many there are of each class, and how many functions have their bytecode in memory.
pub fn count_cells(vm: &Vm) -> Vec<(AsciiLiteral, usize)> {
    let mut counts = Counts::default();
    vm.heap.for_each_live_cell(|cell| counts.add(&cell));
    let mut counts = counts.into_vec();
    if let bytecodes @ 1.. = vm.bytecode_count() {
        counts.push((ascii_literal!("UnlinkedFunctionCodeBlock"), bytecodes));
    }
    counts
}

pub fn count_protected_cells(vm: &Vm) -> Vec<(AsciiLiteral, usize)> {
    let mut counts = Counts::default();
    vm.heap.for_each_protected_cell(|cell| counts.add(&cell));
    counts.into_vec()
}
