//! The kinds of nodes in test programs. They mean what patchpoints with the same effects and behaviour mean, except
//! that the state matters to exits only, and that those which write nothing and fence nothing leave no trace.
//! What is distinct gives a value that equals no other.

use std::sync::OnceLock;

use bun_engine_codegen::ir::{EffectFlags, Effects, Entity, Heap, NodeInfo, NodeKind, Token, Type};

use super::memory::position;
use super::vocabulary::{Behaviour, token};

/// Programs start with a heap for each position.
fn heap_at(position: u32) -> Heap {
    const PREDEFINED: usize = 2;
    Heap::from_index(PREDEFINED + position as usize)
}

fn table() -> &'static (Vec<NodeInfo>, Vec<Behaviour>) {
    static TABLE: OnceLock<(Vec<NodeInfo>, Vec<Behaviour>)> = OnceLock::new();
    TABLE.get_or_init(|| {
        const PAIR: &[Type] = &[Type::I64, Type::I32];
        let (exits, depends) = (EffectFlags::EXITS, EffectFlags::CONTROL_DEPENDENT);
        let (none, nothing, all) = (EffectFlags::empty(), Heap::NOTHING, Heap::EVERYTHING);
        let (field, array) = (heap_at(position::LINK + 1), heap_at(position::FIRST_ARRAY));
        let plain = Behaviour::empty();
        let (small, pointer) = (Behaviour::SMALL_RESULTS, Behaviour::THROUGH_POINTER);
        let (same, by_operand) = (Behaviour::GIVES_OPERAND, Behaviour::EXITS_BY_OPERAND);
        let kinds = [
            ("Mix", nothing, nothing, none, plain, &[][..]),
            ("MixSmall", nothing, nothing, none, small, &[]),
            ("MixPair", nothing, nothing, none, plain, PAIR),
            (
                "OfNonzero",
                nothing,
                nothing,
                depends,
                Behaviour::NEEDS_NONZERO,
                &[],
            ),
            ("Pin", nothing, nothing, depends, same, &[]),
            ("ReadFields", field, nothing, none, plain, &[]),
            ("ReadArray", array, nothing, none, small, PAIR),
            ("ReadWord", all, nothing, depends, pointer, &[]),
            ("WriteFields", nothing, field, none, plain, &[]),
            ("UpdateArray", array, array, none, plain, &[]),
            ("WriteWord", nothing, all, depends, pointer, &[]),
            ("Test", nothing, nothing, exits, by_operand, &[]),
            ("Cast", nothing, nothing, exits, by_operand | same, &[]),
            (
                "TestFields",
                field,
                nothing,
                exits,
                Behaviour::EXITS_BY_CHANCE,
                &[],
            ),
            ("Keep", nothing, nothing, EffectFlags::KEPT, plain, &[]),
            ("Fence", array, nothing, EffectFlags::FENCE, plain, &[]),
            (
                "Call",
                all,
                all,
                Effects::CALL.flags,
                Behaviour::EXITS_BY_CHANCE,
                &[],
            ),
            ("New", nothing, nothing, EffectFlags::DISTINCT, plain, &[]),
            (
                "Choose",
                nothing,
                nothing,
                EffectFlags::ENDS_BLOCK,
                Behaviour::GOES_BY_OPERAND,
                &[],
            ),
        ];
        let describe = |(name, reads, writes, flags, behaviour, elements)| {
            let effects = Effects {
                reads,
                writes,
                flags,
            };
            (
                NodeInfo {
                    name,
                    effects,
                    elements,
                },
                behaviour,
            )
        };
        kinds.into_iter().map(describe).unzip()
    })
}

pub(crate) fn kinds() -> &'static [NodeInfo] {
    &table().0
}

pub(crate) fn kind_named(name: &str) -> NodeKind {
    NodeKind(kinds().iter().position(|info| info.name == name).unwrap() as u16)
}

pub(crate) fn behaviour_of(kind: NodeKind) -> Behaviour {
    table().1[usize::from(kind.0)]
}

pub(crate) fn token_of(kind: NodeKind, data: u32) -> Token {
    const FIRST: u32 = 1 << 20;
    token(FIRST + data * 64 + u32::from(kind.0), behaviour_of(kind))
}
