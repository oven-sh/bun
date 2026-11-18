//! A host without JavaScript.

use std::cell::{Cell, RefCell};
use std::collections::BTreeMap;
use std::mem::offset_of;
use std::ptr;
use std::rc::Rc;
use std::sync::{Arc, LazyLock};
use std::time::Duration;

use bun_engine_asm::prelude::*;
use bun_engine_asm::{Features, Options};
use bun_engine_exec_memory::{CodeHandle, Priority, link};
use bun_engine_macros::native_abi;
use bun_engine_wasm_compiler::abi::{
    CALLEE_TAG, ENTRY_CALLEE, HostLayout, INT32_TAG, STUB_CALLEE, Trap, frame,
};
use bun_engine_wasm_format::{FuncIndex, TypeIndex};
use bun_engine_wasm_runtime::{
    Bits, Catch, Contents, Engine, Expected, Frame, Host, HostCall, HostCell, Incoming, Instance,
    Interrupted, Memory, Outgoing, Owned, Reference, Store, Tag, Thrown, Urgency, Vm, Waited,
};

use super::heap::{self, Allocators, Heap, Kind};
use super::waiters::{self, Parker};

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub(crate) enum Failure {
    Trap(Trap),
    Exception(HostCell),
    /// A function of the host ended the program.
    Exit(i32),
}

pub(crate) type HostFunction = dyn Fn(&Machine, &Instance, &[Bits]) -> Result<Vec<Bits>, Failure>;

/// It belongs to the thread that makes it.
#[repr(C)]
pub(crate) struct Machine {
    top_frame: Cell<usize>,
    top_entry_frame: Cell<usize>,
    pending: Cell<Option<Failure>>,
    allocators: Allocators,
    stack_origin: usize,
    store: Rc<Store>,
    heap: RefCell<Heap>,
    roots: RefCell<Vec<HostCell>>,
    opaque: RefCell<BTreeMap<u32, HostCell>>,
    functions: RefCell<Vec<Rc<HostFunction>>>,
    /// Collects garbage after so many allocations.
    collection_interval: Cell<u32>,
    allocations: Cell<u32>,
    collections: Cell<u32>,
    /// The last ends the program.
    pub(crate) interrupts_left: Cell<u32>,
    pub(crate) parker: Arc<Parker>,
    /// At the last trap, the innermost first.
    pub(crate) stack_trace: RefCell<Vec<u32>>,
    /// When the run time last called, if it is not `None`.
    pub(crate) callers: RefCell<Option<Vec<u32>>>,
    /// The lengths before and after.
    pub(crate) growths: RefCell<Vec<(u64, u64)>>,
    pub(crate) urgencies: RefCell<Vec<Urgency>>,
}

struct Invocation<'a> {
    arguments: &'a [Bits],
    results: Vec<Bits>,
}

struct Entry {
    code: CodeHandle,
    landing: usize,
    spill: usize,
    spoil: usize,
}

#[native_abi]
type Enter = unsafe fn(*const Machine, HostCell, *mut Invocation<'_>, usize) -> u64;
#[native_abi]
type Collect = unsafe fn(&Machine, usize, usize);
#[native_abi]
type Spill = unsafe fn(&Machine, usize, Collect);

static ENTRY: LazyLock<Entry> = LazyLock::new(|| {
    let (fp, sp) = (abi::FRAME_POINTER, abi::STACK_POINTER);
    let [first, second, third, fourth] = *abi::ARGUMENT_GPRS.first_chunk().unwrap();
    let [temp, other] = abi::NON_ARGUMENT_GPRS;
    let top_frames = Address::new(abi::VM, offset_of!(Machine, top_frame) as i32);
    let saved_size = (abi::CALLEE_SAVED.len() * 8).next_multiple_of(16) as i32;
    let (record, saved) = (Address::new(fp, -16), Address::new(fp, -16 - saved_size));
    let mut masm = MacroAssembler::new(Options {
        features: Features::empty(),
        shorten_jumps: false,
        seed: 0,
    });
    masm.enter_frame();
    masm.sub64(sp, sp, 16 + saved_size + 32);
    masm.store_registers(abi::CALLEE_SAVED, 8, saved);
    masm.move64(abi::VM, first);
    masm.load_pair64(temp, other, top_frames);
    masm.store_pair64(record, temp, other);
    masm.store64(top_frames.plus(8), fp);
    masm.store64(Address::new(sp, 0), 0);
    masm.store_pair64(Address::new(sp, 8), second, third);
    masm.call_indirect(fourth);
    let (exit, wrong_tags) = (masm.here(), masm.new_label());
    masm.branch64(Cond::Ne, abi::NUMBER_TAG, INT32_TAG, wrong_tags);
    masm.branch64(Cond::Ne, abi::NOT_CELL_MASK, INT32_TAG | 2, wrong_tags);
    masm.load_pair64(third, fourth, record);
    masm.store_pair64(top_frames, third, fourth);
    masm.load_registers(abi::CALLEE_SAVED, 8, saved);
    masm.leave_frame();
    masm.ret();
    let landing = masm.here();
    masm.move64(abi::RETURN_GPRS[0], 0);
    masm.jump(exit);

    masm.bind(wrong_tags);
    masm.breakpoint();

    let spill = masm.here();
    masm.enter_frame();
    masm.sub64(sp, sp, saved_size);
    masm.store_registers(abi::CALLEE_SAVED, 8, Address::new(sp, 0));
    masm.move64(temp, third);
    masm.move64(third, sp);
    masm.call_indirect(temp);
    masm.leave_frame();
    masm.ret();

    let spoil = masm.here();
    masm.enter_frame();
    for reg in abi::CALLER_SAVED.gprs() {
        masm.move64(reg, -1);
    }
    for reg in (abi::CALLER_SAVED | abi::CALLEE_SAVED_LOW_HALF).fprs() {
        masm.replace_int_lane(Size::S64, reg, reg, 1, temp);
    }
    for reg in abi::CALLER_SAVED.fprs() {
        masm.replace_int_lane(Size::S64, reg, reg, 0, temp);
    }
    masm.leave_frame();
    masm.ret();

    let bytes = masm.finish().unwrap();
    let code = link(&bytes, Priority::Required, |_| unreachable!()).unwrap();
    Entry {
        landing: code.address(bytes.offset_of(landing)),
        spill: code.address(bytes.offset_of(spill)),
        spoil: code.address(bytes.offset_of(spoil)),
        code,
    }
});

/// Overwrites all that a C function may overwrite.
pub(crate) fn spoil_registers() {
    #[native_abi]
    type Spoil = unsafe fn();
    // SAFETY: the code has this type.
    unsafe { std::mem::transmute::<usize, Spoil>(ENTRY.spoil)() };
}

fn word(address: usize) -> usize {
    // SAFETY: on the stack of this thread.
    unsafe { ptr::with_exposed_provenance::<usize>(address).read_volatile() }
}

impl Machine {
    /// WebAssembly may use `stack_size` bytes from `stack_origin` down. There has to be `STACK_RESERVE` more.
    pub(crate) fn new(
        engine: &'static Engine,
        stack_origin: usize,
        stack_size: usize,
    ) -> Box<Self> {
        let mut machine = Box::<Self>::new_uninit();
        let vm = Vm(machine.as_mut_ptr().expose_provenance());
        let stack = stack_origin - stack_size..stack_origin;
        // SAFETY: `drop` destroys the cells, and the caller vouches for the stack.
        let store = unsafe { Store::new(engine, vm, stack) };
        Box::write(
            machine,
            Self {
                top_frame: Cell::new(0),
                top_entry_frame: Cell::new(0),
                pending: Cell::new(None),
                allocators: heap::allocators(),
                stack_origin,
                store,
                heap: RefCell::default(),
                roots: RefCell::default(),
                opaque: RefCell::default(),
                functions: RefCell::default(),
                collection_interval: Cell::new(0),
                allocations: Cell::new(0),
                collections: Cell::new(0),
                interrupts_left: Cell::new(1),
                parker: Arc::default(),
                stack_trace: RefCell::default(),
                callers: RefCell::default(),
                growths: RefCell::default(),
                urgencies: RefCell::default(),
            },
        )
    }

    fn of<'a>(vm: Vm) -> &'a Self {
        // SAFETY: it outlives the uses of the store.
        unsafe { &*ptr::with_exposed_provenance(vm.0) }
    }

    pub(crate) fn store(&self) -> &Rc<Store> {
        &self.store
    }

    pub(crate) fn engine(&self) -> &'static Engine {
        self.store.engine()
    }

    /// Before the first cell is made.
    pub(crate) fn collect_every(&self, allocations: u32) {
        self.heap.borrow_mut().collects = true;
        self.collection_interval.set(allocations);
    }

    pub(crate) fn recycle_cells(&self) {
        self.heap.borrow_mut().recycles = true;
    }

    pub(crate) fn root(&self, cell: HostCell) {
        self.roots.borrow_mut().push(cell);
    }

    pub(crate) fn unroot_all(&self) {
        self.roots.borrow_mut().clear();
    }

    pub(crate) fn cells_freed(&self) -> usize {
        self.heap.borrow().freed
    }

    pub(crate) fn collect(&self, is_full: bool) {
        #[native_abi]
        unsafe fn collect(machine: &Machine, is_full: usize, stack_top: usize) {
            let stack = (stack_top..machine.stack_origin).step_by(8).map(word);
            let stack: Vec<usize> = stack.collect();
            // SAFETY: the whole stack of this thread.
            unsafe { machine.store.release_code_not_on_stack(&stack) };
            if !machine.heap.borrow().collects {
                return;
            }
            let pending = match machine.pending.get() {
                Some(Failure::Exception(exception)) => Some(exception),
                _ => None,
            };
            let (roots, opaque) = (machine.roots.borrow(), machine.opaque.borrow());
            let cells = roots.iter().chain(opaque.values()).copied().chain(pending);
            let words = stack.into_iter().chain(cells.map(HostCell::address));
            let (engine, heap) = (machine.engine(), &mut machine.heap.borrow_mut());
            for cell in heap.mark(engine, &machine.allocators, words, is_full != 0) {
                heap.destroy(engine, cell);
            }
        }
        // SAFETY: the code has this type.
        unsafe { std::mem::transmute::<usize, Spill>(ENTRY.spill)(self, is_full.into(), collect) };
    }

    fn note_callers(&self) {
        if let Some(callers) = &mut *self.callers.borrow_mut() {
            *callers = self.capture_stack_trace(10);
        }
    }

    fn heap_for_allocation(&self) -> std::cell::RefMut<'_, Heap> {
        self.note_callers();
        self.allocations.update(|count| count + 1);
        if self.allocations.get() == self.collection_interval.get() {
            self.allocations.set(0);
            self.collections.update(|count| count + 1);
            self.collect(self.collections.get().is_multiple_of(8));
        }
        self.heap.borrow_mut()
    }

    pub(crate) fn new_instance_cell(&self, size: usize) -> HostCell {
        let cell = self.heap_for_allocation().new_cell(Kind::Instance, size, 0);
        cell.unwrap()
    }

    pub(crate) fn new_owner(&self, owned: Owned) -> HostCell {
        let cell = self.heap_for_allocation().new_owner(Kind::Owner, 16, owned);
        cell.unwrap()
    }

    pub(crate) fn new_opaque(&self, number: usize) -> HostCell {
        let cell = self
            .heap_for_allocation()
            .new_cell(Kind::Opaque, 16, number);
        cell.unwrap()
    }

    /// The same object for the same number.
    pub(crate) fn opaque(&self, number: u32) -> Reference {
        let existing = self.opaque.borrow().get(&number).copied();
        let cell = existing.unwrap_or_else(|| self.new_opaque(number as usize));
        self.opaque.borrow_mut().insert(number, cell);
        cell.into()
    }

    /// Gives its number.
    pub(crate) fn add_function(&self, function: Rc<HostFunction>) -> usize {
        self.functions.borrow_mut().push(function);
        self.functions.borrow().len() - 1
    }

    /// The arguments have the right types.
    pub(crate) fn call(
        &self,
        function: HostCell,
        arguments: &[Bits],
    ) -> Result<Vec<Bits>, Failure> {
        let mut invocation = Invocation {
            arguments,
            results: Vec::new(),
        };
        let stub = self.engine().enter_stub();
        // SAFETY: the code has this type.
        let returned = unsafe {
            let enter = std::mem::transmute::<usize, Enter>(ENTRY.code.start());
            enter(self, function, &raw mut invocation, stub)
        };
        match returned {
            0 => Err(self.pending.take().unwrap()),
            _ => Ok(invocation.results),
        }
    }

    fn frames(&self) -> impl Iterator<Item = Frame> {
        let mut entry_frame = self.top_entry_frame.get();
        let top = Frame {
            fp: self.top_frame.get(),
            return_address: 0,
        };
        std::iter::successors(Some(top), move |frame| {
            let caller = word(frame.fp);
            if caller != entry_frame {
                return Some(Frame {
                    fp: caller,
                    return_address: word(frame.fp + 8),
                });
            }
            entry_frame = word(caller - 8);
            Some(Frame {
                fp: word(caller - 16),
                return_address: 0,
            })
            .filter(|frame| frame.fp != 0)
        })
    }

    fn check_header(&self, frame: Frame) {
        let callee = word(frame.fp + frame::CALLEE as usize);
        assert_eq!(callee & CALLEE_TAG as usize, CALLEE_TAG as usize);
        // SAFETY: a frame of this thread.
        let (instance, is_stub) = unsafe {
            let is_stub = self.engine().functions_in(frame).next().is_none();
            (self.engine().instance_of_frame(frame.fp), is_stub)
        };
        assert!(Rc::ptr_eq(instance.store(), &self.store));
        assert_eq!(
            [STUB_CALLEE, ENTRY_CALLEE].contains(&(callee as u32)),
            is_stub
        );
    }

    /// The functions that are active, the innermost first.
    pub(crate) fn capture_stack_trace(&self, limit: usize) -> Vec<u32> {
        // SAFETY: frames of this thread.
        let functions = |frame| unsafe { self.engine().functions_in(frame) };
        let frames = self.frames().inspect(|&it| self.check_header(it));
        let all = frames.flat_map(functions);
        all.map(|func| func.0).take(limit).collect()
    }
}

impl Drop for Machine {
    fn drop(&mut self) {
        let engine = self.engine();
        self.heap.get_mut().destroy_all(engine);
    }
}

/// # Safety
/// The frame is that of the stub that `Machine::call` calls.
unsafe fn invocation_of<'a>(fp: usize) -> &'a mut Invocation<'a> {
    let address = word(fp + frame::ARGUMENTS as usize);
    // SAFETY: the caller's.
    unsafe { &mut *ptr::with_exposed_provenance_mut(address) }
}

pub(crate) struct Native;

// SAFETY: see `heap`.
unsafe impl Host for Native {
    fn layout(&self) -> HostLayout {
        heap::layout(offset_of!(Machine, top_frame) as i32)
    }

    fn allocators(&self, vm: Vm) -> usize {
        vm.0 + offset_of!(Machine, allocators)
    }

    fn allocate_object(&self, vm: Vm, size: usize, contents: Contents) -> Option<HostCell> {
        let machine = Machine::of(vm);
        let cell = heap::take_free_cell(&machine.allocators, size).or_else(|| {
            let mut heap = machine.heap_for_allocation();
            heap.allocate_object(&machine.allocators, size)
        })?;
        if contents == Contents::Zeros {
            // SAFETY: the new cell.
            unsafe { ptr::with_exposed_provenance_mut::<u8>(cell.address()).write_bytes(0, size) };
        }
        Some(cell)
    }

    fn object_type(
        &self,
        instance: &Instance,
        ty: TypeIndex,
        supertype: Option<u64>,
    ) -> Option<(u64, HostCell)> {
        let ty = instance.module().types().canonical(ty);
        let machine = Machine::of(instance.store().vm());
        machine.heap_for_allocation().object_type(ty, supertype)
    }

    fn new_function(&self, instance: &Instance, _: FuncIndex) -> Option<HostCell> {
        let machine = Machine::of(instance.store().vm());
        machine
            .heap_for_allocation()
            .new_cell(Kind::Function, 40, 0)
    }

    fn new_exception(&self, instance: &Instance, tag: &Tag, owner: HostCell) -> Option<HostCell> {
        let layout = self.layout();
        let size = layout.exception_payload as usize + tag.payload_size() as usize;
        let mut heap = Machine::of(instance.store().vm()).heap_for_allocation();
        let exception = heap.new_cell(Kind::Exception, size, owner.address())?;
        let place = exception.address() + layout.exception_tag as usize;
        // SAFETY: within the size.
        unsafe { ptr::with_exposed_provenance_mut::<usize>(place).write(tag.identity()) };
        Some(exception)
    }

    fn new_owner(&self, instance: &Instance, owned: Owned) -> Option<HostCell> {
        Some(Machine::of(instance.store().vm()).new_owner(owned))
    }

    fn write_barrier(&self, vm: Vm, cell: HostCell) {
        Machine::of(vm).heap.borrow_mut().remember(cell);
        spoil_registers();
    }

    fn throw_trap(&self, instance: &Instance, trap: Trap) {
        let machine = Machine::of(instance.store().vm());
        drop(machine.heap_for_allocation());
        machine
            .stack_trace
            .replace(machine.capture_stack_trace(100));
        machine.pending.set(Some(Failure::Trap(trap)));
    }

    unsafe fn will_catch(&self, instance: &Instance, _: HostCell) -> Result<(), Thrown> {
        drop(Machine::of(instance.store().vm()).heap_for_allocation());
        Ok(())
    }

    unsafe fn throw(&self, instance: &Instance, exception: HostCell) {
        let machine = Machine::of(instance.store().vm());
        machine.note_callers();
        machine.pending.set(Some(Failure::Exception(exception)));
    }

    unsafe fn take_exception(
        &self,
        instance: &Instance,
        is_caught: &dyn Fn(&Tag) -> bool,
    ) -> Option<HostCell> {
        let machine = Machine::of(instance.store().vm());
        let Some(Failure::Exception(exception)) = machine.pending.get() else {
            return None;
        };
        let tag = word(exception.address() + self.layout().exception_tag as usize);
        // SAFETY: an exception with its tag.
        is_caught(unsafe { &*ptr::with_exposed_provenance::<Tag>(tag) }).then(|| {
            machine.pending.take();
            exception
        })
    }

    unsafe fn interrupt(&self, instance: &Instance) -> Result<(), Thrown> {
        let machine = Machine::of(instance.store().vm());
        drop(machine.heap_for_allocation());
        spoil_registers();
        machine.interrupts_left.update(|left| left - 1);
        if machine.interrupts_left.get() != 0 {
            return Ok(());
        }
        machine.store.interrupts().update(|| false);
        machine.pending.set(Some(Failure::Exit(-2)));
        Err(Thrown)
    }

    fn must_terminate(&self, vm: Vm) -> bool {
        let left = &Machine::of(vm).interrupts_left;
        spoil_registers();
        left.update(|left| left - 1);
        left.get() == 0
    }

    fn terminate(&self, instance: &Instance) {
        let machine = Machine::of(instance.store().vm());
        machine.note_callers();
        machine.store.interrupts().update(|| false);
        machine.pending.set(Some(Failure::Exit(-2)));
    }

    unsafe fn unwind(&self, vm: Vm, fp: usize) -> Catch {
        let machine = Machine::of(vm);
        let entry_frame = machine.top_entry_frame.get();
        let mut frame = Frame {
            fp,
            return_address: 0,
        };
        machine.check_header(frame);
        while frame.fp != entry_frame {
            if let Some(Failure::Exception(exception)) = machine.pending.get() {
                let tag = word(exception.address() + self.layout().exception_tag as usize);
                // SAFETY: a frame of this thread, and an exception with its tag.
                let address = unsafe {
                    let tag = &*ptr::with_exposed_provenance::<Tag>(tag);
                    let handler = machine.engine().find_handler(frame, || Some(tag));
                    handler.map(|it| it.enter_with(exception))
                };
                if let Some(address) = address {
                    machine.pending.take();
                    let fp = frame.fp;
                    return Catch { fp, address };
                }
            }
            frame = Frame {
                fp: word(frame.fp),
                return_address: word(frame.fp + 8),
            };
        }
        Catch {
            fp: entry_frame,
            address: ENTRY.landing,
        }
    }

    fn call(&self, call: HostCall<'_>) -> Result<(), Interrupted> {
        let machine = Machine::of(call.instance().store().vm());
        let (object, number) = call.function();
        let object = object
            .cell()
            .map(|it| (heap::kind_of(it), heap::private_word(it)));
        assert_eq!(object, Some((Kind::Opaque, number)));
        let function = Rc::clone(&machine.functions.borrow()[number]);
        let count = call.arguments().types().len();
        let arguments: Vec<Bits> = (0..count)
            .map(|index| call.arguments().get(index))
            .collect();
        let values = function(machine, call.instance(), &arguments).map_err(|failure| {
            machine.pending.set(Some(failure));
            Interrupted::Thrown
        })?;
        let mut results = call.into_results();
        assert_eq!(values.len(), results.types().len());
        for (index, value) in values.into_iter().enumerate() {
            results.set(index, value);
        }
        Ok(())
    }

    unsafe fn put_results(&self, _: &Instance, _: u64, _: Outgoing<'_>) -> Result<(), Thrown> {
        unreachable!("nothing jumps to the end of the stub")
    }

    unsafe fn put_arguments(
        &self,
        instance: &Instance,
        _: HostCell,
        fp: usize,
        mut arguments: Outgoing<'_>,
    ) -> Result<(), Thrown> {
        assert_eq!(Machine::of(instance.store().vm()).top_frame.get(), fp);
        // SAFETY: the caller's.
        let invocation = unsafe { invocation_of(fp) };
        assert_eq!(invocation.arguments.len(), arguments.types().len());
        for (index, &value) in invocation.arguments.iter().enumerate() {
            arguments.set(index, value);
        }
        Ok(())
    }

    unsafe fn take_results(
        &self,
        instance: &Instance,
        fp: usize,
        results: Incoming<'_>,
    ) -> Result<u64, Thrown> {
        assert_eq!(Machine::of(instance.store().vm()).top_frame.get(), fp);
        let values = (0..results.types().len()).map(|index| results.get(index));
        // SAFETY: the caller's.
        unsafe { invocation_of(fp) }.results.extend(values);
        Ok(1)
    }

    fn memory_grew(&self, vm: Vm, memory: &Memory, old_length: u64) {
        Machine::of(vm).note_callers();
        let growth = (old_length, memory.len());
        Machine::of(vm).growths.borrow_mut().push(growth);
    }

    fn report_allocation(&self, vm: Vm, _: HostCell, _: usize) {
        drop(Machine::of(vm).heap_for_allocation());
    }

    fn module_grew(&self, _: &Instance) {}

    fn collect_garbage(&self, vm: Vm, urgency: Urgency) {
        let machine = Machine::of(vm);
        machine.urgencies.borrow_mut().push(urgency);
        if urgency == Urgency::Now {
            machine.collect(true);
        }
    }

    unsafe fn wait(
        &self,
        instance: &Instance,
        address: usize,
        expected: Expected,
        timeout: Option<Duration>,
    ) -> Result<Waited, Thrown> {
        let machine = Machine::of(instance.store().vm());
        machine.note_callers();
        // SAFETY: the caller's.
        let waited = unsafe { machine.parker.wait(address, expected, timeout) };
        waited.inspect_err(|_| machine.pending.set(Some(Failure::Exit(-1))))
    }

    fn notify(&self, address: usize, count: u32) -> u32 {
        waiters::notify(address, count)
    }
}
