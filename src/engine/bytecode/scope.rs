//! What is known at generation of the scopes that exist at run time.

use core::cell::OnceCell;
use core::num::NonZeroU32;
use std::rc::Rc;

use bun_engine_syntax::Name;
use bun_engine_text::{Identifier, PropertyName, StringRef, Text};

use crate::cache::Unit;

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
#[repr(u8)]
pub enum ScopeKind {
    /// Where `var` declares.
    Function,
    /// Parameters that the variables of the body are kept apart from.
    Parameters,
    /// The name of a function expression that `eval` may shadow.
    FunctionName,
    Block,
    /// The lexical bindings at the top level of a script or of `eval` code.
    Program,
    /// `catch (e)`, which lets `var e` through.
    SimpleCatch,
    /// `catch` with a pattern.
    Catch,
    Class,
    Module,
    /// The bindings are the properties of an object.
    With,
}

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
#[repr(u8)]
pub enum SlotKind {
    /// Parameters and functions too.
    Variable,
    Let,
    Const,
    /// An assignment does nothing, or throws in strict code.
    Callee,
    /// Empty until it is first read. See [`Slot::function`].
    LazyFunction,
    /// Takes two slots, which are for the module linker to fill.
    Import,
    /// Empty until it is first read.
    ImportMeta,
    /// Holds the symbol.
    PrivateField,
    /// Holds the function.
    PrivateMethod,
    /// Takes two slots, for the getter and the setter.
    PrivateAccessor,
    /// Not for scripts to see.
    Internal,
}

bitflags::bitflags! {
    #[derive(Clone, Copy, PartialEq, Eq, Debug)]
    pub struct SlotFlags: u8 {
        /// No code changes it once it is initialized.
        const IMMUTABLE = 1 << 0;
        /// No code changes it once it is anything but undefined.
        const WRITTEN_ONCE = 1 << 1;
        /// Clashes with a `var` of `eval` code.
        const LEXICAL = 1 << 2;
        const EXPORTED = 1 << 3;
        const STATIC = 1 << 4;
        const HAS_GETTER = 1 << 5;
        const HAS_SETTER = 1 << 6;
        /// `arguments` too.
        const PARAMETER = 1 << 7;
    }
}

/// A named slot of a scope.
#[derive(Clone, Copy, Debug)]
pub struct Slot {
    pub(crate) hash: u32,
    /// In the source, or else what `OWNED`, `KNOWN` or `CACHED` for a length say.
    pub(crate) name_start: u32,
    pub(crate) name_length: u32,
    pub index: u32,
    /// A function created from here on finds it initialized. Of a `LazyFunction`, the index of the function.
    pub(crate) detail: u32,
    pub kind: SlotKind,
    pub flags: SlotFlags,
}

impl Slot {
    /// The name is in `StaticScope::names`.
    pub(crate) const OWNED: u32 = u32::MAX;
    /// The name is a constant of `Name`.
    pub(crate) const KNOWN: u32 = u32::MAX - 1;
    /// The name is among the strings of the payload that the scope came from.
    pub(crate) const CACHED: u32 = u32::MAX - 2;

    /// Of a `LazyFunction`: an index into the functions of the code that the scope belongs to.
    pub fn function(&self) -> u32 {
        debug_assert!(self.kind == SlotKind::LazyFunction);
        self.detail
    }
}

pub(crate) struct SlotNames {
    pub(crate) owned: Box<[Identifier]>,
    pub(crate) cached: Option<Rc<Unit>>,
}

impl From<Vec<Identifier>> for SlotNames {
    fn from(owned: Vec<Identifier>) -> SlotNames {
        SlotNames {
            owned: owned.into(),
            cached: None,
        }
    }
}

pub struct StaticScope {
    pub(crate) parent: Option<Rc<StaticScope>>,
    pub(crate) kind: ScopeKind,
    pub(crate) eval_variables_slot: Option<u32>,
    /// Only what a debugger evaluates adds variables, and only that sees them.
    pub(crate) is_extensible_by_debugger_only: bool,
    pub(crate) body_start: Option<NonZeroU32>,
    /// Of the outermost scope of a function: where that function was created.
    pub(crate) entered_at: Option<u32>,
    pub(crate) slot_count: u32,
    pub(crate) undefined_slots: u32,
    pub(crate) mapped_parameters: u32,
    /// In the order of their indices.
    pub(crate) slots: Box<[Slot]>,
    pub(crate) source: StringRef,
    pub(crate) names: SlotNames,
    /// Open addressing by hash: a position in `slots` plus one. Empty if there are few of them.
    pub(crate) table: OnceCell<Box<[u32]>>,
}

const LINEAR_SEARCH_LIMIT: usize = 8;

fn known_text(name: Name) -> Text<'static> {
    Text::from_ascii(Name::known_text(name.index()).unwrap_or_default())
}

impl StaticScope {
    /// For an object that the embedder puts on the scope chain.
    pub fn with(parent: Option<Rc<StaticScope>>) -> Rc<StaticScope> {
        Self::of_names(ScopeKind::With, parent, Box::default())
    }

    /// For a scope that the embedder fills: a variable for each name, in that order.
    pub fn of_names(
        kind: ScopeKind,
        parent: Option<Rc<StaticScope>>,
        names: Box<[Identifier]>,
    ) -> Rc<StaticScope> {
        let (slot, undefined_slots) = ((SlotKind::Variable, SlotFlags::empty()), names.len());
        Self::without_source(kind, parent, names, slot, undefined_slots as u32)
    }

    /// For a module that has no code. The slots start empty.
    pub fn of_exports(names: Box<[Identifier]>) -> Rc<StaticScope> {
        let flags = SlotFlags::IMMUTABLE | SlotFlags::EXPORTED;
        let slot = (SlotKind::Variable, flags);
        Self::without_source(ScopeKind::Module, None, names, slot, 0)
    }

    /// Its one slot, which starts empty, has the `this` of the code inside.
    pub fn for_this(parent: Option<Rc<StaticScope>>) -> Rc<StaticScope> {
        let names = [Identifier::new(known_text(Name::THIS_VALUE))];
        let slot = (SlotKind::Internal, SlotFlags::empty());
        Self::without_source(ScopeKind::Block, parent, names.into(), slot, 0)
    }

    fn without_source(
        kind: ScopeKind,
        parent: Option<Rc<StaticScope>>,
        names: Box<[Identifier]>,
        (slot_kind, flags): (SlotKind, SlotFlags),
        undefined_slots: u32,
    ) -> Rc<StaticScope> {
        let slots: Box<[Slot]> = (0..)
            .zip(&names)
            .map(|(index, name)| Slot {
                hash: name.name().hash(),
                name_start: index,
                name_length: Slot::OWNED,
                index,
                detail: 0,
                kind: slot_kind,
                flags,
            })
            .collect();
        Rc::new(StaticScope {
            parent,
            kind,
            eval_variables_slot: None,
            is_extensible_by_debugger_only: false,
            body_start: None,
            entered_at: None,
            slot_count: slots.len() as u32,
            undefined_slots,
            mapped_parameters: 0,
            table: Self::table_for(&slots),
            slots,
            source: StringRef::empty(),
            names: names.into_vec().into(),
        })
    }

    pub(crate) fn table_for(slots: &[Slot]) -> OnceCell<Box<[u32]>> {
        Self::build_table(slots).into()
    }

    fn build_table(slots: &[Slot]) -> Box<[u32]> {
        if slots.len() <= LINEAR_SEARCH_LIMIT {
            return Box::default();
        }
        let mut table = vec![0; (slots.len() * 2).next_power_of_two()].into_boxed_slice();
        let mask = table.len() - 1;
        for (position, slot) in (1..).zip(slots) {
            let mut at = slot.hash as usize & mask;
            while table[at] != 0 {
                at = (at + 1) & mask;
            }
            table[at] = position;
        }
        table
    }

    pub fn parent(&self) -> Option<&Rc<StaticScope>> {
        self.parent.as_ref()
    }

    pub fn kind(&self) -> ScopeKind {
        self.kind
    }

    /// Where the object with the variables that `eval` code adds goes, if it may add any. Starts empty.
    pub fn eval_variables_slot(&self) -> Option<u32> {
        self.eval_variables_slot
    }

    /// Of the scope of a function with debug hooks: where its variables count as declared, if that is apart from
    /// its parameters.
    pub fn body_start(&self) -> Option<u32> {
        self.body_start.map(NonZeroU32::get)
    }

    fn internal_slot(&self, name: Name) -> Option<u32> {
        let text = known_text(name);
        Some(self.find_text(text, text.hash(), true)?.index)
    }

    pub fn this_slot(&self) -> Option<u32> {
        self.internal_slot(Name::THIS_VALUE)
    }

    /// Of a class: the private symbol that marks the objects which have its private methods.
    pub fn brand_slot(&self) -> Option<u32> {
        self.internal_slot(Name::CLASS_BRAND)
    }

    /// Of a class: the constructor, which has the private methods that are static.
    pub fn static_brand_slot(&self) -> Option<u32> {
        self.internal_slot(Name::CLASS_STATIC_HOME)
    }

    pub fn slot_count(&self) -> u32 {
        self.slot_count
    }

    /// How many slots, from the first, start as undefined. The others start empty.
    pub fn undefined_slots(&self) -> u32 {
        self.undefined_slots
    }

    /// How many slots, from the first, are the parameters that `arguments` maps to.
    pub fn mapped_parameters(&self) -> u32 {
        self.mapped_parameters
    }

    pub fn slots(&self) -> &[Slot] {
        &self.slots
    }

    /// The named slot that starts at `index`.
    pub fn slot_at(&self, index: u32) -> Option<&Slot> {
        let position = self.slots.binary_search_by_key(&index, |slot| slot.index);
        position.ok().map(|position| &self.slots[position])
    }

    pub fn text_of(&self, slot: &Slot) -> Text<'_> {
        let start = slot.name_start as usize;
        match slot.name_length {
            Slot::OWNED => self.names.owned[start].name().text(),
            Slot::KNOWN => Text::from_ascii(Name::known_text(start).unwrap_or_default()),
            Slot::CACHED => {
                (self.names.cached.as_ref()).map_or(Text::EMPTY, |it| it.text(slot.name_start))
            }
            length => self.source.text().slice(start..start + length as usize),
        }
    }

    pub fn name_of(&self, slot: &Slot) -> Identifier {
        if slot.name_length == Slot::OWNED {
            return self.names.owned[slot.name_start as usize].clone();
        }
        Identifier::new(self.text_of(slot))
    }

    pub(crate) fn is_symbol(&self, slot: &Slot) -> bool {
        slot.name_length == Slot::OWNED
            && self.names.owned[slot.name_start as usize]
                .name()
                .is_symbol()
    }

    /// What a script finds by that name.
    pub fn find(&self, name: PropertyName<'_>) -> Option<&Slot> {
        if name.is_symbol() {
            return self.find_by(name.hash(), |slot| {
                slot.name_length == Slot::OWNED
                    && self.names.owned[slot.name_start as usize] == name
            });
        }
        self.find_text(name.text(), name.hash(), false)
    }

    /// `hash` is `text.hash()`.
    pub(crate) fn find_text(&self, text: Text<'_>, hash: u32, is_internal: bool) -> Option<&Slot> {
        self.find_by(hash, |slot| {
            matches!(slot.kind, SlotKind::Internal | SlotKind::ImportMeta) == is_internal
                && !self.is_symbol(slot)
                && self.text_of(slot) == text
        })
    }

    #[inline]
    fn find_by(&self, hash: u32, matches: impl Fn(&Slot) -> bool) -> Option<&Slot> {
        let table = self.table.get_or_init(|| Self::build_table(&self.slots));
        if table.is_empty() {
            return self
                .slots
                .iter()
                .find(|slot| slot.hash == hash && matches(slot));
        }
        let mask = table.len() - 1;
        let mut at = hash as usize & mask;
        loop {
            let slot = &self.slots[(table[at] as usize).checked_sub(1)?];
            if slot.hash == hash && matches(slot) {
                return Some(slot);
            }
            at = (at + 1) & mask;
        }
    }

    /// Whether a class on the chain from here declares `#name`.
    pub fn declares_private_name(&self, name: Text<'_>) -> bool {
        let hash = name.hash();
        core::iter::successors(Some(self), |scope| scope.parent.as_deref())
            .any(|scope| scope.find_text(name, hash, false).is_some())
    }
}

/// `eval` can make a chain of any length.
impl Drop for StaticScope {
    fn drop(&mut self) {
        let mut next = self.parent.take();
        while let Some(mut scope) = next.and_then(Rc::into_inner) {
            next = scope.parent.take();
        }
    }
}
