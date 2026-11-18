//! What the turns of a loop may change of what is there before the loop.

use bun_engine_codegen::analysis::{Cfg, Loop};
use bun_engine_codegen::ir::{Entity, Function, Heap, Op, Value as Ssa};

use crate::graph::{Graph, Kind, ShapeIndex, ShapeSet, heaps};

const BITS: usize = u64::BITS as usize;

/// A row for each loop, with a bit for each heap and then one for each shape that an object leaves or gets.
pub(super) struct LoopWrites {
    rows: Vec<u64>,
    words: usize,
    words_of_heaps: usize,
}

impl LoopWrites {
    pub(super) fn new(graph: &Graph, cfg: &Cfg) -> Self {
        let words_of_heaps = graph.function.heap_count().div_ceil(BITS);
        let words = words_of_heaps + graph.shapes.len().div_ceil(BITS);
        let mut writes = Self {
            rows: vec![0; cfg.loops().len() * words],
            words,
            words_of_heaps,
        };
        for &block in cfg.order() {
            if let Some(around) = cfg.loop_of(block).expand() {
                for value in graph.function.instructions(block) {
                    writes.note(graph, cfg, around, value);
                }
            }
        }
        for inner in cfg.loops().keys().rev() {
            if let Some(outer) = cfg.loops()[inner].parent.expand() {
                let (before, after) = writes.rows.split_at_mut(inner.index() * words);
                let pairs = before[outer.index() * words..]
                    .iter_mut()
                    .zip(&after[..words]);
                pairs.for_each(|(outer, inner)| *outer |= inner);
            }
        }
        writes
    }

    fn bit_of(&self, shape: ShapeIndex) -> usize {
        self.words_of_heaps * BITS + shape.0 as usize
    }

    fn note(&mut self, graph: &Graph, cfg: &Cfg, around: Loop, value: Ssa) {
        let heap = graph.function.effects(value).writes;
        if heap == Heap::NOTHING {
            return;
        }
        let (bits, object) = match (*graph.function.op(value), graph.node(value)) {
            (Op::Store { args, .. }, _) => ([heap.index(); 2], graph.object_at(args[1])),
            (_, Some((Kind::SetShape, data))) => {
                let transition = graph.transitions[data as usize];
                let bits = [transition.from, transition.to].map(|it| self.bit_of(it));
                (bits, graph.root(graph.operand(value, 0)))
            }
            (_, Some((Kind::GrowSlots, _))) => (
                [heaps::STORAGE.index(); 2],
                graph.root(graph.operand(value, 0)),
            ),
            _ => ([heap.index(); 2], Ssa::NONE),
        };
        let is_of_this_turn = !object.is_none()
            && graph.kind(object).is_some_and(Kind::allocates)
            && cfg.includes(around, graph.function.block_of(object));
        if !is_of_this_turn {
            let row = &mut self.rows[around.index() * self.words..];
            (bits.iter()).for_each(|&bit| row[bit / BITS] |= 1 << (bit % BITS));
        }
    }

    fn row(&self, of: Loop) -> &[u64] {
        &self.rows[of.index() * self.words..][..self.words]
    }

    fn has(&self, of: Loop, bit: usize) -> bool {
        (self.row(of).get(bit / BITS)).is_some_and(|word| word >> (bit % BITS) & 1 != 0)
    }

    /// For `SHAPE` this leaves out the transitions that are known.
    pub(super) fn may_write(&self, function: &Function, of: Loop, heap: Heap) -> bool {
        let row = &self.row(of)[..self.words_of_heaps];
        let (candidates, mask) = if heaps::is_group(heap) {
            (row, u64::MAX)
        } else {
            (&row[..1], heaps::GROUPS)
        };
        let overlaps = |(index, &word): (usize, &u64)| {
            let mut rest = word & mask;
            while rest != 0 {
                let written = Heap::from_index(index * BITS + rest.trailing_zeros() as usize);
                if function.may_alias(written, heap) {
                    return true;
                }
                rest &= rest - 1;
            }
            false
        };
        self.has(of, heap.index()) || candidates.iter().enumerate().any(overlaps)
    }

    /// Whether a known transition is from or to one of them.
    pub(super) fn has_transition(&self, graph: &Graph, of: Loop, shapes: ShapeSet) -> bool {
        if shapes == ShapeSet::ANY {
            let row = &self.row(of)[self.words_of_heaps..];
            return row.iter().any(|&word| word != 0);
        }
        let mut members = graph.shapes.members(shapes).iter();
        members.any(|&shape| self.has(of, self.bit_of(shape)))
    }
}
