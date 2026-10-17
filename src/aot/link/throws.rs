use super::nullish::{strip_casts, functions_called, targets_of};
use crate::declared::{Declared, DeclaredTable, Part, prim};
use crate::id::{FuncId, LayoutId, StrId, TyId, V};
use crate::ir::{BinOp, Def, Func, FuncKind, Initialization, LayoutKind, MethodKind, NO_VARIABLE, Op, Operation, Prediction, Program, Target, Term, UnOp, CoerceReason, class_flags, field_flags, func_flags, method_flags};
use bun_sema::check::{is_engine_global, is_typed_array_class};
use bun_sema::check::locked_builtins::{self, Builtin, Change, global_object};
use bun_sema::util::{InParallel, for_each_mut};
use rustc_hash::{FxHashMap, FxHashSet};
use smallvec::SmallVec;
use std::collections::VecDeque;
use std::fmt::Write;
use std::ops::Range;
use std::rc::Rc;
use std::time::Instant;

const MAX_ROUNDS: usize = 24;
const MAX_CHANGES_INSIDE: u8 = 16;
const MAX_CHANGES_BETWEEN: u8 = 4;
const MAX_LISTED: usize = 200;
const MAX_SOURCES_LISTED: usize = 40;
const FUNCTIONS_PER_RUN: usize = 256;
const OPTIMISTIC: u32 = 1 << 31;
const CONTEXTUAL: u32 = 1 << 31;

#[derive(Copy, Clone, PartialEq, Eq, PartialOrd, Ord, Debug)]
pub(super) enum Verdict {
    Fine,
    Unknown,
    Wrong,
}

#[derive(Copy, Clone, PartialEq, Eq, PartialOrd, Ord, Hash, Debug)]
pub(super) enum Kind {
    As,
    NonNull,
    Argument,
    Variable,
    Field,
    Return,
    Integer,
    Read,
    Element,
    Result,
    Await,
    Narrowing,
    Arithmetic,
    Parameter,
    BuiltinWrite,
    PrototypeWrite,
    Mutation,
    Copy,
}

impl Kind {
    const ALL: [Kind; 18] = [
        Kind::As,
        Kind::NonNull,
        Kind::Argument,
        Kind::Variable,
        Kind::Field,
        Kind::Return,
        Kind::Integer,
        Kind::Read,
        Kind::Element,
        Kind::Result,
        Kind::Await,
        Kind::Narrowing,
        Kind::Arithmetic,
        Kind::Parameter,
        Kind::BuiltinWrite,
        Kind::PrototypeWrite,
        Kind::Mutation,
        Kind::Copy,
    ];

    pub(super) fn text(self) -> &'static str {
        match self {
            Kind::As => "as",
            Kind::NonNull => "non-null",
            Kind::Argument => "argument",
            Kind::Variable => "variable",
            Kind::Field => "field",
            Kind::Return => "return",
            Kind::Integer => "integer",
            Kind::Read => "read",
            Kind::Element => "element",
            Kind::Result => "result",
            Kind::Await => "await",
            Kind::Narrowing => "narrowing",
            Kind::Arithmetic => "arithmetic",
            Kind::Parameter => "parameter",
            Kind::BuiltinWrite => "builtin-write",
            Kind::PrototypeWrite => "prototype-write",
            Kind::Mutation => "typed-object-mutation",
            Kind::Copy => "copy",
        }
    }

    fn name(self) -> &'static str {
        match self {
            Kind::As => "as-convert",
            Kind::NonNull => "non-null",
            Kind::Argument => "enter-argument",
            Kind::Variable => "enter-variable",
            Kind::Field => "enter-field",
            Kind::Return => "enter-return",
            Kind::Integer => "int32-range",
            Kind::Read => "read-property",
            Kind::Element => "read-element",
            Kind::Result => "call-result",
            Kind::Await => "await-result",
            Kind::Narrowing => "narrowing",
            Kind::Arithmetic => "arithmetic-result",
            Kind::Parameter => "enter-function",
            Kind::BuiltinWrite => "builtin-member-replace",
            Kind::PrototypeWrite => "class-prototype-write",
            Kind::Mutation => "field-store-untyped",
            Kind::Copy => "copy-on-enter",
        }
    }

    fn place(self) -> &'static str {
        match self {
            Kind::Argument => "the parameter",
            Kind::Variable => "the variable",
            Kind::Field => "the property",
            Kind::Return => "the result",
            Kind::Integer => "the place",
            Kind::Arithmetic => "the type of the expression",
            _ => "the type of the value",
        }
    }

    fn fix(self, verdict: Verdict) -> &'static str {
        match (self, verdict) {
            (Kind::As, Verdict::Wrong) => "write the conversion out (Number(x), String(x), Boolean(x)) or correct the type: `as` is not erased under --aot",
            (Kind::As, _) => "narrow instead of casting (typeof, a type guard), or write the conversion out",
            (Kind::NonNull, Verdict::Wrong) => "the value is always missing: remove the `!` and handle the missing value",
            (Kind::NonNull, _) => "test for null and undefined, or give a default with `??`",
            (Kind::Integer, _) => "round explicitly (`| 0`, Math.trunc) or declare it as `number`",
            (Kind::Argument | Kind::Variable | Kind::Field | Kind::Return, Verdict::Wrong) => "the value never fits the declared type: correct the value or the type",
            (Kind::Argument | Kind::Variable | Kind::Field | Kind::Return | Kind::Read | Kind::Result | Kind::Await, _) => "validate the value once, where it enters the program, and build a typed value from it",
            (Kind::Element, _) => "store only values of the element type in the container: do not store through `any` or through a wider type",
            (Kind::Narrowing, _) => "read the value into a const before the test, so that nothing can change it between the test and the use",
            (Kind::Arithmetic, _) => "the operands do not match their types: remove the cast that hides this",
            (Kind::Parameter, _) => "give the untyped caller a wrapper that validates, or widen the parameter and narrow inside",
            (Kind::BuiltinWrite, _) => "built-ins are locked under --aot: use your own function or subclass",
            (Kind::PrototypeWrite, _) => "declare the member in the class, or keep the function in your own table",
            (Kind::Copy, _) => "build the typed object from the external one yourself and use only the typed object: code that keeps the external object does not see later writes",
            (Kind::Mutation, _) => "a typed object keeps its declared properties and their types: declare the property optional or wider, or build another object",
        }
    }
}

#[derive(Copy, Clone, PartialEq, Eq, Debug)]
pub(super) enum Tier {
    Outside,
    Assertion,
    Typed,
    Rule,
}

impl Tier {
    const ALL: [Tier; 4] = [Tier::Outside, Tier::Assertion, Tier::Typed, Tier::Rule];

    fn text(self) -> &'static str {
        match self {
            Tier::Outside => "untyped-input",
            Tier::Assertion => "cast",
            Tier::Typed => "typed-code",
            Tier::Rule => "restriction",
        }
    }
}

#[derive(Copy, Clone, PartialEq, Eq)]
enum Cause {
    Cast,
    NonNull,
    AfterCast,
    DeclaredOnly,
    CalledAsValue,
    Any,
    UnknownSource,
    JavaScript,
    Caught,
    BuiltinWrite,
    Rule,
    Narrowing,
    TypedCode,
}

impl Cause {
    const ALL: [Cause; 13] = [Cause::Cast, Cause::NonNull, Cause::AfterCast, Cause::DeclaredOnly, Cause::CalledAsValue, Cause::Any, Cause::UnknownSource, Cause::JavaScript, Cause::Caught, Cause::BuiltinWrite, Cause::Rule, Cause::Narrowing, Cause::TypedCode];

    fn text(self) -> &'static str {
        match self {
            Cause::Cast => "as",
            Cause::NonNull => "non-null",
            Cause::AfterCast => "after-as",
            Cause::DeclaredOnly => "declared-only",
            Cause::CalledAsValue => "called-as-a-value",
            Cause::Any => "any",
            Cause::UnknownSource => "unknown-source",
            Cause::JavaScript => "javascript",
            Cause::Caught => "caught",
            Cause::BuiltinWrite => "builtin-write",
            Cause::Rule => "rule",
            Cause::Narrowing => "narrowing",
            Cause::TypedCode => "typed-code",
        }
    }

    fn as_str(self) -> &'static str {
        match self {
            Cause::Cast => "at an `as`",
            Cause::NonNull => "at a `!`",
            Cause::AfterCast => "where a value that an `as` let through is used",
            Cause::DeclaredOnly => "on a value from code that has only a declaration",
            Cause::CalledAsValue => "on a parameter of a function that is called as a value or with `any`",
            Cause::Any => "on an `any`",
            Cause::UnknownSource => "on a value whose source is not known",
            Cause::JavaScript => "on a value from a JavaScript file of the program",
            Cause::Caught => "on a caught exception",
            Cause::BuiltinWrite => "at a write to a built-in object",
            Cause::Rule => "by another --aot rule",
            Cause::Narrowing => "where a type is narrowed",
            Cause::TypedCode => "within typed code",
        }
    }
}

#[derive(Copy, Clone, PartialEq, Eq)]
pub(super) enum ExternalSourceKind {
    DeclaredOnly,
    JavaScript,
    Caught,
    Other,
}

pub(super) struct Site {
    pub(super) ordinal: Option<u32>,
    pub(super) is_in_untyped_code: bool,
    pub(super) is_at_entrypoint: bool,
    pub(super) call: Option<(u32, u32)>,
    pub(super) risk: &'static str,
    pub(super) external_source: String,
    pub(super) source_kind: ExternalSourceKind,
    pub(super) is_after_cast: bool,
    pub(super) name: &'static str,
    pub(super) what: String,
    pub(super) function: String,
    pub(super) value: String,
    pub(super) tier: Tier,
    pub(super) module: u32,
    pub(super) pos: u32,
    pub(super) kind: Kind,
    pub(super) verdict: Verdict,
    pub(super) expected: String,
    pub(super) found: String,
    pub(super) detail: String,
    pub(super) origin: Option<(u32, u32, String)>,
}

impl Site {
    fn shown(&self) -> &str {
        if self.value.is_empty() { &self.found } else { &self.value }
    }

    fn cause(&self) -> Cause {
        match (self.tier, self.kind) {
            (_, Kind::BuiltinWrite) => Cause::BuiltinWrite,
            (_, Kind::Parameter) => Cause::CalledAsValue,
            (Tier::Rule, _) => Cause::Rule,
            _ if matches!(self.name, "as-convert" | "as-refuse") => Cause::Cast,
            (_, Kind::NonNull) => Cause::NonNull,
            _ if self.name == "as-late-use" || self.is_after_cast => Cause::AfterCast,
            (Tier::Outside, _) if self.source_kind == ExternalSourceKind::DeclaredOnly => Cause::DeclaredOnly,
            (Tier::Outside, _) if self.source_kind == ExternalSourceKind::JavaScript => Cause::JavaScript,
            (Tier::Outside, _) if self.source_kind == ExternalSourceKind::Caught => Cause::Caught,
            (Tier::Outside, _) if self.origin.is_none() => Cause::UnknownSource,
            (Tier::Outside, _) => Cause::Any,
            (Tier::Assertion, _) => Cause::AfterCast,
            (Tier::Typed, Kind::Narrowing) => Cause::Narrowing,
            (Tier::Typed, _) => Cause::TypedCode,
        }
    }

    fn fix(&self) -> &'static str {
        if self.is_after_cast && self.tier == Tier::Assertion && self.verdict != Verdict::Wrong { Kind::As.fix(self.verdict) } else { self.kind.fix(self.verdict) }
    }

    pub(super) fn continues_when_logged(&self) -> bool {
        self.risk == "primitive" && self.is_at_entrypoint
    }

    fn name_in_log_build(&self) -> &'static str {
        if self.name == "as-convert" {
            "converts"
        } else if self.continues_when_logged() || self.risk == "open" || self.ordinal.is_some() && self.is_at_entrypoint && self.risk != "closed" {
            "continues"
        } else {
            "throws"
        }
    }

    pub(super) fn message(&self) -> (u32, Vec<Vec<u8>>) {
        let bytes = |text: &str| text.as_bytes().to_vec();
        match self.kind {
            Kind::As => (100017, vec![bytes(&self.expected), bytes(self.shown())]),
            Kind::NonNull => (100012, vec![bytes(self.shown())]),
            Kind::BuiltinWrite => (100014, vec![bytes(&self.detail)]),
            Kind::PrototypeWrite | Kind::Mutation => (100015, vec![bytes(&self.detail)]),
            kind => (100013, vec![bytes(self.shown()), bytes(&self.expected), bytes(if self.detail.is_empty() { kind.place() } else { &self.detail })]),
        }
    }
}

fn has_numbers(d: &Declared) -> bool {
    d.prims & prim::NUMBER != 0 || d.ints.is_some()
}

fn meet(a: &Declared, b: &Declared) -> Declared {
    let prims = a.prims & b.prims;
    let ints = match (a.prims & prim::NUMBER != 0, a.ints, b.prims & prim::NUMBER != 0, b.ints) {
        (true, _, true, _) => None,
        (true, _, false, within) => within,
        (false, within, true, _) => within,
        (false, Some(x), false, Some(y)) => {
            let (minimum, maximum) = (x.0.max(y.0), x.1.min(y.1));
            (minimum <= maximum).then_some((minimum, maximum))
        }
        _ => None,
    };
    if a.any_object {
        return Declared { prims, ints, parts: b.parts.clone(), any_object: b.any_object, any_function: b.any_function && a.any_function };
    }
    if b.any_object {
        return Declared { prims, ints, parts: a.parts.clone(), any_object: false, any_function: a.any_function && b.any_function };
    }
    if !b.has_objects() {
        return Declared { prims, ints, ..Declared::default() };
    }
    Declared { prims, ints, parts: a.parts.clone(), any_object: false, any_function: a.any_function }
}

fn complement(mask: &Declared) -> Declared {
    Declared { prims: prim::ALL & !mask.prims, ints: None, parts: Default::default(), any_object: !mask.any_object, any_function: !mask.any_function }
}

fn are_disjoint(a: &Declared, b: &Declared) -> bool {
    if a.prims & b.prims != 0 {
        return false;
    }
    if has_numbers(a) && has_numbers(b) {
        match (a.prims & prim::NUMBER == 0, a.ints, b.prims & prim::NUMBER == 0, b.ints) {
            (true, Some(x), true, Some(y)) if x.1 < y.0 || y.1 < x.0 => {}
            _ => return false,
        }
    }
    !(a.has_objects() && b.has_objects())
}

fn kinds_of(d: &Declared) -> u32 {
    u32::from(d.prims & prim::BOOLEAN != 0) | u32::from(has_numbers(d)) << 1 | u32::from(d.prims & prim::STRING != 0) << 2 | u32::from(d.prims & prim::SYMBOL != 0) << 3 | u32::from(d.prims & prim::BIGINT != 0) << 4
}

fn truthiness(d: &Declared) -> Option<bool> {
    if d.is_never() {
        return None;
    }
    let may_be_falsy = d.prims & (prim::NULLISH | prim::FALSE | prim::NUMBER | prim::STRING | prim::BIGINT) != 0 || d.ints.is_some_and(|(minimum, maximum)| minimum <= 0 && 0 <= maximum);
    let may_be_truthy = d.prims & (prim::TRUE | prim::NUMBER | prim::STRING | prim::BIGINT | prim::SYMBOL) != 0 || d.ints.is_some_and(|(minimum, maximum)| minimum != 0 || maximum != 0) || d.has_objects();
    match (may_be_truthy, may_be_falsy) {
        (true, false) => Some(true),
        (false, true) => Some(false),
        _ => None,
    }
}

#[derive(Clone, Copy)]
enum Use {
    ArgumentOf(u32, FuncId),
    Annotation,
    Property(StrId),
    Element,
    SomeProperty,
    Named(StrId),
    Returned,
    Unseen,
}

enum Provenance {
    Trusted,
    Is(TyId),
    Unknown(Kind),
}

type Facts = Vec<(u32, TyId)>;

const MANY: u32 = 1;

#[derive(Copy, Clone, PartialEq, Eq, Hash)]
enum Identity {
    Builtin(u16),
    BuiltinMember(u16, StrId),
    Function(FuncId),
    PrototypeOf(FuncId),
}

#[derive(Default)]
struct Keys {
    paths: FxHashMap<(u32, u32), u32>,
}

#[derive(Default)]
struct Added {
    first: usize,
    list: Vec<Declared>,
    ids: FxHashMap<Declared, TyId>,
}

struct Types<'a> {
    program_tys: &'a DeclaredTable,
    frozen: Option<&'a Added>,
    added: Added,
    anything: TyId,
}

impl Types<'_> {
    fn get(&self, id: TyId) -> &Declared {
        let at = id.idx();
        match self.frozen {
            _ if at < self.program_tys.list.len() => self.program_tys.get_widened(id),
            Some(frozen) if at < self.added.first => &frozen.list[at - frozen.first],
            _ => &self.added.list[at - self.added.first],
        }
    }

    fn intern(&mut self, declared: Declared) -> TyId {
        if let Some(id) = self.program_tys.find(&declared).or_else(|| self.frozen.and_then(|frozen| frozen.ids.get(&declared).copied())).or_else(|| self.added.ids.get(&declared).copied()) {
            return id;
        }
        let id = TyId::new(self.added.first + self.added.list.len());
        self.added.list.push(declared.clone());
        self.added.ids.insert(declared, id);
        id
    }
}

pub(super) struct Setup {
    noreturn: Vec<bool>,
    is_open_global: Vec<bool>,
    constant_stores: Vec<usize>,
}

impl Setup {
    fn new(program: &Program, is_whole: bool, in_parallel: InParallel<'_>) -> Setup {
        let (noreturn, stored, constant_stores) = find_noreturn_functions(program, is_whole, in_parallel);
        let mut is_open_global = vec![true; program.globals.len()];
        for global in stored {
            is_open_global[global as usize] = false;
        }
        for layout in program.layouts.iter().filter(|layout| layout.environment.is_none()) {
            for method in layout.methods.iter().filter(|method| method.func.is_some() && method.key != NO_VARIABLE) {
                if let Some(is_open) = is_open_global.get_mut(method.key as usize) {
                    *is_open = true;
                }
            }
        }
        Setup { noreturn, is_open_global, constant_stores }
    }
}

struct Frozen {
    types: Added,
    common: Common,
    identities: Vec<Identity>,
    identity_ids: FxHashMap<Identity, u32>,
    known: Vec<TyId>,
    origin: Vec<u32>,
    identity: Vec<u32>,
    stored_at: Vec<Option<(u32, V)>>,
}

fn runs_of(program: &Program) -> impl Iterator<Item = Range<usize>> {
    let count = program.funcs.len();
    (0..count).step_by(FUNCTIONS_PER_RUN).map(move |first| first..(first + FUNCTIONS_PER_RUN).min(count))
}

#[derive(Clone, Copy)]
struct Common {
    never: TyId,
    undefined: TyId,
    null: TyId,
    nil: TyId,
    yes: TyId,
    no: TyId,
    boolean: TyId,
    number: TyId,
    int32: TyId,
    uint32: TyId,
    numeric: TyId,
    string: TyId,
    bigint: TyId,
    sum: TyId,
    function: TyId,
    object: TyId,
    objects: TyId,
    array: TyId,
}

struct Flow<'a> {
    program: &'a Program,
    tys: Types<'a>,
    common: Common,
    frozen: Option<&'a Frozen>,
    own_values: u32,
    skipped: u32,
    at_function: usize,
    stored_at: Vec<Option<(u32, V)>>,
    first_value: Vec<u32>,
    results: u32,
    globals: u32,
    first_field: Vec<u32>,
    known: Vec<TyId>,
    origin: Vec<u32>,
    identity: Vec<u32>,
    identities: Vec<Identity>,
    identity_ids: FxHashMap<Identity, u32>,
    is_closed: Vec<bool>,
    is_open_global: &'a [bool],
    is_open_field: Vec<bool>,
    is_whole: bool,
    has_changed: bool,
    has_moved: bool,
    has_given_up: bool,
    used_narrowing: bool,
    noreturn: &'a [bool],
    callers: Vec<Vec<u32>>,
    global_readers: Vec<Vec<u32>>,
    field_readers: Vec<Vec<u32>>,
    is_pending: Vec<bool>,
    pending: VecDeque<u32>,
    met: FxHashMap<(TyId, TyId), TyId>,
    joined: FxHashMap<(TyId, TyId), TyId>,
    locked: FxHashMap<StrId, (Option<u16>, bool)>,
    changes: Vec<u8>,
    resolved: FxHashMap<(u32, u32), SmallVec<[FuncId; 2]>>,
    orders: Vec<Option<(Rc<[usize]>, bool)>>,
}

impl<'a> Flow<'a> {
    fn new(program: &'a Program, setup: &'a Setup, is_whole: bool, frozen: Option<&'a Frozen>) -> Flow<'a> {
        let first = program.tys.list.len() + frozen.map_or(0, |frozen| frozen.types.list.len());
        let mut tys = Types { program_tys: &program.tys, frozen: frozen.map(|frozen| &frozen.types), added: Added { first, ..Added::default() }, anything: program.tys.anything };
        let anything = tys.anything;
        let common = frozen.map(|frozen| frozen.common).unwrap_or_else(|| Common {
            never: tys.intern(Declared::never()),
            undefined: tys.intern(Declared::prims(prim::UNDEFINED)),
            null: tys.intern(Declared::prims(prim::NULL)),
            nil: tys.intern(Declared::prims(prim::NULLISH)),
            yes: tys.intern(Declared::prims(prim::TRUE)),
            no: tys.intern(Declared::prims(prim::FALSE)),
            boolean: tys.intern(Declared::prims(prim::BOOLEAN)),
            number: tys.intern(Declared::prims(prim::NUMBER)),
            int32: tys.intern(Declared::ints(i32::MIN as i64, i32::MAX as i64)),
            uint32: tys.intern(Declared::ints(0, u32::MAX as i64)),
            numeric: tys.intern(Declared::prims(prim::NUMBER | prim::BIGINT)),
            string: tys.intern(Declared::prims(prim::STRING)),
            bigint: tys.intern(Declared::prims(prim::BIGINT)),
            sum: tys.intern(Declared::prims(prim::NUMBER | prim::BIGINT | prim::STRING)),
            function: tys.intern(Declared::any_function()),
            object: tys.intern(Declared { any_object: true, ..Declared::default() }),
            objects: tys.intern(Declared::any_object()),
            array: tys.intern(Declared::part(Part::Array(anything))),
        });
        let mut count = 0u32;
        let mut take = |many: usize| {
            let first = count;
            count += many as u32;
            first
        };
        let (funcs, layouts) = if is_whole { (&program.funcs[..], &program.layouts[..]) } else { (&[][..], &[][..]) };
        let first_value: Vec<u32> = funcs.iter().map(|func| take(func.values.len())).collect();
        let results = take(if is_whole { program.funcs.len() } else { 0 });
        let globals = take(if frozen.is_some() { 0 } else { program.globals.len() });
        let first_field: Vec<u32> = layouts.iter().map(|layout| take(layout.fields.len())).collect();
        let fields = count - first_field.first().copied().unwrap_or(count);
        let mut is_closed: Vec<bool> = funcs.iter().map(|func| !func.has(func_flags::IS_VALUE | func_flags::IS_GENERIC_ENTRYPOINT | func_flags::IS_BUILTIN | func_flags::ASYNC | func_flags::GENERATOR) && matches!(func.kind, FuncKind::Plain | FuncKind::Arrow)).collect();
        let mut is_called = vec![false; is_closed.len()];
        let mut is_open_field = vec![true; fields as usize];
        let base_of_fields = first_field.first().copied().unwrap_or(count);
        let mut callers: Vec<Vec<u32>> = vec![Vec::new(); if is_whole { program.funcs.len() } else { 0 }];
        let mut resolved: FxHashMap<(u32, u32), SmallVec<[FuncId; 2]>> = FxHashMap::default();
        let mut global_readers: Vec<Vec<u32>> = vec![Vec::new(); if is_whole { program.globals.len() } else { 0 }];
        let mut field_readers: Vec<Vec<u32>> = vec![Vec::new(); if is_whole { fields as usize } else { 0 }];
        let note = |list: &mut Vec<u32>, who: usize| {
            if list.last() != Some(&(who as u32)) {
                list.push(who as u32);
            }
        };
        for (who, func) in funcs.iter().enumerate() {
            for (number, value) in func.values.iter().enumerate() {
                match &value.def {
                    Def::Op(Op::CallDirect { func: called, .. }) => note(&mut callers[called.idx()], who),
                    Def::Op(Op::Call { .. } | Op::CallMethod { .. }) => {
                        if let Some((found, _)) = functions_called(program, func, V::new(number)) {
                            for called in &found {
                                note(&mut callers[called.idx()], who);
                            }
                            resolved.insert((who as u32, number as u32), found);
                        }
                    }
                    Def::Op(Op::GlobalGet(global)) => note(&mut global_readers[global.idx()], who),
                    Def::Op(Op::FieldGet { layout, field, .. }) if program.layouts[layout.idx()].kind == LayoutKind::Environment => note(&mut field_readers[(first_field[layout.idx()] + field - base_of_fields) as usize], who),
                    _ => {}
                }
            }
            for value in &func.values {
                match &value.def {
                    Def::Op(Op::FuncRef(named) | Op::Closure { func: named, .. } | Op::ClosureOnce { func: named, .. }) => is_closed[named.idx()] = false,
                    Def::Op(Op::CallDirect { func: called, .. }) => is_called[called.idx()] = true,
                    Def::Op(Op::FieldSet { layout, field, .. }) if program.layouts[layout.idx()].kind == LayoutKind::Environment => is_open_field[(first_field[layout.idx()] + field - base_of_fields) as usize] = false,
                    _ => {}
                }
            }
        }
        for layout in layouts {
            for method in layout.methods.iter().filter(|method| method.func.is_some()) {
                is_closed[method.func.idx()] = false;
            }
            if layout.constructor.is_some() {
                is_closed[layout.constructor.idx()] = false;
            }
            for field in &layout.fields {
                if field.single_function.is_some() {
                    is_closed[field.single_function.idx()] = false;
                }
            }
        }
        for &entry in program.entries.iter().chain(program.modules.iter().map(|module| &module.init)).chain(program.builtin_modules.iter().map(|entry| &entry.1)).chain(program.builtin_functions.iter().map(|entry| &entry.1)) {
            if entry.is_some() && is_whole {
                is_closed[entry.idx()] = false;
            }
        }
        for (closed, called) in is_closed.iter_mut().zip(&is_called) {
            *closed &= called;
        }
        let own_values = if is_whole { 0 } else { program.globals.len() as u32 };
        let skipped = if frozen.is_some() { own_values } else { 0 };
        let stored_at = vec![None; if is_whole || frozen.is_some() { 0 } else { program.globals.len() }];
        Flow { program, tys, common, frozen, own_values, skipped, at_function: 0, stored_at, first_value, results, globals, first_field, known: vec![TyId::NONE; count as usize], origin: vec![0; count as usize], identity: vec![0; count as usize], identities: Vec::new(), identity_ids: FxHashMap::default(), is_closed, is_open_global: &setup.is_open_global, is_open_field, is_whole, has_changed: false, has_moved: false, has_given_up: false, used_narrowing: false, noreturn: &setup.noreturn, callers, global_readers, field_readers, is_pending: vec![false; if is_whole { program.funcs.len() } else { 0 }], pending: VecDeque::new(), met: FxHashMap::default(), joined: FxHashMap::default(), locked: FxHashMap::default(), changes: vec![0; count as usize], resolved, orders: vec![None; if is_whole { program.funcs.len() } else { 0 }] }
    }

    fn get(&self, ty: TyId) -> &Declared {
        self.tys.get(ty)
    }

    fn base(&self, index: usize) -> u32 {
        if self.is_whole { self.first_value[index] } else { self.own_values }
    }

    fn slot(&self, node: u32) -> usize {
        (node - self.skipped) as usize
    }

    fn is_closed(&self, index: usize) -> bool {
        self.is_whole && self.is_closed[index]
    }

    fn begin(&mut self, index: usize) {
        if self.is_whole {
            return;
        }
        self.at_function = index;
        let (retained, all) = ((self.own_values - self.skipped) as usize, (self.own_values - self.skipped) as usize + self.program.funcs[index].values.len());
        self.known.truncate(retained);
        self.known.resize(all, TyId::NONE);
        self.origin.truncate(retained);
        self.origin.resize(all, 0);
        self.identity.truncate(retained);
        self.identity.resize(all, 0);
        self.changes.truncate(retained);
        self.changes.resize(all, 0);
    }

    fn of_global(&self, global: u32) -> (TyId, u32, u32) {
        match self.frozen {
            Some(frozen) => (frozen.known[global as usize], frozen.origin[global as usize], frozen.identity[global as usize]),
            None => {
                let at = (self.globals + global) as usize;
                (self.known[at], self.origin[at], self.identity[at])
            }
        }
    }

    fn freeze(self) -> Frozen {
        let globals = self.program.globals.len();
        Frozen { types: self.tys.added, common: self.common, identities: self.identities, identity_ids: self.identity_ids, known: self.known[..globals].to_vec(), origin: self.origin[..globals].to_vec(), identity: self.identity[..globals].to_vec(), stored_at: self.stored_at }
    }

    fn declared(&self, func: &Func, v: V) -> TyId {
        let ty = func.ty(v);
        if ty.is_none() { self.tys.anything } else { ty }
    }

    fn is_informative(&self, ty: TyId) -> bool {
        ty.is_some() && ty != self.tys.anything
    }

    fn meet(&mut self, a: TyId, b: TyId) -> TyId {
        if a == b || b == self.tys.anything {
            return a;
        }
        if a == self.tys.anything {
            return b;
        }
        if let Some(&met) = self.met.get(&(a, b)) {
            return met;
        }
        let met = meet(self.tys.get(a), self.tys.get(b));
        let met = self.tys.intern(met);
        self.met.insert((a, b), met);
        met
    }

    fn join(&mut self, a: TyId, b: TyId) -> TyId {
        if a == b || b == self.common.never {
            return a;
        }
        if a == self.common.never {
            return b;
        }
        if let Some(&joined) = self.joined.get(&(a, b)) {
            return joined;
        }
        let joined = self.tys.get(a).or(self.tys.get(b));
        let joined = self.tys.intern(joined);
        self.joined.insert((a, b), joined);
        joined
    }

    fn widened(&mut self, ty: TyId) -> TyId {
        let held = self.tys.get(ty);
        if held.parts.is_empty() {
            return ty;
        }
        let wide = Declared { any_object: true, any_function: held.any_function || held.parts.iter().any(|part| matches!(part, Part::Class(_) | Part::Global(..))), parts: Default::default(), ..held.clone() };
        self.tys.intern(wide)
    }

    fn callees_at(&self, index: usize, func: &Func, v: V) -> Option<SmallVec<[FuncId; 2]>> {
        if self.is_whole { self.resolved.get(&(index as u32, v.0)).cloned() } else { functions_called(self.program, func, v).map(|found| found.0) }
    }

    fn lookup_global(&mut self, name: StrId) -> (Option<u16>, bool) {
        let program = self.program;
        *self.locked.entry(name).or_insert_with(|| {
            let text = program.strs.get(name);
            if text == b"globalThis" && program.strs.find(b"ModuleGraph").is_some() {
                return (None, false);
            }
            let found = global_object().object_at(text);
            (found.map(Builtin::index), locked_builtins::is_locked_global(text) && is_engine_global(text))
        })
    }

    fn is_locked(&mut self, name: StrId) -> bool {
        self.lookup_global(name).1
    }

    fn join_into(&mut self, node: u32, ty: TyId, origin: u32) -> bool {
        self.join_bounded(node, ty, origin, MAX_CHANGES_INSIDE, None)
    }

    fn join_between(&mut self, node: u32, ty: TyId, origin: u32, top: TyId) -> bool {
        self.join_bounded(node, ty, origin, MAX_CHANGES_BETWEEN, Some(top))
    }

    fn join_bounded(&mut self, node: u32, ty: TyId, origin: u32, maximum: u8, top: Option<TyId>) -> bool {
        let node = self.slot(node) as u32;
        let old = self.known[node as usize];
        let is_at_the_top = top.is_some() && self.changes[node as usize] > maximum;
        let mut new = if is_at_the_top {
            old
        } else if old.is_none() {
            ty
        } else {
            self.join(old, ty)
        };
        let mut has_changed = new != old;
        if has_changed {
            let changes = &mut self.changes[node as usize];
            *changes = changes.saturating_add(1);
            if *changes > maximum {
                new = match top {
                    Some(top) => top,
                    None => self.widened(new),
                };
            }
        }
        self.known[node as usize] = new;
        let held = self.origin[node as usize];
        let carried = (held | origin) & CONTEXTUAL | if held & !CONTEXTUAL == 0 { origin & !CONTEXTUAL } else { held & !CONTEXTUAL };
        if carried != held {
            self.origin[node as usize] = carried;
            has_changed = true;
        }
        self.has_changed |= has_changed;
        has_changed
    }

    fn wake(&mut self, index: usize) {
        if self.is_whole && !std::mem::replace(&mut self.is_pending[index], true) {
            self.pending.push_back(index as u32);
        }
    }

    fn wake_all(&mut self, of: for<'f> fn(&'f Flow<'a>) -> &'f Vec<Vec<u32>>, at: usize) {
        if self.is_whole {
            for number in 0..of(self)[at].len() {
                let index = of(self)[at][number] as usize;
                self.wake(index);
            }
        }
    }

    fn join_identity(&mut self, node: u32, identity: u32) -> bool {
        let node = self.slot(node) as u32;
        let old = self.identity[node as usize];
        let new = if old == 0 || old == identity || identity == 0 { old.max(identity) } else { MANY };
        self.identity[node as usize] = new;
        self.has_changed |= new != old;
        new != old
    }

    fn identity_id(&mut self, identity: Identity) -> u32 {
        if let Some(&id) = self.frozen.and_then(|frozen| frozen.identity_ids.get(&identity)).or_else(|| self.identity_ids.get(&identity)) {
            return id;
        }
        self.identities.push(identity);
        let id = (self.frozen.map_or(0, |frozen| frozen.identities.len()) + self.identities.len()) as u32 + MANY;
        self.identity_ids.insert(identity, id);
        id
    }

    fn identity_of(&self, index: usize, v: V) -> Option<Identity> {
        if v.is_none() {
            return None;
        }
        if !self.is_whole && index != self.at_function {
            return None;
        }
        let id = self.identity[self.slot(self.base(index) + v.0)];
        let below = self.frozen.map_or(&[][..], |frozen| &frozen.identities[..]);
        (id > MANY).then(|| {
            let at = (id - MANY - 1) as usize;
            if at < below.len() { below[at] } else { self.identities[at - below.len()] }
        })
    }

    fn raw_identity(&self, index: usize, v: V) -> u32 {
        if v.is_none() || !self.is_whole && index != self.at_function { MANY } else { self.identity[self.slot(self.base(index) + v.0)] }
    }

    fn identify(&mut self, index: usize, func: &Func, v: V) -> u32 {
        let Some(op) = func.op(v) else { return MANY };
        match *op {
            Op::FreeGet { name, .. } => match self.lookup_global(name).0 {
                Some(found) => self.identity_id(Identity::Builtin(found)),
                None => MANY,
            },
            Op::FuncRef(named) | Op::Closure { func: named, .. } | Op::ClosureOnce { func: named, .. } => self.identity_id(Identity::Function(named)),
            Op::PropGet { obj, name } => {
                let text = self.program.strs.get(name);
                match self.identity_of(index, obj) {
                    Some(Identity::Builtin(holder)) => match Builtin::at(holder).object_at(text) {
                        Some(found) => self.identity_id(Identity::Builtin(found.index())),
                        None if Builtin::at(holder).has(text) && Builtin::at(holder).known_value(text).is_some() => self.identity_id(Identity::BuiltinMember(holder, name)),
                        None => MANY,
                    },
                    Some(Identity::Function(named)) if text == b"prototype" => self.identity_id(Identity::PrototypeOf(named)),
                    _ if self.raw_identity(index, obj) == 0 => 0,
                    _ => MANY,
                }
            }
            Op::Coerce { value, .. } => self.raw_identity(index, value),
            Op::GlobalGet(global) if !self.is_open_global[global.idx()] => self.of_global(global.0).2,
            Op::FieldGet { layout, field, .. } if self.is_whole && self.program.layouts[layout.idx()].kind == LayoutKind::Environment && !self.is_open_field[self.field_index(self.first_field[layout.idx()] + field)] => self.identity[(self.first_field[layout.idx()] + field) as usize],
            Op::CallDirect { func: called, .. } if self.is_whole && !self.program.funcs[called.idx()].has(func_flags::ASYNC | func_flags::GENERATOR) && self.program.funcs[called.idx()].kind != FuncKind::Constructor => self.identity[(self.results + called.0) as usize],
            _ => MANY,
        }
    }

    fn field_index(&self, node: u32) -> usize {
        (node - self.first_field.first().copied().unwrap_or(0)) as usize
    }

    fn key_of(&self, func: &Func, keys: &mut Keys, v: V, depth: u32) -> Option<u32> {
        let root = strip_casts(func, v);
        let values = func.values.len() as u32;
        let path = |keys: &mut Keys, of: u32, step: u32, is_optimistic: bool| {
            let next = values + self.program.globals.len() as u32 + keys.paths.len() as u32;
            let key = *keys.paths.entry((of, step)).or_insert(next | if is_optimistic || of & OPTIMISTIC != 0 { OPTIMISTIC } else { 0 });
            Some(key)
        };
        match func.op(root) {
            Some(&Op::GlobalGet(global)) if self.program.globals[global.idx()].initialization == Initialization::NeverReadUninitializedStoredOnce => Some(values + global.0),
            Some(&Op::GlobalGet(global)) => path(keys, values + global.0, u32::MAX, true),
            Some(&Op::PropGet { obj, name }) if depth < 4 => {
                let of = self.key_of(func, keys, obj, depth + 1)?;
                path(keys, of, name.0, true)
            }
            Some(&Op::FieldGet { obj, layout, field }) if depth < 4 => {
                let of = self.key_of(func, keys, obj, depth + 1)?;
                let is_stored_once = self.program.layouts[layout.idx()].fields[field as usize].flags & field_flags::STORED_ONCE != 0;
                path(keys, of, field | 1 << 30, !is_stored_once)
            }
            _ => Some(root.0),
        }
    }

    fn val(&mut self, index: usize, func: &Func, facts: &Facts, keys: &mut Keys, v: V, is_optimistic: bool) -> TyId {
        if v.is_none() {
            return self.common.undefined;
        }
        let known = self.known[self.slot(self.base(index) + v.0)];
        if known.is_none() {
            return self.common.never;
        }
        if facts.is_empty() {
            return known;
        }
        let Some(key) = self.key_of(func, keys, v, 0) else { return known };
        if key & OPTIMISTIC != 0 && !is_optimistic {
            return known;
        }
        match facts.binary_search_by_key(&key, |fact| fact.0) {
            Ok(at) => {
                let met = self.meet(known, facts[at].1);
                self.used_narrowing |= met != known && !is_optimistic;
                met
            }
            Err(_) => known,
        }
    }

    fn origin_of(&self, index: usize, v: V) -> u32 {
        if v.is_none() { 0 } else { self.origin[self.slot(self.base(index) + v.0)] }
    }

    fn add_fact(&mut self, func: &Func, keys: &mut Keys, facts: &mut Facts, v: V, bound: TyId) {
        let Some(key) = self.key_of(func, keys, v, 0) else { return };
        match facts.binary_search_by_key(&key, |fact| fact.0) {
            Ok(at) => facts[at].1 = self.meet(facts[at].1, bound),
            Err(at) => facts.insert(at, (key, bound)),
        }
    }

    fn typeof_mask(&mut self, text: &[u8]) -> Option<TyId> {
        Some(match text {
            b"number" => self.common.number,
            b"string" => self.common.string,
            b"boolean" => self.common.boolean,
            b"undefined" => self.common.undefined,
            b"bigint" => self.common.bigint,
            b"symbol" => self.tys.intern(Declared::prims(prim::SYMBOL)),
            b"function" => self.common.function,
            b"object" => self.tys.intern(Declared { prims: prim::NULL, any_object: true, ..Declared::default() }),
            _ => return None,
        })
    }

    fn add_condition_facts(&mut self, index: usize, func: &Func, keys: &mut Keys, facts: &mut Facts, condition: V, sense: bool, depth: u32) {
        if depth > 4 || condition.is_none() {
            return;
        }
        let bound_by = |flow: &mut Flow<'a>, mask: TyId, holds: bool| {
            if holds {
                mask
            } else {
                let rest = complement(flow.tys.get(mask));
                flow.tys.intern(rest)
            }
        };
        match func.op(strip_casts(func, condition)) {
            Some(&Op::Not(inner)) => return self.add_condition_facts(index, func, keys, facts, inner, !sense, depth + 1),
            Some(&Op::Truthy(inner)) => return self.add_condition_facts(index, func, keys, facts, inner, sense, depth + 1),
            Some(&Op::IsNullish(inner)) => {
                let nil = self.common.nil;
                let bound = bound_by(self, nil, sense);
                return self.add_fact(func, keys, facts, inner, bound);
            }
            Some(&(Op::StrictEq { a, b } | Op::LooseEq { a, b })) => {
                let is_loose = matches!(func.op(strip_casts(func, condition)), Some(Op::LooseEq { .. }));
                for (tested, other) in [(a, b), (b, a)] {
                    if let (Some(&Op::TypeOf(subject)), Some(&Op::Str(text))) = (func.op(strip_casts(func, tested)), func.op(strip_casts(func, other))) {
                        let text = self.program.strs.get(text).to_vec();
                        if let Some(mask) = self.typeof_mask(&text) {
                            let bound = bound_by(self, mask, sense);
                            self.add_fact(func, keys, facts, subject, bound);
                        }
                        return;
                    }
                }
                for (tested, other) in [(a, b), (b, a)] {
                    let compared = self.val(index, func, &Vec::new(), keys, other, false);
                    let described = self.get(compared).clone();
                    let is_nullish = !described.is_never() && described.prims & !prim::NULLISH == 0 && described.ints.is_none() && !described.has_objects();
                    if is_loose {
                        if is_nullish {
                            let nil = self.common.nil;
                            let bound = bound_by(self, nil, sense);
                            self.add_fact(func, keys, facts, tested, bound);
                        }
                        continue;
                    }
                    let is_one_value = is_nullish && described.prims.count_ones() == 1 || described.prims.count_ones() == 1 && described.prims & prim::BOOLEAN != 0 && described.ints.is_none() && !described.has_objects();
                    if is_one_value {
                        let bound = bound_by(self, compared, sense);
                        self.add_fact(func, keys, facts, tested, bound);
                    } else if sense && !described.is_never() && !described.has_objects() {
                        self.add_fact(func, keys, facts, tested, compared);
                    }
                }
                return;
            }
            Some(&(Op::IsInstance { value, .. } | Op::InstanceOf { value, .. })) => {
                if sense {
                    let bound = self.common.objects;
                    self.add_fact(func, keys, facts, value, bound);
                }
                return;
            }
            Some(Op::CallMethod { obj, name, args }) if self.program.strs.get(*name) == b"isArray" && args.len() == 1 && self.refers_to_global(func, *obj, b"Array") => {
                if sense {
                    let bound = self.common.array;
                    self.add_fact(func, keys, facts, args[0], bound);
                }
                return;
            }
            _ => {}
        }
        let falsy = self.tys.intern(Declared { prims: prim::NULLISH | prim::FALSE | prim::NUMBER | prim::STRING | prim::BIGINT, ..Declared::default() });
        let truthy = self.tys.intern(Declared { prims: prim::ALL & !(prim::NULLISH | prim::FALSE), any_object: true, any_function: true, ..Declared::default() });
        self.add_fact(func, keys, facts, condition, if sense { truthy } else { falsy });
    }

    fn refers_to_global(&self, func: &Func, v: V, name: &[u8]) -> bool {
        matches!(func.op(strip_casts(func, v)), Some(&Op::FreeGet { name: named, .. }) if self.program.strs.get(named) == name)
    }

    fn builtin_holder(&self, index: usize, v: V) -> Option<&'static Builtin> {
        match self.identity_of(index, v)? {
            Identity::Builtin(holder) => Some(Builtin::at(holder)),
            _ => None,
        }
    }

    fn is_trusted_holder(&self, index: usize, v: V) -> bool {
        self.builtin_holder(index, v).is_some_and(|holder| holder.is_global_object() || is_engine_global(bun_core::strings::split(holder.name.as_bytes(), b".").next().unwrap_or_default()))
    }

    fn constant_key(&self, index: usize, func: &Func, key: V) -> Option<Vec<u8>> {
        match *func.op(strip_casts(func, key))? {
            Op::Str(text) => Some(self.program.strs.get(text).to_vec()),
            Op::Int(number) if number >= 0 => Some(number.to_string().into_bytes()),
            Op::ToKey(of) => self.constant_key(index, func, of),
            Op::PropGet { obj, name } if self.builtin_holder(index, obj).is_some_and(|holder| holder.name == "Symbol" && holder.known_value(self.program.strs.get(name)).is_some_and(|held| held.type_of == "symbol")) => Some([b"@@", self.program.strs.get(name)].concat()),
            _ => None,
        }
    }

    fn known_value_type(&mut self, held: locked_builtins::KnownValue) -> Option<TyId> {
        Some(match held.type_of {
            "function" => self.common.function,
            "object" if held.is_truthy => self.common.object,
            "number" => self.common.number,
            "string" => self.common.string,
            "undefined" => self.common.undefined,
            "symbol" => self.tys.intern(Declared::prims(prim::SYMBOL)),
            _ => return None,
        })
    }

    fn known_builtin_truthiness(&self, index: usize, func: &Func, v: V) -> Option<bool> {
        match func.op(strip_casts(func, v))? {
            &Op::PropGet { obj, name } => Some(self.builtin_holder(index, obj)?.known_read_result(self.program.strs.get(name))?.is_truthy),
            _ => None,
        }
    }

    fn is_engine_only(&self, receiver: &Declared) -> bool {
        !receiver.is_never() && !receiver.any_object && receiver.parts.iter().all(|part| !matches!(part, Part::Class(_)))
    }

    fn returns_contained_element(name: &[u8]) -> bool {
        matches!(name, b"at" | b"pop" | b"shift" | b"find" | b"findLast" | b"reduce" | b"reduceRight" | b"get" | b"getOrInsert" | b"getOrInsertComputed" | b"deref" | b"next" | b"call" | b"apply" | b"construct" | b"parse" | b"with")
    }

    fn natural_of_member(&mut self, index: usize, func: &Func, v: V, obj: V, name: StrId, receiver: TyId, is_call: bool) -> Provenance {
        let text = self.program.strs.get(name);
        let wanted = self.get(self.declared(func, v)).clone();
        let references_program_types = wanted.parts.iter().any(|part| matches!(part, Part::Class(_)));
        if self.is_trusted_holder(index, obj) {
            return if is_call && (Flow::returns_contained_element(text) || references_program_types) { Provenance::Unknown(Kind::Result) } else { Provenance::Trusted };
        }
        let described = self.get(receiver).clone();
        if self.is_engine_only(&described) {
            return if is_call && (Flow::returns_contained_element(text) || references_program_types) { Provenance::Unknown(Kind::Element) } else { Provenance::Trusted };
        }
        let is_closed_layout = |part: &Part| matches!(part, Part::Class(view) if view.is_some() && !self.program.layouts[view.idx()].accepts_untyped);
        if !is_call && !described.any_object && !described.any_function && !described.parts.is_empty() && described.parts.iter().all(is_closed_layout) {
            return Provenance::Trusted;
        }
        Provenance::Unknown(if is_call { Kind::Result } else { Kind::Read })
    }

    fn joined_result_ty(&mut self, func: &Func, v: V, found: &[FuncId]) -> TyId {
        let mut joined = self.common.never;
        for &called in found {
            let callee = &self.program.funcs[called.idx()];
            let produced = if callee.has(func_flags::ASYNC | func_flags::GENERATOR) || callee.kind == FuncKind::Constructor {
                self.declared(func, v)
            } else if !self.is_whole {
                if callee.result.is_none() { self.tys.anything } else { callee.result }
            } else {
                let known = self.known[(self.results + called.0) as usize];
                let declared = if callee.result.is_none() { self.tys.anything } else { callee.result };
                if known.is_none() { self.common.never } else { self.meet(known, declared) }
            };
            joined = self.join(joined, produced);
        }
        joined
    }

    fn provenance(&mut self, index: usize, func: &Func, facts: &Facts, keys: &mut Keys, v: V) -> Provenance {
        let Some(op) = func.op(v) else { return Provenance::Trusted };
        match op {
            &Op::PropGet { obj, name } => {
                let receiver = self.val(index, func, facts, keys, obj, false);
                if let Some(holder) = self.builtin_holder(index, obj) {
                    let text = self.program.strs.get(name);
                    if let Some(held) = holder.known_read_result(text) {
                        if holder.is_extensible && self.is_informative(func.ty(v)) {
                            let there = Declared { prims: self.get(func.ty(v)).prims & !prim::NULLISH, ..self.get(func.ty(v)).clone() };
                            return Provenance::Is(self.tys.intern(there));
                        }
                        if let Some(ty) = self.known_value_type(held) {
                            return Provenance::Is(ty);
                        }
                    }
                }
                self.natural_of_member(index, func, v, obj, name, receiver, false)
            }
            &Op::ElemGet { obj, .. } => {
                let receiver = self.val(index, func, facts, keys, obj, false);
                let described = self.get(receiver);
                let is_typed_array = !described.is_never() && !described.any_object && !described.any_function && described.parts.iter().all(|part| matches!(part, Part::Global(name, _) if is_typed_array_class(self.program.strs.get(*name))));
                if is_typed_array { Provenance::Trusted } else { Provenance::Unknown(Kind::Element) }
            }
            Op::IterGet { .. } => Provenance::Unknown(Kind::Element),
            Op::Call { callee, .. } => {
                if let Some(found) = self.callees_at(index, func, v) {
                    return Provenance::Is(self.joined_result_ty(func, v, &found));
                }
                match func.op(strip_casts(func, *callee)) {
                    Some(&Op::FreeGet { name, .. }) if self.is_locked(name) => Provenance::Trusted,
                    Some(&Op::PropGet { obj, name }) => {
                        let receiver = self.val(index, func, facts, keys, obj, false);
                        self.natural_of_member(index, func, v, obj, name, receiver, true)
                    }
                    _ => Provenance::Unknown(Kind::Result),
                }
            }
            &Op::CallMethod { obj, name, .. } => {
                if let Some(found) = self.callees_at(index, func, v) {
                    return Provenance::Is(self.joined_result_ty(func, v, &found));
                }
                let receiver = self.val(index, func, facts, keys, obj, false);
                self.natural_of_member(index, func, v, obj, name, receiver, true)
            }
            Op::Construct { callee, .. } => {
                if self.is_trusted_holder(index, *callee) || matches!(self.identity_of(index, *callee), Some(Identity::Function(_))) { Provenance::Trusted } else { Provenance::Unknown(Kind::Result) }
            }
            &Op::Await(awaited) => {
                let value = self.val(index, func, facts, keys, awaited, false);
                if self.get(value).has_objects() { Provenance::Unknown(Kind::Await) } else { Provenance::Is(value) }
            }
            Op::Operation { .. } => Provenance::Trusted,
            _ => Provenance::Trusted,
        }
    }

    fn arithmetic(&mut self, op: BinOp, a: TyId, b: TyId) -> TyId {
        let (x, y) = (self.get(a).clone(), self.get(b).clone());
        if x.is_never() || y.is_never() {
            return self.common.never;
        }
        let is_plain = |d: &Declared| !d.has_objects() && d.prims & (prim::BIGINT | prim::SYMBOL) == 0;
        let is_text = |d: &Declared| !d.has_objects() && d.prims & !prim::STRING == 0 && d.ints.is_none();
        match op {
            BinOp::Add if is_text(&x) || is_text(&y) => {
                if is_plain(&x) && is_plain(&y) { self.common.string } else { self.common.sum }
            }
            BinOp::Add if is_plain(&x) && is_plain(&y) && (x.prims | y.prims) & prim::STRING == 0 => self.common.number,
            BinOp::Add if is_plain(&x) || is_plain(&y) => self.tys.intern(Declared::prims(prim::NUMBER | prim::STRING)),
            BinOp::Add => self.common.sum,
            BinOp::UShr => self.common.uint32,
            BinOp::BitAnd | BinOp::BitOr | BinOp::BitXor | BinOp::Shl | BinOp::Shr if is_plain(&x) && is_plain(&y) => self.common.int32,
            _ if is_plain(&x) || is_plain(&y) => self.common.number,
            _ => self.common.numeric,
        }
    }

    fn coerced(&mut self, have: TyId, to: TyId, result: TyId) -> TyId {
        let (had, tried, produced) = (self.get(have).clone(), self.get(to).clone(), self.get(result).clone());
        if had.is_never() {
            return self.common.never;
        }
        let mut created = Declared { prims: had.prims & prim::NULLISH, ..Declared::default() };
        let kinds = kinds_of(&had);
        if kinds != 0 {
            if kinds & !kinds_of(&tried) == 0 {
                created.prims |= had.prims & !prim::NULLISH;
                created.ints = had.ints;
            } else {
                created.prims |= tried.prims & !prim::NULLISH;
                if tried.ints.is_some() {
                    created.prims |= prim::NUMBER;
                }
                if tried.prims & prim::BOOLEAN != 0 {
                    created.prims |= prim::BOOLEAN;
                }
            }
        }
        if had.has_objects() {
            created.parts.clone_from(&produced.parts);
            created.any_object = produced.any_object;
            created.any_function = produced.any_function;
        }
        self.tys.intern(created)
    }

    fn transfer(&mut self, index: usize, func: &Func, facts: &Facts, keys: &mut Keys, v: V) -> (TyId, u32) {
        let declared = self.declared(func, v);
        let own = self.base(index) + v.0 + 1;
        let Some(op) = func.op(v) else { return (declared, 0) };
        match op {
            Op::Undefined => (self.common.undefined, 0),
            Op::Null => (self.common.null, 0),
            &Op::Bool(value) => (if value { self.common.yes } else { self.common.no }, 0),
            &Op::Int(value) => (self.tys.intern(Declared::int(value)), 0),
            Op::Double(_) => (self.common.number, 0),
            Op::Str(_) | Op::ToStr(_) | Op::StrConcat(_) | Op::TypeOf(_) => (self.common.string, 0),
            Op::BigInt(_) => (self.common.bigint, 0),
            Op::Symbol(_) => (self.tys.intern(Declared::prims(prim::SYMBOL)), 0),
            Op::FuncRef(_) | Op::Closure { .. } | Op::ClosureOnce { .. } => (self.common.function, 0),
            &(Op::New(layout) | Op::NewWith { layout, .. }) => (self.tys.intern(Declared::part(Part::Class(layout))), 0),
            Op::NewArray(_) => (if self.get(declared).parts.iter().any(|part| matches!(part, Part::Array(_))) && !self.get(declared).any_object { self.meet(declared, self.common.objects) } else { self.common.array }, 0),
            Op::NewObject => (self.common.object, 0),
            &Op::GlobalGet(global) => {
                if self.is_open_global[global.idx()] {
                    return (declared, if self.is_informative(declared) { 0 } else { own });
                }
                let (stored, origin, _) = self.of_global(global.0);
                let stored = if stored.is_none() { self.common.never } else { stored };
                let stored = if matches!(self.program.globals[global.idx()].initialization, Initialization::Undefined | Initialization::Lazy) { self.join(stored, self.common.undefined) } else { stored };
                (self.meet(stored, declared), origin)
            }
            &Op::GlobalSet(global, value) => {
                if self.frozen.is_some() || !self.is_whole && self.is_open_global[global.idx()] {
                    return (self.common.undefined, 0);
                }
                let stored = self.val(index, func, facts, keys, value, false);
                let origin = self.origin_of(index, value);
                let origin = if self.is_whole {
                    origin
                } else {
                    let from = match (origin & !CONTEXTUAL).checked_sub(1) {
                        Some(node) if node < self.own_values => self.stored_at[node as usize],
                        Some(node) => Some((index as u32, V(node - self.own_values))),
                        None => None,
                    };
                    let retained = self.stored_at[global.idx()].or(from);
                    self.stored_at[global.idx()] = retained;
                    origin & CONTEXTUAL | if retained.is_some() { global.0 + 1 } else { 0 }
                };
                let identity = self.raw_identity(index, value);
                if self.join_between(self.globals + global.0, stored, origin, self.tys.anything) | self.join_identity(self.globals + global.0, identity) {
                    self.wake_all(|flow| &flow.global_readers, global.idx());
                }
                (self.common.undefined, 0)
            }
            &Op::FieldGet { layout, field, .. } => {
                if !self.is_whole {
                    return (declared, 0);
                }
                let node = self.first_field[layout.idx()] + field;
                if self.program.layouts[layout.idx()].kind != LayoutKind::Environment || self.is_open_field[self.field_index(node)] {
                    return (declared, 0);
                }
                let stored = self.known[node as usize];
                let stored = if stored.is_none() { self.common.never } else { stored };
                let is_read_uninitialized = self.program.layouts[layout.idx()].fields[field as usize].flags & field_flags::NEVER_READ_UNINITIALIZED == 0;
                let stored = if is_read_uninitialized { self.join(stored, self.common.undefined) } else { stored };
                (self.meet(stored, declared), self.origin[node as usize])
            }
            &Op::FieldSet { layout, field, value, .. } => {
                if self.is_whole && self.program.layouts[layout.idx()].kind == LayoutKind::Environment {
                    let stored = self.val(index, func, facts, keys, value, false);
                    let origin = self.origin_of(index, value);
                    let identity = self.raw_identity(index, value);
                    if self.join_between(self.first_field[layout.idx()] + field, stored, origin, self.tys.anything) | self.join_identity(self.first_field[layout.idx()] + field, identity) {
                        let at = self.field_index(self.first_field[layout.idx()] + field);
                        self.wake_all(|flow| &flow.field_readers, at);
                    }
                }
                (self.common.undefined, 0)
            }
            &Op::Binary { op, a, b } => {
                let (x, y) = (self.val(index, func, facts, keys, a, false), self.val(index, func, facts, keys, b, false));
                let computed = self.arithmetic(op, x, y);
                (self.meet(computed, declared), (self.origin_of(index, a) | self.origin_of(index, b)) & CONTEXTUAL)
            }
            &Op::Unary { op, a } => {
                let operand = self.val(index, func, facts, keys, a, false);
                let described = self.get(operand);
                let is_plain = !described.has_objects() && described.prims & prim::BIGINT == 0;
                let computed = match op {
                    _ if described.is_never() => self.common.never,
                    UnOp::ToNumber => self.common.number,
                    UnOp::BitNot if is_plain => self.common.int32,
                    _ if is_plain => self.common.number,
                    _ => self.common.numeric,
                };
                (self.meet(computed, declared), 0)
            }
            &(Op::Not(a) | Op::Truthy(a)) => {
                let operand = self.val(index, func, facts, keys, a, false);
                let is_not = matches!(op, Op::Not(_));
                (match self.known_builtin_truthiness(index, func, a).or_else(|| truthiness(self.get(operand))) {
                    Some(holds) if holds != is_not => self.common.yes,
                    Some(_) => self.common.no,
                    None => self.common.boolean,
                }, 0)
            }
            &Op::IsNullish(a) => {
                let operand = self.val(index, func, facts, keys, a, false);
                let described = self.get(operand);
                (if described.is_never() {
                    self.common.boolean
                } else if described.prims & prim::NULLISH == 0 {
                    self.common.no
                } else if described.prims & !prim::NULLISH == 0 && described.ints.is_none() && !described.has_objects() {
                    self.common.yes
                } else {
                    self.common.boolean
                }, 0)
            }
            &Op::StrictEq { a, b } => {
                for (tested, other) in [(a, b), (b, a)] {
                    if let (Some(&Op::TypeOf(subject)), Some(&Op::Str(text))) = (func.op(strip_casts(func, tested)), func.op(strip_casts(func, other))) {
                        let text = self.program.strs.get(text).to_vec();
                        let Some(mask) = self.typeof_mask(&text) else { return (self.common.no, 0) };
                        let known = self.val(index, func, facts, keys, subject, false);
                        let (known, mask) = (self.get(known).clone(), self.get(mask).clone());
                        let within = Declared { ints: None, prims: known.prims | if known.ints.is_some() { prim::NUMBER } else { 0 }, parts: Default::default(), any_object: known.any_object || !known.parts.is_empty(), any_function: known.any_function };
                        return (if known.is_never() || known.parts.iter().any(|part| matches!(part, Part::Class(_) | Part::Global(..))) {
                            self.common.boolean
                        } else if within.prims & !mask.prims == 0 && (!within.any_object || mask.any_object) && (!within.any_function || mask.any_function) {
                            self.common.yes
                        } else if within.prims & mask.prims == 0 && !(within.any_object && mask.any_object) && !(within.any_function && mask.any_function) {
                            self.common.no
                        } else {
                            self.common.boolean
                        }, 0);
                    }
                }
                if let (Some(&Op::Str(x)), Some(&Op::Str(y))) = (func.op(strip_casts(func, a)), func.op(strip_casts(func, b))) {
                    return (if self.program.strs.get(x) == self.program.strs.get(y) { self.common.yes } else { self.common.no }, 0);
                }
                let (x, y) = (self.val(index, func, facts, keys, a, false), self.val(index, func, facts, keys, b, false));
                let (p, q) = (self.get(x), self.get(y));
                let is_single_nullish = |d: &Declared| d.prims & !prim::NULLISH == 0 && d.prims.count_ones() == 1 && d.ints.is_none() && !d.has_objects();
                (if p.is_never() || q.is_never() {
                    self.common.boolean
                } else if are_disjoint(p, q) {
                    self.common.no
                } else if x == y && is_single_nullish(p) {
                    self.common.yes
                } else {
                    self.common.boolean
                }, 0)
            }
            &Op::PropHas { obj, name } if self.builtin_holder(index, obj).is_some_and(|holder| holder.has_property(self.program.strs.get(name))) => (self.common.yes, 0),
            &Op::PropHas { obj, name } if self.builtin_holder(index, obj).is_some_and(|holder| !holder.has_property(self.program.strs.get(name)) && holder.known_read_result(self.program.strs.get(name)).is_some()) => (self.common.no, 0),
            Op::Relational { .. } | Op::LooseEq { .. } | Op::InstanceOf { .. } | Op::IsInstance { .. } | Op::PropHas { .. } | Op::PropDelete { .. } | Op::ElemHas { .. } | Op::ElemDelete { .. } | Op::IterHas { .. } => (self.common.boolean, 0),
            Op::FreeSet { .. } | Op::PropSet { .. } | Op::ElemSet { .. } | Op::IterClose(_) | Op::IterCloseForThrow(_) | Op::Poll | Op::UnlikelyHint => (self.common.undefined, 0),
            &Op::FreeGet { name, .. } => match self.program.strs.get(name) {
                b"undefined" => (self.common.undefined, 0),
                b"NaN" | b"Infinity" => (self.common.number, 0),
                _ if self.is_locked(name) => (self.common.objects, 0),
                _ => (declared, own),
            },
            Op::CallDirect { func: called, args } => {
                let (called, args) = (*called, args.clone());
                if self.is_closed(called.idx()) {
                    let callee = &self.program.funcs[called.idx()];
                    let parameters = callee.blocks.first().map_or(&[][..], |entry| &entry.params[..]);
                    for (&parameter, &argument) in parameters.iter().zip(&args) {
                        let handed = self.val(index, func, facts, keys, argument, false);
                        let taken = self.declared(callee, parameter);
                        let handed = self.meet(handed, taken);
                        let origin = self.origin_of(index, argument);
                        let identity = self.raw_identity(index, argument);
                        if self.join_between(self.first_value[called.idx()] + parameter.0, handed, origin | CONTEXTUAL, taken) | self.join_identity(self.first_value[called.idx()] + parameter.0, identity) {
                            self.wake(called.idx());
                        }
                    }
                }
                let produced = self.joined_result_ty(func, v, &[called]);
                (self.meet(produced, declared), if self.is_whole { self.origin[(self.results + called.0) as usize] } else { 0 })
            }
            &Op::Coerce { value, to, why } => {
                let have = self.val(index, func, facts, keys, value, false);
                let origin = self.origin_of(index, value);
                let origin = if origin & !CONTEXTUAL == 0 && matches!(why, CoerceReason::Coerce | CoerceReason::CoerceFreshGraph) { origin | own } else { origin };
                let origin = if why == CoerceReason::Flow { origin | CONTEXTUAL } else { origin };
                let held = match why {
                    CoerceReason::Coerce | CoerceReason::CoerceFreshGraph => self.coerced(have, to, declared),
                    CoerceReason::Cast | CoerceReason::CastFresh | CoerceReason::Flow if self.get(have).has_objects() => {
                        let met = meet(self.get(have), self.get(declared));
                        let wanted = self.get(declared);
                        let created = Declared { parts: wanted.parts.clone(), any_object: wanted.any_object, any_function: wanted.any_function, ..met };
                        self.tys.intern(created)
                    }
                    _ => self.meet(have, declared),
                };
                let origin = if matches!(why, CoerceReason::Upcast | CoerceReason::Forced) && held != have { origin | CONTEXTUAL } else { origin };
                let held = if self.get(held).is_never() && !self.get(have).is_never() { declared } else { held };
                (held, origin)
            }
            &(Op::IterOpen(of) | Op::ToKey(of)) => (declared, self.origin_of(index, of)),
            Op::ResumeMode => (declared, 0),
            Op::Caught | Op::CaughtException | Op::Yield(_) | Op::ExternalModule(_) => (declared, own),
            Op::PropGet { .. } | Op::ElemGet { .. } | Op::IterGet { .. } | Op::Call { .. } | Op::CallMethod { .. } | Op::Construct { .. } | Op::Await(_) | Op::Operation { .. } => {
                let from = match *op {
                    Op::PropGet { obj, .. } | Op::ElemGet { obj, .. } | Op::IterGet { iter: obj, .. } | Op::Await(obj) => self.origin_of(index, obj),
                    _ => 0,
                };
                match self.provenance(index, func, facts, keys, v) {
                    Provenance::Trusted => (declared, 0),
                    Provenance::Is(ty) => (self.meet(ty, declared), from),
                    Provenance::Unknown(_) => (declared, if from & !CONTEXTUAL != 0 { from } else { from | own }),
                }
            }
        }
    }

    fn flow_to(&mut self, index: usize, func: &Func, keys: &mut Keys, reached: &mut [Option<Facts>], from: &Facts, target: &Target, leaving: Facts) {
        let at = target.block.idx();
        for (&parameter, &argument) in func.blocks[at].params.iter().zip(&target.args) {
            self.used_narrowing = false;
            let handed = self.val(index, func, from, keys, argument, false);
            let taken = self.declared(func, parameter);
            let handed = self.meet(handed, taken);
            let origin = self.origin_of(index, argument) | if self.used_narrowing { CONTEXTUAL } else { 0 };
            self.join_into(self.base(index) + parameter.0, handed, origin);
            let identity = self.raw_identity(index, argument);
            self.join_identity(self.base(index) + parameter.0, identity);
        }
        match &mut reached[at] {
            None => {
                reached[at] = Some(leaving);
                self.has_moved = true;
            }
            Some(held) => {
                let before = held.len();
                let mut retained: Facts = Vec::with_capacity(before);
                let mut is_weaker = false;
                let mut others = leaving.iter().peekable();
                for &(key, bound) in held.iter() {
                    while others.next_if(|other| other.0 < key).is_some() {}
                    if let Some(&&(_, other)) = others.peek().filter(|other| other.0 == key) {
                        let joined = self.join(bound, other);
                        is_weaker |= joined != bound;
                        retained.push((key, joined));
                    }
                }
                if retained.len() != before || is_weaker {
                    reached[at] = Some(retained);
                    self.has_moved = true;
                }
            }
        }
    }

    fn run(&mut self, index: usize) -> (Vec<Option<Facts>>, Keys) {
        let func = &self.program.funcs[index];
        let mut keys = Keys::default();
        let mut reached: Vec<Option<Facts>> = vec![None; func.blocks.len()];
        self.begin(index);
        if func.blocks.is_empty() {
            return (reached, keys);
        }
        let (order, has_loops): (Rc<[usize]>, bool) = if self.is_whole {
            self.orders[index].get_or_insert_with(|| { let (order, has_loops) = reverse_postorder(func); (order.into(), has_loops) }).clone()
        } else {
            (Rc::from([]), false)
        };
        let mut has_changed = self.has_changed;
        if !self.is_closed(index) {
            for &parameter in &func.blocks[0].params {
                let declared = self.declared(func, parameter);
                let own = self.base(index) + parameter.0;
                self.join_into(own, declared, if self.is_informative(declared) { 0 } else { own + 1 });
                self.join_identity(own, MANY);
            }
        }
        has_changed |= self.has_changed;
        reached[0] = Some(Vec::new());
        let mut line = MustExecutePath::new(func);
        while !self.is_whole {
            let walked = line.order.len();
            line.grow(self.noreturn, func, Some(&reached));
            if line.order.len() <= walked {
                break;
            }
            for &at in &line.order[walked..] {
                if let Some(facts) = reached[at].clone() {
                    self.step(index, func, &mut keys, &mut reached, at, &facts);
                }
            }
            let mut entered = line.order[walked..].iter().flat_map(|&at| targets_of(func.blocks[at].term.as_ref()));
            if entered.any(|target| line.is_off_path[target.block.idx()] && reached[target.block.idx()].is_some()) {
                break;
            }
        }
        has_changed |= self.has_changed;
        for sweep in 0.. {
            (self.has_changed, self.has_moved) = (false, false);
            for &at in order.iter() {
                if let Some(facts) = reached[at].clone() {
                    self.step(index, func, &mut keys, &mut reached, at, &facts);
                }
            }
            has_changed |= self.has_changed;
            if !self.has_changed && !self.has_moved || !has_loops {
                break;
            }
            if sweep == 24 {
                self.has_given_up = true;
                break;
            }
        }
        self.has_changed = has_changed;
        (reached, keys)
    }

    fn step(&mut self, index: usize, func: &Func, keys: &mut Keys, reached: &mut [Option<Facts>], at: usize, facts: &Facts) {
        for &v in &func.blocks[at].ops {
            self.used_narrowing = false;
            let (ty, origin) = self.transfer(index, func, facts, keys, v);
            let origin = origin | if self.used_narrowing { CONTEXTUAL } else { 0 };
            self.join_into(self.base(index) + v.0, ty, origin);
            let identity = self.identify(index, func, v);
            self.join_identity(self.base(index) + v.0, identity);
            if !call_returns(self.noreturn, func, v) {
                if let Some(Term::Invoke { unwind, .. }) = func.blocks[at].term.as_ref() {
                    self.flow_to(index, func, keys, reached, facts, unwind, facts.clone());
                }
                return;
            }
        }
        match func.blocks[at].term.as_ref() {
            Some(Term::Branch { cond, then, otherwise }) => {
                let tested = self.val(index, func, facts, keys, *cond, false);
                let decided = self.known_builtin_truthiness(index, func, *cond).or_else(|| truthiness(self.get(tested)));
                for (target, sense) in [(then, true), (otherwise, false)] {
                    if decided == Some(!sense) {
                        continue;
                    }
                    let mut leaving = facts.clone();
                    self.add_condition_facts(index, func, keys, &mut leaving, *cond, sense, 0);
                    self.flow_to(index, func, keys, reached, facts, target, leaving);
                }
            }
            Some(&Term::Return(_)) if !self.is_whole => {}
            Some(&Term::Return(value)) => {
                self.used_narrowing = false;
                let returned = self.val(index, func, facts, keys, value, false);
                let origin = self.origin_of(index, value) | if self.used_narrowing { CONTEXTUAL } else { 0 };
                let identity = self.raw_identity(index, value);
                if self.join_between(self.results + index as u32, returned, origin, self.tys.anything) | self.join_identity(self.results + index as u32, identity) {
                    self.wake_all(|flow| &flow.callers, index);
                }
            }
            term => {
                for target in targets_of(term) {
                    self.flow_to(index, func, keys, reached, facts, target, facts.clone());
                }
            }
        }
    }
}

fn call_returns(noreturn: &[bool], func: &Func, v: V) -> bool {
    !matches!(func.op(v), Some(Op::CallDirect { func: called, .. }) if noreturn[called.idx()])
}

fn can_return(noreturn: Option<&[bool]>, func: &Func, seen: &mut Vec<bool>, pending: &mut Vec<usize>) -> bool {
    seen.clear();
    seen.resize(func.blocks.len(), false);
    seen[0] = true;
    pending.push(0);
    let mut returns = false;
    while let Some(at) = pending.pop() {
        let goes_on = noreturn.is_none_or(|noreturn| func.blocks[at].ops.iter().all(|&v| call_returns(noreturn, func, v)));
        let term = func.blocks[at].term.as_ref();
        returns |= goes_on && matches!(term, Some(Term::Return(_)));
        for (way, target) in targets_of(term).into_iter().enumerate() {
            let is_unwind = matches!(term, Some(Term::Invoke { .. })) && way == 1 || matches!(term, Some(Term::Throw { .. }));
            if (goes_on || is_unwind) && !std::mem::replace(&mut seen[target.block.idx()], true) {
                pending.push(target.block.idx());
            }
        }
    }
    returns
}

fn find_noreturn_functions(program: &Program, is_whole: bool, in_parallel: InParallel<'_>) -> (Vec<bool>, Vec<u32>, Vec<usize>) {
    let is_asked = |func: &Func| !func.blocks.is_empty() && !func.has(func_flags::ASYNC | func_flags::GENERATOR);
    let mut noreturn = vec![false; program.funcs.len()];
    let mut runs: Vec<(Range<usize>, Vec<usize>, Vec<u32>, Vec<u32>, (Vec<u32>, Vec<usize>))> = runs_of(program).map(|run| (run, Vec::new(), Vec::new(), Vec::new(), Default::default())).collect();
    for_each_mut(&mut runs, in_parallel, &|(run, turned, called, calls, (stored, storing))| {
        let (mut seen, mut pending) = (Vec::new(), Vec::new());
        for index in run.clone() {
            let func = &program.funcs[index];
            let (is_asked, before) = (is_asked(func), stored.len());
            for value in &func.values {
                match value.def {
                    Def::Op(Op::CallDirect { func: callee, .. }) if is_asked => called.push(callee.0),
                    Def::Op(Op::GlobalSet(global, _)) if is_whole || program.globals[global.idx()].initialization == Initialization::NeverReadUninitializedStoredOnce => stored.push(global.0),
                    _ => {}
                }
            }
            if stored.len() != before {
                storing.push(index);
            }
            if is_asked && !can_return(None, func, &mut seen, &mut pending) {
                turned.push(index);
            }
            calls.push(called.len() as u32);
        }
    });
    let mut turned: Vec<usize> = runs.iter().flat_map(|run| run.1.iter().copied()).collect();
    let (mut seen, mut pending) = (Vec::new(), Vec::new());
    while !turned.is_empty() {
        let mut now = vec![false; program.funcs.len()];
        for index in turned.drain(..) {
            (noreturn[index], now[index]) = (true, true);
        }
        for (run, _, called, calls, _) in &runs {
            let mut first = 0;
            for (index, &end) in run.clone().zip(calls) {
                let calls_converted_function = called[first..end as usize].iter().any(|&called| now[called as usize]);
                first = end as usize;
                if calls_converted_function && !noreturn[index] && !can_return(Some(&noreturn), &program.funcs[index], &mut seen, &mut pending) {
                    turned.push(index);
                }
            }
        }
    }
    let (mut stored, mut storing) = (Vec::new(), Vec::new());
    for (_, _, _, _, mut of_run) in runs {
        stored.append(&mut of_run.0);
        storing.append(&mut of_run.1);
    }
    (noreturn, stored, storing)
}

struct MustExecutePath {
    pred_counts: Vec<u32>,
    is_on_path: Vec<bool>,
    is_off_path: Vec<bool>,
    order: Vec<usize>,
}

impl MustExecutePath {
    fn new(func: &Func) -> MustExecutePath {
        let mut pred_counts = vec![0u32; func.blocks.len()];
        for target in func.blocks.iter().flat_map(|block| targets_of(block.term.as_ref())) {
            pred_counts[target.block.idx()] += 1;
        }
        MustExecutePath { pred_counts, is_on_path: vec![false; func.blocks.len()], is_off_path: vec![false; func.blocks.len()], order: Vec::new() }
    }

    fn grow(&mut self, noreturn: &[bool], func: &Func, reached: Option<&[Option<Facts>]>) {
        let mut next = match self.order.last() {
            Some(&last) => self.unique_successor(noreturn, func, reached, last),
            None => (!func.blocks.is_empty()).then_some(0),
        };
        while let Some(at) = next.filter(|&at| !self.is_on_path[at]) {
            self.is_on_path[at] = true;
            self.order.push(at);
            next = self.unique_successor(noreturn, func, reached, at);
        }
    }

    fn unique_successor(&mut self, noreturn: &[bool], func: &Func, reached: Option<&[Option<Facts>]>, at: usize) -> Option<usize> {
        let (to, aside) = match func.blocks[at].term.as_ref() {
            Some(Term::Jump(target) | Term::Invoke { normal: target, .. }) => (target.block.idx(), None),
            Some(Term::Branch { then, otherwise, .. }) => match reached.map(|reached| (reached[then.block.idx()].is_some(), reached[otherwise.block.idx()].is_some())) {
                Some((true, false)) => (then.block.idx(), Some(otherwise.block.idx())),
                Some((false, true)) => (otherwise.block.idx(), Some(then.block.idx())),
                _ => return None,
            },
            _ => return None,
        };
        if !((self.pred_counts[to] == 1 || func.blocks[to].params.is_empty()) && func.blocks[at].ops.iter().all(|&v| call_returns(noreturn, func, v))) {
            return None;
        }
        if let Some(aside) = aside {
            self.is_off_path[aside] = true;
        }
        Some(to)
    }
}

fn must_execute_blocks(noreturn: &[bool], func: &Func, reached: Option<&[Option<Facts>]>) -> Vec<usize> {
    let mut line = MustExecutePath::new(func);
    line.grow(noreturn, func, reached);
    line.order
}

fn must_execute_functions(program: &Program, noreturn: &[bool]) -> Vec<bool> {
    let mut surely = vec![false; program.funcs.len()];
    let mut pending: Vec<usize> = program.entries.iter().filter(|entry| entry.is_some()).map(|entry| entry.idx()).collect();
    while let Some(index) = pending.pop() {
        if std::mem::replace(&mut surely[index], true) {
            continue;
        }
        let func = &program.funcs[index];
        let evaluates_module_once = func.kind == FuncKind::Module && func.has(func_flags::IS_HIDDEN_IN_STACK_TRACES);
        let blocks = if evaluates_module_once { (0..func.blocks.len()).collect() } else { must_execute_blocks(noreturn, func, None) };
        for &at in &blocks {
            for &v in &func.blocks[at].ops {
                if let Some(Op::CallDirect { func: called, .. }) = func.op(v) {
                    pending.push(called.idx());
                }
                if !call_returns(noreturn, func, v) {
                    break;
                }
            }
        }
    }
    surely
}

fn reverse_postorder(func: &Func) -> (Vec<usize>, bool) {
    let count = func.blocks.len();
    let (mut state, mut order, mut has_loops) = (vec![0u8; count], Vec::with_capacity(count), false);
    let mut stack: Vec<(usize, usize)> = vec![(0, 0)];
    state[0] = 1;
    while let Some(&mut (at, ref mut next)) = stack.last_mut() {
        let targets = targets_of(func.blocks[at].term.as_ref());
        match targets.get(*next) {
            Some(target) => {
                *next += 1;
                let to = target.block.idx();
                match state[to] {
                    0 => {
                        state[to] = 1;
                        stack.push((to, 0));
                    }
                    1 => has_loops = true,
                    _ => {}
                }
            }
            None => {
                state[at] = 2;
                order.push(at);
                stack.pop();
            }
        }
    }
    order.reverse();
    (order, has_loops)
}

fn unused_parameters(func: &Func) -> Vec<bool> {
    let mut is_used = vec![false; func.values.len()];
    for block in &func.blocks {
        for &value in &block.ops {
            if let Some(op) = func.op(value) {
                op.clone().for_each_operand_mut(|operand| {
                    if operand.is_some() {
                        is_used[operand.idx()] = true;
                    }
                });
            }
        }
        if let Some(term) = &block.term {
            term.for_each_operand(|operand| {
                if operand.is_some() {
                    is_used[operand.idx()] = true;
                }
            });
        }
    }
    let first = func.captures.len() + usize::from(func.has(func_flags::HAS_THIS));
    let entry = func.blocks.first().map_or(&[][..], |block| &block.params[..]);
    (0..func.params.len()).map(|number| entry.get(first + number).is_some_and(|v| !is_used[v.idx()])).collect()
}

fn text_of(program: &Program, ty: &Declared, depth: u32) -> String {
    if ty.any_object && ty.prims & prim::ALL == prim::ALL {
        return "any".to_owned();
    }
    let mut parts: Vec<String> = Vec::new();
    for part in &ty.parts {
        if let Part::Class(layout) = part {
            parts.push(if layout.is_none() {
                "object".to_owned()
            } else {
                let layout = &program.layouts[layout.idx()];
                if layout.name.is_some() && !program.strs.get(layout.name).is_empty() {
                    bstr::BStr::new(program.strs.get(layout.name)).to_string()
                } else {
                    let names: Vec<String> = layout.fields.iter().take(4).map(|field| bstr::BStr::new(program.strs.get(field.name)).to_string()).collect();
                    format!("{{ {}{} }}", names.join(", "), if layout.fields.len() > 4 { ", ..." } else { "" })
                }
            });
        }
    }
    for part in &ty.parts {
        match part {
            Part::Class(_) => {}
            Part::Global(name, _) => parts.push(bstr::BStr::new(program.strs.get(*name)).to_string()),
            Part::Array(element) if depth < 2 && element.is_some() => {
                let element = text_of(program, program.tys.get(*element), depth + 1);
                parts.push(if bun_core::strings::contains(element.as_bytes(), b" | ") { format!("({element})[]") } else { format!("{element}[]") });
            }
            Part::Array(_) => parts.push("any[]".to_owned()),
        }
    }
    if ty.any_object {
        parts.push("object".to_owned());
    } else if ty.any_function {
        parts.push("Function".to_owned());
    }
    match ty.ints.filter(|_| ty.prims & prim::NUMBER == 0) {
        Some((minimum, maximum)) if minimum == maximum => parts.push(minimum.to_string()),
        Some((minimum, maximum)) => parts.push(format!("integer {minimum}..{maximum}")),
        None => {}
    }
    let has_both = ty.prims & prim::NULLISH == prim::NULLISH;
    let prims = if has_both && (!parts.is_empty() || ty.prims & !prim::NULLISH != 0) { ty.prims & !prim::NULLISH } else { ty.prims };
    match prims & prim::BOOLEAN {
        prim::BOOLEAN => parts.push("boolean".to_owned()),
        prim::TRUE => parts.push("true".to_owned()),
        prim::FALSE => parts.push("false".to_owned()),
        _ => {}
    }
    for (bit, name) in [(prim::NUMBER, "number"), (prim::STRING, "string"), (prim::SYMBOL, "symbol"), (prim::BIGINT, "bigint"), (prim::UNDEFINED, "undefined"), (prim::NULL, "null")] {
        if prims & bit != 0 {
            parts.push(name.to_owned());
        }
    }
    if parts.is_empty() { "never".to_owned() } else { parts.join(" | ") }
}

fn quoted(text: &[u8]) -> String {
    let shown = bstr::BStr::new(&text[..text.len().min(24)]).to_string();
    format!("{:?}{}", shown, if text.len() > 24 { ".." } else { "" })
}

struct Report<'a, 'b> {
    flow: &'b mut Flow<'a>,
    sites: Vec<Site>,
    fine: FxHashMap<Kind, usize>,
    class_of: &'b FxHashMap<FuncId, LayoutId>,
    always_throws: usize,
    at: V,
    name: Option<&'static str>,
    value: String,
    passing_sites: FxHashSet<(u32, u32, Kind)>,
    is_guarded_by_test: bool,
    is_must_execute: bool,
    risk: &'static str,
    call: Option<(u32, u32)>,
    is_at_entrypoint: bool,
    has_checking_entrypoint: &'b [bool],
    untyped_clone_class: &'b FxHashMap<FuncId, LayoutId>,
    logs_type_errors: bool,
    ordinal: Option<u32>,
    handed_over: Option<(u32, u32, String)>,
}

impl<'a> Report<'a, '_> {
    fn name_of_function(&self, func: &Func) -> String {
        let name = if func.name.is_some() { self.flow.program.strs.get(func.name) } else { b"" };
        if name.is_empty() { "a function".to_owned() } else { format!("`{}`", bstr::BStr::new(name)) }
    }

    fn origin_through_call(&self, origin: u32) -> u32 {
        let Some((index, v)) = origin.checked_sub(1).filter(|_| self.logs_type_errors).and_then(|node| self.locate(node)) else { return origin };
        let func = &self.flow.program.funcs[index];
        let Some(Op::Call { args, .. } | Op::CallMethod { args, .. }) = func.op(v) else { return origin };
        args.iter()
            .filter(|&&argument| !self.flow.is_informative(func.ty(strip_casts(func, argument))))
            .map(|&argument| self.flow.origin_of(index, argument) & !CONTEXTUAL)
            .find(|&found| found != 0)
            .unwrap_or(origin)
    }

    fn is_deferred_cast(&self, func: &Func) -> bool {
        if self.at.is_none() || self.at.idx() >= func.values.len() {
            return false;
        }
        let Some(&Op::Coerce { value, why: CoerceReason::Cast, .. }) = func.op(self.at) else { return false };
        let mut unpaired = 0u32;
        for other in &func.values[..self.at.idx()] {
            match other.def {
                Def::Op(Op::Coerce { value: same, to, why: CoerceReason::Upcast }) if same == value && to == func.ty(value) => unpaired += 1,
                Def::Op(Op::Coerce { value: same, why: CoerceReason::Cast, .. }) if same == value => unpaired = unpaired.saturating_sub(1),
                _ => {}
            }
        }
        unpaired != 0
    }

    fn locate(&self, node: u32) -> Option<(usize, V)> {
        if !self.flow.is_whole {
            return match node.checked_sub(self.flow.own_values) {
                Some(value) => Some((self.flow.at_function, V(value))),
                None => self.flow.frozen.map_or(&self.flow.stored_at[..], |frozen| &frozen.stored_at[..])[node as usize].map(|(index, v)| (index as usize, v)),
            };
        }
        if node >= self.flow.results {
            return None;
        }
        let index = self.flow.first_value.partition_point(|&first| first <= node) - 1;
        Some((index, V(node - self.flow.first_value[index])))
    }

    fn describe_callee(&self, func: &Func, callee: V) -> String {
        let strs = &self.flow.program.strs;
        match func.op(strip_casts(func, callee)) {
            Some(&Op::FreeGet { name, .. }) => bstr::BStr::new(strs.get(name)).to_string(),
            Some(&Op::PropGet { obj, name }) => format!("{}.{}", self.describe_callee(func, obj), bstr::BStr::new(strs.get(name))),
            Some(&Op::GlobalGet(global)) if self.flow.program.globals[global.idx()].name.is_some() => bstr::BStr::new(strs.get(self.flow.program.globals[global.idx()].name)).to_string(),
            _ => "..".to_owned(),
        }
    }

    fn origin(&self, origin: u32) -> Option<(u32, u32, String)> {
        let (index, v) = self.locate(origin.checked_sub(1)?)?;
        let func = &self.flow.program.funcs[index];
        let strs = &self.flow.program.strs;
        let text = |name: StrId| if name.is_some() { bstr::BStr::new(strs.get(name)).to_string() } else { "..".to_owned() };
        let what = match &func.values[v.idx()].def {
            Def::Param(..) => format!("a parameter of {}, which callers that the compiler does not see may call", self.name_of_function(func)),
            Def::Op(Op::CallMethod { obj, name, .. }) => format!("{}.{}(..)", self.describe_callee(func, *obj), text(*name)),
            Def::Op(Op::Call { callee, .. }) => format!("{}(..)", self.describe_callee(func, *callee)),
            Def::Op(Op::Construct { callee, .. }) => format!("new {}(..)", self.describe_callee(func, *callee)),
            Def::Op(Op::PropGet { obj, name }) => format!("{}.{}", self.describe_callee(func, *obj), text(*name)),
            Def::Op(Op::ElemGet { obj, .. }) => format!("an element of {}", self.describe_callee(func, *obj)),
            Def::Op(Op::IterGet { .. }) => "a value that a loop iterates over".to_owned(),
            Def::Op(Op::FreeGet { name, .. }) => format!("the global {}", text(*name)),
            Def::Op(Op::GlobalGet(global)) => format!("the variable {}", text(self.flow.program.globals[global.idx()].name)),
            Def::Op(Op::Caught) => "a caught exception".to_owned(),
            Def::Op(Op::Coerce { to, .. }) => format!("`as {}`", text_of(self.flow.program, self.flow.program.tys.get(*to), 0)),
            Def::Op(Op::Await(_)) => "an awaited value".to_owned(),
            Def::Op(Op::Yield(_)) => "the value that the generator is resumed with".to_owned(),
            Def::Op(Op::ExternalModule(specifier)) => format!("the module {}, which is not compiled with the program", quoted(strs.get(*specifier))),
            Def::Op(Op::Operation { which, .. }) => format!("the operation {}", which.name()),
            _ => "a value of unknown origin".to_owned(),
        };
        let pos = match func.values[v.idx()].def {
            Def::Param(..) => func.pos,
            _ => func.values[v.idx()].pos,
        };
        Some((func.module.0, pos, what))
    }

    fn risk_of(&self, wanted: &Declared) -> &'static str {
        let read = self.as_engine_type(wanted);
        if !read.has_objects() {
            "primitive"
        } else if read.any_object || read.parts.iter().any(|part| matches!(part, Part::Class(view) if view.is_some() && self.flow.program.layouts[view.idx()].accepts_untyped)) {
            "open"
        } else {
            "closed"
        }
    }

    fn external_source_of(&self, origin: u32) -> (ExternalSourceKind, String) {
        let Some((index, v)) = origin.checked_sub(1).and_then(|node| self.locate(node)) else { return (ExternalSourceKind::Other, String::new()) };
        let program = self.flow.program;
        let func = &program.funcs[index];
        let text = |name: StrId| if name.is_some() { bstr::BStr::new(program.strs.get(name)).to_string() } else { "..".to_owned() };
        let path = if func.module.is_some() { text(program.modules[func.module.idx()].display_path) } else { "..".to_owned() };
        if let Some((_, inside)) = bun_core::strings::rsplit_once(path.as_bytes(), b"node_modules/") {
            let mut names = bun_core::strings::split(inside, b"/").map(bstr::BStr::new);
            let first = names.next().unwrap_or_default();
            return (ExternalSourceKind::DeclaredOnly, format!("the package {}", if first.starts_with(b"@") { format!("{first}/{}", names.next().unwrap_or_default()) } else { first.to_string() }));
        }
        if func.has(func_flags::IS_BUILTIN | func_flags::IS_IN_BUILTIN_MODULE) {
            return (ExternalSourceKind::DeclaredOnly, format!("the runtime's {path}"));
        }
        if !func.has(func_flags::IS_TYPED) {
            return (ExternalSourceKind::JavaScript, format!("untyped code: {path}"));
        }
        let mut root = v;
        for _ in 0..16 {
            root = match func.op(root) {
                Some(&(Op::PropGet { obj: of, .. } | Op::ElemGet { obj: of, .. } | Op::Await(of))) => of,
                Some(Op::CallMethod { obj: of, .. } | Op::Call { callee: of, .. } | Op::Construct { callee: of, .. }) => *of,
                _ => break,
            };
        }
        if let Some(&Op::ExternalModule(specifier)) = func.op(root) {
            return (ExternalSourceKind::DeclaredOnly, format!("the module {}", text(specifier)));
        }
        match &func.values[v.idx()].def {
            Def::Op(Op::FreeGet { name, .. }) => (ExternalSourceKind::DeclaredOnly, format!("the global {}", text(*name))),
            Def::Op(Op::ExternalModule(specifier)) => (ExternalSourceKind::DeclaredOnly, format!("the module {}", text(*specifier))),
            Def::Op(Op::Caught | Op::CaughtException) => (ExternalSourceKind::Caught, "caught exceptions".to_owned()),
            Def::Op(Op::Coerce { .. }) => (ExternalSourceKind::Other, format!("`as` in {path}")),
            Def::Op(Op::CallMethod { obj, name, .. }) if self.flow.is_trusted_holder(index, *obj) => (ExternalSourceKind::Other, format!("{}.{}", self.describe_callee(func, *obj), text(*name))),
            Def::Param(..) => (ExternalSourceKind::Other, format!("parameters typed `any` in {path}")),
            Def::Op(Op::PropGet { obj, .. } | Op::CallMethod { obj, .. }) if self.flow.is_informative(func.ty(*obj)) => (ExternalSourceKind::Other, format!("untyped objects used as {} in {path}", text_of(program, program.tys.get(func.ty(*obj)), 0))),
            _ => (ExternalSourceKind::Other, format!("values typed `any` in {path}")),
        }
    }

    fn tier_of(&self, kind: Kind, origin: u32) -> Tier {
        if matches!(kind, Kind::BuiltinWrite | Kind::PrototypeWrite | Kind::Mutation | Kind::Parameter) {
            return Tier::Rule;
        }
        let asserted = if matches!(kind, Kind::As | Kind::NonNull) { Tier::Assertion } else { Tier::Typed };
        let Some((index, v)) = origin.checked_sub(1).and_then(|node| self.locate(node)) else { return asserted };
        let func = &self.flow.program.funcs[index];
        let is_typed = |v: V| func.has(func_flags::IS_TYPED) && self.flow.is_informative(func.ty(v)) && !may_hold_untyped_object(self.flow.program, self.flow.program.tys.get(func.ty(v)));
        let by = |v: V| if is_typed(v) { asserted } else { Tier::Outside };
        match &func.values[v.idx()].def {
            Def::Op(Op::Coerce { .. }) => Tier::Assertion,
            Def::Op(Op::CallMethod { obj, .. } | Op::PropGet { obj, .. } | Op::ElemGet { obj, .. } | Op::Await(obj) | Op::Construct { callee: obj, .. }) => {
                if self.flow.is_trusted_holder(index, *obj) { Tier::Outside } else { by(*obj) }
            }
            Def::Op(Op::IterGet { iter, .. }) => match func.op(*iter) {
                Some(&Op::IterOpen(of)) => by(of),
                _ => Tier::Outside,
            },
            Def::Op(Op::Call { callee, .. }) => match func.op(strip_casts(func, *callee)) {
                Some(&Op::PropGet { obj, .. }) if !self.flow.is_trusted_holder(index, obj) => by(obj),
                Some(Op::PropGet { .. }) => Tier::Outside,
                _ => by(*callee),
            },
            _ => Tier::Outside,
        }
    }

    fn constant(&self, func: &Func, v: V) -> Option<String> {
        let mut root = v;
        while let Some(&Op::Coerce { value, .. }) = func.op(root) {
            root = value;
        }
        Some(match func.op(root)? {
            Op::Undefined => "undefined".to_owned(),
            Op::Null => "null".to_owned(),
            Op::Bool(value) => value.to_string(),
            Op::Int(value) => value.to_string(),
            &Op::Double(bits) => format!("{}", f64::from_bits(bits)),
            &Op::Str(text) => quoted(self.flow.program.strs.get(text)),
            &Op::BigInt(text) => format!("{}n", bstr::BStr::new(self.flow.program.strs.get(text))),
            _ => return None,
        })
    }

    fn double(&self, func: &Func, v: V) -> Option<f64> {
        let mut root = v;
        while let Some(&Op::Coerce { value, .. }) = func.op(root) {
            root = value;
        }
        match *func.op(root)? {
            Op::Double(bits) => Some(f64::from_bits(bits)),
            Op::Unary { op: UnOp::Neg, a } if matches!(func.op(a), Some(Op::Int(0))) => Some(-0.0),
            _ => None,
        }
    }

    fn is_contained_in(&self, a: &Declared, b: &Declared) -> bool {
        let layouts = &self.flow.program.layouts;
        if a.prims & !b.prims != 0 || a.any_object && !b.any_object {
            return false;
        }
        if let Some((minimum, maximum)) = a.ints
            && b.prims & prim::NUMBER == 0
            && !b.ints.is_some_and(|within| within.0 <= minimum && maximum <= within.1)
        {
            return false;
        }
        let admits = b.any_object || b.parts.iter().any(|part| matches!(part, Part::Class(view) if view.is_some() && layouts[view.idx()].accepts_untyped));
        if a.any_function && !b.any_function && !admits {
            return false;
        }
        b.any_object
            || a.parts.iter().all(|part| match part {
                Part::Class(created) => {
                    let is_held = |created: &LayoutId| b.parts.iter().any(|within| matches!(within, Part::Class(view) if view == created || view.is_some() && layouts[view.idx()].members.binary_search(created).is_ok()));
                    is_held(created) || created.is_some() && (!layouts[created.idx()].accepts_untyped || admits) && layouts[created.idx()].members.iter().all(is_held)
                }
                Part::Array(_) => admits || b.parts.iter().any(|within| matches!(within, Part::Array(_))),
                Part::Global(name, _) => admits || b.parts.iter().any(|within| matches!(within, Part::Global(same, _) if same == name)),
            })
    }

    fn objects_are_disjoint(&self, a: &Declared, b: &Declared) -> bool {
        let layouts = &self.flow.program.layouts;
        if a.any_object || a.any_function || b.any_object || b.any_function {
            return false;
        }
        a.parts.iter().all(|x| {
            b.parts.iter().all(|y| match (x, y) {
                (&Part::Class(view), _) | (_, &Part::Class(view)) if view.is_none() => false,
                (&Part::Class(p), &Part::Class(q)) => {
                    let (p_as, q_as) = (&layouts[p.idx()], &layouts[q.idx()]);
                    let holds = |view: &crate::ir::Layout, own: LayoutId, created: LayoutId| own == created || view.members.binary_search(&created).is_ok();
                    p != q && !p_as.accepts_untyped && !q_as.accepts_untyped && !p_as.members.iter().chain([&p]).any(|&created| holds(q_as, q, created)) && !q_as.members.iter().any(|&created| holds(p_as, p, created))
                }
                (&Part::Class(view), _) | (_, &Part::Class(view)) => !layouts[view.idx()].accepts_untyped,
                _ => false,
            })
        })
    }

    fn as_engine_type(&self, ty: &Declared) -> Declared {
        let strs = &self.flow.program.strs;
        let is_distinguished = |name: &[u8]| matches!(name, b"Map" | b"Set" | b"WeakMap" | b"WeakSet" | b"WeakRef" | b"Promise" | b"RegExp" | b"Date" | b"Error" | b"ArrayBuffer" | b"SharedArrayBuffer" | b"DataView" | b"FinalizationRegistry") || is_typed_array_class(name) && global_object().has_replaceable(name);
        if ty.parts.iter().all(|part| !matches!(part, Part::Global(name, _) if !is_distinguished(strs.get(*name)))) {
            return ty.clone();
        }
        let mut read = Declared { parts: Default::default(), ..ty.clone() };
        for part in &ty.parts {
            match part {
                Part::Global(name, _) if strs.get(*name) == b"Function" || strs.get(*name) == b"CallableFunction" || strs.get(*name) == b"NewableFunction" => read.any_function = true,
                Part::Global(name, _) if !is_distinguished(strs.get(*name)) => (read.any_object, read.any_function) = (true, true),
                part => read.parts.push(part.clone()),
            }
        }
        if read.any_object {
            read.parts.clear();
        }
        read
    }

    fn judge(&self, why: Option<CoerceReason>, sure: &Declared, likely: &Declared, to: &Declared) -> Verdict {
        if sure.is_never() || likely.is_never() {
            return Verdict::Fine;
        }
        let (sure, likely, to) = (&self.as_engine_type(sure), &self.as_engine_type(likely), &self.as_engine_type(to));
        match why {
            Some(CoerceReason::NonNull(_)) => {
                if likely.prims & prim::NULLISH == 0 {
                    Verdict::Fine
                } else if sure.prims & !prim::NULLISH == 0 && sure.ints.is_none() && !sure.has_objects() {
                    Verdict::Wrong
                } else {
                    Verdict::Unknown
                }
            }
            Some(CoerceReason::Coerce | CoerceReason::CoerceFreshGraph) => {
                let (wanted, takes_objects) = (kinds_of(to), to.has_objects());
                let is_fine = |have: &Declared| kinds_of(have) & !wanted == 0 || kinds_of(have) == 0;
                if is_fine(likely) && (takes_objects || !likely.has_objects()) {
                    Verdict::Fine
                } else if kinds_of(sure) != 0 && kinds_of(sure) & wanted == 0 && !sure.has_objects() && sure.prims & prim::NULLISH == 0 {
                    Verdict::Wrong
                } else {
                    Verdict::Unknown
                }
            }
            _ => {
                let may_allocate_another = matches!(why, Some(CoerceReason::Cast | CoerceReason::CastFresh | CoerceReason::Flow));
                if self.is_contained_in(likely, to) {
                    Verdict::Fine
                } else if are_disjoint(sure, to) || !may_allocate_another && are_disjoint(&Declared { parts: Default::default(), any_object: false, any_function: false, ..sure.clone() }, to) && self.objects_are_disjoint(sure, to) {
                    Verdict::Wrong
                } else {
                    Verdict::Unknown
                }
            }
        }
    }

    fn uses_by_block(&self, func: &Func) -> FxHashMap<V, (Kind, Use)> {
        let program = self.flow.program;
        let mut uses: FxHashMap<V, (Kind, Use)> = FxHashMap::default();
        for block in &func.blocks {
            for &v in &block.ops {
                match func.op(v) {
                    Some(Op::CallDirect { func: called, args }) => {
                        let ahead = args.len().saturating_sub(program.funcs[called.idx()].params.len());
                        for (number, &argument) in args.iter().enumerate().skip(ahead) {
                            uses.entry(argument).or_insert((Kind::Argument, Use::ArgumentOf((number - ahead) as u32, *called)));
                        }
                    }
                    Some(Op::Call { args, .. } | Op::CallMethod { args, .. } | Op::Construct { args, .. }) => {
                        for &argument in args {
                            uses.entry(argument).or_insert((Kind::Argument, Use::Annotation));
                        }
                    }
                    Some(&Op::PropSet { name, value, .. }) => {
                        uses.entry(value).or_insert((Kind::Field, Use::Property(name)));
                    }
                    Some(&Op::ElemSet { value, .. }) => {
                        uses.entry(value).or_insert((Kind::Field, Use::Element));
                    }
                    Some(Op::Operation { which: Operation::Initialize, args }) => {
                        for &argument in args {
                            uses.entry(argument).or_insert((Kind::Field, Use::SomeProperty));
                        }
                    }
                    Some(&Op::FieldSet { layout, field, value, .. }) => {
                        let into = &program.layouts[layout.idx()];
                        let kind = if into.kind == LayoutKind::Environment { Kind::Variable } else { Kind::Field };
                        uses.entry(value).or_insert((kind, Use::Named(into.fields[field as usize].name)));
                    }
                    Some(&Op::GlobalSet(global, value)) => {
                        uses.entry(value).or_insert_with(|| (Kind::Variable, Use::Named(program.globals[global.idx()].name)));
                    }
                    _ => {}
                }
            }
            if let Some(&Term::Return(value)) = block.term.as_ref() {
                uses.entry(value).or_insert((Kind::Return, Use::Returned));
            }
        }
        uses
    }

    fn entrypoint_target_parameter(&self, entry: FuncId, number: u32) -> Option<TyId> {
        let program = self.flow.program;
        let behind = program.funcs[entry.idx()].values.iter().filter(|_| program.funcs[entry.idx()].has(func_flags::IS_GENERIC_ENTRYPOINT)).find_map(|value| match &value.def {
            Def::Op(Op::CallDirect { func: typed, .. }) => Some(*typed),
            _ => None,
        })?;
        program.declared_parameter_types.get(&(behind.idx() as u32)).unwrap_or_else(|| &program.funcs[behind.idx()].params).get(number as usize).copied().filter(|&written| self.flow.is_informative(written))
    }

    fn use_text(&self, func: &Func, used: Use) -> String {
        let program = self.flow.program;
        let text = |name: StrId| if name.is_some() { bstr::BStr::new(program.strs.get(name)).to_string() } else { String::new() };
        match used {
            Use::ArgumentOf(number, called) => format!("argument {} of {}", number + 1, self.name_of_function(&program.funcs[called.idx()])),
            Use::Annotation => "the annotation".to_owned(),
            Use::Property(name) => format!("the property `{}`", text(name)),
            Use::Element => "an element".to_owned(),
            Use::SomeProperty => "a property".to_owned(),
            Use::Named(name) => format!("`{}`", text(name)),
            Use::Returned => format!("what {} returns", self.name_of_function(func)),
            Use::Unseen => String::new(),
        }
    }

    fn is_dropped(&mut self, func: &Func, pos: u32, kind: Kind, verdict: Verdict) -> bool {
        if verdict == Verdict::Wrong || self.flow.is_whole && verdict != Verdict::Fine {
            return false;
        }
        self.passing_sites.insert((func.module.0, pos, kind));
        if verdict == Verdict::Fine {
            *self.fine.entry(kind).or_default() += 1;
        }
        true
    }

    fn add(&mut self, func: &Func, pos: u32, kind: Kind, verdict: Verdict, expected: String, found: String, detail: String, origin: u32) {
        let judged = verdict;
        let verdict = if origin & CONTEXTUAL != 0 || self.flow.used_narrowing || self.is_guarded_by_test || !self.is_must_execute && matches!(kind, Kind::BuiltinWrite | Kind::PrototypeWrite | Kind::Mutation) { verdict.min(Verdict::Unknown) } else { verdict };
        let origin = self.origin_through_call(origin & !CONTEXTUAL);
        if verdict != Verdict::Wrong {
            self.passing_sites.insert((func.module.0, pos, kind));
        }
        if verdict == Verdict::Fine {
            *self.fine.entry(kind).or_default() += 1;
            (self.name, self.value, self.risk, self.call, self.is_at_entrypoint) = (None, String::new(), "", None, false);
            (self.ordinal, self.handed_over) = (None, None);
            return;
        }
        let tier = match self.tier_of(kind, origin) {
            Tier::Assertion if self.name == Some("as-refuse") && !matches!(origin.checked_sub(1).and_then(|node| self.locate(node)), Some((of, cast)) if matches!(self.flow.program.funcs[of].op(cast), Some(Op::Coerce { .. }))) => Tier::Typed,
            Tier::Typed if judged == Verdict::Wrong || kind == Kind::Integer => Tier::Assertion,
            Tier::Typed if self.name == Some("construct-new-target") => Tier::Rule,
            Tier::Typed if self.is_deferred_cast(func) => Tier::Assertion,
            Tier::Typed if origin == 0 && (kind == Kind::Argument && found == "any" || matches!(func.op(self.at), Some(&Op::Coerce { value, .. }) if !self.flow.is_informative(func.ty(value)))) => Tier::Outside,
            tier => tier,
        };
        let detail = match (judged, detail.is_empty()) {
            (Verdict::Wrong, true) if verdict != Verdict::Wrong => "it always fails if this line runs".to_owned(),
            (Verdict::Wrong, false) if verdict != Verdict::Wrong => format!("{detail}: it always fails if this line runs"),
            _ => detail,
        };
        let (source_kind, external_source) = self.external_source_of(origin);
        let is_after_cast = self.handed_over.is_none() && matches!(origin.checked_sub(1).and_then(|node| self.locate(node)), Some((of, cast)) if matches!(self.flow.program.funcs[of].op(cast), Some(Op::Coerce { .. })));
        let is_after_cast = is_after_cast || tier == Tier::Assertion && self.is_deferred_cast(func);
        let external_source = if external_source.is_empty() && tier == Tier::Outside && func.module.is_some() { format!("values typed `any` in {}", bstr::BStr::new(self.flow.program.strs.get(self.flow.program.modules[func.module.idx()].display_path))) } else { external_source };
        let ordinal = self.ordinal.take();
        let origin = self.handed_over.take().or_else(|| self.origin(origin));
        let what = match if ordinal.is_some() { None } else { func.op(self.at) } {
            Some(Op::Coerce { why, .. }) => match why {
                CoerceReason::Store => "Store",
                CoerceReason::Cast | CoerceReason::CastFresh => "As",
                CoerceReason::NonNull(_) => "NonNull",
                CoerceReason::Claim => "Claim",
                CoerceReason::ArgumentClaim(_) => "As",
                CoerceReason::Flow => "Flow",
                CoerceReason::Upcast | CoerceReason::Forced => "Upcast",
                CoerceReason::Coerce | CoerceReason::CoerceFreshGraph => "Coerce",
            }
            .to_owned(),
            Some(_) => format!("{:?}", crate::format::record(&func.values[self.at.idx()].def).opcode),
            None if ordinal.is_some() => "Claim".to_owned(),
            None => String::new(),
        };
        let function = if func.kind == FuncKind::Module {
            "module".to_owned()
        } else if func.name.is_some() && !self.flow.program.strs.get(func.name).is_empty() {
            bstr::BStr::new(self.flow.program.strs.get(func.name)).to_string()
        } else {
            "<anonymous>".to_owned()
        };
        let (name, value) = (self.name.take().unwrap_or_else(|| kind.name()), std::mem::take(&mut self.value));
        let risk = std::mem::take(&mut self.risk);
        let call = self.call.take();
        let is_at_entrypoint = std::mem::take(&mut self.is_at_entrypoint);
        self.sites.push(Site { ordinal, is_in_untyped_code: !func.has(func_flags::IS_TYPED), is_at_entrypoint, call, risk, external_source, source_kind, is_after_cast, name, what, function, value, tier, module: func.module.0, pos, kind, verdict, expected, found, detail, origin });
    }

    fn analyze(&mut self, index: usize, reached: &[Option<Facts>], keys: &mut Keys) {
        let program = self.flow.program;
        let func = &program.funcs[index];
        let mut uses: Option<FxHashMap<V, (Kind, Use)>> = None;
        let mut calls: FxHashMap<V, (u32, u32)> = FxHashMap::default();
        for value in func.values.iter().filter(|_| self.flow.is_whole) {
            if let Def::Op(Op::CallDirect { func: called, args }) = &value.def {
                let ahead = args.len().saturating_sub(program.funcs[called.idx()].params.len());
                for (place, &argument) in args.iter().enumerate().skip(ahead) {
                    calls.entry(argument).or_insert((value.pos, (place - ahead) as u32));
                }
            }
        }
        let held = if self.flow.is_whole { find_stored_values(func) } else { Vec::new() };
        let mut is_always_run = vec![false; func.blocks.len()];
        for at in must_execute_blocks(self.flow.noreturn, func, Some(reached)) {
            is_always_run[at] = true;
        }
        for (at, block) in func.blocks.iter().enumerate() {
            let Some(facts) = &reached[at] else { continue };
            self.is_guarded_by_test = !is_always_run[at];
            if self.is_guarded_by_test && !self.flow.is_whole {
                continue;
            }
            for (place, &v) in block.ops.iter().enumerate() {
                let pos = func.values[v.idx()].pos;
                if pos == 0 {
                    continue;
                }
                let Some(op) = func.op(v) else { continue };
                if place > 0 && !call_returns(self.flow.noreturn, func, block.ops[place - 1]) {
                    break;
                }
                self.at = v;
                self.flow.used_narrowing = false;
                'checks: {
                match op {
                    &Op::Coerce { value, to, why: CoerceReason::ArgumentClaim(number) } => {
                        let wanted = self.flow.get(to).clone();
                        (self.ordinal, self.name, self.is_at_entrypoint) = (Some(u32::from(number)), Some("enter-argument"), true);
                        self.risk = "primitive";
                        let origin = self.flow.origin_of(index, value);
                        self.add(func, pos, Kind::Argument, Verdict::Unknown, text_of(program, &wanted, 0), "any".to_owned(), format!("argument {}: a string, a number or another primitive", u32::from(number) + 1), origin);
                    }
                    &Op::Coerce { value, to, why } if !matches!(why, CoerceReason::Upcast | CoerceReason::Forced) => {
                        if !func.has(func_flags::IS_TYPED) && matches!(why, CoerceReason::Flow | CoerceReason::Store | CoerceReason::Claim) {
                            break 'checks;
                        }
                        if why == CoerceReason::NonNull(StrId::NONE) && is_lazy_variable_read(program, func, value) {
                            break 'checks;
                        }
                        let sure = self.flow.val(index, func, facts, keys, value, false);
                        let likely = self.flow.val(index, func, facts, keys, value, true);
                        let wanted = if matches!(why, CoerceReason::Coerce | CoerceReason::CoerceFreshGraph) { to } else { self.flow.declared(func, v) };
                        let (sure, likely, wanted) = (self.flow.get(sure).clone(), self.flow.get(likely).clone(), self.flow.get(wanted).clone());
                        let mut verdict = self.judge(Some(why), &sure, &likely, &wanted);
                        let accepts_integers_only = wanted.ints.is_some() && wanted.prims & prim::NUMBER == 0;
                        if accepts_integers_only
                            && !matches!(why, CoerceReason::Coerce | CoerceReason::CoerceFreshGraph | CoerceReason::NonNull(_))
                            && let (Some(number), Some((minimum, maximum))) = (self.double(func, value), wanted.ints)
                        {
                            let is_within = number.fract() == 0.0 && number >= minimum as f64 && number <= maximum as f64 && !(number == 0.0 && number.is_sign_negative());
                            verdict = if is_within { Verdict::Fine } else { Verdict::Wrong };
                        }
                        if verdict != Verdict::Fine && !matches!(why, CoerceReason::Coerce | CoerceReason::CoerceFreshGraph) {
                            let without_nullish = Declared { prims: likely.prims & !prim::NULLISH, ..likely.clone() };
                            if (matches!(why, CoerceReason::NonNull(_)) || self.is_contained_in(&without_nullish, &wanted)) && is_dereferenced_next(func, at, place, v) {
                                self.always_throws += 1;
                                self.passing_sites.insert((func.module.0, pos, if matches!(why, CoerceReason::NonNull(_)) { Kind::NonNull } else { Kind::Narrowing }));
                                break 'checks;
                            }
                        }
                        let (kind, used) = match why {
                            CoerceReason::Coerce | CoerceReason::CoerceFreshGraph => (Kind::As, Use::Unseen),
                            CoerceReason::NonNull(_) => (Kind::NonNull, Use::Unseen),
                            CoerceReason::Flow => (Kind::Narrowing, Use::Unseen),
                            CoerceReason::Claim => (
                                match func.op(strip_casts(func, value)) {
                                    Some(Op::ElemGet { .. } | Op::IterGet { .. }) => Kind::Element,
                                    Some(Op::PropGet { .. }) => Kind::Read,
                                    Some(Op::Await(_)) => Kind::Await,
                                    Some(Op::Coerce { why: CoerceReason::Coerce | CoerceReason::CoerceFreshGraph, .. }) => Kind::As,
                                    _ => Kind::Result,
                                },
                                Use::Unseen,
                            ),
                            _ => {
                                if uses.is_none() {
                                    uses = Some(self.uses_by_block(func));
                                }
                                uses.as_ref().and_then(|uses| uses.get(&v)).copied().unwrap_or((Kind::Variable, Use::Unseen))
                            }
                        };
                        let kind = if accepts_integers_only && matches!(why, CoerceReason::Cast | CoerceReason::CastFresh | CoerceReason::Store) { Kind::Integer } else { kind };
                        let holds_a_copy = self.flow.is_whole && why == CoerceReason::Cast && may_hold_untyped_object(program, self.flow.get(self.flow.declared(func, value))) && likely.has_objects() && mentions_record(program, &wanted, 0) && is_stored_elsewhere(func, &held, value);
                        if !holds_a_copy && self.is_dropped(func, pos, kind, verdict) {
                            break 'checks;
                        }
                        let detail = match (why, kind) {
                            (CoerceReason::NonNull(text), _) if text.is_some() => format!("`{}!`", bstr::BStr::new(program.strs.get(text))),
                            (CoerceReason::Claim, Kind::As) => "a value that the cast let through is used as the type of the cast".to_owned(),
                            _ => self.use_text(func, used),
                        };
                        self.value = self.constant(func, value).unwrap_or_default();
                        let found = text_of(program, &sure, 0);
                        let origin = self.flow.origin_of(index, value);
                        self.name = match (kind, why) {
                            (Kind::As, CoerceReason::Claim) => Some("as-late-use"),
                            (Kind::As, _) if wanted.has_objects() && kinds_of(&wanted) == 0 => Some("as-refuse"),
                            (Kind::Element, _) if matches!(func.op(strip_casts(func, value)), Some(Op::IterGet { .. })) => Some("iterate-value"),
                            _ => None,
                        };
                        self.risk = self.risk_of(&wanted);
                        self.call = calls.get(&v).copied().filter(|call| call.0 != 0);
                        let next_claim = func.blocks.iter().flat_map(|block| &block.ops).filter(|_| self.logs_type_errors && why == CoerceReason::Cast).find_map(|&later| match func.op(later) {
                            Some(&Op::Coerce { value: held, to: claimed, why: CoerceReason::ArgumentClaim(_) }) if held == v => Some(claimed),
                            _ => None,
                        });
                        let expected = match (next_claim, used) {
                            (Some(claimed), _) => text_of(program, program.tys.get(claimed), 0),
                            (None, Use::ArgumentOf(number, called)) if self.logs_type_errors => self.entrypoint_target_parameter(called, number).map_or_else(|| text_of(program, &wanted, 0), |written| text_of(program, program.tys.get(written), 0)),
                            _ => text_of(program, &wanted, 0),
                        };
                        self.add(func, pos, kind, verdict, expected.clone(), found, detail, origin);
                        if holds_a_copy {
                            self.add(func, pos, Kind::Copy, Verdict::Unknown, expected, "untyped object".to_owned(), "an object from untyped code may be copied here: writes go to the copy, and `===` with the original is false".to_owned(), origin);
                        }
                    }
                    Op::PropGet { .. } | Op::ElemGet { .. } | Op::IterGet { .. } | Op::Call { .. } | Op::CallMethod { .. } | Op::Construct { .. } | Op::Await(_) | Op::Operation { .. } if self.flow.is_informative(func.ty(v)) => {
                        if !func.has(func_flags::IS_TYPED) {
                            break 'checks;
                        }
                        let wanted = self.flow.get(func.ty(v)).clone();
                        let (kind, have) = match self.flow.provenance(index, func, facts, keys, v) {
                            Provenance::Trusted => break 'checks,
                            Provenance::Is(ty) => (
                                match op {
                                    Op::PropGet { .. } => Kind::Read,
                                    Op::ElemGet { .. } | Op::IterGet { .. } => Kind::Element,
                                    Op::Await(_) => Kind::Await,
                                    _ => Kind::Result,
                                },
                                ty,
                            ),
                            Provenance::Unknown(kind) => (kind, self.flow.tys.anything),
                        };
                        let have = self.flow.get(have).clone();
                        let verdict = self.judge(None, &have, &have, &wanted);
                        let origin = self.flow.origin_of(index, v);
                        self.name = matches!(op, Op::IterGet { .. }).then_some("iterate-value");
                        self.risk = self.risk_of(&wanted);
                        self.call = calls.get(&v).copied().filter(|call| call.0 != 0);
                        self.add(func, pos, kind, verdict, text_of(program, &wanted, 0), text_of(program, &have, 0), String::new(), origin);
                    }
                    &Op::Binary { op, a, b } if func.has(func_flags::IS_TYPED) && self.flow.is_informative(func.ty(v)) => {
                        let (x, y) = (self.flow.val(index, func, facts, keys, a, false), self.flow.val(index, func, facts, keys, b, false));
                        let computed = self.flow.arithmetic(op, x, y);
                        let (computed, wanted) = (self.flow.get(computed).clone(), self.flow.get(func.ty(v)).clone());
                        let verdict = self.judge(None, &computed, &computed, &wanted);
                        if verdict == Verdict::Wrong || verdict == Verdict::Unknown && (self.flow.origin_of(index, a) & !CONTEXTUAL != 0 || self.flow.origin_of(index, b) & !CONTEXTUAL != 0) && wanted.ints.is_none() {
                            let origin = if self.flow.origin_of(index, a) & !CONTEXTUAL != 0 { self.flow.origin_of(index, a) } else { self.flow.origin_of(index, b) };
                            self.add(func, pos, Kind::Arithmetic, verdict, text_of(program, &wanted, 0), text_of(program, &computed, 0), String::new(), origin);
                        }
                    }
                    _ => {}
                }
                }
                match op {
                    &Op::PropSet { obj, name, value } => self.check_store(index, func, facts, keys, pos, obj, Some(name), Some(value)),
                    &Op::PropDelete { obj, name } => self.check_store(index, func, facts, keys, pos, obj, Some(name), None),
                    &Op::FreeSet { name, value } if global_object().rejects_change(program.strs.get(name), Change::Assign) && !self.is_current_value(index, global_object(), program.strs.get(name), value) => {
                        let shown = bstr::BStr::new(program.strs.get(name)).to_string();
                        self.name = Some("global-binding-write");
                        self.add(func, pos, Kind::BuiltinWrite, Verdict::Wrong, String::new(), String::new(), format!("`{shown}` cannot be replaced"), 0);
                    }
                    Op::CallMethod { obj, name, args } => {
                        self.check_reflection(index, func, facts, keys, pos, *obj, *name, args);
                        self.check_call(index, func, facts, keys, pos, v, Some(*obj), args);
                    }
                    Op::Call { callee, args, .. } => {
                        let receiver = match func.op(strip_casts(func, *callee)) {
                            Some(&Op::PropGet { obj, name }) => {
                                self.check_reflection(index, func, facts, keys, pos, obj, name, args);
                                Some(obj)
                            }
                            Some(&Op::FreeGet { name, .. }) if self.flow.is_locked(name) => Some(*callee),
                            _ => None,
                        };
                        self.check_call(index, func, facts, keys, pos, v, receiver, args);
                    }
                    Op::Construct { callee, args } => self.check_call(index, func, facts, keys, pos, v, self.flow.is_trusted_holder(index, *callee).then_some(*callee), args),
                    Op::CallDirect { func: called, args } => {
                        let callee = &program.funcs[called.idx()];
                        if !callee.has(func_flags::IS_TYPED | func_flags::IS_BUILTIN | func_flags::IS_IN_BUILTIN_MODULE) {
                            let into = self.name_of_function(callee);
                            self.check_passed_functions(index, func, pos, args, &format!("{into}, which is untyped"));
                        }
                        if callee.has(func_flags::IS_TYPED) && !callee.has(func_flags::IS_BUILTIN | func_flags::IS_IN_BUILTIN_MODULE) {
                            let ahead = args.len().saturating_sub(callee.params.len());
                            let blind: Vec<usize> = (args.iter().skip(ahead).zip(&callee.params).enumerate()).filter(|(_, (argument, parameter))| self.flow.is_informative(**parameter) && !self.flow.is_informative(func.ty(**argument))).map(|(number, _)| number).collect();
                            if !blind.is_empty() {
                                self.add_function_parameters(*called, &blind, (func.module.0, pos, "this call, which passes `any`".to_owned()));
                            }
                            let escaping: Vec<V> = args.iter().skip(ahead).zip(&callee.params).filter(|(_, parameter)| !self.flow.is_informative(**parameter)).map(|(&argument, _)| argument).collect();
                            let into = self.name_of_function(callee);
                            self.check_passed_functions(index, func, pos, &escaping, &format!("{into}, which takes it as `any` or `unknown`"));
                        }
                        let after_entry = callee.values.iter().filter(|_| callee.has(func_flags::IS_GENERIC_ENTRYPOINT)).find_map(|value| match &value.def {
                            Def::Op(Op::CallDirect { func: typed, .. }) => Some(*typed),
                            _ => None,
                        });
                        if let Some(behind) = after_entry {
                            let typed = &program.funcs[behind.idx()];
                            let written = program.declared_parameter_types.get(&(behind.idx() as u32)).unwrap_or(&typed.params);
                            let named = self.name_of_function(typed);
                            let ahead = args.len().saturating_sub(callee.params.len());
                            for (number, (&argument, &parameter)) in args.iter().skip(ahead).zip(&typed.params).enumerate() {
                                if !self.flow.is_informative(parameter) || self.flow.is_informative(func.ty(argument)) {
                                    continue;
                                }
                                let wanted = program.tys.get(parameter).clone();
                                (self.ordinal, self.name, self.is_at_entrypoint) = (Some(number as u32), Some("enter-argument"), true);
                                self.risk = self.risk_of(&wanted);
                                let origin = self.flow.origin_of(index, argument);
                                self.add(func, pos, Kind::Argument, Verdict::Unknown, text_of(program, program.tys.get(written[number]), 0), "any".to_owned(), format!("argument {} of {named}", number + 1), origin);
                            }
                        }
                    }
                    &Op::ElemSet { obj, key, value } if self.flow.builtin_holder(index, obj).is_some() => {
                        let named = self.flow.constant_key(index, func, key);
                        self.check_builtin_mutation(index, func, facts, keys, pos, obj, named.as_deref(), Change::Assign, Some(value));
                    }
                    &Op::ElemDelete { obj, key } if self.flow.builtin_holder(index, obj).is_some() => {
                        let named = self.flow.constant_key(index, func, key);
                        self.check_builtin_mutation(index, func, facts, keys, pos, obj, named.as_deref(), Change::Delete, None);
                    }
                    &Op::ElemSet { obj, key, .. } => {
                        let is_iterator = matches!(func.op(strip_casts(func, key)), Some(&Op::PropGet { obj: holder, name }) if program.strs.get(name) == b"iterator" && self.flow.refers_to_global(func, holder, b"Symbol"));
                        let receiver = self.flow.val(index, func, facts, keys, obj, false);
                        if is_iterator && self.flow.get(receiver).parts.iter().any(|part| matches!(part, Part::Array(_))) {
                            self.name = Some("array-not-plain");
                            self.add(func, pos, Kind::Mutation, Verdict::Unknown, String::new(), String::new(), "an array gets its own iterator: a loop over it as `T[]` throws".to_owned(), 0);
                        }
                    }
                    _ => {}
                }
            }
        }
    }

    fn is_current_value(&self, index: usize, holder: &'static Builtin, name: &[u8], value: V) -> bool {
        match self.flow.identity_of(index, value) {
            Some(Identity::Builtin(stored)) => holder.object_at(name).is_some_and(|there| there.index() == stored),
            Some(Identity::BuiltinMember(of, member)) => of == holder.index() && self.flow.program.strs.get(member) == name,
            _ => false,
        }
    }

    fn builtin_rejection(holder: &'static Builtin, name: Option<&[u8]>, change: Change) -> Option<(&'static str, String, String)> {
        let kind = if holder.is_global_object() {
            "global-binding-write"
        } else if holder.is_extensible {
            "builtin-member-replace"
        } else {
            "builtin-prototype-write"
        };
        let Some(name) = name else {
            return (change == Change::Assign && !holder.is_extensible).then(|| (kind, format!("a property of `{}`", holder.name), "built-in prototypes are frozen".to_owned()));
        };
        if !holder.rejects_change(name, change) {
            return None;
        }
        let shown = if holder.is_global_object() { format!("`globalThis.{}`", bstr::BStr::new(name)) } else { bstr::BStr::new(&locked_builtins::shown(holder, name)).to_string() };
        let why = match holder.would_shadow(name, change) {
            _ if !holder.is_extensible => "built-in prototypes are frozen".to_owned(),
            Some(inherited) => format!("it would hide {}, and built-ins cannot be replaced", bstr::BStr::new(&locked_builtins::shown(inherited, name))),
            None => "built-ins cannot be replaced".to_owned(),
        };
        Some((kind, shown, why))
    }

    fn check_builtin_mutation(&mut self, index: usize, func: &Func, facts: &Facts, keys: &mut Keys, pos: u32, obj: V, name: Option<&[u8]>, change: Change, value: Option<V>) {
        let Some(holder) = self.flow.builtin_holder(index, obj) else { return };
        let context = self.flow.origin_of(index, obj) & CONTEXTUAL;
        let verb = if change == Change::Delete { "deleted" } else { "assigned" };
        if let (Some(b"__proto__"), Change::Assign, Some(value)) = (name, change, value) {
            let stored = self.flow.val(index, func, facts, keys, value, false);
            let stored = self.flow.get(stored).clone();
            let is_unchanged = matches!(self.flow.identity_of(index, value), Some(Identity::Builtin(stored)) if Builtin::at(stored).name == holder.inherits);
            if !holder.has_immutable_prototype() || is_unchanged || stored.is_never() || !stored.has_objects() && stored.prims & prim::NULL == 0 {
                return;
            }
            let verdict = if stored.prims & !prim::NULL == 0 && stored.ints.is_none() { Verdict::Wrong } else { Verdict::Unknown };
            self.name = Some(if holder.is_extensible { "builtin-member-replace" } else { "builtin-prototype-write" });
            return self.add(func, pos, Kind::BuiltinWrite, verdict, String::new(), String::new(), format!("`{}.__proto__` is assigned: built-in objects keep their prototype", holder.name), context);
        }
        let Some((kind, shown, why)) = Self::builtin_rejection(holder, name, change) else { return };
        if let (Some(name), Some(value)) = (name, value)
            && self.is_current_value(index, holder, name, value)
        {
            return;
        }
        self.name = Some(kind);
        self.add(func, pos, Kind::BuiltinWrite, Verdict::Wrong, String::new(), String::new(), format!("{shown} is {verb}: {why}"), context);
    }

    fn literal_keys(&self, func: &Func, literal: V) -> Option<Vec<Vec<u8>>> {
        let program = self.flow.program;
        let literal = strip_casts(func, literal);
        if !matches!(func.op(literal), Some(Op::NewObject)) {
            return None;
        }
        Some(func.values.iter().filter_map(|value| match &value.def {
            Def::Op(Op::Operation { which: Operation::DefineField, args }) if args.first() == Some(&literal) => match func.op(strip_casts(func, *args.get(1)?)) {
                Some(&Op::Str(key)) => Some(program.strs.get(key).to_vec()),
                _ => None,
            },
            _ => None,
        }).collect())
    }

    fn check_store(&mut self, index: usize, func: &Func, facts: &Facts, keys: &mut Keys, pos: u32, obj: V, name: Option<StrId>, value: Option<V>) {
        let program = self.flow.program;
        let context = self.flow.origin_of(index, obj) & CONTEXTUAL;
        let shown = name.map_or_else(String::new, |name| bstr::BStr::new(program.strs.get(name)).to_string());
        let verb = if value.is_some() { "assigned" } else { "deleted" };
        if let (Some(name), Some(value)) = (name, value) {
            let static_setter = self.find_static_member(index, obj, name, MethodKind::Setter);
            let known = self.flow.val(index, func, facts, keys, obj, false);
            let known = self.flow.get(known).clone();
            for setter in self.find_members(func, obj, &known, name, MethodKind::Setter).into_iter().chain(static_setter) {
                self.add_parameters_receiving_untyped(func, pos, setter, &[value], "this assignment");
            }
        }
        if let (Some(name), Some(value), Some(Identity::Function(constructor))) = (name, value, self.flow.identity_of(index, obj)) {
            let mut at = self.class_of.get(&constructor).copied().unwrap_or(LayoutId::NONE);
            while at.is_some() {
                let class = &program.layouts[at.idx()];
                if let Some(&(_, declared)) = class.static_fields.iter().find(|field| field.0 == name && self.flow.is_informative(field.1)) {
                    let stored = self.flow.val(index, func, facts, keys, value, false);
                    let (stored, wanted) = (self.flow.get(stored).clone(), self.flow.get(declared).clone());
                    let verdict = self.judge(None, &stored, &stored, &wanted);
                    let (found, origin, named) = (text_of(program, &stored, 0), self.flow.origin_of(index, value), self.name_of_function(&program.funcs[constructor.idx()]));
                    self.name = Some("class-static-write");
                    self.add(func, pos, Kind::Mutation, verdict, text_of(program, &wanted, 0), found, format!("the static property `{shown}` of the class {named} is assigned"), origin | context);
                    break;
                }
                at = class.base;
            }
        }
        if self.flow.builtin_holder(index, obj).is_some() {
            return self.check_builtin_mutation(index, func, facts, keys, pos, obj, name.map(|name| program.strs.get(name)), if value.is_some() { Change::Assign } else { Change::Delete }, value);
        }
        if let Some(owner) = self.function_for_value(index, func, obj)
            && program.funcs[owner.idx()].has(func_flags::GENERATOR)
            && shown == "prototype"
        {
            let owner = self.name_of_function(&program.funcs[owner.idx()]);
            self.name = Some("generator-prototype-write");
            return self.add(func, pos, Kind::PrototypeWrite, Verdict::Wrong, String::new(), String::new(), format!("`prototype` of the generator function {owner} is {verb}: it is fixed when the program is compiled"), context);
        }
        if let Some(owner) = self.prototype_owner(index, obj) {
            let (created, named) = (&program.funcs[owner.idx()], self.name_of_function(&program.funcs[owner.idx()]));
            if created.has(func_flags::GENERATOR) {
                self.name = Some("generator-prototype-write");
                return self.add(func, pos, Kind::PrototypeWrite, Verdict::Wrong, String::new(), String::new(), format!("`{shown}` is {verb} on the prototype of the generator function {named}, which is frozen"), context);
            }
            if let (Some(&class), Some(name)) = (self.class_of.get(&owner), name)
                && program.layouts[class.idx()].class_flags & (class_flags::HAS_FIXED_LAYOUT | class_flags::PROTOTYPE_MAY_GAIN_MEMBERS) == class_flags::HAS_FIXED_LAYOUT
                && !self.declares_member(class, name)
                && !(program.strs.get(name) == b"constructor" && program.layouts[class.idx()].class_flags & class_flags::CONSTRUCTOR_MAY_BE_REPLACED != 0)
            {
                self.add(func, pos, Kind::PrototypeWrite, Verdict::Wrong, String::new(), String::new(), format!("`{shown}` is {verb} on the prototype of the class {named}, which does not declare it: members cannot be added to class prototypes"), context);
            }
            return;
        }
        let written_as = self.flow.get(self.flow.declared(func, obj)).clone();
        if !written_as.any_object {
            if let (Some(name), Some(value)) = (name, value) {
                self.check_store_through_supertype(index, func, facts, keys, pos, &written_as, name, value);
            }
            return;
        }
        let receiver = self.flow.val(index, func, facts, keys, obj, false);
        let receiver = self.flow.get(receiver).clone();
        let is_this = func.has(func_flags::HAS_THIS) && func.blocks.first().and_then(|entry| entry.params.get(func.captures.len())) == Some(&strip_casts(func, obj));
        let receiver = match self.untyped_clone_class.get(&FuncId::new(index)) {
            Some(&class) if is_this && (receiver.any_object || receiver.parts.is_empty()) => Declared::part(Part::Class(class)),
            _ => receiver,
        };
        if receiver.any_object || receiver.parts.is_empty() {
            return;
        }
        let Some(name) = name else { return };
        for part in &receiver.parts {
            let &Part::Class(layout) = part else { continue };
            if layout.is_none() {
                continue;
            }
            let allocated_as = &program.layouts[layout.idx()];
            let Some(field) = allocated_as.field(name) else { continue };
            let field = &allocated_as.fields[field as usize];
            let owner = text_of(program, &Declared::part(Part::Class(layout)), context);
            let is_only = receiver.parts.len() == 1 && receiver.prims == 0;
            match value {
                None if field.flags & field_flags::OPTIONAL == 0 => {
                    let verdict = if is_only && !allocated_as.accepts_untyped { Verdict::Wrong } else { Verdict::Unknown };
                    self.name = Some("field-delete");
                    self.add(func, pos, Kind::Mutation, verdict, String::new(), String::new(), format!("`{shown}` of {owner} is deleted through `any`: only optional properties can be deleted"), context);
                }
                Some(value) if field.declared.is_some() => {
                    let stored = self.flow.val(index, func, facts, keys, value, false);
                    let (stored, wanted) = (self.flow.get(stored).clone(), self.flow.get(field.declared).clone());
                    let verdict = match self.judge(None, &stored, &stored, &wanted) {
                        Verdict::Wrong if !is_only || allocated_as.accepts_untyped => Verdict::Unknown,
                        verdict => verdict,
                    };
                    self.value = self.constant(func, value).unwrap_or_default();
                    let found = text_of(program, &stored, 0);
                    let origin = self.flow.origin_of(index, value);
                    self.add(func, pos, Kind::Mutation, verdict, text_of(program, &wanted, 0), found, format!("`{shown}` of {owner} is assigned through `any`"), origin | context);
                }
                _ => {}
            }
        }
    }

    fn check_store_through_supertype(&mut self, index: usize, func: &Func, facts: &Facts, keys: &mut Keys, pos: u32, written_as: &Declared, name: StrId, value: V) {
        let program = self.flow.program;
        if !func.has(func_flags::IS_TYPED) {
            return;
        }
        for part in &written_as.parts {
            let &Part::Class(view) = part else { continue };
            if view.is_none() {
                continue;
            }
            let looked_at = &program.layouts[view.idx()];
            let Some(seen) = looked_at.field(name) else { continue };
            let seen = looked_at.fields[seen as usize].declared;
            for &member in looked_at.members.iter().filter(|&&member| member != view) {
                let allocated_as = &program.layouts[member.idx()];
                let Some(held) = allocated_as.field(name) else { continue };
                let held = allocated_as.fields[held as usize].declared;
                if held == seen || held.is_none() {
                    continue;
                }
                let stored = self.flow.val(index, func, facts, keys, value, false);
                let (stored, wanted) = (self.flow.get(stored).clone(), self.flow.get(held).clone());
                let verdict = self.judge(None, &stored, &stored, &wanted).min(Verdict::Unknown);
                if verdict == Verdict::Fine {
                    continue;
                }
                let (shown, through, created) = (bstr::BStr::new(program.strs.get(name)).to_string(), text_of(program, &Declared::part(Part::Class(view)), 0), text_of(program, &Declared::part(Part::Class(member)), 0));
                let found = text_of(program, &stored, 0);
                self.add(func, pos, Kind::Field, verdict, text_of(program, &wanted, 0), found, format!("`{shown}` is stored through {through}, and the object may have been created as {created}, which declares a narrower type for it"), 0);
                return;
            }
        }
    }

    fn function_for_value(&self, index: usize, func: &Func, v: V) -> Option<FuncId> {
        match (self.flow.identity_of(index, v), func.prediction(v)) {
            (Some(Identity::Function(named)), _) | (None, Prediction::Closure(named)) => Some(named),
            _ => match func.op(strip_casts(func, v)) {
                Some(&Op::PropGet { obj, name }) => self.find_static_member(index, obj, name, MethodKind::Method),
                _ => None,
            },
        }
    }

    fn find_static_member(&self, index: usize, obj: V, name: StrId, kind: MethodKind) -> Option<FuncId> {
        let Some(Identity::Function(constructor)) = self.flow.identity_of(index, obj) else { return None };
        let mut at = *self.class_of.get(&constructor)?;
        while at.is_some() {
            let class = &self.flow.program.layouts[at.idx()];
            if let Some(found) = class.methods.iter().find(|method| method.name == name && method.kind == kind && method.flags & method_flags::STATIC != 0) {
                return Some(found.func);
            }
            at = class.base;
        }
        None
    }

    fn prototype_owner(&self, index: usize, v: V) -> Option<FuncId> {
        match self.flow.identity_of(index, v)? {
            Identity::PrototypeOf(named) => Some(named),
            _ => None,
        }
    }

    fn declares_member(&self, class: LayoutId, name: StrId) -> bool {
        let mut at = class;
        while at.is_some() {
            let layout = &self.flow.program.layouts[at.idx()];
            if layout.methods.iter().any(|method| method.name == name && method.flags & method_flags::STATIC == 0) {
                return true;
            }
            at = layout.base;
        }
        false
    }

    fn check_passed_functions(&mut self, index: usize, func: &Func, pos: u32, args: &[V], into: &str) {
        for &argument in args {
            if let Some(handed) = self.function_for_value(index, func, argument) {
                let mut at = self.class_of.get(&handed).copied().unwrap_or(LayoutId::NONE);
                let mut passed_functions: SmallVec<[FuncId; 2]> = SmallVec::from_iter([handed]);
                while at.is_some() {
                    let class = &self.flow.program.layouts[at.idx()];
                    passed_functions.extend(class.methods.iter().filter(|method| method.flags & method_flags::STATIC != 0 && method.kind != MethodKind::Getter).map(|method| method.func));
                    at = class.base;
                }
                for handed in passed_functions {
                    let all: Vec<usize> = (0..self.flow.program.funcs[handed.idx()].params.len()).collect();
                    self.add_function_parameters(handed, &all, (func.module.0, pos, format!("its callers: it is passed to {into}")));
                }
            }
        }
    }

    fn add_function_parameters(&mut self, handed: FuncId, numbers: &[usize], from: (u32, u32, String)) {
        let program = self.flow.program;
        let created = &program.funcs[handed.idx()];
        if !created.has(func_flags::IS_TYPED) || created.module.is_none() {
            return;
        }
        let is_unused = unused_parameters(created);
        let individually = created.params.len() - usize::from(created.has(func_flags::HAS_REST) && !created.params.is_empty());
        let named = self.name_of_function(created);
        let written = program.declared_parameter_types.get(&(handed.idx() as u32)).unwrap_or(&created.params);
        if !self.has_checking_entrypoint[handed.idx()] {
            let checked: Vec<String> = written[..individually].iter().enumerate().filter(|&(number, &parameter)| !is_unused[number] && self.flow.is_informative(parameter)).map(|(_, &parameter)| text_of(program, program.tys.get(parameter), 0)).collect();
            if !checked.is_empty() {
                let ahead = usize::from(created.kind == FuncKind::Constructor && created.has(func_flags::HAS_NEW_TARGET));
                let first = created.params.iter().enumerate().position(|(number, &parameter)| !is_unused[number] && self.flow.is_informative(parameter)).map_or(0, |first| first.saturating_sub(ahead));
                (self.ordinal, self.handed_over) = (Some(if self.logs_type_errors { first as u32 } else { 0 }), Some(from));
                self.add(created, created.pos, Kind::Parameter, Verdict::Unknown, checked.join(", "), "any".to_owned(), format!("the parameters of {named}, which is called as a value or with `any`"), 0);
            }
            return;
        }
        for &number in numbers.iter().filter(|&&number| number < individually) {
            let parameter = created.params[number];
            if is_unused[number] || !self.flow.is_informative(parameter) {
                continue;
            }
            let wanted = program.tys.get(parameter).clone();
            (self.ordinal, self.handed_over) = (Some(number as u32), Some(from.clone()));
            self.risk = self.risk_of(&wanted);
            self.is_at_entrypoint = true;
            self.add(created, created.pos, Kind::Parameter, Verdict::Unknown, text_of(program, program.tys.get(written[number]), 0), "any".to_owned(), format!("parameter {} of {named}, which is called as a value or with `any`", number + 1), 0);
        }
    }

    fn add_parameters_receiving_untyped(&mut self, func: &Func, pos: u32, called: FuncId, handed: &[V], by: &str) {
        let program = self.flow.program;
        let callee = &program.funcs[called.idx()];
        if !callee.has(func_flags::IS_TYPED) || callee.has(func_flags::IS_BUILTIN | func_flags::IS_IN_BUILTIN_MODULE) {
            return;
        }
        let ahead = usize::from(callee.kind == FuncKind::Constructor && callee.has(func_flags::HAS_NEW_TARGET));
        let individually = callee.params.len() - usize::from(callee.has(func_flags::HAS_REST) && !callee.params.is_empty());
        let may_fail = |number: usize, parameter: TyId| {
            let wanted = program.tys.get(parameter);
            match handed.get(number - ahead) {
                None => wanted.prims & prim::UNDEFINED == 0,
                Some(&argument) if !self.flow.is_informative(func.ty(argument)) => true,
                Some(&argument) => {
                    let given = program.tys.get(func.ty(argument));
                    !(given.has_objects() && wanted.has_objects()) && self.judge(None, given, given, wanted) != Verdict::Fine
                }
            }
        };
        let blind: Vec<usize> = (callee.params[..individually].iter().enumerate().skip(ahead)).filter(|&(number, &parameter)| self.flow.is_informative(parameter) && may_fail(number, parameter)).map(|(number, _)| number).collect();
        if blind.is_empty() {
            return;
        }
        self.add_function_parameters(called, &blind, (func.module.0, pos, format!("{by}, which passes `any`")));
    }

    fn find_members(&self, func: &Func, obj: V, known: &Declared, name: StrId, kind: MethodKind) -> SmallVec<[FuncId; 2]> {
        let program = self.flow.program;
        let mut found: SmallVec<[FuncId; 2]> = SmallVec::new();
        let declared = func.ty(obj);
        let declared_parts: &[Part] = if declared.is_some() { &program.tys.get(declared).parts[..] } else { &[] };
        for part in declared_parts.iter().chain(&known.parts) {
            let &Part::Class(view) = part else { continue };
            if view.is_none() {
                continue;
            }
            let looked_at = &program.layouts[view.idx()];
            for &member in looked_at.members.iter().chain(looked_at.members.is_empty().then_some(&view)) {
                let mut at = member;
                while at.is_some() {
                    let class = &program.layouts[at.idx()];
                    if let Some(member) = class.methods.iter().find(|method| method.name == name && method.kind == kind && method.flags & method_flags::STATIC == 0) {
                        if !found.contains(&member.func) {
                            found.push(member.func);
                        }
                        break;
                    }
                    at = class.base;
                }
            }
        }
        found
    }

    fn add_entrypoint_function_parameters(&mut self, logs_type_errors: bool) {
        let program = self.flow.program;
        for index in (0..program.funcs.len()).filter(|&index| if self.has_checking_entrypoint[index] { logs_type_errors } else { program.may_receive_untyped_arguments.contains(&(index as u32)) }) {
            let all: Vec<usize> = (0..program.funcs[index].params.len()).collect();
            self.add_function_parameters(FuncId::new(index), &all, (u32::MAX, 0, String::new()));
        }
    }

    fn always_refuses_argument(&self, called: FuncId, number: usize, given: &Declared) -> bool {
        let callee = &self.flow.program.funcs[called.idx()];
        let individually = callee.params.len() - usize::from(callee.has(func_flags::HAS_REST) && !callee.params.is_empty());
        if !callee.has(func_flags::IS_TYPED) || number >= individually || !self.flow.is_informative(callee.params[number]) {
            return false;
        }
        let wanted = self.flow.get(callee.params[number]);
        !(given.has_objects() && wanted.has_objects()) && self.judge(None, given, given, wanted) == Verdict::Wrong
    }

    fn check_call(&mut self, index: usize, func: &Func, facts: &Facts, keys: &mut Keys, pos: u32, v: V, receiver_of_the_engine: Option<V>, args: &[V]) {
        let program = self.flow.program;
        let Some((found, handed)) = functions_called(program, func, v) else {
            let is_trusted = receiver_of_the_engine.is_some_and(|receiver| {
                let known = self.flow.val(index, func, facts, keys, receiver, false);
                self.flow.is_trusted_holder(index, receiver) || self.flow.is_engine_only(&self.flow.get(known).clone())
            });
            if !is_trusted {
                self.check_passed_functions(index, func, pos, args, "a function that the compiler does not see");
            }
            let (named, member) = match func.op(v) {
                Some(&(Op::Call { callee, .. } | Op::Construct { callee, .. })) => (
                    self.function_for_value(index, func, callee),
                    match func.op(strip_casts(func, callee)) {
                        Some(&Op::PropGet { obj, name }) => Some((obj, name)),
                        _ => None,
                    },
                ),
                Some(&Op::CallMethod { obj, name, .. }) => (self.find_static_member(index, obj, name, MethodKind::Method), Some((obj, name))),
                _ => (None, None),
            };
            let mut called: SmallVec<[FuncId; 2]> = SmallVec::new();
            if let Some((obj, name)) = member {
                let known = self.flow.val(index, func, facts, keys, obj, false);
                let known = self.flow.get(known).clone();
                called = self.find_members(func, obj, &known, name, MethodKind::Method);
            }
            called.extend(named.filter(|named| !called.contains(named)));
            for called in called {
                self.add_parameters_receiving_untyped(func, pos, called, args, "this call");
            }
            if let Some((obj, name)) = member
                && let Some(called) = self.function_for_value(index, func, obj)
            {
                match program.strs.get(name) {
                    b"call" => self.add_parameters_receiving_untyped(func, pos, called, args.get(1..).unwrap_or_default(), "this call"),
                    b"apply" | b"bind" => self.check_passed_functions(index, func, pos, &[obj], &format!("`{}`", bstr::BStr::new(program.strs.get(name)))),
                    _ => {}
                }
            }
            return;
        };
        for &called in &found {
            let callee = &program.funcs[called.idx()];
            if !callee.has(func_flags::IS_TYPED) {
                let into = self.name_of_function(callee);
                self.check_passed_functions(index, func, pos, args, &format!("{into}, which is untyped"));
                continue;
            }
            let individually = callee.params.len() - usize::from(callee.has(func_flags::HAS_REST) && !callee.params.is_empty());
            let blind: Vec<usize> = (callee.params[..individually].iter().zip(handed).enumerate()).filter(|(_, (parameter, argument))| self.flow.is_informative(**parameter) && !self.flow.is_informative(func.ty(**argument))).map(|(number, _)| number).collect();
            if !blind.is_empty() && !callee.has(func_flags::IS_BUILTIN | func_flags::IS_IN_BUILTIN_MODULE) {
                self.add_function_parameters(called, &blind, (func.module.0, pos, "this call, which passes `any`".to_owned()));
            }
            let escaping: Vec<V> = callee.params[..individually].iter().zip(handed).filter(|(parameter, _)| !self.flow.is_informative(**parameter)).map(|(_, &argument)| argument).collect();
            let into = self.name_of_function(callee);
            self.check_passed_functions(index, func, pos, &escaping, &format!("{into}, which takes it as `any` or `unknown`"));
            for (number, (&parameter, &argument)) in callee.params[..individually].iter().zip(handed).enumerate() {
                if !self.flow.is_informative(parameter) {
                    continue;
                }
                let given = self.flow.val(index, func, facts, keys, argument, false);
                let (given, wanted) = (self.flow.get(given).clone(), self.flow.get(parameter).clone());
                let may_be_expected_undefined = given.prims & wanted.prims & prim::UNDEFINED != 0;
                let given = Declared { prims: given.prims & !prim::UNDEFINED, ..given };
                if given.has_objects() && wanted.has_objects() || given.is_never() {
                    continue;
                }
                let verdict = match self.judge(None, &given, &given, &wanted) {
                    Verdict::Wrong if may_be_expected_undefined || !found.iter().all(|&other| self.always_refuses_argument(other, number, &given)) => Verdict::Unknown,
                    verdict => verdict,
                };
                self.value = self.constant(func, argument).unwrap_or_default();
                let found = text_of(program, &given, 0);
                let origin = self.flow.origin_of(index, argument);
                let named = self.name_of_function(callee);
                self.risk = self.risk_of(&wanted);
                self.is_at_entrypoint = callee.has(func_flags::IS_VALUE) && self.has_checking_entrypoint[called.idx()];
                let written = program.declared_parameter_types.get(&(called.idx() as u32)).map_or_else(|| wanted.clone(), |written| self.flow.get(written[number]).clone());
                self.add(func, pos, Kind::Argument, verdict, text_of(program, &written, 0), found, format!("argument {} of {named}", number + 1), origin);
            }
        }
    }

    fn check_reflection(&mut self, index: usize, func: &Func, facts: &Facts, keys: &mut Keys, pos: u32, obj: V, name: StrId, args: &[V]) {
        let program = self.flow.program;
        let Some(holder) = self.flow.builtin_holder(index, obj).map(|holder| holder.name.as_bytes()) else { return };
        if !matches!(holder, b"Object" | b"Reflect") {
            return;
        }
        let called = program.strs.get(name);
        if called == b"construct" && args.len() > 2 {
            self.name = Some("construct-new-target");
            return self.add(func, pos, Kind::Result, Verdict::Unknown, String::new(), String::new(), "`Reflect.construct` with a different new.target: a TypeScript constructor function accepts a new.target only if its `prototype` belongs to such a function".to_owned(), 0);
        }
        if holder == b"Reflect" && matches!(called, b"apply" | b"construct") {
            return self.check_passed_functions(index, func, pos, args.get(..1).unwrap_or_default(), &format!("`Reflect.{}`", bstr::BStr::new(called)));
        }
        if !matches!(called, b"defineProperty" | b"defineProperties" | b"setPrototypeOf" | b"assign" | b"set" | b"deleteProperty") {
            return;
        }
        let Some(&target) = args.first() else { return };
        let context = self.flow.origin_of(index, target) & CONTEXTUAL;
        let shown = format!("{}.{}", bstr::BStr::new(holder), bstr::BStr::new(called));
        if let Some(changed) = self.flow.builtin_holder(index, target) {
            let what = if holder == b"Reflect" { "returns false where plain JavaScript returns true" } else { "throws" };
            let written = if changed.is_global_object() { "globalThis" } else { changed.name };
            let key = args.get(1).and_then(|&key| self.flow.constant_key(index, func, key));
            let one = |change: Change| if args.len() > 1 { Self::builtin_rejection(changed, key.as_deref(), change) } else { None };
            let refusal = match called {
                b"defineProperty" => one(Change::Define).or_else(|| if key.is_none() && args.len() > 1 { Self::builtin_rejection(changed, None, Change::Assign) } else { None }),
                b"set" if args.len() <= 3 => one(Change::Assign).filter(|_| !matches!((&key, args.get(2)), (Some(name), Some(&value)) if self.is_current_value(index, changed, name, value))),
                b"deleteProperty" => one(Change::Delete),
                b"setPrototypeOf" => {
                    let is_unchanged = args.get(1).is_some_and(|&parent| matches!(self.flow.identity_of(index, parent), Some(Identity::Builtin(parent)) if Builtin::at(parent).name == changed.inherits));
                    (changed.has_immutable_prototype() && args.len() > 1 && !is_unchanged).then(|| (if changed.is_extensible { "builtin-member-replace" } else { "builtin-prototype-write" }, String::new(), "built-in objects keep their prototype".to_owned()))
                }
                b"defineProperties" | b"assign" if holder == b"Object" => {
                    let change = if called == b"assign" { Change::Assign } else { Change::Define };
                    args.iter().skip(1).find_map(|&source| match self.literal_keys(func, source) {
                        Some(names) => names.iter().find_map(|name| Self::builtin_rejection(changed, Some(name.as_slice()), change)),
                        None => Self::builtin_rejection(changed, None, Change::Assign),
                    })
                }
                _ => None,
            };
            if let Some((kind, _, why)) = refusal {
                self.name = Some(kind);
                self.add(func, pos, Kind::BuiltinWrite, Verdict::Wrong, String::new(), String::new(), format!("`{shown}({written}, ..)` {what}: {why}"), context);
            }
            return;
        }
        if let Some(owner) = self.prototype_owner(index, target) {
            let (created, named) = (&program.funcs[owner.idx()], self.name_of_function(&program.funcs[owner.idx()]));
            if created.has(func_flags::GENERATOR) {
                self.name = Some("generator-prototype-write");
                self.add(func, pos, Kind::PrototypeWrite, Verdict::Wrong, String::new(), String::new(), format!("`{shown}` on the prototype of the generator function {named}, which is frozen"), context);
            } else if self.class_of.get(&owner).is_some_and(|class| program.layouts[class.idx()].class_flags & (class_flags::HAS_FIXED_LAYOUT | class_flags::PROTOTYPE_MAY_GAIN_MEMBERS) == class_flags::HAS_FIXED_LAYOUT) {
                self.add(func, pos, Kind::PrototypeWrite, Verdict::Unknown, String::new(), String::new(), format!("`{shown}` on the prototype of the class {named}: members cannot be added to class prototypes"), context);
            }
            return;
        }
        let receiver = self.flow.val(index, func, facts, keys, target, false);
        let receiver = self.flow.get(receiver).clone();
        if receiver.any_object || receiver.parts.is_empty() {
            return;
        }
        if matches!(called, b"defineProperty" | b"defineProperties") && receiver.parts.iter().any(|part| matches!(part, Part::Array(_))) {
            self.name = Some("index-accessor");
            self.add(func, pos, Kind::Mutation, Verdict::Unknown, String::new(), String::new(), format!("`{shown}` on an array: typed array access does not run accessors, it throws"), context);
        }
        for part in &receiver.parts {
            let &Part::Class(layout) = part else { continue };
            if layout.is_none() {
                continue;
            }
            let allocated_as = &program.layouts[layout.idx()];
            if !allocated_as.is_allocated || allocated_as.kind == LayoutKind::Environment {
                continue;
            }
            let owner = text_of(program, &Declared::part(Part::Class(layout)), context);
            let key = args.get(1).and_then(|&key| match func.op(strip_casts(func, key)) {
                Some(&Op::Str(key)) => Some(key),
                _ => None,
            });
            let is_only = receiver.parts.len() == 1 && receiver.prims == 0 && !allocated_as.accepts_untyped && holder != b"Reflect";
            match called {
                b"setPrototypeOf" if allocated_as.kind == LayoutKind::Record && allocated_as.class_flags & (class_flags::MAY_HAVE_OTHER_PROTOTYPE | class_flags::PROTOTYPE_IS_SET_BY_TYPED_CODE) != 0 => {}
                b"setPrototypeOf" => {
                    self.name = Some("object-set-prototype");
                    self.add(func, pos, Kind::Mutation, if is_only { Verdict::Wrong } else { Verdict::Unknown }, String::new(), String::new(), format!("`{shown}` on {owner}: objects of a declared type keep their prototype"), context);
                }
                b"defineProperty" | b"deleteProperty" => {
                    let names_a_field = key.is_some_and(|key| allocated_as.field(key).is_some());
                    if names_a_field || key.is_none() {
                        self.name = Some("field-redefine");
                        self.add(func, pos, Kind::Mutation, Verdict::Unknown, String::new(), String::new(), format!("`{shown}` on {owner}: declared properties stay writable, enumerable and configurable data properties"), context);
                    }
                }
                _ => self.add(func, pos, Kind::Mutation, Verdict::Unknown, String::new(), String::new(), format!("`{shown}` on {owner}: the stored values are checked against the declared types"), context),
            }
        }
    }
}

fn may_hold_untyped_object(program: &Program, ty: &Declared) -> bool {
    ty.any_object || ty.parts.iter().any(|part| matches!(part, Part::Class(view) if view.is_some() && program.layouts[view.idx()].accepts_untyped))
}

fn mentions_record(program: &Program, ty: &Declared, depth: u32) -> bool {
    ty.parts.iter().any(|part| match *part {
        Part::Class(layout) => layout.is_some() && program.layouts[layout.idx()].kind == LayoutKind::Record,
        Part::Array(elements) => depth < 2 && elements.is_some() && mentions_record(program, program.tys.get(elements), depth + 1),
        Part::Global(..) => false,
    })
}

fn find_stored_values(func: &Func) -> Vec<bool> {
    let mut held = vec![false; func.values.len()];
    for block in &func.blocks {
        for &v in &block.ops {
            let Some(op) = func.op(v) else { continue };
            let builds = match op {
                Op::Coerce { .. } => continue,
                Op::Operation { args, .. } => args.first().copied().filter(|&created| matches!(func.op(created), Some(Op::NewObject))),
                _ => None,
            };
            op.for_each_operand(|used| {
                if used.is_some() && Some(used) != builds {
                    held[used.idx()] = true;
                }
            });
        }
        if let Some(term) = &block.term {
            term.for_each_operand(|used| {
                if used.is_some() {
                    held[used.idx()] = true;
                }
            });
        }
    }
    held
}

fn is_stored_elsewhere(func: &Func, held: &[bool], v: V) -> bool {
    let mut at = v;
    loop {
        if held[at.idx()] {
            return true;
        }
        match func.op(at) {
            Some(&Op::Coerce { value, .. }) => at = value,
            Some(Op::NewObject | Op::Operation { .. } | Op::Call { .. } | Op::CallMethod { .. } | Op::Construct { .. } | Op::CallDirect { .. }) => return false,
            _ => return true,
        }
    }
}

fn is_lazy_variable_read(program: &Program, func: &Func, v: V) -> bool {
    let is_lazy = |v: V| matches!(func.op(strip_casts(func, v)), Some(&Op::GlobalGet(global)) if program.globals[global.idx()].initialization == Initialization::Lazy);
    let root = strip_casts(func, v);
    match func.values[root.idx()].def {
        Def::Param(block, number) => {
            let mut handed = func.blocks.iter().flat_map(|from| targets_of(from.term.as_ref())).filter(|target| target.block == block).filter_map(|target| target.args.get(number as usize)).peekable();
            handed.peek().is_some() && handed.all(|&argument| is_lazy(argument))
        }
        Def::Op(_) => is_lazy(root),
    }
}

fn is_dereferenced_next(func: &Func, block: usize, place: usize, v: V) -> bool {
    let mut aliases = vec![v];
    let (mut block, mut from) = (block, place + 1);
    for _ in 0..3 {
        for &next in &func.blocks[block].ops[from..] {
            let Some(op) = func.op(next) else { return false };
            match op {
                Op::Undefined | Op::Null | Op::Bool(_) | Op::Int(_) | Op::Double(_) | Op::Str(_) | Op::BigInt(_) | Op::Symbol(_) | Op::FuncRef(_) | Op::GlobalGet(_) | Op::FieldGet { .. } => {}
                &Op::Coerce { value, why: CoerceReason::Upcast | CoerceReason::Forced, .. } if aliases.contains(&value) => aliases.push(next),
                &(Op::PropGet { obj, .. } | Op::PropSet { obj, .. } | Op::ElemGet { obj, .. } | Op::ElemSet { obj, .. } | Op::IterOpen(obj)) => return aliases.contains(&obj),
                Op::CallMethod { obj, .. } => return aliases.contains(obj),
                Op::Call { callee, .. } | Op::Construct { callee, .. } => return aliases.contains(callee),
                _ => return false,
            }
        }
        match func.blocks[block].term.as_ref() {
            Some(Term::Jump(target) | Term::Invoke { normal: target, .. }) if target.args.is_empty() => (block, from) = (target.block.idx(), 0),
            _ => return false,
        }
    }
    false
}

fn escaped(text: &str) -> String {
    let mut out = String::with_capacity(text.len() + 2);
    for c in text.chars() {
        match c {
            '"' => out.push_str("\\\""),
            '\\' => out.push_str("\\\\"),
            '\n' => out.push_str("\\n"),
            '\t' => out.push_str("\\t"),
            c if (c as u32) < 0x20 => {
                let _ = write!(out, "\\u{:04x}", c as u32);
            }
            c => out.push(c),
        }
    }
    out
}

struct ReportContext {
    surely: Vec<bool>,
    class_of: FxHashMap<FuncId, LayoutId>,
    has_checking_entrypoint: Vec<bool>,
    untyped_clone_class: FxHashMap<FuncId, LayoutId>,
    logs_type_errors: bool,
}

impl ReportContext {
    fn new(program: &Program, setup: &Setup, logs_type_errors: bool) -> ReportContext {
        let mut has_checking_entrypoint = vec![false; program.funcs.len()];
        let class_methods: FxHashMap<FuncId, LayoutId> = (program.layouts.iter().enumerate()).filter(|(_, layout)| layout.kind == LayoutKind::Instance).flat_map(|(class, layout)| layout.methods.iter().filter(|method| method.flags & method_flags::STATIC == 0).map(move |method| (method.func, LayoutId::new(class)))).collect();
        let class_static_methods: FxHashSet<FuncId> = program.layouts.iter().filter(|layout| layout.kind == LayoutKind::Instance).flat_map(|layout| &layout.methods).filter(|method| method.flags & method_flags::STATIC != 0).map(|method| method.func).collect();
        let mut untyped_clone_class: FxHashMap<FuncId, LayoutId> = FxHashMap::default();
        let is_plain_clone_entry = |func: &Func| logs_type_errors && func.has(func_flags::IS_HIDDEN_IN_STACK_TRACES) && func.has(func_flags::IS_VALUE) && func.module.is_some() && func.values.iter().any(|value| matches!(value.def, Def::Op(Op::Caught)));
        for entry in program.funcs.iter().filter(|func| func.has(func_flags::IS_GENERIC_ENTRYPOINT) || is_plain_clone_entry(func)) {
            let mut called = entry.values.iter().filter_map(|value| match &value.def {
                Def::Op(Op::CallDirect { func: called, .. }) => Some(*called),
                _ => None,
            });
            let Some(first) = called.next().filter(|first| (program.funcs[first.idx()].module, program.funcs[first.idx()].pos) == (entry.module, entry.pos)) else { continue };
            match (class_methods.get(&first), called.next()) {
                (Some(&class), Some(second)) => {
                    untyped_clone_class.insert(second, class);
                }
                (Some(_), None) => {}
                (None, _) if class_static_methods.contains(&first) => {}
                (None, _) => has_checking_entrypoint[first.idx()] = true,
            }
        }
        let class_of = program.layouts.iter().enumerate().filter(|(_, layout)| layout.constructor.is_some()).map(|(index, layout)| (layout.constructor, LayoutId::new(index))).collect();
        ReportContext { surely: must_execute_functions(program, &setup.noreturn), class_of, has_checking_entrypoint, untyped_clone_class, logs_type_errors }
    }

    fn report<'a, 'b>(&'b self, flow: &'b mut Flow<'a>) -> Report<'a, 'b> {
        Report { flow, ordinal: None, handed_over: None, sites: Vec::new(), fine: FxHashMap::default(), class_of: &self.class_of, always_throws: 0, at: V::NONE, name: None, value: String::new(), passing_sites: FxHashSet::default(), is_guarded_by_test: false, is_must_execute: false, risk: "", call: None, is_at_entrypoint: false, has_checking_entrypoint: &self.has_checking_entrypoint, untyped_clone_class: &self.untyped_clone_class, logs_type_errors: self.logs_type_errors }
    }

    fn analyze(&self, report: &mut Report<'_, '_>, run: Range<usize>) {
        let program = report.flow.program;
        for index in run {
            let func = &program.funcs[index];
            if func.module.is_none() || func.has(func_flags::IS_BUILTIN | func_flags::IS_IN_BUILTIN_MODULE | func_flags::IS_HIDDEN_IN_STACK_TRACES | func_flags::IS_GENERIC_ENTRYPOINT) {
                continue;
            }
            let path = program.strs.get(program.modules[func.module.idx()].display_path);
            if path.starts_with(b".bun-aot-prelude/") || bun_core::strings::contains(path, b"/.bun-aot-prelude/") {
                continue;
            }
            let (reached, mut keys) = report.flow.run(index);
            report.is_must_execute = self.surely[index];
            report.analyze(index, &reached, &mut keys);
        }
    }
}

fn finalize_sites(mut sites: Vec<Site>, passing_sites: &FxHashSet<(u32, u32, Kind)>, is_sure: bool) -> Vec<Site> {
    for site in sites.iter_mut().filter(|site| site.verdict == Verdict::Wrong && passing_sites.contains(&(site.module, site.pos, site.kind))) {
        site.verdict = Verdict::Unknown;
        site.detail = if site.detail.is_empty() { "it always fails on one of the paths to here".to_owned() } else { format!("{}: it always fails on one of the paths to here", site.detail) };
    }
    if !is_sure {
        for site in &mut sites {
            site.verdict = site.verdict.min(Verdict::Unknown);
        }
    }
    sites.sort_by_key(|a| (a.module, a.pos, a.kind, a.ordinal, std::cmp::Reverse(a.verdict)));
    sites.dedup_by(|next, retained| (next.module, next.pos, next.kind, next.ordinal) == (retained.module, retained.pos, retained.kind, retained.ordinal));
    sites
}

pub(super) fn set_up(program: &Program, in_parallel: InParallel<'_>) -> Setup {
    Setup::new(program, false, in_parallel)
}

pub(super) fn find_always_failing_sites(program: &Program, setup: &Setup, in_parallel: InParallel<'_>) -> Vec<Site> {
    let asked = ReportContext::new(program, setup, false);
    let mut first = Flow::new(program, setup, false, None);
    for &index in setup.constant_stores.iter().chain(&setup.constant_stores) {
        first.run(index);
    }
    let frozen = first.freeze();
    let mut runs: Vec<(Range<usize>, Vec<Site>, FxHashSet<(u32, u32, Kind)>)> = runs_of(program).map(|run| (run, Vec::new(), FxHashSet::default())).collect();
    for_each_mut(&mut runs, in_parallel, &|(run, sites, passing_sites)| {
        let mut flow = Flow::new(program, setup, false, Some(&frozen));
        let mut report = asked.report(&mut flow);
        asked.analyze(&mut report, run.clone());
        (*sites, *passing_sites) = (report.sites, report.passing_sites);
    });
    let mut passing_sites: FxHashSet<(u32, u32, Kind)> = FxHashSet::default();
    let mut sites = Vec::new();
    for (_, of_run, passes) in runs {
        sites.extend(of_run);
        passing_sites.extend(passes);
    }
    finalize_sites(sites, &passing_sites, true).into_iter().filter(|site| site.verdict == Verdict::Wrong).collect()
}

fn find(program: &Program, logs_type_errors: bool, in_parallel: InParallel<'_>) -> (Vec<Site>, Vec<(Kind, usize)>, usize, usize, [f64; 3]) {
    let begun = Instant::now();
    let setup = Setup::new(program, true, in_parallel);
    let asked = ReportContext::new(program, &setup, logs_type_errors);
    let mut flow = Flow::new(program, &setup, true, None);
    let prepared = begun.elapsed().as_secs_f64();
    let mut rounds = 0;
    for index in 0..program.funcs.len() {
        flow.wake(index);
    }
    while rounds < program.funcs.len() * MAX_ROUNDS
        && let Some(index) = flow.pending.pop_front()
    {
        flow.is_pending[index as usize] = false;
        flow.run(index as usize);
        rounds += 1;
    }
    let is_settled = flow.pending.is_empty();
    let settled = begun.elapsed().as_secs_f64();
    let mut report = asked.report(&mut flow);
    asked.analyze(&mut report, 0..program.funcs.len());
    report.add_entrypoint_function_parameters(logs_type_errors);
    let is_sure = is_settled && !report.flow.has_given_up;
    let sites = finalize_sites(report.sites, &report.passing_sites, is_sure);
    let fine = Kind::ALL.iter().map(|&kind| (kind, report.fine.get(&kind).copied().unwrap_or(0))).collect();
    (sites, fine, rounds, report.always_throws, [prepared, settled - prepared, begun.elapsed().as_secs_f64() - settled])
}

pub(super) struct FallibleCheck {
    pub(super) module: u32,
    pub(super) pos: u32,
    pub(super) what: String,
    pub(super) origin: Option<(u32, u32, String)>,
    pub(super) fix: &'static str,
    pub(super) is_of_parameters: bool,
}

pub(super) fn find_fallible_checks(program: &Program, logs_type_errors: bool, in_parallel: InParallel<'_>) -> Vec<FallibleCheck> {
    let sites = find(program, logs_type_errors, in_parallel).0;
    (sites.into_iter().filter(|site| site.tier != Tier::Typed && site.verdict != Verdict::Wrong && site.kind != Kind::Copy && site.name != "as-convert"))
        .map(|site| {
            let expectation = if site.expected.is_empty() { String::new() } else { format!("expected {}, may get {}", site.expected, site.shown()) };
            let separator = if site.detail.is_empty() || expectation.is_empty() { "" } else { ": " };
            FallibleCheck { module: site.module, pos: site.pos, what: format!("{}{separator}{expectation}", site.detail), fix: site.fix(), is_of_parameters: site.kind == Kind::Parameter, origin: site.origin.filter(|origin| origin.0 != u32::MAX && origin.1 != 0 && (origin.0, origin.1) != (site.module, site.pos)) }
        })
        .collect()
}

pub(super) fn explain(program: &Program, logs_type_errors: bool, as_json: bool, lists_all: bool, line_and_column: &dyn Fn(u32, u32) -> (u32, u32), in_parallel: InParallel<'_>) -> Vec<String> {
    let (sites, fine, rounds, always_throws, [prepared, settled, looked]) = find(program, logs_type_errors, in_parallel);
    let path_of = |module: u32| bstr::BStr::new(program.strs.get(program.modules[module as usize].display_path)).to_string();
    let mut lines = Vec::new();
    let mut ordinals: FxHashMap<(u32, u32, &'static str), usize> = FxHashMap::default();
    let mut listed = [0usize; 4];
    let many = |tier: Tier| sites.iter().filter(|site| site.tier == tier && site.verdict != Verdict::Wrong).count();
    let folds_external = !as_json && !lists_all && many(Tier::Outside) > MAX_LISTED;
    for site in &sites {
        let ordinal = match site.ordinal {
            Some(ordinal) => ordinal as usize,
            None => {
                let next = ordinals.entry((site.module, site.pos, site.name)).or_insert(0usize);
                *next += 1;
                *next - 1
            }
        };
        if !lists_all && site.tier == Tier::Typed && site.verdict != Verdict::Wrong {
            continue;
        }
        if !as_json && !lists_all && site.verdict != Verdict::Wrong {
            let so_far = &mut listed[Tier::ALL.iter().position(|&tier| tier == site.tier).unwrap_or(0)];
            *so_far += 1;
            if *so_far > MAX_LISTED || folds_external && site.tier == Tier::Outside {
                continue;
            }
        }
        let (line, column) = line_and_column(site.module, site.pos);
        let verdict = if site.verdict == Verdict::Wrong { "error" } else { "warning" };
        let from = site.origin.as_ref().filter(|origin| origin.0 != u32::MAX).map(|(module, pos, what)| {
            let (line, column) = line_and_column(*module, *pos);
            (path_of(*module), line, column, what.clone())
        });
        let shown_path = path_of(site.module);
        let id_of = |line: u32, column: u32, name: &str, ordinal: usize| crate::audit::id_of(shown_path.as_bytes(), line as usize, column as usize, name, ordinal);
        let id = id_of(line, column, site.name, ordinal);
        let id_of_call = site.call.map(|(at, parameter)| {
            let (line, column) = line_and_column(site.module, at);
            id_of(line, column, "enter-argument", parameter as usize)
        });
        let is_in_builtin_table = site.name == "as-late-use" || matches!(site.kind, Kind::Argument | Kind::Variable | Kind::Field | Kind::Return | Kind::Integer | Kind::Read | Kind::Element | Kind::Result | Kind::Await | Kind::Arithmetic);
        let logged_as = ((!logs_type_errors || site.is_in_untyped_code) && is_in_builtin_table).then(|| id_of(line, column, "type-mismatch", 0));
        if as_json {
            let mut text = format!("{{\"aot\":\"type-check\",\"id\":\"{}\",\"kind\":\"{}\",\"group\":\"{}\",\"what\":\"{}\",\"file\":\"{}\",\"line\":{line},\"col\":{column},\"fn\":\"{}\"", id, site.name, site.kind.text(), site.what, escaped(&shown_path), escaped(&site.function));
            for (key, value) in [("expected", &site.expected), ("got", &site.found), ("value", &site.value), ("detail", &site.detail)] {
                if !value.is_empty() {
                    let _ = write!(text, ",\"{key}\":\"{}\"", escaped(value));
                }
            }
            if let Some(id_of_call) = &id_of_call {
                let _ = write!(text, ",\"callId\":\"{id_of_call}\"");
            }
            if let Some(logged_as) = &logged_as {
                let _ = write!(text, ",\"loggedAs\":\"{logged_as}\"");
            }
            let _ = write!(text, ",\"action\":\"{verdict}\",\"category\":\"{}\",\"cause\":\"{}\"", site.tier.text(), site.cause().text());
            if logs_type_errors {
                let _ = write!(text, ",\"logBuild\":\"{}\"", site.name_in_log_build());
            }
            for (key, value) in [("risk", site.risk), ("source", &site.external_source[..])] {
                if !value.is_empty() {
                    let _ = write!(text, ",\"{key}\":\"{}\"", escaped(value));
                }
            }
            if let Some((path, line, column, what)) = &from {
                let _ = write!(text, ",\"origin\":{{\"what\":\"{}\",\"file\":\"{}\",\"line\":{line},\"col\":{column}}}", escaped(what), escaped(path));
            }
            let _ = write!(text, ",\"fix\":\"{}\"}}", escaped(site.fix()));
            lines.push(text);
            continue;
        }
        let mut text = format!("[aot] type-check {id} {} {shown_path}:{line}:{column} ({})", site.name, site.function);
        if !site.detail.is_empty() {
            let _ = write!(text, ": {}", site.detail);
        }
        if !site.expected.is_empty() {
            let _ = write!(text, ": expected {}, {} {}", site.expected, if site.verdict == Verdict::Wrong { "always gets" } else { "may get" }, site.shown());
        }
        let _ = write!(text, "; {verdict}");
        if logs_type_errors {
            let _ = write!(text, "; this log build {} here", site.name_in_log_build());
        }
        if let Some(id_of_call) = &id_of_call {
            let _ = write!(text, "; call {id_of_call}");
        }
        if let Some(logged_as) = &logged_as {
            let _ = write!(text, "; logged as {logged_as}");
        }
        if let Some((path, line, column, what)) = &from {
            let _ = write!(text, "; value from {what} at {path}:{line}:{column}");
        }
        let _ = write!(text, "; fix: {}", site.fix());
        lines.push(text);
    }
    if as_json {
        return lines;
    }
    if folds_external {
        let mut external_sources: FxHashMap<&str, (usize, usize, usize, &Site)> = FxHashMap::default();
        for site in sites.iter().filter(|site| site.tier == Tier::Outside && site.verdict != Verdict::Wrong) {
            let external_source = external_sources.entry(&site.external_source[..]).or_insert((0, 0, 0, site));
            external_source.0 += 1;
            external_source.1 += usize::from(site.risk == "primitive");
            external_source.2 += usize::from(site.risk == "closed");
            if external_source.3.risk != "primitive" && site.risk == "primitive" {
                external_source.3 = site;
            }
        }
        let mut external_sources: Vec<(&str, (usize, usize, usize, &Site))> = external_sources.into_iter().collect();
        external_sources.sort_by(|a, b| (b.1.1 + b.1.2, b.1.0, a.0).cmp(&(a.1.1 + a.1.2, a.1.0, b.0)));
        let throwing: usize = external_sources.iter().map(|external_source| external_source.1.1 + external_source.1.2).sum();
        let mut so_far = 0;
        let half = external_sources.iter().take_while(|external_source| { let is_short = so_far * 2 < throwing; so_far += external_source.1.1 + external_source.1.2; is_short }).count();
        lines.push(format!("[aot] type-check summary: {} checks take values from untyped code, which come from {} sources; {throwing} of the checks throw on a wrong value, and {half} sources account for half of those. The sources, largest first:", many(Tier::Outside), external_sources.len()));
        for (external_source, (places, primitives, closed, first)) in external_sources.iter().take(MAX_SOURCES_LISTED) {
            let (line, column) = line_and_column(first.module, first.pos);
            lines.push(format!("[aot] type-check source: {}: {places} checks, {primitives} expect a primitive, {closed} a class or an exact object type; e.g. {}:{line}:{column}: {}: expected {}", if external_source.is_empty() { "(unknown)" } else { external_source }, path_of(first.module), first.name, first.expected));
        }
        if external_sources.len() > MAX_SOURCES_LISTED {
            lines.push(format!("[aot] type-check summary: {} more sources: --aot-explain=throws-json prints one line per check, with its source", external_sources.len() - MAX_SOURCES_LISTED));
        }
    }
    for (tier, &count) in Tier::ALL.iter().zip(&listed) {
        if count > MAX_LISTED && !(folds_external && *tier == Tier::Outside) {
            lines.push(format!("[aot] type-check summary: {} more of the category {}: --aot-explain=throws-all lists them", count - MAX_LISTED, tier.text()));
        }
    }
    for (kind, fine) in fine.into_iter().filter(|_| lists_all) {
        let count = |verdict: Verdict| sites.iter().filter(|site| site.kind == kind && site.verdict == verdict).count();
        let by_tier: Vec<String> = Tier::ALL.iter().map(|&tier| (tier, sites.iter().filter(|site| site.kind == kind && site.verdict == Verdict::Unknown && site.tier == tier).count())).filter(|found| found.1 != 0).map(|(tier, count)| format!("{count} {}", tier.text())).collect();
        lines.push(format!("[aot] type-check count: {}: {} never fail, {} always fail, {} can fail{}{}", kind.text(), fine, count(Verdict::Wrong), count(Verdict::Unknown), if by_tier.is_empty() { "" } else { ": " }, by_tier.join(", ")));
    }
    if lists_all {
        lines.push(format!("[aot] type-check count: {always_throws} checks for undefined or null are not listed: the next operation throws in plain JavaScript too"));
        for tier in Tier::ALL {
            lines.push(format!("[aot] type-check count: category {}: {} can fail", tier.text(), sites.iter().filter(|site| site.verdict == Verdict::Unknown && site.tier == tier).count()));
        }
        lines.push(format!("[aot] type-check count: {rounds} passes over functions; {prepared:.2} s, {settled:.2} s, {looked:.2} s"));
    }
    let counted = if lists_all { 0 } else { sites.iter().filter(|site| site.tier == Tier::Typed && site.verdict != Verdict::Wrong).count() };
    let always = sites.iter().filter(|site| site.verdict == Verdict::Wrong).count();
    let mut summary = format!("[aot] type-check summary: {} checks can fail when the program runs, {always} always fail", sites.len() - counted - always);
    if logs_type_errors {
        let listed = || sites.iter().filter(|site| site.verdict != Verdict::Wrong && (lists_all || site.tier != Tier::Typed));
        let count = |what: &str| listed().filter(|site| site.name_in_log_build() == what).count();
        let _ = write!(summary, "; after logging, this build continues at {}, converts at {} and still throws at {}", count("continues"), count("converts"), count("throws"));
    }
    if counted != 0 {
        let _ = write!(summary, "; {counted} more fail only if TypeScript code of the program itself produces a value of the wrong type (--aot-explain=throws-all lists them)");
    }
    lines.push(summary);
    let caused_by = |cause: Cause| sites.iter().filter(|site| site.verdict != Verdict::Wrong && (lists_all || site.tier != Tier::Typed) && site.cause() == cause).count();
    let by_cause: Vec<String> = Cause::ALL.iter().map(|&cause| (caused_by(cause), cause)).filter(|found| found.0 != 0).map(|(count, cause)| format!("{count} {}", cause.as_str())).collect();
    if !by_cause.is_empty() {
        lines.push(format!("[aot] type-check summary: those that can fail: {}", by_cause.join(", ")));
    }
    lines
}
