//! Which type the entries of each kind have, and the ways to them.

use core::cell::{Cell, OnceCell, RefCell};
use std::rc::Rc;

use bun_engine_bytecode::{Code, MetadataKind, RawInstruction};

use super::*;
use crate::SpeculatedType;
use crate::ic::CallTargetCount;

macro_rules! entry_types {
    ($($kind:ident => $type:ty,)*) => {
        $(const _: () = assert!(size_of::<$type>() == MetadataKind::$kind.words() as usize * 8);)*

        #[inline(always)]
        fn entry_type_of(kind: MetadataKind) -> core::any::TypeId {
            match kind {
                $(MetadataKind::$kind => core::any::TypeId::of::<$type>(),)*
            }
        }

        macro_rules! for_each_entry {
            ($code_block:expr, |$entry:ident| $action:expr) => {
                for_each_entry!($code_block.body(), $code_block.metadata_ptr(), |$entry| $action)
            };
            ($body:expr, $metadata:expr, |$entry:ident| $action:expr) => {
                for (kind, range) in $body.metadata().ranges() {
                    match kind {
                        $(MetadataKind::$kind => {
                            // SAFETY: the words of that kind.
                            for $entry in unsafe { entries::<$type>($metadata, range) } {
                                $action;
                            }
                        })*
                    }
                }
            };
        }
    };
}

entry_types! {
    Value => ValueProfile,
    UnaryArithmetic => ArithmeticProfile,
    BinaryArithmetic => ArithmeticProfile,
    Branch => Flags,
    LazyCache => AccessCases,
    LazyCacheAndValue => CasesAndValue,
    GetById => GetById,
    GetByIdDirect => GetById,
    GetLength => GetLength,
    PutById => StoreCache,
    GetByVal => GetByVal,
    ArrayAccess => ArrayAccess,
    SetPrototype => SetPrototype,
    GetPrivateName => GetPrivateName,
    PutPrivateName => PutPrivateName,
    PrivateBrand => PutPrivateName,
    GetGlobal => GetGlobal,
    PutGlobal => GlobalAccess,
    GetImport => GetImport,
    ResolveDynamic => ResolveDynamic,
    GetDynamic => GetGlobal,
    PutDynamic => GlobalAccess,
    Call => Call,
    SuperConstruct => SuperConstruct,
    ToThis => ToThis,
    CachedCallee => WeakCell,
    NewObject => NewObject,
    NewArray => ArrayAllocationProfile,
    NewArrayWithSpecies => NewArrayWithSpecies,
    SharedRegExp => StrongCell,
    ForIn => ForIn,
    ForInGet => ForInGet,
    IterationModes => Flags,
    IteratorNext => IteratorNext,
    Catch => Counter,
    Coverage => Cover,
}

/// Those of a code block, some of which have something to release.
struct OwningEntries {
    code: Rc<Code>,
    metadata: *const u64,
}

impl Drop for OwningEntries {
    fn drop(&mut self) {
        for_each_entry!(self.code.body, self.metadata, |entry| entry.release());
    }
}

/// # Safety
/// The words are entries of that type, and outlive the borrow.
unsafe fn entries<'a, T: Entry>(metadata: *const u64, words: core::ops::Range<u32>) -> &'a [T] {
    let count = words.len() * size_of::<u64>() / size_of::<T>();
    // SAFETY: the caller's.
    unsafe { core::slice::from_raw_parts(metadata.add(words.start as usize).cast(), count) }
}

#[derive(Default)]
pub(in crate::code) struct SideTables {
    owning_entries: OnceCell<OwningEntries>,
    /// The types seen by the profiles of the arguments, and then by those of the instructions.
    pub(super) predictions: OnceCell<Box<[Cell<SpeculatedType>]>>,
    #[expect(clippy::vec_box, reason = "handed out by address")]
    call_targets: RefCell<Vec<Box<[CallTargetCount; CallProfile::MAX_TARGETS]>>>,
}

#[inline(always)]
fn is_start_of_entry(kind: MetadataKind, (first, count): (u32, u32), word: u32) -> bool {
    let distance = word.wrapping_sub(first);
    distance < count && distance.is_multiple_of(kind.words())
}

pub struct Entries<'a> {
    code_block: &'a CodeBlock,
    /// By kind: the first word, and how many there are.
    ranges: [(u32, u32); MetadataKind::COUNT],
}

impl<'a> Entries<'a> {
    #[inline(always)]
    fn starts_at(&self, kind: MetadataKind, word: u32) -> bool {
        is_start_of_entry(kind, self.ranges[kind as usize], word)
    }

    /// Panics unless an entry of one of the kinds, which have that type, starts at the word.
    #[inline(always)]
    pub fn get<T: Entry + 'static, const N: usize>(
        &self,
        kinds: [MetadataKind; N],
        word: u32,
    ) -> &'a T {
        assert!(kinds.map(entry_type_of) == [core::any::TypeId::of::<T>(); N]);
        assert!(kinds.into_iter().any(|kind| self.starts_at(kind, word)));
        // SAFETY: just checked.
        unsafe { self.code_block.metadata(word) }
    }

    #[inline]
    pub fn arithmetic(&self, word: u32) -> &'a ArithmeticProfile {
        use MetadataKind::{BinaryArithmetic, UnaryArithmetic};
        self.get([UnaryArithmetic, BinaryArithmetic], word)
    }

    #[inline]
    pub fn call_profile(&self, word: u32) -> &'a CallProfile {
        let call: &Call = if self.starts_at(MetadataKind::Call, word) {
            self.get([MetadataKind::Call], word)
        } else {
            &(self.get::<SuperConstruct, _>([MetadataKind::SuperConstruct], word)).call
        };
        &call.profile
    }

    /// Of an instruction of the code. `None` if that leaves no trace.
    pub fn has_run(&self, instruction: &RawInstruction) -> Option<bool> {
        use MetadataKind::*;
        let kind = instruction.opcode.metadata()?;
        if !matches!(
            kind,
            UnaryArithmetic
                | BinaryArithmetic
                | GetById
                | GetLength
                | PutById
                | GetByVal
                | ArrayAccess
                | Call
        ) {
            return None;
        }
        assert!(self.starts_at(kind, instruction.metadata));
        let mut words = instruction.metadata..instruction.metadata + kind.words();
        // SAFETY: just checked.
        Some(words.any(|it| unsafe { *self.code_block.metadata_ptr().add(it as usize) } != 0))
    }

    /// Of an entry of that kind, if such entries have one.
    #[inline]
    pub fn value_profile(&self, kind: MetadataKind, word: u32) -> Option<&'a ValueProfile> {
        assert!(self.starts_at(kind, word));
        // SAFETY: what such an entry starts with.
        (kind.has_value_profile()).then(|| unsafe { self.code_block.metadata(word) })
    }
}

impl CodeBlock {
    /// Lets the call sites go straight to the code that their callees have by now.
    pub fn link_calls_again(&self) {
        let (layout, first) = (self.body().metadata(), self.metadata_ptr());
        // SAFETY: the words of those kinds.
        let (calls, of_super) = unsafe {
            (
                entries::<Call>(first, layout.range(MetadataKind::Call)),
                entries::<SuperConstruct>(first, layout.range(MetadataKind::SuperConstruct)),
            )
        };
        let calls = calls.iter().chain(of_super.iter().map(|it| &it.call));
        calls.for_each(|it| it.profile.link_again());
        self.write_barrier_for_cell();
    }

    /// The code block is not optimized.
    pub(crate) fn will_need_entries_released(&self) {
        self.rare_data()
            .caches
            .owning_entries
            .get_or_init(|| OwningEntries {
                code: Rc::clone(self.code()),
                metadata: self.metadata_ptr(),
            });
    }

    /// # Safety
    /// The operand of an instruction of this code whose entry is of that type, and the code is not optimized.
    #[inline(always)]
    #[cfg_attr(rootcheck, rootcheck::stays("inside the cell"))]
    pub unsafe fn metadata<T: Entry>(&self, word: u32) -> &T {
        // SAFETY: the caller's.
        unsafe { &*self.metadata_ptr().add(word as usize).cast() }
    }

    /// For looking up many.
    pub fn entries(&self) -> Entries<'_> {
        assert!(!self.is_optimized());
        let mut ranges = [(0, 0); MetadataKind::COUNT];
        for (kind, range) in self.body().metadata().ranges() {
            ranges[kind as usize] = (range.start, range.end - range.start);
        }
        Entries {
            code_block: self,
            ranges,
        }
    }

    /// Panics unless an entry of that kind, which has that type, starts at the word.
    pub fn checked_metadata<T: Entry + 'static>(&self, kind: MetadataKind, word: u32) -> &T {
        let range = self.body().metadata().range(kind);
        assert!(!self.is_optimized());
        assert!(is_start_of_entry(
            kind,
            (range.start, range.len() as u32),
            word
        ));
        assert!(entry_type_of(kind) == core::any::TypeId::of::<T>());
        // SAFETY: just checked.
        unsafe { self.metadata(word) }
    }

    pub(crate) fn allocate_call_targets(&self) -> *const CallTargetCount {
        let targets = Box::new(core::array::from_fn(|_| CallTargetCount {
            target: WeakCell(Cell::new(WeakCell::NONE)),
            count: Cell::new(0),
        }));
        let first = targets.as_ptr();
        self.rare_data()
            .caches
            .call_targets
            .borrow_mut()
            .push(targets);
        first
    }

    /// Has the profile of the instruction take in the last shape before that is overwritten.
    pub fn update_array_profile(&self, offset: u32) {
        let Some(instruction) = RawInstruction::read(self.body().instructions(), offset) else {
            return;
        };
        let (kind, word) = (instruction.opcode.metadata(), instruction.metadata);
        let profile = match kind {
            Some(it @ MetadataKind::GetByVal) => &self.checked_metadata::<GetByVal>(it, word).array,
            Some(it @ MetadataKind::GetLength) => {
                &self.checked_metadata::<GetLength>(it, word).array
            }
            Some(it @ MetadataKind::ArrayAccess) => {
                &self.checked_metadata::<ArrayAccess>(it, word).array
            }
            Some(it @ MetadataKind::IteratorNext) => {
                &self.checked_metadata::<IteratorNext>(it, word).array
            }
            _ => return,
        };
        profile.update();
    }
}

pub(in crate::code) fn visit(code_block: &CodeBlock, visitor: &mut Visitor) {
    debug_assert!(!visitor.is_mutator_running());
    for_each_entry!(code_block, |entry| entry.visit(visitor));
    if code_block.has_transitions.get() {
        visitor.constrain_by_current_cell();
    }
}

pub(in crate::code) fn visit_transitions(code_block: &CodeBlock, visitor: &mut Visitor) {
    debug_assert!(!visitor.is_mutator_running());
    for_each_entry!(code_block, |entry| entry.visit_transitions(visitor));
}

pub(in crate::code) fn reconcile_weak_references(code_block: &CodeBlock, survivors: &Survivors) {
    if code_block.gathers_predictions() {
        code_block.update_predictions();
    } else {
        for profile in code_block.value_profiles() {
            profile.clear_if_dead(survivors);
        }
    }
    for_each_entry!(code_block, |entry| entry.reconcile(code_block, survivors));
}
