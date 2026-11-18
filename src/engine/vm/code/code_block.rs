mod compiled;
mod constants;

use core::cell::{Cell, OnceCell};
use core::mem::offset_of;
use std::rc::Rc;

use bun_engine_bytecode::{
    Body, Code, CodeFlags, CodeKind, FunctionIndex, FunctionRef, IdentifierIndex, Instructions,
    MetadataKind, Opcode, Position, SavedRegister, ScopeIndex, Specialization, SuspendPoint,
    SuspendPointIndex,
};
use bun_engine_macros::cell;
use bun_engine_text::PropertyName;

use super::lease::Lease;
use super::metadata;
use super::optimization::Optimization;
use super::profile::ValueProfile;
use super::tiering::Bytecode;
use crate::call::{replaced_call_entry, replaced_construct_entry};
use crate::heap::Survivors;
use crate::{
    CellKind, Cx, Field, FunctionExecutable, Gc, GlobalObject, JsCell, JsResult, ScopeTemplate,
    ScriptExecutable, SourceProviderRef, TypeFlags, Value, Visitor, Vm,
};

pub(super) use compiled::RetiredCode;
pub use compiled::{CodeOrigin, CompiledCode, InlineFrame, Tier};

/// How often a range of the source has run.
pub type CoverageCount = Rc<Cell<u64>>;

/// What code that runs a few times does without.
#[derive(Default)]
pub(super) struct RareData {
    pub(super) caches: metadata::SideTables,
    pub(super) optimization: Optimization,
    /// One for each of the coverage blocks.
    coverage_counts: OnceCell<Box<[CoverageCount]>>,
}

/// Code linked to a realm. The metadata, the profiles of the arguments, the constants, the executables of inner functions
/// and the scope templates follow. Optimized code has one of its own, and uses those of its `alternative`.
#[cell(cell_type = CodeBlock, flags = TypeFlags::SHAPE_IS_IMMORTAL, export = "engine_class_CodeBlock",
    visit_children, visit_output_constraints, reconcile_weak_references, estimated_size)]
pub struct CodeBlock {
    base: JsCell,
    /// A call can go through a code block as through an `Executable`.
    entries: [Cell<usize>; 2],
    /// Zero where the entry forwards the call.
    own_address: [Cell<usize>; 2],
    /// Of machine code. Counts up to zero, where the next tier is considered.
    pub(super) execution_counter: Cell<i32>,
    parameters: u32,
    global: Gc<GlobalObject>,
    instructions: *const u8,
    constants: *mut u64,
    locals: u32,
    /// Of baseline code. Counts what it was not made for, up to zero, where it is made again.
    surprise_counter: Cell<i32>,
    pub(super) owner: Field<Gc<ScriptExecutable>>,
    rare_data: OnceCell<Box<RareData>>,
    first_function: u32,
    first_scope: u32,
    tier: Cell<Tier>,
    is_jettisoned: Cell<bool>,
    /// To an executable that no function has.
    pub(super) is_handed_on: Cell<bool>,
    pub(crate) has_transitions: Cell<bool>,
    /// How often the counter has run out since the warm-up for an optimizer began.
    pub(super) periods: Cell<u16>,
    /// With `this`, whenever the arguments have been taken as a whole. Zero at first.
    pub(super) usual_argument_count: Cell<u16>,
    saved_words: u32,
    extra_memory: Cell<u32>,
    /// How many breakpoints may be hit in the code.
    debugger_requests: Cell<u32>,
    pub(super) lease: Lease,
    suspend_points: *const SuspendPoint,
    alternative: Option<Gc<CodeBlock>>,
    pub(super) bytecode: Bytecode,
    compiled: Cell<Option<Rc<dyn CompiledCode>>>,
}

const _: () = {
    let first = Specialization::Call;
    assert!(offset_of!(CodeBlock, entries) == crate::Executable::offset_of_entry(first));
    assert!(offset_of!(CodeBlock, own_address) == crate::Executable::offset_of_code_block(first));
};

impl CodeBlock {
    pub const OFFSET_OF_INSTRUCTIONS: usize = offset_of!(CodeBlock, instructions);
    pub const OFFSET_OF_METADATA: usize = size_of::<CodeBlock>();
    pub const OFFSET_OF_CONSTANTS: usize = offset_of!(CodeBlock, constants);
    pub const OFFSET_OF_LOCALS: usize = offset_of!(CodeBlock, locals);
    pub const OFFSET_OF_PARAMETERS: usize = offset_of!(CodeBlock, parameters);
    pub const OFFSET_OF_GLOBAL: usize = offset_of!(CodeBlock, global);
    pub const OFFSET_OF_EXECUTION_COUNTER: usize = offset_of!(CodeBlock, execution_counter);
    pub const OFFSET_OF_SURPRISE_COUNTER: usize = offset_of!(CodeBlock, surprise_counter);
    pub const OFFSET_OF_USUAL_ARGUMENT_COUNT: usize = offset_of!(CodeBlock, usual_argument_count);
    /// For that.
    pub const SEVERAL_ARGUMENT_COUNTS: u16 = u16::MAX;
    pub const OFFSET_OF_DEBUGGER_REQUESTS: usize = offset_of!(CodeBlock, debugger_requests);

    /// In words from the start of the metadata.
    pub fn first_constant(body: &Body) -> usize {
        body.metadata().words() as usize + body.parameters() as usize
    }

    /// In the realm of `cx`.
    pub fn link(
        cx: &mut Cx,
        executable: Gc<ScriptExecutable>,
        code: Rc<Code>,
    ) -> JsResult<Gc<CodeBlock>> {
        let constants = Self::first_constant(&code.body);
        let functions = code.constants.len();
        let scopes = functions + code.functions.len();
        let count = constants + scopes + code.scopes.len();
        let size = size_of::<CodeBlock>() + count * size_of::<u64>();
        let address = match u32::try_from(count) {
            Ok(_) => cx.heap.destructible_cells.try_allocate(&cx.heap, size),
            Err(_) => 0,
        };
        if address == 0 {
            return Err(cx.throw_out_of_memory());
        }
        let cell = core::ptr::with_exposed_provenance_mut::<CodeBlock>(address);
        let words = cell.wrapping_add(1).cast::<u64>();
        // This reference to the code is about to be that of the code block. One more is where it has come from.
        let share_of_code = code.memory_size() / (Rc::strong_count(&code) - 1).max(1);
        let extra_memory = share_of_code.min(u32::MAX as usize);
        let init = CodeBlockInit {
            base: cx.shapes.code_block(),
            entries: [replaced_call_entry(), replaced_construct_entry()].map(Cell::new),
            own_address: Default::default(),
            instructions: code.body.instructions().as_ptr(),
            locals: code.body.locals(),
            parameters: code.body.parameters(),
            global: cx.global(),
            owner: executable,
            rare_data: OnceCell::new(),
            constants: words.wrapping_add(constants),
            first_function: functions as u32,
            first_scope: scopes as u32,
            execution_counter: Cell::new(0),
            surprise_counter: Cell::new(0),
            tier: Cell::new(Tier::Interpreter),
            is_jettisoned: Cell::new(false),
            is_handed_on: Cell::new(false),
            has_transitions: Cell::new(false),
            periods: Cell::new(0),
            usual_argument_count: Cell::new(0),
            saved_words: code.body.saved_words(),
            extra_memory: Cell::new(extra_memory as u32),
            debugger_requests: Cell::new(0),
            lease: Lease::default(),
            suspend_points: code.body.suspend_points().as_ptr(),
            alternative: None,
            bytecode: Bytecode::new(code),
            compiled: Cell::new(None),
        };
        // SAFETY: a new cell of that size, in a space that destroys it by its shape.
        let code_block = unsafe {
            CodeBlock::initialize(cell, init);
            words.write_bytes(0, count);
            Gc::<CodeBlock>::from_address(address)
        };
        if code_block.body().flags().contains(CodeFlags::HAS_COVERAGE) {
            code_block.link_coverage_counts(cx);
        }
        let anchored = code_block.anchor();
        for (slot, constant) in anchored.fields().iter().zip(&anchored.code().constants) {
            let value = code_block.link_constant(cx, constant)?;
            // SAFETY: traced by `visit_children`.
            unsafe { slot.set(&code_block, value) };
        }
        code_block.begin_lease_of_bytecode(cx);
        (cx.heap).note_extra_memory_allocated(&code_block, extra_memory);
        cx.heap.collect_if_extra_memory_adds_up();
        Ok(code_block)
    }

    /// For optimized code. It shares everything with `self` but the tier.
    pub fn create_replacement(&self, vm: &Vm, tier: Tier) -> Gc<CodeBlock> {
        vm.allocate::<CodeBlock>(CodeBlockInit {
            base: vm.shapes.code_block(),
            entries: [replaced_call_entry(), replaced_construct_entry()].map(Cell::new),
            own_address: Default::default(),
            instructions: self.instructions,
            locals: self.locals,
            parameters: self.parameters,
            global: self.global,
            owner: self.executable(),
            rare_data: OnceCell::new(),
            constants: self.constants,
            first_function: self.first_function,
            first_scope: self.first_scope,
            execution_counter: Cell::new(0),
            surprise_counter: Cell::new(0),
            tier: Cell::new(tier),
            is_jettisoned: Cell::new(false),
            is_handed_on: Cell::new(false),
            has_transitions: Cell::new(false),
            periods: Cell::new(0),
            usual_argument_count: Cell::new(0),
            saved_words: self.saved_words,
            extra_memory: Cell::new(0),
            debugger_requests: Cell::new(0),
            lease: Lease::default(),
            suspend_points: self.suspend_points,
            alternative: Some(self.baseline()),
            bytecode: Bytecode::new(Rc::clone(self.code())),
            compiled: Cell::new(None),
        })
    }

    /// `None` once it is no longer installed.
    pub(super) fn set_entry(&self, specialization: Specialization, entry: Option<usize>) {
        let (entry, address) = match (entry, specialization) {
            (Some(entry), _) if !self.baseline().is_handed_on.get() => (entry, self.address()),
            (_, Specialization::Call) => (replaced_call_entry(), 0),
            (_, Specialization::Construct) => (replaced_construct_entry(), 0),
        };
        self.entries[specialization as usize].set(entry);
        self.own_address[specialization as usize].set(address);
    }

    pub(crate) fn takes_calls(&self, specialization: Specialization) -> bool {
        self.own_address[specialization as usize].get() != 0
    }

    pub(super) fn rare_data(&self) -> &RareData {
        self.rare_data.get_or_init(Box::default)
    }

    pub(super) fn existing_rare_data(&self) -> Option<&RareData> {
        self.rare_data.get().map(|it| &**it)
    }

    #[cold]
    fn link_coverage_counts(&self, vm: &Vm) {
        let counts = (vm.hooks().cover)(vm, &self.executable(), crate::anchor!(self).code());
        let counts = self.rare_data().coverage_counts.get_or_init(|| counts);
        let (code, entries) = (self.body().instructions(), self.entries());
        for (_, instruction) in Instructions::new(code, 0..code.len() as u32) {
            if let (Opcode::Cover, &[block]) = (instruction.opcode, instruction.words()) {
                let count = &counts[block as usize];
                let entry: &metadata::Cover =
                    entries.get([MetadataKind::Coverage], instruction.metadata);
                // SAFETY: the count goes no sooner than the metadata.
                unsafe { entry.link(count) };
            }
        }
    }

    /// They end where the constants begin. The first is that of `this`.
    pub fn argument_profiles(&self) -> &[ValueProfile] {
        let count = self.parameters as usize;
        // SAFETY: allocated with that many.
        unsafe { core::slice::from_raw_parts(self.constants.sub(count).cast(), count) }
    }

    /// The offset of the instruction that the call site of a frame stands for, unless its code is optimized.
    #[inline(always)]
    pub fn bytecode_offset_of(&self, call_site: u32) -> u32 {
        call_site.wrapping_sub(self.instructions.addr() as u32)
    }

    /// The low bits of the address of the instruction.
    #[inline(always)]
    pub fn call_site_of(&self, bytecode_offset: u32) -> u32 {
        bytecode_offset.wrapping_add(self.instructions.addr() as u32)
    }

    /// All words from the constants on. None for optimized code.
    fn fields(&self) -> &[Field<Option<Value>>] {
        if self.alternative.is_some() {
            return &[];
        }
        let count = self.first_scope as usize + self.code().scopes.len();
        // SAFETY: each is zero or a value.
        unsafe { core::slice::from_raw_parts(self.constants.cast(), count) }
    }

    #[inline(always)]
    pub fn code(&self) -> &Rc<Code> {
        &self.bytecode.code
    }

    #[inline(always)]
    pub fn body(&self) -> &Body {
        &self.code().body
    }

    #[inline(always)]
    pub fn instructions_ptr(&self) -> *const u8 {
        self.instructions
    }

    /// Not of optimized code.
    #[inline(always)]
    pub(super) fn metadata_ptr(&self) -> *mut u64 {
        debug_assert!(!self.is_optimized());
        core::ptr::with_exposed_provenance_mut(self.address() + Self::OFFSET_OF_METADATA)
    }

    #[inline(always)]
    pub fn constants_ptr(&self) -> *const u64 {
        self.constants
    }

    #[inline(always)]
    pub fn locals(&self) -> u32 {
        self.locals
    }

    /// One for each register that it saves when it suspends.
    #[inline(always)]
    pub fn saved_words(&self) -> u32 {
        self.saved_words
    }

    /// # Safety
    /// The code has that point.
    #[inline(always)]
    pub unsafe fn suspend_point_unchecked(&self, point: SuspendPointIndex) -> &SuspendPoint {
        debug_assert!(point.index() < self.body().suspend_points().len());
        // SAFETY: the caller's. The body is kept alive.
        unsafe { &*self.suspend_points.add(point.index()) }
    }

    /// # Safety
    /// As above.
    #[inline(always)]
    pub unsafe fn saved_registers_unchecked(&self, point: SuspendPointIndex) -> &[SavedRegister] {
        // SAFETY: as above, and the range has been verified.
        unsafe {
            let range = self.suspend_point_unchecked(point).registers();
            self.body().all_saved_registers().get_unchecked(range)
        }
    }

    /// With `this`.
    #[inline(always)]
    pub fn parameters(&self) -> u32 {
        self.parameters
    }

    #[inline(always)]
    pub fn global(&self) -> Gc<GlobalObject> {
        self.global
    }

    #[inline(always)]
    pub fn executable(&self) -> Gc<ScriptExecutable> {
        self.owner()
    }

    pub fn specialization(&self) -> Specialization {
        match self.body().kind() {
            CodeKind::Construct => Specialization::Construct,
            _ => Specialization::Call,
        }
    }

    /// The one that has the profiles and that the interpreter can run.
    #[inline(always)]
    pub fn baseline(&self) -> Gc<CodeBlock> {
        self.alternative.unwrap_or_else(|| self.into())
    }

    #[inline(always)]
    pub fn tier(&self) -> Tier {
        self.tier.get()
    }

    #[inline(always)]
    pub fn is_optimized(&self) -> bool {
        self.alternative.is_some()
    }

    #[inline(always)]
    pub fn debugger_requests(&self) -> &Cell<u32> {
        &self.debugger_requests
    }

    pub fn surprise_counter(&self) -> &Cell<i32> {
        &self.surprise_counter
    }

    #[inline(always)]
    pub fn identifier(&self, index: IdentifierIndex) -> PropertyName<'_> {
        self.code().identifiers[index.index()].name()
    }

    /// # Safety
    /// The word is there, and has such a cell or none.
    #[inline(always)]
    unsafe fn slot<T>(&self, first: u32, index: usize) -> &Field<Option<Gc<T>>> {
        // SAFETY: the caller's.
        unsafe { &*self.constants.add(first as usize + index).cast() }
    }

    /// # Safety
    /// There is such a function.
    #[inline(always)]
    pub unsafe fn function_if_created(
        &self,
        index: FunctionIndex,
    ) -> Option<Gc<FunctionExecutable>> {
        // SAFETY: the caller's, and only executables are stored there.
        unsafe { self.slot(self.first_function, index.index()).get() }
    }

    /// # Safety
    /// There is such a scope.
    #[inline(always)]
    pub unsafe fn scope_template_if_created(&self, index: ScopeIndex) -> Option<Gc<ScopeTemplate>> {
        // SAFETY: the caller's, and only templates are stored there.
        unsafe { self.slot(self.first_scope, index.index()).get() }
    }

    #[inline(always)]
    pub fn function(&self, vm: &Vm, index: FunctionIndex) -> Gc<FunctionExecutable> {
        assert!(index.index() < self.code().functions.len());
        // SAFETY: just checked.
        unsafe { self.function_if_created(index) }.unwrap_or_else(|| {
            let info = FunctionRef::new(Rc::clone(&self.code().functions), index.0);
            let executable = FunctionExecutable::create_inside(vm, &self.executable(), info);
            // SAFETY: as above, and the baseline traces it.
            unsafe {
                (self.slot(self.first_function, index.index()))
                    .set(&self.baseline(), Some(executable));
            }
            executable
        })
    }

    #[inline(always)]
    pub fn scope_template(&self, vm: &Vm, index: ScopeIndex) -> Gc<ScopeTemplate> {
        assert!(index.index() < self.code().scopes.len());
        // SAFETY: just checked.
        unsafe { self.scope_template_if_created(index) }.unwrap_or_else(|| {
            let template = ScopeTemplate::create(vm, Rc::clone(&self.code().scopes[index.index()]));
            if self.has_debug_hooks() {
                template.set_owner(Some(self.executable()));
            }
            // SAFETY: as above.
            unsafe {
                (self.slot(self.first_scope, index.index())).set(&self.baseline(), Some(template));
            }
            template
        })
    }

    /// In the text of `source_provider`.
    pub fn position(&self, bytecode_offset: u32) -> Position {
        let length = self.source_provider().text().len();
        let found = (self.body().positions().find(bytecode_offset))
            .filter(|it| it.start <= it.end && it.end.max(it.divot) as usize <= length);
        found.unwrap_or_else(|| {
            let function = self.executable().downcast::<FunctionExecutable>();
            let start = function.map_or(0, |function| function.parameters_start());
            Position {
                divot: start,
                start,
                end: start,
            }
        })
    }

    pub fn source_provider(&self) -> SourceProviderRef {
        self.executable().code_provider()
    }

    fn visit_children(&self, visitor: &mut Visitor) {
        if visitor.puts_off_current_cell() {
            return;
        }
        crate::Trace::trace(self.fields(), visitor);
        visitor.report_extra_memory(self.extra_memory.get() as usize);
        if !self.is_optimized() {
            metadata::visit(self, visitor);
        }
        // SAFETY: no script is running.
        if let Some(compiled) = unsafe { self.borrow_compiled() } {
            compiled.visit(self, visitor);
        }
        visitor.reconcile_current_cell_later();
    }

    fn visit_output_constraints(&self, visitor: &mut Visitor) {
        if !self.is_optimized() {
            return metadata::visit_transitions(self, visitor);
        }
        // SAFETY: as above.
        if let Some(compiled) = unsafe { self.borrow_compiled() } {
            compiled.visit_output_constraints(visitor);
        }
    }

    /// For optimized code that has written to them.
    pub fn reconcile_profiles(&self, survivors: &Survivors) {
        metadata::reconcile_weak_references(self, survivors);
    }

    fn reconcile_weak_references(&self, survivors: &Survivors) {
        if !self.is_optimized() {
            metadata::reconcile_weak_references(self, survivors);
        }
        if let Some(compiled) = self.compiled() {
            compiled.reconcile_weak_references(self, survivors);
        }
    }

    fn estimated_size(&self, _: &Vm) -> usize {
        self.cell_size() + self.compiled().map_or(0, |compiled| compiled.size())
    }
}
