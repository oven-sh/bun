use core::cell::Cell;
use core::mem::offset_of;

use bun_engine_bytecode::Specialization;

use crate::code::metadata::{Entry, WeakCell};
use crate::heap::Survivors;
use crate::{
    CellType, CodeBlock, Executable, Gc, Intrinsic, JsCell, JsFunction, Value, Visitor, call,
};

/// What a call site has called.
#[repr(C)]
pub struct CallProfile {
    /// The only callee so far, which has an executable. `MANY` or `MANY_CONSTRUCTORS` if there have been others.
    callee: WeakCell,
    /// The only executable so far, for a site that calls several closures of it.
    executable: WeakCell,
    /// While either of these is a cell, the address of the executable or of a code block that it has had. Later zero,
    /// or that of `MAX_TARGETS` entries that the code block owns.
    targets: Cell<usize>,
}

/// An executable or, where that does not say enough, a callee.
#[repr(C)]
pub struct CallTargetCount {
    pub target: WeakCell,
    pub count: Cell<u32>,
}

const _: () = assert!(CallProfile::FIRST_NATIVE + Intrinsic::COUNT <= WeakCell::SPECIAL_LIMIT);

impl CallProfile {
    pub const OFFSET_OF_CALLEE: usize = offset_of!(CallProfile, callee);
    pub const OFFSET_OF_EXECUTABLE: usize = offset_of!(CallProfile, executable);
    pub const OFFSET_OF_TARGETS: usize = offset_of!(CallProfile, targets);
    pub const MAX_TARGETS: usize = 6;
    /// In `executable`: see `targets`.
    pub const POLYMORPHIC: usize = WeakCell::MANY;
    /// In `executable`: nothing is recorded any more.
    pub const MEGAMORPHIC: usize = 2;
    /// In `callee`. No value has these bits.
    const MANY_CONSTRUCTORS: usize = 3;
    /// In `executable`, while there is an only callee.
    const IS_CALLED: usize = 4;
    const IS_CONSTRUCTED: usize = 5;
    /// In `executable`, plus its `Intrinsic`: the only callee is a native function that is entered the usual way.
    pub const FIRST_NATIVE: usize = 16;

    #[inline(always)]
    pub fn callee(&self) -> &WeakCell {
        &self.callee
    }

    #[inline(always)]
    pub fn executable(&self) -> &WeakCell {
        &self.executable
    }

    /// The address of what to call through, if `callee` or `executable` is a cell.
    #[inline(always)]
    pub fn way_to_only_target(&self) -> usize {
        self.targets.get()
    }

    fn specialization(&self) -> Specialization {
        if self.callee.bits() == Self::MANY_CONSTRUCTORS
            || self.executable.bits() == Self::IS_CONSTRUCTED
        {
            Specialization::Construct
        } else {
            Specialization::Call
        }
    }

    pub fn only_executable(&self) -> Option<Gc<Executable>> {
        match self.callee.get() {
            // SAFETY: a function.
            Some(callee) => Some(unsafe { JsFunction::executable_of(callee) }),
            None => self.executable.get().map(|it| it.cast()),
        }
    }

    /// The shortest, but for code blocks that do not last.
    fn find_way_to_only_target(&self, lasts: impl Fn(Gc<CodeBlock>) -> bool) {
        let specialization = self.specialization();
        let is_usable = |it: &Gc<CodeBlock>| lasts(*it) && it.takes_calls(specialization);
        if let Some(executable) = self.only_executable() {
            let code_block = executable.code_block(specialization).filter(is_usable);
            (self.targets).set(code_block.map_or_else(|| executable.address(), |it| it.address()));
        }
    }

    /// The target may have got other code since. The owner is to be remembered.
    pub fn link_again(&self) {
        self.find_way_to_only_target(|_| true);
    }

    fn has_only_target(&self) -> bool {
        !matches!(
            self.executable.bits(),
            Self::POLYMORPHIC | Self::MEGAMORPHIC
        )
    }

    pub fn targets(&self) -> &[CallTargetCount] {
        if self.targets.get() == 0 || self.has_only_target() {
            return &[];
        }
        let first = core::ptr::with_exposed_provenance(self.targets.get());
        // SAFETY: from `allocate_call_targets` of the code block that has this metadata.
        unsafe { core::slice::from_raw_parts(first, Self::MAX_TARGETS) }
    }

    fn forget_only_target(&self, specialization: Specialization) {
        self.callee.set_special(match specialization {
            Specialization::Call => WeakCell::MANY,
            Specialization::Construct => Self::MANY_CONSTRUCTORS,
        });
        if self.has_only_target() {
            self.executable.set_special(WeakCell::NONE);
            self.targets.set(0);
        }
    }

    /// See `FIRST_NATIVE`.
    pub fn native_callee(&self) -> Option<Intrinsic> {
        let callee = self.callee.get()?.downcast::<JsFunction>()?;
        (self.executable.bits() >= Self::FIRST_NATIVE).then(|| callee.intrinsic())
    }

    pub fn has_run(&self) -> bool {
        self.callee.bits() != WeakCell::NONE
    }

    fn target_of(callee: Gc<JsCell>) -> Gc<JsCell> {
        match callee.downcast::<JsFunction>() {
            Some(function) if !function.is_native() => function.executable().cell(),
            _ => callee,
        }
    }

    /// If the site is polymorphic and knows the target.
    #[inline(always)]
    pub fn try_count(&self, callee: usize, executable: usize) -> bool {
        let known =
            |it: &&CallTargetCount| it.target.bits() == executable || it.target.bits() == callee;
        match self.targets().iter().find(known) {
            Some(entry) => entry.count.update(|count| count.wrapping_add(1)),
            None => return false,
        }
        true
    }

    /// For a call that matches neither the callee nor the executable.
    #[inline(never)]
    pub fn record(&self, owner: &CodeBlock, callee: Value, specialization: Specialization) {
        let state = self.executable.bits();
        let callee = callee
            .as_cell()
            .filter(|cell| CellType::FUNCTIONS.contains(cell.cell_type()));
        let (Some(callee), true) = (callee, state != Self::MEGAMORPHIC) else {
            self.forget_only_target(specialization);
            return self.executable.set_special(Self::MEGAMORPHIC);
        };
        let target = Self::target_of(callee);
        let first = self.callee.get();
        if state == WeakCell::NONE && first.is_none() {
            // SAFETY: a function.
            let executable = unsafe { JsFunction::executable_of(callee) };
            let is_native = executable.entry(Specialization::Call) == call::native_call_entry();
            self.executable.set_special(match specialization {
                Specialization::Construct => Self::IS_CONSTRUCTED,
                _ if is_native => Self::FIRST_NATIVE + executable.intrinsic() as usize,
                _ => Self::IS_CALLED,
            });
            self.callee.set(owner, &callee);
            return self.link_again();
        }
        let earlier = first.map(Self::target_of).or_else(|| self.executable.get());
        self.forget_only_target(specialization);
        if earlier == Some(target) && target != callee {
            self.executable.set(owner, &target);
            return self.link_again();
        }
        if self.targets.get() == 0 {
            (self.targets).set(owner.allocate_call_targets().expose_provenance());
        }
        self.executable.set_special(Self::POLYMORPHIC);
        for target in earlier.into_iter().chain([target]) {
            let has = |bits| self.targets().iter().find(|it| it.target.bits() == bits);
            let Some(entry) = has(target.address()).or_else(|| has(WeakCell::NONE)) else {
                return self.executable.set_special(Self::MEGAMORPHIC);
            };
            entry.target.set(owner, &target);
            entry.count.update(|count| count.wrapping_add(1));
        }
    }
}

// SAFETY: integers.
unsafe impl Entry for CallProfile {
    fn visit(&self, _: &mut Visitor) {}

    fn reconcile(&self, _: &CodeBlock, survivors: &Survivors) {
        // The closure is gone, but the next one is likely to be of the same code.
        if let Some(callee) = self.callee.get().filter(|&it| !survivors.contains(it)) {
            let target = Self::target_of(callee);
            self.forget_only_target(self.specialization());
            if target != callee {
                self.executable.set_unbarriered(&target);
            }
        }
        if self.executable.clear_if_dead(survivors) {
            self.targets.set(0);
        }
        self.find_way_to_only_target(|it| survivors.contains(it));
        for entry in self.targets() {
            if entry.target.clear_if_dead(survivors) {
                entry.count.set(0);
            }
        }
    }
}
