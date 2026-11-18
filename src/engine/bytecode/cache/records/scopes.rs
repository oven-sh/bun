use core::cell::OnceCell;
use std::rc::Rc;

use bun_engine_syntax::Name;
use bun_engine_text::{Identifier, StringRef, Text};
use hashbrown::HashTable;

use super::{Decoder, Writer};
use crate::bytes::Reader;
use crate::cache::format::{HASH_BYTES, ScopeHead, SlotHead, Variants, spread};
use crate::code::Body;
use crate::scope::{ScopeKind, Slot, SlotFlags, SlotKind, SlotNames, StaticScope};

/// Zero is the scope around the code. Its own count from one.
#[derive(Default)]
pub(in crate::cache) struct ScopeNumbers {
    outer: usize,
    own: HashTable<(usize, u32)>,
}

pub(super) fn address(scope: Option<&Rc<StaticScope>>) -> usize {
    scope.map_or(0, |scope| Rc::as_ptr(scope).addr())
}

impl ScopeNumbers {
    pub(super) fn reset(&mut self, outer: Option<&Rc<StaticScope>>) {
        self.outer = address(outer);
        self.own.clear();
    }

    /// What there is no room for is not found again.
    fn add(&mut self, scope: &Rc<StaticScope>) {
        let entry = (address(Some(scope)), self.own.len() as u32 + 1);
        if self.own.try_reserve(1, |it| spread(it.0 as u64)).is_ok() {
            (self.own).insert_unique(spread(entry.0 as u64), entry, |it| spread(it.0 as u64));
        }
    }

    pub(super) fn number(&self, scope: Option<&Rc<StaticScope>>) -> Option<u32> {
        let address = address(scope);
        if address == self.outer {
            return Some(0);
        }
        let entry = self.own.find(spread(address as u64), |it| it.0 == address);
        entry.map(|it| it.1)
    }
}

impl Writer<'_> {
    pub(super) fn scope(&mut self, scope: &Rc<StaticScope>) {
        let mut head = ScopeHead::from_bits_retain(scope.kind as u8);
        head.set(
            ScopeHead::HAS_EVAL_VARIABLES,
            scope.eval_variables_slot.is_some(),
        );
        head.set(ScopeHead::IS_OUTERMOST, scope.entered_at.is_some());
        let parent = self.require(self.scopes.number(scope.parent.as_ref()));
        let bytes = self.bytes();
        bytes.push(head.bits());
        bytes.number(parent);
        (scope.eval_variables_slot.into_iter())
            .chain(scope.entered_at)
            .chain([
                scope.slot_count,
                scope.undefined_slots,
                scope.mapped_parameters,
            ])
            .for_each(|number| bytes.number(number));
        let (mut next_index, mut position) = (0, scope.entered_at.unwrap_or(0));
        self.list(&scope.slots, |writer, slot| {
            writer.slot(scope, slot, next_index, &mut position);
            next_index = slot.index + 1;
        });
        self.scopes.add(scope);
    }

    /// `position` is the last one written. Which of the places that have the name in the source the slot points to
    /// depends on more than the source.
    fn slot(&mut self, scope: &StaticScope, slot: &Slot, next_index: u32, position: &mut u32) {
        let symbol = scope.is_symbol(slot).then(|| scope.name_of(slot));
        let mut head = SlotHead::from_bits_retain(slot.kind as u8);
        head.set(SlotHead::HAS_KNOWN_NAME, slot.name_length == Slot::KNOWN);
        head.set(SlotHead::IS_NAMED_BY_SYMBOL, symbol.is_some());
        head.set(SlotHead::SKIPS, slot.index != next_index);
        head.set(SlotHead::HAS_DETAIL, slot.detail != 0);
        let bytes = self.bytes();
        bytes.put(&[head.bits(), slot.flags.bits()]);
        if head.contains(SlotHead::SKIPS) {
            bytes.number(slot.index - next_index);
        }
        if head.contains(SlotHead::HAS_DETAIL) {
            bytes.near(*position, slot.detail);
            *position = slot.detail;
        }
        if let Some(symbol) = symbol {
            self.symbol(symbol.name());
        } else if head.contains(SlotHead::HAS_KNOWN_NAME) {
            bytes.number(slot.name_start);
        } else {
            bytes.put(&slot.hash.to_le_bytes()[..HASH_BYTES]);
            self.text(scope.text_of(slot));
        }
    }
}

impl Decoder<'_> {
    pub(super) fn numbered_scope(
        &self,
        reader: &mut Reader<'_>,
    ) -> Option<Option<Rc<StaticScope>>> {
        match (reader.number()? as usize).checked_sub(1) {
            Some(index) => self.scopes.get(index).cloned().map(Some),
            None => Some(self.outer.cloned()),
        }
    }

    pub(super) fn scope(
        &mut self,
        reader: &mut Reader<'_>,
        is_module: bool,
    ) -> Option<Rc<StaticScope>> {
        let head = ScopeHead::from_bits(reader.byte()?)?;
        let parent = self.numbered_scope(reader)?;
        let mut number_if = |flag| match head.contains(flag) {
            true => reader.number().map(Some),
            false => Some(None),
        };
        let eval_variables_slot = number_if(ScopeHead::HAS_EVAL_VARIABLES)?;
        let entered_at = number_if(ScopeHead::IS_OUTERMOST)?;
        let slot_count = reader.number()?;
        let (undefined_slots, mapped_parameters) = (reader.number()?, reader.number()?);
        let kind = ScopeKind::at((head & ScopeHead::KIND).bits().into())?;
        let (mut names, mut next_index) = (Vec::new(), 0);
        let (mut position, mut first_free) = (entered_at.unwrap_or(0), 0);
        let slots = reader.list(|reader| {
            let slot = self.slot(reader, next_index, &mut position, &mut names)?;
            let takes_two = matches!(slot.kind, SlotKind::Import | SlotKind::PrivateAccessor);
            let is_of_module = matches!(
                slot.kind,
                SlotKind::LazyFunction | SlotKind::Import | SlotKind::ImportMeta
            );
            (slot.index >= first_free && (is_module || !is_of_module)).then_some(())?;
            next_index = slot.index.checked_add(1)?;
            first_free = next_index.checked_add(u32::from(takes_two))?;
            Some(slot)
        })?;
        let is_valid = slot_count <= Body::MAX_FRAME_WORDS
            && first_free.max(undefined_slots).max(mapped_parameters) <= slot_count
            && eval_variables_slot.is_none_or(|slot| slot < slot_count)
            && is_module == (kind == ScopeKind::Module)
            && (slot_count == 0 || kind != ScopeKind::With);
        let scope = Rc::new(StaticScope {
            parent,
            kind,
            eval_variables_slot,
            is_extensible_by_debugger_only: false,
            body_start: None,
            entered_at,
            slot_count,
            undefined_slots,
            mapped_parameters,
            table: OnceCell::new(),
            slots,
            source: StringRef::empty(),
            names: SlotNames {
                owned: names.into(),
                cached: Some(Rc::clone(self.unit)),
            },
        });
        self.scopes.push(Rc::clone(&scope));
        is_valid.then_some(scope)
    }

    #[inline]
    fn slot(
        &self,
        reader: &mut Reader<'_>,
        mut index: u32,
        position: &mut u32,
        names: &mut Vec<Identifier>,
    ) -> Option<Slot> {
        let [head, flags] = reader.array()?;
        let head = SlotHead::from_bits_retain(head);
        if head.contains(SlotHead::SKIPS) {
            index = index.checked_add(reader.number()?)?;
        }
        let mut detail = 0;
        if head.contains(SlotHead::HAS_DETAIL) {
            detail = reader.near(*position)?;
            *position = detail;
        }
        let (hash, name_start, name_length) = if head.contains(SlotHead::IS_NAMED_BY_SYMBOL) {
            let name = self.identifier(reader)?;
            let hash = name.name().hash();
            names.push(name);
            (hash, names.len() as u32 - 1, Slot::OWNED)
        } else if head.contains(SlotHead::HAS_KNOWN_NAME) {
            let name = reader.number()?;
            let text = Text::from_ascii(Name::known_text(name as usize)?);
            (text.hash(), name, Slot::KNOWN)
        } else {
            let [low, middle, high] = reader.array::<HASH_BYTES>()?;
            let hash = u32::from_le_bytes([low, middle, high, 0]);
            let name = reader.number()?;
            (self.is_trusted() || self.unit.text(name).hash() == hash).then_some(())?;
            (hash, name, Slot::CACHED)
        };
        Some(Slot {
            hash,
            name_start,
            name_length,
            index,
            detail,
            kind: SlotKind::at((head & SlotHead::KIND).bits().into())?,
            flags: SlotFlags::from_bits(flags)?,
        })
    }
}
