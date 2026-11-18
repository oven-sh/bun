//! Literals of regular expressions.

use bun_engine_bytecode::{ConstantIndex, MetadataKind, Register, op};
use bun_engine_codegen::ir::{Type, Value as Ssa};
use bun_engine_text::names;
use bun_engine_vm::code::metadata::StrongCell;
use bun_engine_vm::{Gc, RealmWatchpoint, RegExp, RegExpObject, Value};

use super::Builder;
use crate::graph::{ExitKind, ShapeSet, heaps};

const LAST_INDEX: i32 = RegExpObject::OFFSET_OF_LAST_INDEX as i32;
const REGEXP_AND_FLAGS: i32 = RegExpObject::OFFSET_OF_REGEXP_AND_FLAGS as i32;

impl Builder<'_> {
    fn pattern(&self, constant: ConstantIndex) -> Gc<RegExp> {
        let pattern = self.frame().code_block.constant(constant.0);
        pattern.expect("a pattern").cast()
    }

    pub(super) fn new_regexp(&mut self, dst: Register, constant: ConstantIndex) {
        let (regexp, shape) = (self.pattern(constant), self.global().regexp_shape(self.vm));
        if !regexp.is_valid() {
            return self.exit_to_throw();
        }
        let allocation = self.allocation(shape, size_of::<RegExpObject>());
        let object = self.new_instance(allocation.expect("small"));
        let (heap, zero) = (self.named_heap(names::lastIndex), self.value(Value::ZERO));
        self.initialize(object, LAST_INDEX, heap, zero);
        let regexp = self.cell(regexp.cell());
        self.initialize(object, REGEXP_AND_FLAGS, heaps::OTHER_FIELDS, regexp);
        self.set(dst, object);
    }

    fn shared_regexp(&mut self, op: op::NewSharedRegExp) -> Option<Ssa> {
        let (code_block, kind) = (self.frame().code_block, MetadataKind::SharedRegExp);
        let shared = code_block
            .checked_metadata::<StrongCell>(kind, op.metadata)
            .0
            .get()?;
        if self.has_exited(ExitKind::BadShape)
            || self.has_exited(ExitKind::BadIdentity)
            || !self.watch_realm(RealmWatchpoint::RegExpPrimordialProperties)
            || op.for_test && !self.watch_realm(RealmWatchpoint::RegExpPrototypeTest)
        {
            return None;
        }
        let shapes = ShapeSet::single(self.shape(self.global().regexp_shape(self.vm)));
        let object = self.cell(shared);
        let checked = self.check_shapes(object, shapes);
        let word = self.pattern(op.regexp).address() | RegExpObject::IS_SHARED_LITERAL;
        let untouched = [
            (
                LAST_INDEX,
                self.named_heap(names::lastIndex),
                Value::ZERO.to_bits(),
            ),
            (REGEXP_AND_FLAGS, heaps::OTHER_FIELDS, word as u64),
        ];
        for (offset, heap, expected) in untouched {
            let found = self.load(Type::I64, checked, offset, heap);
            let differs = self.ir().not_equal(found, expected);
            self.exit_if(differs, ExitKind::BadIdentity);
        }
        Some(object)
    }

    pub(super) fn new_shared_regexp(&mut self, op: op::NewSharedRegExp) {
        match self.shared_regexp(op) {
            Some(object) => self.set(op.dst, object),
            None => self.new_regexp(op.dst, op.regexp),
        }
    }
}
