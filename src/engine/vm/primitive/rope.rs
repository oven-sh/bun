use core::mem::offset_of;
use core::ops::Deref;

use bun_engine_text::{StringImpl, Text};

use crate::heap::{Marker, keep_alive};
use crate::{Gc, GcFree, JsCell, JsString, TypeFlags, Vm};

/// A concatenation of two or three strings, none of them empty, or a part of one that is no rope. The characters are
/// copied when they are needed. Only the first word after the header changes then: a marker may be reading the others.
#[repr(C)]
pub struct JsRopeString {
    base: JsString,
    /// The length, and above it the low 32 bits of the second fiber.
    length_and_fiber1: u64,
    /// The high 16 bits of the second fiber, and above them the third one or the offset of a substring.
    fiber1_and_fiber2: u64,
}

impl !GcFree for JsRopeString {}

impl Deref for JsRopeString {
    type Target = JsString;

    #[inline(always)]
    fn deref(&self) -> &JsString {
        &self.base
    }
}

/// A string has no storage.
const HAS_BEEN_READ: TypeFlags = TypeFlags::HAS_PRE_CAPACITY;

impl JsString {
    /// False the first time. For what only pays if it is done again, such as putting a rope together or caching a result.
    #[inline(always)]
    pub(crate) fn is_read_again(&self) -> bool {
        let has_been_read = self.inline_flags().contains(HAS_BEEN_READ);
        self.set_own_flag(HAS_BEEN_READ, true);
        has_been_read
    }

    /// For a rope that has been put together.
    #[inline(always)]
    pub(super) fn forget_reads(&self) {
        if self.inline_flags().contains(HAS_BEEN_READ) {
            self.set_own_flag(HAS_BEEN_READ, false);
        }
    }
}

impl JsRopeString {
    /// In the fiber, whose other bits are flags then. The second fiber is the base, which is no rope.
    pub const IS_SUBSTRING: usize = 2;
    /// All characters are stored as Latin-1, and stay so. Without it nothing is known: the base of a substring may
    /// have become Latin-1 since, so its `StringImpl` says how to read it.
    pub const IS_LATIN1: usize = StringImpl::IS_LATIN1 as usize;
    /// Leaves the address of the first fiber of a concatenation.
    pub const FIBER_MASK: usize = !7;
    /// 32 bits that are not zero, do not exceed `MAX_LENGTH` and never change. Only a cell that had `IS_ROPE` has them.
    /// The 32 bits after them are the low ones of the second fiber, which is alive only while the cell has `IS_ROPE`.
    pub const OFFSET_OF_LENGTH: usize = offset_of!(JsRopeString, length_and_fiber1);
    /// The high 16 bits of the second fiber, and above them the third, zero, or the offset in units into the base. The
    /// collector does not take the halves of an address for one, so the fibers stay whole until all words are written.
    pub const OFFSET_OF_FIBER2: usize = offset_of!(JsRopeString, fiber1_and_fiber2);

    #[inline(always)]
    fn allocate(vm: &Vm, fiber0: usize, fiber1: usize, fiber2: usize, length: u32) -> Gc<JsString> {
        let allocator = &vm.heap.rope_strings.allocator;
        let address = allocator.try_allocate_sized(&vm.heap, size_of::<JsRopeString>());
        if address == 0 {
            bun_alloc::out_of_memory();
        }
        // SAFETY: from the allocator.
        unsafe { Self::initialize(vm, address, [fiber0, fiber1, fiber2], length) }
    }

    /// # Safety
    /// The address of a new cell from the allocator of ropes.
    #[inline(always)]
    unsafe fn initialize(
        vm: &Vm,
        address: usize,
        [fiber0, fiber1, fiber2]: [usize; 3],
        length: u32,
    ) -> Gc<JsString> {
        // The words below do not look like the addresses of cells, and could be computed before the allocation.
        [fiber0, fiber1, fiber2].into_iter().for_each(keep_alive);
        let words = [
            JsCell::header_for(&vm.shapes.string()),
            (fiber0 | JsString::IS_ROPE) as u64,
            u64::from(length) | (fiber1 as u64) << 32,
            (fiber1 as u64) >> 32 | (fiber2 as u64) << 16,
        ];
        // SAFETY: a new cell of four words.
        unsafe {
            core::ptr::with_exposed_provenance_mut::<[u64; 4]>(address).write(words);
            Gc::from_address(address)
        }
    }

    /// None is empty, and `length` is the sum of their lengths, which is not too much for a string.
    #[inline(always)]
    pub(super) fn concatenation(
        vm: &Vm,
        a: Gc<JsString>,
        b: Gc<JsString>,
        c: Option<Gc<JsString>>,
        length: u32,
    ) -> Gc<JsString> {
        debug_assert!(!a.is_empty() && !b.is_empty() && c.is_none_or(|c| !c.is_empty()));
        debug_assert!(length == a.len() + b.len() + c.map_or(0, |c| c.len()));
        let is_latin1 = a.is_latin1() & b.is_latin1() & c.is_none_or(|c| c.is_latin1());
        let first = a.address() | (usize::from(is_latin1) * Self::IS_LATIN1);
        Self::allocate(vm, first, b.address(), c.map_or(0, Gc::address), length)
    }

    /// The same for two, if it takes no call.
    #[inline(always)]
    pub(super) fn try_concatenation_quickly(
        vm: &Vm,
        a: Gc<JsString>,
        b: Gc<JsString>,
        length: u32,
    ) -> Option<Gc<JsString>> {
        let is_latin1 = a.is_latin1() & b.is_latin1();
        let first = a.address() | (usize::from(is_latin1) * Self::IS_LATIN1);
        let address = (vm.heap.rope_strings.allocator).try_bump_sized(size_of::<JsRopeString>())?;
        // SAFETY: from the allocator.
        Some(unsafe { Self::initialize(vm, address, [first, b.address(), 0], length) })
    }

    /// `base` is no rope, and `text` is what it has from `start` on.
    #[inline(always)]
    pub(super) fn substring(
        vm: &Vm,
        base: Gc<JsString>,
        start: u32,
        text: Text<'_>,
    ) -> Gc<JsString> {
        if text.len() <= 2
            && let Some(short) = JsString::cached_short(vm, text)
        {
            return short;
        }
        if start == 0 && text.len() == base.len() as usize {
            return base;
        }
        let flags = Self::IS_SUBSTRING | (usize::from(text.is_latin1()) * Self::IS_LATIN1);
        Self::allocate(vm, flags, base.address(), start as usize, text.len() as u32)
    }

    /// Panics if `base` is a concatenation, or the range is not inside it.
    #[inline]
    pub fn substring_of_resolved(
        vm: &Vm,
        base: Gc<JsString>,
        start: u32,
        length: u32,
    ) -> Gc<JsString> {
        let view = base.try_view().expect("one piece");
        view.substring(vm, start as usize..start as usize + length as usize)
    }

    #[inline(always)]
    pub(super) fn rope_length(&self) -> u32 {
        self.length_and_fiber1 as u32
    }

    #[inline(always)]
    fn fiber1(&self) -> usize {
        (self.length_and_fiber1 >> 32 | (self.fiber1_and_fiber2 & 0xffff) << 32) as usize
    }

    #[inline(always)]
    fn fiber2(&self) -> usize {
        (self.fiber1_and_fiber2 >> 16) as usize
    }

    /// The base and the offset.
    #[inline(always)]
    pub(super) fn as_substring(&self) -> Option<(Gc<JsString>, u32)> {
        // SAFETY: the rope keeps its base alive.
        let base = || unsafe { Gc::from_address(self.fiber1()) };
        (self.is_unresolved_substring()).then(|| (base(), self.fiber2() as u32))
    }

    /// `self` is a concatenation.
    #[inline(always)]
    pub(super) fn fibers(&self) -> (Gc<JsString>, Gc<JsString>, Option<Gc<JsString>>) {
        assert!(self.is_concatenation());
        let third = self.fiber2();
        // SAFETY: the rope keeps them alive.
        unsafe {
            (
                Gc::from_address(self.fiber() & Self::FIBER_MASK),
                Gc::from_address(self.fiber1()),
                (third != 0).then(|| Gc::from_address(third)),
            )
        }
    }

    #[inline(always)]
    pub(super) fn visit_rope(&self, fiber0: usize, visitor: &mut impl Marker) {
        // SAFETY: zero, or a string that the rope keeps alive.
        unsafe {
            visitor.append_word(self.fiber1() as u64);
            if fiber0 & Self::IS_SUBSTRING == 0 {
                visitor.append_word((fiber0 & Self::FIBER_MASK) as u64);
                visitor.append_word(self.fiber2() as u64);
            }
        }
    }
}
