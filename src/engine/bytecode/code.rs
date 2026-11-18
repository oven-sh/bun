//! Generated code, before a realm links it.

use core::any::Any;
use core::cell::{Cell, RefCell};
use core::num::NonZeroU32;
use core::ops::Range;
use std::rc::Rc;

use bun_engine_syntax::EvalContext;
use bun_engine_text::{Atom, Identifier, StringRef};

use crate::cache::Payload;
use crate::constant::Constant;
use crate::function::FunctionInfo;
use crate::metadata::MetadataLayout;
use crate::operand::{ImportPhase, Register, SpreadMaskIndex, SuspendKind, SuspendPointIndex};
use crate::positions::Positions;
use crate::scope::StaticScope;

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
#[repr(u8)]
pub enum CodeKind {
    Script,
    Module,
    Eval,
    Call,
    Construct,
}

bitflags::bitflags! {
    #[derive(Clone, Copy, PartialEq, Eq, Debug, Default)]
    pub struct CodeFlags: u8 {
        const STRICT = 1 << 0;
        const BUILTIN = 1 << 1;
        /// Has `resume_dispatch`.
        const SUSPENDS = 1 << 2;
        const HAS_TAIL_CALLS = 1 << 3;
        const HAS_DEBUG_HOOKS = 1 << 4;
        const HAS_COVERAGE = 1 << 5;
    }
}

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
#[repr(u8)]
pub enum HandlerKind {
    Catch,
    Finally,
    /// Not in the source. Turns the exception into something else, such as a rejection.
    SynthesizedCatch,
    /// Not in the source. Cleans up and throws again.
    SynthesizedFinally,
}

#[derive(Clone, PartialEq, Eq, Debug)]
pub struct Handler {
    pub range: Range<u32>,
    pub target: u32,
    pub kind: HandlerKind,
}

/// The targets are offsets from the start of the code.
#[derive(Clone, PartialEq, Eq, Debug)]
pub struct IntSwitch {
    pub default: u32,
    pub cases: IntCases,
}

#[derive(Clone, PartialEq, Eq, Debug)]
pub enum IntCases {
    Dense {
        first: i32,
        targets: Box<[u32]>,
    },
    /// Sorted by key.
    Sparse(Box<[(i32, u32)]>),
}

impl IntSwitch {
    pub fn target(&self, key: i32) -> u32 {
        let target = match &self.cases {
            IntCases::Dense { first, targets } => {
                targets.get(key.wrapping_sub(*first) as u32 as usize)
            }
            IntCases::Sparse(cases) => cases
                .binary_search_by_key(&key, |&(key, _)| key)
                .ok()
                .map(|index| &cases[index].1),
        };
        target.copied().unwrap_or(self.default)
    }
}

/// The keys are in `Code::string_switches`, in the same order. The first of equal keys counts.
#[derive(Clone, PartialEq, Eq, Debug)]
pub struct StringSwitch {
    pub default: u32,
    pub targets: Box<[u32]>,
}

#[derive(Clone, PartialEq, Eq, Debug)]
pub struct SuspendPoint {
    /// Of the instruction that suspends.
    pub suspend: u32,
    /// Of the `resume` after it.
    pub resume: u32,
    pub kind: SuspendKind,
    pub(crate) registers: Range<u32>,
}

impl SuspendPoint {
    /// In [`Body::all_saved_registers`].
    #[inline(always)]
    pub fn registers(&self) -> Range<usize> {
        self.registers.start as usize..self.registers.end as usize
    }
}

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub struct SavedRegister {
    pub register: Register,
    /// The same at all points, so what has been saved once stays alive. Below [`Body::saved_words`].
    pub word: u32,
}

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
#[repr(u8)]
pub enum CoverageKind {
    Plain,
    /// The condition, the increment or the left side.
    LoopHeader,
    /// Of a function that suspends, which a call may never get to.
    SuspendableBody,
}

/// A range of the source whose executions are counted.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub struct CoverageBlock {
    pub start: i32,
    /// Zero for the block that the code begins with, which is all that no other block or function takes.
    pub end: i32,
    pub kind: CoverageKind,
}

#[derive(Clone, PartialEq, Eq, Debug, Default)]
pub(crate) struct Tables {
    pub(crate) handlers: Box<[Handler]>,
    pub(crate) int_switches: Box<[IntSwitch]>,
    pub(crate) string_switches: Box<[StringSwitch]>,
    pub(crate) spread_masks: Box<[Box<[u32]>]>,
    pub(crate) suspend_points: Box<[SuspendPoint]>,
    pub(crate) saved_registers: Box<[SavedRegister]>,
    pub(crate) saved_words: u32,
    pub(crate) coverage_blocks: Box<[CoverageBlock]>,
    /// From each offset on, where the innermost scope is. Only code with debug hooks has them.
    pub(crate) scope_registers: Box<[(u32, Register)]>,
}

impl Tables {
    pub(crate) fn set_saved_registers(&mut self, registers: &[Register]) {
        let mut distinct = registers.to_vec();
        distinct.sort_unstable_by(|a, b| b.cmp(a));
        distinct.dedup();
        let saved = registers.iter().map(|&register| SavedRegister {
            register,
            word: distinct.partition_point(|&it| it > register) as u32,
        });
        self.saved_registers = saved.collect();
        self.saved_words = distinct.len() as u32;
    }
}

#[derive(Clone)]
pub(crate) enum Storage {
    /// The layout of the metadata, the instructions and the positions.
    Owned(Box<[u8]>),
    Borrowed(Payload),
}

/// The part of code that any thread may read.
pub struct Body {
    pub(crate) storage: Storage,
    pub(crate) tables: Option<Box<Tables>>,
    /// Of the instructions, which the layout of the metadata comes right before.
    pub(crate) start: u32,
    pub(crate) instructions_size: u32,
    /// In a payload, or zero.
    pub(crate) positions_at: u32,
    pub(crate) locals: u32,
    pub(crate) parameters: u32,
    pub(crate) kind: CodeKind,
    pub(crate) flags: CodeFlags,
    pub(crate) layout_size: u8,
}

/// Over a limit of the format, or over the memory that there is.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub struct TooLarge;

macro_rules! table_getters {
    ($($(#[$doc:meta])* $name:ident: $element:ty,)*) => {$(
        $(#[$doc])*
        pub fn $name(&self) -> &[$element] {
            self.tables.as_ref().map_or(&[], |tables| &tables.$name)
        }
    )*};
}

impl Body {
    pub const MAX_SIZE: u32 = i32::MAX as u32;
    /// The most locals and the most parameters: the distance in bytes to any slot fits in 31 bits.
    pub const MAX_FRAME_WORDS: u32 = 1 << 27;

    #[inline]
    fn bytes(&self) -> &[u8] {
        match &self.storage {
            Storage::Owned(bytes) => bytes,
            Storage::Borrowed(payload) => payload.bytes(),
        }
    }

    fn owned_size(&self) -> usize {
        match &self.storage {
            Storage::Owned(bytes) => bytes.len(),
            Storage::Borrowed(_) => 0,
        }
    }

    /// They stay where they are.
    #[inline]
    pub fn instructions(&self) -> &[u8] {
        &self.padded_instructions()[..self.instructions_size as usize]
    }

    /// With what follows them, so that the last can be read as quickly as the others.
    #[inline]
    pub fn padded_instructions(&self) -> &[u8] {
        &self.bytes()[self.start as usize..]
    }

    /// `None` if the sizes do not add up.
    pub(crate) fn layout_and_instructions(&self) -> Option<&[u8]> {
        let start = self.start.checked_sub(u32::from(self.layout_size))?;
        let end = self.start.checked_add(self.instructions_size)?;
        self.bytes().get(start as usize..end as usize)
    }

    pub(crate) fn checked_metadata(&self) -> Option<MetadataLayout<'_>> {
        MetadataLayout::read(&self.layout_and_instructions()?[..usize::from(self.layout_size)])
    }

    pub(crate) fn position_bytes(&self) -> Option<&[u8]> {
        match &self.storage {
            Storage::Owned(bytes) => {
                bytes.get(self.start.checked_add(self.instructions_size)? as usize..)
            }
            Storage::Borrowed(payload) => payload.blob(self.positions_at),
        }
    }

    /// Whether it is from a payload.
    pub fn is_stored(&self) -> bool {
        matches!(self.storage, Storage::Borrowed(_))
    }

    pub fn kind(&self) -> CodeKind {
        self.kind
    }

    pub fn flags(&self) -> CodeFlags {
        self.flags
    }

    /// The words of the frame below the frame pointer, with the frames of callees: an even number.
    pub fn locals(&self) -> u32 {
        self.locals
    }

    /// With `this`. A frame has at least as many arguments.
    pub fn parameters(&self) -> u32 {
        self.parameters
    }

    pub fn metadata(&self) -> MetadataLayout<'_> {
        self.checked_metadata().expect("verified")
    }

    /// None if they are damaged: those of a trusted payload are not looked at before.
    pub fn positions(&self) -> Positions<'_> {
        let positions = self.position_bytes().and_then(Positions::read);
        positions.unwrap_or_default()
    }

    table_getters! {
        /// The first whose range has the instruction is the one.
        handlers: Handler,
        int_switches: IntSwitch,
        string_switches: StringSwitch,
        suspend_points: SuspendPoint,
        /// Some have no instruction: nothing reaches them from here.
        coverage_blocks: CoverageBlock,
        spread_masks: Box<[u32]>,
    }

    pub fn handler_for(&self, offset: u32) -> Option<&Handler> {
        self.handlers()
            .iter()
            .find(|handler| handler.range.contains(&offset))
    }

    /// Where a frame that is at the instruction has its innermost scope. `None` if only that of the callee is known.
    pub fn scope_register_at(&self, offset: u32) -> Option<Register> {
        let registers = &self.tables.as_ref()?.scope_registers;
        let begun = registers.partition_point(|&(start, _)| start <= offset);
        let &(_, register) = registers[..begun].last()?;
        (register != Register::SCOPE).then_some(register)
    }

    pub fn is_spread(&self, mask: SpreadMaskIndex, element: u32) -> bool {
        self.spread_masks()[mask.index()]
            .get(element as usize / 32)
            .is_some_and(|word| word >> (element % 32) & 1 != 0)
    }

    /// What is saved before the code suspends there, and restored when it goes on.
    pub fn saved_registers(&self, point: SuspendPointIndex) -> &[SavedRegister] {
        &self.all_saved_registers()[self.suspend_points()[point.index()].registers()]
    }

    pub fn all_saved_registers(&self) -> &[SavedRegister] {
        (self.tables.as_ref()).map_or(&[], |tables| &tables.saved_registers)
    }

    /// One for each register that any point saves.
    pub fn saved_words(&self) -> u32 {
        (self.tables.as_ref()).map_or(0, |tables| tables.saved_words)
    }
}

/// What a compiler has made of code that serves all realms.
#[derive(Default)]
pub struct SharedMachineCode {
    compiled: RefCell<Option<Rc<dyn Any + Send>>>,
    /// The weighted executions in the interpreter, as far as the code blocks have added them up.
    pub warm_up: Cell<u32>,
    /// On a clock of the host. `None` if the code has not been linked.
    pub last_use: Cell<Option<NonZeroU32>>,
}

impl SharedMachineCode {
    #[inline]
    pub fn exists(&self) -> bool {
        self.compiled.borrow().is_some()
    }

    pub fn get<T: Any>(&self) -> Option<Rc<T>> {
        let compiled: Rc<dyn Any> = self.compiled.borrow().clone()?;
        compiled.downcast().ok()
    }

    pub fn set(&self, compiled: Rc<dyn Any + Send>) {
        self.compiled.replace(Some(compiled));
    }

    pub fn is_at(&self, address: usize) -> bool {
        (self.compiled.borrow().as_ref()).is_some_and(|it| Rc::as_ptr(it).addr() == address)
    }

    pub fn release_unless_held_by_more_than(&self, others: usize) {
        (self.compiled.borrow_mut()).take_if(|code| Rc::strong_count(code) <= 1 + others);
    }
}

pub struct Code {
    pub body: Body,
    pub identifiers: Box<[Identifier]>,
    pub constants: Box<[Constant]>,
    pub functions: Rc<[FunctionInfo]>,
    pub scopes: Box<[Rc<StaticScope>]>,
    pub name_lists: Box<[Box<[Identifier]>]>,
    pub string_switches: Box<[Box<[Atom]>]>,
    pub machine_code: SharedMachineCode,
}

impl Code {
    /// Of the functions that go with it.
    fn take_inner_code(&self, out: &mut Vec<Rc<Code>>) {
        if Rc::strong_count(&self.functions) == 1 {
            let codes = self.functions.iter().flat_map(|it| &it.code.at_hand);
            out.extend(codes.filter_map(Cell::take));
        }
    }

    /// Roughly, and without the code of the functions in it.
    pub fn memory_size(&self) -> usize {
        size_of::<Code>()
            + self.body.owned_size()
            + size_of_val(&*self.identifiers)
            + size_of_val(&*self.constants)
            + size_of_val(&*self.functions)
            + self.scopes.len() * size_of::<StaticScope>()
    }
}

/// Functions nest as deep as the stack of the parser went.
impl Drop for Code {
    fn drop(&mut self) {
        let mut pending = vec![];
        self.take_inner_code(&mut pending);
        while let Some(code) = pending.pop() {
            if Rc::strong_count(&code) == 1 {
                code.take_inner_code(&mut pending);
            }
        }
    }
}

/// What has to be declared around a script, or around `eval` code that is not strict, before it runs.
#[derive(Default)]
pub struct Declarations {
    pub variables: Box<[Identifier]>,
    pub functions: Box<[Identifier]>,
    /// Functions in blocks, which get a variable if nothing is in the way (ECMA-262 B.3.2.2, B.3.2.3).
    pub hoisted_functions: Box<[Identifier]>,
    /// Of a script.
    pub lets: Box<[Identifier]>,
    pub constants: Box<[Identifier]>,
}

#[derive(Default)]
pub struct Directives {
    pub source_url: Option<StringRef>,
    pub source_mapping_url: Option<StringRef>,
}

pub struct Script {
    /// Is entered with an instance of `outer` as the scope of its callee.
    pub code: Rc<Code>,
    pub outer: Option<Rc<StaticScope>>,
    pub declarations: Declarations,
    pub directives: Directives,
}

pub struct Eval {
    /// As for a script.
    pub code: Rc<Code>,
    pub outer: Option<Rc<StaticScope>>,
    pub declarations: Declarations,
    pub directives: Directives,
    /// Not if it has a tagged template, whose object is new for each evaluation of the text.
    pub is_reusable: bool,
    pub context: EvalContext,
}

pub struct ModuleRequest {
    pub specifier: Atom,
    pub attributes: Box<[(Atom, Atom)]>,
    pub phase: ImportPhase,
}

/// `request` is an index into [`Module::requests`]. A name that is none stands for the namespace.
pub struct ImportEntry {
    pub request: u32,
    pub imported: Option<Atom>,
    pub local: Atom,
    /// In the scope of the module.
    pub slot: u32,
}

pub enum ExportEntry {
    Local {
        exported: Atom,
        slot: u32,
    },
    Indirect {
        exported: Atom,
        request: u32,
        imported: Option<Atom>,
    },
    Star {
        request: u32,
    },
}

pub struct Module {
    /// Is entered with an instance of `scope` as the scope of its callee. If it suspends it returns a promise.
    pub code: Rc<Code>,
    pub scope: Rc<StaticScope>,
    /// One for each declaration that names a module, in the order of the source.
    pub requests: Box<[ModuleRequest]>,
    pub imports: Box<[ImportEntry]>,
    pub exports: Box<[ExportEntry]>,
    /// False if the three tables were left out.
    pub has_interface: bool,
    pub directives: Directives,
}
