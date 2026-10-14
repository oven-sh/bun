use super::nil::{before_casts, functions_called, targets_of};
use crate::declared::{Declared, DeclaredTable, Part, prim};
use crate::id::{FuncId, LayoutId, StrId, TyId, V};
use crate::ir::{BinOp, Def, Func, FuncKind, Initialization, LayoutKind, NO_VARIABLE, Op, Prediction, Program, Target, Term, UnOp, Why, class_flags, field_flags, func_flags, method_flags};
use bun_sema::check::{is_builtin_of_the_engine, is_locked_global_of_the_engine};
use rustc_hash::{FxHashMap, FxHashSet};
use smallvec::SmallVec;
use std::collections::VecDeque;
use std::fmt::Write;
use std::rc::Rc;
use std::time::Instant;

const MOST_ROUNDS: usize = 24;
const MOST_CHANGES_INSIDE: u8 = 16;
const MOST_CHANGES_BETWEEN: u8 = 4;
const MOST_LISTED: usize = 200;
const MOST_DOORS: usize = 40;
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
    Caller,
    Copy,
}

impl Kind {
    const ALL: [Kind; 19] = [
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
        Kind::Caller,
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
            Kind::Caller => "function-caller",
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
            Kind::Caller => "function-caller-arguments",
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
            (Kind::NonNull, Verdict::Wrong) => "the value is never there: remove the `!` and handle the missing value",
            (Kind::NonNull, _) => "test for null and undefined, or give a default with `??`",
            (Kind::Integer, _) => "round on purpose (`| 0`, Math.trunc) or declare the place `number`",
            (Kind::Argument | Kind::Variable | Kind::Field | Kind::Return, Verdict::Wrong) => "the value never fits the declared type: correct the value or the type",
            (Kind::Argument | Kind::Variable | Kind::Field | Kind::Return | Kind::Read | Kind::Result | Kind::Await, _) => "validate the value where it comes in, once, and build a typed value from it",
            (Kind::Element, _) => "keep what is stored in the container to its element type: no store through `any` or through a wider view of it",
            (Kind::Narrowing, _) => "read the value into a const before the test, so that nothing can change it between the test and the use",
            (Kind::Arithmetic, _) => "the operands are not what their types say: remove the cast that hides it",
            (Kind::Parameter, _) => "give the untyped caller a wrapper that validates, or widen the parameter and narrow inside",
            (Kind::BuiltinWrite, _) => "built-ins are locked under --aot: use a function or a subclass of your own",
            (Kind::PrototypeWrite, _) => "declare the member in the class, or keep the function in a table of your own",
            (Kind::Copy, _) => "build the typed object yourself from the outside one and use that alone: whoever keeps the outside object sees none of the writes",
            (Kind::Caller, _) => "pass what is needed as an argument: `caller` and `arguments` of a function throw under --aot",
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
            Tier::Outside => "outside",
            Tier::Assertion => "assertion",
            Tier::Typed => "typed",
            Tier::Rule => "rule",
        }
    }
}

pub(super) struct Site {
    pub(super) is_at_an_entry: bool,
    pub(super) call: Option<(u32, u32)>,
    pub(super) risk: &'static str,
    pub(super) door: String,
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

    pub(super) fn goes_on_when_logged(&self) -> bool {
        self.risk == "primitive" && self.is_at_an_entry
    }

    pub(super) fn message(&self) -> (u32, Vec<Vec<u8>>) {
        let bytes = |text: &str| text.as_bytes().to_vec();
        match self.kind {
            Kind::As => (100017, vec![bytes(&self.expected), bytes(self.shown())]),
            Kind::NonNull => (100012, vec![bytes(self.shown())]),
            Kind::BuiltinWrite => (100014, vec![bytes(&self.detail)]),
            Kind::PrototypeWrite | Kind::Mutation => (100015, vec![bytes(&self.detail)]),
            Kind::Caller => (100016, vec![bytes(&self.detail)]),
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
            let (least, most) = (x.0.max(y.0), x.1.min(y.1));
            (least <= most).then_some((least, most))
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

fn shares_nothing(a: &Declared, b: &Declared) -> bool {
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
    let may_be_falsy = d.prims & (prim::NULLISH | prim::FALSE | prim::NUMBER | prim::STRING | prim::BIGINT) != 0 || d.ints.is_some_and(|(least, most)| least <= 0 && 0 <= most);
    let may_be_truthy = d.prims & (prim::TRUE | prim::NUMBER | prim::STRING | prim::BIGINT | prim::SYMBOL) != 0 || d.ints.is_some_and(|(least, most)| least != 0 || most != 0) || d.has_objects();
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

enum Natural {
    Vouched,
    Is(TyId),
    Unknown(Kind),
}

type Facts = Vec<(u32, TyId)>;

const MANY: u32 = 1;

#[derive(Copy, Clone, PartialEq, Eq, Hash)]
enum Identity {
    Builtin(StrId, bool),
    Function(FuncId),
    PrototypeOf(FuncId),
}

#[derive(Default)]
struct Keys {
    paths: FxHashMap<(u32, u32), u32>,
}

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
    tys: DeclaredTable,
    common: Common,
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
    is_open_global: Vec<bool>,
    is_open_field: Vec<bool>,
    is_whole: bool,
    has_changed: bool,
    has_moved: bool,
    has_given_up: bool,
    has_used_a_test: bool,
    never_return: Vec<bool>,
    callers: Vec<Vec<u32>>,
    readers_of_global: Vec<Vec<u32>>,
    readers_of_field: Vec<Vec<u32>>,
    is_pending: Vec<bool>,
    pending: VecDeque<u32>,
    met: FxHashMap<(TyId, TyId), TyId>,
    joined: FxHashMap<(TyId, TyId), TyId>,
    locked: FxHashMap<StrId, bool>,
    changes: Vec<u8>,
    resolved: FxHashMap<(u32, u32), SmallVec<[FuncId; 2]>>,
    orders: Vec<Option<(Rc<[usize]>, bool)>>,
}

impl<'a> Flow<'a> {
    fn new(program: &'a Program, is_whole: bool) -> Flow<'a> {
        let mut tys = DeclaredTable::default();
        for declared in &program.tys.list {
            tys.intern(declared.clone());
        }
        let anything = tys.anything;
        let common = Common {
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
        };
        let mut count = 0u32;
        let mut take = |many: usize| {
            let first = count;
            count += many as u32;
            first
        };
        let first_value: Vec<u32> = program.funcs.iter().map(|func| take(func.values.len())).collect();
        let results = take(program.funcs.len());
        let globals = take(program.globals.len());
        let first_field: Vec<u32> = program.layouts.iter().map(|layout| take(layout.fields.len())).collect();
        let fields = count - first_field.first().copied().unwrap_or(count);
        let mut is_closed: Vec<bool> = program.funcs.iter().map(|func| !func.has(func_flags::IS_VALUE | func_flags::IS_GENERAL_ENTRY | func_flags::IS_BUILTIN | func_flags::ASYNC | func_flags::GENERATOR) && matches!(func.kind, FuncKind::Plain | FuncKind::Arrow)).collect();
        let mut is_called = vec![false; program.funcs.len()];
        let mut is_open_global = vec![true; program.globals.len()];
        let mut is_open_field = vec![true; fields as usize];
        let base_of_fields = first_field.first().copied().unwrap_or(count);
        let mut callers: Vec<Vec<u32>> = vec![Vec::new(); if is_whole { program.funcs.len() } else { 0 }];
        let mut resolved: FxHashMap<(u32, u32), SmallVec<[FuncId; 2]>> = FxHashMap::default();
        let mut readers_of_global: Vec<Vec<u32>> = vec![Vec::new(); if is_whole { program.globals.len() } else { 0 }];
        let mut readers_of_field: Vec<Vec<u32>> = vec![Vec::new(); if is_whole { fields as usize } else { 0 }];
        let note = |list: &mut Vec<u32>, who: usize| {
            if list.last() != Some(&(who as u32)) {
                list.push(who as u32);
            }
        };
        for (who, func) in program.funcs.iter().enumerate() {
            for (number, value) in func.values.iter().enumerate().filter(|_| is_whole) {
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
                    Def::Op(Op::GlobalGet(global)) => note(&mut readers_of_global[global.idx()], who),
                    Def::Op(Op::FieldGet { layout, field, .. }) if program.layouts[layout.idx()].kind == LayoutKind::Environment => note(&mut readers_of_field[(first_field[layout.idx()] + field - base_of_fields) as usize], who),
                    _ => {}
                }
            }
            for value in &func.values {
                match &value.def {
                    Def::Op(Op::FuncRef(named) | Op::Closure { func: named, .. } | Op::ClosureOnce { func: named, .. }) => is_closed[named.idx()] = false,
                    Def::Op(Op::CallDirect { func: called, .. }) => is_called[called.idx()] = true,
                    Def::Op(Op::GlobalSet(global, _)) => is_open_global[global.idx()] = false,
                    Def::Op(Op::FieldSet { layout, field, .. }) if program.layouts[layout.idx()].kind == LayoutKind::Environment => is_open_field[(first_field[layout.idx()] + field - base_of_fields) as usize] = false,
                    _ => {}
                }
            }
        }
        for layout in &program.layouts {
            for method in layout.methods.iter().filter(|method| method.func.is_some()) {
                is_closed[method.func.idx()] = false;
                if method.key != NO_VARIABLE && layout.environment.is_none() && (method.key as usize) < is_open_global.len() {
                    is_open_global[method.key as usize] = true;
                }
            }
            if layout.constructor.is_some() {
                is_closed[layout.constructor.idx()] = false;
            }
            for field in &layout.fields {
                if field.only_function.is_some() {
                    is_closed[field.only_function.idx()] = false;
                }
            }
        }
        for &entry in program.entries.iter().chain(program.modules.iter().map(|module| &module.init)).chain(program.builtin_modules.iter().map(|entry| &entry.1)).chain(program.builtin_functions.iter().map(|entry| &entry.1)) {
            if entry.is_some() {
                is_closed[entry.idx()] = false;
            }
        }
        for (closed, called) in is_closed.iter_mut().zip(&is_called) {
            *closed &= called & is_whole;
        }
        if !is_whole {
            is_open_field.fill(true);
            for (is_open, global) in is_open_global.iter_mut().zip(&program.globals) {
                *is_open |= global.initialization != Initialization::NeverSeenAndStoredOnce;
            }
        }
        Flow { program, tys, common, first_value, results, globals, first_field, known: vec![TyId::NONE; count as usize], origin: vec![0; count as usize], identity: vec![0; count as usize], identities: Vec::new(), identity_ids: FxHashMap::default(), is_closed, is_open_global, is_open_field, is_whole, has_changed: false, has_moved: false, has_given_up: false, has_used_a_test: false, never_return: functions_that_never_return(program), callers, readers_of_global, readers_of_field, is_pending: vec![false; program.funcs.len()], pending: VecDeque::new(), met: FxHashMap::default(), joined: FxHashMap::default(), locked: FxHashMap::default(), changes: vec![0; count as usize], resolved, orders: vec![None; if is_whole { program.funcs.len() } else { 0 }] }
    }

    fn get(&self, ty: TyId) -> &Declared {
        self.tys.get(ty)
    }

    fn declared(&self, func: &Func, v: V) -> TyId {
        let ty = func.ty(v);
        if ty.is_none() { self.tys.anything } else { ty }
    }

    fn says_something(&self, ty: TyId) -> bool {
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

    fn called_at(&self, index: usize, func: &Func, v: V) -> Option<SmallVec<[FuncId; 2]>> {
        if self.is_whole { self.resolved.get(&(index as u32, v.0)).cloned() } else { functions_called(self.program, func, v).map(|found| found.0) }
    }

    fn is_locked(&mut self, name: StrId) -> bool {
        let program = self.program;
        *self.locked.entry(name).or_insert_with(|| is_locked_global_of_the_engine(program.strs.get(name)))
    }

    fn join_into(&mut self, node: u32, ty: TyId, origin: u32) -> bool {
        self.join_at_most(node, ty, origin, MOST_CHANGES_INSIDE, None)
    }

    fn join_between(&mut self, node: u32, ty: TyId, origin: u32, top: TyId) -> bool {
        self.join_at_most(node, ty, origin, MOST_CHANGES_BETWEEN, Some(top))
    }

    fn join_at_most(&mut self, node: u32, ty: TyId, origin: u32, most: u8, top: Option<TyId>) -> bool {
        let old = self.known[node as usize];
        let is_at_the_top = top.is_some() && self.changes[node as usize] > most;
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
            if *changes > most {
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
        let old = self.identity[node as usize];
        let new = if old == 0 || old == identity || identity == 0 { old.max(identity) } else { MANY };
        self.identity[node as usize] = new;
        self.has_changed |= new != old;
        new != old
    }

    fn identity_id(&mut self, identity: Identity) -> u32 {
        if let Some(&id) = self.identity_ids.get(&identity) {
            return id;
        }
        self.identities.push(identity);
        let id = self.identities.len() as u32 + MANY;
        self.identity_ids.insert(identity, id);
        id
    }

    fn identity_of(&self, index: usize, v: V) -> Option<Identity> {
        if v.is_none() {
            return None;
        }
        let id = self.identity[(self.first_value[index] + v.0) as usize];
        (id > MANY).then(|| self.identities[(id - MANY - 1) as usize])
    }

    fn raw_identity(&self, index: usize, v: V) -> u32 {
        if v.is_none() { MANY } else { self.identity[(self.first_value[index] + v.0) as usize] }
    }

    fn identify(&mut self, index: usize, func: &Func, v: V) -> u32 {
        let Some(op) = func.op(v) else { return MANY };
        match *op {
            Op::FreeGet { name, .. } if self.is_locked(name) => self.identity_id(Identity::Builtin(name, false)),
            Op::FuncRef(named) | Op::Closure { func: named, .. } | Op::ClosureOnce { func: named, .. } => self.identity_id(Identity::Function(named)),
            Op::PropGet { obj, name } => {
                let text = self.program.strs.get(name);
                match self.identity_of(index, obj) {
                    Some(Identity::Builtin(holder, false)) if text == b"prototype" => self.identity_id(Identity::Builtin(holder, true)),
                    Some(Identity::Builtin(holder, false)) if self.program.strs.get(holder) == b"globalThis" && is_locked_global_of_the_engine(text) => self.identity_id(Identity::Builtin(name, false)),
                    Some(Identity::Function(named)) if text == b"prototype" => self.identity_id(Identity::PrototypeOf(named)),
                    _ if self.raw_identity(index, obj) == 0 => 0,
                    _ => MANY,
                }
            }
            Op::Coerce { value, .. } => self.raw_identity(index, value),
            Op::GlobalGet(global) if !self.is_open_global[global.idx()] => self.identity[(self.globals + global.0) as usize],
            Op::FieldGet { layout, field, .. } if self.program.layouts[layout.idx()].kind == LayoutKind::Environment && !self.is_open_field[self.field_index(self.first_field[layout.idx()] + field)] => self.identity[(self.first_field[layout.idx()] + field) as usize],
            Op::CallDirect { func: called, .. } if self.is_whole && !self.program.funcs[called.idx()].has(func_flags::ASYNC | func_flags::GENERATOR) && self.program.funcs[called.idx()].kind != FuncKind::Constructor => self.identity[(self.results + called.0) as usize],
            _ => MANY,
        }
    }

    fn field_index(&self, node: u32) -> usize {
        (node - self.first_field.first().copied().unwrap_or(0)) as usize
    }

    fn key_of(&self, func: &Func, keys: &mut Keys, v: V, depth: u32) -> Option<u32> {
        let root = before_casts(func, v);
        let values = func.values.len() as u32;
        let path = |keys: &mut Keys, of: u32, step: u32, is_optimistic: bool| {
            let next = values + self.program.globals.len() as u32 + keys.paths.len() as u32;
            let key = *keys.paths.entry((of, step)).or_insert(next | if is_optimistic || of & OPTIMISTIC != 0 { OPTIMISTIC } else { 0 });
            Some(key)
        };
        match func.op(root) {
            Some(&Op::GlobalGet(global)) if self.program.globals[global.idx()].initialization == Initialization::NeverSeenAndStoredOnce => Some(values + global.0),
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
        let known = self.known[(self.first_value[index] + v.0) as usize];
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
                self.has_used_a_test |= met != known && !is_optimistic;
                met
            }
            Err(_) => known,
        }
    }

    fn origin_of(&self, index: usize, v: V) -> u32 {
        if v.is_none() { 0 } else { self.origin[(self.first_value[index] + v.0) as usize] }
    }

    fn add_fact(&mut self, func: &Func, keys: &mut Keys, facts: &mut Facts, v: V, bound: TyId) {
        let Some(key) = self.key_of(func, keys, v, 0) else { return };
        match facts.binary_search_by_key(&key, |fact| fact.0) {
            Ok(at) => facts[at].1 = self.meet(facts[at].1, bound),
            Err(at) => facts.insert(at, (key, bound)),
        }
    }

    fn mask_of_typeof(&mut self, text: &[u8]) -> Option<TyId> {
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

    fn add_shown(&mut self, index: usize, func: &Func, keys: &mut Keys, facts: &mut Facts, condition: V, sense: bool, depth: u32) {
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
        match func.op(before_casts(func, condition)) {
            Some(&Op::Not(inner)) => return self.add_shown(index, func, keys, facts, inner, !sense, depth + 1),
            Some(&Op::Truthy(inner)) => return self.add_shown(index, func, keys, facts, inner, sense, depth + 1),
            Some(&Op::IsNullish(inner)) => {
                let nil = self.common.nil;
                let bound = bound_by(self, nil, sense);
                return self.add_fact(func, keys, facts, inner, bound);
            }
            Some(&(Op::StrictEq { a, b } | Op::LooseEq { a, b })) => {
                let is_loose = matches!(func.op(before_casts(func, condition)), Some(Op::LooseEq { .. }));
                for (tested, other) in [(a, b), (b, a)] {
                    if let (Some(&Op::TypeOf(subject)), Some(&Op::Str(text))) = (func.op(before_casts(func, tested)), func.op(before_casts(func, other))) {
                        let text = self.program.strs.get(text).to_vec();
                        if let Some(mask) = self.mask_of_typeof(&text) {
                            let bound = bound_by(self, mask, sense);
                            self.add_fact(func, keys, facts, subject, bound);
                        }
                        return;
                    }
                }
                for (tested, other) in [(a, b), (b, a)] {
                    let compared = self.val(index, func, &Vec::new(), keys, other, false);
                    let described = self.get(compared).clone();
                    let is_nil = !described.is_never() && described.prims & !prim::NULLISH == 0 && described.ints.is_none() && !described.has_objects();
                    if is_loose {
                        if is_nil {
                            let nil = self.common.nil;
                            let bound = bound_by(self, nil, sense);
                            self.add_fact(func, keys, facts, tested, bound);
                        }
                        continue;
                    }
                    let is_one_value = is_nil && described.prims.count_ones() == 1 || described.prims.count_ones() == 1 && described.prims & prim::BOOLEAN != 0 && described.ints.is_none() && !described.has_objects();
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
            Some(Op::CallMethod { obj, name, args }) if self.program.strs.get(*name) == b"isArray" && args.len() == 1 && self.names_global(func, *obj, b"Array") => {
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

    fn names_global(&self, func: &Func, v: V, name: &[u8]) -> bool {
        matches!(func.op(before_casts(func, v)), Some(&Op::FreeGet { name: named, .. }) if self.program.strs.get(named) == name)
    }

    fn holder_of(&self, index: usize, v: V) -> Option<(&'a [u8], bool)> {
        match self.identity_of(index, v)? {
            Identity::Builtin(holder, is_prototype) => Some((self.program.strs.get(holder), is_prototype)),
            _ => None,
        }
    }

    fn is_of_the_engine_only(&self, receiver: &Declared) -> bool {
        !receiver.is_never() && !receiver.any_object && receiver.parts.iter().all(|part| !matches!(part, Part::Class(_)))
    }

    fn yields_what_it_holds(name: &[u8]) -> bool {
        matches!(name, b"at" | b"pop" | b"shift" | b"find" | b"findLast" | b"reduce" | b"reduceRight" | b"get" | b"getOrInsert" | b"getOrInsertComputed" | b"deref" | b"next" | b"call" | b"apply" | b"construct" | b"parse" | b"with")
    }

    fn natural_of_member(&mut self, index: usize, func: &Func, v: V, obj: V, name: StrId, receiver: TyId, is_call: bool) -> Natural {
        let text = self.program.strs.get(name);
        let wanted = self.get(self.declared(func, v)).clone();
        let names_types_of_the_program = wanted.parts.iter().any(|part| matches!(part, Part::Class(_)));
        if self.holder_of(index, obj).is_some() {
            return if is_call && (Flow::yields_what_it_holds(text) || names_types_of_the_program) { Natural::Unknown(Kind::Result) } else { Natural::Vouched };
        }
        let described = self.get(receiver).clone();
        if self.is_of_the_engine_only(&described) {
            return if is_call && (Flow::yields_what_it_holds(text) || names_types_of_the_program) { Natural::Unknown(Kind::Element) } else { Natural::Vouched };
        }
        let is_closed_view = |part: &Part| matches!(part, Part::Class(view) if view.is_some() && !self.program.layouts[view.idx()].admits_foreign);
        if !is_call && !described.any_object && !described.any_function && !described.parts.is_empty() && described.parts.iter().all(is_closed_view) {
            return Natural::Vouched;
        }
        Natural::Unknown(if is_call { Kind::Result } else { Kind::Read })
    }

    fn result_of_functions(&mut self, func: &Func, v: V, found: &[FuncId]) -> TyId {
        let mut joined = self.common.never;
        for &called in found {
            let callee = &self.program.funcs[called.idx()];
            let yielded = if callee.has(func_flags::ASYNC | func_flags::GENERATOR) || callee.kind == FuncKind::Constructor {
                self.declared(func, v)
            } else if !self.is_whole {
                if callee.result.is_none() { self.tys.anything } else { callee.result }
            } else {
                let known = self.known[(self.results + called.0) as usize];
                let declared = if callee.result.is_none() { self.tys.anything } else { callee.result };
                if known.is_none() { self.common.never } else { self.meet(known, declared) }
            };
            joined = self.join(joined, yielded);
        }
        joined
    }

    fn natural(&mut self, index: usize, func: &Func, facts: &Facts, keys: &mut Keys, v: V) -> Natural {
        let Some(op) = func.op(v) else { return Natural::Vouched };
        match op {
            &Op::PropGet { obj, name } => {
                let receiver = self.val(index, func, facts, keys, obj, false);
                if let Some((holder, is_prototype)) = self.holder_of(index, obj)
                    && is_prototype
                    && is_builtin_of_the_engine(holder, self.program.strs.get(name))
                    && !matches!(self.program.strs.get(name), b"length" | b"size" | b"byteLength" | b"byteOffset" | b"buffer" | b"description" | b"flags" | b"source")
                {
                    return Natural::Is(self.common.function);
                }
                if let Some((holder, false)) = self.holder_of(index, obj)
                    && is_builtin_of_the_engine(holder, self.program.strs.get(name))
                {
                    if self.says_something(func.ty(v)) {
                        let there = Declared { prims: self.get(func.ty(v)).prims & !prim::NULLISH, ..self.get(func.ty(v)).clone() };
                        return Natural::Is(self.tys.intern(there));
                    }
                    let is_number = matches!(holder, b"Math" | b"Number") && self.program.strs.get(name).first().is_some_and(u8::is_ascii_uppercase);
                    return Natural::Is(if is_number { self.common.number } else { self.tys.intern(Declared { prims: prim::SYMBOL, any_object: true, any_function: true, ..Declared::default() }) });
                }
                self.natural_of_member(index, func, v, obj, name, receiver, false)
            }
            &Op::ElemGet { obj, .. } => {
                if func.prediction(v) == Prediction::Stores {
                    return Natural::Vouched;
                }
                let receiver = self.val(index, func, facts, keys, obj, false);
                let described = self.get(receiver);
                let holds_numbers = !described.is_never() && !described.any_object && !described.any_function && described.parts.iter().all(|part| matches!(part, Part::Global(name, _) if self.program.strs.get(*name).ends_with(b"Array")));
                if holds_numbers { Natural::Vouched } else { Natural::Unknown(Kind::Element) }
            }
            Op::IterGet { .. } => {
                if func.prediction(v) == Prediction::Stores { Natural::Vouched } else { Natural::Unknown(Kind::Element) }
            }
            Op::Call { callee, .. } => {
                if let Some(found) = self.called_at(index, func, v) {
                    return Natural::Is(self.result_of_functions(func, v, &found));
                }
                match func.op(before_casts(func, *callee)) {
                    Some(&Op::FreeGet { name, .. }) if self.is_locked(name) => Natural::Vouched,
                    Some(&Op::PropGet { obj, name }) => {
                        let receiver = self.val(index, func, facts, keys, obj, false);
                        self.natural_of_member(index, func, v, obj, name, receiver, true)
                    }
                    _ => Natural::Unknown(Kind::Result),
                }
            }
            &Op::CallMethod { obj, name, .. } => {
                if let Some(found) = self.called_at(index, func, v) {
                    return Natural::Is(self.result_of_functions(func, v, &found));
                }
                let receiver = self.val(index, func, facts, keys, obj, false);
                self.natural_of_member(index, func, v, obj, name, receiver, true)
            }
            Op::Construct { callee, .. } => {
                if matches!(self.identity_of(index, *callee), Some(Identity::Builtin(..) | Identity::Function(_))) { Natural::Vouched } else { Natural::Unknown(Kind::Result) }
            }
            &Op::Await(awaited) => {
                let value = self.val(index, func, facts, keys, awaited, false);
                if self.get(value).has_objects() { Natural::Unknown(Kind::Await) } else { Natural::Is(value) }
            }
            Op::Operation { .. } => Natural::Vouched,
            _ => Natural::Vouched,
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
        let (had, tried, yielded) = (self.get(have).clone(), self.get(to).clone(), self.get(result).clone());
        if had.is_never() {
            return self.common.never;
        }
        let mut made = Declared { prims: had.prims & prim::NULLISH, ..Declared::default() };
        let kinds = kinds_of(&had);
        if kinds != 0 {
            if kinds & !kinds_of(&tried) == 0 {
                made.prims |= had.prims & !prim::NULLISH;
                made.ints = had.ints;
            } else {
                made.prims |= tried.prims & !prim::NULLISH;
                if tried.ints.is_some() {
                    made.prims |= prim::NUMBER;
                }
                if tried.prims & prim::BOOLEAN != 0 {
                    made.prims |= prim::BOOLEAN;
                }
            }
        }
        if had.has_objects() {
            made.parts = yielded.parts.clone();
            made.any_object = yielded.any_object;
            made.any_function = yielded.any_function;
        }
        self.tys.intern(made)
    }

    fn transfer(&mut self, index: usize, func: &Func, facts: &Facts, keys: &mut Keys, v: V) -> (TyId, u32) {
        let declared = self.declared(func, v);
        let own = self.first_value[index] + v.0 + 1;
        let Some(op) = func.op(v) else { return (declared, 0) };
        match op {
            Op::Undefined => (self.common.undefined, 0),
            Op::Null => (self.common.null, 0),
            &Op::Bool(value) => (if value { self.common.yes } else { self.common.no }, 0),
            &Op::Int(value) => (self.tys.intern(Declared::int(value)), 0),
            Op::Double(_) => (self.common.number, 0),
            Op::Str(_) | Op::ToStr(_) | Op::StrConcat(_) | Op::TypeOf(_) => (self.common.string, 0),
            Op::BigInt(_) => (self.common.bigint, 0),
            Op::FuncRef(_) | Op::Closure { .. } | Op::ClosureOnce { .. } => (self.common.function, 0),
            &(Op::New(layout) | Op::NewWith { layout, .. }) => (self.tys.intern(Declared::part(Part::Class(layout))), 0),
            Op::NewArray(_) => (if self.get(declared).parts.iter().any(|part| matches!(part, Part::Array(_))) && !self.get(declared).any_object { self.meet(declared, self.common.objects) } else { self.common.array }, 0),
            Op::NewObject => (self.common.object, 0),
            &Op::GlobalGet(global) => {
                if self.is_open_global[global.idx()] {
                    return (declared, if self.says_something(declared) { 0 } else { own });
                }
                let node = self.globals + global.0;
                let stored = self.known[node as usize];
                let stored = if stored.is_none() { self.common.never } else { stored };
                let stored = if matches!(self.program.globals[global.idx()].initialization, Initialization::Undefined | Initialization::Lazy) { self.join(stored, self.common.undefined) } else { stored };
                (self.meet(stored, declared), self.origin[node as usize])
            }
            &Op::GlobalSet(global, value) => {
                let stored = self.val(index, func, facts, keys, value, false);
                let origin = self.origin_of(index, value);
                let identity = self.raw_identity(index, value);
                if self.join_between(self.globals + global.0, stored, origin, self.tys.anything) | self.join_identity(self.globals + global.0, identity) {
                    self.wake_all(|flow| &flow.readers_of_global, global.idx());
                }
                (self.common.undefined, 0)
            }
            &Op::FieldGet { layout, field, .. } => {
                let node = self.first_field[layout.idx()] + field;
                if self.program.layouts[layout.idx()].kind != LayoutKind::Environment || self.is_open_field[self.field_index(node)] {
                    return (declared, 0);
                }
                let stored = self.known[node as usize];
                let stored = if stored.is_none() { self.common.never } else { stored };
                let is_seen_blank = self.program.layouts[layout.idx()].fields[field as usize].flags & field_flags::NEVER_SEEN_UNINITIALIZED == 0;
                let stored = if is_seen_blank { self.join(stored, self.common.undefined) } else { stored };
                (self.meet(stored, declared), self.origin[node as usize])
            }
            &Op::FieldSet { layout, field, value, .. } => {
                if self.program.layouts[layout.idx()].kind == LayoutKind::Environment {
                    let stored = self.val(index, func, facts, keys, value, false);
                    let origin = self.origin_of(index, value);
                    let identity = self.raw_identity(index, value);
                    if self.join_between(self.first_field[layout.idx()] + field, stored, origin, self.tys.anything) | self.join_identity(self.first_field[layout.idx()] + field, identity) {
                        let at = self.field_index(self.first_field[layout.idx()] + field);
                        self.wake_all(|flow| &flow.readers_of_field, at);
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
                (match truthiness(self.get(operand)) {
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
                    if let (Some(&Op::TypeOf(subject)), Some(&Op::Str(text))) = (func.op(before_casts(func, tested)), func.op(before_casts(func, other))) {
                        let text = self.program.strs.get(text).to_vec();
                        let Some(mask) = self.mask_of_typeof(&text) else { return (self.common.no, 0) };
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
                let (x, y) = (self.val(index, func, facts, keys, a, false), self.val(index, func, facts, keys, b, false));
                let (p, q) = (self.get(x), self.get(y));
                let is_one_nil = |d: &Declared| d.prims & !prim::NULLISH == 0 && d.prims.count_ones() == 1 && d.ints.is_none() && !d.has_objects();
                (if p.is_never() || q.is_never() {
                    self.common.boolean
                } else if shares_nothing(p, q) {
                    self.common.no
                } else if x == y && is_one_nil(p) {
                    self.common.yes
                } else {
                    self.common.boolean
                }, 0)
            }
            &Op::PropHas { obj, name } if self.holder_of(index, obj).is_some_and(|(holder, _)| is_builtin_of_the_engine(holder, self.program.strs.get(name))) => (self.common.yes, 0),
            Op::Relational { .. } | Op::LooseEq { .. } | Op::InstanceOf { .. } | Op::IsInstance { .. } | Op::PropHas { .. } | Op::PropDelete { .. } | Op::ElemHas { .. } | Op::ElemDelete { .. } | Op::IterHas { .. } => (self.common.boolean, 0),
            Op::FreeSet { .. } | Op::PropSet { .. } | Op::ElemSet { .. } | Op::IterClose(_) | Op::IterCloseForThrow(_) | Op::Poll => (self.common.undefined, 0),
            &Op::FreeGet { name, .. } => match self.program.strs.get(name) {
                b"undefined" => (self.common.undefined, 0),
                b"NaN" | b"Infinity" => (self.common.number, 0),
                _ if self.is_locked(name) => (self.common.objects, 0),
                _ => (declared, own),
            },
            Op::CallDirect { func: called, args } => {
                let (called, args) = (*called, args.clone());
                if self.is_closed[called.idx()] {
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
                let yielded = self.result_of_functions(func, v, &[called]);
                (self.meet(yielded, declared), self.origin[(self.results + called.0) as usize])
            }
            &Op::Coerce { value, to, why } => {
                let have = self.val(index, func, facts, keys, value, false);
                let origin = self.origin_of(index, value);
                let origin = if origin & !CONTEXTUAL == 0 && matches!(why, Why::Coerce | Why::CoerceFreshGraph) { origin | own } else { origin };
                let origin = if why == Why::Flow { origin | CONTEXTUAL } else { origin };
                let held = match why {
                    Why::Coerce | Why::CoerceFreshGraph => self.coerced(have, to, declared),
                    Why::Cast | Why::CastFresh | Why::Flow if self.get(have).has_objects() => {
                        let met = meet(self.get(have), self.get(declared));
                        let wanted = self.get(declared);
                        let made = Declared { parts: wanted.parts.clone(), any_object: wanted.any_object, any_function: wanted.any_function, ..met };
                        self.tys.intern(made)
                    }
                    _ => self.meet(have, declared),
                };
                let origin = if matches!(why, Why::Upcast | Why::Forced) && held != have { origin | CONTEXTUAL } else { origin };
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
                match self.natural(index, func, facts, keys, v) {
                    Natural::Vouched => (declared, 0),
                    Natural::Is(ty) => (self.meet(ty, declared), from),
                    Natural::Unknown(_) => (declared, if from & !CONTEXTUAL != 0 { from } else { from | own }),
                }
            }
        }
    }

    fn flow_to(&mut self, index: usize, func: &Func, keys: &mut Keys, reached: &mut [Option<Facts>], from: &Facts, target: &Target, leaving: Facts) {
        let at = target.block.idx();
        for (&parameter, &argument) in func.blocks[at].params.iter().zip(&target.args) {
            self.has_used_a_test = false;
            let handed = self.val(index, func, from, keys, argument, false);
            let taken = self.declared(func, parameter);
            let handed = self.meet(handed, taken);
            let origin = self.origin_of(index, argument) | if self.has_used_a_test { CONTEXTUAL } else { 0 };
            self.join_into(self.first_value[index] + parameter.0, handed, origin);
            let identity = self.raw_identity(index, argument);
            self.join_identity(self.first_value[index] + parameter.0, identity);
        }
        match &mut reached[at] {
            None => {
                reached[at] = Some(leaving);
                self.has_moved = true;
            }
            Some(held) => {
                let before = held.len();
                let mut kept: Facts = Vec::with_capacity(before);
                let mut is_weaker = false;
                let mut others = leaving.iter().peekable();
                for &(key, bound) in held.iter() {
                    while others.next_if(|other| other.0 < key).is_some() {}
                    if let Some(&&(_, other)) = others.peek().filter(|other| other.0 == key) {
                        let joined = self.join(bound, other);
                        is_weaker |= joined != bound;
                        kept.push((key, joined));
                    }
                }
                if kept.len() != before || is_weaker {
                    reached[at] = Some(kept);
                    self.has_moved = true;
                }
            }
        }
    }

    fn run(&mut self, index: usize) -> (Vec<Option<Facts>>, Keys) {
        let func = &self.program.funcs[index];
        let mut keys = Keys::default();
        let mut reached: Vec<Option<Facts>> = vec![None; func.blocks.len()];
        if func.blocks.is_empty() {
            return (reached, keys);
        }
        let (order, has_loops): (Rc<[usize]>, bool) = if self.is_whole {
            self.orders[index].get_or_insert_with(|| { let (order, has_loops) = in_reverse_postorder(func); (order.into(), has_loops) }).clone()
        } else {
            (straight_from_the_entry(&self.never_return, func).into(), false)
        };
        let mut has_changed = self.has_changed;
        if !self.is_closed[index] {
            for &parameter in &func.blocks[0].params {
                let declared = self.declared(func, parameter);
                let own = self.first_value[index] + parameter.0;
                self.join_into(own, declared, if self.says_something(declared) { 0 } else { own + 1 });
                self.join_identity(own, MANY);
            }
        }
        has_changed |= self.has_changed;
        reached[0] = Some(Vec::new());
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
            self.has_used_a_test = false;
            let (ty, origin) = self.transfer(index, func, facts, keys, v);
            let origin = origin | if self.has_used_a_test { CONTEXTUAL } else { 0 };
            self.join_into(self.first_value[index] + v.0, ty, origin);
            let identity = self.identify(index, func, v);
            self.join_identity(self.first_value[index] + v.0, identity);
            if !comes_back(&self.never_return, func, v) {
                if let Some(Term::Invoke { unwind, .. }) = func.blocks[at].term.as_ref() {
                    self.flow_to(index, func, keys, reached, facts, unwind, facts.clone());
                }
                return;
            }
        }
        match func.blocks[at].term.as_ref() {
            Some(Term::Branch { cond, then, otherwise }) => {
                let tested = self.val(index, func, facts, keys, *cond, false);
                let decided = truthiness(self.get(tested));
                for (target, sense) in [(then, true), (otherwise, false)] {
                    if decided == Some(!sense) {
                        continue;
                    }
                    let mut leaving = facts.clone();
                    self.add_shown(index, func, keys, &mut leaving, *cond, sense, 0);
                    self.flow_to(index, func, keys, reached, facts, target, leaving);
                }
            }
            Some(&Term::Return(value)) => {
                self.has_used_a_test = false;
                let returned = self.val(index, func, facts, keys, value, false);
                let origin = self.origin_of(index, value) | if self.has_used_a_test { CONTEXTUAL } else { 0 };
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

fn comes_back(never_return: &[bool], func: &Func, v: V) -> bool {
    !matches!(func.op(v), Some(Op::CallDirect { func: called, .. }) if never_return[called.idx()])
}

fn functions_that_never_return(program: &Program) -> Vec<bool> {
    let mut never_return = vec![false; program.funcs.len()];
    loop {
        let mut has_changed = false;
        for (index, func) in program.funcs.iter().enumerate() {
            if never_return[index] || func.blocks.is_empty() || func.has(func_flags::ASYNC | func_flags::GENERATOR) {
                continue;
            }
            let (mut seen, mut pending, mut returns) = (vec![false; func.blocks.len()], vec![0usize], false);
            seen[0] = true;
            while let Some(at) = pending.pop() {
                let goes_on = func.blocks[at].ops.iter().all(|&v| comes_back(&never_return, func, v));
                let term = func.blocks[at].term.as_ref();
                returns |= goes_on && matches!(term, Some(Term::Return(_)));
                for (way, target) in targets_of(term).into_iter().enumerate() {
                    let is_unwind = matches!(term, Some(Term::Invoke { .. })) && way == 1 || matches!(term, Some(Term::Throw { .. }));
                    if (goes_on || is_unwind) && !std::mem::replace(&mut seen[target.block.idx()], true) {
                        pending.push(target.block.idx());
                    }
                }
            }
            if !returns {
                never_return[index] = true;
                has_changed = true;
            }
        }
        if !has_changed {
            return never_return;
        }
    }
}

fn straight_from_the_entry(never_return: &[bool], func: &Func) -> Vec<usize> {
    let mut ways_in = vec![0u32; func.blocks.len()];
    for target in func.blocks.iter().flat_map(|block| targets_of(block.term.as_ref())) {
        ways_in[target.block.idx()] += 1;
    }
    let mut order = Vec::new();
    let mut next = (!func.blocks.is_empty()).then_some(0);
    while let Some(at) = next.filter(|at| !order.contains(at)) {
        order.push(at);
        next = match func.blocks[at].term.as_ref() {
            Some(Term::Jump(target) | Term::Invoke { normal: target, .. }) => Some(target.block.idx()).filter(|&to| (ways_in[to] == 1 || func.blocks[to].params.is_empty()) && func.blocks[at].ops.iter().all(|&v| comes_back(never_return, func, v))),
            _ => None,
        };
    }
    order
}

fn surely_run(program: &Program, never_return: &[bool]) -> Vec<bool> {
    let mut surely = vec![false; program.funcs.len()];
    let mut pending: Vec<usize> = program.entries.iter().filter(|entry| entry.is_some()).map(|entry| entry.idx()).collect();
    while let Some(index) = pending.pop() {
        if std::mem::replace(&mut surely[index], true) {
            continue;
        }
        let func = &program.funcs[index];
        let evaluates_a_module_once = func.kind == FuncKind::Module && func.has(func_flags::IS_HIDDEN_IN_STACK_TRACES);
        let blocks = if evaluates_a_module_once { (0..func.blocks.len()).collect() } else { straight_from_the_entry(never_return, func) };
        for &at in &blocks {
            for &v in &func.blocks[at].ops {
                if let Some(Op::CallDirect { func: called, .. }) = func.op(v) {
                    pending.push(called.idx());
                }
                if !comes_back(never_return, func, v) {
                    break;
                }
            }
        }
    }
    surely
}

fn in_reverse_postorder(func: &Func) -> (Vec<usize>, bool) {
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
                    String::from_utf8_lossy(program.strs.get(layout.name)).into_owned()
                } else {
                    let names: Vec<String> = layout.fields.iter().take(4).map(|field| String::from_utf8_lossy(program.strs.get(field.name)).into_owned()).collect();
                    format!("{{ {}{} }}", names.join(", "), if layout.fields.len() > 4 { ", ..." } else { "" })
                }
            });
        }
    }
    for part in &ty.parts {
        match part {
            Part::Class(_) => {}
            Part::Global(name, _) => parts.push(String::from_utf8_lossy(program.strs.get(*name)).into_owned()),
            Part::Array(element) if depth < 2 && element.is_some() => {
                let element = text_of(program, program.tys.get(*element), depth + 1);
                parts.push(if element.contains(" | ") { format!("({element})[]") } else { format!("{element}[]") });
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
        Some((least, most)) if least == most => parts.push(least.to_string()),
        Some((least, most)) => parts.push(format!("integer {least}..{most}")),
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
    let shown = String::from_utf8_lossy(&text[..text.len().min(24)]).into_owned();
    format!("{:?}{}", shown, if text.len() > 24 { ".." } else { "" })
}

struct Report<'a, 'b> {
    flow: &'b mut Flow<'a>,
    sites: Vec<Site>,
    fine: FxHashMap<Kind, usize>,
    class_of: FxHashMap<FuncId, LayoutId>,
    throws_either_way: usize,
    at: V,
    name: Option<&'static str>,
    value: String,
    passes_somewhere: FxHashSet<(u32, u32, Kind)>,
    is_behind_a_test: bool,
    is_surely_run: bool,
    risk: &'static str,
    call: Option<(u32, u32)>,
    is_at_an_entry: bool,
    has_an_entry_that_tests: Vec<bool>,
}

impl<'a> Report<'a, '_> {
    fn name_of_function(&self, func: &Func) -> String {
        let name = if func.name.is_some() { self.flow.program.strs.get(func.name) } else { b"" };
        if name.is_empty() { "a function".to_owned() } else { format!("`{}`", String::from_utf8_lossy(name)) }
    }

    fn locate(&self, node: u32) -> Option<(usize, V)> {
        if node >= self.flow.results {
            return None;
        }
        let index = self.flow.first_value.partition_point(|&first| first <= node) - 1;
        Some((index, V(node - self.flow.first_value[index])))
    }

    fn describe_callee(&self, func: &Func, callee: V) -> String {
        let strs = &self.flow.program.strs;
        match func.op(before_casts(func, callee)) {
            Some(&Op::FreeGet { name, .. }) => String::from_utf8_lossy(strs.get(name)).into_owned(),
            Some(&Op::PropGet { obj, name }) => format!("{}.{}", self.describe_callee(func, obj), String::from_utf8_lossy(strs.get(name))),
            Some(&Op::GlobalGet(global)) if self.flow.program.globals[global.idx()].name.is_some() => String::from_utf8_lossy(strs.get(self.flow.program.globals[global.idx()].name)).into_owned(),
            _ => "..".to_owned(),
        }
    }

    fn origin(&self, origin: u32) -> Option<(u32, u32, String)> {
        let (index, v) = self.locate(origin.checked_sub(1)?)?;
        let func = &self.flow.program.funcs[index];
        let strs = &self.flow.program.strs;
        let text = |name: StrId| if name.is_some() { String::from_utf8_lossy(strs.get(name)).into_owned() } else { "..".to_owned() };
        let what = match &func.values[v.idx()].def {
            Def::Param(..) => format!("a parameter of {}, which callers that the compiler does not see may call", self.name_of_function(func)),
            Def::Op(Op::CallMethod { obj, name, .. }) => format!("{}.{}(..)", self.describe_callee(func, *obj), text(*name)),
            Def::Op(Op::Call { callee, .. }) => format!("{}(..)", self.describe_callee(func, *callee)),
            Def::Op(Op::Construct { callee, .. }) => format!("new {}(..)", self.describe_callee(func, *callee)),
            Def::Op(Op::PropGet { obj, name }) => format!("{}.{}", self.describe_callee(func, *obj), text(*name)),
            Def::Op(Op::ElemGet { obj, .. }) => format!("an element of {}", self.describe_callee(func, *obj)),
            Def::Op(Op::IterGet { .. }) => "what a loop steps through".to_owned(),
            Def::Op(Op::FreeGet { name, .. }) => format!("the global {}", text(*name)),
            Def::Op(Op::GlobalGet(global)) => format!("the variable {}", text(self.flow.program.globals[global.idx()].name)),
            Def::Op(Op::Caught) => "a caught exception".to_owned(),
            Def::Op(Op::Coerce { to, .. }) => format!("`as {}`", text_of(self.flow.program, self.flow.program.tys.get(*to), 0)),
            Def::Op(Op::Await(_)) => "what is awaited".to_owned(),
            Def::Op(Op::Yield(_)) => "what the generator is resumed with".to_owned(),
            Def::Op(Op::ExternalModule(specifier)) => format!("the module {}, which is not compiled with the program", quoted(strs.get(*specifier))),
            Def::Op(Op::Operation { name, .. }) => format!("the operation {}", text(*name)),
            _ => "a value that nothing vouches for".to_owned(),
        };
        let pos = match func.values[v.idx()].def {
            Def::Param(..) => func.pos,
            _ => func.values[v.idx()].pos,
        };
        Some((func.module.0, pos, what))
    }

    fn risk_of(&self, wanted: &Declared) -> &'static str {
        let read = self.as_the_engine_reads(wanted);
        if !read.has_objects() {
            "primitive"
        } else if read.any_object || read.parts.iter().any(|part| matches!(part, Part::Class(view) if view.is_some() && self.flow.program.layouts[view.idx()].admits_foreign)) {
            "open"
        } else {
            "closed"
        }
    }

    fn door_of(&self, origin: u32) -> String {
        let Some((index, v)) = origin.checked_sub(1).and_then(|node| self.locate(node)) else { return String::new() };
        let program = self.flow.program;
        let func = &program.funcs[index];
        let text = |name: StrId| if name.is_some() { String::from_utf8_lossy(program.strs.get(name)).into_owned() } else { "..".to_owned() };
        let path = if func.module.is_some() { text(program.modules[func.module.idx()].display_path) } else { "..".to_owned() };
        if let Some((_, inside)) = path.rsplit_once("node_modules/") {
            let mut names = inside.split('/');
            let first = names.next().unwrap_or_default();
            return format!("the package {}", if first.starts_with('@') { format!("{first}/{}", names.next().unwrap_or_default()) } else { first.to_owned() });
        }
        if func.has(func_flags::IS_BUILTIN | func_flags::IS_OF_BUILTIN_MODULE) {
            return format!("the runtime's {path}");
        }
        if !func.has(func_flags::IS_TYPED) {
            return format!("untyped code: {path}");
        }
        match &func.values[v.idx()].def {
            Def::Op(Op::FreeGet { name, .. }) => format!("the global {}", text(*name)),
            Def::Op(Op::ExternalModule(specifier)) => format!("the module {}", text(*specifier)),
            Def::Op(Op::Caught | Op::CaughtException) => "caught exceptions".to_owned(),
            Def::Op(Op::Coerce { .. }) => format!("`as` in {path}"),
            Def::Op(Op::CallMethod { obj, name, .. }) if self.flow.holder_of(index, *obj).is_some() => format!("{}.{}", self.describe_callee(func, *obj), text(*name)),
            Def::Param(..) => format!("parameters typed `any` in {path}"),
            _ => format!("values typed `any` in {path}"),
        }
    }

    fn tier_of(&self, kind: Kind, origin: u32) -> Tier {
        if matches!(kind, Kind::BuiltinWrite | Kind::PrototypeWrite | Kind::Mutation | Kind::Caller | Kind::Parameter) {
            return Tier::Rule;
        }
        let asserted = if matches!(kind, Kind::As | Kind::NonNull) { Tier::Assertion } else { Tier::Typed };
        let Some((index, v)) = origin.checked_sub(1).and_then(|node| self.locate(node)) else { return asserted };
        let func = &self.flow.program.funcs[index];
        let is_typed = |v: V| func.has(func_flags::IS_TYPED) && self.flow.says_something(func.ty(v)) && !self.flow.program.tys.get(func.ty(v)).any_object;
        let by = |v: V| if is_typed(v) { asserted } else { Tier::Outside };
        match &func.values[v.idx()].def {
            Def::Op(Op::Coerce { .. }) => Tier::Assertion,
            Def::Op(Op::CallMethod { obj, .. } | Op::PropGet { obj, .. } | Op::ElemGet { obj, .. } | Op::Await(obj) | Op::Construct { callee: obj, .. }) => {
                if self.flow.holder_of(index, *obj).is_some() { Tier::Outside } else { by(*obj) }
            }
            Def::Op(Op::IterGet { iter, .. }) => match func.op(*iter) {
                Some(&Op::IterOpen(of)) => by(of),
                _ => Tier::Outside,
            },
            Def::Op(Op::Call { callee, .. }) => match func.op(before_casts(func, *callee)) {
                Some(&Op::PropGet { obj, .. }) if self.flow.holder_of(index, obj).is_none() => by(obj),
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
            &Op::BigInt(text) => format!("{}n", String::from_utf8_lossy(self.flow.program.strs.get(text))),
            _ => return None,
        })
    }

    fn double(&self, func: &Func, v: V) -> Option<f64> {
        let mut root = v;
        while let Some(&Op::Coerce { value, .. }) = func.op(root) {
            root = value;
        }
        match func.op(root)? {
            &Op::Double(bits) => Some(f64::from_bits(bits)),
            &Op::Unary { op: UnOp::Neg, a } if matches!(func.op(a), Some(Op::Int(0))) => Some(-0.0),
            _ => None,
        }
    }

    fn fits(&self, a: &Declared, b: &Declared) -> bool {
        let layouts = &self.flow.program.layouts;
        if a.prims & !b.prims != 0 || a.any_object && !b.any_object {
            return false;
        }
        if let Some((least, most)) = a.ints
            && b.prims & prim::NUMBER == 0
            && !b.ints.is_some_and(|within| within.0 <= least && most <= within.1)
        {
            return false;
        }
        let admits = b.any_object || b.parts.iter().any(|part| matches!(part, Part::Class(view) if view.is_some() && layouts[view.idx()].admits_foreign));
        if a.any_function && !b.any_function && !admits {
            return false;
        }
        b.any_object
            || a.parts.iter().all(|part| match part {
                Part::Class(made) => {
                    let is_held = |made: &LayoutId| b.parts.iter().any(|within| matches!(within, Part::Class(view) if view == made || view.is_some() && layouts[view.idx()].members.binary_search(made).is_ok()));
                    is_held(made) || made.is_some() && (!layouts[made.idx()].admits_foreign || admits) && layouts[made.idx()].members.iter().all(is_held)
                }
                Part::Array(_) => admits || b.parts.iter().any(|within| matches!(within, Part::Array(_))),
                Part::Global(name, _) => admits || b.parts.iter().any(|within| matches!(within, Part::Global(same, _) if same == name)),
            })
    }

    fn objects_share_nothing(&self, a: &Declared, b: &Declared) -> bool {
        let layouts = &self.flow.program.layouts;
        if a.any_object || a.any_function || b.any_object || b.any_function {
            return false;
        }
        a.parts.iter().all(|x| {
            b.parts.iter().all(|y| match (x, y) {
                (&Part::Class(p), &Part::Class(q)) => {
                    let (p_as, q_as) = (&layouts[p.idx()], &layouts[q.idx()]);
                    let holds = |view: &crate::ir::Layout, own: LayoutId, made: LayoutId| own == made || view.members.binary_search(&made).is_ok();
                    p != q && !p_as.admits_foreign && !q_as.admits_foreign && !p_as.members.iter().chain([&p]).any(|&made| holds(q_as, q, made)) && !q_as.members.iter().any(|&made| holds(p_as, p, made))
                }
                (&Part::Class(view), _) | (_, &Part::Class(view)) => !layouts[view.idx()].admits_foreign,
                _ => false,
            })
        })
    }

    fn as_the_engine_reads(&self, ty: &Declared) -> Declared {
        let strs = &self.flow.program.strs;
        let is_told_apart = |name: &[u8]| matches!(name, b"Map" | b"Set" | b"WeakMap" | b"WeakSet" | b"WeakRef" | b"Promise" | b"RegExp" | b"Date" | b"Error" | b"ArrayBuffer" | b"SharedArrayBuffer" | b"DataView" | b"FinalizationRegistry") || name.ends_with(b"Array") && name.len() > 5 && is_locked_global_of_the_engine(name);
        if ty.parts.iter().all(|part| !matches!(part, Part::Global(name, _) if !is_told_apart(strs.get(*name)))) {
            return ty.clone();
        }
        let mut read = Declared { parts: Default::default(), ..ty.clone() };
        for part in &ty.parts {
            match part {
                Part::Global(name, _) if strs.get(*name) == b"Function" || strs.get(*name) == b"CallableFunction" || strs.get(*name) == b"NewableFunction" => read.any_function = true,
                Part::Global(name, _) if !is_told_apart(strs.get(*name)) => (read.any_object, read.any_function) = (true, true),
                part => read.parts.push(part.clone()),
            }
        }
        if read.any_object {
            read.parts.clear();
        }
        read
    }

    fn judge(&self, why: Option<Why>, sure: &Declared, likely: &Declared, to: &Declared) -> Verdict {
        if sure.is_never() || likely.is_never() {
            return Verdict::Fine;
        }
        let (sure, likely, to) = (&self.as_the_engine_reads(sure), &self.as_the_engine_reads(likely), &self.as_the_engine_reads(to));
        match why {
            Some(Why::NonNull(_)) => {
                if likely.prims & prim::NULLISH == 0 {
                    Verdict::Fine
                } else if sure.prims & !prim::NULLISH == 0 && sure.ints.is_none() && !sure.has_objects() {
                    Verdict::Wrong
                } else {
                    Verdict::Unknown
                }
            }
            Some(Why::Coerce | Why::CoerceFreshGraph) => {
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
                let may_make_another = matches!(why, Some(Why::Cast | Why::CastFresh | Why::Flow));
                if self.fits(likely, to) {
                    Verdict::Fine
                } else if shares_nothing(sure, to) || !may_make_another && shares_nothing(&Declared { parts: Default::default(), any_object: false, any_function: false, ..sure.clone() }, to) && self.objects_share_nothing(sure, to) {
                    Verdict::Wrong
                } else {
                    Verdict::Unknown
                }
            }
        }
    }

    fn uses_in(&self, func: &Func) -> FxHashMap<V, (Kind, Use)> {
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
                    Some(Op::Operation { name, args }) if program.strs.get(*name) == b"Initialize" => {
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
                        uses.entry(value).or_insert((Kind::Variable, Use::Named(program.globals[global.idx()].name)));
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

    fn text_of_use(&self, func: &Func, used: Use) -> String {
        let program = self.flow.program;
        let text = |name: StrId| if name.is_some() { String::from_utf8_lossy(program.strs.get(name)).into_owned() } else { String::new() };
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
        self.passes_somewhere.insert((func.module.0, pos, kind));
        if verdict == Verdict::Fine {
            *self.fine.entry(kind).or_default() += 1;
        }
        true
    }

    fn add(&mut self, func: &Func, pos: u32, kind: Kind, verdict: Verdict, expected: String, found: String, detail: String, origin: u32) {
        let judged = verdict;
        let verdict = if origin & CONTEXTUAL != 0 || self.flow.has_used_a_test || self.is_behind_a_test || !self.is_surely_run && matches!(kind, Kind::BuiltinWrite | Kind::PrototypeWrite | Kind::Mutation | Kind::Caller) { verdict.min(Verdict::Unknown) } else { verdict };
        let origin = origin & !CONTEXTUAL;
        if verdict != Verdict::Wrong {
            self.passes_somewhere.insert((func.module.0, pos, kind));
        }
        if verdict == Verdict::Fine {
            *self.fine.entry(kind).or_default() += 1;
            (self.name, self.value, self.risk, self.call, self.is_at_an_entry) = (None, String::new(), "", None, false);
            return;
        }
        let tier = match self.tier_of(kind, origin) {
            Tier::Assertion if self.name == Some("as-refuse") && !matches!(origin.checked_sub(1).and_then(|node| self.locate(node)), Some((of, cast)) if matches!(self.flow.program.funcs[of].op(cast), Some(Op::Coerce { .. }))) => Tier::Typed,
            Tier::Typed if judged == Verdict::Wrong || kind == Kind::Integer => Tier::Assertion,
            Tier::Typed if self.name == Some("construct-new-target") => Tier::Rule,
            Tier::Typed if origin == 0 && matches!(func.op(self.at), Some(&Op::Coerce { value, .. }) if !self.flow.says_something(func.ty(value))) => Tier::Outside,
            tier => tier,
        };
        let detail = match (judged, detail.is_empty()) {
            (Verdict::Wrong, true) if verdict != Verdict::Wrong => "it always fails if this line runs".to_owned(),
            (Verdict::Wrong, false) if verdict != Verdict::Wrong => format!("{detail}: it always fails if this line runs"),
            _ => detail,
        };
        let door = self.door_of(origin);
        let door = if door.is_empty() && tier == Tier::Outside && func.module.is_some() { format!("values typed `any` in {}", String::from_utf8_lossy(self.flow.program.strs.get(self.flow.program.modules[func.module.idx()].display_path))) } else { door };
        let origin = self.origin(origin);
        let what = match func.op(self.at) {
            Some(Op::Coerce { why, .. }) => match why {
                Why::Store => "Store",
                Why::Cast | Why::CastFresh => "As",
                Why::NonNull(_) => "NonNull",
                Why::Claim => "Claim",
                Why::Flow => "Flow",
                Why::Upcast | Why::Forced => "Upcast",
                Why::Coerce | Why::CoerceFreshGraph => "Coerce",
            }
            .to_owned(),
            Some(_) => format!("{:?}", crate::format::record(&func.values[self.at.idx()].def).opcode),
            None => String::new(),
        };
        let function = if func.kind == FuncKind::Module {
            "module".to_owned()
        } else if func.name.is_some() && !self.flow.program.strs.get(func.name).is_empty() {
            String::from_utf8_lossy(self.flow.program.strs.get(func.name)).into_owned()
        } else {
            "<anonymous>".to_owned()
        };
        let (name, value) = (self.name.take().unwrap_or_else(|| kind.name()), std::mem::take(&mut self.value));
        let risk = std::mem::take(&mut self.risk);
        let call = self.call.take();
        let is_at_an_entry = std::mem::take(&mut self.is_at_an_entry);
        self.sites.push(Site { is_at_an_entry, call, risk, door, name, what, function, value, tier, module: func.module.0, pos, kind, verdict, expected, found, detail, origin });
    }

    fn look_at(&mut self, index: usize, reached: &[Option<Facts>], keys: &mut Keys) {
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
        let held = if self.flow.is_whole { held_in(func) } else { Vec::new() };
        let mut is_always_run = vec![false; func.blocks.len()];
        for at in straight_from_the_entry(&self.flow.never_return, func) {
            is_always_run[at] = true;
        }
        for (at, block) in func.blocks.iter().enumerate() {
            let Some(facts) = &reached[at] else { continue };
            self.is_behind_a_test = !is_always_run[at];
            if self.is_behind_a_test && !self.flow.is_whole {
                continue;
            }
            for (place, &v) in block.ops.iter().enumerate() {
                let pos = func.values[v.idx()].pos;
                if pos == 0 {
                    continue;
                }
                let Some(op) = func.op(v) else { continue };
                if place > 0 && !comes_back(&self.flow.never_return, func, block.ops[place - 1]) {
                    break;
                }
                self.at = v;
                self.flow.has_used_a_test = false;
                'checks: {
                match op {
                    &Op::Coerce { value, to, why } if !matches!(why, Why::Upcast | Why::Forced) => {
                        if !func.has(func_flags::IS_TYPED) && matches!(why, Why::Flow | Why::Store | Why::Claim) {
                            break 'checks;
                        }
                        if why == Why::NonNull(StrId::NONE) && is_read_of_lazy_variable(program, func, value) {
                            break 'checks;
                        }
                        let sure = self.flow.val(index, func, facts, keys, value, false);
                        let likely = self.flow.val(index, func, facts, keys, value, true);
                        let wanted = if matches!(why, Why::Coerce | Why::CoerceFreshGraph) { to } else { self.flow.declared(func, v) };
                        let (sure, likely, wanted) = (self.flow.get(sure).clone(), self.flow.get(likely).clone(), self.flow.get(wanted).clone());
                        let mut verdict = self.judge(Some(why), &sure, &likely, &wanted);
                        let takes_integers_only = wanted.ints.is_some() && wanted.prims & prim::NUMBER == 0;
                        if takes_integers_only
                            && !matches!(why, Why::Coerce | Why::CoerceFreshGraph | Why::NonNull(_))
                            && let (Some(number), Some((least, most))) = (self.double(func, value), wanted.ints)
                        {
                            let is_within = number.fract() == 0.0 && number >= least as f64 && number <= most as f64 && !(number == 0.0 && number.is_sign_negative());
                            verdict = if is_within { Verdict::Fine } else { Verdict::Wrong };
                        }
                        if verdict != Verdict::Fine && !matches!(why, Why::Coerce | Why::CoerceFreshGraph) {
                            let without_nil = Declared { prims: likely.prims & !prim::NULLISH, ..likely.clone() };
                            if (matches!(why, Why::NonNull(_)) || self.fits(&without_nil, &wanted)) && is_dereferenced_next(func, at, place, v) {
                                self.throws_either_way += 1;
                                self.passes_somewhere.insert((func.module.0, pos, if matches!(why, Why::NonNull(_)) { Kind::NonNull } else { Kind::Narrowing }));
                                break 'checks;
                            }
                        }
                        let (kind, used) = match why {
                            Why::Coerce | Why::CoerceFreshGraph => (Kind::As, Use::Unseen),
                            Why::NonNull(_) => (Kind::NonNull, Use::Unseen),
                            Why::Flow => (Kind::Narrowing, Use::Unseen),
                            Why::Claim => (
                                match func.op(before_casts(func, value)) {
                                    Some(Op::ElemGet { .. } | Op::IterGet { .. }) => Kind::Element,
                                    Some(Op::PropGet { .. }) => Kind::Read,
                                    Some(Op::Await(_)) => Kind::Await,
                                    Some(Op::Coerce { why: Why::Coerce | Why::CoerceFreshGraph, .. }) => Kind::As,
                                    _ => Kind::Result,
                                },
                                Use::Unseen,
                            ),
                            _ => {
                                if uses.is_none() {
                                    uses = Some(self.uses_in(func));
                                }
                                uses.as_ref().and_then(|uses| uses.get(&v)).copied().unwrap_or((Kind::Variable, Use::Unseen))
                            }
                        };
                        let kind = if takes_integers_only && matches!(why, Why::Cast | Why::CastFresh | Why::Store) { Kind::Integer } else { kind };
                        let holds_a_copy = self.flow.is_whole && why == Why::Cast && may_hold_what_is_not_laid_out(program, self.flow.get(self.flow.declared(func, value))) && likely.has_objects() && names_a_record(program, &wanted, 0) && is_held_elsewhere(func, &held, value);
                        if !holds_a_copy && self.is_dropped(func, pos, kind, verdict) {
                            break 'checks;
                        }
                        let detail = match (why, kind) {
                            (Why::NonNull(text), _) if text.is_some() => format!("`{}!`", String::from_utf8_lossy(program.strs.get(text))),
                            (Why::Claim, Kind::As) => "what the cast let through is used as the type it names".to_owned(),
                            _ => self.text_of_use(func, used),
                        };
                        self.value = self.constant(func, value).unwrap_or_default();
                        let found = text_of(program, &sure, 0);
                        let origin = self.flow.origin_of(index, value);
                        self.name = match (kind, why) {
                            (Kind::As, Why::Claim) => Some("as-late-use"),
                            (Kind::As, _) if wanted.has_objects() && kinds_of(&wanted) == 0 => Some("as-refuse"),
                            (Kind::Element, _) if matches!(func.op(before_casts(func, value)), Some(Op::IterGet { .. })) => Some("iterate-value"),
                            _ => None,
                        };
                        self.risk = self.risk_of(&wanted);
                        self.call = calls.get(&v).copied().filter(|call| call.0 != 0);
                        self.add(func, pos, kind, verdict, text_of(program, &wanted, 0), found, detail, origin);
                        if holds_a_copy {
                            self.add(func, pos, Kind::Copy, Verdict::Unknown, text_of(program, &wanted, 0), "plain object".to_owned(), "an object that is not laid out may be copied here: writes go to the copy, and `===` with the original is false".to_owned(), origin);
                        }
                    }
                    Op::PropGet { .. } | Op::ElemGet { .. } | Op::IterGet { .. } | Op::Call { .. } | Op::CallMethod { .. } | Op::Construct { .. } | Op::Await(_) | Op::Operation { .. } if self.flow.says_something(func.ty(v)) => {
                        if !func.has(func_flags::IS_TYPED) {
                            break 'checks;
                        }
                        let wanted = self.flow.get(func.ty(v)).clone();
                        let (kind, have) = match self.flow.natural(index, func, facts, keys, v) {
                            Natural::Vouched => break 'checks,
                            Natural::Is(ty) => (
                                match op {
                                    Op::PropGet { .. } => Kind::Read,
                                    Op::ElemGet { .. } | Op::IterGet { .. } => Kind::Element,
                                    Op::Await(_) => Kind::Await,
                                    _ => Kind::Result,
                                },
                                ty,
                            ),
                            Natural::Unknown(kind) => (kind, self.flow.tys.anything),
                        };
                        let have = self.flow.get(have).clone();
                        let verdict = self.judge(None, &have, &have, &wanted);
                        let origin = self.flow.origin[(self.flow.first_value[index] + v.0) as usize];
                        self.name = matches!(op, Op::IterGet { .. }).then_some("iterate-value");
                        self.risk = self.risk_of(&wanted);
                        self.call = calls.get(&v).copied().filter(|call| call.0 != 0);
                        self.add(func, pos, kind, verdict, text_of(program, &wanted, 0), text_of(program, &have, 0), String::new(), origin);
                    }
                    &Op::Binary { op, a, b } if func.has(func_flags::IS_TYPED) && self.flow.says_something(func.ty(v)) => {
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
                    &Op::PropSet { obj, name, value } => self.look_at_store(index, func, facts, keys, pos, obj, Some(name), Some(value)),
                    &Op::PropDelete { obj, name } => self.look_at_store(index, func, facts, keys, pos, obj, Some(name), None),
                    &Op::FreeSet { name, .. } if is_locked_global_of_the_engine(program.strs.get(name)) && !matches!(program.strs.get(name), b"undefined" | b"NaN" | b"Infinity") => {
                        let shown = String::from_utf8_lossy(program.strs.get(name)).into_owned();
                        self.name = Some("global-binding-write");
                        self.add(func, pos, Kind::BuiltinWrite, Verdict::Wrong, String::new(), String::new(), format!("`{shown}` cannot be replaced"), 0);
                    }
                    Op::CallMethod { obj, name, args } => {
                        self.look_at_reflection(index, func, facts, keys, pos, *obj, *name, args);
                        self.look_at_call(index, func, facts, keys, pos, v, Some(*obj), args);
                    }
                    Op::Call { callee, args, .. } => {
                        let receiver = match func.op(before_casts(func, *callee)) {
                            Some(&Op::PropGet { obj, name }) => {
                                self.look_at_reflection(index, func, facts, keys, pos, obj, name, args);
                                Some(obj)
                            }
                            Some(&Op::FreeGet { name, .. }) if is_locked_global_of_the_engine(program.strs.get(name)) => Some(*callee),
                            _ => None,
                        };
                        self.look_at_call(index, func, facts, keys, pos, v, receiver, args);
                    }
                    Op::Construct { callee, args } => self.look_at_call(index, func, facts, keys, pos, v, self.flow.holder_of(index, *callee).map(|_| *callee), args),
                    Op::CallDirect { func: called, args } => {
                        let callee = &program.funcs[called.idx()];
                        if !callee.has(func_flags::IS_TYPED | func_flags::IS_BUILTIN | func_flags::IS_OF_BUILTIN_MODULE) {
                            let into = self.name_of_function(callee);
                            self.look_at_functions_handed(index, func, pos, args, &format!("{into}, which is untyped"));
                        }
                    }
                    &Op::ElemSet { obj, key, .. } => {
                        let is_iterator = matches!(func.op(before_casts(func, key)), Some(&Op::PropGet { obj: holder, name }) if program.strs.get(name) == b"iterator" && self.flow.names_global(func, holder, b"Symbol"));
                        let receiver = self.flow.val(index, func, facts, keys, obj, false);
                        if is_iterator && self.flow.get(receiver).parts.iter().any(|part| matches!(part, Part::Array(_))) {
                            self.name = Some("array-not-plain");
                            self.add(func, pos, Kind::Mutation, Verdict::Unknown, String::new(), String::new(), "an array is given an iterator of its own: a loop over it as `T[]` throws".to_owned(), 0);
                        }
                    }
                    &Op::PropGet { obj, name } if matches!(program.strs.get(name), b"caller" | b"arguments") => {
                        if let Some(Identity::Function(read_of)) = self.flow.identity_of(index, obj)
                            && program.funcs[read_of.idx()].has(func_flags::IS_SLOPPY)
                            && program.funcs[read_of.idx()].kind == FuncKind::Plain
                        {
                            let shown = String::from_utf8_lossy(program.strs.get(name)).into_owned();
                            self.add(func, pos, Kind::Caller, Verdict::Wrong, String::new(), String::new(), format!("`.{shown}` of a function is read"), 0);
                        }
                    }
                    _ => {}
                }
            }
        }
    }

    fn look_at_store(&mut self, index: usize, func: &Func, facts: &Facts, keys: &mut Keys, pos: u32, obj: V, name: Option<StrId>, value: Option<V>) {
        let program = self.flow.program;
        let context = self.flow.origin_of(index, obj) & CONTEXTUAL;
        let shown = name.map_or_else(String::new, |name| String::from_utf8_lossy(program.strs.get(name)).into_owned());
        let verb = if value.is_some() { "assigned" } else { "deleted" };
        if let Some((holder, is_prototype)) = self.flow.holder_of(index, obj) {
            let holder_shown = String::from_utf8_lossy(holder).into_owned();
            if is_prototype {
                self.name = Some("builtin-prototype-write");
                return self.add(func, pos, Kind::BuiltinWrite, Verdict::Wrong, String::new(), String::new(), format!("`{holder_shown}.prototype.{shown}` is {verb}: built-in prototypes are frozen"), context);
            }
            let is_global_object = holder == b"globalThis";
            let is_locked = name.is_some_and(|name| if is_global_object { is_locked_global_of_the_engine(program.strs.get(name)) && !matches!(program.strs.get(name), b"undefined" | b"NaN" | b"Infinity") } else { is_builtin_of_the_engine(holder, program.strs.get(name)) || program.strs.get(name) == b"prototype" });
            if is_locked {
                self.name = Some(if is_global_object { "global-binding-write" } else { "builtin-member-replace" });
                self.add(func, pos, Kind::BuiltinWrite, Verdict::Wrong, String::new(), String::new(), format!("`{holder_shown}.{shown}` is {verb}: what the language ships with cannot be replaced"), context);
            }
            return;
        }
        if let Some(owner) = self.function_named(index, func, obj)
            && program.funcs[owner.idx()].has(func_flags::GENERATOR)
            && shown == "prototype"
        {
            let owner = self.name_of_function(&program.funcs[owner.idx()]);
            self.name = Some("generator-prototype-write");
            return self.add(func, pos, Kind::PrototypeWrite, Verdict::Wrong, String::new(), String::new(), format!("`prototype` of the generator function {owner} is {verb}: loops call the generator's body directly"), context);
        }
        if let Some(owner) = self.owner_of_prototype(index, obj) {
            let (made, named) = (&program.funcs[owner.idx()], self.name_of_function(&program.funcs[owner.idx()]));
            if made.has(func_flags::GENERATOR) {
                self.name = Some("generator-prototype-write");
                return self.add(func, pos, Kind::PrototypeWrite, Verdict::Wrong, String::new(), String::new(), format!("`{shown}` is {verb} on the prototype of the generator function {named}, which is frozen"), context);
            }
            if let (Some(&class), Some(name)) = (self.class_of.get(&owner), name)
                && program.layouts[class.idx()].class_flags & class_flags::IS_LAID_OUT != 0
                && !self.declares_member(class, name)
            {
                self.add(func, pos, Kind::PrototypeWrite, Verdict::Wrong, String::new(), String::new(), format!("`{shown}` is {verb} on the prototype of the class {named}, which does not declare it: class prototypes take no new members"), context);
            }
            return;
        }
        let written_as = self.flow.get(self.flow.declared(func, obj)).clone();
        if !written_as.any_object {
            if let (Some(name), Some(value)) = (name, value) {
                self.look_at_store_through_view(index, func, facts, keys, pos, &written_as, name, value);
            }
            return;
        }
        let receiver = self.flow.val(index, func, facts, keys, obj, false);
        let receiver = self.flow.get(receiver).clone();
        if receiver.any_object || receiver.parts.is_empty() {
            return;
        }
        let Some(name) = name else { return };
        for part in &receiver.parts {
            let &Part::Class(layout) = part else { continue };
            let made_as = &program.layouts[layout.idx()];
            let Some(field) = made_as.field(name) else { continue };
            let field = &made_as.fields[field as usize];
            let owner = text_of(program, &Declared::part(Part::Class(layout)), context);
            let is_only = receiver.parts.len() == 1 && receiver.prims == 0;
            match value {
                None if field.flags & field_flags::OPTIONAL == 0 => {
                    let verdict = if is_only && !made_as.admits_foreign { Verdict::Wrong } else { Verdict::Unknown };
                    self.name = Some("field-delete");
                    self.add(func, pos, Kind::Mutation, verdict, String::new(), String::new(), format!("`{shown}` of {owner} is deleted through `any`: only optional properties can be deleted"), context);
                }
                Some(value) if field.declared.is_some() => {
                    let stored = self.flow.val(index, func, facts, keys, value, false);
                    let (stored, wanted) = (self.flow.get(stored).clone(), self.flow.get(field.declared).clone());
                    let verdict = match self.judge(None, &stored, &stored, &wanted) {
                        Verdict::Wrong if !is_only || made_as.admits_foreign => Verdict::Unknown,
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

    fn look_at_store_through_view(&mut self, index: usize, func: &Func, facts: &Facts, keys: &mut Keys, pos: u32, written_as: &Declared, name: StrId, value: V) {
        let program = self.flow.program;
        if !func.has(func_flags::IS_TYPED) {
            return;
        }
        for part in &written_as.parts {
            let &Part::Class(view) = part else { continue };
            let looked_at = &program.layouts[view.idx()];
            let Some(seen) = looked_at.field(name) else { continue };
            let seen = looked_at.fields[seen as usize].declared;
            for &member in looked_at.members.iter().filter(|&&member| member != view) {
                let made_as = &program.layouts[member.idx()];
                let Some(held) = made_as.field(name) else { continue };
                let held = made_as.fields[held as usize].declared;
                if held == seen || held.is_none() {
                    continue;
                }
                let stored = self.flow.val(index, func, facts, keys, value, false);
                let (stored, wanted) = (self.flow.get(stored).clone(), self.flow.get(held).clone());
                let verdict = self.judge(None, &stored, &stored, &wanted).min(Verdict::Unknown);
                if verdict == Verdict::Fine {
                    continue;
                }
                let (shown, through, made) = (String::from_utf8_lossy(program.strs.get(name)).into_owned(), text_of(program, &Declared::part(Part::Class(view)), 0), text_of(program, &Declared::part(Part::Class(member)), 0));
                let found = text_of(program, &stored, 0);
                self.add(func, pos, Kind::Field, verdict, text_of(program, &wanted, 0), found, format!("`{shown}` is stored through {through}, and the object may have been made as {made}, which declares it narrower"), 0);
                return;
            }
        }
    }

    fn function_named(&self, index: usize, func: &Func, v: V) -> Option<FuncId> {
        match (self.flow.identity_of(index, v), func.prediction(v)) {
            (Some(Identity::Function(named)), _) | (None, Prediction::Closure(named)) => Some(named),
            _ => None,
        }
    }

    fn owner_of_prototype(&self, index: usize, v: V) -> Option<FuncId> {
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

    fn look_at_functions_handed(&mut self, index: usize, func: &Func, pos: u32, args: &[V], into: &str) {
        let program = self.flow.program;
        for &argument in args {
            let Some(handed) = self.function_named(index, func, argument) else { continue };
            let made = &program.funcs[handed.idx()];
            let checked: Vec<String> = made.params.iter().filter(|&&parameter| self.flow.says_something(parameter) && !program.tys.get(parameter).has_objects()).map(|&parameter| text_of(program, program.tys.get(parameter), 0)).collect();
            if made.has(func_flags::IS_TYPED) && !checked.is_empty() {
                let named = self.name_of_function(made);
                self.add(func, pos, Kind::Parameter, Verdict::Unknown, checked.join(", "), "any".to_owned(), format!("{named} is handed to {into}: its parameters are checked at every call from there"), 0);
            }
        }
    }

    fn look_at_call(&mut self, index: usize, func: &Func, facts: &Facts, keys: &mut Keys, pos: u32, v: V, receiver_of_the_engine: Option<V>, args: &[V]) {
        let program = self.flow.program;
        let Some((found, handed)) = functions_called(program, func, v) else {
            let is_vouched = receiver_of_the_engine.is_some_and(|receiver| {
                let known = self.flow.val(index, func, facts, keys, receiver, false);
                self.flow.holder_of(index, receiver).is_some() || self.flow.is_of_the_engine_only(&self.flow.get(known).clone())
            });
            if !is_vouched {
                self.look_at_functions_handed(index, func, pos, args, "a function that the compiler does not see");
            }
            return;
        };
        for &called in &found {
            let callee = &program.funcs[called.idx()];
            if !callee.has(func_flags::IS_TYPED) {
                let into = self.name_of_function(callee);
                self.look_at_functions_handed(index, func, pos, args, &format!("{into}, which is untyped"));
                continue;
            }
            let one_by_one = callee.params.len() - usize::from(callee.has(func_flags::HAS_REST) && !callee.params.is_empty());
            for (number, (&parameter, &argument)) in callee.params[..one_by_one].iter().zip(handed).enumerate() {
                if !self.flow.says_something(parameter) {
                    continue;
                }
                let given = self.flow.val(index, func, facts, keys, argument, false);
                let (given, wanted) = (self.flow.get(given).clone(), self.flow.get(parameter).clone());
                let given = Declared { prims: given.prims & !prim::UNDEFINED, ..given };
                if given.has_objects() && wanted.has_objects() || given.is_never() {
                    continue;
                }
                let verdict = self.judge(None, &given, &given, &wanted);
                self.value = self.constant(func, argument).unwrap_or_default();
                let found = text_of(program, &given, 0);
                let origin = self.flow.origin_of(index, argument);
                let named = self.name_of_function(callee);
                self.risk = self.risk_of(&wanted);
                self.is_at_an_entry = callee.has(func_flags::IS_VALUE) && self.has_an_entry_that_tests[called.idx()];
                self.add(func, pos, Kind::Argument, verdict, text_of(program, &wanted, 0), found, format!("argument {} of {named}", number + 1), origin);
            }
        }
    }

    fn look_at_reflection(&mut self, index: usize, func: &Func, facts: &Facts, keys: &mut Keys, pos: u32, obj: V, name: StrId, args: &[V]) {
        let program = self.flow.program;
        let Some((holder, false)) = self.flow.holder_of(index, obj) else { return };
        if !matches!(holder, b"Object" | b"Reflect") {
            return;
        }
        let called = program.strs.get(name);
        if called == b"construct" && args.len() > 2 {
            self.name = Some("construct-new-target");
            return self.add(func, pos, Kind::Result, Verdict::Unknown, String::new(), String::new(), "`Reflect.construct` with a new.target of its own: a typed constructor function takes none whose `prototype` is not that of a typed function".to_owned(), 0);
        }
        if !matches!(called, b"defineProperty" | b"defineProperties" | b"setPrototypeOf" | b"assign" | b"set" | b"deleteProperty") {
            return;
        }
        let Some(&target) = args.first() else { return };
        let context = self.flow.origin_of(index, target) & CONTEXTUAL;
        let shown = format!("{}.{}", String::from_utf8_lossy(holder), String::from_utf8_lossy(called));
        if let Some((changed, is_prototype)) = self.flow.holder_of(index, target) {
            let changed = String::from_utf8_lossy(changed).into_owned();
            if is_prototype {
                let what = if holder == b"Reflect" { "answers false where plain JavaScript answers true" } else { "throws" };
                self.name = Some("builtin-prototype-write");
                self.add(func, pos, Kind::BuiltinWrite, Verdict::Wrong, String::new(), String::new(), format!("`{shown}({changed}.prototype, ..)` {what}: built-in prototypes are frozen"), context);
            }
            return;
        }
        if let Some(owner) = self.owner_of_prototype(index, target) {
            let (made, named) = (&program.funcs[owner.idx()], self.name_of_function(&program.funcs[owner.idx()]));
            if made.has(func_flags::GENERATOR) {
                self.name = Some("generator-prototype-write");
                self.add(func, pos, Kind::PrototypeWrite, Verdict::Wrong, String::new(), String::new(), format!("`{shown}` on the prototype of the generator function {named}, which is frozen"), context);
            } else if self.class_of.get(&owner).is_some_and(|class| program.layouts[class.idx()].class_flags & class_flags::IS_LAID_OUT != 0) {
                self.add(func, pos, Kind::PrototypeWrite, Verdict::Unknown, String::new(), String::new(), format!("`{shown}` on the prototype of the class {named}: class prototypes take no new members"), context);
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
            let made_as = &program.layouts[layout.idx()];
            if !made_as.is_allocated || made_as.kind == LayoutKind::Environment {
                continue;
            }
            let owner = text_of(program, &Declared::part(Part::Class(layout)), context);
            let key = args.get(1).and_then(|&key| match func.op(before_casts(func, key)) {
                Some(&Op::Str(key)) => Some(key),
                _ => None,
            });
            let is_only = receiver.parts.len() == 1 && receiver.prims == 0 && !made_as.admits_foreign && holder != b"Reflect";
            match called {
                b"setPrototypeOf" => {
                    self.name = Some("object-set-prototype");
                    self.add(func, pos, Kind::Mutation, if is_only { Verdict::Wrong } else { Verdict::Unknown }, String::new(), String::new(), format!("`{shown}` on {owner}: compiled objects have a fixed prototype"), context);
                }
                b"defineProperty" | b"deleteProperty" => {
                    let names_a_field = key.is_some_and(|key| made_as.field(key).is_some());
                    if names_a_field || key.is_none() {
                        self.name = Some("field-redefine");
                        self.add(func, pos, Kind::Mutation, Verdict::Unknown, String::new(), String::new(), format!("`{shown}` on {owner}: declared properties stay writable, enumerable and configurable data properties"), context);
                    }
                }
                _ => self.add(func, pos, Kind::Mutation, Verdict::Unknown, String::new(), String::new(), format!("`{shown}` on {owner}: what it stores is held to the declared types"), context),
            }
        }
    }
}

fn may_hold_what_is_not_laid_out(program: &Program, ty: &Declared) -> bool {
    ty.any_object || ty.parts.iter().any(|part| matches!(part, Part::Class(view) if view.is_some() && program.layouts[view.idx()].admits_foreign))
}

fn names_a_record(program: &Program, ty: &Declared, depth: u32) -> bool {
    ty.parts.iter().any(|part| match *part {
        Part::Class(layout) => layout.is_some() && program.layouts[layout.idx()].kind == LayoutKind::Record,
        Part::Array(elements) => depth < 2 && elements.is_some() && names_a_record(program, program.tys.get(elements), depth + 1),
        Part::Global(..) => false,
    })
}

fn held_in(func: &Func) -> Vec<bool> {
    let mut held = vec![false; func.values.len()];
    for block in &func.blocks {
        for &v in &block.ops {
            let Some(op) = func.op(v) else { continue };
            let builds = match op {
                Op::Coerce { .. } => continue,
                Op::Operation { args, .. } => args.first().copied().filter(|&made| matches!(func.op(made), Some(Op::NewObject))),
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

fn is_held_elsewhere(func: &Func, held: &[bool], v: V) -> bool {
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

fn is_read_of_lazy_variable(program: &Program, func: &Func, v: V) -> bool {
    let is_lazy = |v: V| matches!(func.op(before_casts(func, v)), Some(&Op::GlobalGet(global)) if program.globals[global.idx()].initialization == Initialization::Lazy);
    let root = before_casts(func, v);
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
                Op::Undefined | Op::Null | Op::Bool(_) | Op::Int(_) | Op::Double(_) | Op::Str(_) | Op::BigInt(_) | Op::FuncRef(_) | Op::GlobalGet(_) | Op::FieldGet { .. } => {}
                &Op::Coerce { value, why: Why::Upcast | Why::Forced, .. } if aliases.contains(&value) => aliases.push(next),
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

pub(super) fn always_fail(program: &Program) -> Vec<Site> {
    find(program, false).0.into_iter().filter(|site| site.verdict == Verdict::Wrong).collect()
}

fn find(program: &Program, is_whole: bool) -> (Vec<Site>, Vec<(Kind, usize)>, usize, usize, [f64; 3]) {
    let begun = Instant::now();
    let mut flow = Flow::new(program, is_whole);
    let prepared = begun.elapsed().as_secs_f64();
    let mut rounds = 0;
    let stores_to_a_constant = |func: &Func| func.values.iter().any(|value| matches!(value.def, Def::Op(Op::GlobalSet(global, _)) if program.globals[global.idx()].initialization == Initialization::NeverSeenAndStoredOnce));
    let looked_at: Vec<usize> = (0..program.funcs.len()).filter(|&index| is_whole || stores_to_a_constant(&program.funcs[index])).collect();
    for &index in &looked_at {
        flow.wake(index);
    }
    while rounds < program.funcs.len() * MOST_ROUNDS
        && let Some(index) = flow.pending.pop_front()
    {
        flow.is_pending[index as usize] = false;
        flow.run(index as usize);
        rounds += 1;
    }
    for &index in looked_at.iter().chain(&looked_at).filter(|_| !is_whole) {
        flow.run(index);
    }
    let is_settled = flow.pending.is_empty();
    let settled = begun.elapsed().as_secs_f64();
    let surely = surely_run(program, &flow.never_return);
    let class_of = program.layouts.iter().enumerate().filter(|(_, layout)| layout.constructor.is_some()).map(|(index, layout)| (layout.constructor, LayoutId::new(index))).collect();
    let mut has_an_entry_that_tests = vec![false; program.funcs.len()];
    for entry in program.funcs.iter().filter(|func| func.has(func_flags::IS_GENERAL_ENTRY) && func.kind != FuncKind::Method) {
        let first = entry.values.iter().find_map(|value| match &value.def {
            Def::Op(Op::CallDirect { func: called, .. }) => Some(*called),
            _ => None,
        });
        if let Some(called) = first {
            has_an_entry_that_tests[called.idx()] = true;
        }
    }
    let mut report = Report { flow: &mut flow, sites: Vec::new(), fine: FxHashMap::default(), class_of, throws_either_way: 0, at: V::NONE, name: None, value: String::new(), passes_somewhere: FxHashSet::default(), is_behind_a_test: false, is_surely_run: false, risk: "", call: None, is_at_an_entry: false, has_an_entry_that_tests };
    for (index, func) in program.funcs.iter().enumerate() {
        if func.module.is_none() || func.has(func_flags::IS_BUILTIN | func_flags::IS_OF_BUILTIN_MODULE | func_flags::IS_HIDDEN_IN_STACK_TRACES | func_flags::IS_GENERAL_ENTRY) {
            continue;
        }
        let path = program.strs.get(program.modules[func.module.idx()].display_path);
        if path.starts_with(b".bun-aot-prelude/") || path.windows(18).any(|window| window == b"/.bun-aot-prelude/") {
            continue;
        }
        let (reached, mut keys) = report.flow.run(index);
        report.is_surely_run = surely[index];
        report.look_at(index, &reached, &mut keys);
    }
    let mut sites = report.sites;
    for site in sites.iter_mut().filter(|site| site.verdict == Verdict::Wrong && report.passes_somewhere.contains(&(site.module, site.pos, site.kind))) {
        site.verdict = Verdict::Unknown;
        site.detail = if site.detail.is_empty() { "it always fails on one of the paths to here".to_owned() } else { format!("{}: it always fails on one of the paths to here", site.detail) };
    }
    if !is_settled || report.flow.has_given_up {
        for site in &mut sites {
            site.verdict = site.verdict.min(Verdict::Unknown);
        }
    }
    sites.sort_by(|a, b| (a.module, a.pos, a.kind, std::cmp::Reverse(a.verdict)).cmp(&(b.module, b.pos, b.kind, std::cmp::Reverse(b.verdict))));
    sites.dedup_by(|next, kept| (next.module, next.pos, next.kind) == (kept.module, kept.pos, kept.kind));
    let fine = Kind::ALL.iter().map(|&kind| (kind, report.fine.get(&kind).copied().unwrap_or(0))).collect();
    (sites, fine, rounds, report.throws_either_way, [prepared, settled - prepared, begun.elapsed().as_secs_f64() - settled])
}

pub(super) fn explain(program: &Program, as_json: bool, lists_all: bool, line_and_column: &dyn Fn(u32, u32) -> (u32, u32)) -> Vec<String> {
    let (sites, fine, rounds, throws_either_way, [prepared, settled, looked]) = find(program, true);
    let path_of = |module: u32| String::from_utf8_lossy(program.strs.get(program.modules[module as usize].display_path)).into_owned();
    let mut lines = Vec::new();
    let mut ordinals: FxHashMap<(u32, u32, &'static str), usize> = FxHashMap::default();
    let mut listed = [0usize; 4];
    let many = |tier: Tier| sites.iter().filter(|site| site.tier == tier && site.verdict != Verdict::Wrong).count();
    let folds_the_outside = !as_json && !lists_all && many(Tier::Outside) > MOST_LISTED;
    for site in sites.iter().filter(|site| lists_all || site.tier != Tier::Typed || site.verdict == Verdict::Wrong) {
        if !as_json && !lists_all && site.verdict != Verdict::Wrong {
            let so_far = &mut listed[Tier::ALL.iter().position(|&tier| tier == site.tier).unwrap_or(0)];
            *so_far += 1;
            if *so_far > MOST_LISTED || folds_the_outside && site.tier == Tier::Outside {
                continue;
            }
        }
        let (line, column) = line_and_column(site.module, site.pos);
        let verdict = if site.verdict == Verdict::Wrong { "error" } else { "warning" };
        let from = site.origin.as_ref().filter(|origin| origin.0 != u32::MAX).map(|(module, pos, what)| {
            let (line, column) = line_and_column(*module, *pos);
            (path_of(*module), line, column, what.clone())
        });
        if as_json {
            let shown_path = path_of(site.module);
            let ordinal = ordinals.entry((site.module, site.pos, site.name)).or_insert(0usize);
            let id_of = |line: u32, column: u32, name: &str, ordinal: usize| {
                let mut hash: u64 = 0xcbf29ce484222325;
                for &byte in shown_path.as_bytes().iter().chain(format!(":{line}:{column}:{name}:{ordinal}").as_bytes()) {
                    hash = (hash ^ u64::from(byte)).wrapping_mul(0x100000001b3);
                }
                (hash >> 48) ^ (hash & 0xffff_ffff_ffff)
            };
            let id = id_of(line, column, site.name, *ordinal);
            *ordinal += 1;
            let mut text = format!("{{\"aot\":\"type-check\",\"id\":\"{:012x}\",\"kind\":\"{}\",\"group\":\"{}\",\"what\":\"{}\",\"file\":\"{}\",\"line\":{line},\"col\":{column},\"fn\":\"{}\"", id, site.name, site.kind.text(), site.what, escaped(&shown_path), escaped(&site.function));
            for (key, value) in [("expected", &site.expected), ("got", &site.found), ("value", &site.value), ("detail", &site.detail)] {
                if !value.is_empty() {
                    let _ = write!(text, ",\"{key}\":\"{}\"", escaped(value));
                }
            }
            if let Some((at, parameter)) = site.call {
                let (line, column) = line_and_column(site.module, at);
                let _ = write!(text, ",\"callId\":\"{:012x}\"", id_of(line, column, "enter-argument", parameter as usize));
            }
            let _ = write!(text, ",\"action\":\"{verdict}\",\"tier\":\"{}\"", site.tier.text());
            for (key, value) in [("risk", site.risk), ("door", &site.door[..])] {
                if !value.is_empty() {
                    let _ = write!(text, ",\"{key}\":\"{}\"", escaped(value));
                }
            }
            if let Some((path, line, column, what)) = &from {
                let _ = write!(text, ",\"origin\":{{\"what\":\"{}\",\"file\":\"{}\",\"line\":{line},\"col\":{column}}}", escaped(what), escaped(path));
            }
            let _ = write!(text, ",\"fix\":\"{}\"}}", escaped(site.kind.fix(site.verdict)));
            lines.push(text);
            continue;
        }
        let mut text = format!("throws: {}:{line}:{column}: {verdict}: {} ({})", path_of(site.module), site.name, site.tier.text());
        if !site.detail.is_empty() {
            let _ = write!(text, ": {}", site.detail);
        }
        if !site.expected.is_empty() {
            let _ = write!(text, ": expected {}, {} {}", site.expected, if site.verdict == Verdict::Wrong { "always gets" } else { "may get" }, site.shown());
        }
        if let Some((path, line, column, what)) = &from {
            let _ = write!(text, "; from {what} at {path}:{line}:{column}");
        }
        let _ = write!(text, "; fix: {}", site.kind.fix(site.verdict));
        lines.push(text);
    }
    if as_json {
        return lines;
    }
    if folds_the_outside {
        let mut doors: FxHashMap<&str, (usize, usize, usize, &Site)> = FxHashMap::default();
        for site in sites.iter().filter(|site| site.tier == Tier::Outside && site.verdict != Verdict::Wrong) {
            let door = doors.entry(&site.door[..]).or_insert((0, 0, 0, site));
            door.0 += 1;
            door.1 += usize::from(site.risk == "primitive");
            door.2 += usize::from(site.risk == "closed");
            if door.3.risk != "primitive" && site.risk == "primitive" {
                door.3 = site;
            }
        }
        let mut doors: Vec<(&str, (usize, usize, usize, &Site))> = doors.into_iter().collect();
        doors.sort_by(|a, b| (b.1.1 + b.1.2, b.1.0, a.0).cmp(&(a.1.1 + a.1.2, a.1.0, b.0)));
        let throwing: usize = doors.iter().map(|door| door.1.1 + door.1.2).sum();
        let mut so_far = 0;
        let half = doors.iter().take_while(|door| { let is_short = so_far * 2 < throwing; so_far += door.1.1 + door.1.2; is_short }).count();
        lines.push(format!("throws: {} places check what comes from outside, through {} doors; {throwing} of the places throw on a wrong value (they expect a primitive, or a type that takes no foreign object), and {half} doors hold half of those; the doors, by how many such places they have:", many(Tier::Outside), doors.len()));
        for (door, (places, primitives, closed, first)) in doors.iter().take(MOST_DOORS) {
            let (line, column) = line_and_column(first.module, first.pos);
            lines.push(format!("throws: door: {}: {places} places, {primitives} expect a primitive, {closed} a closed type; e.g. {}:{line}:{column}: {}: expected {}", if door.is_empty() { "(unknown)" } else { door }, path_of(first.module), first.name, first.expected));
        }
        if doors.len() > MOST_DOORS {
            lines.push(format!("throws: {} more doors: --aot-explain=throws-json has a line a place, with its door and its risk", doors.len() - MOST_DOORS));
        }
    }
    for (tier, &count) in Tier::ALL.iter().zip(&listed) {
        if count > MOST_LISTED && !(folds_the_outside && *tier == Tier::Outside) {
            lines.push(format!("throws: {} more of the tier {}: --aot-explain=throws-all lists them", count - MOST_LISTED, tier.text()));
        }
    }
    for (kind, fine) in fine {
        let count = |verdict: Verdict| sites.iter().filter(|site| site.kind == kind && site.verdict == verdict).count();
        let by_tier: Vec<String> = Tier::ALL.iter().map(|&tier| (tier, sites.iter().filter(|site| site.kind == kind && site.verdict == Verdict::Unknown && site.tier == tier).count())).filter(|found| found.1 != 0).map(|(tier, count)| format!("{count} {}", tier.text())).collect();
        lines.push(format!("throws: count: {}: {} provably fine, {} provably wrong, {} unknown{}{}", kind.text(), fine, count(Verdict::Wrong), count(Verdict::Unknown), if by_tier.is_empty() { "" } else { ": " }, by_tier.join(", ")));
    }
    lines.push(format!("throws: count: {throws_either_way} checks for undefined or null stand right ahead of an access that throws in plain JavaScript too: not announced"));
    for tier in Tier::ALL {
        lines.push(format!("throws: count: tier {}: {} unknown", tier.text(), sites.iter().filter(|site| site.verdict == Verdict::Unknown && site.tier == tier).count()));
    }
    let counted = if lists_all { 0 } else { sites.iter().filter(|site| site.tier == Tier::Typed && site.verdict != Verdict::Wrong).count() };
    lines.push(format!("throws: {} sites are listed, {} of them errors; {counted} more can fail only where a value contradicts a type that typed code gave it: --aot-explain=throws-all lists them; the flows settled in {rounds} runs of a function: {prepared:.2} s to prepare, {settled:.2} s to settle, {looked:.2} s to look at the sites", sites.len() - counted, sites.iter().filter(|site| site.verdict == Verdict::Wrong).count()));
    lines
}
