//! What holds once there are no more nodes.

use bun_engine_codegen::BitSet;
use bun_engine_codegen::ir::{
    AccessFlags, Block, EffectFlags, Entity, Function, Heap, Op, Store, Value as Ssa,
};

use crate::graph::heaps;

/// Memory that has just been allocated.
#[derive(Clone, Copy)]
pub(super) struct Allocated {
    pub(super) address: Ssa,
    /// What the collector looks at.
    pub(super) size: u32,
    /// The object whose storage it is, if any.
    pub(super) owner: Ssa,
}

/// Each word has been written to before anything else can look at it.
fn check_is_completed(function: &Function, allocated: Allocated) -> Result<(), String> {
    let (cell, size) = (allocated.address, allocated.size);
    let words = (0..size.div_ceil(8) as i32).collect::<Vec<_>>();
    let mut is_seen = BitSet::with_size(function.block_count());
    let mut ways = vec![(function.next(cell), words, vec![cell])];
    while let Some((mut value, mut missing, mut names)) = ways.pop() {
        while !missing.is_empty() {
            let effects = function.effects(value);
            if let Op::Store {
                kind, args, offset, ..
            } = *function.op(value)
                && names.contains(&args[1])
            {
                let bytes = match kind {
                    Store::Narrow(size) => size.bytes().into(),
                    Store::Full => function.type_of(args[0]).bytes(),
                };
                let written = offset / 8..=(offset + bytes as i32 - 1) / 8;
                missing.retain(|it| !written.contains(it));
            } else if let Op::Load {
                address, access, ..
            } = *function.op(value)
                && (address, access.heap()) == (allocated.owner, heaps::STORAGE)
            {
                names.push(value);
            } else if effects.has(EffectFlags::EXITS)
                || effects.reads == Heap::EVERYTHING && effects.writes_memory()
            {
                let (value, cell) = (value.index(), cell.index());
                return Err(format!("v{value} finds v{cell} without {missing:?}"));
            } else if effects.has(EffectFlags::ENDS_BLOCK) {
                for edge in function.successors(function.block_of(value)) {
                    let target: Block = function.target(edge);
                    let pairs = function.args(edge).iter().zip(function.params(target));
                    let renamed = pairs.filter(|it| names.contains(it.0)).map(|it| *it.1);
                    let names = names.iter().copied().chain(renamed).collect();
                    if is_seen.insert(target.index()) {
                        ways.push((function.first(target), missing.clone(), names));
                    }
                }
                break;
            }
            value = function.next(value);
        }
    }
    Ok(())
}

pub(super) fn validate(function: &Function, allocated: &[Allocated]) -> Result<(), String> {
    for value in function.blocks().flat_map(|it| function.instructions(it)) {
        if let Op::Load {
            address, access, ..
        } = *function.op(value)
            && access.has(AccessFlags::ALWAYS_READABLE)
            && !function.op(address).is_floating()
        {
            return Err(format!("v{} is tied to no check", value.index()));
        }
    }
    (allocated.iter()).try_for_each(|&it| check_is_completed(function, it))
}
