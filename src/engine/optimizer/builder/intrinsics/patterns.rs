//! RegExp objects as operands of forms.

use bun_engine_asm::{Sign, Size};
use bun_engine_codegen::ir::{Access, AccessFlags, Type, Value as Ssa};
use bun_engine_regexp::Flags;
use bun_engine_vm::direct::Searches;
use bun_engine_vm::{
    CellType, Gc, GlobalObject, RealmSlot, RealmWatchpoint, RegExp, RegExpObject,
    RegExpStringIterator, SpeculatedType as T, Value,
};

use crate::builder::Builder;
use crate::graph::{ExitKind, heaps};
use crate::runtime::cells::constant_of_graph;

const LAST_INDEX: i32 = RegExpObject::OFFSET_OF_LAST_INDEX as i32;
const REGEXP_AND_FLAGS: i32 = RegExpObject::OFFSET_OF_REGEXP_AND_FLAGS as i32;

impl Builder<'_> {
    pub(super) fn expects_plain_regexp(&mut self, value: Ssa, realm: Gc<GlobalObject>) -> bool {
        self.expects_original(value, T::REGEXP_OBJECT, realm, RealmSlot::regexp_shape)
    }

    /// Gives the object and its `lastIndex`.
    pub(super) fn check_plain_regexp(&mut self, value: Ssa, realm: Gc<GlobalObject>) -> (Ssa, Ssa) {
        let object = self.check_original(value, T::REGEXP_OBJECT, realm, RealmSlot::regexp_shape);
        let place = (object, LAST_INDEX, heaps::LAST_INDEX);
        let last_index = self.load_value_of_type(place, T::INT32, T::HEAP_TOP);
        self.check_type_or(last_index, T::BOXED_NUMBER, ExitKind::ExoticObject);
        (object, last_index)
    }

    pub(super) fn check_plain_match_iterator(
        &mut self,
        value: Ssa,
        realm: Gc<GlobalObject>,
    ) -> Ssa {
        let iterator = self.check_cell_type(value, CellType::RegExpStringIterator);
        let offset = RegExpStringIterator::OFFSET_OF_MATCHER;
        let matcher = self.load_immutable(Type::I64, iterator, offset);
        self.graph.declare(matcher, T::OBJECT);
        self.graph.predict(matcher, T::REGEXP_OBJECT);
        self.check_type_or(matcher, T::REGEXP_OBJECT, ExitKind::ExoticObject);
        self.check_plain_regexp(matcher, realm);
        iterator
    }

    fn known_field(
        &self,
        object: Ssa,
        offset: i32,
        heap: bun_engine_codegen::ir::Heap,
    ) -> Option<u64> {
        let found = self
            .knowledge
            .field(self.graph.root(object), offset, heap)?;
        self.graph.constant(found)
    }

    /// Of an object of that realm. The code counts on the answer.
    pub(super) fn known_pattern(
        &mut self,
        object: Ssa,
        realm: Gc<GlobalObject>,
    ) -> Option<Gc<RegExp>> {
        if let Some(word) = self.known_field(object, REGEXP_AND_FLAGS, heaps::OTHER_FIELDS) {
            let address = word & !(RegExpObject::FLAG_MASK as u64);
            return constant_of_graph(&self.graph, address)?.downcast();
        }
        let constant = self.constant_cell::<RegExpObject>(object)?;
        let unchanged = realm.watchpoints(self.vm, RealmWatchpoint::NoRegExpIsRecompiled);
        self.watch(unchanged).then(|| constant.regexp())
    }

    pub(super) fn expects_pattern(
        &mut self,
        object: Ssa,
        searches: Searches,
        realm: Gc<GlobalObject>,
        may_guess: bool,
    ) -> bool {
        let is_at_start = searches != Searches::AllFromStart
            || self.known_field(object, LAST_INDEX, heaps::LAST_INDEX)
                == Some(Value::ZERO.to_bits());
        match self.known_pattern(object, realm) {
            Some(known) => searches.suits(known.flags()) && (is_at_start || may_guess),
            None => searches == Searches::AnyWay || may_guess,
        }
    }

    pub(super) fn pattern_of(
        &mut self,
        value: Ssa,
        searches: Searches,
        realm: Gc<GlobalObject>,
    ) -> Ssa {
        let (object, last_index) = self.check_plain_regexp(value, realm);
        if searches == Searches::AllFromStart {
            let last_index = self.graph.root(last_index);
            let is_elsewhere = self.ir().not_equal(last_index, Value::ZERO.to_bits());
            self.exit_if(is_elsewhere, ExitKind::ExoticObject);
        }
        if let Some(known) = self.known_pattern(object, realm) {
            return self.cell(known.cell());
        }
        let pattern = self.load_pattern(object);
        let (mask, expected) = match searches {
            Searches::AnyWay => return pattern,
            Searches::Once => (Flags::GLOBAL | Flags::STICKY, Flags::empty()),
            Searches::AllFromStart => (Flags::GLOBAL, Flags::GLOBAL),
        };
        let flags = self.load_flags(pattern);
        let mut ir = self.ir();
        let found = ir.and(flags, u32::from(mask.bits()));
        let differs = ir.not_equal(found, u32::from(expected.bits()));
        self.exit_if(differs, ExitKind::ExoticObject);
        pattern
    }

    pub(super) fn load_pattern(&mut self, object: Ssa) -> Ssa {
        let word = self.load(Type::I64, object, REGEXP_AND_FLAGS, heaps::OTHER_FIELDS);
        self.ir().and(word, !RegExpObject::FLAG_MASK)
    }

    pub(super) fn load_flags(&mut self, pattern: Ssa) -> Ssa {
        let flags = AccessFlags::ALWAYS_READABLE | AccessFlags::IMMUTABLE;
        let (access, offset) = (
            Access::new(heaps::OTHER_FIELDS, flags),
            RegExp::OFFSET_OF_FLAGS,
        );
        (self.ir()).load_narrow(Size::S8, Sign::Unsigned, pattern, offset as i32, access)
    }
}
