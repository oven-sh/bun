//! Turns a syntax tree into instructions.

mod call;
mod class;
mod control;
mod expression;
mod function;
mod intrinsic;
mod iteration;
mod literal;
mod operator;
mod pattern;
mod reference;
mod root;
mod scope;
mod statement;

use std::rc::Rc;

use bun_engine_number::exact_int32;
use bun_engine_syntax::ast::{self, Ast, ExprId, ExprKind, TreeId};
use bun_engine_syntax::{EvalContext, FunctionFlags, FunctionKind, Name, NameKind};
use bun_engine_text::{
    Atom, Identifier, PropertyName, StringRef, Text, find_private_name, find_well_known_symbol,
    parse_array_index,
};
use hashbrown::HashTable;
use smallvec::SmallVec;

use crate::assembler::{Assembler, Label, Site};
use crate::code::{CodeFlags, CodeKind, CoverageBlock, CoverageKind};
use crate::constant::{Constant, LinkTimeConstant};
use crate::function::{FunctionInfo, FunctionRef, Origin, Visibility};
use crate::host::Host;
use crate::operand::{DebugHook, FunctionIndex, IdentifierIndex, Operand, Register, StaticError};
use crate::scope::StaticScope;

pub(crate) use root::{Environment, Failure};

use control::{Cleanup, DeferredHandler, Targets, UsingScope};
use function::Input;
use iteration::ForIn;
use scope::{Bound, OpenScope, Outer};

/// Where the value of an expression is wanted.
#[derive(Clone, Copy, PartialEq, Eq)]
enum Dest {
    Any,
    Ignore,
    /// Anywhere, but here if it takes a register.
    Prefer(Register),
    /// In a register that nothing reads until the expression is done.
    Temp(Register),
    /// In a variable, which keeps its value until the last step.
    Local(Register),
}

#[derive(Clone, Copy, PartialEq, Eq)]
enum Tail {
    No,
    Yes,
}

/// Indices plus one, or zero.
#[derive(Clone, Copy, Default)]
struct NameState {
    /// The rest is left over from other code unless this is `Buffers::epoch`.
    epoch: u32,
    binding: u32,
    outer: u32,
    identifier: u32,
    string: u32,
    /// Of a label, an index into `labels`. Before the body, what the prologue has noted.
    mark: u32,
}

/// An object whose capacity goes by the properties that the code gives it later.
struct Allocation {
    register: Register,
    site: Site,
    operand: usize,
    count: u32,
    names: SmallVec<[IdentifierIndex; 8]>,
}

#[derive(Clone, Copy, PartialEq, Eq)]
enum This {
    Register(Register),
    Undefined,
    /// Of a derived constructor, until `super()` has returned.
    Unbound(Register),
    /// The same, where a closure may be the one to call `super()`: the scope has the value.
    UnboundInScope(Register),
}

#[derive(Clone, Copy, PartialEq, Eq)]
enum Suspension {
    None,
    Generator,
    AsyncFunction,
    AsyncGenerator,
}

#[derive(Default)]
pub(crate) struct Buffers {
    asm: Assembler,
    names: Vec<NameState>,
    epoch: u32,
    bindings: Vec<Bound>,
    outers: Vec<Outer>,
    open_scopes: Vec<OpenScope>,
    labels: Vec<Targets>,
    cleanups: Vec<Cleanup>,
    usings: Vec<UsingScope>,
    deferred_handlers: Vec<DeferredHandler>,
    for_ins: Vec<ForIn>,
    optional_chains: Vec<(Label, u32)>,
    /// Operators that wait for their first operand.
    spine: Vec<ExprId>,
    allocations: Vec<Allocation>,
    /// The bindings that are saved for as long as they are in scope, each with its register.
    kept_bindings: Vec<(u32, Register)>,
    /// What the caller has passed to code that suspends. It is saved until the end.
    kept_inputs: Vec<Input>,
    identifiers: Vec<Identifier>,
    constants: Vec<Constant>,
    constant_table: HashTable<(u64, u32)>,
    functions: Vec<FunctionInfo>,
    no_functions: Rc<[FunctionInfo]>,
    /// Those of `functions` that come with a tree.
    trees: Vec<(FunctionIndex, TreeId)>,
    /// The same, of code that is finished.
    waiting: Vec<(FunctionRef, TreeId)>,
    scopes: Vec<Rc<StaticScope>>,
    name_lists: Vec<Box<[Identifier]>>,
    string_switches: Vec<Box<[Atom]>>,
}

struct Generator<'a> {
    ast: &'a Ast,
    /// Of the code that is being generated.
    tree: &'a ast::Tree,
    source: &'a StringRef,
    text: Text<'a>,
    host: &'a dyn Host,
    b: &'a mut Buffers,
    stack_limit: usize,
    failure: Option<Failure>,

    kind: CodeKind,
    function_kind: FunctionKind,
    function_flags: FunctionFlags,
    function: Option<&'a FunctionInfo>,
    flags: CodeFlags,
    origin: Origin,
    visibility: Visibility,
    context: EvalContext,
    suspension: Suspension,
    is_strict: bool,
    debugs: bool,
    covers: bool,

    /// The index of the first free local.
    top: u32,
    locals: u32,
    parameters: u32,

    this: This,
    /// None for undefined.
    new_target: Option<Register>,
    /// Of code that suspends.
    generator: Option<Register>,
    arguments: function::Arguments,
    /// The rest parameter, as long as it may be empty.
    lazy_rest: Option<function::Lazy>,

    /// The scopes around the code.
    outer: Option<Rc<StaticScope>>,
    /// How many parents up from local 0 the first of them is.
    outer_depth: u32,
    created_at: u32,
    /// The innermost scope that exists at run time.
    chain: Option<Rc<StaticScope>>,
    scope: Register,
    /// The bindings below this index are behind a `with` or a scope that `eval` may extend.
    barrier: Option<u32>,
    /// The position that closures count as created at, where it is not their own.
    closure_position: Option<u32>,

    /// How many expressions are open.
    depth: u32,
    /// An operand that has been evaluated ahead of its operator.
    evaluated: Option<(ExprId, Register)>,
    targets: Targets,
    /// The labels from this one on stand before the next loop, if any are those of a loop.
    first_label_of_loop: usize,
    /// The number of the last jump through the `cleanups` that are open.
    last_jump: i32,
    /// Returns what is in the register at `body_top`.
    epilogue: Option<Label>,
    /// `top` where the body starts.
    body_top: u32,
    /// How many of the constructs that have work left after their body are open.
    tail_blockers: u32,
    /// The handlers that are there for the sake of the function as a whole.
    base_try_depth: u32,
    suspensions: u32,
    statements_end: u32,
    is_in_case_test: bool,
    last_hook: Option<(DebugHook, u32)>,
}

const EMPTY_KEY: u64 = 0;
const NULL_KEY: u64 = 1;
const UNDEFINED_KEY: u64 = 2;
const FALSE_KEY: u64 = 3;
const TRUE_KEY: u64 = 4;
const INT32_KEY: u64 = 1 << 32;
const LINK_TIME_KEY: u64 = 2 << 32;
/// Keeps the bits of every double, with one NaN, clear of the keys above.
const DOUBLE_KEY_OFFSET: u64 = 1 << 49;

const LONGEST_ATOM: usize = 64;
/// A literal that shares the characters of the source keeps all of it alive.
const SHORTEST_SHARED_STRING: usize = 1024;
const MOST_LOCALS: u32 = 1 << 24;
const MOST_TRACKED_ALLOCATIONS: usize = 8;
const MOST_CAPACITY: u32 = 255;

impl<'a> Generator<'a> {
    #[inline(always)]
    fn asm(&mut self) -> &mut Assembler {
        &mut self.b.asm
    }

    /// False, and the generation has failed, if the stack is about to run out.
    #[inline(always)]
    fn can_recurse(&mut self) -> bool {
        let marker = 0u8;
        if (&raw const marker).addr() >= self.stack_limit {
            return true;
        }
        self.fail(Failure::TooLarge);
        false
    }

    #[cold]
    fn fail(&mut self, failure: Failure) {
        self.failure.get_or_insert(failure);
    }

    // Registers

    #[inline]
    fn temp(&mut self) -> Register {
        self.temps(1)
    }

    /// The first of a run.
    #[inline]
    fn temps(&mut self, count: u32) -> Register {
        let first = Register::local(self.top);
        self.set_top(self.top.saturating_add(count));
        first
    }

    #[inline]
    fn set_top(&mut self, top: u32) {
        self.top = top;
        if top > self.locals {
            self.locals = top;
            if top > MOST_LOCALS {
                (self.top, self.locals) = (MOST_LOCALS, MOST_LOCALS);
                self.fail(Failure::TooLarge);
            }
        }
    }

    /// For what the last instruction of an expression writes.
    #[inline]
    fn final_dst(&mut self, dst: Dest) -> Register {
        match dst {
            Dest::Prefer(register) | Dest::Temp(register) | Dest::Local(register) => register,
            Dest::Any | Dest::Ignore => self.temp(),
        }
    }

    /// For what is written before that.
    #[inline]
    fn temp_dst(&mut self, dst: Dest) -> Register {
        match dst {
            Dest::Prefer(register) | Dest::Temp(register) => register,
            Dest::Any | Dest::Ignore | Dest::Local(_) => self.temp(),
        }
    }

    #[inline]
    fn deliver(&mut self, dst: Dest, value: impl Into<Operand>) -> Operand {
        let value = value.into();
        match dst {
            Dest::Temp(register) | Dest::Local(register) => {
                self.mov(register, value);
                register.into()
            }
            Dest::Any | Dest::Ignore | Dest::Prefer(_) => value,
        }
    }

    #[inline]
    fn mov(&mut self, dst: Register, src: impl Into<Operand>) {
        let src = src.into();
        if src != dst {
            self.asm().mov(dst, src);
        }
    }

    fn in_register(&mut self, value: Operand) -> Register {
        value.as_register().unwrap_or_else(|| {
            let register = self.temp();
            self.asm().mov(register, value);
            register
        })
    }

    // Names

    #[inline]
    fn text_of(&self, name: Name) -> Text<'a> {
        self.ast.names.text(name, self.text)
    }

    #[inline]
    fn name_length(&self, name: Name) -> u32 {
        self.ast.names.length(name)
    }

    #[inline(always)]
    fn state(&mut self, name: Name) -> &mut NameState {
        let (state, epoch) = (&mut self.b.names[name.index()], self.b.epoch);
        if state.epoch != epoch {
            *state = NameState {
                epoch,
                ..NameState::default()
            };
        }
        state
    }

    fn atom(&self, name: Name) -> Atom {
        Atom::new(self.text_of(name))
    }

    fn make_identifier(&mut self, name: Name) -> Identifier {
        let text = self.text_of(name);
        let symbol = match self.ast.names.kind(name) {
            NameKind::Ordinary => return Identifier::new(text),
            NameKind::Private => find_private_name(text, text.hash())
                .map(PropertyName::to_identifier)
                .or_else(|| self.host.private_name(text)),
            NameKind::WellKnownSymbol => {
                find_well_known_symbol(text).map(PropertyName::to_identifier)
            }
        };
        symbol.unwrap_or_else(|| {
            self.fail(Failure::UnknownBuiltinName(StringRef::from_text(text)));
            Identifier::new(text)
        })
    }

    #[inline]
    fn identifier(&mut self, name: Name) -> IdentifierIndex {
        match self.state(name).identifier {
            0 => self.add_identifier(name),
            link => IdentifierIndex(link - 1),
        }
    }

    fn add_identifier(&mut self, name: Name) -> IdentifierIndex {
        let identifier = self.make_identifier(name);
        self.b.identifiers.push(identifier);
        let link = self.b.identifiers.len() as u32;
        self.state(name).identifier = link;
        IdentifierIndex(link - 1)
    }

    /// For the few names that are in no tree.
    fn symbol_identifier(&mut self, symbol: PropertyName<'_>) -> IdentifierIndex {
        let key = symbol.address() as u64 | 1 << 48;
        IdentifierIndex(self.find_or_add(key, |generator| {
            generator.b.identifiers.push(symbol.to_identifier());
            generator.b.identifiers.len() as u32 - 1
        }))
    }

    fn array_index(&self, name: Name) -> Option<u32> {
        match self.ast.names.kind(name) {
            NameKind::Ordinary => parse_array_index(self.text_of(name)),
            _ => None,
        }
    }

    /// The name that a key in brackets amounts to.
    fn literal_key(&self, key: ExprId) -> Option<Name> {
        match self.ast[key].kind {
            ExprKind::String(name) if self.array_index(name).is_none() => Some(name),
            _ => None,
        }
    }

    // Constants

    fn find_or_add(&mut self, key: u64, add: impl FnOnce(&mut Self) -> u32) -> u32 {
        let hash = |key: u64| (key ^ key >> 32).wrapping_mul(0x9e37_79b9_7f4a_7c15);
        if let Some(&(_, index)) = self
            .b
            .constant_table
            .find(hash(key), |entry| entry.0 == key)
        {
            return index;
        }
        let index = add(self);
        self.b
            .constant_table
            .insert_unique(hash(key), (key, index), |entry| hash(entry.0));
        index
    }

    fn add_constant(&mut self, constant: Constant) -> u32 {
        self.b.constants.push(constant);
        self.b.constants.len() as u32 - 1
    }

    fn keyed_constant(&mut self, key: u64, constant: Constant) -> Operand {
        Operand::constant(self.find_or_add(key, |generator| generator.add_constant(constant)))
    }

    fn empty(&mut self) -> Operand {
        self.keyed_constant(EMPTY_KEY, Constant::Empty)
    }

    fn undefined(&mut self) -> Operand {
        self.keyed_constant(UNDEFINED_KEY, Constant::Undefined)
    }

    fn null(&mut self) -> Operand {
        self.keyed_constant(NULL_KEY, Constant::Null)
    }

    fn boolean(&mut self, value: bool) -> Operand {
        let key = if value { TRUE_KEY } else { FALSE_KEY };
        self.keyed_constant(key, Constant::Boolean(value))
    }

    fn int32(&mut self, value: i32) -> Operand {
        self.keyed_constant(INT32_KEY | u64::from(value as u32), Constant::Int32(value))
    }

    fn double(&mut self, value: f64) -> Operand {
        let value = if value.is_nan() { f64::NAN } else { value };
        let key = value.to_bits().wrapping_add(DOUBLE_KEY_OFFSET);
        self.keyed_constant(key, Constant::Double(value))
    }

    fn number(&mut self, value: f64) -> Operand {
        match exact_int32(value) {
            Some(value) => self.int32(value),
            None => self.double(value),
        }
    }

    fn link_time(&mut self, constant: LinkTimeConstant) -> Operand {
        let key = LINK_TIME_KEY | u64::from(constant.0);
        self.keyed_constant(key, Constant::LinkTime(constant))
    }

    fn string_constant(&self, name: Name) -> Constant {
        let text = self.text_of(name);
        if text.len() <= LONGEST_ATOM {
            return Constant::String(Atom::new(text));
        }
        Constant::LongString(match self.ast.names.source_start(name) {
            Some(start) if text.is_latin1() && text.len() >= SHORTEST_SHARED_STRING => {
                StringRef::substring(self.source, start as usize..start as usize + text.len())
            }
            _ => StringRef::try_narrowed(text).unwrap_or_else(|_| StringRef::from_text(text)),
        })
    }

    fn string(&mut self, name: Name) -> Operand {
        if self.state(name).string == 0 {
            let constant = self.string_constant(name);
            self.state(name).string = self.add_constant(constant) + 1;
        }
        Operand::constant(self.state(name).string - 1)
    }

    /// The value that names a property.
    fn key_constant(&mut self, name: Name) -> Operand {
        match self.array_index(name) {
            Some(index) => self.number(f64::from(index)),
            None => self.string(name),
        }
    }

    fn constant_of(&self, value: Operand) -> Option<&Constant> {
        value
            .as_constant()
            .map(|index| &self.b.constants[index as usize])
    }

    /// Whether only these very bits are strictly equal to it.
    fn has_identity(&self, value: Operand) -> bool {
        matches!(
            self.constant_of(value),
            Some(Constant::Undefined | Constant::Null | Constant::Boolean(_))
        )
    }

    // Positions and errors

    #[inline]
    fn position(&mut self, divot: u32, start: u32, end: u32) {
        self.asm().position(divot, start, end);
    }

    #[inline]
    fn position_at(&mut self, at: u32) {
        self.position(at, at, at);
    }

    #[inline]
    fn position_of_name(&mut self, name: Name, start: u32) {
        let is_written = name != Name::DEFAULT_EXPORT;
        let end = start
            + if is_written {
                self.name_length(name)
            } else {
                0
            };
        self.position(end, start, end);
    }

    fn throw_static(&mut self, error: StaticError) {
        let name = self.identifier(Name::EMPTY);
        self.asm().throw_static(error, name);
    }

    fn throw_if_nullish(&mut self, value: Operand, error: StaticError, name: Name) {
        let name = self.identifier(name);
        self.asm().throw_if_nullish(value, error, name);
    }

    // Tools

    #[inline]
    fn debug_hook(&mut self, hook: DebugHook, position: u32) {
        if self.debugs {
            self.emit_debug_hook(hook, position);
        }
    }

    #[cold]
    fn emit_debug_hook(&mut self, hook: DebugHook, position: u32) {
        if self.last_hook.replace((hook, position)) == Some((hook, position)) {
            return;
        }
        self.position_at(position);
        self.asm().debug(hook);
    }

    /// For what does not always run. The block that it is in goes on after it.
    #[inline]
    fn cover(&mut self, start: u32, end: u32) {
        if self.covers {
            self.emit_cover(start as i32, end as i32, CoverageKind::Plain);
        }
    }

    /// One character early: the block of an arrow function starts at its expression, and two blocks with the same
    /// range share a counter.
    #[inline]
    fn cover_expression(&mut self, expression: ExprId, end: u32) {
        if self.covers {
            let start = self.ast[expression].start as i32 - 1;
            self.emit_cover(start, end as i32, CoverageKind::Plain);
        }
    }

    /// The text of the test of a `case` belongs to the block of its clause.
    #[inline]
    fn cover_skippable(&mut self, expression: ExprId, end: u32) {
        if !self.is_in_case_test {
            self.cover_expression(expression, end);
        }
    }

    #[inline]
    fn cover_loop_header(&mut self, expression: Option<ExprId>) {
        if self.covers
            && let Some(expression) = expression
        {
            let node = &self.ast[expression];
            let (start, end) = (node.start as i32 - 1, node.end as i32);
            self.emit_cover(start, end, CoverageKind::LoopHeader);
        }
    }

    #[cold]
    fn emit_cover(&mut self, start: i32, end: i32, kind: CoverageKind) {
        let block = (self.asm()).add_coverage_block(CoverageBlock { start, end, kind });
        self.asm().cover(block);
    }

    /// One that other code counts.
    #[cold]
    fn declare_coverage_block(&mut self, start: u32, end: u32) {
        self.asm().add_coverage_block(CoverageBlock {
            start: start as i32,
            end: end as i32,
            kind: CoverageKind::Plain,
        });
    }

    // Capacity of objects

    fn track_allocation(&mut self, register: Register, site: Site, operand: usize, count: u32) {
        self.untrack_allocation(register);
        if self.b.allocations.len() == MOST_TRACKED_ALLOCATIONS {
            let oldest = usize::from(self.b.allocations[0].register == Register::THIS);
            let register = self.b.allocations[oldest].register;
            self.untrack_allocation(register);
        }
        self.b.allocations.push(Allocation {
            register,
            site,
            operand,
            count,
            names: SmallVec::new(),
        });
    }

    #[inline]
    fn untrack_allocation(&mut self, register: Register) {
        let allocations = &mut self.b.allocations;
        if let Some(index) = allocations.iter().position(|it| it.register == register) {
            let allocation = allocations.remove(index);
            self.patch_capacity(&allocation);
        }
    }

    fn patch_capacity(&mut self, allocation: &Allocation) {
        let capacity = allocation.count + allocation.names.len() as u32;
        self.asm().set_operand(
            allocation.site,
            allocation.operand,
            capacity.min(MOST_CAPACITY),
        );
    }

    #[inline]
    fn note_property(&mut self, base: Operand, name: IdentifierIndex) {
        if let Some(allocation) = self.b.allocations.iter_mut().find(|it| base == it.register)
            && allocation.names.len() < MOST_CAPACITY as usize
            && !allocation.names.contains(&name)
        {
            allocation.names.push(name);
        }
    }
}
