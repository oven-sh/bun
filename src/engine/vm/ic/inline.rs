//! The case that an instruction has room for. Once there is a list, it is a copy of one in there.

use core::cell::Cell;
use core::mem::offset_of;

use super::cases::Sample;
use super::{AccessCase, AccessCases, AccessKind, CaseList};
use crate::heap::Survivors;
use crate::{CodeBlock, ShapeId, Vm};

/// What flips the last bits of the shape, so that one comparison checks both.
pub trait InlineKind: Copy + PartialEq {
    fn tag(self) -> u32;

    fn from_tag(tag: u32) -> Self;

    fn of_case(case: &AccessCase) -> Option<Self>;

    /// What goes in the upper half of the key, and in the word after it. The case is valid.
    fn encode(self, vm: &Vm, case: &AccessCase) -> (u32, u64);

    /// Whether it rests on a lookup.
    #[inline(always)]
    fn is_checked(self) -> bool {
        self.tag() >= InlineKey::FIRST_CHECKED_TAG
    }
}

macro_rules! inline_kinds {
    ($($(#[$doc:meta])* $name:ident { $($(#[$kind_doc:meta])* $kind:ident = $tag:literal,)* })*) => {$(
        $(#[$doc])*
        #[derive(Clone, Copy, PartialEq, Eq, Debug)]
        pub enum $name {
            $($(#[$kind_doc])* $kind = $tag,)*
        }

        impl InlineKind for $name {
            #[inline(always)]
            fn tag(self) -> u32 {
                self as u32
            }

            #[inline(always)]
            fn from_tag(tag: u32) -> $name {
                match tag {
                    $($tag => $name::$kind,)*
                    _ => unreachable!(),
                }
            }

            fn of_case(case: &AccessCase) -> Option<$name> {
                Self::classify(case)
            }

            fn encode(self, vm: &Vm, case: &AccessCase) -> (u32, u64) {
                self.words_for(vm, case)
            }
        }

        $(const _: () = assert!($tag < InlineKey::LAST_TAG + 1);)*
    )*};
}

inline_kinds! {
    InlineLoad {
        InObject = 0,
        InStorage = 1,
        OwnGetter = 2,
        CustomGetterInSlot = 3,
        Constant = 4,
        TypedArrayLength = 5,
        /// The constant is the function.
        Getter = 6,
        /// The same. It gets the object, in the realm of the code.
        CustomGetter = 7,
        /// The constant is the address of the slot.
        InheritedInObject = 8,
        /// The constant is the address of the holder, with the offset in words in its top 16 bits.
        InheritedInStorage = 9,
    }
    InlineStore {
        InObject = 0,
        InStorage = 1,
        OwnSetter = 2,
        CustomSetterInSlot = 3,
        AddInObject = 4,
        AddInStorage = 5,
        /// The operand is the function.
        Setter = 6,
        CustomSetter = 7,
    }
}

impl InlineLoad {
    /// See `InheritedInStorage`.
    pub const OFFSET_SHIFT: u32 = 48;

    fn classify(case: &AccessCase) -> Option<InlineLoad> {
        Some(match case.kind() {
            AccessKind::LoadOwn if case.plain_offset() > 0 => InlineLoad::InObject,
            AccessKind::LoadOwn => InlineLoad::InStorage,
            AccessKind::CallOwnGetter => InlineLoad::OwnGetter,
            AccessKind::CallCustomGetterInSlot if case.is_plain_call() => {
                InlineLoad::CustomGetterInSlot
            }
            kind if kind.has_answer() => InlineLoad::Constant,
            AccessKind::TypedArrayLength => InlineLoad::TypedArrayLength,
            AccessKind::CallInheritedGetter if case.pointer() != 0 => InlineLoad::Getter,
            AccessKind::CallCustomAccessorGetter | AccessKind::CallCustomValueGetter
                if case.is_plain_call() =>
            {
                InlineLoad::CustomGetter
            }
            AccessKind::LoadInherited => match case.lookup()?.byte_offset() {
                1.. => InlineLoad::InheritedInObject,
                offset if offset >> 3 >= i16::MIN.into() => InlineLoad::InheritedInStorage,
                _ => return None,
            },
            _ => return None,
        })
    }

    fn words_for(self, vm: &Vm, case: &AccessCase) -> (u32, u64) {
        if !self.is_checked() {
            return (case.byte_offset() as u32, 0);
        }
        let place = || {
            let lookup = case.lookup().expect("of that kind");
            let holder = lookup.holder().expect("valid");
            (holder.address() as u64, lookup.byte_offset())
        };
        let constant = match self {
            InlineLoad::InheritedInObject => place().0 + place().1 as u64,
            InlineLoad::InheritedInStorage => {
                place().0 | ((place().1 >> 3) as u64) << Self::OFFSET_SHIFT
            }
            _ => case.pointer() as u64,
        };
        (vm.lookup_epoch_to_record(), constant)
    }
}

impl InlineStore {
    /// `HasOwn` is what checks a brand.
    fn classify(case: &AccessCase) -> Option<InlineStore> {
        Some(match case.kind() {
            AccessKind::HasOwn => InlineStore::InObject,
            AccessKind::Replace if case.plain_offset() > 0 => InlineStore::InObject,
            AccessKind::Replace => InlineStore::InStorage,
            AccessKind::CallOwnSetter => InlineStore::OwnSetter,
            AccessKind::CallCustomSetterInSlot if case.is_plain_call() => {
                InlineStore::CustomSetterInSlot
            }
            AccessKind::Transition if case.plain_offset() > 0 => InlineStore::AddInObject,
            AccessKind::Transition => InlineStore::AddInStorage,
            AccessKind::CallInheritedSetter if case.pointer() != 0 => InlineStore::Setter,
            AccessKind::CallCustomAccessorSetter | AccessKind::CallCustomValueSetter
                if case.is_plain_call() =>
            {
                InlineStore::CustomSetter
            }
            _ => return None,
        })
    }

    fn words_for(self, vm: &Vm, case: &AccessCase) -> (u32, u64) {
        let place = match self {
            InlineStore::Setter | InlineStore::CustomSetter => case.pointer() as u64,
            _ if case.kind() == AccessKind::HasOwn => 0,
            _ => (case.byte_offset() as u64) << 32 | u64::from(case.new_shape().bits()),
        };
        (vm.lookup_epoch_to_record(), place)
    }
}

/// The shape with the tag in the lower half. In the upper the epoch, if the kind is checked.
#[derive(Default)]
#[repr(transparent)]
pub struct InlineKey(Cell<u64>);

const _: () = assert!(InlineKey::LAST_TAG <= InlineKey::TAG_MASK);

impl InlineKey {
    pub const TAG_MASK: u32 = ShapeId::LAST_BITS_MASK;
    pub const FIRST_CHECKED_TAG: u32 = 4;
    pub(super) const LAST_TAG: u32 = 9;

    #[inline(always)]
    pub fn bits(&self) -> u64 {
        self.0.get()
    }

    #[inline(always)]
    pub(super) fn shape(&self) -> ShapeId {
        match self.bits() as u32 & !Self::TAG_MASK {
            0 => ShapeId::NONE,
            rest => ShapeId::from_bits(rest | ShapeId::LAST_BITS),
        }
    }

    #[inline(always)]
    pub(super) fn upper(&self) -> u32 {
        (self.bits() >> 32) as u32
    }

    /// Without a shape it flips nothing.
    #[inline(always)]
    pub(super) fn tag(&self) -> u32 {
        (self.bits() as u32 ^ self.shape().bits()) & Self::TAG_MASK
    }

    fn set(&self, shape: ShapeId, kind: impl InlineKind, upper: u32) {
        debug_assert!(shape.bits() & Self::TAG_MASK == ShapeId::LAST_BITS);
        (self.0).set(u64::from(upper) << 32 | u64::from(shape.bits() ^ kind.tag()));
    }

    /// The tag stays.
    pub(super) fn clear(&self) {
        self.0.set(self.tag().into());
    }

    /// Whether it is for the shape, but would have to be renewed.
    #[inline(always)]
    pub(super) fn is_out_of_date(&self, vm: &Vm, shape: ShapeId) -> bool {
        shape == self.shape()
            && self.upper() != vm.lookup_epoch_to_record()
            && (self.tag() >= Self::FIRST_CHECKED_TAG)
    }

    /// The case is valid.
    #[inline(always)]
    pub(super) fn renew(&self, vm: &Vm) {
        if self.tag() >= Self::FIRST_CHECKED_TAG && !self.shape().is_none() {
            let epoch = u64::from(vm.lookup_epoch_to_record()) << 32;
            self.0.set(epoch | u64::from(self.bits() as u32));
        }
    }
}

#[derive(Default)]
#[repr(C)]
pub struct InlineCase {
    pub(super) key: InlineKey,
    /// Of a load, the constant. Of a store, the new shape if there is one, and in the upper half the offset of the slot.
    /// A load has that in the upper half of the key.
    operand: Cell<u64>,
}

impl InlineCase {
    pub const OFFSET_OF_KEY: usize = offset_of!(InlineCase, key);
    pub const OFFSET_OF_LOADED_SLOT: usize = Self::OFFSET_OF_KEY + size_of::<u32>();
    pub const OFFSET_OF_OPERAND: usize = offset_of!(InlineCase, operand);
    pub const OFFSET_OF_NEW_SHAPE: usize = Self::OFFSET_OF_OPERAND;
    pub const OFFSET_OF_STORED_SLOT: usize = Self::OFFSET_OF_OPERAND + size_of::<u32>();

    #[inline(always)]
    pub fn key(&self) -> u64 {
        self.key.bits()
    }

    #[inline(always)]
    pub fn constant(&self) -> u64 {
        self.operand.get()
    }

    #[inline(always)]
    pub fn loaded_slot(&self) -> i32 {
        self.key.upper() as i32
    }

    /// Of a store to a slot.
    #[inline(always)]
    pub fn new_shape(&self) -> ShapeId {
        ShapeId::from_bits(self.operand.get() as u32)
    }

    #[inline(always)]
    pub fn stored_slot(&self) -> i32 {
        (self.operand.get() >> 32) as i32
    }

    /// The case is valid, and something else keeps its lookup.
    fn set(&self, vm: &Vm, case: &AccessCase, kind: impl InlineKind) {
        let (upper, operand) = kind.encode(vm, case);
        self.operand.set(operand);
        self.key.set(case.shape(), kind, upper);
    }

    /// The same, for one that is in no list.
    pub(super) fn set_unlisted(
        &self,
        vm: &Vm,
        owner: &CodeBlock,
        case: &AccessCase,
        kind: impl InlineKind,
    ) {
        self.set(vm, case, kind);
        owner.did_get_case(case);
    }

    /// Of those from the list of the site, the one for `shape`, or else the first of the kind that it has had, or else
    /// the first. False if none suits.
    pub(super) fn choose<'a, K: InlineKind>(
        &self,
        vm: &Vm,
        listed: impl Iterator<Item = &'a AccessCase> + Clone,
        shape: ShapeId,
    ) -> bool {
        let candidates = (listed.filter(|case| case.is_valid()))
            .filter_map(|case| Some((case, K::of_case(case)?)));
        let chosen = (candidates.clone().find(|it| it.0.shape() == shape))
            .or_else(|| candidates.clone().find(|it| it.1.tag() == self.key.tag()))
            .or_else(|| candidates.clone().next());
        (chosen.map(|(case, kind)| self.set(vm, case, kind))).is_some()
    }

    pub(super) fn copy_from(&self, other: &InlineCase) {
        self.operand.set(other.operand.get());
        self.key.0.set(other.key.bits());
    }

    /// In place of the operand of a load that has no use for it.
    pub(super) fn keep_name(&self, address: usize) {
        debug_assert!(self.key.shape().is_none() || self.key.tag() <= InlineLoad::InStorage as u32);
        self.operand.set(address as u64);
    }
}

pub(super) trait InlineCache {
    type Kind: InlineKind;

    fn inline_case(&self) -> &InlineCase;

    fn listed(&self) -> &AccessCases;

    #[inline(always)]
    fn inline_key(&self) -> &InlineKey {
        &self.inline_case().key
    }

    /// What the inline case is, or was when there last was one.
    #[inline(always)]
    fn preferred_kind(&self) -> Self::Kind {
        Self::Kind::from_tag(self.inline_key().tag())
    }

    fn kind_for_compiled_code(&self) -> Option<Self::Kind> {
        let suits = |case: &AccessCase| Self::Kind::of_case(case) == Some(self.preferred_kind());
        let is_sampling = || self.listed().with_cases(|cases| cases.iter().any(suits));
        (!self.listed().is_megamorphic() && (!self.inline_key().shape().is_none() || is_sampling()))
            .then(|| self.preferred_kind())
    }

    /// That of the case which is not in the list, if there is one.
    fn unlisted_shape(&self) -> ShapeId {
        if self.listed().has_list() {
            ShapeId::NONE
        } else {
            self.inline_key().shape()
        }
    }

    fn clear_inline_case(&self) {
        self.listed().did_clear_inline_case();
        self.inline_key().clear();
    }

    #[inline(never)]
    fn choose_inline_case(&self, vm: &Vm, shape: ShapeId) {
        let choose = |cases: &[AccessCase]| {
            (self.inline_case()).choose::<Self::Kind>(vm, cases.iter(), shape)
        };
        if !self.listed().with_cases(choose) {
            self.clear_inline_case();
        }
    }

    /// A copy of a case in the list is chosen again next, unless the name is private, about which no prototype has a say.
    fn renew_inline_case_if(&self, has_live_shapes: bool, survivors: &Survivors) {
        let lookup = self.listed().lone_lookup();
        if has_live_shapes && lookup.is_none_or(|it| it.stays_valid(survivors)) {
            self.inline_key().renew(survivors.vm());
        } else {
            self.clear_inline_case();
        }
    }

    /// For a slow path, which sees to it that the fast one is taken next time.
    #[inline(always)]
    fn tend_inline_case(&self, vm: &Vm, list: &CaseList, shape: ShapeId) {
        match list.take_sample(shape, 0) {
            Some(Sample::First) => self.clear_inline_case(),
            Some(Sample::Last) => self.choose_inline_case(vm, ShapeId::NONE),
            None if self.inline_key().is_out_of_date(vm, shape) => {
                self.choose_inline_case(vm, shape)
            }
            Some(Sample::Another) | None => {}
        }
    }
}
