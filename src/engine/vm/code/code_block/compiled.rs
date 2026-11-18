//! The machine code of a code block.

use core::any::Any;
use core::cell::RefCell;
use core::ops::Range;
use std::rc::Rc;

use bun_engine_bytecode::Specialization;

use crate::heap::Survivors;
use crate::{CodeBlock, Gc, GcFree, Value, ValueVec, Visitor, Vm};

#[derive(Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash, Debug)]
#[repr(u8)]
pub enum Tier {
    Interpreter,
    Baseline,
    QuickOptimized,
    FullyOptimized,
}

/// A call that optimized code has inlined.
#[derive(Clone, Copy)]
pub struct InlineFrame {
    pub code_block: Gc<CodeBlock>,
    /// Where it was called from.
    pub caller: CodeOrigin,
    pub is_tail_call: bool,
    pub specialization: Specialization,
}

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub struct CodeOrigin {
    pub bytecode_offset: u32,
    /// `None` in the function that has the frame.
    pub inline_frame: Option<u32>,
}

/// Machine code for a code block, as far as the rest of the engine has to know it.
pub trait CompiledCode: GcFree + Any {
    /// What the call site slot of a frame stands for.
    fn origin_of_call_site(&self, call_site: u32) -> CodeOrigin;

    /// Whether `origin_of_call_site` knows the number, which may be anything.
    fn has_call_site(&self, call_site: u32) -> bool;

    /// What the instruction at the address, which may be anything, was made for. See `Vm::records_code_origins`.
    fn origin_of_address(&self, address: usize) -> Option<CodeOrigin>;

    fn inline_frame(&self, vm: &Vm, index: u32) -> InlineFrame;

    /// # Safety
    /// `frame` runs this code and is at a call site inside the inlined call.
    unsafe fn inline_callee(&self, frame: &crate::CallFrame, index: u32) -> Value;

    /// Adds those of an inlined call, without `this`. For the call that has the frame, `out` has what is in there.
    ///
    /// # Safety
    /// As above.
    unsafe fn current_arguments(
        &self,
        _frame: &crate::CallFrame,
        _index: Option<u32>,
        _out: &mut ValueVec,
    ) {
    }

    /// Where to go on with an exception that the handler at `target` in the code of `origin` catches.
    fn catch_address(&self, call_site: u32, origin: CodeOrigin, target: u32) -> usize;

    fn visit(&self, owner: &CodeBlock, visitor: &mut Visitor);

    /// If `visit` has asked for it.
    fn visit_output_constraints(&self, _: &mut Visitor) {}

    /// What may die only while no frame runs the code.
    fn visit_while_running(&self, _: &mut Visitor) {}

    fn reconcile_weak_references(&self, owner: &CodeBlock, survivors: &Survivors);

    /// Makes frames that are running the code leave it at the next opportunity.
    fn invalidate(&self);

    fn addresses(&self) -> Range<usize>;

    /// With the tables.
    fn size(&self) -> usize;
}

/// Machine code that code blocks have replaced, with the addresses of these.
#[derive(Default)]
pub(in crate::code) struct RetiredCode(RefCell<Vec<(usize, Rc<dyn CompiledCode>)>>);

impl CodeBlock {
    /// For markers too, which leave the count alone.
    ///
    /// # Safety
    /// There is no call of `set_compiled` while the result lives.
    #[inline(always)]
    pub(super) unsafe fn borrow_compiled(&self) -> Option<&Rc<dyn CompiledCode>> {
        // SAFETY: the caller's.
        unsafe { &*self.compiled.as_ptr() }.as_ref()
    }

    #[inline]
    pub fn compiled(&self) -> Option<Rc<dyn CompiledCode>> {
        // SAFETY: gone at once.
        unsafe { self.borrow_compiled() }.cloned()
    }

    /// What it replaces stays for as long as frames may return to it.
    ///
    /// # Safety
    /// It has been compiled from this code, and calls enter it at `entry`.
    pub unsafe fn set_compiled(&self, tier: Tier, compiled: Rc<dyn CompiledCode>, entry: usize) {
        let (size, heap) = (compiled.size(), self.heap());
        heap.note_extra_memory_allocated(self, size);
        (self.extra_memory).update(|it| it.saturating_add(size as u32));
        if let Some(old) = self.compiled.replace(Some(compiled)) {
            (self.extra_memory).update(|it| it.saturating_sub(old.size() as u32));
            self.retire(old);
        }
        self.tier.set(tier);
        self.write_barrier_for_cell();
        let (executable, specialization) = (self.executable(), self.specialization());
        if executable.code_block(specialization) == Some(self.into()) {
            // SAFETY: the caller's.
            unsafe { executable.install(specialization, entry, Some(self.into())) };
        }
    }

    pub fn is_jettisoned(&self) -> bool {
        self.is_jettisoned.get()
    }

    /// Optimized code whose assumptions no longer hold gives way to its alternative.
    pub fn jettison(&self, vm: &Vm) {
        if self.is_optimized() && !self.is_jettisoned.replace(true) {
            (vm.hooks().jettison)(vm, self);
        }
    }

    fn retire(&self, code: Rc<dyn CompiledCode>) {
        let retired = &self.heap().vm().services.code.retired;
        retired.0.borrow_mut().push((self.address(), code));
    }

    /// See `CompiledCode::origin_of_address`. Also in code that it has replaced.
    pub fn origin_of_address(&self, address: usize) -> Option<CodeOrigin> {
        (self.compiled()?.origin_of_address(address)).or_else(|| {
            let retired = self.heap().vm().services.code.retired.0.borrow();
            let mut own = retired.iter().filter(|it| it.0 == self.address());
            own.find_map(|it| it.1.origin_of_address(address))
        })
    }
}

impl Vm {
    /// # Safety
    /// All return addresses on the stack are among `words`.
    pub(crate) unsafe fn release_retired_code(&self, words: &[usize]) {
        let mut retired = self.services.code.retired.0.borrow_mut();
        if retired.is_empty() {
            return;
        }
        let addresses = retired.iter().map(|it| it.1.addresses());
        let mut ranges: Vec<_> = addresses.map(|it| (it.start, it.end, false)).collect();
        ranges.sort_unstable();
        ranges.dedup();
        for &word in words {
            let after = ranges.partition_point(|it| it.0 <= word);
            // A call may be the last instruction, and other code may follow at once.
            for (_, end, is_needed) in ranges[..after].iter_mut().rev().take(2) {
                *is_needed |= word <= *end;
            }
        }
        retired.retain(|(_, code)| {
            let start = code.addresses().start;
            ranges[ranges.partition_point(|it| it.0 < start)].2
        });
    }
}
