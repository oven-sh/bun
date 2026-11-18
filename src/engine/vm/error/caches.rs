//! What errors that come from the same places would look up again and again.

use core::cell::Cell;

use bun_engine_text::names;

use crate::heap::Survivors;
use crate::{CodeBlock, Gc, JsCell, JsObject, LineColumn, PropertyOffset, ShapeId, Value, Vm};

#[derive(Clone, Copy, Default)]
struct Line {
    /// The address, or zero.
    code_block: usize,
    bytecode_offset: u32,
    position: LineColumn,
}

const LINE_COUNT: usize = 128;

pub(super) struct Caches {
    lines: [Cell<Line>; LINE_COUNT],
    /// Where an `Error` constructor of that shape has `stackTraceLimit`.
    limit: Cell<(ShapeId, PropertyOffset)>,
}

impl Default for Caches {
    fn default() -> Caches {
        Caches {
            lines: core::array::from_fn(|_| Cell::default()),
            limit: Cell::new((ShapeId::NONE, PropertyOffset::INVALID)),
        }
    }
}

impl Caches {
    pub(super) fn prune(&self, survivors: &Survivors) {
        self.limit.set((ShapeId::NONE, PropertyOffset::INVALID));
        for line in &self.lines {
            let address = line.get().code_block;
            // SAFETY: alive until this collection, and not swept yet.
            if address != 0 && !survivors.contains(unsafe { Gc::<JsCell>::from_address(address) }) {
                line.take();
            }
        }
    }

    #[inline]
    pub(super) fn stack_trace_limit(&self, constructor: &JsObject) -> Option<Value> {
        let (shape, offset) = self.limit.get();
        if shape == constructor.shape_id() {
            // SAFETY: from the shape, which does not lose a property in place.
            return Some(unsafe { constructor.get_direct_unchecked(offset) });
        }
        let shape = constructor.shape();
        let (offset, _) = shape.get(names::stackTraceLimit)?;
        if !shape.is_uncacheable_dictionary() {
            self.limit.set((shape.id(), offset));
        }
        Some(constructor.get_direct_at(offset))
    }
}

impl CodeBlock {
    pub fn line_column(&self, bytecode_offset: u32) -> LineColumn {
        let vm: &Vm = self.heap().vm();
        let hash = (self.address() >> 4) ^ (bytecode_offset as usize).wrapping_mul(31);
        let line = &vm.services.errors.caches.lines[hash % LINE_COUNT];
        let cached = line.get();
        if cached.code_block == self.address() && cached.bytecode_offset == bytecode_offset {
            return cached.position;
        }
        let divot = self.position(bytecode_offset).divot;
        let position = self.source_provider().position_in_document(divot);
        line.set(Line {
            code_block: self.address(),
            bytecode_offset,
            position,
        });
        position
    }
}
